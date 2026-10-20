// Key planning against keymap.json (src/keymap.ts, M6 §3.4 rule 1 and §3.7 step 3), and the key
// map rebuilt from analyzr's identities (M6 S2b follow-up step 4).
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { scanExport } from '../src/bundle.ts';
import {
  applyPlan,
  assertRule,
  deriveKey,
  emptyKeymap,
  formatKeymap,
  inferRule,
  KeymapError,
  parseKeymap,
  planKeys,
  rebuildFromAnalyzr,
  type AnalyzrIdentity,
  type ExportModel,
  type Keymap,
} from '../src/keymap.ts';

import { SIGNAVIO_BUNDLE, SIGNAVIO_EXPORT, SIGNAVIO_RULE } from './support.ts';

const model = (path: string, externalId: string | null = null): ExportModel => ({
  path,
  externalId,
  externalPath: path.replace(/\.bpmn$/, ''),
});

const EXPORT: ExportModel[] = [
  model('Gemeinsame Dokumente/Vertrieb/Auftragsabwicklung.bpmn', 'sid-A'),
  model('Gemeinsame Dokumente/Finanzen/Bonitätsprüfung.bpmn', 'sid-B'),
  model('Archiv/Auftragsabwicklung (alt).bpmn', 'sid-C'),
];

const RULE = { strip: 'Gemeinsame Dokumente', prefix: null };

function confirmed(models = EXPORT): Keymap {
  return applyPlan(
    emptyKeymap(),
    planKeys(emptyKeymap(), models, { system: 'signavio', rule: RULE }),
    '2026-10-14-signavio',
  );
}

describe('deriveKey', () => {
  it('drops the strip folder, slugifies like analyzr and adds the prefix', () => {
    expect(deriveKey('Gemeinsame Dokumente/Finanzen/Bonitätsprüfung.bpmn', RULE)).toBe(
      'finanzen/bonitaetspruefung',
    );
    expect(deriveKey('Archiv/Auftragsabwicklung (alt).bpmn', RULE)).toBe(
      'archiv/auftragsabwicklung-alt',
    );
    expect(deriveKey('Vertrieb/Auftrag.xml', { strip: null, prefix: 'aris' })).toBe(
      'aris/vertrieb/auftrag',
    );
    expect(deriveKey('!!!.bpmn', { strip: null, prefix: null })).toBeNull();
  });
});

describe('planKeys: first import', () => {
  it('proposes keys, examples and no absent models', () => {
    const plan = planKeys(emptyKeymap(), EXPORT, { system: 'signavio', rule: RULE, scope: null });
    expect(plan.firstImport).toBe(true);
    expect(plan.files.map((f) => [f.path, f.key, f.status])).toEqual([
      ['Archiv/Auftragsabwicklung (alt).bpmn', 'archiv/auftragsabwicklung-alt', 'new'],
      ['Gemeinsame Dokumente/Finanzen/Bonitätsprüfung.bpmn', 'finanzen/bonitaetspruefung', 'new'],
      [
        'Gemeinsame Dokumente/Vertrieb/Auftragsabwicklung.bpmn',
        'vertrieb/auftragsabwicklung',
        'new',
      ],
    ]);
    expect(plan.examples).toHaveLength(3);
    expect(plan.counts).toEqual({
      known: 0,
      moved: 0,
      new: 3,
      absent: 0,
      collisions: 0,
      excluded: 0,
      flagged: 0,
    });
  });

  it('suffixes collisions deterministically and names the holder', () => {
    const plan = planKeys(
      emptyKeymap(),
      [
        model('Vertrieb/Auftrag.bpmn', 'a'),
        model('vertrieb/auftrag.bpmn', 'b'),
        model('Vertrieb/Auftrag!.bpmn', 'c'),
      ],
      { system: 'signavio' },
    );
    expect(plan.files.map((f) => [f.path, f.key])).toEqual([
      ['Vertrieb/Auftrag!.bpmn', 'vertrieb/auftrag'],
      ['Vertrieb/Auftrag.bpmn', 'vertrieb/auftrag-2'],
      ['vertrieb/auftrag.bpmn', 'vertrieb/auftrag-3'],
    ]);
    expect(plan.files[1]?.collidesWith).toEqual({
      key: 'vertrieb/auftrag',
      holders: ['signavio: Vertrieb/Auftrag!'],
    });
    expect(plan.counts.collisions).toBe(2);
  });

  it('keeps the keys of another system taken (a second system proposes a prefix)', () => {
    const plan = planKeys(confirmed(), [model('Vertrieb/Auftragsabwicklung.bpmn', 'X1')], {
      system: 'aris',
    });
    expect(plan.files[0]).toMatchObject({
      key: 'vertrieb/auftragsabwicklung-2',
      collidesWith: {
        key: 'vertrieb/auftragsabwicklung',
        holders: ['signavio: Gemeinsame Dokumente/Vertrieb/Auftragsabwicklung'],
      },
    });
    const prefixed = planKeys(confirmed(), [model('Vertrieb/Auftragsabwicklung.bpmn', 'X1')], {
      system: 'aris',
      rule: { strip: null, prefix: 'aris' },
    });
    expect(prefixed.files[0]?.key).toBe('aris/vertrieb/auftragsabwicklung');
  });

  it('flags duplicate tool ids and paths without a valid key', () => {
    const plan = planKeys(
      emptyKeymap(),
      [model('A.bpmn', 'same'), model('B.bpmn', 'same'), model('!!!.bpmn', 'z')],
      {
        system: 'signavio',
      },
    );
    expect(plan.files.map((f) => [f.path, f.externalId, f.flags])).toEqual([
      ['!!!.bpmn', 'z', ['no-key']],
      ['A.bpmn', null, ['duplicate-external-id']],
      ['B.bpmn', null, ['duplicate-external-id']],
    ]);
    expect(plan.files[0]?.key).toMatch(/^modell-[0-9a-f]{8}$/);
  });
});

