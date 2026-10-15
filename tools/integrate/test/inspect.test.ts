// inspect (src/inspect.ts, M6 §3.7 step 1): deterministic, read-only, tool markers.
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { inspectExport, inspectFile } from '../src/inspect.ts';
import { markersOf } from '../src/markers.ts';
import { listZip } from '../src/zip.ts';

import { BPMN_NS, bpmn, copyExport, SIGNAVIO_EXPORT, tempDir, utf8 } from './support.ts';

/** A zip archive with stored (uncompressed) entries; CRCs are left 0, which listing ignores. */
function zip(entries: readonly { name: string; data: string }[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

describe('inspectExport on the Signavio-style fixture', () => {
  it('lists every file with kind, encoding, BPMN summary and markers', async () => {
    const report = await inspectExport(SIGNAVIO_EXPORT);
    expect(report.format).toBe('analyzr-inspect/1');
    expect(report.totals).toEqual({
      files: 7,
      bytes: report.files.reduce((n, f) => n + f.size, 0),
      byKind: { bpmn: 6, pdf: 1 },
      hidden: 0,
      symlinks: 0,
    });
    expect(report.tools).toEqual([
      { tool: 'signavio', files: 6, markers: { exporter: 6, namespace: 6, 'sid-ids': 6 } },
    ]);
    expect(report.files.map((f) => f.path)).toEqual([
      'Archiv/Auftragsabwicklung (alt).bpmn',
      'Gemeinsame Dokumente/Finanzen/Bonitätsprüfung.bpmn',
      'Gemeinsame Dokumente/Finanzen/Rechnungsstellung.bpmn',
      'Gemeinsame Dokumente/Logistik/Versand.bpmn',
      'Gemeinsame Dokumente/Vertrieb/Angebotserstellung.bpmn',
      'Gemeinsame Dokumente/Vertrieb/Auftragsabwicklung.bpmn',
      'Prozesslandkarte.pdf',
    ]);
    const file = (name: string) => report.files.find((f) => f.path.endsWith(name));
    expect(file('Rechnungsstellung.bpmn')?.encoding).toEqual({
      encoding: 'utf-16le',
      bom: true,
      declared: 'UTF-16',
      valid: true,
    });
    expect(file('Rechnungsstellung.bpmn')?.notes).toEqual([
      'UTF-16LE: normalize-bpmn transcodes it to UTF-8',
    ]);
    expect(file('Bonitätsprüfung.bpmn')?.bpmn?.ids).toEqual({ total: 28, unsafe: 4, duplicate: 0 });
    expect(file('Versand.bpmn')?.bpmn?.ids).toMatchObject({ duplicate: 2 });
    const order = file('Vertrieb/Auftragsabwicklung.bpmn')?.bpmn;
    expect(order).toMatchObject({
      definitionsId: 'sid-F5E4A6B7-C8D9-4E0F-9A1B-3C4D5E6F7A05',
      exporter: 'Signavio Process Editor, http://www.signavio.com',
      exporterVersion: '19.6.0',
      processes: [
        {
          id: 'sid-C8B7D9E0-F1A2-4B3C-8D4E-6F7A8B9C0D08',
          name: 'Auftragsabwicklung',
          isExecutable: false,
        },
      ],
      participants: 2,
      blackBoxParticipants: [{ id: 'sid-D9C8E0F1-A2B3-4C4D-9E5F-7A8B9C0D1E09', name: 'Kunde' }],
      callActivities: [
        {
          id: 'sid-718091A3-B4C5-46D7-98F9-1A2B3C4D5E19',
          name: 'Rechnung stellen',
          calledElement: 'sid-4A5B6C7D-8E9F-4A0B-9C1D-2E3F4A5B6C30',
        },
      ],
      collapsedSubprocesses: [
        { id: 'sid-5F6E7081-92A3-44B5-96D7-F8091A2B3C17', name: 'Bonität prüfen' },
      ],
      messageFlows: 2,
      diagrams: 1,
      extensionNamespaces: ['http://www.signavio.com'],
    });
    expect(file('.pdf')).toMatchObject({ kind: 'pdf', markers: [] });
  });

  it('is deterministic and holds no absolute path', async () => {
    const [a, b] = await Promise.all([
      inspectExport(SIGNAVIO_EXPORT),
      inspectExport(SIGNAVIO_EXPORT),
    ]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toContain(SIGNAVIO_EXPORT);
  });

  it('leaves hidden files out and counts them, and reads nothing it writes', async () => {
    const dir = await copyExport();
    await writeFile(path.join(dir, '.DS_Store'), 'x');
    await mkdir(path.join(dir, '__MACOSX'));
    await writeFile(path.join(dir, '__MACOSX', '._Versand.bpmn'), 'x');
    const before = await readdir(dir, { recursive: true });
    const report = await inspectExport(dir);
    expect(report.totals.hidden).toBe(2);
    expect(report.totals.files).toBe(7);
    expect(await readdir(dir, { recursive: true })).toEqual(before);
  });

  it('inspects a single file', async () => {
    const report = await inspectExport(path.join(SIGNAVIO_EXPORT, 'Prozesslandkarte.pdf'));
    expect(report.files.map((f) => f.path)).toEqual(['Prozesslandkarte.pdf']);
  });

  it('fails for a missing path', async () => {
    await expect(inspectExport(path.join(await tempDir(), 'missing'))).rejects.toThrow(
      /does not exist/,
    );
  });
});

describe('inspectFile', () => {
  it('lists zip entries and recognizes VSDX', () => {
    const vsdx = zip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'visio/document.xml', data: '<VisioDocument/>' },
      { name: 'visio/pages/page1.xml', data: '<PageContents/>' },
    ]);
    const file = inspectFile('Landkarte.vsdx', vsdx);
    expect(file.kind).toBe('zip');
    expect(file.zip).toMatchObject({ count: 3, truncated: false, format: 'vsdx' });
    expect(file.zip?.entries.map((e) => e.name)).toEqual([
      '[Content_Types].xml',
      'visio/document.xml',
      'visio/pages/page1.xml',
    ]);
    expect(file.markers).toEqual([
      { tool: 'visio', marker: 'extension' },
      { tool: 'visio', marker: 'zip-entry' },
    ]);
  });

  it('notes BPMN files inside a zip', () => {
    const file = inspectFile('export.zip', zip([{ name: 'Vertrieb/A.bpmn', data: '<x/>' }]));
    expect(file.notes).toEqual(['zip with 1 BPMN files: unpack it, then inspect again']);
    expect(listZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04])).error).toMatch(
      /end of central directory/,
    );
  });

  it('reads an AML root behind a DOCTYPE (refused by analyzr) as ARIS', () => {
    const file = inspectFile(
      'Datenbank.xml',
      utf8(
        '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE AML SYSTEM "ARIS-Export.dtd"><AML><Header-Info/></AML>',
      ),
    );
    expect(file).toMatchObject({ kind: 'xml', xml: { root: 'AML', doctype: true } });
    expect(file.markers).toEqual([
      { tool: 'aris', marker: 'doctype' },
      { tool: 'aris', marker: 'root-element' },
    ]);
  });

  it('marks Camunda models and reports unsafe ids and a too large file', () => {
    const file = inspectFile(
      'Order.bpmn',
      utf8(
        bpmn('<task id="Task 1" />', { ns: ' xmlns:camunda="http://camunda.org/schema/1.0/bpmn"' }),
      ),
    );
    expect(file.markers).toEqual([{ tool: 'camunda', marker: 'namespace' }]);
    expect(file.notes).toEqual(['1 unsafe and 0 duplicate ids: normalize-bpmn rewrites them']);
    const big = utf8(bpmn(`<documentation>${'x'.repeat(5 * 1024 * 1024)}</documentation>`));
    expect(inspectFile('big.bpmn', big).notes).toContain(
      'larger than 5 MB: analyzr refuses it as is; normalize-bpmn takes it if it fits into 5 MB without indentation',
    );
  });

  it('reports XML it cannot read and text that is no XML', () => {
    const broken = inspectFile(
      'broken.bpmn',
      utf8(`<definitions xmlns="${BPMN_NS}"><x></definitions>`),
    );
    expect(broken.kind).toBe('bpmn');
    expect(broken.xml?.error).toMatch(/does not match/);
    expect(inspectFile('liste.csv', utf8('id;name\n1;Auftrag\n')).kind).toBe('text');
    expect(inspectFile('empty.bpmn', new Uint8Array(0)).kind).toBe('empty');
  });
});

describe('markersOf', () => {
  it('needs a majority of sid- ids', () => {
    expect(markersOf({ path: 'a.bpmn', ids: ['sid-1', 'x', 'y'] })).toEqual([]);
    expect(markersOf({ path: 'a.bpmn', ids: ['sid-1', 'sid-2', 'y'] })).toEqual([
      { tool: 'signavio', marker: 'sid-ids' },
    ]);
  });
});
