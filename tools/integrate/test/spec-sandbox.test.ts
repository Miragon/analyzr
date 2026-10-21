// The converter runner's sandbox (src/spec/child.ts, inner.ts, sandbox.ts; M6 S3c §4.3): every
// known escape fails inside the converter's context (constructor chains over each helper, its
// errors and its data; process, require, getBuiltinModule, eval and the other function
// constructors; Error.prepareStackTrace frames; Atomics and SharedArrayBuffer), the run's time
// and output limits hold (endless loops, endless promise jobs, jobs after the run, huge results),
// the determinism guards throw, the child refuses to run outside its sandbox, nothing of the
// parent's environment reaches it, no connection is made, and a symbolic link in the export is
// never read.
import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import {
  compareRuns,
  RunError,
  runConverter,
  sourceIdOf,
  SOURCE_ID_MAX,
  type LoadedFile,
} from '../src/spec/child.ts';
import { ConvertError, CONVERT_LIMITS, runChild } from '../src/spec/converter.ts';
import {
  BRIDGE_GLOBAL,
  CONVERTER_GLOBAL,
  INPUT_GLOBAL,
  innerSource,
  RUN_GLOBAL,
} from '../src/spec/inner.ts';
import {
  CHILD_ENV,
  childFlags,
  readGrant,
  sandboxProblem,
  type ChildHeader,
} from '../src/spec/sandbox.ts';
import { MAX_SOURCE_LENGTH } from '../src/spec/validate.ts';

import {
  CONVERT_ENTRY,
  converter,
  convertCli,
  convertWith,
  plainExport,
  probeConverter,
  probeLines,
  refusal,
  workspace,
} from './converter-support.ts';
import { PACKAGE_ROOT, tempDir } from './support.ts';
import { zipOf } from './zip-writer.ts';

const execFileAsync = promisify(execFile);

// Each test starts real child processes; a loaded CI machine may take a while.
vi.setConfig({ testTimeout: 60_000 });
/** The probes of one escape run, each by name (see probeConverter). */
async function probes(body: string, files: Record<string, string | Uint8Array> = { 'a.txt': 'a' }) {
  const ws = await workspace();
  const conv = await converter(ws, 'probe.js', probeConverter(body));
  const result = await convertWith(ws, await plainExport(ws, files), conv);
  return Object.fromEntries(
    probeLines(result).map((line) => {
      const at = line.search(/ -> | threw /);
      return [line.slice(0, at), line.slice(at + 1)];
    }),
  );
}