describe('planKeys: re-import', () => {
  it('keeps every key through a folder move in the tool (moved), lists new and absent models', () => {
    const keymap = confirmed();
    const next = [
      model('Gemeinsame Dokumente/Vertrieb/Auftragsabwicklung.bpmn', 'sid-A'),
      model('Gemeinsame Dokumente/Risiko/Bonitätsprüfung.bpmn', 'sid-B'),
      model('Gemeinsame Dokumente/Finanzen/Mahnwesen.bpmn', 'sid-D'),
    ];
    const plan = planKeys(keymap, next, { system: 'signavio' });
    expect(plan.firstImport).toBe(false);
    expect(plan.files.map((f) => [f.externalId, f.key, f.status, f.previousPath])).toEqual([
      ['sid-D', 'finanzen/mahnwesen', 'new', undefined],
      [
        'sid-B',
        'finanzen/bonitaetspruefung',
        'moved',
        'Gemeinsame Dokumente/Finanzen/Bonitätsprüfung',
      ],
      ['sid-A', 'vertrieb/auftragsabwicklung', 'known', undefined],
    ]);
    expect(plan.absent.map((e) => e.key)).toEqual(['archiv/auftragsabwicklung-alt']);
    const updated = applyPlan(keymap, plan, '2026-10-21-signavio');
    expect(updated.systems['signavio']?.entries.map((e) => [e.key, e.externalPath])).toEqual([
      ['archiv/auftragsabwicklung-alt', 'Archiv/Auftragsabwicklung (alt)'],
      ['finanzen/bonitaetspruefung', 'Gemeinsame Dokumente/Risiko/Bonitätsprüfung'],
      ['finanzen/mahnwesen', 'Gemeinsame Dokumente/Finanzen/Mahnwesen'],
      ['vertrieb/auftragsabwicklung', 'Gemeinsame Dokumente/Vertrieb/Auftragsabwicklung'],
    ]);
    expect(updated.systems['signavio']?.lastExport).toBe('2026-10-21-signavio');
    expect(planKeys(updated, next, { system: 'signavio' }).counts).toEqual({
      known: 3,
      moved: 0,
      new: 0,
      absent: 1,
      collisions: 0,
      excluded: 0,
      flagged: 0,
    });
  });

  it('never gives a freed key to another model', () => {
    const plan = planKeys(confirmed(), [model('Archiv/Auftragsabwicklung (alt).bpmn', 'sid-NEW')], {
      system: 'signavio',
    });
    expect(plan.files[0]?.key).toBe('archiv/auftragsabwicklung-alt-2');
  });

  it('lists absent models of a partial export inside its scope only', () => {
    const plan = planKeys(confirmed(), [EXPORT[0] as ExportModel], {
      system: 'signavio',
      scope: ['Gemeinsame Dokumente/Vertrieb'],
    });
    expect(plan.absent).toEqual([]);
    expect(
      planKeys(confirmed(), [EXPORT[0] as ExportModel], { system: 'signavio' }).absent,
    ).toHaveLength(2);
  });

  it('identifies a model without a tool id by its path only', () => {
    const keymap = confirmed([model('A/X.bpmn')]);
    const plan = planKeys(keymap, [model('B/X.bpmn')], { system: 'signavio' });
    expect(plan.files[0]).toMatchObject({ key: 'b/x', status: 'new' });
    expect(plan.absent.map((e) => e.key)).toEqual(['a/x']);
  });

  it('refuses another key rule once the system has one', () => {
    expect(() =>
      planKeys(confirmed(), EXPORT, { system: 'signavio', rule: { strip: null, prefix: null } }),
    ).toThrow(/fixed since its first plan --write .*--reset/);
    expect(() => planKeys(confirmed(), EXPORT, { system: 'signavio', rule: RULE })).not.toThrow();
  });

  it('keeps the key of a model whose copy appears in a re-export (same tool id)', () => {
    const keymap = confirmed();
    const next = [
      ...EXPORT,
      model('Gemeinsame Dokumente/Vertrieb/Auftragsabwicklung (Kopie).bpmn', 'sid-A'),
    ];
    const plan = planKeys(keymap, next, { system: 'signavio' });
    const byPath = (p: string) => plan.files.find((f) => f.path === p);
    expect(byPath('Gemeinsame Dokumente/Vertrieb/Auftragsabwicklung.bpmn')).toMatchObject({
      key: 'vertrieb/auftragsabwicklung',
      status: 'known',
      externalId: 'sid-A',
      flags: ['duplicate-external-id'],
    });
    expect(byPath('Gemeinsame Dokumente/Vertrieb/Auftragsabwicklung (Kopie).bpmn')).toMatchObject({
      key: 'vertrieb/auftragsabwicklung-kopie',
      status: 'new',
      externalId: null,
      flags: ['duplicate-external-id'],
    });
    expect(plan.absent).toEqual([]);
    // Written and planned again: both stay where they are.
    const updated = applyPlan(keymap, plan, null);
    expect(planKeys(updated, next, { system: 'signavio' }).counts).toMatchObject({
      known: 4,
      new: 0,
      absent: 0,
    });
  });

  it('keeps the key of a model whose copy disappears and takes up its tool id', () => {
    const first = [
      model('Vertrieb/Angebot.bpmn', 'sid-X'),
      model('Vertrieb/Angebot Kopie.bpmn', 'sid-X'),
    ];
    const keymap = applyPlan(
      emptyKeymap(),
      planKeys(emptyKeymap(), first, { system: 'signavio' }),
      null,
    );
    expect(keymap.systems['signavio']?.entries.map((e) => e.externalId)).toEqual([null, null]);
    const plan = planKeys(keymap, [model('Vertrieb/Angebot.bpmn', 'sid-X')], {
      system: 'signavio',
    });
    expect(plan.files.map((f) => [f.key, f.status, f.externalId, f.flags])).toEqual([
      ['vertrieb/angebot', 'known', 'sid-X', []],
    ]);
    expect(plan.absent.map((e) => e.key)).toEqual(['vertrieb/angebot-kopie']);
    // From now on the tool id identifies it, also after a folder move.
    const updated = applyPlan(keymap, plan, null);
    expect(
      planKeys(updated, [model('Verkauf/Angebot.bpmn', 'sid-X')], { system: 'signavio' }).files[0],
    ).toMatchObject({ key: 'vertrieb/angebot', status: 'moved' });
  });

  it('never matches a generic definitions id: excerpts of a tool writing Definitions_1 everywhere', () => {
    const keymap = applyPlan(
      emptyKeymap(),
      planKeys(emptyKeymap(), [model('Vertrieb/Angebot.bpmn', 'Definitions_1')], {
        system: 'tool',
        scope: ['Vertrieb'],
      }),
      null,
    );
    const plan = planKeys(keymap, [model('Finanzen/Rechnung.bpmn', 'Definitions_1')], {
      system: 'tool',
      scope: ['Finanzen'],
    });
    expect(plan.files[0]).toMatchObject({
      key: 'finanzen/rechnung',
      status: 'new',
      externalId: null,
      flags: ['generic-external-id'],
    });
    expect(plan.absent).toEqual([]);
  });

  it('flags a move that also renamed the file', () => {
    const plan = planKeys(
      confirmed(),
      [model('Gemeinsame Dokumente/Risiko/Kreditprüfung.bpmn', 'sid-B')],
      { system: 'signavio', scope: ['Gemeinsame Dokumente/Risiko'] },
    );
    expect(plan.files[0]).toMatchObject({
      key: 'finanzen/bonitaetspruefung',
      status: 'moved',
      flags: ['renamed'],
    });
  });

  it('does not match a model at a known path whose tool id differs', () => {
    const plan = planKeys(confirmed(), [model('Archiv/Auftragsabwicklung (alt).bpmn', 'sid-Z')], {
      system: 'signavio',
    });
    expect(plan.files[0]).toMatchObject({ key: 'archiv/auftragsabwicklung-alt-2', status: 'new' });
  });
});

