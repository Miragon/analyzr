/**
 * The value flag of each amendment op (M6 S5c-2), shared by `analyzr models
 * amend` and `analyzr questions amend` (`amend.ts`) and by the hints of
 * `analyzr questions` that name them (`questions.ts`, `questions-answer.ts`);
 * a leaf module, so none of them imports another for it.
 */
import type { AmendmentOp } from '@analyzr/contracts';

/** The flag that sets each op, and the placeholder hints show for its value. */
export const AMEND_VALUE_FLAGS: Readonly<
  Record<AmendmentOp, { flag: string; placeholder: string }>
> = {
  'call-target': { flag: '--call-target', placeholder: '<target>' },
  'message-name': { flag: '--message-name', placeholder: '<name>' },
  'event-name': { flag: '--name', placeholder: '<label>' },
  'process-documentation': { flag: '--documentation', placeholder: '<text>' },
};