describe('the converter context', () => {
  it('holds no way out: every constructor chain ends in EvalError, no host global is there', async () => {
    const seen = await probes(`
  const codegen = (v) => v.constructor.constructor('return process')();
  probe('helpers.text', () => helpers.text.constructor('return process')());
  probe('helpers.bytes', () => helpers.bytes.constructor('return process')());
  probe('helpers.xml', () => helpers.xml.constructor('return process')());
  probe('helpers.sourceId', () => helpers.sourceId.constructor('return process')());
  probe('helpers', () => codegen(helpers));
  probe('helper error', () => { try { helpers.text('no/such/file'); } catch (e) { return codegen(e); } });
  probe('helper error is inner', () => { try { helpers.text('no/such/file'); } catch (e) { return Object.getPrototypeOf(e) === Error.prototype; } });
  probe('helper type error', () => { try { helpers.text({ toString() { return 'a.txt'; } }); } catch (e) { return codegen(e); } });
  probe('input', () => codegen(input));
  probe('input.files', () => codegen(input.files));
  probe('xml tree', () => codegen(helpers.xml('<a b="c"/>').root));
  probe('bytes', () => codegen(helpers.bytes('a.txt')));
  probe('this', () => (function () { return this; })().constructor.constructor('return process')());
  probe('globalThis', () => codegen(globalThis));
  probe('global prototype', () => codegen(Object.getPrototypeOf(globalThis)));
  probe('async function', () => (async function () {}).constructor('return process'));
  probe('generator', () => (function* () {}).constructor('return process'));
  probe('async generator', () => (async function* () {}).constructor('return process'));
  probe('eval', () => eval('1 + 1'));
  probe('indirect eval', () => (0, eval)('1 + 1'));
  probe('Function', () => Function('return 1')());
  probe('process', () => process.pid);
  probe('getBuiltinModule', () => process.getBuiltinModule('node:net'));
  probe('require', () => require('node:net'));
  probe('Atomics.wait', () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0));
  probe('WebAssembly', () => new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }));
  probe('globals', () => [process, require, module, Buffer, fetch, setTimeout, setImmediate, queueMicrotask, structuredClone, WebAssembly, Atomics, SharedArrayBuffer, WeakRef, FinalizationRegistry].length);
  probe('typeof globals', () => [typeof process, typeof require, typeof module, typeof Buffer, typeof fetch, typeof setTimeout, typeof queueMicrotask, typeof structuredClone, typeof WebAssembly, typeof Atomics, typeof SharedArrayBuffer, typeof WeakRef, typeof FinalizationRegistry, typeof ${BRIDGE_GLOBAL}, typeof ${INPUT_GLOBAL}, typeof ${CONVERTER_GLOBAL}].join(','));
  probe('runner fixed', () => { globalThis.${RUN_GLOBAL} = () => '{"result":{"models":[]}}'; return typeof globalThis.${RUN_GLOBAL}; });
`);
    expect(seen).toEqual({
      'helpers.text': 'threw EvalError (inner)',
      'helpers.bytes': 'threw EvalError (inner)',
      'helpers.xml': 'threw EvalError (inner)',
      'helpers.sourceId': 'threw EvalError (inner)',
      helpers: 'threw EvalError (inner)',
      'helper error': 'threw EvalError (inner)',
      'helper error is inner': '-> true',
      'helper type error': 'threw EvalError (inner)',
      input: 'threw EvalError (inner)',
      'input.files': 'threw EvalError (inner)',
      'xml tree': 'threw EvalError (inner)',
      bytes: 'threw EvalError (inner)',
      this: 'threw EvalError (inner)',
      globalThis: 'threw EvalError (inner)',
      'global prototype': 'threw EvalError (inner)',
      'async function': 'threw EvalError (inner)',
      generator: 'threw EvalError (inner)',
      'async generator': 'threw EvalError (inner)',
      eval: 'threw EvalError (inner)',
      'indirect eval': 'threw EvalError (inner)',
      Function: 'threw EvalError (inner)',
      process: 'threw ReferenceError (inner)',
      getBuiltinModule: 'threw ReferenceError (inner)',
      require: 'threw ReferenceError (inner)',
      'Atomics.wait': 'threw ReferenceError (inner)',
      WebAssembly: 'threw ReferenceError (inner)',
      globals: 'threw ReferenceError (inner)',
      'typeof globals': `-> ${Array(16).fill('undefined').join(',')}`,
      // the runner is a fixed property of the context: the converter cannot replace it
      'runner fixed': '-> function',
    });
  });

  it('gives Error.prepareStackTrace frames whose this and function lead nowhere', async () => {
    const seen = await probes(`
  const reached = [];
  const install = () => {
    Error.prepareStackTrace = (error, frames) => {
      for (const f of frames) {
        for (const v of [f.getThis(), f.getFunction()]) {
          if (v === undefined || v === null) continue;
          try {
            const p = v.constructor.constructor('return process')();
            reached.push(p !== null && typeof p === 'object' && typeof p.pid === 'number' ? 'ESCAPED' : 'other');
          } catch (e) {
            reached.push(e instanceof Error ? e.constructor.name : 'FOREIGN');
          }
        }
      }
      return 'frames: ' + frames.length;
    };
  };
  install();
  probe('own error', () => new Error('x').stack);
  probe('helper error', () => { try { helpers.text('no/such/file'); } catch (e) { return e.stack; } });
  probe('xml error', () => { try { helpers.xml('<a>'); } catch (e) { return e.stack; } });
  probe('overflow', () => { try { (function r() { r(); })(); } catch (e) { return e instanceof RangeError; } });
  Error.prepareStackTrace = undefined;
  probe('reached', () => [...new Set(reached)].sort().join(',') + ' of ' + reached.length);
`);
    expect(seen).toMatchObject({
      'own error': expect.stringMatching(/^-> frames: \d+$/) as unknown,
      'helper error': expect.stringMatching(/^-> frames: \d+$/) as unknown,
      'xml error': expect.stringMatching(/^-> frames: \d+$/) as unknown,
      overflow: '-> true',
    });
    // every frame that hands out its this or function is one of the context's: EvalError
    expect(seen['reached']).toMatch(/^-> EvalError of [1-9]\d*$/);
  });

  it('keeps time and determinism: endless loops and promise jobs time out, jobs after the run change nothing, the clock and randomness throw', async () => {
    const ws = await workspace();
    const exported = await plainExport(ws, { 'a.txt': 'a' });
    const limits = { runMs: 1000 };
    for (const [name, source] of [
      ['top level', 'for (;;) {}\nfunction convert() {}\n'],
      ['convert', 'function convert() { for (;;) {} }\n'],
      [
        'promise jobs',
        'function convert() { const spin = () => Promise.resolve().then(spin); spin(); return { models: [] }; }\n',
      ],
      [
        'await loop',
        'function convert() { (async () => { for (;;) await null; })(); return { models: [] }; }\n',
      ],
    ] as const) {
      const conv = await converter(ws, 'loop.js', source);
      const err = await refusal(convertWith(ws, exported, conv, { limits }));
      expect(err.code, name).toBe('timeout');
      expect(err.message, name).toMatch(
        /run 1: the converter did not finish in time \(an endless loop, or too much work for one run\)$/,
      );
    }
    // a job queued by convert runs after its result was written
    const late = await converter(
      ws,
      'late.js',
      "function convert() { const result = { models: [], skipped: [] }; Promise.resolve().then(() => { result.skipped.push({ path: 'spät', reason: 'nach dem Lauf' }); }); return result; }\n",
    );
    expect((await convertWith(ws, exported, late)).record.skipped).toEqual([]);

    const seen = await probes(`
  probe('Date.now', () => Date.now());
  probe('new Date', () => new Date());
  probe('Date()', () => Date());
  probe('Math.random', () => Math.random());
  probe('Intl format', () => new Intl.DateTimeFormat('de-DE').format());
  probe('Intl formatToParts', () => new Intl.DateTimeFormat('de-DE').formatToParts().length);
  probe('a given date', () => new Date('2026-10-14').toISOString());
  probe('a given date formatted', () => new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC' }).format(new Date(0)));
  probe('the time zone', () => new Date(0).getTimezoneOffset() + ' ' + new Date('2026-10-14T00:00:00').toISOString());
  probe('instanceof', () => new Date(0) instanceof Date);
`);
    expect(seen).toEqual({
      'Date.now': 'threw Error (inner)',
      'new Date': 'threw Error (inner)',
      'Date()': 'threw Error (inner)',
      'Math.random': 'threw Error (inner)',
      'Intl format': 'threw Error (inner)',
      'Intl formatToParts': 'threw Error (inner)',
      'a given date': '-> 2026-10-14T00:00:00.000Z',
      'a given date formatted': '-> 1.1.1970',
      'the time zone': '-> 0 2026-10-14T00:00:00.000Z',
      instanceof: '-> true',
    });
    const clock = await converter(
      ws,
      'clock.js',
      'function convert() { return { models: [], systemVersion: String(Date.now()) }; }\n',
    );
    const clockOut = path.join(ws, 'specs', 'clock');
    expect((await refusal(convertWith(ws, exported, clock, { out: clockOut }))).message).toMatch(
      /run 1: Error: Date\.now\(\) reads the clock: a converter gives the same result on every run/,
    );
  });

  it('caps the result', async () => {
    const ws = await workspace();
    const conv = await converter(
      ws,
      'huge.js',
      "function convert() { return { models: [], systemVersion: 'v'.repeat(2000000) }; }\n",
    );
    const err = await refusal(
      convertWith(ws, await plainExport(ws, { 'a.txt': 'a' }), conv, {
        limits: { outputBytes: 1_000_000 },
      }),
    );
    expect(err.code).toBe('output-too-large');
    expect(err.message).toMatch(/run 1: the result has more than 1000000 bytes of JSON$/);
  });

  it('keeps what the bridge throws or returns outside the context: every helper error is its own', () => {
    // the helpers' only way out is the bridge; whatever it throws (a host error, here a
    // RangeError of this realm, as a stack overflow inside it would be) or returns that is no
    // string never reaches the converter: it gets an Error of its own context
    const helperErrors = (bridge: (...args: unknown[]) => unknown) => {
      const context = vm.createContext(Object.create(null) as object, {
        codeGeneration: { strings: false, wasm: false },
      });
      const converterFn = vm.compileFunction(
        `function convert(input, helpers) {
  const seen = [];
  globalThis.caught = [];
  for (const [name, call] of [
    ['text', () => helpers.text('a.txt')],
    ['bytes', () => helpers.bytes('a.txt', 'teil.xml')],
    ['xml', () => helpers.xml('<a/>')],
    ['sourceId', () => helpers.sourceId('p1', 7)],
  ]) {
    try {
      call();
      seen.push(name + ': no error');
    } catch (e) {
      globalThis.caught.push(e);
      seen.push(name + ': ' + (Object.getPrototypeOf(e) === Error.prototype ? 'inner' : 'FOREIGN') + ' ' + e.message);
    }
  }
  return { models: [], seen };
}
return convert;`,
        [],
        { parsingContext: context },
      );
      const global = context as Record<string, unknown>;
      global[BRIDGE_GLOBAL] = bridge;
      global[INPUT_GLOBAL] = '{"files":[]}';
      global[CONVERTER_GLOBAL] = converterFn;
      vm.runInContext(innerSource(), context);
      const text = vm.runInContext(`${RUN_GLOBAL}()`, context) as string;
      const innerError = vm.runInContext('Error.prototype', context) as object;
      // the host's view of the caught errors: each an Error of the context, none of this realm
      const caught = global['caught'] as object[];
      expect(caught.every((e) => Object.getPrototypeOf(e) === innerError)).toBe(true);
      expect(caught.some((e) => e instanceof Error)).toBe(false);
      return (JSON.parse(text) as { result: { seen: string[] } }).result.seen;
    };
    const failedAll = [
      'text: inner helpers.text failed',
      'bytes: inner helpers.bytes failed',
      'xml: inner helpers.xml failed',
      'sourceId: inner helpers.sourceId failed',
    ];
    expect(
      helperErrors(() => {
        throw new RangeError('Maximum call stack size exceeded');
      }),
    ).toEqual(failedAll);
    expect(helperErrors(() => ({ toString: () => '=x' }))).toEqual(failedAll);
    expect(helperErrors(() => '')).toEqual(failedAll);
    expect(helperErrors(() => '!kein Zugriff')).toEqual([
      'text: inner kein Zugriff',
      'bytes: inner kein Zugriff',
      'xml: inner kein Zugriff',
      'sourceId: inner kein Zugriff',
    ]);
  });

  it('runs the converter twice and refuses two runs that differ in their result or in what they read', () => {
    const header = (converter: string, paths: string[]): ChildHeader => ({
      converter,
      files: paths.map((p) => ({ path: p, size: 1, sha256: null, zip: null, unread: null })),
      runMs: 10_000,
      outputBytes: 1_000_000,
    });
    /** Files whose bytes are `first` on their first read and `later` after (no honest export does this). */
    const changing = (paths: string[], first: string, later: string): Map<string, LoadedFile> => {
      const count = new Map<string, number>();
      return new Map(
        paths.map((p) => [
          p,
          {
            path: p,
            size: 1,
            sha256: null,
            zip: null,
            unread: null,
            entries: new Map(),
            get bytes() {
              count.set(p, (count.get(p) ?? 0) + 1);
              return new TextEncoder().encode(count.get(p) === 1 ? first : later);
            },
          },
        ]),
      );
    };
    const fails = (run: () => unknown): RunError => {
      try {
        run();
      } catch (e) {
        if (e instanceof RunError) return e;
        throw e;
      }
      throw new Error('expected a RunError');
    };
    const same =
      'function convert(input, helpers) { return { models: [], systemVersion: helpers.text("a.txt") }; }';
    expect(runConverter(header(same, ['a.txt']), changing(['a.txt'], 'a', 'a'))).toEqual({
      reads: { files: 1, of: 1, entries: 0 },
      result: { models: [], systemVersion: 'a' },
    });
    const differ = fails(() =>
      runConverter(header(same, ['a.txt']), changing(['a.txt'], 'a', 'b')),
    );
    expect([differ.code, differ.message]).toEqual([
      'not-deterministic',
      'the converter is not deterministic: run 1 and run 2 differ in systemVersion',
    ]);
    // the same result and as many files read, but other files
    const other =
      'function convert(input, helpers) { helpers.text(helpers.text("a.txt") === "a" ? "b.txt" : "c.txt"); return { models: [] }; }';
    const read = fails(() =>
      runConverter(
        header(other, ['a.txt', 'b.txt', 'c.txt']),
        changing(['a.txt', 'b.txt', 'c.txt'], 'a', 'x'),
      ),
    );
    expect([read.code, read.message]).toEqual([
      'not-deterministic',
      'the converter is not deterministic: run 1 and run 2 read different files',
    ]);
  });

  it('compares both runs: their results and what they read', () => {
    const run = (text: string, read = ['a.txt']) => ({
      text,
      value: (JSON.parse(text) as { result: unknown }).result,
      reads: { files: read.length, of: 2, entries: 0 },
      read,
    });
    expect(
      compareRuns(run('{"result":{"models":[1]}}'), run('{"result":{"models":[1]}}')),
    ).toBeNull();
    expect(
      compareRuns(run('{"result":{"models":[1,2]}}'), run('{"result":{"models":[1,3]}}'))?.message,
    ).toBe('the converter is not deterministic: run 1 and run 2 differ in models[1]');
    expect(
      compareRuns(run('{"result":{"models":[1]}}'), run('{"result":{"models":[1,2]}}'))?.message,
    ).toBe(
      'the converter is not deterministic: run 1 and run 2 differ in the number of models (1, 2)',
    );
    expect(
      compareRuns(
        run('{"result":{"models":[],"systemVersion":"a"}}'),
        run('{"result":{"models":[],"systemVersion":"b"}}'),
      )?.message,
    ).toMatch(/differ in systemVersion$/);
    expect(
      compareRuns(run('{"result":{"models":[]}}'), run('{"result":{"models":[]}}', ['b.txt']))
        ?.message,
    ).toBe('the converter is not deterministic: run 1 and run 2 read different files');
  });

  it("stops a child that outlives the run's time or writes more than a result can be", async () => {
    // the parent's own guards, for what the child's limits cannot catch (native work, a broken child)
    const ws = await workspace();
    const exported = await plainExport(ws, { 'a.txt': 'a' });
    const loop = await converter(ws, 'endlos.js', 'function convert() { for (;;) {} }\n');
    const err = await refusal(
      convertWith(ws, exported, loop, { limits: { runMs: 30_000, childMs: 1500 } }),
    );
    expect([err.code, err.message]).toEqual([
      'timeout',
      'the converter did not finish within 2 s: the run was stopped',
    ]);
    // the real path: the permission model grants a path, and Node opens the script by its real one
    const standIn = path.join(await realpath(await tempDir()), 'stand-in.mjs');
    await writeFile(
      standIn,
      "process.stdout.write('x'.repeat(3 * 1024 * 1024));\nsetTimeout(() => undefined, 30_000);\n",
    );
    const flood = await runChild(
      { converter: '', files: [], runMs: 1000, outputBytes: 1000 },
      [],
      { ...CONVERT_LIMITS, heapMb: 256, outputBytes: 1000, childMs: 30_000 },
      standIn,
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(flood).toBeInstanceOf(ConvertError);
    expect([(flood as ConvertError).code, (flood as ConvertError).message]).toEqual([
      'output-too-large',
      "the converter's result has more than 1000 bytes of JSON: the run was stopped",
    ]);
  });
});

describe('what the converter sees of the export', () => {
  it('gives files, zip entries and XML as plain data, and counts what it read', async () => {
    const eins = new TextEncoder().encode(
      '<?xml version="1.0"?>\n<!DOCTYPE x [<!ENTITY e "E">]><wurzel xmlns:v="urn:v" a="1" __proto__="p"><v:kind>Text &amp; &e;<i/>mehr</v:kind></wurzel>',
    );
    const zip = zipOf([
      { name: 'teil/eins.xml', data: eins },
      { name: 'teil/zwei.bin', data: new Uint8Array([0, 1, 255]), method: 0 },
      { name: 'leer/', data: new Uint8Array() },
    ]);
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('<?xml version="1.0" encoding="UTF-16"?><x>ä</x>', 'utf16le'),
    ]);
    const seen = await probes(
      `
  probe('files', () => JSON.stringify(input.files.map((f) => [f.path, f.size, f.sha256.length, f.zip && f.zip.entries])));
  const tree = helpers.xml(helpers.text('archiv.zip', 'teil/eins.xml')).root;
  probe('tree', () => JSON.stringify([tree.name, tree.local, tree.ns, Object.keys(tree.attrs), tree.attrs.__proto__, tree.children[0].name, tree.children[0].ns, tree.children[0].text, tree.children[0].children[0].name]));
  probe('mixed content', () => JSON.stringify(helpers.xml('<t>Auftrag <fld IX="0">4711</fld> prüfen &amp; <b>sofort</b> senden<![CDATA[!]]></t>').root.content));
  probe('bytes', () => Array.from(helpers.bytes('archiv.zip', 'teil/zwei.bin')).join(','));
  probe('utf16', () => helpers.text('utf16.xml'));
  probe('no entry', () => helpers.text('archiv.zip', 'fehlt.xml'));
  probe('no zip', () => helpers.text('utf16.xml', 'x'));
  probe('bad xml', () => helpers.xml('<a><b></a>'));
  probe('bad xml message', () => { try { helpers.xml('<a><b></a>'); } catch (e) { return e.message; } });
  probe('sourceId', () => helpers.sourceId('p1', 7, 's\\u0001x'));
  probe('sourceId bad', () => helpers.sourceId('p1', {}));
`,
      { 'archiv.zip': zip, 'utf16.xml': utf16 },
    );
    expect(seen).toEqual({
      files: `-> ${JSON.stringify([
        [
          'archiv.zip',
          zip.length,
          64,
          [
            { name: 'teil/eins.xml', size: eins.length },
            { name: 'teil/zwei.bin', size: 3 },
          ],
        ],
        ['utf16.xml', utf16.length, 64, null],
      ])}`,
      tree: `-> ${JSON.stringify(['wurzel', 'wurzel', null, ['xmlns:v', 'a', '__proto__'], 'p', 'v:kind', 'urn:v', 'Text & &e;mehr', 'i'])}`,
      // text runs and child elements in document order (child elements by their index)
      'mixed content': `-> ${JSON.stringify(['Auftrag ', 0, ' prüfen & ', 1, ' senden', '!'])}`,
      bytes: '-> 0,1,255',
      utf16: '-> <?xml version="1.0" encoding="UTF-16"?><x>ä</x>',
      'no entry': 'threw Error (inner)',
      'no zip': 'threw Error (inner)',
      'bad xml': 'threw Error (inner)',
      'bad xml message':
        '-> not well-formed XML: closing tag </a> does not match <b> (line 1, column 7)',
      sourceId: '-> p1-7-s_x',
      'sourceId bad': 'threw Error (inner)',
    });
  });

  it('never sees a symbolic link of the export, nor anything outside it', async () => {
    const ws = await workspace();
    const outside = path.join(ws, 'reports', 'geheim.txt');
    await writeFile(outside, 'GEHEIM-7f3a\n');
    const exported = await plainExport(ws, { 'a.txt': 'a' });
    await symlink(outside, path.join(exported, 'link.txt'));
    await mkdir(path.join(exported, '.versteckt'));
    await writeFile(path.join(exported, '.versteckt', 'b.txt'), 'b');
    const conv = await converter(
      ws,
      'links.js',
      probeConverter(`
  probe('files', () => input.files.map((f) => f.path).join(','));
  probe('link', () => helpers.text('link.txt'));
  probe('up', () => helpers.text('../../reports/geheim.txt'));
  probe('absolute', () => helpers.text(${JSON.stringify(outside)}));
`),
    );
    const result = await convertWith(ws, exported, conv);
    expect(probeLines(result)).toEqual([
      'files -> a.txt',
      'link threw Error (inner)',
      'up threw Error (inner)',
      'absolute threw Error (inner)',
    ]);
    expect(result.record).toMatchObject({
      symlinksSkipped: 1,
      hiddenSkipped: 1,
      reads: { files: 0, of: 1 },
    });
    expect(JSON.stringify(result.record)).not.toContain('GEHEIM');
  });

  it('gives an archive that fails a guard unopened, with the reason, and a damaged entry as an error', async () => {
    const bomb = zipOf([{ name: 'gross.xml', data: new Uint8Array(4 * 1024 * 1024) }]);
    const damaged = Buffer.from(
      zipOf([{ name: 'a.xml', data: new TextEncoder().encode('<a/>'), method: 0 }]),
    );
    damaged[30 + 'a.xml'.length + 1] = 0x21; // `<!/>`: same size, other CRC
    const ws = await workspace();
    const conv = await converter(
      ws,
      'zips.js',
      probeConverter(`
  probe('bomb', () => JSON.stringify(input.files.find((f) => f.path === 'bombe.zip').zip));
  probe('bomb entry', () => helpers.text('bombe.zip', 'gross.xml'));
  probe('damaged', () => helpers.text('kaputt.zip', 'a.xml'));
  probe('damaged message', () => { try { helpers.text('kaputt.zip', 'a.xml'); } catch (e) { return e.message; } });
`),
    );
    const result = await convertWith(
      ws,
      await plainExport(ws, { 'bombe.zip': bomb, 'kaputt.zip': damaged }),
      conv,
    );
    const reason = result.record.zipRefused[0]?.reason ?? '';
    expect(reason).toMatch(/^the entry "gross\.xml" would grow \d{4} times \(at most 200\)$/);
    expect(probeLines(result)).toEqual([
      `bomb -> ${JSON.stringify({ entries: [], error: reason })}`,
      'bomb entry threw Error (inner)',
      'damaged threw Error (inner)',
      'damaged message -> the entry "a.xml" is damaged: its size or checksum differs from the archive\'s directory',
    ]);
    expect(result.record.zipRefused).toEqual([{ path: 'bombe.zip', reason }]);
  });
});

