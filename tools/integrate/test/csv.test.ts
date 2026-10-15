// The process catalog from CSV (src/csv.ts, M6 §3.2 analyzr-inventory/1): Excel's German CSV,
// only the named columns, people columns never reach the inventory.
import { describe, expect, it } from 'vitest';

import { BundleError } from '../src/bundle.ts';
import { inventoryFromCsv, parseCsv } from '../src/csv.ts';

const bom = (text: string): Uint8Array =>
  new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);

const CATALOG = [
  'Prozess-ID;Prozess;Bereich;Verantwortlich;Signavio-ID',
  'P-01;Auftragsabwicklung;Vertrieb;Erika Muster;sid-A',
  'P-02;"Bonitätsprüfung; inkl. Scoring";Finanzen;Max Muster;',
  ';;;;',
  'P-03;"Versand ""Express""\nund Standard";Logistik;;',
  'P-04;;Service;;',
  '',
].join('\r\n');

describe('parseCsv', () => {
  it('reads Excel’s CSV UTF-8 with ;, quotes, line breaks in quotes and empty rows', () => {
    const table = parseCsv(bom(CATALOG));
    expect(table).toMatchObject({ encoding: 'utf-8', delimiter: ';' });
    expect(table.header).toEqual([
      'Prozess-ID',
      'Prozess',
      'Bereich',
      'Verantwortlich',
      'Signavio-ID',
    ]);
    expect(table.rows.map((r) => r[1])).toEqual([
      'Auftragsabwicklung',
      'Bonitätsprüfung; inkl. Scoring',
      'Versand "Express"\nund Standard',
      '',
    ]);
  });

  it('falls back to Windows-1252 and detects , and tabs', () => {
    const latin = new Uint8Array(Buffer.from('id,name\n1,Prüfung\n', 'latin1'));
    expect(parseCsv(latin)).toMatchObject({
      encoding: 'windows-1252',
      delimiter: ',',
      rows: [['1', 'Prüfung']],
    });
    expect(parseCsv(new TextEncoder().encode('a\tb\n1\t2')).delimiter).toBe('\t');
  });

  it('refuses a quoted field that never ends', () => {
    expect(() => parseCsv(new TextEncoder().encode('a;b\n"x;y'))).toThrow(BundleError);
  });
});

describe('inventoryFromCsv', () => {
  it('takes only the named columns and leaves rows without a name out', () => {
    const result = inventoryFromCsv(parseCsv(bom(CATALOG)), {
      id: 'Prozess-ID',
      name: 'Prozess',
      area: 'Bereich',
      externalId: 'Signavio-ID',
    });
    expect(result.inventory).toEqual({
      format: 'analyzr-inventory/1',
      items: [
        { id: 'P-01', name: 'Auftragsabwicklung', area: 'Vertrieb', externalId: 'sid-A' },
        { id: 'P-02', name: 'Bonitätsprüfung; inkl. Scoring', area: 'Finanzen' },
        { id: 'P-03', name: 'Versand "Express"\nund Standard', area: 'Logistik' },
      ],
    });
    expect(result.dropped).toEqual(['Verantwortlich']);
    expect(result.rowsWithoutName).toBe(1);
    expect(JSON.stringify(result.inventory)).not.toContain('Muster');
  });

  it('numbers the rows without an id column and refuses a row without an id otherwise', () => {
    const numbered = inventoryFromCsv(parseCsv(bom(CATALOG)), { name: 'Prozess' });
    expect(numbered.inventory.items.map((i) => i.id)).toEqual(['row-1', 'row-2', 'row-3']);
    expect(() =>
      inventoryFromCsv(parseCsv(bom('ID;Name\n;Ohne ID\n')), { id: 'ID', name: 'Name' }),
    ).toThrow(/has no id/);
  });

  it('names the columns when one does not exist', () => {
    expect(() => inventoryFromCsv(parseCsv(bom(CATALOG)), { name: 'Name' })).toThrow(
      /"Name" is no column of the catalog; its columns: "Prozess-ID", "Prozess"/,
    );
  });
});
