import type {
  ImportWarning,
  Model,
  OpenQuestion,
  ModelSourceSummary,
  Revision,
  RevisionSource,
} from '@analyzr/client';

import { formatDate } from './labels';

/**
 * A model's provenance in the web (M6 S2a's web parts, UX8;
 * UX-SIMPLIFICATION.md §6): the source system by name, a chip only for a
 * file that is not a plain export (it changes how far to trust the
 * diagram), the muted subtitle when every model comes from one system, the
 * model view's „Herkunft“, and the import's identity warnings in German.
 * Zod-free: the entry carries it.
 */

/** Source systems by their manifest slug; another slug shows as declared. */
const SYSTEMS: Readonly<Record<string, string>> = {
  signavio: 'Signavio',
  aris: 'ARIS',
  bizagi: 'Bizagi',
  visio: 'Visio',
  adonis: 'ADONIS',
  camunda: 'Camunda',
  interview: 'Interview',
};

/** `signavio` → „Signavio“. */
export function systemLabel(system: string): string {
  return Object.hasOwn(SYSTEMS, system) ? (SYSTEMS[system] ?? system) : system;
}

/** The chip of a file that is no plain export (`derived.kind`); none for `export`. */
const DERIVED_CHIPS: Readonly<Record<string, { label: string; hint: string }>> = {
  converted: {
    label: 'Konvertiert',
    hint: 'Ein Konverter hat die Datei aus dem Export erzeugt; Details unter „Herkunft“.',
  },
  reconstructed: {
    label: 'KI-rekonstruiert',
    hint: 'Ein Sprachmodell hat das Diagramm aus einer Vorlage nachgebaut; prüf es vor dem Entscheiden.',
  },
  'as-told': {
    label: 'Aus Interview',
    hint: 'Das Diagramm ist nach Gesprächen gezeichnet, nicht aus einem Werkzeug exportiert.',
  },
};

/** The derived chip of a model, `null` for a plain export or without provenance. */
export function derivedChip(
  source: Pick<ModelSourceSummary, 'derived' | 'system'> | null,
): { label: string; hint: string } | null {
  const kind = source?.derived;
  if (!kind || !Object.hasOwn(DERIVED_CHIPS, kind)) return null;
  const chip = DERIVED_CHIPS[kind];
  return chip
    ? { label: chip.label, hint: `${chip.hint} Quelle: ${systemLabel(source.system)}.` }
    : null;
}

/** „Aus Signavio · exportiert am 14.10.2026“. */
export function sourceLine(source: Pick<ModelSourceSummary, 'system' | 'exportedAt'>): string {
  const from = `Aus ${systemLabel(source.system)}`;
  return source.exportedAt ? `${from} · exportiert am ${formatDate(source.exportedAt)}` : from;
}

/**
 * The project's subtitle (UX-SIMPLIFICATION.md §3.1 item 3): when every
 * model declares the same system, „Aus Signavio · exportiert am …“ (the
 * date only when all agree); `null` otherwise, also without models.
 */
export function commonSourceLine(models: readonly Pick<Model, 'source'>[]): string | null {
  const [first] = models;
  if (!first?.source) return null;
  const { system, exportedAt } = first.source;
  if (!models.every((m) => m.source?.system === system)) return null;
  const sameDate = models.every((m) => m.source?.exportedAt === exportedAt);
  return sourceLine({ system, exportedAt: sameDate ? exportedAt : null });
}

/** The loss codes a converter declares (M6 §3.2), in German; another code shows as declared. */
const LOSSES: Readonly<Record<string, string>> = {
  'element-dropped': 'Elemente weggelassen',
  'attribute-dropped': 'Attribute weggelassen',
  'link-unresolved': 'Verweise ohne Ziel',
  'layout-generated': 'Layout erzeugt',
  'layout-missing': 'Layout fehlt',
  'id-rewritten': 'IDs umgeschrieben',
  'text-truncated': 'Texte gekürzt',
};

/** „Elemente weggelassen: 3“. */
export function lossText(loss: { code: string; count: number }): string {
  const label = Object.hasOwn(LOSSES, loss.code) ? (LOSSES[loss.code] ?? loss.code) : loss.code;
  return `${label}: ${loss.count.toLocaleString('de-DE')}`;
}

/** A link into the source tool, only http(s) (declared, never followed by analyzr). */
export function toolUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** One line of the model view's „Herkunft“. */
export interface ProvenanceLine {
  label: string;
  text: string;
}

/**
 * What the model view's „Herkunft“ says (UX-SIMPLIFICATION.md §6): the
 * source with its version and export date („(angegeben)“: declared, not
 * checked), where it lives in the tool, how the file was derived, who
 * uploaded it, and for an amended head that analyzr amended it. `declared`
 * is the revision that carries the provenance: the head, or for an amended
 * head its upstream.
 */
