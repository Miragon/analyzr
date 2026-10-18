/**
 * Typed provenance, the manifest and stable identity end to end (M6 §3.2–§3.4,
 * §4.3, slice S2a) with the real libraries and a real PostgreSQL. Requires
 * (§8 "S2"):
 * - the integrate plugin's golden bundle (`tools/integrate/test/fixtures/
 *   signavio/bundle`) imports with its manifest as the part `manifest`: every
 *   uploaded revision carries the declared provenance plus `uploader` and
 *   `manifestSha256`, and the key map rebuilt from `GET …/external-ids`
 *   equals the one the bundle was written with (its manifest's key, tool id
 *   and tool folder per file);
 * - provenance round trips through PUT (`Analyzr-Manifest`) and import; a
 *   manifest's pinned key wins over the path; a checksum mismatch is the
 *   warning `manifest-sha-mismatch` and the file is imported;
 *   `external-id-moved` and `external-id-changed` appear in their cases and
 *   not for an as-told draft without a tool id; an invalid manifest refuses
 *   the request;
 * - identical bytes stay `unchanged` and keep their first provenance, and
 *   `provenance-kept` says so when a folder moved in the tool; an upload
 *   without a manifest keeps a declared identity (`external-ids` and the
 *   warnings read the newest declared revision);
 * - an export's empty or odd informational fields are stored tidied, the
 *   scope round trips, and values jsonb cannot hold (a NUL, a lone
 *   surrogate) or credentials in a link refuse the manifest (422), not 500;
 * - an amended head follows `source.upstream`: the provenance stays on the
 *   uploaded revision, `external-ids`, the identity warnings and the change
 *   list read it there, and a re-import puts the new provenance on the new
 *   uploaded revision;
 * - `extract_warnings` is written at insert (`[]` without warnings) and
 *   `extractor-loss` asks about the lost elements of synthetic fixtures;
 *   migration 0017 leaves older revisions null.
 */
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ExternalIdList,
  ImportResult,
  OpenQuestionPage,
  PutModelResult,
  type ImportManifest,
  type OpenQuestion,
  type Revision,
  type RevisionPage,
} from '@analyzr/contracts';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { createDatabase } from '../../src/db/client.ts';
import { MIGRATIONS_DIR, runMigrations } from '../../src/db/migrate.ts';
import { LAGER_KEY, lager } from '../support/amend-fixtures.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';

const BUNDLE = fileURLToPath(
  new URL('../../../../tools/integrate/test/fixtures/signavio/bundle/', import.meta.url),
);

let database: TestDatabase;
let t: TestApp;

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis });
  for (const p of ['bundle', 'ident', 'put', 'amended', 'loss']) await t.createProject(p);
});

afterAll(async () => {
  await database.drop();
});

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const DEFS =
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://example.org/bpmn"';

/** A small descriptive model; `task` changes its bytes and facts. */
function bpmn(id: string, task = 'Prüfen', body = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} id="Defs_${id}">
  <bpmn:process id="Process_${id}" name="${id}" isExecutable="false">
    <bpmn:documentation>Prozess ${id}.</bpmn:documentation>
    <bpmn:startEvent id="Start_${id}" name="Los"/>
    <bpmn:task id="Task_${id}" name="${task}"/>${body}
    <bpmn:endEvent id="End_${id}" name="Fertig"/>
  </bpmn:process>
