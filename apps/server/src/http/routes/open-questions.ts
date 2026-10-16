import { createRoute } from '@hono/zod-openapi';
import { apiRoutes } from '@analyzr/contracts';

import type { UseCases } from '../../domain/use-cases/index.ts';
import { requireActor, type App } from '../context.ts';

/** Open questions and their export (M6 §4.4). */
export function registerOpenQuestionRoutes(app: App, useCases: UseCases): void {
  app.openapi(createRoute(apiRoutes.listOpenQuestions), async (c) => {
    const { project } = c.req.valid('param');
    return c.json(
      await useCases.listOpenQuestions(requireActor(c), project, c.req.valid('query')),
      200,
    );
  });

  app.openapi(createRoute(apiRoutes.exportOpenQuestions), async (c) => {
    const { project } = c.req.valid('param');
    const out = await useCases.exportOpenQuestions(requireActor(c), project, c.req.valid('query'));
    // A download: model and agent texts inside stay inert (nosniff and the sandbox CSP
    // of securityHeaders apply as to every response).
    return c.body(out.body, 200, {
      'content-type': out.contentType,
      'content-disposition': `attachment; filename="${out.filename}"`,
      'cache-control': 'private, no-store',
    });
  });
}
