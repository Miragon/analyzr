/**
 * The size of the MCP tool `get_landscape` (M6 S3a, §6 "Paged landscape
 * digest"): `nordwind-handel` imported with the real libraries, as `analyzr
 * seed` does, then worked by the simulation agent (relations tasks; no value
 * chain, which `get_landscape` does not show). Each time the tool is called
 * over Streamable HTTP with an agent token and its text content, the JSON an
 * agent reads, is measured in UTF-8 bytes, in total, per model and per part
 * (models, relations, findings; agent relations with their mean size and
 * rationale length). Prints sizes and counts only. The v1 limit of M6 §6
 * derives from these numbers and the ~100 KB a tool page holds (CONCEPT §6):
 * the result has to stay below that on this landscape.
 */
import { connect as connectSim, runAgent } from '@analyzr/agent-sim';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Landscape } from '@analyzr/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { corpusFiles, importAll } from '../support/corpus.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';
import { listen } from '../support/http.ts';

const PROJECT = 'nordwind-handel';
/** The ~100 KB a tool page holds (CONCEPT §6), the basis of the v1 limit (M6 §6). */
const TOOL_PAGE_BYTES = 100 * 1024;

let database: TestDatabase;
let t: TestApp;
let server: { url: string; close: () => Promise<void> };
let token: string;
let models = 0;

interface Measure {
  bytes: number;
  models: number;
  relations: number;
  findings: number;
  parts: { models: number; relations: number; findings: number };
  agent: { relations: number; bytes: number; rationaleChars: number };
}

const utf8 = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

async function measure(): Promise<Measure> {
  const client = new Client({ name: 'analyzr-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  try {
    const result = await client.callTool({
      name: 'get_landscape',
      arguments: { projectId: PROJECT },
    });
    expect(result.isError).not.toBe(true);
    const [content] = result.content as Array<{ type: string; text: string }>;
    if (content?.type !== 'text') throw new Error('get_landscape: no text content');
    const landscape = JSON.parse(content.text) as Landscape;
    const agent = landscape.relations.filter((r) => r.source === 'agent');
    return {
      bytes: Buffer.byteLength(content.text, 'utf8'),
      models: landscape.models.length,
      relations: landscape.relations.length,
      findings: landscape.findings.length,
      parts: {
        models: utf8(landscape.models),
        relations: utf8(landscape.relations),
        findings: utf8(landscape.findings),
      },
      agent: {
        relations: agent.length,
        bytes: utf8(agent),
        rationaleChars: agent.reduce((n, r) => n + (r.provenance?.rationale?.length ?? 0), 0),
      },
    };
  } finally {
    await client.close();
  }
}

function report(label: string, m: Measure): void {
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  console.log(
    `get_landscape ${label}: ${m.bytes} bytes (${kb(m.bytes)}), ${m.models} models, ` +
      `${Math.round(m.bytes / m.models)} bytes per model; models ${kb(m.parts.models)}, ` +
      `${m.relations} relations ${kb(m.parts.relations)}, ${m.findings} findings ${kb(m.parts.findings)}` +
      (m.agent.relations === 0
        ? ''
        : `; ${m.agent.relations} agent relations, ${Math.round(m.agent.bytes / m.agent.relations)} bytes ` +
          `and ${Math.round(m.agent.rationaleChars / m.agent.relations)} rationale characters each`),
  );
}

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis });
  await t.createProject(PROJECT, PROJECT);
  const files = await corpusFiles(PROJECT);
  models = files.length;
  const outcomes = await importAll((p, init) => t.asOwner(p, init), PROJECT, files);
  expect(outcomes.every((o) => o.outcome === 'created')).toBe(true);
  token = (await t.createToken(PROJECT, ['analyzr:read', 'analyzr:propose'])).secret;
  server = await listen(t.app.fetch);
}, 180_000);

afterAll(async () => {
  await server?.close();
  await database?.drop();
});

describe('get_landscape size', () => {
  it('on the seeded landscape and after the simulation agent', async () => {
    const seeded = await measure();
    report('seeded', seeded);
    expect(seeded.models).toBe(models);

    const session = await connectSim(
      { kind: 'http', url: server.url, token },
      { name: 'analyzr-agent-sim', version: '0.0.0' },
    );
    try {
      const run = await runAgent(session, { projectId: PROJECT, kinds: ['relations'] });
      expect(run.stop).toBe('no-work');
    } finally {
      await session.close();
    }
    const worked = await measure();
    report('after the simulation agent', worked);
    expect(worked.relations).toBeGreaterThan(seeded.relations);
    expect(worked.bytes).toBeLessThan(TOOL_PAGE_BYTES);
  }, 120_000);
});