</bpmn:definitions>
`;
}

function manifestOf(
  files: ImportManifest['files'],
  source: Partial<ImportManifest['source']> = {},
): ImportManifest {
  return { format: 'analyzr-import/1', source: { system: 'signavio', ...source }, files };
}

async function importFiles(
  project: string,
  files: { path: string; bytes: Uint8Array | string }[],
  manifest?: ImportManifest | string,
): Promise<Response> {
  const form = new FormData();
  for (const f of files) form.append('files', new Blob([f.bytes]), f.path);
  if (manifest !== undefined) {
    form.append('manifest', typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  }
  return t.asOwner(`/api/v1/projects/${project}/imports`, { method: 'POST', body: form });
}

async function imported(
  project: string,
  files: { path: string; bytes: Uint8Array | string }[],
  manifest?: ImportManifest | string,
): Promise<ImportResult['files']> {
  const res = await importFiles(project, files, manifest);
  const text = await res.text();
  expect(res.status, text.slice(0, 800)).toBe(200);
  return ImportResult.parse(JSON.parse(text)).files;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await t.asOwner(path);
  const text = await res.text();
  expect(res.status, `${path}: ${text.slice(0, 600)}`).toBe(200);
  return JSON.parse(text) as T;
}

async function modelId(project: string, key: string): Promise<string> {
  const page = await getJson<{ items: { id: string; key: string }[] }>(
    `/api/v1/projects/${project}/models?limit=200`,
  );
  const m = page.items.find((i) => i.key === key);
  if (!m) throw new Error(`no model ${key} in ${project}`);
  return m.id;
}

async function revisions(project: string, key: string): Promise<Revision[]> {
  const id = await modelId(project, key);
  return (await getJson<RevisionPage>(`/api/v1/projects/${project}/models/${id}/revisions`)).items;
}

async function externalIds(project: string, system?: string): Promise<ExternalIdList> {
  const q = system === undefined ? '' : `?system=${system}`;
  return ExternalIdList.parse(await getJson(`/api/v1/projects/${project}/external-ids${q}`));
}

/** `PUT …/models/by-key/{key}` with an optional `Analyzr-Manifest` header (base64url JSON). */
function put(project: string, key: string, xml: string, manifest?: unknown, raw?: string) {
  const header =
    raw ??
    (manifest === undefined
      ? undefined
      : Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64url'));
  return t.asOwner(`/api/v1/projects/${project}/models/by-key/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/xml',
      ...(header === undefined ? {} : { 'analyzr-manifest': header }),
    },
    body: xml,
  });
}

async function storedWarnings(project: string): Promise<{ key: string; warnings: unknown }[]> {
  const rows = await database.db.execute<{ key: string; warnings: unknown }>(sql`
    select m.key, r.extract_warnings as warnings
    from model_revision r join model m on m.project_id = r.project_id and m.id = r.model_id
    join project p on p.id = r.project_id
    where p.key = ${project} order by m.key, r.rev`);
  return rows.rows;
}

// --------------------------------------------------------------- the bundle