describe('planKeys: exclusions, scope, analyzr and reset', () => {
  it('leaves excluded folders out, records them and lists their known models as absent', () => {
    const plan = planKeys(emptyKeymap(), EXPORT, {
      system: 'signavio',
      rule: RULE,
      exclude: ['Archiv'],
    });
    expect(plan.files.map((f) => f.key)).toEqual([
      'finanzen/bonitaetspruefung',
      'vertrieb/auftragsabwicklung',
    ]);
    expect(plan.excluded).toEqual(['Archiv/Auftragsabwicklung (alt).bpmn']);
    expect(plan.counts.excluded).toBe(1);
    const keymap = applyPlan(emptyKeymap(), plan, null);
    expect(keymap.systems['signavio']?.exclude).toEqual(['Archiv']);
    // Kept on the next plan; a known model excluded later is absent from the bundle.
    expect(planKeys(keymap, EXPORT, { system: 'signavio' }).excluded).toHaveLength(1);
    const later = planKeys(confirmed(), EXPORT, { system: 'signavio', exclude: ['Archiv'] });
    expect(later.absent.map((e) => e.key)).toEqual(['archiv/auftragsabwicklung-alt']);
    // A single model by its path, with or without its file ending.
    expect(
      planKeys(emptyKeymap(), EXPORT, {
        system: 'signavio',
        exclude: ['Archiv/Auftragsabwicklung (alt).bpmn'],
      }).excluded,
    ).toHaveLength(1);
  });

  it('flags files outside the declared scope of a partial export', () => {
    const plan = planKeys(emptyKeymap(), EXPORT, {
      system: 'signavio',
      rule: RULE,
      scope: ['Gemeinsame Dokumente'],
    });
    expect(plan.files.filter((f) => f.flags.includes('outside-scope')).map((f) => f.path)).toEqual([
      'Archiv/Auftragsabwicklung (alt).bpmn',
    ]);
  });

  it('flags new keys analyzr already has (--existing)', () => {
    const plan = planKeys(emptyKeymap(), EXPORT, {
      system: 'signavio',
      rule: RULE,
      existingKeys: ['vertrieb/auftragsabwicklung', 'other/model'],
    });
    expect(plan.files.find((f) => f.flags.includes('exists-in-analyzr'))?.key).toBe(
      'vertrieb/auftragsabwicklung',
    );
    expect(plan.counts.flagged).toBe(1);
  });

  it('plans a system again from scratch with reset, keeping other systems’ keys taken', () => {
    const keymap = applyPlan(
      confirmed(),
      planKeys(confirmed(), [model('Vertrieb/X.bpmn', 'a1')], { system: 'aris' }),
      null,
    );
    const plan = planKeys(keymap, EXPORT, {
      system: 'signavio',
      rule: { strip: null, prefix: 'signavio' },
      reset: true,
    });
    expect(plan).toMatchObject({ firstImport: true, reset: true, absent: [] });
    expect(plan.files.map((f) => f.key)).toEqual([
      'signavio/archiv/auftragsabwicklung-alt',
      'signavio/gemeinsame-dokumente/finanzen/bonitaetspruefung',
      'signavio/gemeinsame-dokumente/vertrieb/auftragsabwicklung',
    ]);
    const updated = applyPlan(keymap, plan, '2026-10-15-signavio');
    expect(updated.systems['signavio']?.entries.map((e) => e.key)).toEqual(
      plan.files.map((f) => f.key),
    );
    expect(updated.systems['signavio']?.rule).toEqual({ strip: null, prefix: 'signavio' });
    expect(updated.systems['aris']?.entries.map((e) => e.key)).toEqual(['vertrieb/x']);
  });
});

