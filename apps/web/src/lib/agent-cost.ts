import type { ImportImpact } from '@analyzr/client';
import { useState } from 'react';

/**
 * The agent work a write sets off, repeats or destroys, in the web's words
 * (M6 §3.5 and §4.8 c, S2b follow-up step 3): the „Vorschau“'s cost line and
 * its warning for a claimed relations task, and the second click before a
 * write that cancels an agent's claim, which the amend form shares. In the
 * entry, since the „Vorschau“ is on „Hochladen“; `amendments.ts` (lazy)
 * re-exports what its forms use.
 */

const de = (n: number) => n.toLocaleString('de-DE');

/** „1 mögliche Relation“, „1.234 mögliche Relationen“. */
export function possibleRelationsText(n: number): string {
  return n === 1 ? '1 mögliche Relation' : `${de(n)} mögliche Relationen`;
}

/**
 * The size of the agents' next run beside the models waiting for them
 * (M6 S2b follow-up step 3b, „Als Nächstes“ on „Übersicht“ and after an
 * import): „etwa 7.300 mögliche Relationen“, the pairs the waiting
 * relations tasks will judge (`ProjectSummary.pairsToJudge`). „etwa“, as it
 * is the run as of now (decisions and imports before the claims change it,
 * agents may examine more pairs), except for one pair: „1 mögliche
 * Relation“. `null` for none.
 */
export function pairsToJudgeText(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? possibleRelationsText(1) : `etwa ${possibleRelationsText(n)}`;
}

/** The warning before a save that cancels a claimed relations task (M6 §4.8 c). */
export const CLAIMED_WARNING =
  'Ein Agent bearbeitet dieses Modell gerade; seine Arbeit geht verloren.';

/**
 * The processes the placement task places for this write: with a task the
 * write queues (`queued`, none waited), every process due then, also those
 * due before (a deletion queues no task); with one waiting
 * (`open`) or held by an agent (`deferred`, its follow-up) the newly due
 * ones, since the waiting task covers the rest anyway. Never below `newlyDue`
 * (across batches `due` is the largest batch's, `newlyDue` their sum), so
 * the ones placed „erneut“ stay a part of it; 0 when the write does not
 * trigger the task or nothing is due. The CLI's `placementWork` counts the
 * same.
 */
export function processesToPlace(task: NonNullable<ImportImpact['placementTask']>): number {
  if (task.outcome === 'queued') return Math.max(task.due, task.newlyDue);
  return task.outcome === 'open' || task.outcome === 'deferred' ? task.newlyDue : 0;
}

/**
 * The „Vorschau“'s cost line (UX-SIMPLIFICATION.md §6): „214 mögliche
 * Relationen zu beurteilen (56 davon erneut), 7 Prozesse zu platzieren (5
 * davon erneut)“, `null` without agent work. The relations part counts
 * `pairs`, an upper bound while other models' tasks wait (they may judge a
 * pair anyway), so the line never calls it new work; the pairs judged again
 * are the reliable part. The placement part only when the write triggers
 * the chain's placement task (with a live chain) and it has processes to
 * place ({@link processesToPlace}), those an agent had placed „erneut“, also
 * while an agent holds the task (its follow-up places them). More than one
 * batch adds up counts each batch makes against the head: „etwa“ in front.
 * That is no bound either way: a pair between two models of the head in two
 * batches counts in both, one between new models of two batches in neither
 * (the batch note says so: `batchNoteText` in `upload.ts`).
 */
export function agentCostText(
  impact: Pick<ImportImpact, 'relationsTasks' | 'placementTask'>,
  batches = 1,
): string | null {
  const again = (n: number) => (n > 0 ? ` (${de(n)} davon erneut)` : '');
  const { pairs, rejudged } = impact.relationsTasks;
  const task = impact.placementTask;
  const place = task ? processesToPlace(task) : 0;
  const parts = [
    pairs > 0 ? `${possibleRelationsText(pairs)} zu beurteilen${again(rejudged.count)}` : null,
    place > 0
      ? `${place === 1 ? '1 Prozess' : `${de(place)} Prozesse`} zu platzieren${again(task?.again ?? 0)}`
      : null,
  ].filter((p) => p !== null);
  if (parts.length === 0) return null;
  return `${batches > 1 ? 'etwa ' : ''}${parts.join(', ')}`;
}

/** Claimed models the warning names before „und N weitere“. */
const CLAIMED_NAMED = 3;

/**
 * The „Vorschau“'s warning when the import cancels relations tasks an agent
 * holds (their work is lost; `relationsTasks.claimed`, the claimed tasks
 * listed first): one model by its key, several by count with the first
 * three. No handle and no lease: as in the amend form. `null` for none (a
 * placement task an agent holds keeps its work and gets no warning).
 */
export function claimedImportWarning(
  tasks: ImportImpact['relationsTasks'],
): { title: string; description: string } | null {
  if (tasks.claimed === 0) return null;
  const keys = tasks.cancelled.items.filter((t) => t.state === 'claimed').map((t) => t.modelKey);
  if (tasks.claimed === 1) {
    const [key] = keys;
    return {
      title: `Ein Agent bearbeitet ${key ? `„${key}“` : 'eines dieser Modelle'} gerade; seine Arbeit geht verloren.`,
      description: 'Der Import bricht seine Analyse ab; sie wird danach neu eingeplant.',
    };
  }
  const named = keys.slice(0, CLAIMED_NAMED).map((k) => `„${k}“`);
  const more = tasks.claimed - named.length;
  const last = more > 0 ? `${more} weitere` : named.pop();
  const names = named.length > 0 && last ? `${named.join(', ')} und ${last}. ` : '';
  return {
    title: `Agenten bearbeiten gerade ${de(tasks.claimed)} dieser Modelle; ihre Arbeit geht verloren.`,
    description: `${names}Der Import bricht ihre Analysen ab; sie werden danach neu eingeplant.`,
  };
}

/**
 * The second click before a write that cancels an agent's claim
 * (UX-SIMPLIFICATION.md §3.4 item 4): while `needed`, the first `confirm()`
 * for a request sends nothing and arms („Trotzdem …“); the next for the same
 * request may write. Another request (a new dry run, a new preview)
 * disarms. A double click arms only: the button's `onClick` passes its
 * event to `repeated`, which takes the later clicks of one (`detail` above
 * 1, a keyboard's click has 0) while `needed` and prevents their default (a
 * form's submit).
 */
export function useSecondClick<T>(needed: boolean, request: T | null) {
  const [armedFor, setArmedFor] = useState<T | null>(null);
  const armed = needed && armedFor !== null && armedFor === request;
  return {
    armed,
    /** Whether the click may write now (else it armed the second click). */
    confirm: (): boolean => {
      if (!needed || armed) return true;
      setArmedFor(request);
      return false;
    },
    /** Whether `event` is a later click of a double click, which sends nothing (then prevented). */
    repeated: (event: { detail: number; preventDefault: () => void }): boolean => {
      if (!needed || event.detail < 2) return false;
      event.preventDefault();
      return true;
    },
  };
}