describe('the integrate plugin’s golden bundle with its manifest', () => {
  let manifest: ImportManifest;
  let sent: string;
  let files: { path: string; bytes: Uint8Array }[];

  beforeAll(async () => {
    manifest = JSON.parse(
      await readFile(join(BUNDLE, 'analyzr-import.json'), 'utf8'),
    ) as ImportManifest;
    sent = JSON.stringify(manifest);
    const entries = (await readdir(BUNDLE, { recursive: true }))
      .map((e) => e.split('\\').join('/'))
      .filter((e) => e.endsWith('.bpmn'))
      .sort();
    files = await Promise.all(
      entries.map(async (p) => ({
        path: p,
        bytes: new Uint8Array(await readFile(join(BUNDLE, p))),
      })),
    );
  });

  it('imports every file under its pinned key without a warning', async () => {
    // As the CLI sends it: compact JSON (a text part's line breaks would become CRLF).
    const result = await imported('bundle', files, sent);
    expect(result.map((f) => [f.modelKey, f.outcome])).toEqual(
      manifest.files.map((f) => [f.key, 'created']),
    );
    // Normalized by normalize-bpmn and matching their checksums: no warning of either kind.
    expect(result.filter((f) => f.warnings || f.importWarnings)).toEqual([]);
  });

  it('stores the declared provenance on each uploaded revision, with uploader and manifestSha256', async () => {
    for (const entry of manifest.files) {
      const [rev] = await revisions('bundle', entry.key ?? '');
      expect(rev?.source, entry.path).toEqual({
        kind: 'import',
        path: entry.path,
        uploader: 'human',
        manifestSha256: sha(sent),
        system: 'signavio',
        systemVersion: '19.6.0',
        exportedAt: '2026-10-14T00:00:00Z',
        importer: { name: 'analyzr-integrate/normalize-bpmn', version: '0.1.0' },
        externalId: entry.externalId,
        externalPath: entry.externalPath,
        derived: entry.derived,
        ...(entry.losses ? { losses: entry.losses } : {}),
      });
    }
  });

  it('rebuilds the key map the bundle was written with from GET …/external-ids', async () => {
    // The bundle's manifest is written from the confirmed keymap.json: per file its key, tool
    // id and tool folder (tools/integrate src/bundle.ts writeBundle).
    const keymapEntries = manifest.files
      .map((f) => ({ key: f.key, externalId: f.externalId ?? null, externalPath: f.externalPath }))
      .sort((a, b) => ((a.key ?? '') < (b.key ?? '') ? -1 : 1));
    const rebuilt = (await externalIds('bundle', 'signavio')).items.map(
      ({ key, externalId, externalPath }) => ({ key, externalId, externalPath }),
    );
    expect(rebuilt).toEqual(keymapEntries);
    expect((await externalIds('bundle')).items.every((i) => i.system === 'signavio')).toBe(true);
    expect((await externalIds('bundle', 'aris')).items).toEqual([]);
    expect((await t.asOwner('/api/v1/projects/bundle/external-ids?system=ARIS')).status).toBe(422);
  });

  it('stores the (absent) extractor warnings of every revision as []', async () => {
    expect((await storedWarnings('bundle')).map((r) => r.warnings)).toEqual(
      manifest.files.map(() => []),
    );
  });

  it('keeps the first provenance for identical bytes, and says so when a folder moved in the tool', async () => {
    // Moving a model to another folder leaves a Signavio export's bytes as they were.
    const later = manifestOf(
      manifest.files.map((f) => ({ ...f, externalPath: `Verschoben/${f.externalPath ?? ''}` })),
      { systemVersion: '20.0.0', exportedAt: '2026-11-01T00:00:00Z' },
    );
    const result = await imported('bundle', files, later);
    expect(result.every((f) => f.outcome === 'unchanged')).toBe(true);
    expect(result.map((f) => f.importWarnings?.map((w) => w.code))).toEqual(
      manifest.files.map(() => ['provenance-kept']),
    );
    const versand = result.find((f) => f.modelKey === 'logistik/versand');
    expect(versand?.importWarnings?.[0]?.message).toBe(
      'unchanged, so analyzr keeps its provenance: tool folder Gemeinsame Dokumente/Logistik/Versand ' +
        '(this file: Verschoben/Gemeinsame Dokumente/Logistik/Versand); a correction needs changed bytes',
    );
    // The same manifest again (only the export date and version differ): quiet.
    const same = await imported(
      'bundle',
      files,
      manifestOf(manifest.files, { systemVersion: '20.0.0', exportedAt: '2026-11-01T00:00:00Z' }),
    );
    expect(same.every((f) => f.outcome === 'unchanged' && !f.importWarnings)).toBe(true);
    const [rev, ...older] = await revisions('bundle', 'logistik/versand');
    expect(older).toEqual([]);
    expect(rev?.source).toMatchObject({
      systemVersion: '19.6.0',
      externalPath: 'Gemeinsame Dokumente/Logistik/Versand',
    });
    expect((await externalIds('bundle')).items.map((i) => i.externalPath)).toEqual(
      manifest.files.map((f) => f.externalPath),
    );
  });
});

// --------------------------------------------------------------- identity