describe('keymap.json', () => {
  it('round trips through formatKeymap and parseKeymap', () => {
    const keymap = confirmed();
    const text = formatKeymap(keymap);
    expect(text.endsWith('}\n')).toBe(true);
    expect(parseKeymap(JSON.parse(text))).toEqual(keymap);
  });

  it('reads a system without exclude as excluding nothing', () => {
    const keymap = parseKeymap({
      format: 'analyzr-keymap/1',
      systems: { s: { rule: { strip: null, prefix: null }, scope: null, entries: [] } },
    });
    expect(keymap.systems['s']?.exclude).toEqual([]);
  });

  it.each([
    [{ format: 'x', systems: {} }, /not a key map/],
    [
      {
        format: 'analyzr-keymap/1',
        systems: { 'Sig Navio': { rule: { strip: null, prefix: null }, entries: [] } },
      },
      /invalid system/,
    ],
    [
      {
        format: 'analyzr-keymap/1',
        systems: { s: { rule: { strip: null, prefix: 'Bad Prefix' }, entries: [] } },
      },
      /invalid key prefix/,
    ],
    [
      {
        format: 'analyzr-keymap/1',
        systems: {
          a: {
            rule: { strip: null, prefix: null },
            entries: [{ key: 'x', externalId: '1', externalPath: 'X' }],
          },
          b: {
            rule: { strip: null, prefix: null },
            entries: [{ key: 'x', externalId: '2', externalPath: 'Y' }],
          },
        },
      },
      /key x appears twice/,
    ],
    [
      {
        format: 'analyzr-keymap/1',
        systems: {
          a: {
            rule: { strip: null, prefix: null },
            entries: [{ key: 'Not/A/Key', externalId: null, externalPath: 'X' }],
          },
        },
      },
      /no valid model key/,
    ],
    [
      {
        format: 'analyzr-keymap/1',
        systems: { s: { rule: { strip: null, prefix: null }, exclude: ['/Archiv'], entries: [] } },
      },
      /invalid exclude folder/,
    ],
  ])('refuses an invalid key map %#', (value, message) => {
    expect(() => parseKeymap(value)).toThrow(KeymapError);
    expect(() => parseKeymap(value)).toThrow(message);
  });
});

