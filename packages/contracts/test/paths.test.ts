import { describe, expect, it } from 'vitest';

import * as root from '../src/index.ts';
import {
  BPMN_FILE_SUFFIXES,
  MODEL_KEY_MAX_LENGTH,
  bpmnSuffixOf,
  comparePaths,
  isHiddenPath,
  isImportPath,
  isModelKey,
  keyTakenBy,
  modelKeyFromPath,
  modelKeyOwners,
} from '../src/paths.ts';

describe('the BPMN file rule (M6 S1)', () => {
  it('knows four suffixes, longest first', () => {
    expect(BPMN_FILE_SUFFIXES).toEqual(['.bpmn20.xml', '.bpmn2', '.bpmn', '.xml']);
  });

  it.each([
    ['vertrieb/auftrag.bpmn', '.bpmn'],
    ['Vertrieb/Auftrag.BPMN', '.bpmn'],
    ['a.bpmn2', '.bpmn2'],
    ['legacy/old.bpmn20.xml', '.bpmn20.xml'],
    ['legacy/OLD.BPMN20.XML', '.bpmn20.xml'],
    ['export/model.xml', '.xml'],
    ['export/model.XML', '.xml'],
    ['notes.txt', null],
    ['a.bpmn.bak', null],
    ['a.yaml', null],
    ['bpmn', null],
  ])('bpmnSuffixOf(%s) → %s', (path, suffix) => {
    expect(bpmnSuffixOf(path)).toBe(suffix);
  });

  it('tells hidden paths apart from the suffix', () => {
    // isHiddenPath looks at segments only, whatever the suffix.
    expect(isHiddenPath('._x.bpmn')).toBe(true);
    expect(isHiddenPath('vertrieb/._auftrag.bpmn')).toBe(true);
    expect(isHiddenPath('.git/HEAD')).toBe(true);
    expect(isHiddenPath('a/.DS_Store')).toBe(true);
    expect(isHiddenPath('a\\.hidden\\b.bpmn')).toBe(true);
    expect(isHiddenPath('vertrieb/auftrag.bpmn')).toBe(false);
    expect(isHiddenPath('notes.txt')).toBe(false);
    expect(isHiddenPath('a.b/c.bpmn')).toBe(false);
    // … and bpmnSuffixOf at the suffix only, hidden or not.
    expect(bpmnSuffixOf('._x.bpmn')).toBe('.bpmn');
    expect(bpmnSuffixOf('.git/config.xml')).toBe('.xml');
  });

  it('picks up a BPMN suffix outside hidden files and folders', () => {
    expect(isImportPath('vertrieb/auftrag.bpmn')).toBe(true);
    expect(isImportPath('export/model.xml')).toBe(true);
    expect(isImportPath('legacy/old.bpmn20.xml')).toBe(true);
    expect(isImportPath('a.BPMN')).toBe(true);
    expect(isImportPath('._x.bpmn')).toBe(false);
    expect(isImportPath('.git/config.xml')).toBe(false);
    expect(isImportPath('README.md')).toBe(false);
  });
});

