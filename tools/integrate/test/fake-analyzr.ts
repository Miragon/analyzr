// A fake analyzr for the tests of analyzr-read.mjs: an HTTP server on 127.0.0.1 that answers
// the three requests the script may send with canned data and logs every request it gets.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { modelKeyFromPath } from '@analyzr/contracts/paths';

export interface LoggedRequest {
  method: string;
  url: string;
  authorization: string | null;
  /** The multipart `files` of an import: their file names. */
  files: string[];
  /** The multipart `manifest` of an import. */
  manifest: string | null;
}

export interface FakeAnalyzr {
  url: string;
  log: LoggedRequest[];
  close: () => Promise<void>;
}

export const FAKE_MODELS = [
  { id: 'mdl_01JA0000000000000000000001', key: 'a' },
  { id: 'mdl_01JA0000000000000000000002', key: 'b' },
  { id: 'mdl_01JA0000000000000000000003', key: 'c' },
];

export const FAKE_IDENTITIES = [
  { key: 'a', system: 'signavio', externalId: 'sid-a', externalPath: 'A' },
  { key: 'b', system: 'signavio', externalId: null, externalPath: 'B' },
  { key: 'c', system: 'aris', externalId: 'aris-c', externalPath: 'C' },
];

const list = <T>(items: T[] = []) => ({ count: items.length, items });

/** The trust class analyzr gives an engine-less file uploaded with the owner key. */
export const DERIVED = { class: 'derived', reasons: ['no-engine'] };

/**
 * The impact of a dry run of `keys`: their relations tasks queued, the first one's claimed
 * task cancelled, 10 pairs per model (1 judged again), the placement task queued.
 */
export function fakeImpact(keys: readonly string[]) {
  const [first = 'x'] = keys;
  return {
    files: keys.map((modelKey) => ({
      modelKey,
      factsChanged: true,
      processesAdded: [`${modelKey}#P`],
      processesRemoved: [],
      trust: { class: 'derived', reasons: ['no-engine'] },
    })),
    acceptedCalls: list(),
    callsProposed: { ...list(), wasAccepted: 0, byReason: [] },
    proposalsAdded: list(),
    proposalsWithdrawn: list(),
    endpointsChanged: list(),
    findingsAdded: list(),
    findingsResolved: list(),
    absentKeys: list(['absent/one']),
    relationsTasks: {
      queued: list([...keys]),
      cancelled: list([
        { modelKey: first, state: 'claimed', claimedBy: 'agent:claude', assigned: 3 },
      ]),
      claimed: 1,
      pairs: 10 * keys.length,
      rejudged: list([{ type: 'call', from: `${first}#Call`, to: 'y#P' }]),
    },
    placementsChanged: list(),
    placementTask: { outcome: 'queued', due: 2, newlyDue: 1, again: 1 },
  };
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Starts the fake analyzr. Project `missing` answers 404, project `moved` redirects to
 * `redirectTo`; a file whose name contains `fail` would fail, one with `unchanged` would stay
 * unchanged, one with `identity` too while recording its new identity (`identityUpdated`), one
 * with `camunda` would be modelled (no `trust`), every other one created; anything but the three
 * requests answers 418.
 */
export async function fakeAnalyzr(options: { redirectTo?: string } = {}): Promise<FakeAnalyzr> {
  const log: LoggedRequest[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const bytes = await body(req);
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const entry: LoggedRequest = {
        method: req.method ?? '',
        url: `${url.pathname}${url.search}`,
        authorization: req.headers.authorization ?? null,
        files: [],
        manifest: null,
      };
      const contentType = req.headers['content-type'] ?? '';
      let form: FormData | null = null;
      if (contentType.startsWith('multipart/form-data')) {
        form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
        entry.files = form.getAll('files').map((f) => (f as File).name);
        const manifest = form.get('manifest');
        entry.manifest = typeof manifest === 'string' ? manifest : null;
      }
      log.push(entry);
      const json = (status: number, value: unknown, type = 'application/json') => {
        res.writeHead(status, { 'content-type': type });
        res.end(JSON.stringify(value));
      };
      const project = /^\/api\/v1\/projects\/([^/]+)\//.exec(url.pathname)?.[1];
      if (project === 'missing') {
        json(
          404,
          {
            type: 'urn:analyzr:problem:not-found',
            title: 'Not found',
            status: 404,
            code: 'not-found',
            detail: 'project missing not found',
          },
          'application/problem+json',
        );
        return;
      }
      if (project === 'moved') {
        res.writeHead(307, {
          location: `${options.redirectTo ?? 'http://127.0.0.1:9'}${url.pathname}${url.search}`,
        });
        res.end();
        return;
      }
      if (req.method === 'GET' && url.pathname.endsWith('/models')) {
        json(
          200,
          url.searchParams.get('cursor') === 'next'
            ? { items: FAKE_MODELS.slice(2), nextCursor: null }
            : { items: FAKE_MODELS.slice(0, 2), nextCursor: 'next' },
        );
        return;
      }
      if (req.method === 'GET' && url.pathname.endsWith('/external-ids')) {
        const system = url.searchParams.get('system');
        json(200, { items: FAKE_IDENTITIES.filter((i) => system === null || i.system === system) });
        return;
      }
      if (req.method === 'POST' && url.pathname.endsWith('/imports') && form !== null) {
        const pinned = new Map(
          entry.manifest === null
            ? []
            : (JSON.parse(entry.manifest) as { files: { path: string; key?: string }[] }).files.map(
                (f) => [f.path, f.key],
              ),
        );
        const files = entry.files.map((name) => {
          const modelKey = pinned.get(name) ?? modelKeyFromPath(name);
          return name.includes('fail')
            ? {
                path: name,
                modelKey,
                outcome: 'failed',
                problem: {
                  type: 'urn:analyzr:problem:bpmn-invalid',
                  title: 'BPMN invalid',
                  status: 422,
                  code: 'bpmn-invalid',
                  detail: 'no definitions',
                },
              }
            : {
                path: name,
                modelKey,
                outcome: /unchanged|identity/.test(name) ? 'unchanged' : 'created',
                warnings: [],
                warningCount: 0,
                // the server's trust class: derived for engine-less files, absent for modelled ones
                ...(name.includes('camunda') ? {} : { trust: DERIVED }),
                ...(name.includes('identity') ? { identityUpdated: true } : {}),
              };
        });
        json(200, {
          files,
          impact: fakeImpact(
            files.filter((f) => f.outcome === 'created').map((f) => f.modelKey ?? ''),
          ),
        });
        return;
      }
      json(418, { code: 'unexpected', detail: `${req.method} ${url.pathname}` });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    log,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