describe('the child outside its sandbox', () => {
  const grant = readGrant(CONVERT_ENTRY);
  const exact = childFlags(CONVERT_ENTRY, 256);
  async function child(flags: readonly string[], env: NodeJS.ProcessEnv, stdin = '') {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const p = execFile(
        process.execPath,
        [...flags, CONVERT_ENTRY, '__child'],
        { cwd: PACKAGE_ROOT, env },
        (err, stdout, stderr) => {
          resolve({
            code: err === null ? 0 : ((err as { code?: number }).code ?? null),
            stdout,
            stderr,
          });
        },
      );
      p.stdin?.end(stdin);
    });
  }

  it('refuses to run started by hand: without the permission model, other flags, another environment', async () => {
    const cases: [string, readonly string[], NodeJS.ProcessEnv, RegExp][] = [
      ['no sandbox', [], { ...CHILD_ENV }, /the permission model is not active/],
      [
        'no code generation flag',
        exact.filter((f) => f !== '--disallow-code-generation-from-strings'),
        { ...CHILD_ENV },
        /other Node flags/,
      ],
      ['a write grant', [...exact, '--allow-fs-write=/tmp'], { ...CHILD_ENV }, /other Node flags/],
      [
        'a wider read grant',
        ['--permission', '--allow-fs-read=*', ...exact.slice(2)],
        { ...CHILD_ENV },
        /other Node flags/,
      ],
      [
        'NODE_OPTIONS',
        exact,
        { ...CHILD_ENV, NODE_OPTIONS: '--allow-fs-write=/tmp' },
        /environment other than TZ=UTC/,
      ],
      [
        'a token',
        exact,
        { ...CHILD_ENV, ANALYZR_TOKEN: 'analyzr_at_geheim' },
        /environment other than TZ=UTC/,
      ],
      [
        'another zone',
        exact,
        { ...CHILD_ENV, TZ: 'Europe/Berlin' },
        /environment other than TZ=UTC/,
      ],
    ];
    for (const [name, flags, env, message] of cases) {
      const r = await child(flags, env);
      expect(r.code, name).toBe(2);
      expect(r.stdout, name).toBe('');
      expect(r.stderr, name).toMatch(
        /^analyzr-convert __child: internal, started by convert; refuses to run outside its sandbox: /,
      );
      expect(r.stderr, name).toMatch(message);
    }
    // in its sandbox, by hand, it reads stdin and gains nothing the parent would not give it
    const inside = await child(exact, { ...CHILD_ENV }, 'kein Protokoll');
    expect(inside.code).toBe(0);
    expect(JSON.parse(inside.stdout)).toMatchObject({ status: 'error', code: 'input' });
    expect(grant).toBe(path.join(PACKAGE_ROOT, 'src'));
  });

  it('checks its own sandbox', () => {
    const permission = (granted: readonly string[] = []) => ({
      has: (scope: string) => granted.includes(scope),
    });
    const script = '/plugin/scripts/analyzr-convert.mjs';
    const view = {
      script,
      execArgv: childFlags(script, 4096),
      env: { ...CHILD_ENV, __CF_USER_TEXT_ENCODING: '0x1F5:0x0:0x3' },
      permission: permission(),
    };
    expect(childFlags(script, 4096)).toEqual([
      '--permission',
      `--allow-fs-read=${script}`,
      '--disallow-code-generation-from-strings',
      '--max-old-space-size=4096',
    ]);
    expect(sandboxProblem(view)).toBeNull();
    expect(sandboxProblem({ ...view, permission: undefined })).toBe(
      'the permission model is not active',
    );
    expect(sandboxProblem({ ...view, execArgv: [...view.execArgv, '--allow-addons'] })).toMatch(
      /other Node flags/,
    );
    expect(
      sandboxProblem({ ...view, execArgv: childFlags('/other/analyzr-convert.mjs', 4096) }),
    ).toMatch(/other Node flags/);
    expect(sandboxProblem({ ...view, env: { ...CHILD_ENV, HOME: '/Users/x' } })).toMatch(
      /environment/,
    );
    expect(sandboxProblem({ ...view, env: { TZ: 'UTC', LANG: 'C' } })).toMatch(/environment/);
    expect(sandboxProblem({ ...view, permission: permission(['child', 'worker']) })).toBe(
      'the permission model grants child, worker',
    );
  });

  it('gets nothing of the parent environment: a token and NODE_OPTIONS stay outside', async () => {
    const ws = await workspace();
    const exported = await plainExport(ws, { 'a.txt': 'a' });
    const conv = await converter(
      ws,
      'env.js',
      probeConverter(`
  probe('anything named like the token', () => JSON.stringify(Object.getOwnPropertyNames(globalThis)).includes('geheim'));
`),
    );
    const out = path.join(ws, 'specs', 'env');
    const r = await convertCli(
      [
        'convert',
        exported,
        '--converter',
        conv.file,
        '--sha256',
        conv.sha256,
        '--derived',
        'converted',
        '--workspace',
        ws,
        '--out',
        out,
      ],
      {
        PATH: process.env['PATH'] ?? '',
        HOME: ws,
        ANALYZR_TOKEN: 'analyzr_at_geheim',
        // the parent runs under these; the child, started with its own environment, refuses NODE_OPTIONS
        NODE_OPTIONS: '--permission --allow-fs-read=* --allow-fs-write=* --allow-child-process',
      },
    );
    expect(r.code, r.stderr).toBe(0);
    const record = JSON.parse(await readFile(path.join(out, 'analyzr-specs.json'), 'utf8')) as {
      skipped: { reason: string }[];
    };
    expect(record.skipped.map((s) => s.reason)).toEqual(['anything named like the token -> false']);
  });

  it('makes no connection: a local listener counts none', async () => {
    let connections = 0;
    const server = net.createServer((socket) => {
      connections++;
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      const seen = await probes(`
  const url = 'http://127.0.0.1:${port}/';
  probe('fetch', () => fetch(url));
  probe('require', () => require('node:net').connect(${port}, '127.0.0.1'));
  probe('helper chain', () => helpers.text.constructor('return process')().getBuiltinModule('node:net').connect(${port}, '127.0.0.1'));
  probe('this chain', () => (function () { return this; })().constructor.constructor('return process')().getBuiltinModule('node:net'));
  probe('error chain', () => { try { helpers.text('x'); } catch (e) { return e.constructor.constructor('return globalThis.process')().getBuiltinModule('node:http').get(url); } });
  probe('WebSocket', () => new WebSocket('ws://127.0.0.1:${port}/'));
  probe('XMLHttpRequest', () => new XMLHttpRequest());
`);
      expect(
        Object.values(seen).every((v) => /^threw (EvalError|ReferenceError) \(inner\)$/.test(v)),
      ).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(connections).toBe(0);
    } finally {
      server.close();
    }
  });
});

