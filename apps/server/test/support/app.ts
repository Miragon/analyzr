import {
  SESSION_COOKIE,
  type AgentScope,
  type CreatedAgentToken,
  type DeclaredProcedure,
  type Project,
} from '@analyzr/contracts';

import { createAnalyzrApp, type AnalyzrApp } from '../../src/app.ts';
import type { AnalysisPort, Clock } from '../../src/domain/ports.ts';
import type { TestDatabase } from './db.ts';
import { fakeAnalysis } from './fake-analysis.ts';

/** A settable clock for expiry tests. */
export function testClock(
  start = new Date(),
): Clock & { set(d: Date): void; advance(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    set: (d) => {
      now = d;
    },
    advance: (ms) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

export interface TestApp extends AnalyzrApp {
  analysis: AnalysisPort;
  /** `Cookie` header of a valid owner session (`analyzr-web`). */
  ownerCookie: string;
  /** `fetch` against the app without a network (Host: localhost). */
  request(path: string, init?: RequestInit): Promise<Response>;
  /** Same as the owner on the web UI. */
  asOwner(path: string, init?: RequestInit): Promise<Response>;
  asToken(secret: string, path: string, init?: RequestInit): Promise<Response>;
  createProject(key: string, name?: string): Promise<Project>;
  createToken(
    project: string,
    scopes: AgentScope[],
    expiresInDays?: number,
  ): Promise<CreatedAgentToken>;
  putModel(project: string, key: string, xml: string, auth?: { token?: string }): Promise<Response>;
}

function withHeaders(init: RequestInit | undefined, extra: Record<string, string>): RequestInit {
  return {
    ...init,
    headers: { ...(init?.headers as Record<string, string> | undefined), ...extra },
  };
}

export function startTestApp(
  database: TestDatabase,
  options: {
    analysis?: AnalysisPort;
    clock?: Clock;
    ownerKey?: string;
    expectedProcedure?: () => DeclaredProcedure;
  } = {},
): TestApp {
  const analysis = options.analysis ?? fakeAnalysis();
  const analyzr = createAnalyzrApp({
    config: { authMode: 'local', webDist: null, originPorts: [7400, 7401] },
    database,
    version: '0.0.0-test',
    analysis,
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.ownerKey ? { ownerKey: options.ownerKey } : {}),
    ...(options.expectedProcedure ? { expectedProcedure: options.expectedProcedure } : {}),
  });
  const ownerCookie = `${SESSION_COOKIE}=${analyzr.sessions.issue('analyzr-web')}`;
  const request = async (path: string, init?: RequestInit) =>
    analyzr.app.request(`http://localhost${path}`, init);
  const asOwner = (path: string, init?: RequestInit) =>
    request(path, withHeaders(init, { cookie: ownerCookie }));
  const asToken = (secret: string, path: string, init?: RequestInit) =>
    request(path, withHeaders(init, { authorization: `Bearer ${secret}` }));

  return {
    ...analyzr,
    analysis,
    ownerCookie,
    request,
    asOwner,
    asToken,
    async createProject(key, name = key) {
      const res = await asOwner('/api/v1/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, name }),
      });
      if (res.status !== 201)
        throw new Error(`createProject ${key}: ${res.status} ${await res.text()}`);
      return (await res.json()) as Project;
    },
    async createToken(project, scopes, expiresInDays = 30) {
      const res = await asOwner(`/api/v1/projects/${project}/agent-tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: `test ${scopes.join(' ')}`, scopes, expiresInDays }),
      });
      if (res.status !== 201) throw new Error(`createToken: ${res.status} ${await res.text()}`);
      return (await res.json()) as CreatedAgentToken;
    },
    async putModel(project, key, xml, auth = {}) {
      const init: RequestInit = {
        method: 'PUT',
        headers: { 'content-type': 'application/xml' },
        body: xml,
      };
      const path = `/api/v1/projects/${project}/models/by-key/${encodeURIComponent(key)}`;
      return auth.token ? asToken(auth.token, path, init) : asOwner(path, init);
    },
  };
}
