/**
 * The converter runner's child (M6 S3c §4.3 step 5): started by the parent
 * (`converter.ts`) as `analyzr-convert __child` inside the sandbox of
 * `sandbox.ts`, it refuses to run anywhere else. It has no read grant on the
 * export (nor on anything but its own script): the parent sends the
 * converter's approved bytes and every file of the export on stdin. It runs
 * the converter twice, each time in a fresh `vm` context that holds no
 * object of this process (`inner.ts`): the context's global has a null
 * prototype, strings cannot be compiled (the process flag and the
 * context's own setting), `import()` cannot occur (the parent refuses a
 * converter that names it), the converter is compiled inside the context
 * (as a function body, so its top level runs within the runner's error
 * handling and time limit), and the bridge takes and returns strings only.
 * Microtasks run inside each evaluation and within its time limit. Nothing
 * the context throws is read here beyond plain data properties. The result
 * is written on stdout only when both runs give the same JSON.
 *
 * It imports only Node built-ins and modules of `src/` that import nothing
 * else (`../encoding.ts`, `../xml.ts`, `inner.ts`, `sandbox.ts`,
 * `unzip.ts`), so in source mode the read grant on `src/` suffices.
 */
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import vm from 'node:vm';

import { decodeText } from '../encoding.ts';
import { parseXml, position, XmlSyntaxError, type XmlElement } from '../xml.ts';

import { BRIDGE_GLOBAL, CONVERTER_GLOBAL, INPUT_GLOBAL, innerSource, RUN_GLOBAL } from './inner.ts';
import {
  sandboxProblem,
  type ChildErrorCode,
  type ChildFile,
  type ChildHeader,
  type ChildReads,
  type ChildReply,
} from './sandbox.ts';
import { inflateEntry, type ZipFileEntry } from './unzip.ts';

/** Most bytes read from stdin: the parent's limits (512 MB of files) and the header. */
const MAX_INPUT_BYTES = 1024 * 1024 * 1024;

/** Longest source id: `MAX_SOURCE_LENGTH` of `validate.ts`, not imported here (a test pins both). */
export const SOURCE_ID_MAX = 200;

/**
 * Most bytes of inflated zip entries kept for later reads (they live outside
 * the heap limit); beyond it, an entry is inflated again on each read.
 */
const INFLATED_KEPT = 256 * 1024 * 1024;

/** Longest text `helpers.xml` reads (an export's file has at most 64 MB), longest raw source id. */
const MAX_XML_CHARS = 64 * 1024 * 1024;
const MAX_SOURCE_ID_INPUT = 64 * 1024;

/** Longest error message passed on (the converter's own text included). */
const MAX_MESSAGE = 2000;

/** The name stack traces give the converter's code, which the runner keeps in its error lines. */
const CONVERTER_FILE = 'converter.js';

/** A file of the export as the child holds it: its bytes (empty when unread) and zip entries by name. */
export interface LoadedFile extends ChildFile {
  bytes: Uint8Array;
  entries: Map<string, ZipFileEntry>;
}

/** An element of `helpers.xml`'s tree: plain data, attributes by their qualified name. */
interface PlainElement {
  name: string;
  local: string;
  ns: string | null;
  attrs: Record<string, string>;
  children: PlainElement[];
  /** The character data directly inside the element, joined. */
  text: string;
  /**
   * The element's content in document order: its character data runs as
   * strings, its child elements as their index in `children` (so mixed
   * content such as `Auftrag <fld>4711</fld> prüfen` reads back in order).
   */
  content: (string | number)[];
}

const cut = (text: string): string =>
  text.length <= MAX_MESSAGE ? text : `${text.slice(0, MAX_MESSAGE)}…`;