describe('the runner parts', () => {
  it('build source ids from tool ids: control characters replaced, long ones cut with a hash', () => {
    expect(SOURCE_ID_MAX).toBe(MAX_SOURCE_LENGTH);
    expect(sourceIdOf('p0-s17')).toBe('p0-s17');
    expect(sourceIdOf('a\u0000b\ud800c')).toBe('a_b_c');
    const long = sourceIdOf('x'.repeat(300));
    expect(long).toHaveLength(200);
    expect(long).toMatch(/^x{187}-[0-9a-f]{12}$/);
    expect(sourceIdOf('x'.repeat(300))).toBe(long);
    expect(sourceIdOf('x'.repeat(301))).not.toBe(long);
  });

  it('hand the context its globals by the names the inner code takes', () => {
    const source = innerSource();
    expect(source.startsWith("'use strict';\n(function inner()")).toBe(true);
    for (const name of [BRIDGE_GLOBAL, INPUT_GLOBAL, CONVERTER_GLOBAL, RUN_GLOBAL]) {
      expect(source).toMatch(new RegExp(`["']${name}["']`));
    }
    // nothing of the module leaks into it: the text names no import and no module binding
    expect(source).not.toMatch(/\bimport\b|__vite|require\(/);
  });

  it('prints its usage, naming the internal child command', async () => {
    const dir = await tempDir();
    const { stdout } = await execFileAsync(process.execPath, [CONVERT_ENTRY, '--help'], {
      cwd: dir,
      env: { PATH: process.env['PATH'] ?? '' },
    });
    expect(stdout).toMatch(/^Usage:\n {2}node analyzr-convert\.mjs convert <export>/);
    expect(stdout).toMatch(
      /node analyzr-convert\.mjs __child {5}internal: started by convert, refuses to run otherwise/,
    );
  });
});
