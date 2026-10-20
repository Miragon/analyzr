/**
 * S2a's web parts (UX8, UX-SIMPLIFICATION.md §6): a model's provenance in
 * German (the system by name, a chip only for a file that is no plain
 * export, the project's subtitle, the model view's „Herkunft“, the import
 * loss line), the identity warnings, and a dropped bundle's manifest (read,
 * checked with the contracts' schema, its pinned keys, the batch's subset).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { ModelIdentity, Revision } from '@analyzr/client';
import { TRUST_REASON_LABELS as CONTRACT_TRUST_REASON_LABELS } from '@analyzr/contracts';
import { modelKeyFromPath } from '@analyzr/contracts/paths';
import { describe, expect, it } from 'vitest';

import {
  TRUST_REASON_LABELS,
  commonSourceLine,
  derivedChip,
  importLossOf,
  importWarningText,
  lossText,
  provenanceLines,
  sourceLine,
  systemLabel,
  toolLinkOf,
  toolUrl,
} from '../src/lib/provenance';
import { planUpload, stripRoot } from '../src/lib/upload';
import {
  bundleFiles,
  bundleSummary,
  manifestSubset,
  readManifest,
} from '../src/lib/upload-manifest';
import { openQuestion } from './support/fixtures';

const BUNDLE = join(__dirname, '../../../tools/integrate/test/fixtures/signavio/bundle');

const revision = (rev: number, source: Revision['source']): Pick<Revision, 'rev' | 'source'> => ({
  rev,
  source,
});

describe('provenance in German (UX8)', () => {
  it('names the system and shows a chip only for a file that is no plain export', () => {
    expect(systemLabel('signavio')).toBe('Signavio');
    expect(systemLabel('neues-werkzeug')).toBe('neues-werkzeug');
    expect(derivedChip({ system: 'signavio', derived: 'export' })).toBeNull();
    expect(derivedChip(null)).toBeNull();
    expect(derivedChip({ system: 'signavio', derived: 'converted' })?.label).toBe('Konvertiert');
    expect(derivedChip({ system: 'aris', derived: 'reconstructed' })).toEqual({
      label: 'KI-rekonstruiert',
      hint: 'Ein Sprachmodell hat das Diagramm aus einer Vorlage nachgebaut; prüf es vor dem Entscheiden. Quelle: ARIS.',
    });
    expect(derivedChip({ system: 'interview', derived: 'as-told' })?.label).toBe('Aus Interview');
  });

  it('says „Aus Signavio · exportiert am …“ when every model comes from one system', () => {
    const s = { system: 'signavio', derived: null, exportedAt: '2026-10-14T00:00:00Z' };
    expect(sourceLine(s)).toBe('Aus Signavio · exportiert am 14.10.2026');
    expect(commonSourceLine([{ source: s }, { source: s }])).toBe(
      'Aus Signavio · exportiert am 14.10.2026',
    );
    // other dates: the system alone; another system or none: nothing
    expect(
      commonSourceLine([{ source: s }, { source: { ...s, exportedAt: '2026-09-01T00:00:00Z' } }]),
    ).toBe('Aus Signavio');
    expect(commonSourceLine([{ source: s }, { source: { ...s, system: 'aris' } }])).toBeNull();
    expect(commonSourceLine([{ source: s }, { source: null }])).toBeNull();
    expect(commonSourceLine([])).toBeNull();
  });

  it('says where the head came from, an amended head through its upstream', () => {
    const uploaded = revision(3, {
      kind: 'import',
      uploader: 'human',
      system: 'signavio',
      systemVersion: '19.6.0',
      exportedAt: '2026-10-14T00:00:00Z',
      externalPath: 'Finanzen/Forderungsmanagement',
      derived: { kind: 'converted', converter: 'normalize-bpmn 0.1.0' },
    });
    const amended = revision(4, {
      kind: 'amendment',
      uploader: 'human',
      upstream: { revisionId: 'rev_3', rev: 3, contentHash: 'a'.repeat(64) },
    });
    // the model's identity, as the import that stored r3 declared it (M6 S2b follow-up step 5)
    const identity: ModelIdentity = {
      system: 'signavio',
      externalId: null,
      externalPath: 'Finanzen/Forderungsmanagement',
      url: null,
    };
    expect(provenanceLines(amended, uploaded, identity)).toEqual([
      { label: 'Stand', text: 'In analyzr ergänzt (aus r3)' },
      { label: 'Quelle', text: 'Aus Signavio 19.6.0 · exportiert am 14.10.2026 (angegeben)' },
      { label: 'Im Quellsystem', text: 'Finanzen/Forderungsmanagement' },
      { label: 'Entstanden', text: 'Konvertiert · mit normalize-bpmn 0.1.0' },
      { label: 'Hochgeladen', text: 'über den Owner-Zugang' },
    ]);
    const plain = revision(1, { kind: 'upload', uploader: 'agent' });
    expect(provenanceLines(plain, plain, null)).toEqual([
      { label: 'Hochgeladen', text: 'über ein Agenten-Token' },
      { label: 'Quelle', text: 'Ohne Angabe eines Quellsystems hochgeladen' },
    ]);
    expect(lossText({ code: 'element-dropped', count: 3 })).toBe('Elemente weggelassen: 3');
    expect(lossText({ code: 'neuer-code', count: 1200 })).toBe('neuer-code: 1.200');
    expect(toolUrl('https://editor.signavio.com/p/model/1')).toBe(
      'https://editor.signavio.com/p/model/1',
    );
    expect(toolUrl('javascript:alert(1)')).toBeNull();
    expect(toolUrl('no url')).toBeNull();
  });

  it('says where the model lives in the tool as the newest import declared it (M6 S2b follow-up step 5)', () => {
    const uploaded = revision(1, {
      kind: 'import',
      uploader: 'human',
      system: 'signavio',
      systemVersion: '19.6.0',
      exportedAt: '2026-10-14T00:00:00Z',
      externalPath: 'Gemeinsame Dokumente/Logistik/Versand',
      url: 'https://editor.signavio.com/p/hub/model/alt',
    });
    const identity: ModelIdentity = {
      system: 'signavio',
      externalId: 'sid-5F0E',
      externalPath: 'Verschoben/Gemeinsame Dokumente/Logistik/Versand',
      url: 'https://editor.signavio.com/p/hub/model/sid-5F0E',
    };
    const lines = (r: typeof uploaded, i: ModelIdentity | null) =>
      provenanceLines(r, r, i).map((l) => `${l.label}: ${l.text}`);
    // the identity's folder over the revision's; „Quelle“ stays the revision's (the bytes')
    expect(lines(uploaded, identity)).toEqual([
      'Quelle: Aus Signavio 19.6.0 · exportiert am 14.10.2026 (angegeben)',
      'Im Quellsystem: Verschoben/Gemeinsame Dokumente/Logistik/Versand',
      'Hochgeladen: über den Owner-Zugang',
    ]);
    // an identity without a folder shows none, never the revision's
    expect(lines(uploaded, { ...identity, externalPath: null })).not.toContainEqual(
      expect.stringMatching(/^Im Quellsystem/),
    );
    // bytes uploaded without a manifest, the identity from a later bundle: the system named
    const plain = revision(2, { kind: 'upload', uploader: 'human' });
    expect(lines(plain, identity)).toEqual([
      'Im Quellsystem: Signavio: Verschoben/Gemeinsame Dokumente/Logistik/Versand',
      'Hochgeladen: über den Owner-Zugang',
      'Quelle: Ohne Angabe eines Quellsystems hochgeladen',
    ]);
    // a revision of another system: the identity's named too
    const aris = revision(3, { kind: 'import', uploader: 'human', system: 'aris' });
    expect(lines(aris, identity)).toContain(
      'Im Quellsystem: Signavio: Verschoben/Gemeinsame Dokumente/Logistik/Versand',
    );
    // the link into the tool is the identity's, without the revisions
    expect(toolLinkOf({ identity })).toEqual({
      url: 'https://editor.signavio.com/p/hub/model/sid-5F0E',
      system: 'signavio',
    });
    expect(toolLinkOf({ identity: { ...identity, url: null } })).toBeNull();
    expect(toolLinkOf({ identity: { ...identity, url: 'javascript:alert(1)' } })).toBeNull();
    expect(toolLinkOf({ identity: null })).toBeNull();
    // identical bytes keep the derivation they were stored with
    expect(importWarningText({ code: 'provenance-kept', message: 'x' })).toBe(
      'Unverändert: analyzr behält die bisherige Angabe, wie die Datei entstanden ist. Eine Korrektur braucht geänderte Dateien.',
    );
  });

  it('says that a derived revision’s calls are only proposed (the trust rule, M6 S2c)', () => {
    const uploaded = revision(1, {
      kind: 'import',
      uploader: 'human',
      trust: { class: 'derived', reasons: ['no-engine', 'converted'] },
    });
    expect(provenanceLines(uploaded, uploaded, null).at(-1)).toEqual({
      label: 'Aufrufe',
      text: 'nur als Vorschlag (ohne Camunda-Engine; als konvertiert angegeben)',
    });
    // A call target set in analyzr counts as modelled (decision 25.2), also once taken over.
    const amended = revision(2, {
      kind: 'amendment',
      uploader: 'human',
      upstream: { revisionId: 'rev_1', rev: 1, contentHash: 'a'.repeat(64) },
      amendments: [{ id: 'mam_1', elementId: 'Call_A', op: 'call-target', outcome: 'applied' }],
    });
    expect(provenanceLines(amended, uploaded, null).at(-1)).toEqual({
      label: 'Aufrufe',
      text: 'nur als Vorschlag (ohne Camunda-Engine; als konvertiert angegeben) · von dir gesetzte Aufrufziele gelten als modelliert',
    });
    // Modelled and stored before S2c: no line, to keep the view lean.
    for (const trust of [{ class: 'modelled' as const, reasons: [] }, undefined]) {
      const r = revision(1, { kind: 'upload', uploader: 'human', ...(trust ? { trust } : {}) });
      expect(provenanceLines(r, r, null).map((l) => l.label)).not.toContain('Aufrufe');
    }
    expect(TRUST_REASON_LABELS).toEqual(CONTRACT_TRUST_REASON_LABELS);
    expect(importWarningText({ code: 'trust-kept', message: 'x' })).toBe(
      'Unverändert: analyzr behält, ob es die Aufrufe des Modells annimmt oder nur vorschlägt. Eine neue Einstufung braucht geänderte Dateien.',
    );
  });

  it('says the identity warnings in German', () => {
    expect(
      importWarningText({
        code: 'external-id-moved',
        message: 'x',
        system: 'signavio',
        externalId: 'sid-K',
        otherKeys: ['lager/kommission'],
      }),
    ).toBe(
      'Im Quellsystem umbenannt oder verschoben? „sid-K“ gehörte bisher zu „lager/kommission“; das Modell gibt es jetzt doppelt. Lösch den überzähligen Kurznamen und importier das Bundle mit festgelegtem Kurznamen erneut.',
    );
    expect(
      importWarningText({
        code: 'external-id-changed',
        message: 'x',
        system: 'signavio',
        externalId: 'sid-B',
        previous: { system: 'aris', externalId: 'A-1' },
      }),
    ).toMatch(/^Ein anderes Modell\? Dieser Kurzname trug bisher „A-1“ \(ARIS\), jetzt „sid-B“\./);
    expect(importWarningText({ code: 'manifest-sha-mismatch', message: 'x' })).toMatch(/Prüfsumme/);
  });

  it('reads the import loss line from the model’s open question, with its count', () => {
    const loss = (detail: string, over: Partial<Parameters<typeof importLossOf>[0][number]> = {}) =>
      openQuestion({
        id: 'q-00000000000000b1',
        kind: 'extractor-loss',
        subject: { type: 'model', id: 'finanzen/bonitaet' },
        detail,
        ...over,
      });
    // the server's wording (signals.ts `extractorLosses`)
    expect(
      importLossOf(
        [loss('analyzr hat 2 Elemente übersprungen: ungültige ID „4711“; …')],
        'finanzen/bonitaet',
      ),
    ).toEqual({
      text: 'Beim Import übersprungen: 2 Elemente',
      questionId: 'q-00000000000000b1',
    });
    expect(
      importLossOf(
        [loss('analyzr hat mindestens ein Element übersprungen: …')],
        'finanzen/bonitaet',
      )?.text,
    ).toBe('Beim Import übersprungen: mindestens 1 Element');
    expect(importLossOf([loss('anders formuliert')], 'finanzen/bonitaet')?.text).toBe(
      'Beim Import sind Elemente verloren gegangen',
    );
    expect(importLossOf([loss('x', { state: 'answered' })], 'finanzen/bonitaet')).toBeNull();
    expect(importLossOf([loss('x')], 'anderes/modell')).toBeNull();
  });
});

function bundleEntries(): { path: string; file: File }[] {
  return readdirSync(BUNDLE, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(BUNDLE, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort()
    .map((p) => ({
      // a dropped folder: its own name is not part of the paths
      path: stripRoot(`2026-10-14-signavio/${p}`),
      file: new File([readFileSync(join(BUNDLE, p))], p.slice(p.lastIndexOf('/') + 1)),
    }));
}

describe('a dropped bundle’s manifest (UX8)', () => {
  it('reads it at the root, pins its keys and sends each batch its subset', async () => {
    const entries = bundleEntries();
    const read = await readManifest(entries);
    if (read.kind !== 'ok') throw new Error(`manifest not read: ${read.kind}`);
    const { loaded } = read;
    const plan = planUpload(entries, undefined, {
      keyOf: (p) => loaded.byPath.get(p)?.key ?? modelKeyFromPath(p),
      own: bundleFiles(loaded),
    });
    // the manifest is the bundle's, not a skipped file
    expect(plan.skipped).toEqual([]);
    expect(plan.failed).toEqual([]);
    const sent = plan.batches.flat().map((e) => e.path);
    expect(sent).toEqual(loaded.manifest.files.map((f) => f.path));
    const subset = manifestSubset(loaded, sent.slice(0, 2));
    expect(subset.files.map((f) => f.key)).toEqual(
      loaded.manifest.files.slice(0, 2).map((f) => f.key),
    );
    expect(subset.source).toEqual(loaded.manifest.source);
    expect(bundleSummary(loaded, sent)).toEqual({
      line: 'Bundle erkannt: Signavio, exportiert am 14.10.2026 · 6 von 6 Dateien gelistet · Kurznamen aus dem Bundle',
      unlisted: null,
      valueChain: null,
    });
    expect(bundleSummary(loaded, [...sent, 'extra/neu.bpmn']).unlisted).toBe(
      '1 Datei steht nicht im Bundle; sie bekommt ihren Pfad als Kurznamen.',
    );
  });

  it('pins a key over the path, and keeps the path key of a file the manifest does not list', async () => {
    const manifest = {
      format: 'analyzr-import/1',
      source: { system: 'signavio' },
      files: [{ path: 'Finanzen/Bonität.bpmn', key: 'finanzen/bonitaet' }],
      valueChain: { path: 'kette.vc.json' },
    };
    const entries = [
      { path: 'analyzr-import.json', file: new File([JSON.stringify(manifest)], 'm') },
      { path: 'Finanzen/Bonität.bpmn', file: new File(['<x/>'], 'b') },
      { path: 'Extra/Neu.bpmn', file: new File(['<x/>'], 'n') },
      { path: 'kette.vc.json', file: new File(['{}'], 'k') },
    ];
    const read = await readManifest(entries);
    if (read.kind !== 'ok') throw new Error(read.kind);
    const keyOf = (p: string) => read.loaded.byPath.get(p)?.key ?? modelKeyFromPath(p);
    const plan = planUpload(entries, undefined, { keyOf, own: bundleFiles(read.loaded) });
    expect(plan.batches.flat().map((e) => [e.path, keyOf(e.path)])).toEqual([
      ['Extra/Neu.bpmn', 'extra/neu'],
      ['Finanzen/Bonität.bpmn', 'finanzen/bonitaet'],
    ]);
    // the chain file is the bundle's own: not skipped, a next step instead
    expect(plan.skipped).toEqual([]);
    expect(bundleSummary(read.loaded, ['Finanzen/Bonität.bpmn', 'Extra/Neu.bpmn']).valueChain).toBe(
      'kette.vc.json',
    );
  });

  it('stops before sending for a manifest that is no JSON, no analyzr-import/1, or in a subfolder', async () => {
    const at = (path: string, text: string) => [
      { path, file: new File([text], 'm') },
      { path: 'a.bpmn', file: new File(['<x/>'], 'a') },
    ];
    expect(await readManifest(at('x.bpmn', '<x/>'))).toEqual({ kind: 'none' });
    const broken = await readManifest(at('analyzr-import.json', '{'));
    expect(broken).toMatchObject({
      kind: 'refused',
      reason: 'Die analyzr-import.json des Bundles ist kein gültiges JSON. Nichts importiert.',
    });
    const wrong = await readManifest(
      at('analyzr-import.json', JSON.stringify({ format: 'analyzr-import/2', files: [] })),
    );
    expect(wrong.kind).toBe('refused');
    expect(wrong.kind === 'refused' && wrong.detail).toMatch(/format/);
    expect(await readManifest(at('Bundle/analyzr-import.json', '{}'))).toEqual({
      kind: 'refused',
      reason:
        'In „Bundle/“ liegt ein Bundle mit eigener analyzr-import.json. Leg diesen Ordner selbst ab; sonst beginnt jeder Kurzname mit „bundle/“. Nichts importiert.',
    });
  });
});
