// Key planning against keymap.json (src/keymap.ts, M6 §3.4 rule 1 and §3.7 step 3).
import { describe, expect, it } from 'vitest';

import {
  applyPlan,
  deriveKey,
  emptyKeymap,
  formatKeymap,
  KeymapError,
  parseKeymap,
  planKeys,
  type ExportModel,
  type Keymap,
} from '../src/keymap.ts';

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
