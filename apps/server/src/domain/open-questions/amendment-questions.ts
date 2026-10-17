/**
 * Conflicts of model amendments as open questions (M6 §4.8 c, S5c-2): every
 * live amendment the head's plan marks `conflict` is one item of kind
 * `amendment-conflict` („Ergänzung nicht mehr anwendbar“), source
 * `amendment`, subject the element's ref, versioned by the amendment id and
 * the uploaded revision's id, so a new import asks again. Its text names
 * the field and shows the value before, analyzr's value and the incoming
 * value side by side; the incoming value is what the head's facts read at
 * the element (a conflicting field is never spliced). Pure.
 */
import {
  AMENDABLE_ELEMENT_LABELS,
  amendmentFieldLabel,
  amendmentFieldQuestion,
  articleOf,
  endpointTypeLabel,
  formatRef,
  type AmendmentNameFamily,
} from '@analyzr/contracts';
import { quoteDe } from '@analyzr/relations';

import type { AmendmentInfo, Draft, ModelAmendments, OpenQuestionIndex } from './model.ts';

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `„value“`, or „(leer)“ for no value. */
function shown(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '(leer)' : quoteDe(value);
}

/** The ref a conflict is shown at: the endpoint the form was opened from, else the element. */
export function amendmentAnchor(modelKey: string, a: AmendmentInfo): string {
  return formatRef(modelKey, a.viaElementId ?? a.elementId);
}

/**
 * The value the head's facts read at a conflicting amendment's element: the
 * call target, the start or end event's name, the message or signal name of
 * the endpoint (the one the form was opened from), the documentation;
 * `undefined` when the element has no such fact.
 */
export function incomingValue(
  ix: OpenQuestionIndex,
  modelKey: string,
  a: AmendmentInfo,
): string | null | undefined {
  const facts = ix.factsAt(amendmentAnchor(modelKey, a));
  switch (a.op) {
    case 'call-target':
      return facts.find((f) => f.kind === 'call')?.keyRaw;
    case 'event-name': {
      const f = facts.find((x) => x.kind === 'evt_start' || x.kind === 'evt_end');
      return f === undefined ? undefined : f.label === '' ? null : f.label;
    }
    case 'message-name': {
      const f = facts.find((x) => x.kind.startsWith('msg_') || x.kind.startsWith('sig_'));
      if (f === undefined) return undefined;
      return (f.kind.startsWith('msg_') ? f.attrs.messageName : f.attrs.signalName) ?? null;
    }
    case 'process-documentation': {
      const f = facts.find((x) => x.kind === 'process');
      return f === undefined ? undefined : (f.attrs.documentation ?? null);
    }
  }
}

/** Whether the name at an endpoint is a message's or a signal's, by the head facts there. */
function familyAt(ix: OpenQuestionIndex, anchor: string): AmendmentNameFamily {
  const ep = ix.factsAt(anchor).find((x) => /^(msg|sig)_/.test(x.kind));
  return ep === undefined ? null : ep.kind.startsWith('sig_') ? 'signal' : 'message';
}

/** The German type of the element a conflict is shown at: „Endereignis“, „Nachrichten-Endereignis“ … */
function typeAt(ix: OpenQuestionIndex, anchor: string, a: AmendmentInfo): string {
  switch (a.op) {
    case 'call-target':
      return AMENDABLE_ELEMENT_LABELS.call;
    case 'process-documentation':
      return AMENDABLE_ELEMENT_LABELS.process;
    case 'event-name':
      return ix.factsAt(anchor).some((f) => f.kind === 'evt_end')
        ? AMENDABLE_ELEMENT_LABELS['end-event']
        : AMENDABLE_ELEMENT_LABELS['start-event'];
    case 'message-name': {
      const ep = ix.factsAt(anchor).find((x) => /^(msg|sig)_/.test(x.kind));
      return endpointTypeLabel(ep?.attrs.elementType, familyAt(ix, anchor));
    }
  }
}

/** One `amendment-conflict` item per live amendment the head's plan marks `conflict`. */
export function amendmentQuestions(ix: OpenQuestionIndex): Draft[] {
  const out: Draft[] = [];
  const models = [...(ix.input.amendments ?? new Map<string, ModelAmendments>()).entries()].sort(
    ([a], [b]) => byCodePoint(a, b),
  );
  for (const [modelKey, m] of models) {
    const live = new Map<string, AmendmentInfo>(m.live.map((a) => [a.id, a]));
    for (const entry of m.plan) {
      if (entry.outcome !== 'conflict') continue;
      const a = live.get(entry.id);
      if (!a) continue;
      const subject = formatRef(modelKey, a.elementId);
      const anchor = amendmentAnchor(modelKey, a);
      const family = a.op === 'message-name' ? familyAt(ix, anchor) : null;
      const field = amendmentFieldLabel(a.op, family);
      const known = ix.factsAt(anchor).length > 0;
      const type = typeAt(ix, anchor, a);
      const article = articleOf(type);
      // „das Endereignis „Ende“ in „Auftrag““ (accusative), „dem Endereignis …“ (dative).
      const acc = known
        ? `${article.acc} ${type} ${ix.elementInProcess(anchor)}`
        : quoteDe(a.elementId);
      const dat = known
        ? `${article.dat} ${type} ${ix.elementInProcess(anchor)}`
        : quoteDe(a.elementId);
      const values = `Vorher: ${shown(a.before)}, in analyzr ergänzt: ${shown(a.after)}`;
      const incoming = incomingValue(ix, modelKey, a);
      let text: string;
      switch (entry.reason) {
        case 'value-changed':
          text =
            `${amendmentFieldQuestion(a.op, family)} gilt für ${acc}? Das Quellsystem hat den ` +
            `Wert seit der Ergänzung geändert, deshalb überschreibt analyzr ihn nicht. ` +
            `Jetzt im Quellsystem: ${shown(incoming)}, in analyzr ergänzt: ${shown(a.after)}; ` +
            `vorher: ${shown(a.before)}.`;
          break;
        case 'expression':
          text =
            `Die Ergänzung (${field}) an ${dat} passt nicht mehr: Im Quellsystem steht jetzt ` +
            `der Ausdruck ${shown(incoming)}, der erst zur Laufzeit ausgewertet wird; dort ` +
            `ergänzt analyzr nichts. ${values}.`;
          break;
        default:
          text =
            `Die Ergänzung (${field}) an ${dat} lässt sich nicht mehr anwenden: Das Element ` +
            `fehlt im Modell aus dem Quellsystem oder ist dort nicht mehr ergänzbar. ${values}.`;
      }
      out.push({
        kind: 'amendment-conflict',
        source: 'amendment',
        subject: { type: 'ref', id: subject },
        subjectLabel: quoteDe(ix.factsAt(anchor).length > 0 ? ix.elementName(anchor) : a.elementId),
        version: `${a.id}|${m.uploadedRevisionId}`,
        modelKeys: [modelKey],
        text,
        refs: [...new Set([subject, anchor])],
        raisedBy: { sourceKind: 'rule', handle: null, seq: ix.headSeq([modelKey]) },
        anchors: { refs: [anchor] },
      });
    }
  }
  return out;
}
