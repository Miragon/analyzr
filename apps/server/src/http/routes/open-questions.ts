import { createRoute } from '@hono/zod-openapi';
import { MAX_ANSWER_SHEET_BODY_BYTES, apiRoutes } from '@analyzr/contracts';
import { bodyLimit } from 'hono/body-limit';

import type { UseCases } from '../../domain/use-cases/index.ts';
import { requireActor, type App } from '../context.ts';
import { problemResponse } from '../problem.ts';
import { toHonoPath } from './not-implemented.ts';

/** Open questions, their export (M6 §4.4) and their answers (M6 §4.5, S5a). */
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

  app.openapi(createRoute(apiRoutes.answerOpenQuestion), async (c) => {
    const { project, question } = c.req.valid('param');
    const result = await useCases.answerOpenQuestion(
      requireActor(c),
      project,
      question,
      c.req.valid('json'),
    );
    return c.json(result, result.result === 'recorded' ? 201 : 200);
  });

  app.use(
    toHonoPath(apiRoutes.answerOpenQuestions.path),
    bodyLimit({
      maxSize: MAX_ANSWER_SHEET_BODY_BYTES,
      onError: () =>
        problemResponse(
          'payload-too-large',
          `the answers of a sheet may have at most ${MAX_ANSWER_SHEET_BODY_BYTES} bytes per call`,
        ),
    }),
  );

  app.openapi(createRoute(apiRoutes.answerOpenQuestions), async (c) => {
    const { project } = c.req.valid('param');
    const { dryRun } = c.req.valid('query');
    return c.json(
      await useCases.answerOpenQuestions(requireActor(c), project, c.req.valid('json'), {
        dryRun: dryRun === 'true',
      }),
      200,
    );
  });
}
