/**
 * A deterministic check for personal data in free text (M6 §4.5, S5a):
 * e-mail addresses, phone numbers and IBANs. It warns and never blocks: the
 * answer dialog shows the hint, the answer routes return the warnings with
 * the stored answer. S7's guard on agents' free text uses the same function.
 *
 * What counts (tuned for few false positives on process texts, which are
 * full of ids, dates, versions and amounts):
 * - **e-mail:** `local@domain.tld` with a top-level domain of at least two
 *   letters;
 * - **phone:** digits with single spaces, `-`, `/` or parentheses between
 *   them, or ` / `, ` - `, ` – ` (`089 / 12 34 56`), not inside a word or a
 *   number: `+` and 8–15 digits, `00` and a country code (not 0) with 8–15
 *   more digits, or a national `0` and an area code (not 0; `01` only as
 *   the mobile prefixes 015–017) with 9–14 digits in all. No phone number:
 *   a leading date (`01-10-2026`, `01/10/2026`), a bare run of fewer than 11
 *   digits (SAP and other document numbers have 10 with leading zeros,
 *   `0090001234`), and digits right after an id's label (`Sachkonto`,
 *   `Rechnung`, `Beleg`, `Prozess-ID` …);
 * - **IBAN:** two letters, two check digits and 11–30 letters or digits
 *   (single spaces allowed between groups) whose ISO 13616 checksum holds
 *   (mod 97 = 1), so a random code is no IBAN.
 *
 * Zod-free on purpose: the web imports it at runtime as
 * `@analyzr/contracts/personal-data`.
 */

/** The kinds of personal data the check finds. */
export const PERSONAL_DATA_KINDS = ['email', 'phone', 'iban'] as const;
export type PersonalDataKind = (typeof PERSONAL_DATA_KINDS)[number];

/**
 * One finding of the check: its kind and where it is (UTF-16 offsets, `end`
 * exclusive). The API carries it as `PersonalDataWarning`.
 */
export interface PersonalDataMatch {
  kind: PersonalDataKind;
  start: number;
  end: number;
}

/** German label of each kind. */
export const PERSONAL_DATA_LABELS: Readonly<Record<PersonalDataKind, string>> = {
  email: 'E-Mail-Adresse',
  phone: 'Telefonnummer',
  iban: 'IBAN',
};

/** The hint next to every answer field (M6 §4.5). */
export const PERSONAL_DATA_HINT = 'Keine Namen oder anderen personenbezogenen Daten';

const PLURAL: Readonly<Record<PersonalDataKind, string>> = {
  email: 'E-Mail-Adressen',
  phone: 'Telefonnummern',
  iban: 'IBANs',
};

const EMAIL =
  /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}_%+-](?:[\p{L}\p{N}._%+-]*[\p{L}\p{N}_%+-])?@[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)*\.\p{L}{2,}(?![\p{L}\p{N}_-])/gu;

