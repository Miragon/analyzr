// A project and a bundle whose import prints every next step that names a CLI command (M6
// S3c, `commandName`): an amendment in conflict (`questions`), a tool id another key holds
// (`models delete`, `models external-ids`), the bundle's value chain (`value-chain push`), a
// waiting unique call of a converted model with no rule for its source (`rules add`) and the
// waiting tasks (`token create`); a dry run gets `fakeImpact`. The routes fit `fakeApi` and
// `fakeServer` alike.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { modelKeyFromPath, type ImportFileOutcome, type ImportImpact } from '@analyzr/contracts';

type Handler = (req: Request, url: URL) => Response | Promise<Response>;

const json = (body: unknown, status = 200) => Response.json(body, { status });
const list = <T>(items: T[] = []) => ({ count: items.length, items });

/**
 * The impact of a dry run of `keys`: their facts changed, their relations
 * tasks queued and the first one's claimed task cancelled, 10 pairs per
 * model, the placement task queued, one absent key.
 */
export function fakeImpact(keys: readonly string[]): ImportImpact {
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

/** The bundle's files, its manifest pinning their keys; `finanzen/rechnung` is converted. */
export const NEXT_STEP_FILES = [
  { path: 'finanzen/rechnung.bpmn', key: 'finanzen/rechnung' },
  { path: 'service/reklamation.bpmn', key: 'service/reklamation' },
  { path: 'vertrieb/auftrag.bpmn', key: 'vertrieb/auftrag' },
];

/** Writes the bundle below `dir` (synthetic BPMN, never parsed by the fake). */
export async function writeNextStepBundle(dir: string): Promise<string> {
  for (const f of NEXT_STEP_FILES) {
    await mkdir(path.dirname(path.join(dir, f.path)), { recursive: true });
    await writeFile(path.join(dir, f.path), '<definitions/>');
  }
  const manifest = {
    format: 'analyzr-import/1',
    source: { system: 'signavio', exportedAt: '2026-10-14T00:00:00Z' },
    files: NEXT_STEP_FILES.map((f) => ({
      ...f,
      derived:
        f.key === 'finanzen/rechnung'
          ? { kind: 'converted', converter: 'normalize-bpmn@0.1.0' }
          : { kind: 'export' },
    })),
    valueChain: { path: 'wertschoepfung.vc.json' },
  };
  await writeFile(path.join(dir, 'analyzr-import.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

/** The uploaded files of an import request, with their pinned keys. */
async function uploaded(req: Request): Promise<{ path: string; key: string }[]> {
  const form = await req.formData();
  const raw = form.get('manifest');
  const pinned = new Map(
    typeof raw === 'string'
      ? (JSON.parse(raw) as { files: { path: string; key?: string }[] }).files.map((f) => [
          f.path,
          f.key,
        ])
      : [],
  );
  return form.getAll('files').map((f) => {
    const name = (f as File).name;
    return { path: name, key: pinned.get(name) ?? modelKeyFromPath(name) ?? name };
  });
}

/** Each uploaded file's outcome: the three of the bundle with their step, any other created. */
function outcome(file: { path: string; key: string }): ImportFileOutcome {
  const base: ImportFileOutcome = {
    path: file.path,
    modelKey: file.key,
    outcome: 'created',
    problem: null,
  };
  switch (file.key) {
    case 'vertrieb/auftrag':
      return {
        ...base,
        importWarnings: [
          {
            code: 'external-id-moved',
            message: 'signavio id sid-1 belongs to verkauf/auftrag as well',
          },
        ],
      };
    case 'finanzen/rechnung':
      return { ...base, trust: { class: 'derived', reasons: ['converted'] } };
    case 'service/reklamation':
      return {
        ...base,
        outcome: 'revised',
        amendments: {
          applied: { count: 0, ids: [] },
          inSource: { count: 0, ids: [] },
          conflicts: { count: 1, ids: ['mam_01JA0000000000000000000001'] },
        },
      };
    default:
      return base;
  }
}

/** The routes of project `p`: missing until created; the import, a dry run with its impact. */
export function nextStepRoutes(p: string): Record<string, Handler> {
  return {
    [`GET /api/v1/projects/${p}`]: () =>
      json(
        {
          type: 'urn:analyzr:problem:not-found',
          title: 'Not found',
          status: 404,
          code: 'not-found',
          detail: `project ${p} not found`,
        },
        404,
      ),
    'POST /api/v1/projects': async (req) => {
      const body = (await req.json()) as { key: string; name: string };
      return json({ id: 'prj_01JA0000000000000000000001', ...body }, 201);
    },
    [`POST /api/v1/projects/${p}/imports`]: async (req, url) => {
      const files = (await uploaded(req)).map(outcome);
      return json({
        files,
        ...(url.searchParams.get('dryRun') === 'true'
          ? { impact: fakeImpact(files.map((f) => f.modelKey ?? '')) }
          : {}),
      });
    },
    [`GET /api/v1/projects/${p}/analyses`]: (_req, url) =>
      json({
        items: [{ id: `ana_${url.searchParams.get('kind') ?? 'x'}`, state: 'queued' }],
        nextCursor: null,
      }),
    [`GET /api/v1/projects/${p}/summary`]: () =>
      json({
        lastEventAt: '2026-10-21T00:00:00.000Z',
        reviewItems: 0,
        openPlacements: 0,
        ask: 0,
        pairsToJudge: 12,
      }),
    [`GET /api/v1/projects/${p}/relations`]: () =>
      json({
        items: [
          {
            id: 'rel_1',
            from: 'finanzen/rechnung#Call_1',
            to: 'service/reklamation#Process_1',
            type: 'call',
            status: 'proposed',
            tier: 'key',
            attrs: { calledElement: 'Process_1', match: 'derived-caller' },
            provenance: null,
            noLinks: [],
          },
        ],
        nextCursor: null,
      }),
    [`GET /api/v1/projects/${p}/auto-accept-rules`]: () => json({ items: [] }),
    [`GET /api/v1/projects/${p}/models`]: () => json({ items: [], nextCursor: null }),
    [`POST /api/v1/projects/${p}/agent-tokens`]: async (req) => {
      const body = (await req.json()) as { name: string; scopes: string[] };
      return json(
        {
          id: 'agt_01J9Z3N4X5Q6R7S8T9V0W1X2Y3',
          name: body.name,
          prefix: 'ssssssss',
          scopes: body.scopes,
          expiresAt: '2027-01-19T00:00:00.000Z',
          revokedAt: null,
          lastUsedAt: null,
          createdAt: '2026-10-21T00:00:00.000Z',
          secret: `analyzr_at_${'s'.repeat(49)}`,
        },
        201,
      );
    },
  };
}

/** The CLI subcommands the next steps of an import name. */
export const NAMED_COMMANDS = [
  'questions',
  'models delete',
  'models external-ids',
  'value-chain push',
  'rules add',
  'token create',
  'status',
];
