/**
 * Migration 0018 (M6 S2c-3, rules for derived calls) on a database that
 * already holds auto-accept rules, as the owner's stack does: the rule
 * revisions written before read as agent rules (`proposed_by` `agent`, no
 * derivation), a marked acceptance keeps resolving its revision, the
 * append-only triggers of 0010 still hold, and the new check takes a valid
 * rule for derived calls and refuses what decision 28 (1) rules out.
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

const P = 'prj_01J9Z3N4X5Q6R7S8T9V0W1X2T1';
const OWNER = 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2T1';
const AGENT = 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2T2';

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

beforeAll(async () => {
  name = `analyzr_mig18_${randomBytes(6).toString('hex')}`;
  await admin(`CREATE DATABASE "${name}"`);
  const url = new URL(inject('adminDatabaseUrl'));
  url.pathname = `/${name}`;
  database = createDatabase(url.toString(), { max: 2 });

  // The migrations up to 0017, as a database from before S2c-3 has them.
  before = await mkdtemp(join(tmpdir(), 'analyzr-mig18-'));
  await cp(MIGRATIONS_DIR, before, { recursive: true });
  const journalPath = join(before, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.filter((e) => e.tag < '0018');
  await writeFile(journalPath, JSON.stringify(journal));
  await migrate(database.db, { migrationsFolder: before });

  await database.db.execute(
    sql.raw(`
      INSERT INTO project (id, key, name) VALUES ('${P}', 'mig18', 'Migration 0018');
      INSERT INTO principal (id, kind, iss, subject, handle) VALUES
        ('${OWNER}', 'user', 'urn:analyzr:local', 'owner18', 'owner'),
        ('${AGENT}', 'service', 'urn:analyzr:agent-token', 'agt_y', 'agent:y');
      INSERT INTO membership (project_id, principal_id, role) VALUES ('${P}', '${OWNER}', 'owner');
      INSERT INTO relation (id, project_id, type, from_ref, to_ref, status, endpoint_state, tier, attrs)
        VALUES ('rel_t1', '${P}', 'message', 'a/x#E', 'b/y#S', 'accepted', 'ok', 'key', '{}');
      INSERT INTO relation_assertion (id, project_id, relation_id, seq, kind, verdict, source_kind, principal_id, tier, confidence)
        VALUES ('asr_t1', '${P}', 'rel_t1', 1, 'proposal', NULL, 'agent', '${AGENT}', 'key', 0.95);
      INSERT INTO auto_accept_rule (id, project_id, kind, created_by, seq)
        VALUES ('aar_t1', '${P}', 'relation', '${OWNER}', 2);
      INSERT INTO auto_accept_rule_revision (project_id, rule_id, kind, revision, name, enabled, tier, min_confidence, relation_type, principal_id, source_kind, seq)
        VALUES ('${P}', 'aar_t1', 'relation', 1, 'Aufruf: Gleicher Name ab 90 %', true, 'key', 0.9, 'call', '${OWNER}', 'human', 2);
      INSERT INTO relation_assertion (id, project_id, relation_id, seq, kind, verdict, source_kind, principal_id,
                                      auto_accept_rule_id, auto_accept_rule_revision, auto_accept_trigger_id)
        VALUES ('asr_t2', '${P}', 'rel_t1', 3, 'decision', 'accept', 'human', '${OWNER}', 'aar_t1', 1, 'asr_t1');
    `),
  );
});

afterAll(async () => {
  await database.close();
  await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await rm(before, { recursive: true, force: true });
});

/** A revision of the rule `aar_t9` (created for the check cases), with `columns` as given. */
async function revision(rev: number, columns: Record<string, string>): Promise<void> {
  const base: Record<string, string> = {
    project_id: `'${P}'`,
    rule_id: `'aar_t9'`,
    kind: `'relation'`,
    revision: String(rev),
    name: `'Aufrufe ${rev}'`,
    enabled: 'true',
    tier: `'key'`,
    min_confidence: '0.9',
    relation_type: `'call'`,
    principal_id: `'${OWNER}'`,
    source_kind: `'human'`,
    seq: String(100 + rev),
    proposed_by: `'rule'`,
    derived_kind: `'export'`,
    ...columns,
  };
  await database.db.execute(
    sql.raw(
      `INSERT INTO auto_accept_rule_revision (${Object.keys(base).join(', ')}) VALUES (${Object.values(base).join(', ')})`,
    ),
  );
}

