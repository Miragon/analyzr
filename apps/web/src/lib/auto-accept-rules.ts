import type {
  AutoAcceptBlockReason,
  AutoAcceptCurvePoint,
  AutoAcceptDerivedGroup,
  AutoAcceptDerivedKind,
  AutoAcceptKind,
  AutoAcceptLedgerState,
  AutoAcceptPreview,
  AutoAcceptRelationType,
  AutoAcceptRule,
  AutoAcceptRuleDraft,
  AutoAcceptTier,
} from '@analyzr/client';

import { RELATION_TYPES, TIERS, handleName } from './labels';
import {
  AUTO_ACCEPT_TIERS,
  MAX_AUTO_ACCEPT_NAME_CHARS,
  MIN_AUTO_ACCEPT_CONFIDENCE,
} from './limits';

/**
 * The tab „Regeln“ (owner decision 19): German labels for kinds, tiers,
 * block reasons and ledger states, the percent input of a rule's minimum
 * confidence, drafts and the preview's history line. Only the rules page and
 * its dialogs use these (they load with the route); the marks of the review
 * views are in `auto-accept.ts`.
 */

export const AUTO_ACCEPT_KINDS: Record<AutoAcceptKind, { label: string; one: string }> = {
  relation: { label: 'Relationen', one: 'Relation' },
  placement: { label: 'Platzierungen', one: 'Platzierung' },
};

/**
 * The „Art“ of a rule (M6 S2c-3): agent proposals of relations or of
 * placements, or the rule tier's proposals of unique calls from derived
 * models (`proposedBy: 'rule'`). It never changes.
 */
export type RuleArt = AutoAcceptKind | 'calls';

export const RULE_ARTS: Record<RuleArt, string> = {
  relation: AUTO_ACCEPT_KINDS.relation.label,
  placement: AUTO_ACCEPT_KINDS.placement.label,
  calls: 'Eindeutige Aufrufe aus abgeleiteten Modellen',
};

/** The „Art“ of a rule or revision. */
export function artOf(rule: Pick<AutoAcceptRule, 'kind' | 'proposedBy'>): RuleArt {
  return rule.proposedBy === 'rule' ? 'calls' : rule.kind;
}

/** „Herkunft“ of a rule for derived calls: the source the import declares (M6 S2c-3). */
export const DERIVED_SOURCES: Record<AutoAcceptDerivedKind, string> = {
  export: 'Export ohne Camunda-Engine',
  converted: 'Konvertiert',
  none: 'Ohne Angabe',
};

/** A source in one phrase: „Export ohne Camunda-Engine“, „Konvertiert mit normalize-bpmn@0.1.0“. */
export function sourceLabel(
  derivedKind: AutoAcceptDerivedKind | null,
  converter: string | null,
): string {
  if (derivedKind === null) return '–';
  return derivedKind === 'converted' && converter
    ? `${DERIVED_SOURCES.converted} mit ${converter}`
    : DERIVED_SOURCES[derivedKind];
}

/**
 * The open unique calls from derived models of a source a rule naming it
 * would accept now (`derivedGroups`; `converted` over every converter
 * unless one is given).
 */
export function openOfSource(
  groups: readonly AutoAcceptDerivedGroup[],
  derivedKind: AutoAcceptDerivedKind,
  converter?: string,
): number {
  return groups
    .filter(
      (g) =>
        g.derivedKind === derivedKind && (converter === undefined || g.converter === converter),
    )
    .reduce((n, g) => n + g.open, 0);
}

/**
 * A rule's criteria in one line (the table, „Verlauf“): „Relationen ·
 * Gleicher Name · ab 95 %“; a rule for derived calls „Eindeutige Aufrufe aus
 * abgeleiteten Modellen · Export ohne Camunda-Engine“.
 */
export function criteriaLabel(
  rule: Pick<
    AutoAcceptRule,
    'kind' | 'tier' | 'minConfidence' | 'proposedBy' | 'derivedKind' | 'converter'
  >,
): string {
  if (rule.proposedBy === 'rule') {
    return `${RULE_ARTS.calls} · ${sourceLabel(rule.derivedKind, rule.converter)}`;
  }
  return `${AUTO_ACCEPT_KINDS[rule.kind].label} · ${tierLabel(rule.tier)} · ab ${formatThreshold(rule.minConfidence)}`;
}

