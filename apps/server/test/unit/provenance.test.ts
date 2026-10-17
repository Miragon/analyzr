/**
 * Typed provenance and stable identity (M6 §3.2–§3.4, slice S2a), pure: the
 * manifest check (the integrate plugin's golden bundle passes as written,
 * also with a byte order mark; broken ones are refused with
 * `invalid-manifest`), the `source` of an uploaded revision, the warnings
 * `manifest-sha-mismatch`, `external-id-moved` and `external-id-changed`
 * (never for an as-told draft without a tool id), the list of
 * `GET …/external-ids`; `extractor-loss` (§4.3) on synthetic fixtures with
 * duplicate and illegal ids and unknown elements, stable when an amendment
 * elsewhere shifts lines; the change list's origin line.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  tidyDeclared,
  type ModelAmendment,
  type PrincipalId,
  type RevisionSource,
} from '@analyzr/contracts';
import { describe, expect, it } from 'vitest';

import type { Actor } from '../../src/domain/actor.ts';
import { originOf, renderChangeListMarkdown } from '../../src/domain/amendments/export.ts';
import { DomainError } from '../../src/domain/errors.ts';
import { buildOpenQuestions } from '../../src/domain/open-questions/read-model.ts';
import { describeLoss } from '../../src/domain/open-questions/signals.ts';
import {
  externalIdEntries,
  identityOf,
  identityWarnings,
  parseManifest,
  shaMismatch,
  uploadedSource,
} from '../../src/domain/provenance.ts';
import { storedWarnings } from '../../src/domain/warnings.ts';
import { libraryInput } from '../support/open-questions.ts';

const MANIFEST = fileURLToPath(
  new URL(
    '../../../../tools/integrate/test/fixtures/signavio/bundle/analyzr-import.json',
    import.meta.url,
  ),
);

const human: Actor = {
  principalId: `prn_${'0'.repeat(21)}HUMAN` as PrincipalId,
  kind: 'user',
  handle: 'owner',
  clientId: 'analyzr-cli',
  interactive: true,
  scopes: ['analyzr:read', 'analyzr:write', 'analyzr:review'],
  binding: null,
};
const agent: Actor = { ...human, kind: 'service', interactive: false, clientId: 'agt_x' };

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function refused(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    const e = err as DomainError;
    expect(e.code).toBe('validation-failed');
    expect(e.extras).toMatchObject({ reason: 'invalid-manifest' });
    return e;
  }
  throw new Error('not refused');
}

const minimal = (files: unknown[], source: Record<string, unknown> = {}) => ({
  format: 'analyzr-import/1',
  source: { system: 'signavio', ...source },
  files,
});

describe('parseManifest', () => {
  it("accepts the integrate plugin's golden bundle manifest as written, with its checksum", async () => {
    const bytes = new Uint8Array(await readFile(MANIFEST));
    const received = parseManifest(bytes);
    expect(received.sha256).toBe(sha(bytes));
    expect(received.manifest.source).toMatchObject({ system: 'signavio', systemVersion: '19.6.0' });
    expect(received.byPath.get('logistik/versand.bpmn')).toMatchObject({
      key: 'logistik/versand',
      derived: { kind: 'converted', converter: 'normalize-bpmn@0.1.0' },
      losses: [{ code: 'id-rewritten', count: 2 }],
    });
    // A byte order mark (Windows editors) is fine.
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
    expect(parseManifest(bom).manifest.files).toHaveLength(6);
  });

  it("accepts the skill's date-times without seconds, scope, layout-missing losses and drops unknown fields", () => {
    const m = parseManifest(
      encode({
        ...minimal(
          [
            {
              path: 'a.bpmn',
              losses: [{ code: 'layout-missing', count: 3 }],
              externalId: null,
              future: 'x',
            },
          ],
          { exportedAt: '2026-10-14T09:12Z', scope: ['Vertrieb'] },
        ),
        inventory: { path: 'inventory.json' },
        valueChain: { path: 'value-chain.vc.json', derived: { kind: 'converted' } },
      }),
    ).manifest;
    expect(m.source.exportedAt).toBe('2026-10-14T09:12Z');
    expect(m.files[0]).toEqual({
      path: 'a.bpmn',
      losses: [{ code: 'layout-missing', count: 3 }],
      externalId: null,
    });
  });

  it('refuses what is no analyzr-import/1 manifest, naming the problem', () => {
    expect(refused(() => parseManifest(new TextEncoder().encode('{'))).message).toMatch(
      /not UTF-8 JSON/,
    );
    expect(refused(() => parseManifest(new Uint8Array([0xff, 0xfe]))).message).toMatch(/UTF-8/);
    refused(() => parseManifest(encode({ ...minimal([]), format: 'analyzr-import/2' })));
    refused(() => parseManifest(encode(minimal([], { system: 'Signavio' }))));
    expect(
      refused(() => parseManifest(encode(minimal([{ path: 'a.bpmn' }, { path: 'a.bpmn' }]))))
        .message,
    ).toMatch(/path a\.bpmn twice/);
    expect(
      refused(() =>
        parseManifest(
          encode(
            minimal([
              { path: 'a.bpmn', key: 'x/y' },
              { path: 'b.bpmn', key: 'x/y' },
            ]),
          ),
        ),
      ).message,
    ).toMatch(/key x\/y pinned twice/);
    refused(() => parseManifest(encode(minimal([{ path: 'a.bpmn', key: 'Not A Key' }]))));
    refused(() =>
      parseManifest(encode(minimal([{ path: 'a.bpmn', derived: { kind: 'reconstructed' } }]))),
    );
    refused(() => parseManifest(encode(minimal([{ path: 'a.bpmn', url: 'javascript:alert(1)' }]))));
    refused(() => parseManifest(encode(minimal([{ path: 'a.bpmn', sha256: 'abc' }]))));
    refused(() =>
      parseManifest(
        encode(minimal([{ path: 'a.bpmn', derived: { kind: 'as-told', from: ['Frau Müller'] } }])),
      ),
    );
    refused(() =>
      parseManifest(
        encode(minimal([{ path: 'a.bpmn', losses: [{ code: 'Not A Code', count: 1 }] }])),
      ),
    );
    refused(() => parseManifest(encode(minimal([{ path: 'a\u0000.bpmn' }]))));
    // What PostgreSQL's jsonb cannot hold is refused, not answered with 500: a NUL in the
    // link, a lone surrogate (a converter that cut a string inside a pair) in an identity.
    for (const entry of [
      { path: 'a.bpmn', url: 'https://example.com/a\u0000b' },
      { path: 'a.bpmn', url: 'https://example.com/a\ud800' },
      { path: 'a.bpmn', externalId: 'ok\ud800' },
      { path: 'a\udc00.bpmn' },
    ]) {
      expect(refused(() => parseManifest(encode(minimal([entry])))).message).toMatch(
        /control characters or lone surrogates/,
      );
    }
    expect(
      refused(() => parseManifest(encode(minimal([{ path: 'a.bpmn' }], { scope: ['V\ud800'] }))))
        .message,
    ).toMatch(/source\.scope\.0/);
    // Credentials in the link would be stored for good: refused.
    expect(
      refused(() =>
        parseManifest(
          encode(minimal([{ path: 'a.bpmn', url: 'https://user:secret@tool.example/x' }])),
        ),
      ).message,
    ).toMatch(/must not contain a user name or password/);
    // A reconstructed file names its model: an empty or blank one does not count.
    for (const llmModel of ['', '  ', '\n']) {
      refused(() =>
        parseManifest(
          encode(minimal([{ path: 'a.bpmn', derived: { kind: 'reconstructed', llmModel } }])),
        ),
      );
    }
  });

  it('accepts what a newer converter or an odd export writes: unknown loss codes, empty or odd informational fields', () => {
    // The integrate plugin 0.1.0 writes the export's exporterVersion as read: "" stays "".
    const m = parseManifest(
      encode(
        minimal(
          [
            {
              path: 'a.bpmn',
              losses: [{ code: 'element-merged', count: 2 }],
              externalPath: 'Vertrieb/\ud800',
              derived: { kind: 'converted', converter: '', llmModel: '\u0000' },
            },
          ],
          { systemVersion: '' },
        ),
      ),
    );
    expect(m.manifest.source.systemVersion).toBe('');
    expect(m.byPath.get('a.bpmn')?.losses).toEqual([{ code: 'element-merged', count: 2 }]);
    expect(parseManifest(encode(minimal([], { systemVersion: '5.0\n1' }))).manifest.source).toEqual(
      { system: 'signavio', systemVersion: '5.0\n1' },
    );
  });
});

describe('uploadedSource', () => {
  const received = parseManifest(
    encode(
      minimal(
        [
          {
            path: 'vertrieb/auftrag.bpmn',
            key: 'vertrieb/auftrag',
            externalId: 'sid-1',
            externalPath: 'Vertrieb/Auftrag',
            url: 'https://tool.example/model/sid-1',
            derived: {
              kind: 'converted',
              converter: 'normalize-bpmn@0.1.0',
              llmModel: null,
              from: [],
            },
            losses: [],
          },
        ],
        {
          systemVersion: null,
          exportedAt: '2026-10-14T00:00:00Z',
          importer: { name: 'x', version: '1' },
          scope: ['Vertrieb'],
        },
      ),
    ),
  );
  const entry = received.byPath.get('vertrieb/auftrag.bpmn');

  it('sets the server fields and the declared ones, nulls and empty losses left out', () => {
    expect(
      uploadedSource(human, { kind: 'import', path: 'vertrieb/auftrag.bpmn' }, received, entry),
    ).toEqual({
      kind: 'import',
      path: 'vertrieb/auftrag.bpmn',
      uploader: 'human',
      manifestSha256: received.sha256,
      system: 'signavio',
      exportedAt: '2026-10-14T00:00:00Z',
      importer: { name: 'x', version: '1' },
      scope: ['Vertrieb'],
      externalId: 'sid-1',
      externalPath: 'Vertrieb/Auftrag',
      url: 'https://tool.example/model/sid-1',
      derived: { kind: 'converted', converter: 'normalize-bpmn@0.1.0', llmModel: null, from: [] },
    });
  });

  it('stores the informational fields tidied: blank ones left out, control characters and lone surrogates replaced', () => {
    const odd = parseManifest(
      encode(
        minimal(
          [
            {
              path: 'a.bpmn',
              externalId: 'sid-1',
              externalPath: ' Vertrieb/\ud800\tAngebot ',
              derived: { kind: 'converted', converter: '  ', llmModel: 'x\u0000y' },
            },
            { path: 'b.bpmn', externalPath: '\n' },
          ],
          { systemVersion: '' },
        ),
      ),
    );
    expect(
      uploadedSource(human, { kind: 'import', path: 'a.bpmn' }, odd, odd.byPath.get('a.bpmn')),
    ).toEqual({
      kind: 'import',
      path: 'a.bpmn',
      uploader: 'human',
      manifestSha256: odd.sha256,
      system: 'signavio',
      externalId: 'sid-1',
      externalPath: 'Vertrieb/\uFFFD Angebot',
      derived: { kind: 'converted', converter: null, llmModel: 'x y' },
    });
    const b = uploadedSource(human, { kind: 'import' }, odd, odd.byPath.get('b.bpmn'));
    expect(b.externalPath).toBeUndefined();
    expect(b.systemVersion).toBeUndefined();
    expect(tidyDeclared(' 5.0\n1 ')).toBe('5.0 1');
    expect(tidyDeclared('')).toBeNull();
    expect(tidyDeclared(null)).toBeNull();
    expect(tidyDeclared('ok 😀')).toBe('ok 😀');
  });

  it('gives a file the manifest does not list, and every file without one, only kind, path and uploader', () => {
    expect(uploadedSource(agent, { kind: 'import', path: 'x.bpmn' }, received, undefined)).toEqual({
      kind: 'import',
      path: 'x.bpmn',
      uploader: 'agent',
    });
    expect(uploadedSource(human, { kind: 'upload' })).toEqual({
      kind: 'upload',
      uploader: 'human',
    });
  });
});

describe('shaMismatch', () => {
  it('warns only when the manifest declares another checksum', () => {
    const hash = 'a'.repeat(64);
    expect(shaMismatch(undefined, hash)).toBeNull();
    expect(shaMismatch({ path: 'a.bpmn' }, hash)).toBeNull();
    expect(shaMismatch({ path: 'a.bpmn', sha256: hash }, hash)).toBeNull();
    expect(shaMismatch({ path: 'a.bpmn', sha256: 'b'.repeat(64) }, hash)).toEqual({
      code: 'manifest-sha-mismatch',
      message: `the file's sha256 aaaaaaaaaaaa… differs from the manifest's bbbbbbbbbbbb…; imported anyway`,
      manifestSha256: 'b'.repeat(64),
      fileSha256: hash,
    });
  });
});

describe('identityWarnings', () => {
  const src = (system: string | undefined, externalId?: string): RevisionSource => ({
    kind: 'import',
    ...(system === undefined ? {} : { system }),
    ...(externalId === undefined ? {} : { externalId }),
  });
  const heads = new Map<string, RevisionSource>([
    ['vertrieb/alt', src('signavio', 'sid-1')],
    ['vertrieb/zwei', src('signavio', 'sid-2')],
    ['interview/entwurf', { kind: 'import', system: 'interview', derived: { kind: 'as-told' } }],
    ['ohne/manifest', { kind: 'import' }],
  ]);

  it('names the other live key of a tool id (external-id-moved)', () => {
    const [w] = identityWarnings(
      [{ key: 'vertrieb/neu', source: src('signavio', 'sid-1'), stored: true }],
      heads,
    );
    expect(w).toEqual([
      {
        code: 'external-id-moved',
        message:
          'signavio id sid-1 already belongs to vertrieb/alt: two models now carry it (moved or renamed in the tool?)',
        system: 'signavio',
        externalId: 'sid-1',
        otherKeys: ['vertrieb/alt'],
      },
    ]);
  });

  it("names the head's other tool id (external-id-changed), also of another system", () => {
    const [same, other] = identityWarnings(
      [
        { key: 'vertrieb/alt', source: src('signavio', 'sid-9'), stored: true },
        { key: 'vertrieb/zwei', source: src('aris', 'sid-2'), stored: false },
      ],
      heads,
    );
    expect(same?.map((w) => [w.code, w.previous, w.message])).toEqual([
      [
        'external-id-changed',
        { system: 'signavio', externalId: 'sid-1' },
        'this file (signavio id sid-9) revised vertrieb/alt, which held signavio id sid-1',
      ],
    ]);
    // Unchanged: nothing was revised, and no provenance-kept next to it.
    expect(other?.map((w) => [w.code, w.previous, w.message])).toEqual([
      [
        'external-id-changed',
        { system: 'signavio', externalId: 'sid-2' },
        'vertrieb/zwei holds signavio id sid-2; this unchanged file declares aris id sid-2',
      ],
    ]);
  });

  it('stays silent for the same id, an as-told draft, a head without a manifest and a file without a tool id', () => {
    expect(
      identityWarnings(
        [
          { key: 'vertrieb/alt', source: src('signavio', 'sid-1'), stored: true },
          { key: 'interview/entwurf', source: src('signavio', 'sid-7'), stored: true },
          { key: 'ohne/manifest', source: src('signavio', 'sid-8'), stored: true },
          { key: 'vertrieb/zwei', source: src('signavio'), stored: true },
          { key: 'x/y', source: { kind: 'upload' }, stored: true },
        ],
        heads,
      ),
    ).toEqual([[], [], [], [], []]);
  });

  it('counts earlier stored files of the request, and what they moved away', () => {
    const warned = identityWarnings(
      [
        // sid-2 moves from vertrieb/zwei to vertrieb/drei: both warn …
        { key: 'vertrieb/drei', source: src('signavio', 'sid-2'), stored: true },
        { key: 'vertrieb/zwei', source: src('signavio', 'sid-5'), stored: true },
        // … and once vertrieb/zwei has sid-5, sid-2 belongs to vertrieb/drei only.
        { key: 'vertrieb/vier', source: src('signavio', 'sid-2'), stored: true },
        // An unchanged file (not stored) keeps its head: sid-6 belongs to nobody after it.
        { key: 'ohne/manifest', source: src('signavio', 'sid-6'), stored: false },
        { key: 'vertrieb/sechs', source: src('signavio', 'sid-6'), stored: true },
        // A stored file without a manifest leaves the key's identity as it was.
        { key: 'vertrieb/sechs', source: { kind: 'upload' }, stored: true },
        { key: 'vertrieb/sieben', source: src('signavio', 'sid-6'), stored: true },
      ],
      heads,
    );
    expect(warned.map((ws) => ws.map((w) => [w.code, w.otherKeys ?? w.previous]))).toEqual([
      [['external-id-moved', ['vertrieb/zwei']]],
      [['external-id-changed', { system: 'signavio', externalId: 'sid-2' }]],
      [['external-id-moved', ['vertrieb/drei']]],
      [['provenance-kept', undefined]],
      [],
      [],
      [['external-id-moved', ['vertrieb/sechs']]],
    ]);
  });

  it('says when an unchanged file keeps a provenance its manifest no longer declares (provenance-kept)', () => {
    const kept = new Map<string, RevisionSource>([
      [
        'vertrieb/angebot',
        {
          ...src('signavio', 'sid-A'),
          externalPath: 'Vertrieb/Angebot',
          url: 'https://t.example/A',
        },
      ],
      ['web/zuerst', { kind: 'upload', uploader: 'human' }],
    ]);
    const [moved, same, undeclared, stored] = identityWarnings(
      [
        {
          key: 'vertrieb/angebot',
          source: {
            ...src('signavio', 'sid-A'),
            externalPath: 'Angebote/Angebot',
            url: 'https://t.example/A',
          },
          stored: false,
        },
        {
          key: 'vertrieb/angebot',
          source: {
            ...src('signavio', 'sid-A'),
            externalPath: 'Vertrieb/Angebot',
            url: 'https://t.example/A',
          },
          stored: false,
        },
        { key: 'web/zuerst', source: src('signavio', 'sid-W'), stored: false },
        { key: 'neu/modell', source: src('signavio', 'sid-N'), stored: true },
      ],
      kept,
    );
    expect(moved).toEqual([
      {
        code: 'provenance-kept',
        message:
          'unchanged, so analyzr keeps its provenance: tool folder Vertrieb/Angebot (this file: ' +
          'Angebote/Angebot); a correction needs changed bytes',
        system: 'signavio',
        externalId: 'sid-A',
      },
    ]);
    expect(same).toEqual([]);
    expect(undeclared?.map((w) => [w.code, w.message])).toEqual([
      [
        'provenance-kept',
        'unchanged, so analyzr keeps what it has for this model: no declared provenance (stored ' +
          'without a manifest); a correction needs changed bytes',
      ],
    ]);
    expect(stored).toEqual([]);
    // A file without a manifest entry never gets it.
    expect(
      identityWarnings([{ key: 'web/zuerst', source: { kind: 'import' }, stored: false }], kept),
    ).toEqual([[]]);
  });

  it('reads the identity only from a system and a tool id', () => {
    expect(identityOf(undefined)).toBeNull();
    expect(identityOf(src('signavio'))).toBeNull();
    expect(identityOf(src('signavio', 'x'))).toEqual({ system: 'signavio', externalId: 'x' });
  });
});

describe('externalIdEntries', () => {
  it('lists the models with a system, by key, filtered by system', () => {
    const sources = new Map<string, RevisionSource>([
      ['b/zwei', { kind: 'import', system: 'aris', externalId: 'A2' }],
      ['a/eins', { kind: 'import', system: 'signavio', externalId: 'S1', externalPath: 'A/Eins' }],
      ['c/drei', { kind: 'import', system: 'signavio', externalPath: 'C/Drei' }],
      ['d/vier', { kind: 'upload' }],
    ]);
    expect(externalIdEntries(sources)).toEqual([
      { key: 'a/eins', system: 'signavio', externalId: 'S1', externalPath: 'A/Eins' },
      { key: 'b/zwei', system: 'aris', externalId: 'A2', externalPath: null },
      { key: 'c/drei', system: 'signavio', externalId: null, externalPath: 'C/Drei' },
    ]);
    expect(externalIdEntries(sources, 'signavio').map((e) => e.key)).toEqual(['a/eins', 'c/drei']);
    expect(externalIdEntries(sources, 'bizagi')).toEqual([]);
  });
});

// ------------------------------------------------------------ extractor-loss

const DEFS =
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs" targetNamespace="http://example.org/bpmn"';
const model = (body: string, doc = '') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS}>
  <bpmn:process id="P_Verlust" name="Verlust" isExecutable="false">${doc}
    <bpmn:startEvent id="Start_V" name="Los"/>
${body}
    <bpmn:endEvent id="End_V" name="Fertig"/>
  </bpmn:process>
</bpmn:definitions>`;
const DUPLICATE = model(`    <bpmn:task id="Task_A" name="Erst"/>
    <bpmn:task id="Task_A" name="Zweit"/>`);
const ILLEGAL = model(`    <bpmn:task id="Aufgabe_Bonität" name="Prüfen"/>
    <bpmn:task id="4711" name="Zahl"/>`);
const UNKNOWN = model(`    <bpmn:unknownThing id="U_1"/>
    <bpmn:task id="Task_B" name="Bleibt"/>`);
const CLEAN = model(`    <bpmn:task id="Task_C" name="Sauber"/>`);

async function lossItems(files: { key: string; bytes: string }[]) {
  const { items } = buildOpenQuestions(await libraryInput(files));
  return items.filter((q) => q.kind === 'extractor-loss');
}

describe('extractor-loss', () => {
  it('asks per model which elements were lost: duplicate and illegal ids, unknown elements', async () => {
    const items = await lossItems([
      { key: 'test/doppelt', bytes: DUPLICATE },
      { key: 'test/illegal', bytes: ILLEGAL },
      { key: 'test/unbekannt', bytes: UNKNOWN },
      { key: 'test/sauber', bytes: CLEAN },
    ]);
    expect(items.map((q) => [q.subject, q.source, q.actions.map((a) => a.type)])).toEqual([
      [{ type: 'model', id: 'test/doppelt' }, 'signal', ['note']],
      [{ type: 'model', id: 'test/illegal' }, 'signal', ['note']],
      [{ type: 'model', id: 'test/unbekannt' }, 'signal', ['note']],
    ]);
    expect(items[0]?.text).toBe(
      'Welche Elemente von „Verlust“ (test/doppelt) sind beim Import verloren gegangen? analyzr ' +
        'hat ein Element übersprungen: doppelte ID „Task_A“. Was dort modelliert ist, fehlt der ' +
        'Analyse. Korrigiere das Modell im Quellsystem (oder lass den Export mit normalize-bpmn ' +
        'normalisieren) und importiere es erneut.',
    );
    expect(items[1]?.text).toContain(
      '2 Elemente übersprungen: ungültige ID „Aufgabe_Bonität“; ungültige ID „4711“.',
    );
    expect(items[2]?.text).toContain('nicht lesbares Element „bpmn:unknownThing“');
    expect(items.every((q) => q.askWho.folder === 'test')).toBe(true);
  });

  it('keeps its id when an amendment elsewhere shifts the lines, and changes it with the losses', async () => {
    const [before] = await lossItems([{ key: 'test/doppelt', bytes: DUPLICATE }]);
    const shifted = DUPLICATE.replace(
      'isExecutable="false">',
      'isExecutable="false">\n    <bpmn:documentation>Neu ergänzt.</bpmn:documentation>',
    );
    const [after] = await lossItems([{ key: 'test/doppelt', bytes: shifted }]);
    expect(after?.id).toBe(before?.id);
    const more = DUPLICATE.replace(
      '<bpmn:endEvent',
      '<bpmn:task id="Task_A" name="Dritt"/>\n    <bpmn:endEvent',
    );
    const [grown] = await lossItems([{ key: 'test/doppelt', bytes: more }]);
    expect(grown?.id).not.toBe(before?.id);
    expect(grown?.text).toContain('2 Elemente übersprungen');
  });

  it('reads the losses from the stored warnings only; other warnings and old revisions raise nothing', () => {
    expect(
      describeLoss({ code: 'missing-id', message: '<bpmn:Task> without id skipped' })?.text,
    ).toBe('ein Element ohne ID (bpmn:Task)');
    expect(
      describeLoss({
        code: 'invalid-id',
        message: '<bpmn:Task> id "a b" is not a valid element id; skipped',
      })?.text,
    ).toBe('ungültige ID „a b“');
    expect(
      describeLoss({
        code: 'duplicate-id',
        message: 'a second task with id X skipped',
        elementId: 'X',
      })?.text,
    ).toBe('doppelte ID „X“');
    expect(
      describeLoss({ code: 'parse-warning', message: 'unresolved reference <Foo>' }),
    ).toBeNull();
    expect(describeLoss({ code: 'label-truncated', message: 'cut to 200 characters' })).toBeNull();
    expect(
      describeLoss({ code: 'too-many-warnings', message: '5 more warnings omitted' }),
    ).toBeNull();
    // What the store keeps: every entry, each cut to 300 characters.
    const long = { code: 'parse-warning', message: `unparsable content <x> ${'y'.repeat(600)}` };
    expect(storedWarnings([long])[0]?.message).toHaveLength(300);
    expect(describeLoss(storedWarnings([long])[0] ?? long)?.text).toBe(
      'nicht lesbares Element „x“',
    );
  });

  it('counts no layout and no vendor element, names a lost process with its content, and reads cut ids', async () => {
    const DI =
      'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" ' +
      'xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC" xmlns:aris="urn:aris"';
    const shape = (id: string) =>
      `<bpmndi:BPMNShape id="${id}_gui" bpmnElement="${id}"><omgdc:Bounds x="1" y="1" width="1" height="1"/></bpmndi:BPMNShape>`;
    // A Signavio export duplicates the shape along with the task: one element lost, not two.
    const withLayout = DUPLICATE.replace(DEFS, `${DEFS} ${DI}`).replace(
      '</bpmn:definitions>',
      `<bpmndi:BPMNDiagram id="Di"><bpmndi:BPMNPlane id="Pl" bpmnElement="P_Verlust">${shape('Task_A')}${shape('Task_A')}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>\n</bpmn:definitions>`,
    );
    // A vendor's element outside extensionElements is no lost BPMN content.
    const vendor = UNKNOWN.replace(DEFS, `${DEFS} ${DI}`).replace(
      '<bpmn:unknownThing id="U_1"/>',
      '<aris:objectInfo id="O_1"/>',
    );
    const process = CLEAN.replace('id="P_Verlust"', 'id="4711"');
    const long = model(`    <bpmn:task id="9${'9'.repeat(399)}" name="Lang"/>`);
    const items = await lossItems([
      { key: 'test/layout', bytes: withLayout },
      { key: 'test/lang', bytes: long },
      { key: 'test/prozess', bytes: process },
      { key: 'test/vendor', bytes: vendor },
    ]);
    expect(items.map((q) => q.subject.id)).toEqual(['test/lang', 'test/layout', 'test/prozess']);
    // The stored message is cut to 300 characters inside the id: its beginning is shown.
    expect(items[0]?.text).toMatch(/hat ein Element übersprungen: ungültige ID „9{100,}…“\./);
    expect(items[1]?.text).toContain('hat ein Element übersprungen: doppelte ID „Task_A“.');
    expect(items[2]?.text).toContain(
      'hat mindestens ein Element übersprungen: Prozess mit ungültiger ID „4711“ (samt Inhalt).',
    );
    expect(
      describeLoss({
        code: 'parse-warning',
        message:
          'unparsable content <sbpmndi:BPMNEdge> detected line: 4 column: 73 nested error: duplicate ID <E>',
      }),
    ).toBeNull();
    expect(
      describeLoss({
        code: 'parse-warning',
        message:
          'unparsable content <bpmn:subProcess> detected line: 2 column: 4 nested error: duplicate ID <S>',
      }),
    ).toEqual({ text: 'Teilprozess mit doppelter ID „S“ (samt Inhalt)', container: true });
  });

  it('says „mindestens“ when the extractor stopped listing after 100 warnings', async () => {
    const tasks = Array.from(
      { length: 150 },
      (_, i) =>
        `    <bpmn:task id="T_${i}" name="Erst"/>\n    <bpmn:task id="T_${i}" name="Zweit"/>`,
    ).join('\n');
    const [item] = await lossItems([{ key: 'test/viele', bytes: model(tasks) }]);
    expect(item?.text).toContain('hat mindestens 100 Elemente übersprungen: doppelte ID „T_0“;');
    expect(item?.text).toContain('und 90 weitere.');
  });
});

// ------------------------------------------------------------ change list

describe('the change list names where a model lives in its source tool', () => {
  it('adds the tool folder and the link from the uploaded revision', () => {
    const origin = originOf({
      kind: 'import',
      system: 'signavio',
      externalPath: 'Vertrieb/Auftrag_(neu)',
      url: 'https://tool.example/a b(c)',
    });
    expect(origin).toEqual({
      system: 'signavio',
      externalPath: 'Vertrieb/Auftrag_(neu)',
      url: 'https://tool.example/a b(c)',
    });
    expect(originOf({ kind: 'import' })).toBeNull();
    expect(originOf({ kind: 'import', system: 's', url: 'javascript:x' })?.url).toBeNull();
    const amendment = {
      id: 'mam_01J9Z3N4X5Q6R7S8T9V0W1X2M1',
      modelKey: 'vertrieb/auftrag',
      before: null,
      after: 'x',
      by: 'owner',
      at: '2026-10-17T00:00:00.000Z',
      seq: 3,
      state: 'applied',
      conflict: null,
      withdrawal: null,
      modelDeleted: false,
    } as unknown as ModelAmendment;
    const md = renderChangeListMarkdown(
      [
        {
          amendment,
          modelName: 'Auftrag',
          ...(origin ? { origin } : {}),
          place: null,
          lanes: [],
          element: 'Endereignis ohne Namen (ID End_A)',
          field: 'Name',
          readers: [],
        },
      ],
      { projectName: 'P', projectKey: 'p', seq: 3, filter: {}, since: undefined },
    );
    expect(md).toContain(
      'Im Quellsystem (signavio): Vertrieb/Auftrag\\_(neu) · [Im Quellsystem öffnen](https://tool.example/a%20b%28c%29)',
    );
  });
});