const identity = (
  key: string,
  externalId: string | null,
  externalPath: string | null,
  system = 'signavio',
): AnalyzrIdentity => ({ key, system, externalId, externalPath });

/** The identities analyzr lists after an import of the golden bundle (its manifest's files). */
async function goldenIdentities(): Promise<AnalyzrIdentity[]> {
  const manifest = JSON.parse(
    await readFile(path.join(SIGNAVIO_BUNDLE, 'analyzr-import.json'), 'utf8'),
  ) as { files: { key: string; externalId?: string; externalPath: string }[] };
  return manifest.files.map((f) => identity(f.key, f.externalId ?? null, f.externalPath));
}

describe('rebuildFromAnalyzr', () => {
  it('restores a lost key map from the golden bundle’s identities: every file of the export known', async () => {
    const { models } = await scanExport(SIGNAVIO_EXPORT);
    const { keymap, report } = rebuildFromAnalyzr(emptyKeymap(), await goldenIdentities(), {
      system: 'signavio',
    });
    expect(report).toMatchObject({
      restored: true,
      rule: SIGNAVIO_RULE,
      ruleFits: { matching: 6, of: 6 },
      duplicates: [],
      skipped: [],
      conflicts: [],
    });
    expect(report.entries).toHaveLength(6);
    const plan = planKeys(keymap, models, { system: 'signavio' });
    expect(plan.firstImport).toBe(false);
    expect(plan.files.map((f) => f.status)).toEqual(Array.from({ length: 6 }, () => 'known'));
    expect(plan.counts).toMatchObject({ known: 6, new: 0, moved: 0, absent: 0, flagged: 0 });
    // The map the first plan --write recorded, but for the export folder it names.
    const first = planKeys(emptyKeymap(), models, {
      system: 'signavio',
      rule: SIGNAVIO_RULE,
      scope: null,
    });
    expect(applyPlan(keymap, plan, null)).toEqual(applyPlan(emptyKeymap(), first, null));
  });

  it('keeps a tool id on several keys with the oldest model; the others are listed as duplicates', () => {
    const identities = [
      identity('logistik/versand', 'sid-V', 'Logistik/Versand'),
      identity('versand/versand', 'sid-V', 'Versand/Versand'),
      identity('vertrieb/auftrag', 'sid-A', 'Vertrieb/Auftrag'),
    ];
    const modelIds = new Map([
      ['logistik/versand', 'mdl_01JA0000000000000000000002'],
      ['versand/versand', 'mdl_01JA0000000000000000000001'],
      ['vertrieb/auftrag', 'mdl_01JA0000000000000000000003'],
    ]);
    const older = rebuildFromAnalyzr(emptyKeymap(), identities, { system: 'signavio', modelIds });
    expect(older.report.duplicates).toEqual([
      {
        externalId: 'sid-V',
        externalPath: null,
        keys: ['versand/versand', 'logistik/versand'],
        kept: 'versand/versand',
        keptBy: 'oldest',
      },
    ]);
    expect(older.keymap.systems['signavio']?.entries).toEqual([
      { key: 'logistik/versand', externalId: null, externalPath: 'Logistik/Versand' },
      { key: 'versand/versand', externalId: 'sid-V', externalPath: 'Versand/Versand' },
      { key: 'vertrieb/auftrag', externalId: 'sid-A', externalPath: 'Vertrieb/Auftrag' },
    ]);
    // The re-export has the model once, in its new folder: the older key takes it.
    const plan = planKeys(
      older.keymap,
      [{ path: 'Versand/Versand.bpmn', externalId: 'sid-V', externalPath: 'Versand/Versand' }],
      { system: 'signavio' },
    );
    expect(plan.files[0]).toMatchObject({ key: 'versand/versand', status: 'known' });
    expect(plan.absent.map((e) => e.key)).toEqual(['logistik/versand', 'vertrieb/auftrag']);

    // Without model ids nobody can tell the older one: both keep their path only.
    const unknown = rebuildFromAnalyzr(emptyKeymap(), identities, { system: 'signavio' });
    expect(unknown.report.duplicates).toEqual([
      {
        externalId: 'sid-V',
        externalPath: null,
        keys: ['logistik/versand', 'versand/versand'],
        kept: null,
        keptBy: null,
      },
    ]);
    expect(
      unknown.keymap.systems['signavio']?.entries.filter((e) => e.externalId === 'sid-V'),
    ).toEqual([]);
    const byPath = planKeys(
      unknown.keymap,
      [{ path: 'Logistik/Versand.bpmn', externalId: 'sid-V', externalPath: 'Logistik/Versand' }],
      { system: 'signavio' },
    );
    expect(byPath.files[0]).toMatchObject({ key: 'logistik/versand', status: 'known' });
  });

  it('lists a duplicate whose second key has no tool path, and skips that key', () => {
    // An import whose manifest named the tool id but no folder (M6 S2a's external-id-moved).
    const { keymap, report } = rebuildFromAnalyzr(
      emptyKeymap(),
      [
        identity('logistik/versand', 'sid-V', 'Logistik/Versand'),
        identity('versand/versand', 'sid-V', null),
      ],
      {
        system: 'signavio',
        modelIds: new Map([
          ['logistik/versand', 'mdl_01JA0000000000000000000001'],
          ['versand/versand', 'mdl_01JA0000000000000000000009'],
        ]),
      },
    );
    expect(report.duplicates).toMatchObject([
      {
        externalId: 'sid-V',
        keys: ['logistik/versand', 'versand/versand'],
        kept: 'logistik/versand',
      },
    ]);
    expect(report.skipped).toEqual([{ key: 'versand/versand', externalId: null }]);
    expect(keymap.systems['signavio']?.entries).toEqual([
      { key: 'logistik/versand', externalId: 'sid-V', externalPath: 'Logistik/Versand' },
    ]);
  });

  it('identifies nothing by a generic tool id, and keeps one key per path without a tool id', () => {
    const identities = [
      identity('a', 'Definitions_1', 'A', 'tool'),
      identity('b', 'Definitions_1', 'B', 'tool'),
      identity('c', null, 'C', 'tool'),
      identity('c-2', null, 'C', 'tool'),
      identity('d', null, null, 'tool'),
    ];
    const modelIds = new Map([
      ['a', 'mdl_1'],
      ['b', 'mdl_2'],
      ['c', 'mdl_4'],
      ['c-2', 'mdl_3'],
      ['d', 'mdl_5'],
    ]);
    const { keymap, report } = rebuildFromAnalyzr(emptyKeymap(), identities, {
      system: 'tool',
      modelIds,
    });
    expect(report.duplicates).toEqual([
      { externalId: null, externalPath: 'C', keys: ['c-2', 'c'], kept: 'c-2', keptBy: 'oldest' },
    ]);
    expect(report.skipped).toEqual([{ key: 'd', externalId: null }]);
    expect(keymap.systems['tool']?.entries).toEqual([
      { key: 'a', externalId: null, externalPath: 'A' },
      { key: 'b', externalId: null, externalPath: 'B' },
      { key: 'c-2', externalId: null, externalPath: 'C' },
    ]);
    // `c-2` derives from `C` with a collision's suffix, so the rule fits all four with a path.
    expect(report.ruleFits).toEqual({ matching: 4, of: 4 });
    // Without model ids neither path duplicate stays in the map.
    const unknown = rebuildFromAnalyzr(emptyKeymap(), identities, { system: 'tool' });
    expect(unknown.report.duplicates).toEqual([
      { externalId: null, externalPath: 'C', keys: ['c', 'c-2'], kept: null, keptBy: null },
    ]);
    expect(unknown.keymap.systems['tool']?.entries.map((e) => e.key)).toEqual(['a', 'b']);
  });

  it('adds to a stale map only what it lacks, never changing an entry, and lists conflicts', () => {
    const stale = parseKeymap({
      format: 'analyzr-keymap/1',
      systems: {
        signavio: {
          rule: { strip: null, prefix: 'signavio' },
          scope: ['Vertrieb'],
          exclude: ['Archiv'],
          lastExport: '2026-09-01-signavio',
          entries: [
            { key: 'signavio/vertrieb/a', externalId: 'sid-A', externalPath: 'Vertrieb/A' },
            { key: 'signavio/vertrieb/b', externalId: null, externalPath: 'Vertrieb/B' },
          ],
        },
        aris: {
          rule: { strip: null, prefix: 'aris' },
          entries: [{ key: 'aris/x', externalId: 'aris-1', externalPath: 'X' }],
        },
      },
    });
    const { keymap, report } = rebuildFromAnalyzr(
      stale,
      [
        // Known: never rewritten, also with another folder in analyzr.
        identity('signavio/vertrieb/a', 'sid-A', 'Vertrieb/A neu'),
        identity('signavio/vertrieb/c', 'sid-C', 'Vertrieb/C'),
        // The map gives that path to another key.
        identity('signavio/vertrieb/b-2', null, 'Vertrieb/B'),
        // Another system of the map has the key.
        identity('aris/x', 'sid-X', 'X'),
        // Another system's identities are not this system's.
        identity('aris/y', 'aris-2', 'Y', 'aris'),
      ],
      { system: 'signavio' },
    );
    expect(report).toMatchObject({
      restored: false,
      entries: [{ key: 'signavio/vertrieb/c', externalId: 'sid-C', externalPath: 'Vertrieb/C' }],
      rule: { strip: null, prefix: 'signavio' },
      conflicts: [
        { key: 'aris/x', reason: 'key-of-other-system', holder: 'aris' },
        {
          key: 'signavio/vertrieb/b-2',
          reason: 'identity-taken',
          holder: 'signavio/vertrieb/b',
        },
      ],
    });
    expect(keymap.systems['signavio']).toEqual({
      ...stale.systems['signavio'],
      entries: [
        { key: 'signavio/vertrieb/a', externalId: 'sid-A', externalPath: 'Vertrieb/A' },
        { key: 'signavio/vertrieb/b', externalId: null, externalPath: 'Vertrieb/B' },
        { key: 'signavio/vertrieb/c', externalId: 'sid-C', externalPath: 'Vertrieb/C' },
      ],
    });
    expect(keymap.systems['aris']).toEqual(stale.systems['aris']);
  });

  it('keeps the tool id with the key the map already gives it', () => {
    const map = rebuildFromAnalyzr(emptyKeymap(), [identity('b', 'sid-1', 'B', 'tool')], {
      system: 'tool',
    }).keymap;
    const { report } = rebuildFromAnalyzr(
      map,
      [identity('a', 'sid-1', 'A', 'tool'), identity('b', 'sid-1', 'B', 'tool')],
      {
        system: 'tool',
        modelIds: new Map([
          ['a', 'mdl_1'],
          ['b', 'mdl_2'],
        ]),
      },
    );
    // `a` is older, but an entry never changes: `keptBy` says so (the skill says no „älter“).
    expect(report.duplicates).toEqual([
      { externalId: 'sid-1', externalPath: null, keys: ['b', 'a'], kept: 'b', keptBy: 'keymap' },
    ]);
    expect(report.entries).toEqual([{ key: 'a', externalId: null, externalPath: 'A' }]);
  });

  it('gives a tool id whose oldest key has no tool path to the oldest key with one', () => {
    const { keymap, report } = rebuildFromAnalyzr(
      emptyKeymap(),
      [
        identity('alt', 'sid-V', null),
        identity('logistik/versand', 'sid-V', 'Logistik/Versand'),
        identity('versand/neu', 'sid-V', 'Versand/Neu'),
      ],
      {
        system: 'signavio',
        modelIds: new Map([
          ['alt', 'mdl_01JA0000000000000000000001'],
          ['logistik/versand', 'mdl_01JA0000000000000000000002'],
          ['versand/neu', 'mdl_01JA0000000000000000000003'],
        ]),
      },
    );
    expect(report.duplicates).toEqual([
      {
        externalId: 'sid-V',
        externalPath: null,
        keys: ['logistik/versand', 'alt', 'versand/neu'],
        kept: 'logistik/versand',
        keptBy: 'path',
      },
    ]);
    expect(report.skipped).toEqual([{ key: 'alt', externalId: null }]);
    // The model moved in the tool once more: its tool id still finds its key.
    const plan = planKeys(
      keymap,
      [{ path: 'Versand/Versand.bpmn', externalId: 'sid-V', externalPath: 'Versand/Versand' }],
      { system: 'signavio' },
    );
    expect(plan.files[0]).toMatchObject({ key: 'logistik/versand', status: 'moved' });
  });

  it('knows the export’s files at the tool paths analyzr stores tidied (ends trimmed)', () => {
    // The first import declared `Ordner/Prozess ` (a file name ending in a space); analyzr keeps
    // `Ordner/Prozess` (tidyDeclared of the contracts), so the rebuilt map holds that.
    const exported = [
      { path: 'Ordner/Prozess .bpmn', externalId: null, externalPath: 'Ordner/Prozess ' },
      { path: ' Andere.bpmn', externalId: 'sid-1', externalPath: ' Andere' },
    ];
    const first = applyPlan(
      emptyKeymap(),
      planKeys(emptyKeymap(), exported, { system: 'signavio', scope: null }),
      null,
    );
    const stored = (first.systems['signavio']?.entries ?? []).map((e) =>
      identity(e.key, e.externalId, e.externalPath.trim()),
    );
    expect(stored.map((i) => i.externalPath)).toEqual(['Andere', 'Ordner/Prozess']);
    const { keymap } = rebuildFromAnalyzr(emptyKeymap(), stored, { system: 'signavio' });
    const plan = planKeys(keymap, exported, {
      system: 'signavio',
      existingKeys: stored.map((i) => i.key),
    });
    expect(plan.files.map((f) => [f.path, f.key, f.status, f.flags])).toEqual([
      [' Andere.bpmn', 'andere', 'known', []],
      ['Ordner/Prozess .bpmn', 'ordner/prozess', 'known', []],
    ]);
    // A stale map holding the export's form gives that place no second key.
    const rebuilt = rebuildFromAnalyzr(
      first,
      [identity('ordner/prozess-2', null, 'Ordner/Prozess')],
      { system: 'signavio' },
    );
    expect(rebuilt.report).toMatchObject({
      entries: [],
      conflicts: [{ key: 'ordner/prozess-2', reason: 'identity-taken', holder: 'ordner/prozess' }],
    });
  });

  it('keeps the map as it is when analyzr has nothing of the system (its first import)', () => {
    const { keymap, report } = rebuildFromAnalyzr(
      emptyKeymap(),
      [identity('x', 'aris-1', 'X', 'aris'), identity('y', null, null)],
      { system: 'signavio' },
    );
    expect(keymap).toEqual(emptyKeymap());
    expect(report).toMatchObject({ restored: false, entries: [], skipped: [{ key: 'y' }] });
    expect(planKeys(keymap, EXPORT, { system: 'signavio', rule: RULE }).firstImport).toBe(true);
  });

  it('takes the rule given for a missing system, and a stored rule stays fixed', () => {
    const identities = [
      identity(
        'vertrieb/auftragsabwicklung',
        'sid-A',
        'Gemeinsame Dokumente/Vertrieb/Auftragsabwicklung',
      ),
    ];
    const given = rebuildFromAnalyzr(emptyKeymap(), identities, {
      system: 'signavio',
      rule: { strip: null, prefix: null },
    });
    expect(given.report).toMatchObject({
      rule: { strip: null, prefix: null },
      ruleFits: { matching: 0, of: 1 },
    });
    const inferred = rebuildFromAnalyzr(emptyKeymap(), identities, { system: 'signavio' });
    expect(inferred.report.rule).toEqual({ strip: 'Gemeinsame Dokumente', prefix: null });
    // A rebuilt rule is the system's rule: plan refuses another one.
    expect(() =>
      planKeys(inferred.keymap, EXPORT, { system: 'signavio', rule: { strip: null, prefix: 'x' } }),
    ).toThrow(/fixed since its first plan --write/);
  });
});