export function provenanceLines(
  head: Pick<Revision, 'rev' | 'source'>,
  declared: Pick<Revision, 'rev' | 'source'> | null,
): ProvenanceLine[] {
  const s: RevisionSource | null = declared?.source ?? null;
  const lines: ProvenanceLine[] = [];
  if (head.source.kind === 'amendment' && head.source.upstream)
    lines.push({ label: 'Stand', text: `In analyzr ergänzt (aus r${head.source.upstream.rev})` });
  if (s?.system) {
    const version = s.systemVersion ? ` ${s.systemVersion}` : '';
    const date = s.exportedAt ? ` · exportiert am ${formatDate(s.exportedAt)}` : '';
    lines.push({
      label: 'Quelle',
      text: `Aus ${systemLabel(s.system)}${version}${date} (angegeben)`,
    });
  }
  if (s?.externalPath) lines.push({ label: 'Im Quellsystem', text: s.externalPath });
  const chip = s?.derived ? DERIVED_CHIPS[s.derived.kind] : undefined;
  if (s?.derived && chip)
    lines.push({
      label: 'Entstanden',
      text: [
        chip.label,
        s.derived.converter ? `mit ${s.derived.converter}` : null,
        s.derived.llmModel ? `Modell ${s.derived.llmModel}` : null,
      ]
        .filter((p) => p !== null)
        .join(' · '),
    });
  const uploader = (declared ?? head).source.uploader;
  if (uploader)
    lines.push({
      label: 'Hochgeladen',
      text: uploader === 'agent' ? 'über ein Agenten-Token' : 'über den Owner-Zugang',
    });
  if (!s?.system)
    lines.push({
      label: 'Quelle',
      text:
        (declared ?? head).source.kind === 'seed'
          ? 'Beispieldaten von analyzr, ohne Angabe eines Quellsystems'
          : 'Ohne Angabe eines Quellsystems hochgeladen',
    });
  return lines;
}

/** The identity warnings of an import (M6 §3.4) in German, for the file's disclosure. */
export function importWarningText(w: ImportWarning): string {
  const id = w.externalId ? `„${w.externalId}“` : 'die Werkzeug-ID';
  switch (w.code) {
    case 'external-id-moved': {
      const [other] = w.otherKeys ?? [];
      return `Im Quellsystem umbenannt oder verschoben? ${id} gehörte bisher zu „${other ?? '?'}“; das Modell gibt es jetzt doppelt. Lösch den überzähligen Kurznamen und importier das Bundle mit festgelegtem Kurznamen erneut.`;
    }
    case 'external-id-changed': {
      const before = w.previous
        ? `„${w.previous.externalId}“ (${systemLabel(w.previous.system)})`
        : 'eine andere Werkzeug-ID';
      return `Ein anderes Modell? Dieser Kurzname trug bisher ${before}, jetzt ${id}. Gehören sie nicht zusammen, gib der Datei im Bundle einen eigenen Kurznamen.`;
    }
    case 'manifest-sha-mismatch':
      return 'Die Datei passt nicht zur Prüfsumme im Bundle; vermutlich wurde sie nach dem Umwandeln geändert. Importiert ist sie trotzdem.';
    case 'provenance-kept':
      return 'Unverändert: analyzr behält die Herkunft, die es für das Modell schon hat. Eine Korrektur braucht geänderte Dateien.';
  }
}

/**
 * The model view's header line about elements lost on import (UX8; §3.5
 * item 8): from the open question „Elemente beim Import verloren“
 * (`extractor-loss`) about this model, „Beim Import übersprungen: 2
 * Elemente“; the count from the question's reason, which the server words
 * „analyzr hat [mindestens ]N Elemente übersprungen: …“
 * (`apps/server/src/domain/open-questions/signals.ts`), else without one.
 */
export function importLossOf(
  questions: readonly Pick<OpenQuestion, 'id' | 'kind' | 'state' | 'subject' | 'detail'>[],
  modelKey: string,
): { text: string; questionId: string } | null {
  const q = questions.find(
    (x) =>
      x.kind === 'extractor-loss' &&
      x.state === 'open' &&
      x.subject.type === 'model' &&
      x.subject.id === modelKey,
  );
  if (!q) return null;
  const m = /analyzr hat (mindestens )?(?:ein Element|(\d+) Elemente) übersprungen/.exec(
    q.detail ?? '',
  );
  if (!m) return { text: 'Beim Import sind Elemente verloren gegangen', questionId: q.id };
  const count = m[2] === undefined ? '1 Element' : `${m[2]} Elemente`;
  return {
    text: `Beim Import übersprungen: ${m[1] ? 'mindestens ' : ''}${count}`,
    questionId: q.id,
  };
}
