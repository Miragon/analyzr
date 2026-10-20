/**
 * Migrations 0019 and 0020 (M6 S2c-4, „Vor der Vertrauensregel angenommen“)
 * on a database that already holds models, as the owner's stack does: a
 * revision stored before the trust rule (no `source.trust`) keeps reading as
 * stored before S2c (no class, no review), a review of it is recorded once
 * and read by `headTrustRows`, and the table refuses what decision 28 (3)
 * rules out: a review of a revision the trust rule classified or of an
 * amended revision, a second review, a machine's, an unknown class, a
 * revision of another model; it is append-only.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';

import { createDatabase, type Database } from '../../src/db/client.ts';
import { MIGRATIONS_DIR, runMigrations } from '../../src/db/migrate.ts';
import { createStore } from '../../src/db/store.ts';
import { modelTrust } from '../../src/domain/trust.ts';

const P = 'prj_01J9Z3N4X5Q6R7S8T9V0W1X2T1';
const OWNER = 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2T1';
const AGENT = 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2T2';
/** A model whose head was stored before S2c (no class), engine-less: derived today. */
const LEGACY = 'mdl_01J9Z3N4X5Q6R7S8T9V0W1X2L1';
const LEGACY_REV = 'rev_01J9Z3N4X5Q6R7S8T9V0W1X2L1';
/** A model whose head carries the trust rule's class. */
const CLASSIFIED = 'mdl_01J9Z3N4X5Q6R7S8T9V0W1X2C1';
const CLASSIFIED_REV = 'rev_01J9Z3N4X5Q6R7S8T9V0W1X2C1';
/** An amended revision of the legacy model (not its head here). */
const AMENDED_REV = 'rev_01J9Z3N4X5Q6R7S8T9V0W1X2L2';

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

/** A review row with `columns` as given. */
function review(columns: Record<string, string> = {}): string {
  const row: Record<string, string> = {
    project_id: `'${P}'`,
    revision_id: `'${LEGACY_REV}'`,
    model_id: `'${LEGACY}'`,
    class: `'derived'`,
    principal_id: `'${OWNER}'`,
    client_id: `'analyzr-web'`,
    source_kind: `'human'`,
    seq: '20',
    ...columns,
  };
  return `INSERT INTO revision_trust_review (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).join(', ')})`;
}

