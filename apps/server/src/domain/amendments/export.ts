/**
 * The change list of model amendments (M6 §4.8 c "Exports"): what a
 * consultant carries into the source tool by hand (analyzr writes nothing
 * back, decision 7), as Markdown or CSV, grouped per model, German headings.
 * Every export names the seq it reflects („Stand: Ereignis …“), so `since`
 * lists only what is new since the last carry-over. Pure: the use case
 * describes each amendment's element ({@link ChangeListEntry}).
 */
import {
  AMENDMENT_CONFLICT_LABELS,
  AMENDMENT_MODEL_DELETED_LABEL,
  AMENDMENT_STATE_LABELS,
  CSV_BOM,
  CSV_SEPARATOR,
  protectCell,
  type AmendmentExportFormat,
  type AmendmentFilter,
  type ModelAmendment,
  type RevisionSource,
} from '@analyzr/contracts';
import { quoteDe } from '@analyzr/relations';

import { escapeMarkdown } from '../open-questions/export.ts';

/** A call target as the change list names it. */
export interface ChangeListTarget {
  processId: string;
  /** The head process with that id (the first, if several), else `null`: „Ziel nicht mehr in der Landschaft“. */
  process: { name: string; modelKey: string; modelName: string | null } | null;
}

/**
 * Where a model lives in its source tool, as its uploaded revision declares
 * it (M6 S2a, §3.3: the manifest's system, tool folder and link).
 */
export interface ChangeListOrigin {
  system: string | null;
  externalPath: string | null;
  /** An http(s) link into the source tool. */
  url: string | null;
}

/** The origin of a model from its uploaded revision's `source`; `null` without a declared system or folder. */
export function originOf(source: RevisionSource | undefined): ChangeListOrigin | null {
  if (!source || (source.system === undefined && source.externalPath === undefined)) return null;
  const url = source.url !== undefined && /^https?:\/\//i.test(source.url) ? source.url : null;
  return { system: source.system ?? null, externalPath: source.externalPath ?? null, url };
}

