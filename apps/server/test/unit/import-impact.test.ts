/**
 * The pure parts of the import impact (M6 §3.5, S2b): the absent keys
 * within a manifest's scope, and how a file changes its model's processes.
 * The relations' part runs end to end in `integration/import-dry-run.test.ts`.
 */
import type { RevisionSource } from '@analyzr/contracts';
import { describe, expect, it } from 'vitest';

import { absentKeys, fileImpact } from '../../src/domain/import-impact.ts';
import { MODELLED, NO_ENGINE } from '../support/trust.ts';

const source = (system: string, externalPath?: string): RevisionSource => ({
  kind: 'import',
  system,
  ...(externalPath ? { externalPath } : {}),
});

describe('import impact', () => {
  const sources = new Map<string, RevisionSource>([
    ['finanzen/a', source('signavio', 'Finanzen/A')],
    ['finanzen/b', source('signavio', 'Finanzen/B')],
    ['finanzen2/x', source('signavio', 'Finanzen2/X')],
    ['lager/c', source('signavio', 'Lager/C')],
    ['aris/d', source('aris', 'Finanzen/D')],
    ['ohne/pfad', source('signavio')],
  ]);

  it('lists the live keys of the system the bundle does not name, within its scope', () => {
    const named = new Set(['finanzen/a']);
    expect(absentKeys(sources, { system: 'signavio', scope: ['Finanzen'] }, named)).toEqual([
      'finanzen/b',
    ]);
    // a folder's name is no prefix of another's („Finanzen2“), a model without a folder is outside
    expect(absentKeys(sources, { system: 'signavio' }, named)).toEqual([
      'finanzen/b',
      'finanzen2/x',
      'lager/c',
      'ohne/pfad',
    ]);
    expect(absentKeys(sources, null, named)).toEqual([]);
    expect(absentKeys(sources, { system: 'aris', scope: [] }, named)).toEqual([]);
  });

  it('says whether a file changes its facts and which processes it adds or removes', () => {
    expect(
      fileImpact([
        {
          modelKey: 'm',
          previousFactsHash: 'a',
          factsHash: 'b',
          previousProcesses: [{ ref: 'm#P1' }, { ref: 'm#P2' }],
          processes: [{ ref: 'm#P2' }, { ref: 'm#P3' }],
          trust: MODELLED,
        },
        {
          modelKey: 'n',
          previousFactsHash: null,
          factsHash: 'c',
          previousProcesses: [],
          processes: [],
          trust: NO_ENGINE,
        },
        {
          modelKey: 'o',
          previousFactsHash: 'd',
          factsHash: 'd',
          previousProcesses: [],
          processes: [],
          trust: MODELLED,
        },
      ]),
    ).toEqual([
      {
        modelKey: 'm',
        factsChanged: true,
        processesAdded: ['m#P3'],
        processesRemoved: ['m#P1'],
        trust: MODELLED,
      },
      {
        modelKey: 'n',
        factsChanged: true,
        processesAdded: [],
        processesRemoved: [],
        trust: NO_ENGINE,
      },
      {
        modelKey: 'o',
        factsChanged: false,
        processesAdded: [],
        processesRemoved: [],
        trust: MODELLED,
      },
    ]);
  });
});