/** What a rule's „Aktiv“ switch says it acts on once enabled. */
export function actsOnText(rule: Pick<AutoAcceptRule, 'proposedBy'>): string {
  return rule.proposedBy === 'rule'
    ? 'Sie wirkt auf neue Aufrufvorschläge aus abgeleiteten Modellen.'
    : 'Sie wirkt auf neue Agentenvorschläge.';
}

/** The proposal tiers as the review shows them („Gleicher Name“, „Ähnlicher Name“, „Gleiche Bedeutung“). */
export function tierLabel(tier: AutoAcceptTier): string {
  return TIERS[tier].label;
}

export function tiersOf(kind: AutoAcceptKind): readonly AutoAcceptTier[] {
  return AUTO_ACCEPT_TIERS[kind];
}

export const AUTO_ACCEPT_RELATION_TYPES: readonly AutoAcceptRelationType[] = [
  'call',
  'message',
  'signal',
  'trigger',
];

export function relationTypeLabel(type: AutoAcceptRelationType): string {
  return RELATION_TYPES[type].label;
}

/** Why a rule does not accept an open proposal, in German (preview, dry runs). */
export const AUTO_ACCEPT_BLOCK_LABELS: Record<AutoAcceptBlockReason, string> = {
  'not-agent': 'Kein Agentenvorschlag',
  'no-matching-rule': 'Erfüllt die Regel nicht',
  'agent-upload': 'Über ein Agenten-Token hochgeladen',
  'amendment-conflict': 'Ergänzung nicht mehr anwendbar',
  'stale-proposal': 'Vorschlag beruht auf einem veralteten Stand',
  'not-open': 'Nicht mehr offen',
  'endpoint-not-ok': 'Endpunkt geändert oder fehlt',
  outside: 'Außerhalb der Kette (@outside)',
  'step-removed': 'Schritt entfernt',
  'has-home-step': 'Prozess hat schon einen Heimatschritt',
  'competing-step': 'Weiterer Vorschlag auf einem anderen Schritt',
  'competing-call': 'Weiterer Aufruf vom selben Element',
  'human-involved': 'Ein Mensch war schon beteiligt',
  'agent-question': 'Offene Frage eines Agenten',
  'no-link': 'Einwand eines Agenten („Kein Zusammenhang“)',
  'agent-unsure': 'Ein anderer Agent ist unsicher',
};

export const LEDGER_STATES: Record<AutoAcceptLedgerState, string> = {
  'in-force': 'In Kraft',
  revoked: 'Widerrufen',
  'human-decided': 'Von einem Menschen entschieden',
};

const percentFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
/** A threshold in percent with every decimal it has (up to four: 0.01 ‰ steps). */
const thresholdFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 });

/** A ratio such as a precision: `0.9` → `90 %`, `14/15` → `93,3 %` (one decimal). */
export function formatPercent(value: number): string {
  return `${percentFormat.format(Math.round(value * 1000) / 10)} %`;
}

/**
 * A rule's minimum confidence: `0.9` → `90 %`, `0.9004` → `90,04 %`. Never
 * rounded to fewer decimals than it has (up to four of a percent), so a
 * threshold never reads rounder, and looser, than it is.
 */
export function formatThreshold(value: number): string {
  return `${percentInput(value)} %`;
}

/**
 * Reads a minimum confidence typed in percent (`90`, `92,5`, `92.5 %`, up to
 * four decimals, the precision {@link percentInput} shows): the fraction, or
 * `null` for anything outside 50–100 %.
 */
export function parsePercent(text: string): number | null {
  const m = /^\s*(\d{1,3}(?:[.,]\d{1,4})?)\s*%?\s*$/.exec(text);
  if (!m?.[1]) return null;
  const value = Math.round(Number(m[1].replace(',', '.')) * 10_000) / 1_000_000;
  return value >= MIN_AUTO_ACCEPT_CONFIDENCE && value <= 1 ? value : null;
}

/** The percent text of a minimum confidence for the input (`0.925` → `92,5`, `0.9004` → `90,04`). */
export function percentInput(value: number): string {
  return thresholdFormat.format(Math.round(value * 1_000_000) / 10_000);
}