/** A link destination safe in Markdown: spaces, angle brackets and parentheses percent-encoded. */
function markdownUrl(url: string): string {
  return url.replace(
    /[\s<>()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}

/** One amendment with what the change list says about its element. */
export interface ChangeListEntry {
  amendment: ModelAmendment;
  modelName: string | null;
  /** Where the model lives in its source tool (M6 S2a), when its uploaded revision declares it. */
  origin?: ChangeListOrigin;
  /** „Prozess „Auftragsabwicklung““ or „Pool „Kunde““; `null` for a message or signal. */
  place: string | null;
  /** The lanes the element lies in. */
  lanes: readonly string[];
  /**
   * German type, name and id as the source tool knows the element (its
   * uploaded revision): „Endereignis ohne Namen (ID End_Auftrag)“,
   * „Aufrufaktivität „Rechnung stellen“ (ID Call_Rechnung)“; a message or
   * signal name adds the message or signal and its id.
   */
  element: string;
  /** German field name. */
  field: string;
  /** `call-target`: the process it names (`before` and `after`). */
  targets?: { before: ChangeListTarget | null; after: ChangeListTarget };
  /** `message-name` of a shared message: every element referencing it, German. */
  readers: readonly string[];
}

/** What the export says about itself. */
export interface ChangeListHeader {
  projectName: string;
  projectKey: string;
  /** The project's last event seq when it was read. */
  seq: number;
  filter: AmendmentFilter;
  since: number | undefined;
}

/** A value as the change list shows it: quoted, „(leer)“ for none. */
function shownValue(value: string | null): string {
  return value === null || value === '' ? '(leer)' : quoteDe(value);
}

/**
 * Whether an amendment is still to carry over into the source tool: applied
 * by analyzr, or in conflict (the tool's value and analyzr's differ); not
 * when the tool took it over or it was withdrawn or superseded.
 */
export function toCarryOver(a: Pick<ModelAmendment, 'state'>): boolean {
  return a.state === 'applied' || a.state === 'conflict';
}

/** A call target: „Prozess „…“ im Modell „…“ (Pfad …, ID …)“, marked when it is gone. */
function targetText(t: ChangeListTarget | null, raw: string | null): string {
  if (t === null) return shownValue(raw);
  if (t.process === null) return `${shownValue(t.processId)} (Ziel nicht mehr in der Landschaft)`;
  const model = t.process.modelName ?? t.process.modelKey;
  return (
    `Prozess ${quoteDe(t.process.name)} im Modell ${quoteDe(model)} ` +
    `(Pfad ${t.process.modelKey}, ID ${t.processId})`
  );
}

function beforeText(e: ChangeListEntry): string {
  return e.targets
    ? targetText(e.targets.before, e.amendment.before)
    : shownValue(e.amendment.before);
}

function afterText(e: ChangeListEntry): string {
  return e.targets ? targetText(e.targets.after, e.amendment.after) : shownValue(e.amendment.after);
}

/** The state as one phrase: „angewendet“, „Konflikt (Wert im Quellsystem geändert)“, „zurückgenommen von …“. */
function stateText(a: ModelAmendment): string {
  let text = AMENDMENT_STATE_LABELS[a.state];
  if (a.conflict !== null) text += ` (${AMENDMENT_CONFLICT_LABELS[a.conflict]})`;
  if (a.withdrawal !== null) text += ` von ${a.withdrawal.by} (Ereignis ${a.withdrawal.seq})`;
  if (a.modelDeleted) text += `, ${AMENDMENT_MODEL_DELETED_LABEL}`;
  return text;
}

/** The place as one phrase: „Prozess „…“, Lane „…““. */
function placeText(e: ChangeListEntry): string {
  return [
    e.place,
    e.lanes.length === 0
      ? null
      : `${e.lanes.length === 1 ? 'Lane' : 'Lanes'} ${e.lanes.map(quoteDe).join(', ')}`,
  ]
    .filter((p) => p !== null)
    .join(', ');
}

const day = (iso: string): string => iso.slice(0, 10);

function filterText(header: ChangeListHeader): string | null {
  const parts = [
    header.filter.modelKey === undefined
      ? null
      : `Modell oder Ordner \`${header.filter.modelKey}\``,
    header.filter.state === undefined
      ? null
      : `Stand „${AMENDMENT_STATE_LABELS[header.filter.state]}“`,
    header.since === undefined ? null : `neu seit Ereignis ${header.since}`,
  ].filter((p) => p !== null);
  return parts.length === 0 ? null : parts.join(', ');
}

/** The entries grouped per model (in key order), each group oldest first. */
function groups(entries: readonly ChangeListEntry[]): [string, ChangeListEntry[]][] {
  const out = new Map<string, ChangeListEntry[]>();
  for (const e of entries) {
    out.set(e.amendment.modelKey, [...(out.get(e.amendment.modelKey) ?? []), e]);
  }
  return [...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The Markdown change list: a title, then per model its amendments, numbered. */
export function renderChangeListMarkdown(
  entries: readonly ChangeListEntry[],
  header: ChangeListHeader,
): string {
  const lines: string[] = [
    `# Änderungsliste: ${escapeMarkdown(header.projectName)}`,
    '',
    `Projekt \`${header.projectKey}\`, Stand: Ereignis ${header.seq}. ` +
      `${entries.length === 1 ? 'Eine Ergänzung' : `${entries.length} Ergänzungen`} aus analyzr, ` +
      'je Modell gruppiert: zuerst, was ins Quellsystem zu übertragen ist, dann, was erledigt ' +
      'ist. analyzr schreibt nichts in das Quellsystem zurück: Übernimm die Änderungen dort von ' +
      'Hand und lade das Modell danach erneut hoch; übernommene Werte zeigt analyzr als „im ' +
      'Quellsystem übernommen“.',
  ];
  const filter = filterText(header);
  if (filter !== null) lines.push('', `Filter: ${filter}.`);
  if (entries.length === 0) lines.push('', 'Keine Ergänzungen.');
  let n = 0;
  for (const [modelKey, list] of groups(entries)) {
    const first = list[0];
    const name = first?.modelName
      ? `${escapeMarkdown(first.modelName)} (\`${modelKey}\`)`
      : `\`${modelKey}\``;
    const deleted = first?.amendment.modelDeleted ? ` – ${AMENDMENT_MODEL_DELETED_LABEL}` : '';
    lines.push('', `## ${name}${deleted}`);
    const origin = first?.origin;
    if (origin) {
      const where = [
        origin.externalPath === null ? null : escapeMarkdown(origin.externalPath),
        origin.url === null ? null : `[Im Quellsystem öffnen](${markdownUrl(origin.url)})`,
      ].filter((p) => p !== null);
      const system = origin.system === null ? '' : ` (${escapeMarkdown(origin.system)})`;
      if (where.length > 0) lines.push('', `Im Quellsystem${system}: ${where.join(' · ')}`);
    }
    const open = list.filter((e) => toCarryOver(e.amendment));
    const done = list.filter((e) => !toCarryOver(e.amendment));
    for (const [section, note, items] of [
      [`Zu übertragen (${open.length})`, null, open],
      [
        `Erledigt (${done.length})`,
        'Im Quellsystem übernommen, zurückgenommen oder ersetzt; dort ist nichts mehr zu tun.',
        done,
      ],
    ] as const) {
      if (items.length === 0) continue;
      lines.push('', `### ${section}`);
      if (note !== null) lines.push('', note);
      for (const e of items) {
        n++;
        const a = e.amendment;
        lines.push('', `#### ${n}. ${escapeMarkdown(e.element)}`, '');
        const place = placeText(e);
        if (place !== '') lines.push(`- Ort: ${escapeMarkdown(place)}`);
        lines.push(
          `- Feld: ${e.field}`,
          `- Vorher: ${escapeMarkdown(beforeText(e))}`,
          `- Nachher: ${escapeMarkdown(afterText(e))}`,
        );
        if (e.readers.length > 0) {
          lines.push(`- Gilt für: ${escapeMarkdown(e.readers.join('; '))}`);
        }
        lines.push(
          `- Von: ${escapeMarkdown(a.by)}, am ${day(a.at)} (Ereignis ${a.seq})`,
          `- Stand: ${escapeMarkdown(stateText(a))}`,
          `- Kennung: \`${a.id}\``,
        );
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The CSV's columns, in order. */
export const CHANGE_LIST_CSV_COLUMNS = [
  'Modell',
  'Modellschlüssel',
  'Ort',
  'Element',
  'Feld',
  'Vorher',
  'Nachher',
  'Ziel',
  'Gilt für',
  'Von',
  'Am',
  'Ereignis',
  'Stand',
  'Zu übertragen',
  'Kennung',
] as const;

const quoteCell = (value: string): string => `"${protectCell(value).replaceAll('"', '""')}"`;

/**
 * The CSV change list: {@link CHANGE_LIST_CSV_COLUMNS}, one row per
 * amendment grouped per model, UTF-8 with a byte order mark, `;`, CRLF,
 * every field quoted, formula-like cells escaped (as the open-questions
 * export). „Vorher“ and „Nachher“ hold the raw values (an empty cell for
 * none), so a cell copies into the source tool as it is; „Ziel“ describes a
 * call target's process; „Zu übertragen“ says „ja“ for an applied or
 * conflicting amendment.
 */
export function renderChangeListCsv(entries: readonly ChangeListEntry[]): string {
  const rows: string[][] = [
    [...CHANGE_LIST_CSV_COLUMNS],
    ...groups(entries).flatMap(([modelKey, list]) =>
      list.map((e) => [
        e.modelName ?? modelKey,
        modelKey,
        placeText(e),
        e.element,
        e.field,
        e.amendment.before ?? '',
        e.amendment.after,
        e.targets ? targetText(e.targets.after, e.amendment.after) : '',
        e.readers.join('; '),
        e.amendment.by,
        day(e.amendment.at),
        String(e.amendment.seq),
        stateText(e.amendment),
        toCarryOver(e.amendment) ? 'ja' : 'nein',
        e.amendment.id,
      ]),
    ),
  ];
  return `${CSV_BOM}${rows.map((r) => r.map(quoteCell).join(CSV_SEPARATOR)).join('\r\n')}\r\n`;
}

/** Text as an ASCII slug: umlauts spelled out, other marks dropped, the rest `-`. */
function slug(text: string): string {
  return text
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The file name: `ergaenzungen-<project key>` plus the filters as an ASCII slug. */
export function changeListFilename(
  projectKey: string,
  filter: AmendmentFilter,
  since: number | undefined,
  format: AmendmentExportFormat,
): string {
  const parts = [filter.modelKey, filter.state, since === undefined ? undefined : `seit-${since}`]
    .filter((p) => p !== undefined)
    .map(slug)
    .filter((p) => p !== '');
  const filters = parts.join('-').slice(0, 80).replace(/-+$/, '');
  const base = `ergaenzungen-${slug(projectKey) || 'projekt'}${filters === '' ? '' : `-${filters}`}`;
  return `${base}.${format === 'csv' ? 'csv' : 'md'}`;
}