/** A run of digits with single separators, not inside a word or number; validated by {@link isPhone}. */
const PHONE_CANDIDATE =
  /(?<![\p{L}\p{N}_@.,+\-/])(?:\+ ?)?\(?\d(?:\d|[(/-](?=[\d( ])|\) ?(?=[\d(])| [/–-] (?=\d)| (?=[\d(]))*\d(?![\p{L}\p{N}_])/gu;

const LEADING_DATE = /^\(?\d{1,2}[-/]\d{1,2}[-/]\d{2,4}(?!\d)/;

/** The last word before a number (`Sachkonto`, `Prozess-ID`), punctuation and spaces after it ignored. */
const LAST_WORD = /(\p{L}[\p{L}\p{N}-]*)[\s.:#]*$/u;
/** Labels of ids and accounting or document numbers: digits right after them are no phone number. */
const ID_LABEL =
  /^(?:(?:sach)?konto|kostenstelle|rechnung|beleg|buchung|auftrag|bestell|liefer|material|artikel|vertrag|dokument|vorgang|ticket|kennung)|(?:^|-)id$/;

function idLabelBefore(text: string, start: number): boolean {
  const word = LAST_WORD.exec(text.slice(Math.max(0, start - 40), start))?.[1];
  return word !== undefined && ID_LABEL.test(word.toLocaleLowerCase('de'));
}

function isPhone(candidate: string): boolean {
  if (LEADING_DATE.test(candidate)) return false;
  const digits = candidate.replace(/\D/g, '');
  if (candidate.startsWith('+')) return digits.length >= 8 && digits.length <= 15;
  // A bare run of digits is a phone number from 11 digits on only: SAP and
  // other document numbers have 10, padded with zeros („0090001234“).
  if (/^\d+$/.test(candidate) && digits.length < 11) return false;
  if (/^\(?00/.test(candidate)) {
    return digits[2] !== '0' && digits.length - 2 >= 8 && digits.length - 2 <= 15;
  }
  if (/^\(?0/.test(candidate)) {
    // After the national 0, `01` starts only the mobile numbers 015–017.
    if (digits[1] === '1' && !['5', '6', '7'].includes(digits[2] ?? '')) return false;
    return digits[1] !== '0' && digits.length >= 9 && digits.length <= 14;
  }
  return false;
}

const IBAN_START = /(?<![\p{L}\p{N}])[A-Za-z]{2}\d{2}/gu;
const ALNUM = /[A-Za-z0-9]/;

/** ISO 13616: the IBAN with its first four characters moved to the end, letters as 10–35, mod 97 = 1. */
function ibanChecksumHolds(iban: string): boolean {
  const moved = `${iban.slice(4)}${iban.slice(0, 4)}`.toUpperCase();
  let rest = 0;
  for (const ch of moved) {
    const value = ch >= 'A' && ch <= 'Z' ? ch.charCodeAt(0) - 55 : Number(ch);
    rest = (value >= 10 ? rest * 100 + value : rest * 10 + value) % 97;
  }
  return rest === 1;
}

/** IBANs from `start`: the longest run of 15–34 letters and digits (single spaces between) ending a word, with a valid checksum. */
function ibanAt(text: string, start: number): number | null {
  let chars = '';
  const ends: { length: number; end: number }[] = [];
  let i = start;
  while (i < text.length && chars.length < 34) {
    const ch = text.charAt(i);
    if (ALNUM.test(ch)) {
      chars += ch;
      i++;
      const next = text.charAt(i);
      if (!ALNUM.test(next) && !/[\p{L}\p{N}_]/u.test(next))
        ends.push({ length: chars.length, end: i });
      continue;
    }
    if (ch === ' ' && ALNUM.test(text.charAt(i + 1)) && chars.length > 0) {
      i++;
      continue;
    }
    break;
  }
  for (const { length, end } of ends.reverse()) {
    if (length < 15) break;
    if (ibanChecksumHolds(chars.slice(0, length))) return end;
  }
  return null;
}

/**
 * The personal data in `text`, ordered by position: IBANs first claim their
 * span (their digits are no phone number), then e-mail addresses, then phone
 * numbers outside both.
 */
export function personalDataWarnings(text: string): PersonalDataMatch[] {
  const out: PersonalDataMatch[] = [];
  const overlaps = (start: number, end: number) => out.some((w) => start < w.end && w.start < end);
  for (const m of text.matchAll(IBAN_START)) {
    if (overlaps(m.index, m.index + 1)) continue;
    const end = ibanAt(text, m.index);
    if (end !== null) out.push({ kind: 'iban', start: m.index, end });
  }
  for (const m of text.matchAll(EMAIL)) {
    const end = m.index + m[0].length;
    if (!overlaps(m.index, end)) out.push({ kind: 'email', start: m.index, end });
  }
  for (const m of text.matchAll(PHONE_CANDIDATE)) {
    const end = m.index + m[0].length;
    if (isPhone(m[0]) && !idLabelBefore(text, m.index) && !overlaps(m.index, end)) {
      out.push({ kind: 'phone', start: m.index, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * What the check found, in German, `null` without anything: „eine
 * E-Mail-Adresse und 2 Telefonnummern“.
 */
export function personalDataList(warnings: readonly PersonalDataMatch[]): string | null {
  if (warnings.length === 0) return null;
  const parts = PERSONAL_DATA_KINDS.flatMap((kind) => {
    const n = warnings.filter((w) => w.kind === kind).length;
    if (n === 0) return [];
    return [n === 1 ? `eine ${PERSONAL_DATA_LABELS[kind]}` : `${n} ${PLURAL[kind]}`];
  });
  return parts.length === 1
    ? (parts[0] ?? null)
    : `${parts.slice(0, -1).join(', ')} und ${parts.at(-1) ?? ''}`;
}

/**
 * The German warning for the found personal data, `null` without any:
 * „Der Text enthält vermutlich eine E-Mail-Adresse und 2 Telefonnummern. …“
 */
export function personalDataHint(warnings: readonly PersonalDataMatch[]): string | null {
  const list = personalDataList(warnings);
  if (list === null) return null;
  return (
    `Der Text enthält vermutlich ${list}. Prüf bitte, ob das wirklich gespeichert werden soll: ` +
    'keine Namen oder anderen personenbezogenen Daten.'
  );
}