/** The tree of `text` as JSON: a DOCTYPE skipped, other than the predefined entities left as written. */
function xmlJson(text: string): string {
  if (text.length > MAX_XML_CHARS) {
    throw new Error(
      `the text has more than ${MAX_XML_CHARS} characters: give helpers.xml one file or entry`,
    );
  }
  let root: XmlElement;
  try {
    root = parseXml(text, { lenient: true }).root;
  } catch (err) {
    if (err instanceof XmlSyntaxError) {
      const { line, column } = position(text, err.offset);
      throw new Error(`not well-formed XML: ${err.message} (line ${line}, column ${column})`, {
        cause: err,
      });
    }
    throw err;
  }
  const plain = (el: XmlElement): PlainElement => {
    const attrs = Object.create(null) as Record<string, string>;
    for (const a of el.attributes) attrs[a.name] = a.value;
    // texts and children are each in document order: merged by their offsets
    const content: (string | number)[] = [];
    let t = 0;
    for (const [c, child] of el.children.entries()) {
      for (; t < el.texts.length && (el.texts[t]?.start ?? 0) < child.start; t++) {
        content.push(el.texts[t]?.value ?? '');
      }
      content.push(c);
    }
    for (; t < el.texts.length; t++) content.push(el.texts[t]?.value ?? '');
    return {
      name: el.name,
      local: el.local,
      ns: el.ns,
      attrs,
      children: [],
      text: el.texts.map((x) => x.value).join(''),
      content,
    };
  };
  const top = plain(root);
  const stack: [XmlElement, PlainElement][] = [[root, top]];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const [el, out] = next;
    for (const child of el.children) {
      const converted = plain(child);
      out.children.push(converted);
      stack.push([child, converted]);
    }
  }
  try {
    return JSON.stringify({ root: top });
  } catch (err) {
    throw new Error('the XML is nested too deeply', { cause: err });
  }
}

/** A source id from tool ids joined by `-`: control characters replaced, capped with a hash. */
export function sourceIdOf(raw: string): string {
  if (raw.length > MAX_SOURCE_ID_INPUT) {
    throw new Error(`a source id is made of tool ids, not of ${raw.length} characters`);
  }
  const clean = raw.replace(/[\p{Cc}\p{Cs}]/gu, '_');
  if (clean.length <= SOURCE_ID_MAX) return clean;
  const hash = createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 12);
  return `${clean.slice(0, SOURCE_ID_MAX - 13).replace(/[\ud800-\udbff]$/, '')}-${hash}`;
}

class Reads {
  readonly files = new Set<string>();
  readonly entries = new Set<string>();

  summary(of: number): ChildReads {
    return { files: this.files.size, of, entries: this.entries.size };
  }

  /** Every file and entry read (an entry as `<file>\0<entry>`), sorted. */
  list(): string[] {
    return [...this.files, ...this.entries].sort();
  }
}