describe('pinned keys, checksums and the identity warnings', () => {
  it('lets a pinned key win over the path, and a file the manifest does not list keep its path key', async () => {
    const result = await imported(
      'ident',
      [
        { path: 'Gemeinsame Dokumente/Vertrieb/Auftrag (neu).bpmn', bytes: bpmn('Auftrag') },
        { path: 'Ohne Eintrag.bpmn', bytes: bpmn('Ohne') },
      ],
      manifestOf([
        {
          path: 'Gemeinsame Dokumente/Vertrieb/Auftrag (neu).bpmn',
          key: 'vertrieb/auftrag',
          externalId: 'sid-1',
          externalPath: 'Vertrieb/Auftrag',
        },
      ]),
    );
    expect(result.map((f) => [f.path, f.modelKey, f.outcome])).toEqual([
      ['Gemeinsame Dokumente/Vertrieb/Auftrag (neu).bpmn', 'vertrieb/auftrag', 'created'],
      ['Ohne Eintrag.bpmn', 'ohne-eintrag', 'created'],
    ]);
    const [unlisted] = await revisions('ident', 'ohne-eintrag');
    expect(unlisted?.source).toEqual({
      kind: 'import',
      path: 'Ohne Eintrag.bpmn',
      uploader: 'human',
    });
  });

  it('warns about a checksum mismatch and imports the file', async () => {
    const xml = bpmn('Rechnung');
    const [file] = await imported(
      'ident',
      [{ path: 'finanzen/rechnung.bpmn', bytes: xml }],
      manifestOf([{ path: 'finanzen/rechnung.bpmn', externalId: 'sid-2', sha256: '0'.repeat(64) }]),
    );
    expect(file).toMatchObject({ modelKey: 'finanzen/rechnung', outcome: 'created' });
    expect(file?.importWarnings).toEqual([
      expect.objectContaining({
        code: 'manifest-sha-mismatch',
        manifestSha256: '0'.repeat(64),
        fileSha256: sha(xml),
      }),
    ]);
    // A matching checksum is quiet.
    const [again] = await imported(
      'ident',
      [{ path: 'finanzen/rechnung.bpmn', bytes: bpmn('Rechnung', 'Neu') }],
      manifestOf([
        {
          path: 'finanzen/rechnung.bpmn',
          externalId: 'sid-2',
          sha256: sha(bpmn('Rechnung', 'Neu')),
        },
      ]),
    );
    expect(again).toMatchObject({ outcome: 'revised' });
    expect(again?.importWarnings).toBeUndefined();
  });

  it('warns when a tool id already belongs to another live key (external-id-moved)', async () => {
    const [moved] = await imported(
      'ident',
      [{ path: 'vertrieb/auftragsabwicklung.bpmn', bytes: bpmn('Auftrag', 'Umbenannt') }],
      manifestOf([{ path: 'vertrieb/auftragsabwicklung.bpmn', externalId: 'sid-1' }]),
    );
    expect(moved).toMatchObject({ modelKey: 'vertrieb/auftragsabwicklung', outcome: 'created' });
    expect(moved?.importWarnings).toEqual([
      {
        code: 'external-id-moved',
        message:
          'signavio id sid-1 already belongs to vertrieb/auftrag: two models now carry it (moved or renamed in the tool?)',
        system: 'signavio',
        externalId: 'sid-1',
        otherKeys: ['vertrieb/auftrag'],
      },
    ]);
  });

  it("warns when the key's head carries another tool id (external-id-changed), and imports", async () => {
    const [changed] = await imported(
      'ident',
      [{ path: 'finanzen/rechnung.bpmn', bytes: bpmn('Rechnung', 'Aus ARIS') }],
      manifestOf([{ path: 'finanzen/rechnung.bpmn', externalId: 'A-77' }], { system: 'aris' }),
    );
    expect(changed).toMatchObject({ outcome: 'revised' });
    expect(changed?.importWarnings).toEqual([
      expect.objectContaining({
        code: 'external-id-changed',
        system: 'aris',
        externalId: 'A-77',
        previous: { system: 'signavio', externalId: 'sid-2' },
      }),
    ]);
    expect((await externalIds('ident', 'aris')).items).toEqual([
      { key: 'finanzen/rechnung', system: 'aris', externalId: 'A-77', externalPath: null },
    ]);
  });

  it('stays silent when the real model replaces an as-told draft without a tool id', async () => {
    const [draft] = await imported(
      'ident',
      [{ path: 'einkauf/bestellung.bpmn', bytes: bpmn('Bestellung', 'Erzählt') }],
      manifestOf(
        [{ path: 'einkauf/bestellung.bpmn', derived: { kind: 'as-told', from: ['src-1'] } }],
        { system: 'interview' },
      ),
    );
    expect(draft?.importWarnings).toBeUndefined();
    const [real] = await imported(
      'ident',
      [{ path: 'einkauf/bestellung.bpmn', bytes: bpmn('Bestellung', 'Modelliert') }],
      manifestOf([{ path: 'einkauf/bestellung.bpmn', externalId: 'sid-9' }]),
    );
    expect(real).toMatchObject({ outcome: 'revised' });
    expect(real?.importWarnings).toBeUndefined();
  });

  it('keeps a declared identity when an upload without a manifest revises the model', async () => {
    await imported(
      'ident',
      [{ path: 'lager/kommission.bpmn', bytes: bpmn('Kommission') }],
      manifestOf([
        { path: 'lager/kommission.bpmn', externalId: 'sid-K', externalPath: 'Lager/Kommission' },
      ]),
    );
    // „Hochladen“ in the web sends no manifest (M6 S2a): new bytes, no declared provenance.
    const res = await put('ident', 'lager/kommission', bpmn('Kommission', 'Neu im Web'));
    expect(res.status).toBe(200);
    expect(PutModelResult.parse(await res.json()).revision.source).toEqual({
      kind: 'upload',
      uploader: 'human',
    });
    expect(
      (await externalIds('ident', 'signavio')).items.find((i) => i.key === 'lager/kommission'),
    ).toEqual({
      key: 'lager/kommission',
      system: 'signavio',
      externalId: 'sid-K',
      externalPath: 'Lager/Kommission',
    });
    // The identity still protects the model.
    const [moved] = await imported(
      'ident',
      [{ path: 'lager/kommissionierung.bpmn', bytes: bpmn('Kommissionierung') }],
      manifestOf([{ path: 'lager/kommissionierung.bpmn', externalId: 'sid-K' }]),
    );
    expect(moved?.importWarnings?.map((w) => [w.code, w.otherKeys])).toEqual([
      ['external-id-moved', ['lager/kommission']],
    ]);
  });

  it("accepts an export's empty or odd informational fields and stores them tidied, and stores the scope", async () => {
    // The integrate plugin 0.1.0 writes an export's exporterVersion="" as systemVersion "".
    const [file] = await imported(
      'ident',
      [{ path: 'einkauf/anfrage.bpmn', bytes: bpmn('Anfrage') }],
      manifestOf(
        [
          {
            path: 'einkauf/anfrage.bpmn',
            externalId: 'sid-E',
            externalPath: 'Einkauf/\u0000Anfrage\ud800',
            derived: { kind: 'converted', converter: '' },
          },
        ],
        { systemVersion: '', scope: ['Einkauf', 'Lager/Wareneingang'] },
      ),
    );
    expect(file).toMatchObject({ outcome: 'created' });
    const [rev] = await revisions('ident', 'einkauf/anfrage');
    expect(rev?.source).toMatchObject({
      system: 'signavio',
      scope: ['Einkauf', 'Lager/Wareneingang'],
      externalPath: 'Einkauf/ Anfrage\uFFFD',
      derived: { kind: 'converted', converter: null },
    });
    expect(rev?.source.systemVersion).toBeUndefined();
  });

  it('refuses a manifest whose values PostgreSQL cannot store, and imports none of the files', async () => {
    const before = (await storedWarnings('ident')).length;
    for (const entry of [
      { path: 'nul.bpmn', url: 'https://tool.example/a\u0000b' },
      { path: 'nul.bpmn', externalId: 'ok\ud800' },
      { path: 'nul.bpmn', url: 'https://user:secret@tool.example/x' },
    ]) {
      const res = await importFiles(
        'ident',
        [
          { path: 'nul.bpmn', bytes: bpmn('Nul') },
          { path: 'sauber.bpmn', bytes: bpmn('Sauber') },
        ],
        JSON.stringify(manifestOf([entry])),
      );
      const text = await res.text();
      expect(res.status, text).toBe(422);
      expect(JSON.parse(text)).toMatchObject({
        code: 'validation-failed',
        reason: 'invalid-manifest',
      });
    }
    expect((await storedWarnings('ident')).length).toBe(before);
  });

  it('refuses an invalid manifest before importing anything', async () => {
    const before = (await storedWarnings('ident')).length;
    for (const bad of [
      '{',
      JSON.stringify({ format: 'analyzr-import/1', source: { system: 'signavio' } }),
      JSON.stringify(manifestOf([{ path: 'x.bpmn', key: 'X' }])),
    ]) {
      const res = await importFiles('ident', [{ path: 'x.bpmn', bytes: bpmn('X') }], bad);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: 'validation-failed',
        reason: 'invalid-manifest',
      });
    }
    const two = new FormData();
    two.append('files', new Blob([bpmn('X')]), 'x.bpmn');
    two.append('manifest', JSON.stringify(manifestOf([])));
    two.append('manifest', JSON.stringify(manifestOf([])));
    const res = await t.asOwner('/api/v1/projects/ident/imports', { method: 'POST', body: two });
    expect(res.status).toBe(422);
    expect((await storedWarnings('ident')).length).toBe(before);
  });
});