/** The narrowing of a rule as short German phrases (type, agent, model, ad hoc). */
export function narrowingOf(
  rule: Pick<AutoAcceptRule, 'relationType' | 'llmModel' | 'includeAdHoc'> & {
    agentHandle?: string | null;
    agentRevoked?: boolean;
  },
): string[] {
  const out: string[] = [];
  if (rule.relationType) out.push(`Typ ${relationTypeLabel(rule.relationType)}`);
  if (rule.agentHandle)
    out.push(`Agent ${handleName(rule.agentHandle)}${rule.agentRevoked ? ' (widerrufen)' : ''}`);
  if (rule.llmModel) out.push(`LLM-Modell ${rule.llmModel}`);
  if (rule.includeAdHoc) out.push('auch Ad-hoc');
  return out;
}

/** The draft of a rule's head revision (what an edit or a switch starts from). */
export function draftOf(rule: AutoAcceptRule): AutoAcceptRuleDraft {
  return {
    name: rule.name,
    enabled: rule.enabled,
    note: rule.note,
    kind: rule.kind,
    tier: rule.tier,
    minConfidence: rule.minConfidence,
    relationType: rule.relationType,
    agentPrincipalId: rule.agentPrincipalId,
    llmModel: rule.llmModel,
    includeAdHoc: rule.includeAdHoc,
    proposedBy: rule.proposedBy,
    derivedKind: rule.derivedKind,
    converter: rule.converter,
  };
}

/**
 * The history line: what the rule would have accepted so far and how humans
 * decided it; for a rule for derived calls (`calls`, M6 S2c-3) such calls.
 */
export function historyText(h: AutoAcceptPreview['history'], calls = false): string {
  const decided = [
    `${h.accepted} angenommen`,
    `${h.rejected} abgelehnt`,
    `${h.corrected} korrigiert`,
    ...(h.held > 0 ? [`${h.held} vorgemerkt`] : []),
  ].join(', ');
  const precision =
    h.precision === null ? 'noch keine Trefferquote' : `Trefferquote ${formatPercent(h.precision)}`;
  const what = calls ? 'Aufrufen aus abgeleiteten Modellen' : 'Agentenvorschlägen';
  return (
    `Bisher: ${h.wouldAccept} von ${h.decided} entschiedenen ${what} hätte die Regel ` +
    `angenommen – davon ${decided} (${precision})`
  );
}

/**
 * What another owner changed between two revisions, as German phrases: the
 * rule dialog lists them after loading a newer revision (412).
 */
export function revisionChanges(from: AutoAcceptRule, to: AutoAcceptRule): string[] {
  const agent = (r: AutoAcceptRule) =>
    r.agentPrincipalId === null
      ? 'alle Agenten'
      : handleName(r.agent?.handle ?? r.agentPrincipalId);
  const out: string[] = [];
  const diff = (label: string, a: string, b: string) => {
    if (a !== b) out.push(`${label}: ${a} → ${b}`);
  };
  diff('Status', from.enabled ? 'aktiv' : 'aus', to.enabled ? 'aktiv' : 'aus');
  diff('Name', `„${from.name}“`, `„${to.name}“`);
  if (from.proposedBy === 'rule' || to.proposedBy === 'rule') {
    // A rule for derived calls (M6 S2c-3): its source; the rest is fixed.
    diff(
      'Herkunft',
      sourceLabel(from.derivedKind, from.converter),
      sourceLabel(to.derivedKind, to.converter),
    );
    diff('Notiz', from.note ? `„${from.note}“` : 'keine', to.note ? `„${to.note}“` : 'keine');
    return out;
  }
  diff('Grundlage', tierLabel(from.tier), tierLabel(to.tier));
  diff('ab Konfidenz', formatThreshold(from.minConfidence), formatThreshold(to.minConfidence));
  diff(
    'Typ',
    from.relationType ? relationTypeLabel(from.relationType) : 'alle Typen',
    to.relationType ? relationTypeLabel(to.relationType) : 'alle Typen',
  );
  diff('Agent', agent(from), agent(to));
  diff('LLM-Modell', from.llmModel ?? 'alle Modelle', to.llmModel ?? 'alle Modelle');
  diff('Ad-hoc-Vorschläge', from.includeAdHoc ? 'ja' : 'nein', to.includeAdHoc ? 'ja' : 'nein');
  diff('Notiz', from.note ? `„${from.note}“` : 'keine', to.note ? `„${to.note}“` : 'keine');
  return out;
}

// ------------------------------------------------------------------- UX9

/**
 * `name` with `suffix` within {@link MAX_AUTO_ACCEPT_NAME_CHARS} (UTF-16
 * units, as the server counts): cut at a code point and ended with „…“ when
 * too long (a converter may have 120 characters, a name 100).
 */
