/**
 * The customer's process catalog as CSV (M6 §3.2 `analyzr-inventory/1`):
 * read deterministically, so a catalog of hundreds of rows is never copied by
 * hand. Excel writes „CSV UTF-8“ with a byte order mark and, in German
 * settings, `;` between fields; plain „CSV“ is Windows-1252. Only the columns
 * the consultant names are taken (id, name, area, tool id), so columns that
 * name people never reach the inventory.
 */
import { BundleError, INVENTORY_FORMAT, parseInventory, type Inventory } from './bundle.ts';

export interface CsvTable {
  /** `utf-8` or `windows-1252`. */
  encoding: string;
  delimiter: string;
  header: string[];
  rows: string[][];
}

/** Decodes CSV bytes: UTF-8 (a byte order mark dropped), else Windows-1252. */
function decodeCsv(bytes: Uint8Array): { text: string; encoding: string } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

/** The delimiter the header line uses most outside quotes: `;`, `,` or a tab. */
function detectDelimiter(text: string): string {
  const counts = new Map([
    [';', 0],
    [',', 0],
    ['\t', 0],
  ]);
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && counts.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = ';';
  for (const [d, n] of counts) if (n > (counts.get(best) ?? 0)) best = d;
  return best;
}

/** Reads CSV (RFC 4180: quoted fields with `""`, line breaks inside quotes, CRLF or LF). */
export function parseCsv(bytes: Uint8Array): CsvTable {
  const { text, encoding } = decodeCsv(bytes);
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (quoted) {
      if (c === '"' && text.charAt(i + 1) === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') quoted = false;
      else field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (c === '\r' && text.charAt(i + 1) === '\n') i++;
    } else {
      field += c;
    }
    i++;
  }
  if (quoted) throw new BundleError('invalid-inventory', 'the CSV ends inside a quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((f) => f.trim() !== ''));
  const [header = [], ...data] = nonEmpty;
  return { encoding, delimiter, header: header.map((h) => h.trim()), rows: data };
}

export interface InventoryColumns {
  /** Column of the catalog's own process id; without it the rows are numbered (`row-1`, …). */
  id?: string;
  name: string;
  area?: string;
  externalId?: string;
}

export interface CsvInventory {
  inventory: Inventory;
  encoding: string;
  delimiter: string;
  /** Data rows without a name (left out, e.g. section headings). */
  rowsWithoutName: number;
  /** Header names of the columns left out. */
  dropped: string[];
}

/**
 * Builds `analyzr-inventory/1` from a catalog table: only the named columns,
 * values trimmed, rows without a name left out.
 *
 * @throws {BundleError} `invalid-inventory` for a missing column or duplicate ids
 */
export function inventoryFromCsv(table: CsvTable, columns: InventoryColumns): CsvInventory {
  const index = (name: string | undefined, option: string): number | null => {
    if (name === undefined) return null;
    const at = table.header.indexOf(name.trim());
    if (at < 0) {
      throw new BundleError(
        'invalid-inventory',
        `${option} ${JSON.stringify(name)} is no column of the catalog; its columns: ${table.header.map((h) => JSON.stringify(h)).join(', ')}`,
      );
    }
    return at;
  };
  const id = index(columns.id, '--id');
  const name = index(columns.name, '--name');
  const area = index(columns.area, '--area');
  const externalId = index(columns.externalId, '--external-id');
  const used = new Set([id, name, area, externalId].filter((x): x is number => x !== null));
  const items: unknown[] = [];
  let rowsWithoutName = 0;
  table.rows.forEach((row, n) => {
    const cell = (at: number | null): string => (at === null ? '' : (row[at] ?? '').trim());
    if (cell(name) === '') {
      rowsWithoutName++;
      return;
    }
    items.push({
      id: id === null ? `row-${n + 1}` : cell(id),
      name: cell(name),
      ...(cell(area) === '' ? {} : { area: cell(area) }),
      ...(cell(externalId) === '' ? {} : { externalId: cell(externalId) }),
    });
  });
  const empty = items.find((item) => (item as { id: string }).id === '');
  if (empty !== undefined) {
    throw new BundleError(
      'invalid-inventory',
      `a row with the name ${JSON.stringify((empty as { name: string }).name)} has no id`,
    );
  }
  return {
    inventory: parseInventory({ format: INVENTORY_FORMAT, items }),
    encoding: table.encoding,
    delimiter: table.delimiter,
    rowsWithoutName,
    dropped: table.header.filter((_, i) => !used.has(i)),
  };
}
