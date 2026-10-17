/**
 * Answers to open questions (M6 §4.5, S5a), the pure part: where an answer's
 * text lands, the API view of a stored answer, and the check of a filled-in
 * sheet's rows against the current items. The use case
 * (`use-cases/open-questions.ts`) records what this lets through.
 */
import {
  MAX_ANSWER_CHARS,
  answerKindFromCell,
  hasControlCharacters,
  normalizeAnswerText,
  personalDataWarnings,
  type AnswerSheetResult,
  type AnswerSheetRowResult,
  type OpenQuestion,
  type OpenQuestionAnswer,
  type OpenQuestionAnswerKind,
  type OpenQuestionAnswerTarget,
  type OpenQuestionSubject,
} from '@analyzr/contracts';

import type { StoredOpenQuestionAnswer } from '../ports.ts';

/**
 * Where the text of an answer on this subject lands (M6 §4.5 "Where the text
 * lands"): a human note on a relation or placement, else the answer row.
 */
export function answerTarget(subject: Pick<OpenQuestionSubject, 'type'>): OpenQuestionAnswerTarget {
  return subject.type === 'relation'
    ? 'relation-note'
    : subject.type === 'placement'
      ? 'placement-note'
      : 'answer';
}

/** A stored answer as the API shows it. */
export function toOpenQuestionAnswer(a: StoredOpenQuestionAnswer): OpenQuestionAnswer {
  return {
    id: a.id,
    questionId: a.questionId,
    kind: a.kind,
    target: answerTarget({ type: a.subjectType }),
    text: a.answerText,
    note:
      a.noteAssertionId === null || (a.subjectType !== 'relation' && a.subjectType !== 'placement')
        ? null
        : { type: a.subjectType, subjectId: a.subjectId, assertionId: a.noteAssertionId },
    by: a.handle,
    sourceKind: 'human',
    seq: a.seq,
    at: a.createdAt.toISOString(),
  };
}

/** One answer to record: the current item, the kind and the text (normalized, valid). */
export interface AnswerDraft {
  question: OpenQuestion;
  kind: OpenQuestionAnswerKind;
  text: string;
}

/**
 * The item's latest answer when the draft is identical to it (same kind and
 * text): recording it again changes nothing. Only the latest counts, since
 * the export and the list show it as the current answer: going back to an
 * earlier answer records it again, so it becomes the latest. With
 * `anyKind`, the text alone decides (a sheet row without an `Antwortart`).
 */
export function sameAnswer(
  draft: AnswerDraft,
  options: { anyKind?: boolean } = {},
): OpenQuestionAnswer | undefined {
  const latest = draft.question.answers.at(-1);
  if (latest?.text !== draft.text) return undefined;
  return options.anyKind === true || latest.kind === draft.kind ? latest : undefined;
}

/** The rows of a sheet as `POST …/open-questions/answers` takes them. */
export interface SheetRow {
  id: string;
  text: string;
  kind: string;
}

/** A sheet checked against the current items: the result without the stored answers, and what to record. */
export interface CheckedSheet {
  counts: AnswerSheetResult['counts'];
  rows: AnswerSheetRowResult[];
  /** The rows to record, in order, each with its result (for the stored answer). */
  record: { result: AnswerSheetRowResult; draft: AnswerDraft }[];
}

/**
 * Checks a filled-in sheet (M6 §4.5 "Bulk answers") against the current
 * items, row by row: an empty answer is ignored (counted only); an id that
 * names no current item is `unknown` (also one whose source changed since
 * the export, which changed the id); a second row for an id, a text over
 * {@link MAX_ANSWER_CHARS} characters, control characters or an unknown
 * `Antwortart` are `invalid`; an answer identical to the item's latest one
 * is `unchanged` (with an empty `Antwortart`, which a sheet without the
 * column also gives, the same text whatever the latest kind, so a re-saved
 * export records nothing twice); the rest is `recorded`. Texts are
 * normalized ({@link normalizeAnswerText}); every listed row carries the
 * personal-data check's warnings.
 */
export function checkSheet(
  rows: readonly SheetRow[],
  items: ReadonlyMap<string, OpenQuestion>,
): CheckedSheet {
  const counts = { recorded: 0, unchanged: 0, unknown: 0, invalid: 0, ignored: 0 };
  const out: AnswerSheetRowResult[] = [];
  const record: CheckedSheet['record'] = [];
  const seen = new Set<string>();
  for (const [i, cells] of rows.entries()) {
    const text = normalizeAnswerText(cells.text);
    if (text === '') {
      counts.ignored++;
      continue;
    }
    const id = cells.id.trim();
    const result: AnswerSheetRowResult = {
      row: i + 1,
      id: cells.id,
      outcome: 'invalid',
      warnings: personalDataWarnings(text),
    };
    out.push(result);
    const question = items.get(id);
    const kind = answerKindFromCell(cells.kind);
    if (!question) result.outcome = 'unknown';
    else if (seen.has(id)) result.reason = 'duplicate-id';
    else if (text.length > MAX_ANSWER_CHARS) result.reason = 'too-long';
    else if (hasControlCharacters(text)) result.reason = 'control-characters';
    else if (kind === null) result.reason = 'unknown-kind';
    else {
      const draft: AnswerDraft = { question, kind, text };
      const same = sameAnswer(draft, { anyKind: cells.kind.trim() === '' });
      result.outcome = same ? 'unchanged' : 'recorded';
      result.kind = kind;
      result.target = answerTarget(question.subject);
      if (same) result.answer = same;
      else record.push({ result, draft });
    }
    if (question) seen.add(id);
    counts[result.outcome]++;
  }
  return { counts, rows: out, record };
}