// --------------------------------------------------------------- PUT

describe('PUT with the header Analyzr-Manifest', () => {
  const one = (entry: Record<string, unknown>, source: Record<string, unknown> = {}) => ({
    format: 'analyzr-import/1',
    source: { system: 'signavio', exportedAt: '2026-10-14T09:12Z', ...source },
    files: [{ path: 'Vertrieb/Angebot.bpmn', ...entry }],
  });

  it('stores the declared provenance on the uploaded revision (round trip)', async () => {
    const xml = bpmn('Angebot');
    const res = await put(
      'put',
      'vertrieb/angebot',
      xml,
      one({
        key: 'vertrieb/angebot',
        externalId: 'sid-A',
        externalPath: 'Vertrieb/Angebot',
        url: 'https://tool.example/sid-A',
        derived: { kind: 'export' },
        sha256: sha(xml),
      }),
    );
    expect(res.status).toBe(201);
    const result = PutModelResult.parse(await res.json());
    expect(result.importWarnings).toBeUndefined();
    expect(result.revision.source).toEqual({
      kind: 'upload',
      path: 'Vertrieb/Angebot.bpmn',
      uploader: 'human',
      manifestSha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      system: 'signavio',
      exportedAt: '2026-10-14T09:12Z',
      externalId: 'sid-A',
      externalPath: 'Vertrieb/Angebot',
      url: 'https://tool.example/sid-A',
      derived: { kind: 'export' },
    });
    expect((await revisions('put', 'vertrieb/angebot'))[0]?.source).toEqual(result.revision.source);
    // Without the header: kind and uploader only, as every upload since S2a.
    const plain = PutModelResult.parse(
      await (await put('put', 'vertrieb/ohne', bpmn('Ohne'))).json(),
    );
    expect(plain.revision.source).toEqual({ kind: 'upload', uploader: 'human' });
    expect(plain.importWarnings).toBeUndefined();
  });

  it('answers the import warnings: a checksum mismatch and a moved tool id', async () => {
    const res = await put(
      'put',
      'vertrieb/angebot-neu',
      bpmn('AngebotNeu'),
      one({ externalId: 'sid-A', sha256: 'f'.repeat(64) }),
    );
    expect(res.status).toBe(201);
    const result = PutModelResult.parse(await res.json());
    expect(result.importWarnings?.map((w) => w.code)).toEqual([
      'manifest-sha-mismatch',
      'external-id-moved',
    ]);
  });

  it('refuses a manifest naming another key, several files, or no base64url', async () => {
    const xml = bpmn('Zwei');
    for (const [manifest, raw] of [
      [one({ key: 'vertrieb/anders' }), undefined],
      [{ ...one({}), files: [{ path: 'a.bpmn' }, { path: 'b.bpmn' }] }, undefined],
      [{ ...one({}), files: [] }, undefined],
      [undefined, 'kein base64!'],
      [undefined, Buffer.from('{').toString('base64url')],
      // What jsonb cannot hold: a lone surrogate in the path (it becomes `source.path`).
      [
        undefined,
        Buffer.from(JSON.stringify({ ...one({}), files: [{ path: 'V\ud800.bpmn' }] })).toString(
          'base64url',
        ),
      ],
    ] as const) {
      const res = await put('put', 'vertrieb/zwei', xml, manifest, raw);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        code: 'validation-failed',
        reason: 'invalid-manifest',
      });
    }
    expect(
      (await getJson<{ items: { key: string }[] }>('/api/v1/projects/put/models')).items.map(
        (m) => m.key,
      ),
    ).not.toContain('vertrieb/zwei');
  });
});

