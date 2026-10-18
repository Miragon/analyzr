/**
 * Failed writes in German (UX-SIMPLIFICATION.md §3.13 item 7, UX1): every
 * `ProblemCode` of the contracts has a German sentence, never the English
 * title; a known `reason` says more than its code; the title and the
 * server's detail stay behind „Technische Details“ in toasts and alerts.
 */
import { PROBLEMS, ProblemCode } from '@analyzr/contracts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ErrorText } from '../src/components/error-text';
import { Toaster } from '../src/components/toaster';
import { ApiError, DEMO_READONLY_MESSAGE, errorDetail, errorMessage } from '../src/lib/api';
import { PROBLEM_REASON_TEXTS, PROBLEM_TEXTS } from '../src/lib/problem-texts';
import { toast } from '../src/lib/toast';

const problem = (code: ProblemCode, extra: Record<string, unknown> = {}) =>
  new ApiError(
    {
      type: `urn:analyzr:problem:${code}`,
      title: PROBLEMS[code].title,
      status: PROBLEMS[code].status,
      code,
      detail: 'the server says why',
      ...extra,
    },
    PROBLEMS[code].status,
  );

describe('German problem texts', () => {
  it('has a German sentence for every ProblemCode, none the English title', () => {
    for (const code of ProblemCode.options) {
      const text = PROBLEM_TEXTS[code];
      expect(text, code).toMatch(/^[A-ZÄÖÜ].*\.$/);
      expect(text, code).not.toContain(PROBLEMS[code].title);
      expect(errorMessage(problem(code)), code).toBe(text);
    }
    expect(Object.keys(PROBLEM_TEXTS).sort()).toEqual([...ProblemCode.options].sort());
  });

  it('says the known reasons before the code, and the code for an unknown one', () => {
    expect(errorMessage(problem('validation-failed', { reason: 'rationale-required' }))).toBe(
      'Dafür braucht es eine Begründung.',
    );
    expect(errorMessage(problem('validation-failed', { reason: 'unknown-step' }))).toBe(
      PROBLEM_REASON_TEXTS['unknown-step'],
    );
    expect(errorMessage(problem('validation-failed', { reason: 'something-new' }))).toBe(
      PROBLEM_TEXTS['validation-failed'],
    );
  });

  it('keeps the plan’s sentences for 409 and 412 and the demo’s refusal', () => {
    expect(errorMessage(problem('precondition-failed'))).toBe(
      'Inzwischen hat sich etwas geändert. Lade neu und prüf den neuen Stand.',
    );
    expect(errorMessage(problem('conflict'))).toContain(
      'Das passt nicht mehr zum aktuellen Stand.',
    );
    expect(errorMessage(problem('demo-readonly'))).toBe(DEMO_READONLY_MESSAGE);
  });

  it('gives the technical detail as title, status and the server’s detail', () => {
    expect(errorDetail(problem('conflict'))).toBe('Conflict (409): the server says why');
    expect(errorDetail(new Error('Der analyzr-Server ist nicht erreichbar.'))).toBeUndefined();
    expect(errorMessage(new Error('Der analyzr-Server ist nicht erreichbar.'))).toBe(
      'Der analyzr-Server ist nicht erreichbar.',
    );
  });

  it('shows the detail behind a closed „Technische Details“ in an alert', async () => {
    render(<ErrorText error={problem('precondition-failed')} />);
    expect(screen.getByText(PROBLEM_TEXTS['precondition-failed'])).toBeTruthy();
    const details = screen.getByTestId('technical-details');
    expect(details.hasAttribute('open')).toBe(false);
    await userEvent.setup().click(within(details).getByText('Technische Details'));
    expect(details.textContent).toContain('Precondition failed (412): the server says why');
  });

  it('shows it in a danger toast too', async () => {
    render(<Toaster />);
    act(() =>
      toast({
        tone: 'danger',
        title: 'Nicht gespeichert',
        description: errorMessage(problem('conflict')),
        error: problem('conflict'),
      }),
    );
    const item = await screen.findByTestId('toast');
    expect(item.textContent).toContain(PROBLEM_TEXTS.conflict);
    expect(within(item).getByTestId('technical-details').textContent).toContain(
      'Conflict (409): the server says why',
    );
  });
});
