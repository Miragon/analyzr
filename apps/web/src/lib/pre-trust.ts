/**
 * „Vor der Vertrauensregel angenommen“ (M6 S2c-4, owner decisions 24.2 (a)
 * and 28 (3)): the texts of the system rule card's line and its dialog. The
 * rules page's lazy chunk loads them, never the entry.
 */
import type { PreTrustModel, PreTrustReviewResult } from '@analyzr/client';

import { trustReasonLabel } from './provenance';

const calls = (n: number) => (n === 1 ? '1 Aufruf' : `${n} Aufrufe`);

/** The card's line: „12 vor der Vertrauensregel angenommen – prüfen…“. */
export function preTrustCardText(count: number): string {
  return `${count} vor der Vertrauensregel angenommen – prüfen…`;
}

/** One model's detail line: „2 Aufrufe · ohne Camunda-Engine“. */
export function preTrustModelDetail(model: Pick<PreTrustModel, 'count' | 'reasons'>): string {
  return [calls(model.count), model.reasons.map(trustReasonLabel).join('; ')].join(' · ');
}

/**
 * The dry run of „Zurück in die Prüfung“ in one line: „3 Aufrufe gehen
 * zurück in die Prüfung.“, and when an owner's rule for derived calls takes
 * some of them again in the same step „ Deine Regel „…“ nimmt 2 davon gleich
 * wieder an.“ (of these calls: `ofProposed`, as the toast counts them).
 */
export function preTrustDryRunText(
  result: Pick<PreTrustReviewResult, 'toProposed' | 'autoAcceptedCalls'>,
): string {
  const n = result.toProposed;
  const head =
    n === 1 ? '1 Aufruf geht zurück in die Prüfung.' : `${n} Aufrufe gehen zurück in die Prüfung.`;
  const auto = result.autoAcceptedCalls;
  const taken = auto.ofProposed;
  if (taken === 0) return head;
  const [only] = auto.byRule;
  const who =
    auto.byRule.length === 1 && only
      ? `Deine Regel „${only.ruleName}“ nimmt`
      : 'Deine Regeln nehmen';
  const what = taken === n ? (n === 1 ? 'ihn' : 'sie alle') : `${taken} davon`;
  return `${head} ${who} ${what} gleich wieder an.`;
}

/** Below the dry run: „Behalten“ is decided once. */
export const PRE_TRUST_KEEP_NOTE =
  '„Behalten“ lässt sie angenommen; danach fragt analyzr bei diesen Modellen nicht mehr.';

/** The toast after „Zurück in die Prüfung“ or „Behalten“. */
export function preTrustDoneToast(result: PreTrustReviewResult): {
  title: string;
  description: string;
  /** Calls left for „Gesammelt annehmen“. */
  open: number;
} {
  if (result.verdict === 'modelled') {
    return {
      title: `${calls(result.count)} behalten`,
      description: 'Sie bleiben angenommen; analyzr fragt nicht mehr danach.',
      open: 0,
    };
  }
  if (result.toProposed === 0) {
    return {
      title: `${calls(result.count)} geprüft`,
      description: 'An ihrem Status ändert sich nichts.',
      open: 0,
    };
  }
  const taken = result.autoAcceptedCalls.ofProposed;
  const open = Math.max(0, result.toProposed - taken);
  const rules =
    result.autoAcceptedCalls.byRule.length > 1 ? 'Deine Regeln haben' : 'Deine Regel hat';
  return {
    title: `${calls(result.toProposed)} zurück in der Prüfung`,
    description:
      open === 0
        ? `${rules} ${result.toProposed === 1 ? 'ihn' : 'sie'} gleich wieder angenommen.`
        : taken > 0
          ? `${rules} ${taken} davon gleich wieder angenommen; die übrigen nimmst du gesammelt an.`
          : 'Sie stehen in der Prüfung; nimm sie dort gesammelt an.',
    open,
  };
}
