import { createRoute } from '@hono/zod-openapi';
import { apiRoutes } from '@analyzr/contracts';

import type { UseCases } from '../../domain/use-cases/index.ts';
import { requireActor, type App } from '../context.ts';
import { ifMatchRevision, revisionEtag } from '../etag.ts';

/**
 * The optional `If-Match` of a withdrawal: absent, nothing is checked; a
 * header naming no `"r<rev>"` never matches (412), as a stale one.
 */
function optionalIfMatch(header: string | undefined): number | undefined {
  return header === undefined ? undefined : (ifMatchRevision(header) ?? 0);
}

/**
 * Model amendments (M6 §4.8 c, S5c-2): the amendable fields of an element
 * (`ETag: "r<headRev>"`), amendment writes with `If-Match` and `dryRun`,
 * withdrawals, the list and the change list.
 */
export function registerAmendmentRoutes(app: App, useCases: UseCases): void {
  app.openapi(createRoute(apiRoutes.getAmendable), async (c) => {
    const { project, model, elementId } = c.req.valid('param');
    const result = await useCases.getAmendable(requireActor(c), project, model, elementId);
    c.header('etag', revisionEtag(result.headRev));
    c.header('cache-control', 'private, no-cache');
    return c.json(result, 200);
  });

  app.openapi(createRoute(apiRoutes.amendModel), async (c) => {
    const { project, model } = c.req.valid('param');
    const { dryRun } = c.req.valid('query');
    const result = await useCases.amendModel(
      requireActor(c),
      project,
      model,
      c.req.valid('json'),
      ifMatchRevision(c.req.valid('header')['if-match']),
      { dryRun: dryRun === 'true' },
    );
    if (!result.dryRun) c.header('etag', revisionEtag(result.model.headRev));
    return result.dryRun || result.outcome === 'unchanged'
      ? c.json(result, 200)
      : c.json(result, 201);
  });

  app.openapi(createRoute(apiRoutes.withdrawModelAmendments), async (c) => {
    const { project, model } = c.req.valid('param');
    const { dryRun } = c.req.valid('query');
    const result = await useCases.withdrawModelAmendments(requireActor(c), project, model, {
      dryRun: dryRun === 'true',
      ifMatchRev: optionalIfMatch(c.req.valid('header')['if-match']),
    });
    return c.json(result, result.result === 'withdrawn' && !result.dryRun ? 201 : 200);
  });

  app.openapi(createRoute(apiRoutes.listAmendments), async (c) => {
    const { project } = c.req.valid('param');
    return c.json(
      await useCases.listAmendments(requireActor(c), project, c.req.valid('query')),
      200,
    );
  });

  app.openapi(createRoute(apiRoutes.exportAmendments), async (c) => {
    const { project } = c.req.valid('param');
    const out = await useCases.exportAmendments(requireActor(c), project, c.req.valid('query'));
    // A download: model content inside stays inert (nosniff and the sandbox CSP of
    // securityHeaders apply as to every response).
    return c.body(out.body, 200, {
      'content-type': out.contentType,
      'content-disposition': `attachment; filename="${out.filename}"`,
      'cache-control': 'private, no-store',
    });
  });

  app.openapi(createRoute(apiRoutes.withdrawAmendment), async (c) => {
    const { project, amendment } = c.req.valid('param');
    const { dryRun } = c.req.valid('query');
    const result = await useCases.withdrawAmendment(requireActor(c), project, amendment, {
      dryRun: dryRun === 'true',
      ifMatchRev: optionalIfMatch(c.req.valid('header')['if-match']),
    });
    return c.json(result, result.result === 'withdrawn' && !result.dryRun ? 201 : 200);
  });
}