// --------------------------------------------------------------- amended heads

describe('an amended head follows source.upstream', () => {
  const API = '/api/v1/projects/amended';

  async function changeList(): Promise<string> {
    const res = await t.asOwner(`${API}/amendments/export?format=markdown`);
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(200);
    return text;
  }

  async function amendDocumentation(after: string) {
    const id = await modelId('amended', LAGER_KEY);
    const m = await getJson<{ headRev: number }>(`${API}/models/${id}`);
    const res = await t.asOwner(`${API}/models/${id}/amendments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': `"r${m.headRev}"` },
      body: JSON.stringify({
        items: [{ elementId: 'Process_Lager', op: 'process-documentation', after }],
      }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
  }

  it('keeps the provenance on the uploaded revision and reads it there', async () => {
    await imported(
      'amended',
      [{ path: 'lager/einlagerung.bpmn', bytes: lager() }],
      manifestOf([
        { path: 'lager/einlagerung.bpmn', externalId: 'sid-L', externalPath: 'Lager/Einlagerung' },
      ]),
    );
    await amendDocumentation('Lagert Ware ein.');
    const [amendedHead, uploaded] = await revisions('amended', LAGER_KEY);
    expect(amendedHead?.source).toMatchObject({ kind: 'amendment', uploader: 'human' });
    expect(amendedHead?.source.upstream?.revisionId).toBe(uploaded?.id);
    expect(amendedHead?.source.externalId).toBeUndefined();
    expect(uploaded?.source).toMatchObject({ kind: 'import', externalId: 'sid-L' });
    expect((await externalIds('amended')).items).toEqual([
      {
        key: LAGER_KEY,
        system: 'signavio',
        externalId: 'sid-L',
        externalPath: 'Lager/Einlagerung',
      },
    ]);
    // The change list names where the model lives in the source tool, from upstream.
    expect(await changeList()).toContain('Im Quellsystem (signavio): Lager/Einlagerung\n');
  });

  it('puts a re-import’s provenance on the new uploaded revision; the warnings compare with upstream', async () => {
    const reexport = `${lager()}<!-- re-export -->\n`;
    const [same] = await imported(
      'amended',
      [{ path: 'lager/einlagerung.bpmn', bytes: reexport }],
      manifestOf([
        { path: 'lager/einlagerung.bpmn', externalId: 'sid-L', externalPath: 'Lager/Neu' },
      ]),
    );
    expect(same).toMatchObject({ outcome: 'revised', amendments: { applied: { count: 1 } } });
    expect(same?.importWarnings).toBeUndefined();
    const [amendedHead, uploaded] = await revisions('amended', LAGER_KEY);
    expect(amendedHead?.source.kind).toBe('amendment');
    expect(amendedHead?.source.upstream?.revisionId).toBe(uploaded?.id);
    expect(uploaded?.source).toMatchObject({ kind: 'import', externalPath: 'Lager/Neu' });
    expect((await externalIds('amended')).items[0]?.externalPath).toBe('Lager/Neu');
    expect(await changeList()).toContain('Im Quellsystem (signavio): Lager/Neu\n');
    // Another tool id against the amended head's upstream.
    const [changed] = await imported(
      'amended',
      [{ path: 'lager/einlagerung.bpmn', bytes: `${reexport}<!-- 2 -->\n` }],
      manifestOf([{ path: 'lager/einlagerung.bpmn', externalId: 'sid-X' }]),
    );
    expect(changed?.importWarnings?.map((w) => [w.code, w.previous])).toEqual([
      ['external-id-changed', { system: 'signavio', externalId: 'sid-L' }],
    ]);
  });
});

// --------------------------------------------------------------- warnings

describe('stored extractor warnings and extractor-loss', () => {
  const duplicate = bpmn(
    'Doppelt',
    'Erst',
    '\n    <bpmn:task id="Task_Doppelt" name="Zweit"/>\n    <bpmn:unknownThing id="U_1"/>',
  );
  const illegal = bpmn('Illegal', 'Gut', '\n    <bpmn:task id="Aufgabe_Bonität" name="Prüfen"/>');

  it('writes the warnings at insert and asks about the lost elements', async () => {
    const result = await imported('loss', [
      { path: 'test/doppelt.bpmn', bytes: duplicate },
      { path: 'test/illegal.bpmn', bytes: illegal },
      { path: 'test/sauber.bpmn', bytes: bpmn('Sauber') },
    ]);
    expect(result.map((f) => [f.modelKey, f.warningCount ?? 0])).toEqual([
      ['test/doppelt', 2],
      ['test/illegal', 1],
      ['test/sauber', 0],
    ]);
    const stored = await storedWarnings('loss');
    expect(
      stored.map((r) => [r.key, (r.warnings as { code: string }[]).map((w) => w.code)]),
    ).toEqual([
      ['test/doppelt', ['parse-warning', 'parse-warning']],
      ['test/illegal', ['parse-warning']],
      ['test/sauber', []],
    ]);
    const page = OpenQuestionPage.parse(
      await getJson('/api/v1/projects/loss/open-questions?kind=extractor-loss&limit=200'),
    );
    const items: OpenQuestion[] = page.items;
    expect(items.map((q) => [q.subject.id, q.source])).toEqual([
      ['test/doppelt', 'signal'],
      ['test/illegal', 'signal'],
    ]);
    expect(items[0]?.detail).toContain(
      '2 Elemente übersprungen: doppelte ID „Task_Doppelt“; nicht lesbares Element „bpmn:unknownThing“.',
    );
    expect(items[1]?.detail).toContain('ein Element übersprungen: ungültige ID „Aufgabe_Bonität“.');
  });

  it('drops the question once a clean export replaces the model', async () => {
    await imported('loss', [{ path: 'test/doppelt.bpmn', bytes: bpmn('Doppelt', 'Repariert') }]);
    const page = OpenQuestionPage.parse(
      await getJson('/api/v1/projects/loss/open-questions?kind=extractor-loss&limit=200'),
    );
    expect(page.items.map((q) => q.subject.id)).toEqual(['test/illegal']);
  });
});

describe('migration 0017 on a database with revisions', () => {
  it('leaves the revisions stored before it without warnings (null)', async () => {
    const name = `analyzr_mig17_${randomBytes(6).toString('hex')}`;
    const admin = async (statement: string) => {
      const client = new pg.Client({ connectionString: inject('adminDatabaseUrl') });
      await client.connect();
      try {
        await client.query(statement);
      } finally {
        await client.end();
      }
    };
    await admin(`CREATE DATABASE "${name}"`);
    const url = new URL(inject('adminDatabaseUrl'));
    url.pathname = `/${name}`;
    const db = createDatabase(url.toString(), { max: 2 });
    const before = await mkdtemp(join(tmpdir(), 'analyzr-mig17-'));
    try {
      await cp(MIGRATIONS_DIR, before, { recursive: true });
      const journalPath = join(before, 'meta', '_journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
        entries: { tag: string }[];
      };
      journal.entries = journal.entries.filter((e) => e.tag < '0017');
      await writeFile(journalPath, JSON.stringify(journal));
      await migrate(db.db, { migrationsFolder: before });
      const P = 'prj_01J9Z3N4X5Q6R7S8T9V0W1X2M7';
      const OWNER = 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2M7';
      await db.db.execute(
        sql.raw(`
          INSERT INTO project (id, key, name) VALUES ('${P}', 'mig17', 'Migration 17');
          INSERT INTO principal (id, kind, iss, subject, handle) VALUES ('${OWNER}', 'user', 'urn:analyzr:local', 'owner', 'owner');
          INSERT INTO model (id, project_id, key, name) VALUES ('mdl_m17', '${P}', 'a/b', 'B');
          INSERT INTO model_revision (id, project_id, model_id, rev, xml, content_hash, facts_hash, facts_version,
                                      processes, message_flows, source, principal_id, seq)
            VALUES ('rev_m17', '${P}', 'mdl_m17', 1, '\\x3c782f3e', 'c', 'f', '1', '[]', '[]',
                    '{"kind":"import","path":"a/b.bpmn"}', '${OWNER}', 1);
        `),
      );
      await runMigrations(db.db);
      const rows = await db.db.execute(
        sql.raw(`SELECT id, extract_warnings, source FROM model_revision`),
      );
      expect(rows.rows).toEqual([
        { id: 'rev_m17', extract_warnings: null, source: { kind: 'import', path: 'a/b.bpmn' } },
      ]);
    } finally {
      await db.close();
      await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await rm(before, { recursive: true, force: true });
    }
  });
});
