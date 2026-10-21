/**
 * What a converter's context runs before the converter (M6 S3c §4.2, §4.3):
 * the helpers, the determinism guards and the runner. {@link inner} is never
 * called in this realm: the child evaluates {@link innerSource}, its text, in
 * every fresh context, so each helper, error and result is an object of that
 * context, and nothing the converter can reach leads back to the child's
 * own objects. The function therefore uses no import and no name of this
 * module, only what every context has (`JSON`, `Error`, `Object`, …).
 *
 * The child puts three values on the context's global before: the bridge (a
 * function of the child taking and returning strings only), the input as
 * JSON text, and the converter, compiled in this context as the body of a
 * function that returns its `convert`. `inner` takes them into its closure
 * and deletes them before any converter code runs, so the converter's top
 * level, like its `convert`, runs inside the runner's `try` and within the
 * run's time limit, and its declarations stay its own: it cannot shadow the
 * runner. The bridge's replies are strings: `=` and
 * the value (a file's text, its bytes as latin1, an XML tree as JSON, a
 * source id), or `!` and an error message that becomes an `Error` of the
 * context; anything the bridge throws is dropped unseen.
 *
 * The guards catch honest mistakes, not attacks: `Date.now()`, `new Date()`
 * and `Date()` without an argument, `Math.random()` and
 * `Intl.DateTimeFormat().format()` without a date throw; `Atomics`,
 * `SharedArrayBuffer`, `WebAssembly`, `WeakRef` and `FinalizationRegistry`
 * are removed (waits, and callbacks after the run). The runner is
 * `__analyzrRun()`: it runs the converter's top level, calls its
 * `convert(input, helpers)` and returns the result as JSON text written by
 * this context's own `JSON.stringify`, or an error as `{"error": …}`.
 */

/** The functions a converter gets as `helpers`. */
export interface ConverterHelpers {
  text(path: string, entry?: string): string;
  bytes(path: string, entry?: string): Uint8Array;
  xml(text: string): { root: unknown };
  sourceId(...parts: (string | number)[]): string;
}

/** The global names the child sets before {@link innerSource} runs, and the runner's name. */
export const BRIDGE_GLOBAL = '__analyzrBridge';
export const INPUT_GLOBAL = '__analyzrInput';
export const CONVERTER_GLOBAL = '__analyzrConverter';
export const RUN_GLOBAL = '__analyzrRun';

