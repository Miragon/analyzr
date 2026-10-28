// The shared strict YAML reader (src/yaml.ts, M6 S6 §3.9): for a file that can hold personal
// data (`parserMessages: false`, the transcripts' role file from step 3), a problem names only its
// code and position, never the file's text; with parser messages (specs, guide notes) the reader
// keeps its texts. Released in plugin 0.1.6, so step 3 changes no bundled module.
import { describe, expect, it } from 'vitest';

import { parseStrictYaml, type YamlProblem } from '../src/yaml.ts';

/** A name that must never show in a problem. */
const NAME = 'Erika Mustermann';

const read = (text: string, parserMessages: boolean): YamlProblem[] =>
  parseStrictYaml(text, {
    maxBytes: 64 * 1024,
    tooLarge: (bytes) => ({ path: '', code: 'too-large', message: `${bytes} bytes` }),
    multipleDocs: 'more than one YAML document',
    parserMessages,
  }).errors;

/** Broken files whose name the parser would quote: indentation, a missing quote, a tab, a tag, an anchor and an alias. */
const BROKEN: Readonly<Record<string, string>> = {
  'bad indent': `rollen:\n  - sprecher: ${NAME}\n   rolle: Lagerleitung\n`,
  'missing quote': `rollen:\n  - sprecher: "${NAME}\n    rolle: Lagerleitung\n`,
  'tab as indent': `rollen:\n\t- sprecher: ${NAME}\n`,
  'flow without its end': `rollen: [${NAME}, Lagerleitung\n`,
  tag: `sprecher: !person ${NAME}\n`,
  anchor: `a: &x ${NAME}\nb: 1\n`,
  alias: `a: x\nb: *${NAME.replace(' ', '_')}\n`,
  'duplicate key': `${NAME}: 1\n${NAME}: 2\n`,
  'two documents': `a: ${NAME}\n---\nb: ${NAME}\n`,
};

describe('the strict YAML reader without parser messages', () => {
  it.each(Object.entries(BROKEN))('%s: code and position, never the text', (_, text) => {
    const errors = read(text, false);
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) {
      expect(e.path).toMatch(/^(line \d+, column \d+)?$/);
      expect(e.code).toMatch(/^(yaml|yaml-[a-z]+|too-many-problems)$/);
      for (const part of [NAME, ...NAME.split(' '), 'person', 'Lagerleitung']) {
        expect(JSON.stringify(e), part).not.toContain(part);
      }
    }
  });

  it('says what it is with parser messages, and reads a valid file the same either way', () => {
    const tagged = (parserMessages: boolean) =>
      read(BROKEN['tag'] ?? '', parserMessages).map((e) => e.message);
    expect(tagged(true)).toContain('tags (!person) are not allowed; quote the value instead');
    expect(tagged(false)).toEqual([
      'tags are not allowed; quote the value instead',
      'tags are not allowed; quote the value instead',
    ]);
    const valid = 'rollen:\n  - sprecher: Sprecher 1\n    rolle: Lagerleitung\n';
    for (const parserMessages of [true, false]) {
      expect(
        parseStrictYaml(valid, {
          maxBytes: 1024,
          tooLarge: () => ({ path: '', code: 'too-large', message: '' }),
          multipleDocs: '',
          parserMessages,
        }),
      ).toEqual({
        value: { rollen: [{ sprecher: 'Sprecher 1', rolle: 'Lagerleitung' }] },
        errors: [],
      });
    }
  });
});