describe('inferRule', () => {
  it('finds the strip folder and the prefix that derive the keys, collisions’ suffixes included', () => {
    expect(
      inferRule([
        { key: 'aris/vertrieb/a', externalPath: 'Export/Vertrieb/A' },
        { key: 'aris/vertrieb/a-2', externalPath: 'Export/Vertrieb/A' },
        { key: 'aris/finanzen/b', externalPath: 'Export/Finanzen/B' },
        { key: 'aris/archiv/c', externalPath: 'Archiv/C' },
      ]),
    ).toEqual({ rule: { strip: 'Export', prefix: 'aris' }, ruleFits: { matching: 4, of: 4 } });
  });

  it('gives a tie to the simpler rule', () => {
    // Keys that all start with b/ from a folder B: the plain path fits as well as strip B + prefix b.
    expect(
      inferRule([
        { key: 'b/y', externalPath: 'B/y' },
        { key: 'b/z', externalPath: 'B/z' },
      ]),
    ).toEqual({ rule: { strip: null, prefix: null }, ruleFits: { matching: 2, of: 2 } });
    // One fits either strip: the first folder in code-point order.
    expect(
      inferRule([
        { key: 'x', externalPath: 'B/x' },
        { key: 'y', externalPath: 'A/y' },
      ]),
    ).toEqual({ rule: { strip: 'A', prefix: null }, ruleFits: { matching: 1, of: 2 } });
    expect(inferRule([])).toEqual({
      rule: { strip: null, prefix: null },
      ruleFits: { matching: 0, of: 0 },
    });
  });

  it('proposes only a strip folder a rule can name (hand-written tool paths)', () => {
    for (const pairs of [
      [
        { key: 'x', externalPath: 'A\\B/X' },
        { key: 'y', externalPath: 'A\\B/Y' },
      ],
      [
        { key: 'x', externalPath: '/Root/X' },
        { key: 'y', externalPath: '/Root/Y' },
      ],
    ]) {
      const { rule } = inferRule(pairs);
      expect(() => assertRule(rule), JSON.stringify(pairs)).not.toThrow();
    }
    expect(() =>
      rebuildFromAnalyzr(
        emptyKeymap(),
        [identity('x', 'i1', '/Root/X'), identity('y', 'i2', '/Root/Y')],
        { system: 'signavio' },
      ),
    ).not.toThrow();
  });

  it('counts the keys the best rule does not derive (hand-edited keys)', () => {
    expect(
      inferRule([
        { key: 'vertrieb/a', externalPath: 'Vertrieb/A' },
        { key: 'eigener-name', externalPath: 'Vertrieb/B' },
      ]),
    ).toEqual({ rule: { strip: null, prefix: null }, ruleFits: { matching: 1, of: 2 } });
  });
});
