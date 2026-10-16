import { describe, expect, it } from 'vitest';

import { runCli } from '../../src/program.ts';
import { json, testIo } from '../support/io.ts';

function jsonFetch(body: unknown, status = 200, seen: string[] = []): typeof globalThis.fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init).url);
    return Promise.resolve(json(body, status));
  };
}

describe('analyzr', () => {
  it('prints the version', async () => {
    const t = testIo();
    expect(await runCli(['--version'], t.io)).toBe(0);
    expect(t.out()).toMatch(/^0\.1\.0/);
  });

  it('lists the commands in --help', async () => {
    const t = testIo();
    expect(await runCli(['--help'], t.io)).toBe(0);
    for (const cmd of [
      'health',
      'status',
      'import',
      'models',
      'questions',
      'token',
      'mcp',
      'seed',
      'value-chain',
    ]) {
      expect(t.out()).toContain(cmd);
    }
    const models = testIo();
    expect(await runCli(['models', '--help'], models.io)).toBe(0);
    for (const cmd of ['list', 'requeue', 'delete']) expect(models.out()).toContain(cmd);
    const imp = testIo();
    expect(await runCli(['import', '--help'], imp.io)).toBe(0);
    expect(imp.out().replace(/\s+/g, ' ')).toContain(
      'directory with BPMN files (*.bpmn, *.bpmn2, *.bpmn20.xml, *.xml)',
    );
    expect(imp.out()).toContain('--verbose');
    const token = testIo();
    expect(await runCli(['token', '--help'], token.io)).toBe(0);
    for (const cmd of ['create', 'list', 'revoke']) expect(token.out()).toContain(cmd);
    const chain = testIo();
    expect(await runCli(['value-chain', '--help'], chain.io)).toBe(0);
    for (const cmd of ['push', 'pull', 'requeue']) expect(chain.out()).toContain(cmd);
  });

  it('health prints the server health from ANALYZR_URL', async () => {
    const seen: string[] = [];
    const t = testIo(
      { ANALYZR_URL: 'http://127.0.0.1:7999/' },
      jsonFetch({ status: 'ok', version: '2', db: 'ok' }, 200, seen),
    );
    expect(await runCli(['health'], t.io)).toBe(0);
    expect(seen).toEqual(['http://127.0.0.1:7999/health']);
    expect(JSON.parse(t.out())).toEqual({ status: 'ok', version: '2', db: 'ok' });
  });

  it('--url wins over ANALYZR_URL', async () => {
    const seen: string[] = [];
    const t = testIo(
      { ANALYZR_URL: 'http://127.0.0.1:7999' },
      jsonFetch({ status: 'ok', version: '2', db: 'ok' }, 200, seen),
    );
    expect(await runCli(['--url', 'http://localhost:7500', 'health'], t.io)).toBe(0);
    expect(seen).toEqual(['http://localhost:7500/health']);
  });

  it('health fails when the database is down or the server is unreachable', async () => {
    const down = testIo({}, jsonFetch({ status: 'degraded', version: '2', db: 'down' }, 503));
    expect(await runCli(['health'], down.io)).toBe(1);
    expect(down.err()).toContain('not healthy (HTTP 503)');

    const offline = testIo();
    expect(await runCli(['health', '--url', 'http://127.0.0.1:9'], offline.io)).toBe(1);
    expect(offline.err()).toContain('cannot reach analyzr');
  });

  it('validates options', async () => {
    const t = testIo();
    expect(await runCli(['import', 'models'], t.io)).toBe(1);
    expect(t.err()).toContain('--project');
    const s = testIo();
    expect(await runCli(['token', 'create'], s.io)).toBe(1);
    expect(s.err()).toContain('--project');
  });
});