/** The bridge of one run: strings in, a string out (`=` value or `!` error), never a throw. */
function bridgeFor(
  files: ReadonlyMap<string, LoadedFile>,
  reads: Reads,
  inflated: Map<string, Uint8Array>,
): (op: unknown, a: unknown, b: unknown) => string {
  const content = (file: string, entry: string): Uint8Array => {
    const f = files.get(file);
    if (f === undefined) throw new Error(`no file ${JSON.stringify(file)} in input.files`);
    if (f.unread !== null) {
      throw new Error(`${JSON.stringify(file)} was not read: ${f.unread}`);
    }
    reads.files.add(file);
    if (entry === '') return f.bytes;
    if (f.zip === null) throw new Error(`${JSON.stringify(file)} is no zip archive`);
    if (f.zip.error !== null) {
      throw new Error(`${JSON.stringify(file)}: the archive was not opened (${f.zip.error})`);
    }
    const e = f.entries.get(entry);
    if (e === undefined) {
      throw new Error(`no entry ${JSON.stringify(entry)} in ${JSON.stringify(file)}`);
    }
    const key = `${file}\0${entry}`;
    reads.entries.add(key);
    let bytes = inflated.get(key);
    if (bytes === undefined) {
      bytes = inflateEntry(f.bytes, e);
      let kept = 0;
      for (const b of inflated.values()) kept += b.length;
      if (kept + bytes.length <= INFLATED_KEPT) inflated.set(key, bytes);
    }
    return bytes;
  };
  const named = (file: string, entry: string): string =>
    entry === '' ? JSON.stringify(file) : `${JSON.stringify(file)} (${JSON.stringify(entry)})`;
  return (op, a, b) => {
    try {
      if (typeof op !== 'string' || typeof a !== 'string' || typeof b !== 'string') {
        return '!helpers take strings';
      }
      switch (op) {
        case 'text': {
          const bytes = content(a, b);
          try {
            return `=${decodeText(bytes)}`;
          } catch (err) {
            throw new Error(`${named(a, b)}: ${err instanceof Error ? err.message : 'not text'}`, {
              cause: err,
            });
          }
        }
        case 'bytes': {
          const bytes = content(a, b);
          return `=${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1')}`;
        }
        case 'xml':
          return `=${xmlJson(a)}`;
        case 'sourceId':
          return `=${sourceIdOf(a)}`;
        default:
          return '!no such helper';
      }
    } catch (err) {
      return `!${cut(err instanceof Error ? err.message : 'failed')}`;
    }
  };
}

export class RunError extends Error {
  readonly code: ChildErrorCode;

  constructor(code: ChildErrorCode, message: string) {
    super(message);
    this.name = 'RunError';
    this.code = code;
  }
}

/**
 * A data property of `value`, read without running code of the context: no
 * proxy trap, no getter.
 */
function ownData(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || types.isProxy(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor
    ? (descriptor.value as unknown)
    : undefined;
}

/** What an evaluation threw, told without touching the thrown value's code. */
function thrown(err: unknown, run: number): RunError {
  if (ownData(err, 'code') === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
    return new RunError(
      'timeout',
      `run ${run}: the converter did not finish in time (an endless loop, or too much work for one run)`,
    );
  }
  const message = types.isNativeError(err) ? ownData(err, 'message') : undefined;
  const stack = types.isNativeError(err) ? ownData(err, 'stack') : undefined;
  const at =
    typeof stack === 'string'
      ? stack
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.includes(`${CONVERTER_FILE}:`))
          .slice(0, 3)
          .join('; ')
      : '';
  return new RunError(
    'converter-error',
    cut(
      `run ${run}: ${typeof message === 'string' ? message : 'the converter failed'}${at === '' ? '' : ` (${at})`}`,
    ),
  );
}

interface Prepared {
  /** The converter's text as the body of a function that returns its `convert`. */
  body: string;
  setup: vm.Script;
  runner: vm.Script;
}

/** Ends the converter's text: a last line comment cannot swallow it, a function body may return. */
const RETURN_CONVERT = "\nreturn typeof convert === 'function' ? convert : undefined;\n";

/** The converter compiled in `context` (a compile error thrown here, by this realm). */
function compileConverter(body: string, context: vm.Context): unknown {
  return vm.compileFunction(body, [], { filename: CONVERTER_FILE, parsingContext: context });
}

/**
 * A compile error of the converter, told with its line: an error of this
 * realm (the converter's text compiled as a script, which runs nothing), or
 * one of the context, read as plain data only.
 */
function compileError(err: unknown): RunError {
  const own = err instanceof Error;
  const message = own ? err.message : ownData(err, 'message');
  const stack = own ? err.stack : ownData(err, 'stack');
  const line =
    typeof stack === 'string'
      ? stack.split('\n').find((l) => l.startsWith(`${CONVERTER_FILE}:`))
      : undefined;
  return new RunError(
    'converter-error',
    cut(
      `the converter does not compile: ${typeof message === 'string' ? message : 'a syntax error'}${line === undefined ? '' : ` (${line})`}`,
    ),
  );
}

