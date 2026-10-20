/**
 * Migrations 0021 and 0022 (M6 S2b follow-up step 5, owner decision 29 (1))
 * on a database that already holds models, as the owner's stack does: the
 * backfill writes one identity row per uploaded revision a manifest declared
 * (deleted models too, never an amended revision or an undeclared one), at
 * the revision's seq, with its principal, time and its `model.revised`
 * event's client; every reader then answers as the readers of S2a did
 * (`uploadedSources`' identity: the uploaded head's declaration, else the
 * newest declared revision's, also through an amended head's upstream and
 * across a deletion and revival); `Model.identity` reads the newest row; the
 * backfill is idempotent and the table append-only.
 */
import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModelId, ProjectId } from '@analyzr/contracts';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createDatabase, type Database } from '../../src/db/client.ts';
import { MIGRATIONS_DIR, runMigrations } from '../../src/db/migrate.ts';
import { createStore } from '../../src/db/store.ts';
import { externalIdEntries } from '../../src/domain/provenance.ts';

const P = 'prj_01J9Z3N4X5Q6R7S8T9V0W1X2I1';
const OWNER = 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2I1';
const AGENT = 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2I2';
const model = (n: number) => `mdl_01J9Z3N4X5Q6R7S8T9V0W1X2M${n}`;
const rev = (m: number, r: number) => `rev_01J9Z3N4X5Q6R7S8T9V0W1X${m}R${r}`;
const at = (seq: number) => `2026-10-01T10:${String(seq).padStart(2, '0')}:00.000Z`;

let name: string;
let database: Database;
let before: string;

async function admin(statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: inject('adminDatabaseUrl') });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/** The Postgres error of a failed statement (Drizzle wraps it in `cause`): constraint or message. */
async function failure(statement: string): Promise<string> {
  try {
    await database.db.execute(sql.raw(statement));
  } catch (err) {
    const cause = (err as { cause?: { message?: string; constraint?: string } }).cause;
    return cause?.constraint ?? cause?.message ?? String(err);
  }
  throw new Error('statement succeeded');
}

const signavio = (externalId: string | null, externalPath: string, url?: string) =>
  JSON.stringify({
    kind: 'import',
    path: `${externalPath}.bpmn`,
    uploader: 'human',
    manifestSha256: 'a'.repeat(64),
    system: 'signavio',
    systemVersion: '19.6.0',
    ...(externalId === null ? {} : { externalId }),
    externalPath,
    ...(url === undefined ? {} : { url }),
    derived: { kind: 'export' },
  });
const plain = JSON.stringify({ kind: 'upload', uploader: 'human' });
const amended = (upstream: string, upstreamRev: number) =>
  JSON.stringify({
    kind: 'amendment',
    uploader: 'human',
    upstream: { revisionId: upstream, rev: upstreamRev, contentHash: `${'c'.repeat(63)}0` },
  });

/** A revision with its `model.revised` event (client `analyzr-cli` unless given). */
function revision(
  m: number,
  r: number,
  seq: number,
  source: string,
  principal = OWNER,
  client = 'analyzr-cli',
): string {
  return `
    INSERT INTO event (project_id, seq, type, principal_id, client_id, subject_ref, payload)
      VALUES ('${P}', ${seq}, 'model.revised', '${principal}', '${client}', 'k${m}', '{}');
    INSERT INTO model_revision (id, project_id, model_id, rev, xml, content_hash, facts_hash, facts_version,
                                engine, processes, message_flows, source, principal_id, seq, created_at)
      VALUES ('${rev(m, r)}', '${P}', '${model(m)}', ${r}, '\\x00'::bytea, '${'c'.repeat(62)}${m}${r}',
              'f', '1', NULL, '[]', '[]', '${source}', '${principal}', ${seq}, '${at(seq)}');`;
}

function deletion(m: number, seq: number): string {
  return `
    INSERT INTO event (project_id, seq, type, principal_id, client_id, subject_ref, payload)
      VALUES ('${P}', ${seq}, 'model.deleted', '${OWNER}', 'analyzr-web', 'k${m}', '{}');`;
}

