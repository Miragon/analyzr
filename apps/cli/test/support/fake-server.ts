// A fake analyzr over real HTTP on 127.0.0.1 for the tests that run a CLI as a child process
// (the parity of the plugin's bundled CLI with the checkout's, M6 S3c): `routes` as for
// `fakeApi`, every request logged with its credential, its multipart file names and manifest.
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface LoggedRequest {
  method: string;
  /** Path and query. */
  url: string;
  authorization: string | null;
  /** The multipart `files` of an import: their file names. */
  files: string[];
  /** The multipart `manifest` of an import. */
  manifest: string | null;
}

export type Handler = (req: Request, url: URL) => Response | Promise<Response>;

export interface FakeServer {
  url: string;
  log: LoggedRequest[];
  close: () => Promise<void>;
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Starts the fake: `routes` maps `"METHOD /path"` (path without query) to a
 * handler; any other request answers 418 (a CLI that sends one shows it), a
 * handler that throws 500 with its message (so a child shows it, not a hang).
 */
export async function fakeServer(routes: Record<string, Handler>): Promise<FakeServer> {
  const log: LoggedRequest[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const bytes = await body(req);
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(name, value);
      }
      const request = new Request(url, {
        method: req.method ?? 'GET',
        headers,
        ...(bytes.length > 0 ? { body: new Uint8Array(bytes) } : {}),
      });
      const entry: LoggedRequest = {
        method: request.method,
        url: `${url.pathname}${url.search}`,
        authorization: request.headers.get('authorization'),
        files: [],
        manifest: null,
      };
      if ((request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
        const form = await request.clone().formData();
        entry.files = form.getAll('files').map((f) => (f as File).name);
        const manifest = form.get('manifest');
        entry.manifest = typeof manifest === 'string' ? manifest : null;
      }
      log.push(entry);
      const handler = routes[`${request.method} ${decodeURIComponent(url.pathname)}`];
      const answer = handler
        ? await handler(request, url)
        : Response.json(
            { code: 'unexpected', detail: `${request.method} ${url.pathname}` },
            { status: 418 },
          );
      res.writeHead(answer.status, Object.fromEntries(answer.headers));
      res.end(Buffer.from(await answer.arrayBuffer()));
    })().catch((err: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'fake-failed', detail: String(err) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    log,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