/** Evaluated inside each context only (see the module comment). */
export function inner(): void {
  const G = globalThis as unknown as Record<string, unknown>;
  const bridge = G['__analyzrBridge'] as (op: string, a: string, b: string) => unknown;
  const inputText = G['__analyzrInput'] as string;
  const converter = G['__analyzrConverter'];
  delete G['__analyzrBridge'];
  delete G['__analyzrInput'];
  delete G['__analyzrConverter'];

  // Taken before the converter runs, so a converter that replaces them harms only its own run.
  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const InnerError = Error;
  const Bytes = Uint8Array;
  const define = Object.defineProperty;
  const describeProperty = Object.getOwnPropertyDescriptor;
  const freeze = Object.freeze;
  const construct = Reflect.construct;
  const finite = Number.isFinite;

  const fail = (message: string): Error => new InnerError(message);

  const ask = (op: string, a: string, b: string): string => {
    let reply: unknown;
    try {
      reply = bridge(op, a, b);
    } catch {
      reply = undefined;
    }
    if (typeof reply !== 'string' || reply === '') throw fail(`helpers.${op} failed`);
    if (reply[0] === '!') throw fail(reply.slice(1));
    return reply.slice(1);
  };

  const fileArgs = (name: string, file: unknown, entry: unknown): [string, string] => {
    if (typeof file !== 'string') {
      throw fail(`helpers.${name}(path, entry): path is the path of one of input.files`);
    }
    if (entry === undefined || entry === null) return [file, ''];
    if (typeof entry !== 'string' || entry === '') {
      throw fail(
        `helpers.${name}(path, entry): entry is the name of one of the file's zip.entries`,
      );
    }
    return [file, entry];
  };

  const helpers = freeze({
    text: (file: unknown, entry?: unknown): string => {
      const [f, e] = fileArgs('text', file, entry);
      return ask('text', f, e);
    },
    bytes: (file: unknown, entry?: unknown): Uint8Array => {
      const [f, e] = fileArgs('bytes', file, entry);
      const latin1 = ask('bytes', f, e);
      const out = new Bytes(latin1.length);
      for (let i = 0; i < latin1.length; i++) out[i] = latin1.charCodeAt(i);
      return out;
    },
    xml: (text: unknown): unknown => {
      if (typeof text !== 'string')
        throw fail('helpers.xml(text): text is a string (helpers.text gives one)');
      return parse(ask('xml', text, '')) as unknown;
    },
    sourceId: (...parts: unknown[]): string => {
      if (parts.length === 0)
        throw fail('helpers.sourceId(...parts): name the tool ids it is made of');
      const texts: string[] = [];
      for (const part of parts) {
        if (typeof part === 'number' && finite(part)) texts.push(String(part));
        else if (typeof part === 'string' && part !== '') texts.push(part);
        else {
          throw fail(
            'helpers.sourceId(...parts): every part is a tool id: a non-empty string or a number',
          );
        }
      }
      return ask('sourceId', texts.join('-'), '');
    },
  });

  // Determinism guards.
  const clock = (what: string): Error =>
    fail(
      `${what} reads the clock: a converter gives the same result on every run (take dates from the export, e.g. new Date("2026-10-14"))`,
    );
  const RealDate = Date;
  function GuardedDate(...args: unknown[]): unknown {
    if (new.target === undefined) throw clock('Date()');
    if (args.length === 0) throw clock('new Date()');
    return construct(RealDate, args, new.target);
  }
  define(GuardedDate, 'prototype', { value: RealDate.prototype });
  define(GuardedDate, 'parse', { value: RealDate.parse, writable: true, configurable: true });
  define(GuardedDate, 'UTC', { value: RealDate.UTC, writable: true, configurable: true });
  define(GuardedDate, 'now', {
    value: function now(): never {
      throw clock('Date.now()');
    },
    writable: true,
    configurable: true,
  });
  define(RealDate.prototype, 'constructor', {
    value: GuardedDate,
    writable: true,
    configurable: true,
  });
  define(G, 'Date', { value: GuardedDate, writable: true, configurable: true });
  define(Math, 'random', {
    value: function random(): never {
      throw fail(
        'Math.random() gives another result on every run: derive ids from the tool ids (helpers.sourceId)',
      );
    },
    writable: true,
    configurable: true,
  });
  const dateFormat = Intl.DateTimeFormat.prototype;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called with its object below
  const formatGetter = describeProperty(dateFormat, 'format')?.get;
  if (formatGetter !== undefined) {
    define(dateFormat, 'format', {
      configurable: true,
      get(this: Intl.DateTimeFormat) {
        const format = formatGetter.call(this) as (date?: unknown) => string;
        return (date?: unknown): string => {
          if (date === undefined) throw clock('Intl.DateTimeFormat().format()');
          return format(date);
        };
      },
    });
  }
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called with its object below
  const formatToParts = dateFormat.formatToParts;
  define(dateFormat, 'formatToParts', {
    configurable: true,
    writable: true,
    value: function (this: Intl.DateTimeFormat, date?: unknown): Intl.DateTimeFormatPart[] {
      if (date === undefined) throw clock('Intl.DateTimeFormat().formatToParts()');
      return formatToParts.call(this, date as Date);
    },
  });
  for (const name of [
    'Atomics',
    'SharedArrayBuffer',
    'WebAssembly',
    'WeakRef',
    'FinalizationRegistry',
  ]) {
    delete G[name];
  }

  const describe = (e: unknown): string => {
    if (e instanceof InnerError) {
      const name = typeof e.name === 'string' ? e.name : 'Error';
      const message = typeof e.message === 'string' ? e.message : '';
      const stack = typeof e.stack === 'string' ? e.stack : '';
      const at = stack
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('converter.js:'))
        .slice(0, 3)
        .join('; ');
      return `${name}: ${message}${at === '' ? '' : ` (${at})`}`;
    }
    if (typeof e === 'string') return e;
    return `the converter threw ${e === null ? 'null' : typeof e}, not an Error`;
  };

  const run = (): string => {
    try {
      // the converter's top level: its declarations, then its convert
      const convert = typeof converter === 'function' ? (converter as () => unknown)() : undefined;
      if (typeof convert !== 'function') {
        return stringify({ error: 'the converter defines no function convert(input, helpers)' });
      }
      const input: unknown = parse(inputText);
      const result: unknown = (convert as (input: unknown, helpers: unknown) => unknown)(
        input,
        helpers,
      );
      if ((typeof result === 'object' && result !== null) || typeof result === 'function') {
        if (typeof (result as { then?: unknown }).then === 'function') {
          return stringify({ error: 'convert returned a Promise: a converter is synchronous' });
        }
      }
      const text = stringify({ result }) as string | undefined;
      return typeof text === 'string'
        ? text
        : stringify({ error: 'convert returned nothing JSON can hold' });
    } catch (e) {
      try {
        return stringify({ error: describe(e) });
      } catch {
        return '{"error":"the converter failed"}';
      }
    }
  };
  define(G, '__analyzrRun', { value: run });
}

/** The text a context evaluates: {@link inner}, strict, called once. */
export function innerSource(): string {
  return `'use strict';\n(${inner.toString()})();\n`;
}