describe('modelKeyFromPath (CONCEPT §4: the key is the slugified path)', () => {
  it.each([
    ['finanzen/rechnungsstellung.bpmn', 'finanzen/rechnungsstellung'],
    ['Vertrieb/Auftragsabwicklung.BPMN', 'vertrieb/auftragsabwicklung'],
    ['Prüfung & Freigabe/Bestellung prüfen.bpmn', 'pruefung-freigabe/bestellung-pruefen'],
    ['./a//b/../c.bpmn20.xml', 'a/b/c'],
    ['windows\\path\\Model.xml', 'windows/path/model'],
    ['Café crème.bpmn', 'cafe-creme'],
    ['---.bpmn', null],
    ['', null],
    // M6 S1: every suffix of the rule is dropped, also in capitals.
    ['export/Model.XML', 'export/model'],
    ['legacy/Old.BPMN20.XML', 'legacy/old'],
    ['a/b.bpmn2', 'a/b'],
    // Only one suffix goes; a name without one keeps its dots as dashes.
    ['a.bpmn.bpmn', 'a-bpmn'],
    ['notes.txt', 'notes-txt'],
  ])('%s → %s', (path, key) => {
    expect(modelKeyFromPath(path)).toBe(key);
  });

  it('gives null for a key longer than the limit', () => {
    const long = `${'a'.repeat(MODEL_KEY_MAX_LENGTH + 1)}.bpmn`;
    expect(modelKeyFromPath(long)).toBeNull();
    expect(modelKeyFromPath(`${'a'.repeat(MODEL_KEY_MAX_LENGTH)}.bpmn`)).toBe(
      'a'.repeat(MODEL_KEY_MAX_LENGTH),
    );
  });

  it('agrees with isModelKey and the root exports', () => {
    expect(isModelKey('finanzen/rechnungsstellung')).toBe(true);
    expect(isModelKey('Finanzen')).toBe(false);
    expect(root.modelKeyFromPath).toBe(modelKeyFromPath);
    expect(root.isModelKey).toBe(isModelKey);
    expect(root.ModelKey.safeParse('finanzen/rechnungsstellung').success).toBe(true);
  });
});

describe('the order of an import and who gets a key (M6 S1)', () => {
  it('sorts by UTF-16 code units, whatever the locale', () => {
    // localeCompare puts `a_b` first; the CLI and the web must agree on the winner of a key.
    expect(['a_b.bpmn', 'a-b.bpmn'].sort(comparePaths)).toEqual(['a-b.bpmn', 'a_b.bpmn']);
    expect(['b.bpmn', 'B.bpmn', 'a.bpmn'].sort(comparePaths)).toEqual([
      'B.bpmn',
      'a.bpmn',
      'b.bpmn',
    ]);
    expect(comparePaths('x', 'x')).toBe(0);
  });

  it('gives a key to the first BPMN-suffixed file before any plain .xml', () => {
    const owners = modelKeyOwners([
      'Order.xml',
      'order.bpmn',
      'Order_Process.xml',
      'order-process.bpmn',
      'a_b.bpmn',
      'a-b.bpmn',
      'Z.xml',
      'z.xml',
      'legacy/Old.xml',
      'legacy/old.bpmn20.xml',
      'only.xml',
      '---.bpmn',
    ]);
    expect(Object.fromEntries(owners)).toEqual({
      order: 'order.bpmn',
      'order-process': 'order-process.bpmn',
      'a-b': 'a-b.bpmn',
      z: 'Z.xml',
      'legacy/old': 'legacy/old.bpmn20.xml',
      only: 'only.xml',
    });
  });

  it('names the BPMN-suffixed file that took the key of a plain .xml, and nothing else', () => {
    const paths = [
      'Prozess.bpmn',
      'Prozess.xml',
      'legacy/old.bpmn20.xml',
      'legacy/Old.xml',
      'Order.xml',
      'order.xml',
      'a.bpmn',
      'A.bpmn2',
      'only.xml',
      '---.xml',
    ];
    const owners = modelKeyOwners(paths);
    expect(Object.fromEntries(paths.map((p) => [p, keyTakenBy(p, owners)]))).toEqual({
      // A tool's sidecar next to the model: skipped, not failed.
      'Prozess.xml': 'Prozess.bpmn',
      'legacy/Old.xml': 'legacy/old.bpmn20.xml',
      // Two plain .xml files and two BPMN-suffixed files stay duplicates.
      'Order.xml': null,
      'order.xml': null,
      'A.bpmn2': null,
      'a.bpmn': null,
      'Prozess.bpmn': null,
      'legacy/old.bpmn20.xml': null,
      'only.xml': null,
      '---.xml': null,
    });
    expect(root.keyTakenBy).toBe(keyTakenBy);
  });
});