/** What one run gave: the JSON text of `{result}`, the result, and what the converter read. */
export interface RunOutcome {
  text: string;
  value: unknown;
  reads: ChildReads;
  /** The files and entries read, sorted (see `Reads.list`). */
  read: readonly string[];
}

/** One run in a fresh context: the JSON text of `{result}` (validated as JSON), and what was read. */
function runOnce(
  prepared: Prepared,
  files: ReadonlyMap<string, LoadedFile>,
  inflated: Map<string, Uint8Array>,
  header: ChildHeader,
  inputJson: string,
  run: number,
): RunOutcome {
  const reads = new Reads();
  const context = vm.createContext(Object.create(null) as object, {
    name: `converter run ${run}`,
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: 'afterEvaluate',
  });
  let converter: unknown;
  try {
    converter = compileConverter(prepared.body, context);
  } catch (err) {
    throw compileError(err);
  }
  // set before any of the context's code ran: no setter of the converter's can see them
  const global = context as Record<string, unknown>;
  global[BRIDGE_GLOBAL] = bridgeFor(files, reads, inflated);
  global[INPUT_GLOBAL] = inputJson;
  global[CONVERTER_GLOBAL] = converter;
  prepared.setup.runInContext(context, { timeout: header.runMs });
  let text: unknown;
  try {
    text = prepared.runner.runInContext(context, { timeout: header.runMs });
  } catch (err) {
    throw thrown(err, run);
  }
  if (typeof text !== 'string') {
    throw new RunError('converter-error', `run ${run}: the runner gave no result`);
  }
  if (Buffer.byteLength(text, 'utf8') > header.outputBytes) {
    throw new RunError(
      'output-too-large',
      `run ${run}: the result has more than ${header.outputBytes} bytes of JSON`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RunError('converter-error', `run ${run}: the runner gave no result`);
  }
  const error = ownData(value, 'error');
  if (typeof error === 'string') throw new RunError('converter-error', cut(`run ${run}: ${error}`));
  if (ownData(value, 'result') === undefined) {
    throw new RunError('converter-error', `run ${run}: convert returned nothing`);
  }
  return {
    text,
    value: ownData(value, 'result'),
    reads: reads.summary(files.size),
    read: reads.list(),
  };
}

/** Where two results first differ, for the message. */
function firstDifference(a: unknown, b: unknown): string {
  const models = (v: unknown): unknown[] | null => {
    const m = ownData(v, 'models');
    return Array.isArray(m) ? m : null;
  };
  const ma = models(a);
  const mb = models(b);
  if (ma !== null && mb !== null) {
    if (ma.length !== mb.length) return `the number of models (${ma.length}, ${mb.length})`;
    const i = ma.findIndex((m, k) => JSON.stringify(m) !== JSON.stringify(mb[k]));
    if (i >= 0) return `models[${i}]`;
  }
  for (const key of ['systemVersion', 'skipped']) {
    if (JSON.stringify(ownData(a, key)) !== JSON.stringify(ownData(b, key))) return key;
  }
  return 'the result';
}

/**
 * Why two runs disagree, or `null`: their results as JSON text, or the files
 * and entries they read. A converter in this context has no clock, no
 * randomness and no weak references, and the runs share nothing; what can
 * still differ is, for example, how deep a recursion gets before the stack
 * overflows (the two runs' code is compiled differently), and whatever that
 * list misses.
 */
export function compareRuns(first: RunOutcome, second: RunOutcome): RunError | null {
  if (first.text !== second.text) {
    return new RunError(
      'not-deterministic',
      `the converter is not deterministic: run 1 and run 2 differ in ${firstDifference(first.value, second.value)}`,
    );
  }
  if (JSON.stringify(first.read) !== JSON.stringify(second.read)) {
    return new RunError(
      'not-deterministic',
      'the converter is not deterministic: run 1 and run 2 read different files',
    );
  }
  return null;
}

/** Runs the converter of `header` on `files` twice; the result when both runs agree. */
export function runConverter(
  header: ChildHeader,
  files: ReadonlyMap<string, LoadedFile>,
): { reads: ChildReads; result: unknown } {
  // compiled once as a script of this realm, for its syntax errors (it never runs)
  try {
    new vm.Script(header.converter, { filename: CONVERTER_FILE });
  } catch (err) {
    throw compileError(err);
  }
  const prepared: Prepared = {
    body: `${header.converter}${RETURN_CONVERT}`,
    setup: new vm.Script(innerSource(), { filename: 'analyzr-helpers.js' }),
    runner: new vm.Script(`${RUN_GLOBAL}();`, { filename: 'analyzr-run.js' }),
  };
  const inputJson = JSON.stringify({
    files: header.files.map((f) => ({
      path: f.path,
      size: f.size,
      sha256: f.sha256,
      zip:
        f.zip === null
          ? null
          : {
              entries: f.zip.entries.map((e) => ({ name: e.name, size: e.size })),
              error: f.zip.error,
            },
      unread: f.unread,
    })),
  });
  const inflated = new Map<string, Uint8Array>();
  const first = runOnce(prepared, files, inflated, header, inputJson, 1);
  const second = runOnce(prepared, files, inflated, header, inputJson, 2);
  const differ = compareRuns(first, second);
  if (differ !== null) throw differ;
  return { reads: first.reads, result: first.value };
}

/** Splits the parent's stdin into the header and the files. */
export function readPayload(payload: Uint8Array): {
  header: ChildHeader;
  files: Map<string, LoadedFile>;
} {
  if (payload.length < 4) throw new RunError('input', 'no input');
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const headerLength = view.getUint32(0, false);
  if (4 + headerLength > payload.length) throw new RunError('input', 'the input is incomplete');
  const header = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(payload.subarray(4, 4 + headerLength)),
  ) as ChildHeader;
  const files = new Map<string, LoadedFile>();
  let offset = 4 + headerLength;
  for (const f of header.files) {
    const size = f.unread === null ? f.size : 0;
    if (offset + size > payload.length) throw new RunError('input', 'the input is incomplete');
    files.set(f.path, {
      ...f,
      bytes: payload.subarray(offset, offset + size),
      entries: new Map((f.zip?.entries ?? []).map((e) => [e.name, e])),
    });
    offset += size;
  }
  if (offset !== payload.length) throw new RunError('input', 'the input has extra bytes');
  return { header, files };
}