beforeAll(async () => {
  name = `analyzr_mig22_${randomBytes(6).toString('hex')}`;
  await admin(`CREATE DATABASE "${name}"`);
  const url = new URL(inject('adminDatabaseUrl'));
  url.pathname = `/${name}`;
  database = createDatabase(url.toString(), { max: 2 });

  // The migrations up to 0020, as a database from before step 5 has them.
  before = await mkdtemp(join(tmpdir(), 'analyzr-mig22-'));
  await cp(MIGRATIONS_DIR, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.filter((e) => e.tag < '0021');
  await writeFile(journalPath, JSON.stringify(journal));
  await migrate(database.db, { migrationsFolder: before });

  await database.db.execute(
    sql.raw(`
      INSERT INTO project (id, key, name) VALUES ('${P}', 'mig22', 'Migration 0022');
      INSERT INTO principal (id, kind, iss, subject, handle) VALUES
        ('${OWNER}', 'user', 'urn:analyzr:local', 'owner22', 'owner'),
        ('${AGENT}', 'service', 'urn:analyzr:agent-token', 'agt_y', 'agent:y');
      INSERT INTO membership (project_id, principal_id, role) VALUES ('${P}', '${OWNER}', 'owner');
      INSERT INTO model (id, project_id, key, name) VALUES
        ('${model(1)}', '${P}', 'a/eins', 'Eins'),
        ('${model(2)}', '${P}', 'b/zwei', 'Zwei'),
        ('${model(3)}', '${P}', 'c/drei', 'Drei'),
        ('${model(4)}', '${P}', 'd/vier', 'Vier'),
        ('${model(5)}', '${P}', 'e/fuenf', 'Fünf'),
        ('${model(6)}', '${P}', 'f/sechs', 'Sechs'),
        ('${model(7)}', '${P}', 'g/sieben', 'Sieben'),
        ('${model(8)}', '${P}', 'h/acht', 'Acht');
      -- M1: two declared revisions, an amended head on the second.
      ${revision(1, 1, 1, signavio('sid-1', 'A/Alt'))}
      ${revision(2, 1, 2, signavio('sid-2', 'B', 'https://tool.example/sid-2'), AGENT, 'agt_01J9Z3N4X5Q6R7S8T9V0W1X2Y1')}
      ${revision(1, 2, 3, signavio('sid-1', 'A/Neu'))}
      ${revision(1, 3, 4, amended(rev(1, 2), 2))}
      -- M2: declared, then revised without a manifest.
      ${revision(2, 2, 5, plain)}
      -- M3: never declared.
      ${revision(3, 1, 6, plain)}
      -- M4: declared, deleted.
      ${revision(4, 1, 7, signavio('sid-4', 'D'))}
      ${deletion(4, 8)}
      -- M5: a seed.
      ${revision(5, 1, 9, JSON.stringify({ kind: 'seed', path: 'e/fuenf.bpmn' }))}
      -- M6: declared, revised without a manifest, amended on top.
      ${revision(6, 1, 10, signavio('sid-6', 'F'))}
      ${revision(6, 2, 11, plain)}
      ${revision(6, 3, 12, amended(rev(6, 2), 2))}
      -- M7: declared, deleted, revived without a manifest.
      ${revision(7, 1, 13, signavio('sid-7', 'G7'))}
      ${deletion(7, 14)}
      ${revision(7, 2, 15, plain)}
      -- M8: the newest declared revision names no tool id.
      ${revision(8, 1, 16, signavio(null, 'H'))}
      UPDATE model SET head_revision_id = '${rev(1, 3)}' WHERE id = '${model(1)}';
      UPDATE model SET head_revision_id = '${rev(2, 2)}' WHERE id = '${model(2)}';
      UPDATE model SET head_revision_id = '${rev(3, 1)}' WHERE id = '${model(3)}';
      UPDATE model SET head_revision_id = '${rev(4, 1)}', deleted_seq = 8 WHERE id = '${model(4)}';
      UPDATE model SET head_revision_id = '${rev(5, 1)}' WHERE id = '${model(5)}';
      UPDATE model SET head_revision_id = '${rev(6, 3)}' WHERE id = '${model(6)}';
      UPDATE model SET head_revision_id = '${rev(7, 2)}' WHERE id = '${model(7)}';
      UPDATE model SET head_revision_id = '${rev(8, 1)}' WHERE id = '${model(8)}';
      UPDATE project SET last_seq = 16 WHERE id = '${P}';
    `),
  );
});

afterAll(async () => {
  await database.close();
  await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await rm(before, { recursive: true, force: true });
});

async function rows() {
  const result = await database.db.execute<Record<string, unknown>>(
    sql.raw(`
      SELECT model_id, seq, revision_id, kind, system, external_id, external_path, url,
             principal_id, client_id, created_at
      FROM model_identity ORDER BY model_id, seq`),
  );
  return result.rows.map((r) => ({
    ...r,
    seq: Number(r['seq']),
    created_at: new Date(r['created_at'] as string).toISOString(),
  }));
}

const store = () => createStore(database.db);

describe('migrations 0021 and 0022 on existing models', () => {
  it('backfill one row per declared uploaded revision, deleted models too', async () => {
    await runMigrations(database.db);
    const row = (
      m: number,
      r: number,
      seq: number,
      externalId: string | null,
      externalPath: string,
      extra: Record<string, unknown> = {},
    ) => ({
      model_id: model(m),
      seq,
      revision_id: rev(m, r),
      kind: 'revision',
      system: 'signavio',
      external_id: externalId,
      external_path: externalPath,
      url: null,
      principal_id: OWNER,
      client_id: 'analyzr-cli',
      created_at: at(seq),
      ...extra,
    });
    expect(await rows()).toEqual([
      row(1, 1, 1, 'sid-1', 'A/Alt'),
      row(1, 2, 3, 'sid-1', 'A/Neu'),
      row(2, 1, 2, 'sid-2', 'B', {
        url: 'https://tool.example/sid-2',
        principal_id: AGENT,
        client_id: 'agt_01J9Z3N4X5Q6R7S8T9V0W1X2Y1',
      }),
      row(4, 1, 7, 'sid-4', 'D'),
      row(6, 1, 10, 'sid-6', 'F'),
      row(7, 1, 13, 'sid-7', 'G7'),
      row(8, 1, 16, null, 'H'),
    ]);
  });

  it('answers every reader as before: the uploaded head’s declaration, else the newest declared one', async () => {
    const sources = await store().read((tx) => tx.revisions.uploadedSources(P as ProjectId));
    // The live models (M4 deleted): identity from the rows, the rest from the uploaded head.
    expect([...sources.keys()].sort()).toEqual([
      'a/eins',
      'b/zwei',
      'c/drei',
      'e/fuenf',
      'f/sechs',
      'g/sieben',
      'h/acht',
    ]);
    expect(sources.get('a/eins')).toMatchObject({ externalPath: 'A/Neu', systemVersion: '19.6.0' });
    // Revised without a manifest: the identity of the newest declared revision (S2a's fallback),
    // the rest from the head, which declares nothing.
    expect(sources.get('b/zwei')).toEqual({
      kind: 'upload',
      uploader: 'human',
      system: 'signavio',
      externalId: 'sid-2',
      externalPath: 'B',
      url: 'https://tool.example/sid-2',
    });
    expect(sources.get('c/drei')).toEqual({ kind: 'upload', uploader: 'human' });
    expect(sources.get('e/fuenf')).toEqual({ kind: 'seed', path: 'e/fuenf.bpmn' });
    expect(sources.get('f/sechs')).toMatchObject({ system: 'signavio', externalId: 'sid-6' });
    expect(sources.get('f/sechs')?.kind).toBe('upload');
    expect(sources.get('g/sieben')).toMatchObject({ externalId: 'sid-7', externalPath: 'G7' });
    expect(sources.get('h/acht')?.externalId).toBeUndefined();
    // `GET …/external-ids` as S2a computed it.
    expect(externalIdEntries(sources)).toEqual([
      { key: 'a/eins', system: 'signavio', externalId: 'sid-1', externalPath: 'A/Neu' },
      { key: 'b/zwei', system: 'signavio', externalId: 'sid-2', externalPath: 'B' },
      { key: 'f/sechs', system: 'signavio', externalId: 'sid-6', externalPath: 'F' },
      { key: 'g/sieben', system: 'signavio', externalId: 'sid-7', externalPath: 'G7' },
      { key: 'h/acht', system: 'signavio', externalId: null, externalPath: 'H' },
    ]);
  });

  it('gives Model.identity from the newest row, and the newest rows of deleted models too', async () => {
    const views = await store().read(async (tx) => ({
      two: await tx.models.view(P as ProjectId, model(2) as ModelId),
      three: await tx.models.view(P as ProjectId, model(3) as ModelId),
      newest: await tx.identities.newest(P as ProjectId, [
        model(1) as ModelId,
        model(3) as ModelId,
        model(4) as ModelId,
      ]),
    }));
    expect(views.two?.identity).toEqual({
      system: 'signavio',
      externalId: 'sid-2',
      externalPath: 'B',
      url: 'https://tool.example/sid-2',
    });
    // The head declares nothing: no summary, though the identity stays.
    expect(views.two?.source).toBeNull();
    expect(views.three?.identity).toBeNull();
    expect(views.newest).toEqual(
      new Map([
        [model(1), { system: 'signavio', externalId: 'sid-1', externalPath: 'A/Neu', url: null }],
        [model(4), { system: 'signavio', externalId: 'sid-4', externalPath: 'D', url: null }],
      ]),
    );
  });

  it('is idempotent and append-only', async () => {
    const file = await readFile(join(MIGRATIONS_DIR, '0022_model_identity_triggers.sql'), 'utf8');
    const backfill = file.split('--> statement-breakpoint').at(-1) ?? '';
    expect(backfill).toContain('INSERT INTO "model_identity"');
    const count = (await rows()).length;
    await database.db.execute(sql.raw(backfill));
    expect((await rows()).length).toBe(count);
    for (const [statement, message] of [
      ['UPDATE model_identity SET url = url', /model_identity is append-only: UPDATE/],
      ['DELETE FROM model_identity', /model_identity is append-only: DELETE/],
      ['TRUNCATE model_identity', /is append-only: TRUNCATE/],
    ] as const) {
      expect(await failure(statement), statement).toMatch(message);
    }
  });
});
