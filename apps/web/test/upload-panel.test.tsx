import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BPMN_FILE_SUFFIXES } from '@analyzr/contracts/paths';

import { UploadPanel } from '../src/components/upload-panel';
import { findToast, json, renderWithQuery, stubApi } from './support/render';

const IMPORT_PATH = '/api/v1/projects/demo/imports';

function withRelativePath(name: string, path: string, size = 20): File {
  const file = new File(['<bpmn/>'.padEnd(size, ' ')], name, { type: 'application/xml' });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

// Requests go through Node's fetch (undici), which serializes only its own
// FormData, File and Blob; jsdom's versions would turn files into "{}".
const NodeFormData = (
  await new Response('x=1', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }).formData()
).constructor as typeof FormData;

beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('FormData', NodeFormData);
});

describe('UploadPanel', () => {
  it('imports a picked folder with paths below the folder and shows the outcome per file', async () => {
    const calls = stubApi({
      [`POST ${IMPORT_PATH}`]: (call) =>
        json({
          files: (call.body as string[]).map((path) =>
            path.endsWith('kaputt.bpmn')
              ? {
                  path,
                  modelKey: 'kaputt',
                  outcome: 'failed',
                  problem: {
                    type: 'urn:analyzr:problem:bpmn-invalid',
                    title: 'Invalid BPMN',
                    status: 422,
                    code: 'bpmn-invalid',
                    detail: 'DOCTYPE is not allowed',
                  },
                }
              : {
                  path,
                  modelKey: path.replace(/\.bpmn$/, ''),
                  outcome: path.startsWith('vertrieb') ? 'created' : 'unchanged',
                  problem: null,
                },
          ),
        }),
    });
    renderWithQuery(<UploadPanel project="demo" />);

    const input = screen.getByTestId('file-input');
    fireEvent.change(input, {
      target: {
        files: [
          withRelativePath('auftrag.bpmn', 'models/vertrieb/auftrag.bpmn'),
          withRelativePath('rechnung.bpmn', 'models/finanzen/rechnung.bpmn'),
          withRelativePath('kaputt.bpmn', 'models/kaputt.bpmn'),
          withRelativePath('README.md', 'models/README.md'),
        ],
      },
    });

    const table = await screen.findByRole('table', { name: 'Import je Datei' });
    await waitFor(() => expect(within(table).getAllByTestId('import-outcome')).toHaveLength(3));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual([
      'finanzen/rechnung.bpmn',
      'kaputt.bpmn',
      'vertrieb/auftrag.bpmn',
    ]);
    const outcomes = within(table).getAllByTestId('import-outcome');
    expect(outcomes.map((row) => row.dataset['outcome'])).toEqual([
      'unchanged',
      'failed',
      'created',
    ]);
    expect(within(outcomes[1]!).getByText('DOCTYPE is not allowed')).toBeTruthy();
    expect(within(outcomes[2]!).getByText('Neu')).toBeTruthy();
    expect(screen.getByText(/1 Dateien übersprungen/)).toBeTruthy();
    expect(await findToast('1 von 3 Dateien nicht importiert')).toBeTruthy();
  });

  it('keeps the server’s reason when a whole batch fails, behind „Technische Details“', async () => {
    stubApi({
      [`POST ${IMPORT_PATH}`]: () =>
        json(
          {
            type: 'urn:analyzr:problem:validation-failed',
            title: 'Validation failed',
            status: 422,
            code: 'validation-failed',
            detail: 'files[1].path: not a model key',
          },
          422,
        ),
    });
    renderWithQuery(<UploadPanel project="demo" />);
    fireEvent.change(screen.getByTestId('file-input'), {
      target: {
        files: [
          withRelativePath('a.bpmn', 'models/a.bpmn'),
          withRelativePath('b.bpmn', 'models/b.bpmn'),
        ],
      },
    });
    const table = await screen.findByRole('table', { name: 'Import je Datei' });
    await waitFor(() => expect(within(table).getAllByTestId('import-outcome')).toHaveLength(2));
    for (const row of within(table).getAllByTestId('import-outcome')) {
      expect(row.dataset['outcome']).toBe('failed');
      // the German sentence in the row, the server's words one level down (P3)
      expect(row.textContent).toContain('Die Eingabe passt so nicht.');
      const details = within(row).getByTestId('technical-details');
      expect(details.hasAttribute('open')).toBe(false);
      expect(details.textContent).toContain(
        'Validation failed (422): files[1].path: not a model key',
      );
    }
  });

  it('says so when nothing is a BPMN file, naming the suffixes of the file rule', async () => {
    const calls = stubApi({});
    renderWithQuery(<UploadPanel project="demo" />);
    // The picker offers exactly the suffixes of BPMN_FILE_SUFFIXES.
    const accept = screen.getByTestId('file-input').getAttribute('accept') ?? '';
    expect(accept.split(',').sort()).toEqual([...BPMN_FILE_SUFFIXES].sort());
    fireEvent.change(screen.getByTestId('file-input'), {
      target: { files: [new File(['x'], 'notizen.txt')] },
    });
    const toast = await findToast('Keine BPMN-Dateien gefunden');
    expect(toast.textContent).toContain(
      `Erlaubt sind ${[...BPMN_FILE_SUFFIXES].sort().slice(0, -1).join(', ')} und .xml`,
    );
    expect(calls).toHaveLength(0);
  });

  it('shows the warnings per file in a disclosure, with German labels and the English message', async () => {
    stubApi({
      [`POST ${IMPORT_PATH}`]: (call) =>
        json({
          files: (call.body as string[]).map((path) => ({
            path,
            modelKey: path.replace(/\.bpmn$/, ''),
            outcome: 'revised',
            problem: null,
            ...(path === 'warn.bpmn'
              ? {
                  warnings: [
                    {
                      code: 'parse-warning',
                      message: 'unparsable content <bpmn:task> detected; duplicate ID <Task_A>',
                      elementId: 'Task_A',
                    },
                    { code: 'brand-new-code', message: 'something new' },
                  ],
                  warningCount: 3,
                }
              : {}),
          })),
        }),
    });
    renderWithQuery(<UploadPanel project="demo" />);
    fireEvent.change(screen.getByTestId('file-input'), {
      target: { files: [new File(['<x/>'], 'warn.bpmn'), new File(['<x/>'], 'clean.bpmn')] },
    });
    const table = await screen.findByRole('table', { name: 'Import je Datei' });
    await waitFor(() => expect(within(table).getAllByTestId('import-outcome')).toHaveLength(2));
    const disclosures = within(table).getAllByTestId('import-warnings');
    expect(disclosures).toHaveLength(1);
    const disclosure = disclosures[0]!;
    expect(within(disclosure).getByText('3 Hinweise')).toBeTruthy();
    const entries = within(disclosure).getAllByTestId('import-warning');
    expect(entries.map((e) => e.dataset['code'])).toEqual(['parse-warning', 'brand-new-code']);
    expect(entries[0]!.textContent).toContain('Unbekannter oder fehlerhafter Inhalt');
    expect(entries[0]!.textContent).toContain('Task_A');
    expect(entries[0]!.textContent).toContain('duplicate ID <Task_A>');
    // An unknown code shows the code.
    expect(entries[1]!.textContent).toContain('brand-new-code');
    expect(within(disclosure).getByText('… und 1 weitere')).toBeTruthy();
    expect(await findToast('2 Dateien importiert')).toBeTruthy();
  });

  it('fails a duplicate key before sending, skips a sidecar .xml and lists a plain .xml that is no BPMN as skipped', async () => {
    const calls = stubApi({
      [`POST ${IMPORT_PATH}`]: (call) =>
        json({
          files: (call.body as string[]).map((path) =>
            path === 'export/meta.xml'
              ? {
                  path,
                  modelKey: 'export/meta',
                  outcome: 'failed',
                  problem: {
                    type: 'urn:analyzr:problem:bpmn-invalid',
                    title: 'BPMN invalid',
                    status: 422,
                    code: 'bpmn-invalid',
                    detail: 'root element <meta> is not a BPMN 2.0 <definitions>',
                    reason: 'not-bpmn',
                  },
                }
              : { path, modelKey: path.replace(/\.\w+$/, ''), outcome: 'created', problem: null },
          ),
        }),
    });
    renderWithQuery(<UploadPanel project="demo" />);
    fireEvent.change(screen.getByTestId('file-input'), {
      target: {
        files: [
          withRelativePath('auftrag.bpmn', 'models/vertrieb/auftrag.bpmn'),
          withRelativePath('auftrag.bpmn2', 'models/vertrieb/auftrag.bpmn2'),
          withRelativePath('Auftrag.xml', 'models/vertrieb/Auftrag.xml'),
          withRelativePath('meta.xml', 'models/export/meta.xml'),
          withRelativePath('._auftrag.bpmn', 'models/vertrieb/._auftrag.bpmn'),
        ],
      },
    });
    const table = await screen.findByRole('table', { name: 'Import je Datei' });
    await waitFor(() => expect(screen.getByText(/Import abgeschlossen/)).toBeTruthy());
    // The hidden file is dropped silently; the duplicate key and the sidecar are never sent.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual(['export/meta.xml', 'vertrieb/auftrag.bpmn']);
    const rows = within(table).getAllByTestId('import-outcome');
    expect(rows.map((r) => r.dataset['outcome'])).toEqual(['failed', 'created']);
    expect(rows[0]!.textContent).toContain('vertrieb/auftrag.bpmn2');
    expect(
      within(rows[0]!).getByText(
        'another file of this import has model key vertrieb/auftrag (vertrieb/auftrag.bpmn)',
      ),
    ).toBeTruthy();
    // The heading covers every reason; each file names its own.
    expect(
      screen.getByText(
        '2 Dateien übersprungen (kein BPMN, größer als 5,0 MB oder gleicher Modellschlüssel wie eine BPMN-Datei)',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('vertrieb/Auftrag.xml – gleicher Modellschlüssel wie vertrieb/auftrag.bpmn'),
    ).toBeTruthy();
    expect(screen.getByText('export/meta.xml – kein BPMN')).toBeTruthy();
    expect(await findToast('1 von 2 Dateien nicht importiert')).toBeTruthy();
  });

  it('warns instead of reporting success when every file is a plain .xml that is no BPMN', async () => {
    const calls = stubApi({
      [`POST ${IMPORT_PATH}`]: (call) =>
        json({
          files: (call.body as string[]).map((path) => ({
            path,
            modelKey: path.replace(/\.xml$/, ''),
            outcome: 'failed',
            problem: {
              type: 'urn:analyzr:problem:bpmn-invalid',
              title: 'BPMN invalid',
              status: 422,
              code: 'bpmn-invalid',
              detail: 'root element <project> is not a BPMN 2.0 <definitions>',
              reason: 'not-bpmn',
            },
          })),
        }),
    });
    renderWithQuery(<UploadPanel project="demo" />);
    fireEvent.change(screen.getByTestId('file-input'), {
      target: { files: [new File(['<project/>'], 'pom.xml')] },
    });
    // Toasts of earlier tests stay up, so look for this one by its description.
    const toast = await findToast('Die XML-Dateien enthalten kein BPMN-Modell');
    expect(toast.textContent).toContain('Keine BPMN-Dateien gefunden');
    expect(calls).toHaveLength(1);
    expect(screen.getByText('pom.xml – kein BPMN')).toBeTruthy();
    expect(screen.queryByText('0 Dateien importiert')).toBeNull();
  });

  it("lists the extractor's too-many-warnings entry after the unlisted warnings", async () => {
    stubApi({
      [`POST ${IMPORT_PATH}`]: (call) =>
        json({
          files: (call.body as string[]).map((path) => ({
            path,
            modelKey: 'viel',
            outcome: 'created',
            problem: null,
            warnings: [
              ...Array.from({ length: 19 }, (_, i) => ({
                code: 'parse-warning',
                message: `w${i}`,
              })),
              { code: 'too-many-warnings', message: '150 more warnings omitted' },
            ],
            warningCount: 101,
          })),
        }),
    });
    renderWithQuery(<UploadPanel project="demo" />);
    fireEvent.change(screen.getByTestId('file-input'), {
      target: { files: [new File(['<x/>'], 'viel.bpmn')] },
    });
    const disclosure = await screen.findByTestId('import-warnings');
    expect(within(disclosure).getByText('100 Hinweise')).toBeTruthy();
    const items = within(disclosure).getAllByRole('listitem');
    expect(items).toHaveLength(21);
    expect(items[19]!.textContent).toBe('… und 81 weitere');
    expect(items[20]!.dataset['code']).toBe('too-many-warnings');
    expect(items[20]!.textContent).toContain('Weitere Hinweise ausgelassen');
    expect(items[20]!.textContent).toContain('150 more warnings omitted');
  });

  it('marks the drop zone while files are dragged over it', () => {
    stubApi({});
    renderWithQuery(<UploadPanel project="demo" />);
    const zone = screen.getByTestId('dropzone');
    fireEvent.dragOver(zone, { dataTransfer: { dropEffect: 'none' } });
    expect(screen.getByText('Dateien hier ablegen')).toBeTruthy();
    fireEvent.dragLeave(zone);
    expect(screen.getByText('BPMN-Dateien oder einen Ordner hierher ziehen')).toBeTruthy();
  });
});
