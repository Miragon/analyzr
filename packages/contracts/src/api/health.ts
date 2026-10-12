import { z } from 'zod';

/** Longest legal link a read-only demo reports (`ANALYZR_DEMO_IMPRINT_URL`, `ANALYZR_DEMO_PRIVACY_URL`). */
export const MAX_DEMO_LINK_LENGTH = 2048;

/** An absolute https URL of the demo operator's legal pages. */
const DemoLink = z.url({ protocol: /^https$/ }).max(MAX_DEMO_LINK_LENGTH);

/** `GET /health`: liveness plus a database ping. */
export const Health = z
  .object({
    status: z.enum(['ok', 'degraded']),
    /** analyzr version, e.g. `0.1.0-alpha.0`. */
    version: z.string(),
    db: z.enum(['ok', 'down']),
    /**
     * Present only on a read-only demo (`ANALYZR_DEMO=readonly`, owner decision 20): every
     * write answers 403 `demo-readonly`, MCP is off, the session is a viewer's.
     * Absent in local mode, whose answer stays as before.
     */
    demo: z
      .literal('readonly')
      .optional()
      .meta({ description: 'Present only on a read-only demo: nothing can be changed.' }),
    /**
     * The demo operator's legal notice (Impressum), from `ANALYZR_DEMO_IMPRINT_URL`:
     * only on a read-only demo whose operator set it. The web UI's banner links it.
     */
    imprintUrl: DemoLink.optional().meta({
      description:
        'Only on a read-only demo whose operator set one: the absolute https URL of its legal notice (Impressum).',
    }),
    /**
     * The demo operator's privacy policy, from `ANALYZR_DEMO_PRIVACY_URL`: only on
     * a read-only demo whose operator set it. The web UI's banner links it.
     */
    privacyUrl: DemoLink.optional().meta({
      description:
        'Only on a read-only demo whose operator set one: the absolute https URL of its privacy policy.',
    }),
  })
  .meta({ id: 'Health', description: 'Server health.' });
export type Health = z.infer<typeof Health>;