beforeAll(async () => {
  name = `analyzr_mig20_${randomBytes(6).toString('hex')}`;
  await admin(`CREATE DATABASE "${name}"`);
  const url = new URL(inject('adminDatabaseUrl'));
  url.pathname = `/${name}`;
  database = createDatabase(url.toString(), { max: 2 });

  // The migrations up to 0018, as a database from before S2c-4 has them.
  before = await mkdtemp(join(tmpdir(), 'analyzr-mig20-'));
  await cp(MIGRATIONS_DIR, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.filter((e) => e.tag < '0019');
  await writeFile(journalPath, JSON.stringify(journal));
  await migrate(database.db, { migrationsFolder: before });

  const revision = (id: string, model: string, rev: number, source: string, seq: number) => `
    INSERT INTO model_revision (id, project_id, model_id, rev, xml, content_hash, facts_hash, facts_version,
                                engine, processes, message_flows, source, principal_id, seq)
      VALUES ('${id}', '${P}', '${model}', ${rev}, '\\x00'::bytea, '${'a'.repeat(63)}${rev}', 'f', '1',
              NULL, '[]', '[]', '${source}', '${OWNER}', ${seq});`;
  await database.db.execute(
    sql.raw(`
      INSERT INTO project (id, key, name) VALUES ('${P}', 'mig20', 'Migration 0020');
      INSERT INTO principal (id, kind, iss, subject, handle) VALUES
        ('${OWNER}', 'user', 'urn:analyzr:local', 'owner20', 'owner'),
        ('${AGENT}', 'service', 'urn:analyzr:agent-token', 'agt_z', 'agent:z');
      INSERT INTO membership (project_id, principal_id, role) VALUES ('${P}', '${OWNER}', 'owner');
      INSERT INTO model (id, project_id, key, name) VALUES
        ('${LEGACY}', '${P}', 'vertrieb/auftrag', 'Auftragsabwicklung'),
        ('${CLASSIFIED}', '${P}', 'finanzen/rechnung', 'Rechnungsstellung');
      ${revision(LEGACY_REV, LEGACY, 1, '{"kind":"upload","uploader":"human"}', 1)}
      ${revision(AMENDED_REV, LEGACY, 2, `{"kind":"amendment","uploader":"human","upstream":{"revisionId":"${LEGACY_REV}","rev":1,"contentHash":"${'a'.repeat(63)}1"}}`, 2)}
      ${revision(CLASSIFIED_REV, CLASSIFIED, 1, '{"kind":"upload","uploader":"human","trust":{"class":"derived","reasons":["no-engine"]}}', 3)}
      UPDATE model SET head_revision_id = '${LEGACY_REV}' WHERE id = '${LEGACY}';
      UPDATE model SET head_revision_id = '${CLASSIFIED_REV}' WHERE id = '${CLASSIFIED}';
      UPDATE project SET last_seq = 3 WHERE id = '${P}';
    `),
  );
});

afterAll(async () => {
  await database.close();
  await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await rm(before, { recursive: true, force: true });
});

const trustRows = () =>
  createStore(database.db).read((tx) => tx.revisions.headTrustRows(P as never));

describe('migrations 0019 and 0020 on existing models', () => {
  it('apply; a revision stored before the trust rule still reads as such', async () => {
    await runMigrations(database.db);
    const rows = await database.db.execute(
      sql.raw(`SELECT count(*) AS n FROM revision_trust_review`),
    );
    expect(Number(rows.rows[0]?.['n'])).toBe(0);
    const legacy = (await trustRows()).find((r) => r.key === 'vertrieb/auftrag');
    expect(legacy).toMatchObject({ revisionId: LEGACY_REV, review: null, engine: null });
    expect(modelTrust(legacy!).trust).toBeNull();
  });

  it('refuses a classified or amended revision, a machine, an unknown class, another model’s revision', async () => {
    expect(
      await failure(review({ revision_id: `'${CLASSIFIED_REV}'`, model_id: `'${CLASSIFIED}'` })),
    ).toMatch(/carries a trust class or is amended/);
    expect(await failure(review({ revision_id: `'${AMENDED_REV}'` }))).toMatch(
      /carries a trust class or is amended/,
    );
    expect(await failure(review({ source_kind: `'agent'`, principal_id: `'${AGENT}'` }))).toBe(
      'revision_trust_review_humans_only',
    );
    expect(await failure(review({ class: `'trusted'` }))).toBe('revision_trust_review_class_check');
    expect(await failure(review({ model_id: `'${CLASSIFIED}'` }))).toBe(
      'revision_trust_review_revision_fk',
    );
  });

  it('records one review per revision, read by headTrustRows; append-only', async () => {
    await database.db.execute(sql.raw(review()));
    expect(await failure(review({ class: `'modelled'`, seq: '21' }))).toBe(
      'revision_trust_review_pk',
    );
    const legacy = (await trustRows()).find((r) => r.key === 'vertrieb/auftrag');
    expect(legacy?.review).toBe('derived');
    expect(modelTrust(legacy!).trust).toEqual({ class: 'derived', reasons: ['no-engine'] });
    for (const [statement, message] of [
      [
        'UPDATE revision_trust_review SET class = class',
        /revision_trust_review is append-only: UPDATE/,
      ],
      ['DELETE FROM revision_trust_review', /revision_trust_review is append-only: DELETE/],
      ['TRUNCATE revision_trust_review', /is append-only: TRUNCATE/],
    ] as const) {
      expect(await failure(statement), statement).toMatch(message);
    }
  });
});