describe('migration 0018 on existing rules', () => {
  it('applies; the rules from before read as agent rules and keep their acceptances', async () => {
    await runMigrations(database.db);
    const rows = await database.db.execute(
      sql.raw(
        `SELECT rule_id, revision, proposed_by, derived_kind, converter FROM auto_accept_rule_revision`,
      ),
    );
    expect(rows.rows).toEqual([
      { rule_id: 'aar_t1', revision: 1, proposed_by: 'agent', derived_kind: null, converter: null },
    ]);
    const heads = await createStore(database.db).read((tx) => tx.autoAcceptRules.heads(P as never));
    expect(heads).toMatchObject([
      { ruleId: 'aar_t1', proposedBy: 'agent', derivedKind: null, converter: null },
    ]);
    const marked = await database.db.execute(
      sql.raw(`SELECT count(*) AS n FROM relation_assertion WHERE auto_accept_rule_id = 'aar_t1'`),
    );
    expect(Number(marked.rows[0]?.['n'])).toBe(1);
    // Still append-only.
    await expect(
      database.db.execute(
        sql.raw(
          `UPDATE auto_accept_rule_revision SET proposed_by = 'rule', derived_kind = 'export'`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('takes a rule for derived calls and refuses what decision 28 (1) rules out', async () => {
    await database.db.execute(
      sql.raw(
        `INSERT INTO auto_accept_rule (id, project_id, kind, created_by, seq) VALUES ('aar_t9', '${P}', 'relation', '${OWNER}', 100)`,
      ),
    );
    await revision(1, {});
    await revision(2, { derived_kind: `'none'` });
    await revision(3, { derived_kind: `'converted'`, converter: `'normalize-bpmn@0.1.0'` });
    const refused: Record<string, string>[] = [
      { derived_kind: `'reconstructed'` },
      { derived_kind: `'as-told'` },
      { derived_kind: 'NULL' },
      { derived_kind: `'converted'` },
      { converter: `'normalize-bpmn@0.1.0'` },
      { min_confidence: '0.95' },
      { relation_type: `'message'` },
      { relation_type: 'NULL' },
      { tier: `'lexical'` },
      { include_ad_hoc: 'true' },
      { llm_model: `'some-model'` },
      { agent_principal_id: `'${AGENT}'` },
      { proposed_by: `'agent'` },
      { proposed_by: `'someone'`, derived_kind: 'NULL' },
    ];
    // Each refused by the proposer check itself, not by another constraint.
    const constraintOf = (err: unknown): string | null => {
      for (let e = err; e instanceof Error; e = e.cause) {
        const name = (e as { constraint?: unknown }).constraint;
        if (typeof name === 'string') return name;
      }
      return null;
    };
    for (const [i, columns] of refused.entries()) {
      const err = await revision(10 + i, columns).then(
        () => null,
        (e: unknown) => e,
      );
      expect(constraintOf(err), JSON.stringify(columns)).toBe(
        'auto_accept_rule_revision_proposer_check',
      );
    }
    const stored = await createStore(database.db).read((tx) =>
      tx.autoAcceptRules.find(P as never, 'aar_t9'),
    );
    expect(stored?.revisions.map((r) => [r.proposedBy, r.derivedKind, r.converter])).toEqual([
      ['rule', 'export', null],
      ['rule', 'none', null],
      ['rule', 'converted', 'normalize-bpmn@0.1.0'],
    ]);
  });
});
