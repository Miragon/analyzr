// Safe ids and their rewrites (src/ids.ts, M6 §3.4 rule 2).
import { isElementId } from '@analyzr/contracts';
import { describe, expect, it } from 'vitest';

import { isSafeId, MAX_ID_LENGTH, sanitizeId, uniqueId } from '../src/ids.ts';

/** moddle-xml's check in `addElement` (`illegal ID <…>`), copied from moddle-xml 12.3.1. */
const MODDLE_ID = /^([a-z][\w-.]*:)?[a-z_][\w-.]*$/i;

const SAMPLES = [
  'Task_1',
  'sid-6F1C0E52-7B3C',
  '_x.y-z',
  'Prüfen',
  '4711',
  'a b',
  'a:b',
  '',
  '-a',
  '.a',
  'Aufgabe_Bonität_prüfen',
  'x'.repeat(255),
  'x'.repeat(256),
];

describe('isSafeId', () => {
  it('accepts exactly the ids analyzr and bpmn-moddle both accept', () => {
    for (const id of SAMPLES) {
      expect(isSafeId(id), id).toBe(isElementId(id) && MODDLE_ID.test(id) && !id.includes(':'));
    }
  });
});

describe('sanitizeId', () => {
  it('prefixes the type and keeps the source id readable', () => {
    expect(sanitizeId('Aufgabe_Bonität_prüfen', 'Task')).toBe('Task_Aufgabe_Bonitaet_pruefen');
    expect(sanitizeId('4711', 'DataStoreReference')).toBe('DataStoreReference_4711');
    expect(sanitizeId('Bestellung prüfen & freigeben', 'UserTask')).toBe(
      'UserTask_Bestellung_pruefen_freigeben',
    );
    expect(sanitizeId('café', 'Task')).toBe('Task_cafe');
  });

  it('is deterministic, safe and at most 255 characters', () => {
    for (const id of [...SAMPLES, '日本語', '!!!', 'ü'.repeat(300)]) {
      const once = sanitizeId(id, 'Task');
      expect(once, id).toBe(sanitizeId(id, 'Task'));
      expect(isSafeId(once), once).toBe(true);
      expect(once.length).toBeLessThanOrEqual(MAX_ID_LENGTH);
    }
    expect(sanitizeId('日本語', 'Task')).toMatch(/^Task_[0-9a-f]{8}$/);
    const long = sanitizeId('y'.repeat(400), 'Task');
    expect(long).toMatch(/_[0-9a-f]{8}$/);
    expect(long.length).toBe(MAX_ID_LENGTH);
  });
});

describe('uniqueId', () => {
  it('appends the first free suffix', () => {
    const taken = new Set(['a', 'a_2']);
    expect(uniqueId('b', (id) => taken.has(id))).toBe('b');
    expect(uniqueId('a', (id) => taken.has(id))).toBe('a_3');
    const long = 'z'.repeat(MAX_ID_LENGTH);
    expect(uniqueId(long, (id) => id === long)).toBe(`${'z'.repeat(MAX_ID_LENGTH - 2)}_2`);
  });
});
