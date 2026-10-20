import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BPMN_FILE_SUFFIXES } from '@analyzr/contracts/paths';

import { UploadPanel } from '../src/components/upload-panel';
import { model, noLink, provenance, relation } from './support/fixtures';
import { findToast, json, renderWithRouter, stubApi, type Call } from './support/render';

const IMPORT_PATH = '/api/v1/projects/demo/imports';

/** The import requests only (the next-step box reads models, chain and questions too). */
const imports = (calls: readonly Call[]) =>
  calls.filter(
    (c) => c.method === 'POST' && c.path === IMPORT_PATH && !c.search.includes('dryRun'),
  );
/** The preview's requests (M6 S2b: `?dryRun=true` before „Importieren“). */
const previews = (calls: readonly Call[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === IMPORT_PATH && c.search === '?dryRun=true');

/** Waits for the preview and clicks „Importieren“. */
async function importNow() {
  fireEvent.click(await screen.findByTestId('preview-import'));
  await waitFor(() =>
    expect(screen.getByTestId('import-headline').textContent).not.toMatch(/^Vorschau/),
  );
}

const render = () => renderWithRouter(<UploadPanel project="demo" />);

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
                    title: 'BPMN invalid',
                    status: 422,
                    code: 'bpmn-invalid',
                    detail: 'DOCTYPE declarations are not allowed in BPMN',
                    reason: 'doctype-forbidden',
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
    await render();

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

    // M6 S2b: a preview first, then „Importieren“ sends the same
    await importNow();
    const table = await screen.findByRole('table', { name: 'Import je Datei' });
    await waitFor(() => expect(within(table).getAllByTestId('import-outcome')).toHaveLength(3));
    expect(previews(calls)).toHaveLength(1);
    expect(imports(calls)).toHaveLength(1);
    expect(imports(calls)[0]!.body).toEqual([
      'finanzen/rechnung.bpmn',
      'kaputt.bpmn',
      'vertrieb/auftrag.bpmn',
    ]);
    expect(previews(calls)[0]!.body).toEqual(imports(calls)[0]!.body);
    const outcomes = within(table).getAllByTestId('import-outcome');
    expect(outcomes.map((row) => row.dataset['outcome'])).toEqual([
      'unchanged',
      'failed',
      'created',
    ]);
    // the headline counts what happened (UX7)
    await waitFor(() =>
      expect(screen.getByTestId('import-headline').textContent).toBe(
        '1 Modell importiert · 1 unverändert · 1 Fehler · 1 übersprungen',
      ),
    );
    // one column: the model, its file below; a failed file only its path
    expect(within(outcomes[2]!).getAllByText('vertrieb/auftrag')).toHaveLength(1);
    expect(within(outcomes[2]!).getByTestId('import-path').textContent).toBe(
      'vertrieb/auftrag.bpmn',
    );
    expect(within(outcomes[1]!).queryByText('kaputt')).toBeNull();
    // the reason in German with what to do, the server's words one level down
    expect(within(outcomes[1]!).getByTestId('import-problem').textContent).toBe(
      'Die Datei enthält eine DOCTYPE- oder ENTITY-Angabe; solche Dateien liest analyzr aus Sicherheitsgründen nicht. Entferne die Angabe und lade die Datei erneut hoch.',
    );
    expect(within(outcomes[1]!).getByTestId('technical-details').textContent).toContain(
      'BPMN invalid (422): DOCTYPE declarations are not allowed in BPMN',
    );
    expect(within(outcomes[2]!).getByText('Neu')).toBeTruthy();
    expect(screen.getByTestId('import-skipped').textContent).toBe(
      '1 Datei übersprungen: README.md (kein BPMN)',
    );
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
    await render();
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
    // the preview failed as a whole: nothing to import
    expect(screen.queryByTestId('preview-import')).toBeNull();
  });

  it('says so when nothing is a BPMN file, naming the suffixes of the file rule', async () => {
    const calls = stubApi({});
    await render();
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

  it('groups the skipped elements of a file by cause, with what it means and the fix (UX7)', async () => {
    // The raw Signavio export's „Bonitätsprüfung.bpmn“ (tools/integrate/test/fixtures/signavio/
    // 2026-10-14-signavio), as the extractor words it: 9 lines about 2 elements.
    const bonitaet = [
      'unparsable content <task> detected line: 11 column: 6 nested error: illegal ID <Aufgabe_Bonität_prüfen>',
      'unparsable content <dataStoreReference> detected line: 29 column: 6 nested error: illegal ID <4711>',
      'unparsable content <bpmndi:BPMNShape> detected line: 44 column: 9 nested error: illegal ID <Aufgabe_Bonität_prüfen_gui>',
      'unparsable content <bpmndi:BPMNShape> detected line: 56 column: 9 nested error: illegal ID <4711_gui>',
    ].map((message) => ({ code: 'parse-warning', message }));
    const references = [
      ['sid-1A2B3C4D-5E6F-407A-8C8D-9E0F1A2B3C46', 'Aufgabe_Bonität_prüfen'],
      ['sid-2B3C4D5E-6F7A-418B-9D9E-0F1A2B3C4D47', 'Aufgabe_Bonität_prüfen'],
      ['sid-6F7A8B9C-ADBE-45CF-9B3C-4D5E6F7A8B51', '4711'],
      ['Aufgabe_Bonität_prüfen_gui', 'Aufgabe_Bonität_prüfen'],
      ['4711_gui', '4711'],
    ].map(([elementId, id]) => ({
      code: 'parse-warning',
      message: `unresolved reference <${id}>`,
      elementId,
    }));
    const versand = [
      'unparsable content <task> detected line: 18 column: 6 nested error: duplicate ID <sid-6A1F0E52-7B3C-4D8E-9F01-A2B3C4D5E681>',
      'unparsable content <bpmndi:BPMNShape> detected line: 45 column: 9 nested error: duplicate ID <sid-6A1F0E52-7B3C-4D8E-9F01-A2B3C4D5E681_gui>',
    ].map((message) => ({ code: 'parse-warning', message }));
    stubApi({
      [`POST ${IMPORT_PATH}`]: (call) =>
        json({
          files: (call.body as string[]).map((path) => {
            const warnings =
              path === 'bonitaet.bpmn'
                ? [...bonitaet, ...references, { code: 'brand-new-code', message: 'something new' }]
                : versand;
            return {
              path,
              modelKey: path.replace(/\.bpmn$/, ''),
              outcome: 'created',
              problem: null,
              warnings,
              warningCount: warnings.length,
            };
          }),
        }),
    });
    await render();
    fireEvent.change(screen.getByTestId('file-input'), {
      target: { files: [new File(['<x/>'], 'bonitaet.bpmn'), new File(['<x/>'], 'versand.bpmn')] },
    });
    const table = await screen.findByRole('table', { name: 'Import je Datei' });
    await waitFor(() => expect(within(table).getAllByTestId('import-warnings')).toHaveLength(2));
    const [first, second] = within(table).getAllByTestId('import-warnings');
    // „Hinweise“ stays the word (the integrate skill's report says „N Hinweise“ in the web)
    expect(first!.querySelector('summary')?.textContent).toBe('3 Hinweise');
    const entries = within(first!).getAllByTestId('import-warning');
    expect(entries.map((e) => e.dataset['code'])).toEqual(['invalid-id', 'brand-new-code']);
    expect(entries[0]!.textContent).toContain(
      '2 Elemente übersprungen, weil ihre ID ungültig ist: Aufgabe „Aufgabe_Bonität_prüfen“, Datenspeicher „4711“.',
    );
    expect(entries[0]!.textContent).toContain(
      'Sie fehlen im Diagramm und in den Verbindungen. Mit /analyzr-integrate:integrate-landscape bereinigen und erneut hochladen.',
    );
    // the nine English lines behind „Technische Details“, closed
    const technical = within(entries[0]!).getByTestId('technical-details');
    expect(technical.hasAttribute('open')).toBe(false);
    expect(technical.querySelector('p')?.textContent?.split('\n')).toHaveLength(9);
    // an unknown code shows the code
    expect(entries[1]!.textContent).toContain('brand-new-code');
    expect(second!.querySelector('summary')?.textContent).toBe('1 Hinweis');
    expect(within(second!).getByTestId('import-warning').textContent).toContain(
      '1 Element übersprungen, weil seine ID schon vergeben ist: Aufgabe „sid-6A1F0E52-7B3C-4D8E-9F01-A2B3C4D5E681“.Es fehlt im Diagramm',
    );
    await importNow();
    expect(await findToast('2 Dateien importiert')).toBeTruthy();
  });

  it('says a UTF-16 or Latin-1 file in German, with the remedy (UX7)', async () => {
    const problem = (encoding: string) => ({
      type: 'urn:analyzr:problem:bpmn-invalid',
      title: 'BPMN invalid',
      status: 422,
      code: 'bpmn-invalid',
      detail: 'BPMN must be UTF-8 encoded',
      reason: 'not-xml',
      encoding,
    });
    stubApi({
      [`POST ${IMPORT_PATH}`]: (call) =>
        json({
          files: (call.body as string[]).map((path) => ({
            path,
            modelKey: path.replace(/\.bpmn$/, ''),
            outcome: 'failed',
            problem: problem(path === 'utf16.bpmn' ? 'utf-16' : 'not-utf-8'),
          })),
        }),
    });
    await render();
    fireEvent.change(screen.getByTestId('file-input'), {
      target: { files: [new File(['x'], 'utf16.bpmn'), new File(['x'], 'latin.bpmn')] },
    });
    const table = await screen.findByRole('table', { name: 'Import je Datei' });
    await waitFor(() => expect(within(table).getAllByTestId('import-problem')).toHaveLength(2));
    expect(
      within(table)
        .getAllByTestId('import-problem')
        .map((p) => p.textContent),
    ).toEqual([
      'Die Datei ist nicht UTF-8-kodiert (oft ISO-8859-1 oder Windows-1252); analyzr liest nur UTF-8. Speichere sie als UTF-8 oder wandle den Export mit /analyzr-integrate:integrate-landscape um.',
      'Die Datei ist UTF-16-kodiert; analyzr liest nur UTF-8. Speichere sie als UTF-8 oder wandle den Export mit /analyzr-integrate:integrate-landscape um.',
    ]);
    // a preview where nothing can be imported: no „Importieren“
    expect(screen.getByTestId('import-headline').textContent).toBe('Vorschau: 2 Fehler');
    expect(screen.queryByTestId('preview-import')).toBeNull();
  });

  it('says what comes next: the models waiting for the agent and the questions there are already', async () => {
    stubApi({
      [`POST ${IMPORT_PATH}`]: (call) =>
        json({
          files: (call.body as string[]).map((path) => ({
            path,
            modelKey: path.replace(/\.bpmn$/, ''),
            outcome: 'created',
            problem: null,
          })),
        }),
      'GET /api/v1/projects/demo': () =>
        json({
          id: 'prj_01DEMO',
          key: 'demo',
          name: 'Demo',
          role: 'owner',
          lastSeq: 3,
          createdAt: '2026-10-07T09:00:00.000Z',
        }),
      'GET /api/v1/projects/demo/agent-tokens': () => json({ items: [] }),
      'GET /api/v1/projects/demo/models': () =>
        json({
          items: [
            model({ key: 'a', stage: 'waiting_for_agent' }),
            model({ key: 'b', stage: 'waiting_for_agent' }),
            model({ key: 'c', stage: 'waiting_for_review' }),
          ],
          nextCursor: null,
        }),
      'GET /api/v1/projects/demo/open-questions': () =>
        json({
          items: [],
          nextCursor: null,
          totals: { ask: 9, agent: 0, proposal: 0, info: 0 },
          askByModel: {},
        }),
    });
    await render();
    fireEvent.change(screen.getByTestId('file-input'), {
      target: { files: [new File(['<x/>'], 'a.bpmn'), new File(['<x/>'], 'b.bpmn')] },
    });
    await importNow();
    const next = await screen.findByTestId('upload-next');
    await waitFor(() => expect(within(next).queryByTestId('upload-next-loading')).toBeNull());
    // „Agent verbinden“ once the owner's tokens are known
    await waitFor(() =>
      expect(within(next).getByTestId('upload-next-agent').textContent).toBe(
        '2 Modelle warten auf den AgentenAgent verbinden',
      ),
    );
    // without an active token the owner connects one first
    expect(within(next).getByRole('link', { name: 'Agent verbinden' }).getAttribute('href')).toBe(
      '/projects/demo/agents',
    );
    expect(within(next).getByTestId('upload-next-questions').textContent).toBe(
      '9 offene Fragen gibt es schon jetzt·Offene Fragen ansehen',
    );
    expect(
      within(next).getByRole('link', { name: 'Offene Fragen ansehen' }).getAttribute('href'),
    ).toBe('/projects/demo/open-questions');
    expect(within(next).getByTestId('upload-overview').getAttribute('href')).toBe('/projects/demo');
  });

  it('names the unique calls of derived models first, „Gesammelt annehmen“ leading to their bulk accept (M6 S2c)', async () => {
    const call = (n: number, status: 'proposed' | 'accepted' = 'proposed') =>
      relation({
        id: `rel_01CALL${n}`,
        type: 'call',
        status,
        confidence: 0.9,
        from: `a#Call_${n}`,
        to: `b#Process_${n}`,
        attrs: { calledElement: `Process_${n}`, match: 'derived-caller' },
      });
    const routes = (role: 'owner' | 'viewer') => ({
      [`POST ${IMPORT_PATH}`]: (call: Call) =>
        json({
          files: (call.body as string[]).map((path) => ({
            path,
            modelKey: path.replace(/\.bpmn$/, ''),
            outcome: 'created',
            problem: null,
          })),
        }),
      'GET /api/v1/projects/demo': () =>
        json({
          id: 'prj_01DEMO',
          key: 'demo',
          name: 'Demo',
          role,
          lastSeq: 3,
          createdAt: '2026-10-07T09:00:00.000Z',
        }),
      'GET /api/v1/projects/demo/agent-tokens': () => json({ items: [] }),
      'GET /api/v1/projects/demo/models': () =>
        json({
          items: [
            model({ key: 'a', stage: 'waiting_for_agent' }),
            model({ key: 'b', stage: 'waiting_for_agent' }),
          ],
          nextCursor: null,
        }),
      // two such calls open, one accepted already, one an agent asks about and one it objects to
      // (decided one by one), one message proposal: the dialog selects 2
      'GET /api/v1/projects/demo/landscape': () =>
        json({
          projectId: 'prj_01DEMO',
          seq: 3,
          models: [],
          relations: [
            call(1),
            call(2),
            call(3, 'accepted'),
            { ...call(4), provenance: provenance({ question: 'Wirklich dieser Prozess?' }) },
            { ...call(5), noLinks: [noLink()] },
            relation({ id: 'rel_01MSG', from: 'a#S', to: 'b#C' }),
          ],
          findings: [],
        }),
    });
    stubApi(routes('owner'));
    await render();
    fireEvent.change(screen.getByTestId('file-input'), {
      target: { files: [new File(['<x/>'], 'a.bpmn'), new File(['<x/>'], 'b.bpmn')] },
    });
    await importNow();
    const next = await screen.findByTestId('upload-next');
    await waitFor(() => expect(within(next).queryByTestId('upload-next-loading')).toBeNull());
    await waitFor(() =>
      expect(within(next).getByTestId('upload-next-calls').textContent).toBe(
        '2 eindeutige Aufrufe warten auf deine Bestätigung·Gesammelt annehmen',
      ),
    );
    // before „Agent starten“: accepted calls are settled, no agent judges them
    await waitFor(() =>
      expect(
        within(next)
          .getAllByRole('listitem')
          .map((li) => li.dataset['testid']),
      ).toEqual(['upload-next-calls', 'upload-next-agent']),
    );
    expect(
      within(next).getByRole('link', { name: 'Gesammelt annehmen' }).getAttribute('href'),
    ).toBe('/projects/demo/review?bulk=calls');

    // only for those who may review („Hochladen“ itself needs `write`, which has review too)
    cleanup();
    stubApi(routes('viewer'));
    await render();
    fireEvent.change(screen.getByTestId('file-input'), {
      target: { files: [new File(['<x/>'], 'a.bpmn')] },
    });
    await importNow();
    const viewer = await screen.findByTestId('upload-next');
    await waitFor(() => expect(within(viewer).queryByTestId('upload-next-loading')).toBeNull());
    await within(viewer).findByTestId('upload-next-agent');
    expect(within(viewer).queryByTestId('upload-next-calls')).toBeNull();
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
    await render();
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
    await importNow();
    const table = await screen.findByRole('table', { name: 'Import je Datei' });
    await waitFor(() =>
      expect(screen.getByTestId('import-headline').textContent).toBe(
        '1 Modell importiert · 1 Fehler · 2 übersprungen',
      ),
    );
    // The hidden file is dropped silently; the duplicate key and the sidecar are never sent.
    expect(imports(calls)).toHaveLength(1);
    expect(imports(calls)[0]!.body).toEqual(['export/meta.xml', 'vertrieb/auftrag.bpmn']);
    const rows = within(table).getAllByTestId('import-outcome');
    expect(rows.map((r) => r.dataset['outcome'])).toEqual(['failed', 'created']);
    expect(rows[0]!.textContent).toContain('vertrieb/auftrag.bpmn2');
    expect(within(rows[0]!).getByTestId('import-problem').textContent).toBe(
      'Eine andere Datei dieses Imports bekommt denselben Kurznamen: vertrieb/auftrag.bpmn.',
    );
    expect(within(rows[0]!).getByTestId('technical-details').textContent).toContain(
      'another file of this import has model key vertrieb/auftrag (vertrieb/auftrag.bpmn)',
    );
    // Up to three skipped files in one line, each with its reason.
    expect(screen.getByTestId('import-skipped').textContent).toBe(
      '2 Dateien übersprungen: vertrieb/Auftrag.xml (gleicher Kurzname wie vertrieb/auftrag.bpmn), export/meta.xml (kein BPMN)',
    );
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
    await render();
    fireEvent.change(screen.getByTestId('file-input'), {
      target: { files: [new File(['<project/>'], 'pom.xml')] },
    });
    // Toasts of earlier tests stay up, so look for this one by its description.
    const toast = await findToast('Die XML-Dateien enthalten kein BPMN-Modell');
    expect(toast.textContent).toContain('Keine BPMN-Dateien gefunden');
    // the preview only: nothing to import
    expect(previews(calls)).toHaveLength(1);
    expect(imports(calls)).toHaveLength(0);
    expect(screen.getByTestId('import-skipped').textContent).toBe(
      '1 Datei übersprungen: pom.xml (kein BPMN)',
    );
    expect(screen.getByTestId('import-headline').textContent).toBe('Vorschau: 1 übersprungen');
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
    await render();
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

  it('reads a bundle’s manifest: pinned keys, the subset per batch, provenance and identity in German (UX8)', async () => {
    const manifest = {
      format: 'analyzr-import/1',
      source: { system: 'signavio', exportedAt: '2026-10-14T00:00:00Z' },
      files: [
        { path: 'Finanzen/Bonität.bpmn', key: 'finanzen/bonitaet', externalId: 'sid-B' },
        { path: 'Lager/Kommission.bpmn', key: 'lager/kommission', externalId: 'sid-K' },
      ],
      valueChain: { path: 'kette.vc.json' },
    };
    const calls = stubApi({
      [`POST ${IMPORT_PATH}`]: (call) =>
        json({
          files: (call.body as string[]).map((path) => ({
            path,
            modelKey: path === 'Finanzen/Bonität.bpmn' ? 'finanzen/bonitaet' : 'lager/kommission',
            outcome: 'created',
            problem: null,
            ...(path === 'Lager/Kommission.bpmn'
              ? {
                  importWarnings: [
                    {
                      code: 'external-id-moved',
                      message:
                        'signavio id sid-K already belongs to lager/alt: two models now carry it',
                      system: 'signavio',
                      externalId: 'sid-K',
                      otherKeys: ['lager/alt'],
                    },
                  ],
                }
              : {}),
          })),
        }),
    });
    await render();
    fireEvent.change(screen.getByTestId('folder-input'), {
      target: {
        files: [
          withRelativePath('analyzr-import.json', 'bundle/analyzr-import.json'),
          withRelativePath('Bonität.bpmn', 'bundle/Finanzen/Bonität.bpmn'),
          withRelativePath('Kommission.bpmn', 'bundle/Lager/Kommission.bpmn'),
          withRelativePath('kette.vc.json', 'bundle/kette.vc.json'),
        ].map((f) =>
          f.name === 'analyzr-import.json'
            ? Object.defineProperty(
                new File([JSON.stringify(manifest)], f.name),
                'webkitRelativePath',
                {
                  value: 'bundle/analyzr-import.json',
                },
              )
            : f,
        ),
      },
    });
    await importNow();
    const table = await screen.findByRole('table', { name: 'Import je Datei' });
    await waitFor(() => expect(within(table).getAllByTestId('import-outcome')).toHaveLength(2));
    // one request with the BPMN files and the manifest's subset for them, as `analyzr import`
    const [post] = imports(calls);
    expect(post!.body).toEqual(['Finanzen/Bonität.bpmn', 'Lager/Kommission.bpmn']);
    expect(JSON.parse(post!.manifest ?? 'null')).toEqual({
      format: 'analyzr-import/1',
      source: manifest.source,
      files: manifest.files,
    });
    expect(screen.getByTestId('upload-bundle').textContent).toBe(
      'Bundle erkannt: Signavio, exportiert am 14.10.2026 · 2 von 2 Dateien gelistet · Kurznamen aus dem Bundle',
    );
    // the manifest and the chain are the bundle's: nothing skipped
    expect(screen.queryByTestId('import-skipped')).toBeNull();
    expect(screen.getByTestId('import-headline').textContent).toBe(
      '2 Modelle importiert · 1 Hinweis zur Identität',
    );
    const identity = within(table).getByTestId('import-identity-warning');
    expect(identity.dataset['code']).toBe('external-id-moved');
    expect(identity.textContent).toContain(
      'Im Quellsystem umbenannt oder verschoben? „sid-K“ gehörte bisher zu „lager/alt“',
    );
    expect(await screen.findByTestId('upload-next-chain')).toBeTruthy();
    expect(
      within(screen.getByTestId('upload-next-chain'))
        .getByRole('link', { name: 'Auf der Kette importieren' })
        .getAttribute('href'),
    ).toBe('/projects/demo/value-chain');
  });

  it('stops before sending when the bundle’s manifest is invalid, saying why in German', async () => {
    const calls = stubApi({});
    await render();
    const bad = new File(['{"format":"analyzr-import/1"'], 'analyzr-import.json');
    Object.defineProperty(bad, 'webkitRelativePath', { value: 'bundle/analyzr-import.json' });
    fireEvent.change(screen.getByTestId('folder-input'), {
      target: { files: [bad, withRelativePath('a.bpmn', 'bundle/a.bpmn')] },
    });
    const alert = await screen.findByTestId('upload-refused');
    expect(alert.textContent).toContain(
      'Die analyzr-import.json des Bundles ist kein gültiges JSON. Nichts importiert.',
    );
    expect(imports(calls)).toHaveLength(0);
    expect(screen.queryByRole('table', { name: 'Import je Datei' })).toBeNull();
  });

  it('previews before importing: what would change, the shared folder, „Abbrechen“ imports nothing (M6 S2b)', async () => {
    const list = <T,>(count: number, items: T[] = []) => ({ count, items });
    const calls = stubApi({
      [`POST ${IMPORT_PATH}`]: (call) =>
        json({
          files: (call.body as string[]).map((path) => ({
            path,
            modelKey: `gemeinsam/${path.replace(/\.bpmn$/, '')}`,
            outcome: 'created',
            problem: null,
          })),
          ...(call.search === '?dryRun=true'
            ? {
                impact: {
                  files: ['a', 'b'].map((k) => ({
                    modelKey: `gemeinsam/${k}`,
                    factsChanged: true,
                    processesAdded: [],
                    processesRemoved: [],
                    trust: { class: 'derived', reasons: ['no-engine'] },
                  })),
                  acceptedCalls: list(2, [
                    { type: 'call', from: 'gemeinsam/a#Call_B', to: 'gemeinsam/b#Process_B' },
                    { type: 'call', from: 'gemeinsam/b#Call_A', to: 'gemeinsam/a#Process_A' },
                  ]),
                  // the trust rule (M6 S2c): a derived model's unique call, only proposed
                  callsProposed: {
                    ...list(1, [
                      {
                        type: 'call',
                        from: 'gemeinsam/b#Call_C',
                        to: 'gemeinsam/a#Process_A',
                        wasAccepted: true,
                      },
                    ]),
                    wasAccepted: 1,
                    byReason: [{ reason: 'no-engine', count: 1 }],
                  },
                  proposalsAdded: list(0),
                  proposalsWithdrawn: list(0),
                  endpointsChanged: list(1, [
                    {
                      type: 'call',
                      from: 'alt/x#Call_A',
                      to: 'gemeinsam/a#Process_A',
                      endpointState: 'changed',
                    },
                  ]),
                  findingsAdded: list(0),
                  findingsResolved: list(0),
                  absentKeys: list(3, ['alt/x', 'alt/y', 'alt/z']),
                  relationsTasks: {
                    queued: list(2, ['gemeinsam/a', 'gemeinsam/b']),
                    cancelled: list(0),
                    claimed: 0,
                    pairs: 0,
                    rejudged: list(0),
                  },
                },
              }
            : {}),
        }),
    });
    await render();
    fireEvent.change(screen.getByTestId('file-input'), {
      target: { files: [new File(['<x/>'], 'a.bpmn'), new File(['<x/>'], 'b.bpmn')] },
    });
    const preview = await screen.findByTestId('upload-preview');
    expect(screen.getByTestId('import-headline').textContent).toBe('Vorschau: 2 Modelle neu');
    expect(within(preview).getByTestId('preview-impact').textContent).toBe(
      'Danach: 2 Aufrufe automatisch verknüpft · 1 Aufruf nur vorgeschlagen (ohne Camunda-Engine) – nach dem Import gesammelt annehmen · 1 angenommene Relation mit geändertem oder fehlendem Endpunkt',
    );
    // keys are fixed for good: a dropped parent folder in every name is worth a hint
    expect(within(preview).getByTestId('preview-folder').textContent).toContain(
      'Alle Kurznamen beginnen mit „gemeinsam/“',
    );
    const details = within(preview).getByTestId('preview-details');
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.textContent).toContain('gemeinsam/a#Call_B → gemeinsam/b#Process_B');
    expect(details.textContent).toContain('alt/x#Call_A → gemeinsam/a#Process_A (geändert)');
    expect(details.textContent).toContain(
      'Aufrufe als Vorschlag (1)gemeinsam/b#Call_C → gemeinsam/a#Process_A (bisher angenommen)',
    );
    expect(details.textContent).toContain('alt/z');
    // the outcome column says what each file would become
    expect(
      within(screen.getByRole('table', { name: 'Import je Datei' })).getAllByText('Wird neu'),
    ).toHaveLength(2);
    expect(previews(calls)).toHaveLength(1);
    // „Abbrechen“: nothing sent, the result gone
    fireEvent.click(within(preview).getByTestId('preview-cancel'));
    expect(screen.queryByTestId('upload-preview')).toBeNull();
    expect(imports(calls)).toHaveLength(0);
  });

  it('names the agent work, warns before cancelling an agent’s claim and asks a second time (S2b follow-up)', async () => {
    const list = <T,>(count: number, items: T[] = []) => ({ count, items });
    /** The claimed tasks the preview answers (the test changes it between drops). */
    let claimed = ['vertrieb/auftrag'];
    const calls = stubApi({
      [`POST ${IMPORT_PATH}`]: (call) =>
        json({
          files: (call.body as string[]).map((path) => ({
            path,
            modelKey: path.replace(/\.bpmn$/, ''),
            outcome: 'revised',
            problem: null,
          })),
          ...(call.search === '?dryRun=true'
            ? {
                impact: {
                  files: [],
                  acceptedCalls: list(0),
                  callsProposed: { ...list(0), wasAccepted: 0, byReason: [] },
                  proposalsAdded: list(0),
                  proposalsWithdrawn: list(0),
                  endpointsChanged: list(0),
                  findingsAdded: list(0),
                  findingsResolved: list(0),
                  absentKeys: list(0),
                  relationsTasks: {
                    queued: list(2, ['finanzen/rechnung', 'vertrieb/auftrag']),
                    cancelled: list(claimed.length + 1, [
                      ...claimed.map((modelKey) => ({
                        modelKey,
                        state: 'claimed',
                        claimedBy: 'agent:claude',
                        assigned: 34,
                      })),
                      {
                        modelKey: 'finanzen/rechnung',
                        state: 'queued',
                        claimedBy: null,
                        assigned: null,
                      },
                    ]),
                    claimed: claimed.length,
                    pairs: 1214,
                    rejudged: list(56, [
                      { type: 'call', from: 'vertrieb/auftrag#Call_R', to: 'finanzen/rechnung#P' },
                    ]),
                  },
                  placementsChanged: list(1, [
                    {
                      step: 'step-vertrieb',
                      stepName: 'Vertrieb',
                      process: 'vertrieb/auftrag#Process_Auftrag',
                      endpointState: 'changed',
                    },
                  ]),
                  placementTask: { outcome: 'deferred', due: 3, newlyDue: 2, again: 1 },
                },
              }
            : {}),
        }),
    });
    await render();
    const drop = () =>
      fireEvent.change(screen.getByTestId('file-input'), {
        target: {
          files: [
            withRelativePath('auftrag.bpmn', 'models/vertrieb/auftrag.bpmn'),
            withRelativePath('rechnung.bpmn', 'models/finanzen/rechnung.bpmn'),
          ],
        },
      });
    drop();
    let preview = await screen.findByTestId('upload-preview');
    // the cost in the last line, a deferred placement task's newly due processes included
    expect(within(preview).getByTestId('preview-impact').textContent).toBe(
      'Danach: 1 angenommene Platzierung mit geändertem oder fehlendem Prozess · 1.214 mögliche Relationen zu beurteilen (56 davon erneut), 2 Prozesse zu platzieren (1 davon erneut)',
    );
    const details = within(preview).getByTestId('preview-details');
    expect(details.textContent).toContain(
      'Angenommene Platzierungen mit geändertem oder fehlendem Prozess (1)vertrieb/auftrag#Process_Auftrag → „Vertrieb“ (geändert)',
    );
    expect(details.textContent).toContain(
      'Mögliche Relationen, die erneut beurteilt werden (56)Aufruf vertrieb/auftrag#Call_R → finanzen/rechnung#P… und 55 weitere',
    );
    // one claimed task: by its key, no handle
    const warning = within(preview).getByTestId('preview-claimed');
    expect(warning.textContent).toBe(
      'Ein Agent bearbeitet „vertrieb/auftrag“ gerade; seine Arbeit geht verloren.Der Import bricht seine Analyse ab; sie wird danach neu eingeplant.',
    );
    expect(warning.textContent).not.toContain('agent:claude');
    // the first click sends nothing and asks again
    const button = within(preview).getByTestId('preview-import');
    expect(button.textContent).toBe('Importieren');
    expect(button.getAttribute('aria-describedby')).toBe(warning.id);
    fireEvent.click(button);
    expect(button.textContent).toBe('Trotzdem importieren');
    expect(imports(calls)).toHaveLength(0);
    // „Abbrechen“ disarms: the next preview asks again
    fireEvent.click(within(preview).getByTestId('preview-cancel'));
    expect(screen.queryByTestId('upload-preview')).toBeNull();
    claimed = ['a', 'b', 'c', 'd', 'e'];
    drop();
    preview = await screen.findByTestId('upload-preview');
    expect(within(preview).getByTestId('preview-claimed').textContent).toBe(
      'Agenten bearbeiten gerade 5 dieser Modelle; ihre Arbeit geht verloren.„a“, „b“, „c“ und 2 weitere. Der Import bricht ihre Analysen ab; sie werden danach neu eingeplant.',
    );
    expect(within(preview).getByTestId('preview-import').textContent).toBe('Importieren');
    fireEvent.click(within(preview).getByTestId('preview-import'));
    // a new preview while armed disarms too
    drop();
    await waitFor(() => expect(previews(calls)).toHaveLength(3));
    await waitFor(() =>
      expect(screen.getByTestId('preview-import').textContent).toBe('Importieren'),
    );
    preview = screen.getByTestId('upload-preview');
    fireEvent.click(within(preview).getByTestId('preview-import'), { detail: 1 });
    expect(imports(calls)).toHaveLength(0);
    // a double click arms only: its later click sends nothing, the preview stays
    fireEvent.click(within(preview).getByTestId('preview-import'), { detail: 2 });
    expect(screen.getByTestId('preview-import').textContent).toBe('Trotzdem importieren');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(imports(calls)).toHaveLength(0);
    // the second click imports
    fireEvent.click(within(preview).getByTestId('preview-import'), { detail: 1 });
    await waitFor(() => expect(imports(calls)).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByTestId('import-headline').textContent).toBe('2 Modelle importiert'),
    );
    expect(screen.queryByTestId('preview-claimed')).toBeNull();
  });

  it('opens „Was ändert sich?“ only onto lists, and drops the „keine Änderung“ line beside the warning (S2b follow-up)', async () => {
    const list = <T,>(count: number, items: T[] = []) => ({ count, items });
    /** The relations tasks the preview answers (the test changes it between drops). */
    let tasks = {
      queued: list(1, ['vertrieb/auftrag']),
      cancelled: list(0),
      claimed: 0,
      pairs: 12,
      rejudged: list(0),
    };
    stubApi({
      [`POST ${IMPORT_PATH}`]: (call) =>
        json({
          files: (call.body as string[]).map((path) => ({
            path,
            modelKey: path.replace(/\.bpmn$/, ''),
            outcome: 'revised',
            problem: null,
          })),
          impact: {
            files: [],
            acceptedCalls: list(0),
            callsProposed: { ...list(0), wasAccepted: 0, byReason: [] },
            proposalsAdded: list(0),
            proposalsWithdrawn: list(0),
            endpointsChanged: list(0),
            findingsAdded: list(0),
            findingsResolved: list(0),
            absentKeys: list(0),
            relationsTasks: tasks,
          },
        }),
    });
    await render();
    const drop = () =>
      fireEvent.change(screen.getByTestId('file-input'), {
        target: { files: [withRelativePath('auftrag.bpmn', 'models/vertrieb/auftrag.bpmn')] },
      });
    drop();
    let preview = await screen.findByTestId('upload-preview');
    // a documentation fix before the agents ran: only the cost line, whose pairs have no list
    expect(within(preview).getByTestId('preview-impact').textContent).toBe(
      'Danach: 12 mögliche Relationen zu beurteilen',
    );
    expect(within(preview).queryByTestId('preview-details')).toBeNull();
    // a revert while an agent holds the task: its work is lost, so no „keine Änderung“ beside it
    fireEvent.click(within(preview).getByTestId('preview-cancel'));
    tasks = {
      queued: list(0),
      cancelled: list(1, [
        { modelKey: 'vertrieb/auftrag', state: 'claimed', claimedBy: 'agent:claude', assigned: 3 },
      ]),
      claimed: 1,
      pairs: 0,
      rejudged: list(0),
    };
    drop();
    await waitFor(() => expect(screen.getByTestId('preview-claimed')).toBeDefined());
    preview = screen.getByTestId('upload-preview');
    expect(within(preview).queryByTestId('preview-impact')).toBeNull();
    expect(within(preview).queryByTestId('preview-details')).toBeNull();
  });

  it('marks the drop zone while files are dragged over it', async () => {
    stubApi({});
    await render();
    const zone = screen.getByTestId('dropzone');
    fireEvent.dragOver(zone, { dataTransfer: { dropEffect: 'none' } });
    expect(screen.getByText('Dateien hier ablegen')).toBeTruthy();
    fireEvent.dragLeave(zone);
    expect(screen.getByText('BPMN-Dateien oder einen Ordner hierher ziehen.')).toBeTruthy();
    // the converter for tool exports, copyable; the limits only in a skip or an error
    expect(screen.getByTestId('dropzone-convert').textContent).toContain(
      'Export aus Signavio, ARIS oder Visio? Wandle ihn zuerst mit/analyzr-integrate:integrate-landscape',
    );
    expect(screen.getByTestId('dropzone').textContent).not.toMatch(/MB|50 Dateien/);
  });

  it('names more than three skipped files by count, all of them behind a disclosure', async () => {
    const calls = stubApi({});
    await render();
    fireEvent.change(screen.getByTestId('file-input'), {
      target: {
        files: ['a.pdf', 'b.txt', 'c.md', 'd.yaml', 'e.png'].map((n) => new File(['x'], n)),
      },
    });
    const line = await screen.findByTestId('import-skipped');
    expect(line.querySelector('p')?.textContent).toBe(
      '5 Dateien übersprungen: a.pdf (kein BPMN), b.txt (kein BPMN), c.md (kein BPMN) und 2 weitere',
    );
    expect(within(line).getAllByRole('listitem', { hidden: true })).toHaveLength(5);
    expect(imports(calls)).toHaveLength(0);
  });
});