export function fitRuleName(name: string, suffix = ''): string {
  if (name.length + suffix.length <= MAX_AUTO_ACCEPT_NAME_CHARS) return name + suffix;
  const budget = MAX_AUTO_ACCEPT_NAME_CHARS - suffix.length - 1;
  let cut = '';
  for (const ch of name) {
    if (cut.length + ch.length > budget) break;
    cut += ch;
  }
  return `${cut.trimEnd()}…${suffix}`;
}

/**
 * The name of a rule for derived calls from its source: „Aufrufe: Export
 * ohne Engine“ (M6 S2c-3), shortened to fit ({@link fitRuleName}).
 */
export function derivedRuleName(
  derivedKind: AutoAcceptDerivedKind,
  converter: string | null,
): string {
  if (derivedKind === 'converted') {
    return converter
      ? fitRuleName(`Aufrufe: konvertiert mit ${converter}`)
      : 'Aufrufe: konvertiert';
  }
  return derivedKind === 'export' ? 'Aufrufe: Export ohne Engine' : 'Aufrufe: ohne Angabe';
}

/**
 * A new rule's name from its criteria (UX-SIMPLIFICATION.md §3.11 item 4,
 * P4): „Gleicher Name ab 95 %“, with the type or the kind in front where the
 * criteria name one („Nachricht: …“, „Platzierung: …“), and „(2)“, „(3)“ …
 * while another rule of the project has the name (names are unique ignoring
 * case). `threshold` is the minimum confidence as the field shows it („95 %“).
 * A rule for derived calls (`derived`, M6 S2c-3) is named by its source:
 * „Aufrufe: konvertiert mit normalize-bpmn@0.1.0“.
 */
export function suggestedRuleName(
  criteria: {
    kind: AutoAcceptKind;
    tier: AutoAcceptTier;
    relationType: AutoAcceptRelationType | null;
    threshold: string;
    derived?: { derivedKind: AutoAcceptDerivedKind; converter: string | null } | null;
  },
  taken: readonly string[],
): string {
  const prefix =
    criteria.kind === 'placement'
      ? AUTO_ACCEPT_KINDS.placement.one
      : criteria.relationType
        ? relationTypeLabel(criteria.relationType)
        : null;
  const base = criteria.derived
    ? derivedRuleName(criteria.derived.derivedKind, criteria.derived.converter)
    : `${prefix ? `${prefix}: ` : ''}${tierLabel(criteria.tier)} ab ${criteria.threshold}`;
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = fitRuleName(base, ` (${n})`);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** The numbers a row of the preview's curve shows. */
function curveNumbers(c: AutoAcceptCurvePoint): string {
  return [c.wouldAccept, c.accepted, c.rejected + c.corrected, c.precision, c.open].join('|');
}

/**
 * „Nach Konfidenz aufschlüsseln“ (UX9): only the rows whose numbers change,
 * each the lowest threshold of a run of equal numbers, plus the rule's own
 * threshold (marked) where the curve has it.
 */
export function changingCurve(
  curve: readonly AutoAcceptCurvePoint[],
  minConfidence: number | null,
): AutoAcceptCurvePoint[] {
  const out: AutoAcceptCurvePoint[] = [];
  let previous: string | null = null;
  for (const c of curve) {
    const numbers = curveNumbers(c);
    const own = minConfidence !== null && Math.abs(c.minConfidence - minConfidence) < 1e-9;
    if (numbers !== previous || own) out.push(c);
    previous = numbers;
  }
  return out;
}

/** „2 offene Vorschläge passen“: the open proposals a rule's dry run finds. */
export function openMatchesText(count: number): string {
  return count === 1 ? '1 offener Vorschlag passt' : `${count} offene Vorschläge passen`;
}

/**
 * The bulk accept's name flags among a preview's or dry run's items (UX9,
 * Q8: shown, never blocking); `atLeast` while the list holds only the first
 * of them.
 */
export function nameFlagsText(count: number, atLeast: boolean): string {
  return `davon ${atLeast ? 'mindestens ' : ''}${count} mit allgemeinem oder mehrfach genutztem Namen (in der Sammelannahme markiert)`;
}

/**
 * Why open proposals need an explicit apply (rules are never retroactive):
 * the switch's confirmation and the offer after saving say it alike.
 */
export const OPEN_PROPOSALS_HINT =
  'Regeln wirken nur auf neue Vorschläge. Offene nimmst du nur an, wenn du sie ausdrücklich anwendest; vorher siehst du die Liste.';