async function readStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
    length += chunk.length;
    if (length > MAX_INPUT_BYTES) throw new RunError('input', 'too much input');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

/** `analyzr-convert __child`: refuses outside its sandbox, else runs and replies on stdout. */
export async function childMain(): Promise<void> {
  const problem = sandboxProblem({
    script: process.argv[1] ?? '',
    execArgv: process.execArgv,
    env: process.env,
    permission: (process as { permission?: { has(scope: string, reference?: string): boolean } })
      .permission,
  });
  if (problem !== null) {
    process.stderr.write(
      `analyzr-convert __child: internal, started by convert; refuses to run outside its sandbox: ${problem}\n`,
    );
    process.exitCode = 2;
    return;
  }
  let reply: ChildReply;
  try {
    const { header, files } = readPayload(await readStdin());
    const { reads, result } = runConverter(header, files);
    reply = { status: 'ok', reads, result };
  } catch (err) {
    reply =
      err instanceof RunError
        ? { status: 'error', code: err.code, message: err.message }
        : {
            status: 'error',
            code: 'input',
            // nothing of the context reaches here: its errors became RunErrors
            message: cut(err instanceof Error ? err.message : 'the run failed'),
          };
  }
  process.stdout.write(`${JSON.stringify(reply)}\n`, () => process.exit(0));
}
