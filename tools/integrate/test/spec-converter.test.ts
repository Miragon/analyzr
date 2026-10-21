// The converter runner (src/spec/converter.ts, M6 S3c §4): the example converters on the
// synthetic Visio and AML exports, the run record and the write-once copy, D3 (a)–(c) for
// converter output through analyzr-spec's plan and bundle, the record check at bundle, every
// refusal before a converter runs (each without side effects), and the converter's result:
// per-model failures, the result's own shape and the run's failures.
import { link, mkdir, readFile, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { extractFacts } from '@analyzr/bpmn-facts';
import { ImportManifest as ManifestSchema } from '@analyzr/contracts/import-manifest';
import { describe, expect, it, vi } from 'vitest';

import { PathGuardError } from '../src/guards.ts';
import { applyPlan, emptyKeymap, type Keymap } from '../src/keymap.ts';
import { planSpecFolder, scanSpecs, SpecBundleError, writeSpecBundle } from '../src/spec/bundle.ts';
import { compactConvert, compactValidation } from '../src/spec/compact.ts';
import { childScript } from '../src/spec/converter.ts';
import { readLosses, readRunRecord, sumLosses } from '../src/spec/record.ts';

import {
  ARIS_EXPORT as ARIS,
  arisExport,
  CONVERTER_FIXTURES,
  converter,
  convertWith,
  fixtureConverter,
  plainExport,
  probeConverter,
  probeLines,
  refusal,
  sha256,
  VISIO_EXPORT as VISIO,
  visioExport,
  workspace,
} from './converter-support.ts';
import { diProblems, parseRendered, structureProblems, walkProblems } from './spec-checks.ts';
import { PACKAGE_ROOT } from './support.ts';
import { zipFolder } from './zip-writer.ts';

// Each test starts real child processes; a loaded CI machine may take a while.
vi.setConfig({ testTimeout: 60_000 });
/** A converter returning `result` (a JavaScript expression) for any export. */
const returning = (result: string): string =>
  `function convert(input, helpers) {\n  return ${result};\n}\n`;

/** A valid model of tool path `externalPath` (as JavaScript source). */
const model = (externalPath: string, extra = ''): string =>
  `{ source: { externalPath: ${JSON.stringify(externalPath)} }, processes: [{ source: 'p', name: 'P', nodes: [{ source: 's', type: 'start', name: 'Los' }, { source: 'e', type: 'end', name: 'Fertig' }], flows: [{ from: 's', to: 'e' }] }]${extra} }`;

/** Plans and confirms the keys of a spec folder as the consultant would, then bundles it. */
async function bundled(ws: string, specs: string, system: string) {
  const { plan } = await planSpecFolder(
    emptyKeymap(),
    specs,
    { system, rule: { strip: null, prefix: null }, scope: null },
    undefined,
    ws,
  );
  const keymap: Keymap = applyPlan(emptyKeymap(), plan, path.basename(specs));
  const out = path.join(ws, 'bundles', path.basename(specs));
  const result = await writeSpecBundle({
    specDir: specs,
    outDir: out,
    workspace: ws,
    system,
    keymap,
  });
  return { result, out, keymap };
}

describe('the example converters', () => {
  it('turn the Visio export into specs and an exact run record', async () => {
    const ws = await workspace();
    const exported = await visioExport(ws);
    const conv = await fixtureConverter(ws, 'visio-bpmn.js');
    const out = path.join(ws, 'specs', VISIO);
    const result = await convertWith(ws, exported, conv, { out });
    const id = `adhoc:${conv.sha256.slice(0, 12)}`;
    const written = async (file: string): Promise<string> =>
      sha256(await readFile(path.join(out, ...file.split('/'))));
    expect(result.record).toEqual({
      format: 'analyzr-specs/1',
      converter: {
        id,
        sha256: conv.sha256,
        file: `converters/adhoc-${conv.sha256.slice(0, 12)}.js`,
        workingCopy: 'converters/visio-bpmn.js',
      },
      derived: { kind: 'converted', llmModel: null },
      runner: 'analyzr-convert@0.1.0',
      export: `exports/${VISIO}`,
      systemVersion: 'Visio 16.0',
      // both VSDX read (12 parts: masters, rels, pages, document), the text file not
      reads: { files: 2, of: 3, entries: 12 },
      specs: [
        {
          file: 'service/reklamation/reklamation.spec.yaml',
          sha256: await written('service/reklamation/reklamation.spec.yaml'),
          externalPath: 'Service/Reklamation/Reklamation',
          externalId: null,
          losses: [],
          warnings: [],
          warningCount: 0,
        },
        {
          file: 'vertrieb/prozesse/auftragsabwicklung.spec.yaml',
          sha256: await written('vertrieb/prozesse/auftragsabwicklung.spec.yaml'),
          externalPath: 'Vertrieb/Prozesse/Auftragsabwicklung',
          externalId: null,
          // the text annotation, the connector glued at one end, the off-page reference pair
          losses: [{ code: 'element-dropped', count: 4 }],
          warnings: [],
          warningCount: 0,
        },
      ],
      failed: [],
      duplicates: [],
      skipped: [
        { path: 'Liesmich.txt', reason: 'not a VSDX file' },
        { path: 'Vertrieb/Prozesse.vsdx', reason: 'page "Legende" has no process shapes' },
      ],
      unread: [],
      zipRefused: [],
      symlinksSkipped: 0,
      hiddenSkipped: 0,
    });
    expect((await readdir(out)).sort()).toEqual(['analyzr-specs.json', 'service', 'vertrieb']);
    expect(JSON.parse(await readFile(result.recordFile, 'utf8'))).toEqual(result.record);
    // the write-once copy holds the bytes that ran
    expect(sha256(await readFile(path.join(ws, result.record.converter.file)))).toBe(conv.sha256);
    expect(compactConvert(result)).toMatchObject({
      converter: id,
      reads: { files: 2, of: 3, entries: 12 },
      counts: { models: 2, failed: 0, skipped: 2 },
      losses: { 'element-dropped': 4 },
    });

    // the off-page pair joined both pages: the lane of page 2 and the flow across the pages
    const spec = await readFile(
      path.join(out, 'vertrieb', 'prozesse', 'auftragsabwicklung.spec.yaml'),
      'utf8',
    );
    expect(spec).toMatch(/^format: analyzr-spec\/1\n/);
    expect(spec).not.toMatch(/derived|losses/);
    expect(spec).toContain('      - source: p1-s2\n        name: Versand\n');
    expect(spec).toContain('      - from: p0-s14\n        to: p1-s4\n        source: p0-s35\n');
  });

  it('read the AML export, its DOCTYPE skipped and its entity left as written', async () => {
    const ws = await workspace();
    const conv = await fixtureConverter(ws, 'aris-epk.js');
    const result = await convertWith(ws, await arisExport(ws), conv, {
      derived: 'reconstructed',
      llmModel: 'claude-opus-5-5',
    });
    expect(result.record).toMatchObject({
      derived: { kind: 'reconstructed', llmModel: 'claude-opus-5-5' },
      systemVersion: 'ARIS 10.0.24',
      reads: { files: 1, of: 1, entries: 0 },
      specs: [
        {
          file: 'vertrieb/auftragsabwicklung.spec.yaml',
          externalPath: 'Vertrieb/Auftragsabwicklung',
          externalId: '0f6c2a9e-1b7d-4e5a-9c11-000000001001',
          // the organizational unit and its connection
          losses: [{ code: 'element-dropped', count: 2 }],
        },
        {
          file: 'vertrieb/finanzen/bonitaetspruefung.spec.yaml',
          externalPath: 'Vertrieb/Finanzen/Bonitätsprüfung',
          externalId: '0f6c2a9e-1b7d-4e5a-9c11-000000001003',
          losses: [],
        },
      ],
      skipped: [
        {
          path: 'Export_Vertrieb.xml',
          reason: 'model "Prozesslandkarte" (MT_VAL_ADD_CHN_DGM) is no EPC',
        },
      ],
    });
    const epc = await readFile(
      path.join(result.outDir, 'vertrieb', 'auftragsabwicklung.spec.yaml'),
      'utf8',
    );
    // one definition, two occurrences: two end events of their own
    expect(epc.match(/name: Kunde informiert/g)).toHaveLength(2);
    expect(epc).toContain('source: ObjOcc.8\n        type: end');
    expect(epc).toContain('source: ObjOcc.11\n        type: end');
    expect(epc).toContain(
      'documentation: Vom Auftragseingang bis zur Bestätigung & Information des Kunden.',
    );
    const boni = await readFile(
      path.join(result.outDir, 'vertrieb', 'finanzen', 'bonitaetspruefung.spec.yaml'),
      'utf8',
    );
    expect(boni).toContain('Prüft die Bonität eines Kunden der &firma;.');
  });

  it('give the same specs and record on every run, and keep the copy once', async () => {
    const ws = await workspace();
    const exported = await visioExport(ws);
    const conv = await fixtureConverter(ws, 'visio-bpmn.js');
    const first = await convertWith(ws, exported, conv, { out: path.join(ws, 'specs', 'a') });
    const second = await convertWith(ws, exported, conv, { out: path.join(ws, 'specs', 'b') });
    expect(second.record).toEqual(first.record);
    expect((await readdir(path.join(ws, 'converters'))).sort()).toEqual([
      `adhoc-${conv.sha256.slice(0, 12)}.js`,
      'visio-bpmn.js',
    ]);
    // the copy itself may be run: same bytes, same id
    const copy = { file: path.join(ws, first.record.converter.file), sha256: conv.sha256 };
    const third = await convertWith(ws, exported, copy, { out: path.join(ws, 'specs', 'c') });
    expect(third.record.converter).toEqual({
      ...first.record.converter,
      workingCopy: first.record.converter.file,
    });
  });
});

describe('the example converters beyond their fixtures', () => {
  /** `text` with `from` replaced once (the edit must find it). */
  const swap = (from: string, to: string) => (text: string) => {
    if (!text.includes(from)) throw new Error(`no ${from}`);
    return text.replace(from, to);
  };

  it('Visio: an untriggered intermediate event, a reference that fans out, pages in another order and named otherwise', async () => {
    const ws = await workspace();
    const dir = path.join(ws, 'exports', VISIO);
    await mkdir(path.join(dir, 'Vertrieb'), { recursive: true });
    await mkdir(path.join(dir, 'Service'), { recursive: true });
    const parts = path.join(CONVERTER_FIXTURES, 'visio');
    await writeFile(
      path.join(dir, 'Vertrieb', 'Prozesse.vsdx'),
      await zipFolder(path.join(parts, 'prozesse'), {
        // the continuation first, named with a "/" in NameU and otherwise in Name
        'visio/pages/pages.xml': (text) => {
          const lines = text.split('\n');
          const versand = lines.findIndex((l) => l.includes('ID="1"'));
          const [page] = lines.splice(versand, 1);
          lines.splice(
            2,
            0,
            (page ?? '').replace(
              'NameU="Auftragsabwicklung – Versand" Name="Auftragsabwicklung – Versand"',
              'NameU="Auftragsabwicklung / Versand" Name="Versand (Auftrag)"',
            ),
          );
          return lines.join('\n');
        },
        // the reference names the page by its Name
        'visio/pages/page1.xml': swap('V="Auftragsabwicklung – Versand"', 'V="Versand (Auftrag)"'),
        // the partner reference leads to two shapes
        'visio/pages/page2.xml': (text) =>
          swap(
            '<Shape ID="7" Master="20"/>',
            '<Shape ID="7" Master="20"/>\n    <Shape ID="9" Master="20"/>',
          )(
            swap(
              '</Connects>',
              '  <Connect FromSheet="9" FromCell="BeginX" ToSheet="3" ToCell="PinX"/>\n    <Connect FromSheet="9" FromCell="EndX" ToSheet="5" ToCell="PinX"/>\n  </Connects>',
            )(text),
          ),
      }),
    );
    await writeFile(
      path.join(dir, 'Service', 'Reklamation.vsdx'),
      await zipFolder(path.join(parts, 'reklamation'), {
        // an intermediate event without shape data between the credit note and the end
        'visio/pages/page1.xml': (text) =>
          swap(
            '<Connect FromSheet="14" FromCell="EndX" ToSheet="6" ToCell="PinX"/>',
            '<Connect FromSheet="14" FromCell="EndX" ToSheet="7" ToCell="PinX"/>\n    <Connect FromSheet="16" FromCell="BeginX" ToSheet="7" ToCell="PinX"/>\n    <Connect FromSheet="16" FromCell="EndX" ToSheet="6" ToCell="PinX"/>',
          )(
            swap(
              '<Shape ID="10" Master="20"/>',
              '<Shape ID="7" Master="9"><Cell N="PinX" V="4.5"/><Cell N="PinY" V="6"/><Text>Gutschrift gebucht</Text></Shape>\n    <Shape ID="10" Master="20"/>\n    <Shape ID="16" Master="20"/>',
            )(text),
          ),
      }),
    );
    const conv = await fixtureConverter(ws, 'visio-bpmn.js');
    const result = await convertWith(ws, dir, conv);
    expect(result.record.failed).toEqual([]);
    // named after the page the chain starts on, whatever the order of the pages
    expect(result.record.specs.map((s) => s.externalPath)).toEqual([
      'Service/Reklamation/Reklamation',
      'Vertrieb/Prozesse/Auftragsabwicklung',
    ]);
    const order = await readFile(
      path.join(result.outDir, 'vertrieb', 'prozesse', 'auftragsabwicklung.spec.yaml'),
      'utf8',
    );
    expect(order).toContain(
      '      - from: p0-s14\n        to: p1-s4\n        source: p0-s35-p1-s6\n',
    );
    expect(order).toContain(
      '      - from: p0-s14\n        to: p1-s5\n        source: p0-s35-p1-s9\n',
    );
    const claim = await readFile(
      path.join(result.outDir, 'service', 'reklamation', 'reklamation.spec.yaml'),
      'utf8',
    );
    expect(claim).toContain(
      '      - source: p0-s7\n        type: event\n        name: Gutschrift gebucht\n        direction: throw\n        trigger: none\n',
    );
  });

  it('ARIS: an EPC without elements is skipped, styled and mixed text reads in order', async () => {
    const ws = await workspace();
    const dir = path.join(ws, 'exports', ARIS);
    await mkdir(dir, { recursive: true });
    const aml = await readFile(
      path.join(CONVERTER_FIXTURES, 'aris', 'Export_Vertrieb.xml'),
      'utf8',
    );
    const edited = [
      swap(
        '<AttrValue LocaleId="1031">Vom Auftragseingang bis zur Bestätigung &amp; Information des Kunden.</AttrValue>',
        '<AttrValue LocaleId="1031"><StyledElement><StyledElement><PlainText TextValue="Vom Auftragseingang "/><PlainText TextValue="bis zur Bestätigung."/></StyledElement></StyledElement></AttrValue>',
      ),
      swap(
        '<AttrValue LocaleId="1031">Auftrag bestätigen</AttrValue>',
        '<AttrValue LocaleId="1031">Auftrag <i>schriftlich</i> bestätigen</AttrValue>',
      ),
      swap(
        '<Model Model.ID="Model.landkarte"',
        '<Model Model.ID="Model.leer" Model.Type="MT_EEPC"><AttrDef AttrDef.Type="AT_NAME"><AttrValue LocaleId="1031">Entwurf</AttrValue></AttrDef></Model>\n      <Model Model.ID="Model.landkarte"',
      ),
    ].reduce((text, edit) => edit(text), aml);
    await writeFile(path.join(dir, 'Export_Vertrieb.xml'), edited);
    const conv = await fixtureConverter(ws, 'aris-epk.js');
    const result = await convertWith(ws, dir, conv, {
      derived: 'reconstructed',
      llmModel: 'claude-opus-5-5',
    });
    expect(result.record.failed).toEqual([]);
    expect(result.record.skipped).toContainEqual({
      path: 'Export_Vertrieb.xml',
      reason: 'EPC "Entwurf" has no functions, events or rules',
    });
    const epc = await readFile(
      path.join(result.outDir, 'vertrieb', 'auftragsabwicklung.spec.yaml'),
      'utf8',
    );
    expect(epc).toContain('documentation: Vom Auftragseingang bis zur Bestätigung.');
    expect(epc).toContain('name: Auftrag schriftlich bestätigen');
  });
});

describe('D3 for converter output', () => {
  it('(a) no field and no type can become a calledElement', async () => {
    const ws = await workspace();
    const conv = await converter(
      ws,
      'calls.js',
      returning(`{ models: [
        { source: { externalPath: 'A/Feld' }, processes: [{ source: 'p', nodes: [{ source: 'c', type: 'call', target: 'X', calledElement: 'Process_x' }] }] },
        { source: { externalPath: 'A/Typ' }, processes: [{ source: 'p', nodes: [{ source: 'c', type: 'callActivity', name: 'X' }] }] },
        ${model('A/Gut')},
      ] }`),
    );
    const result = await convertWith(ws, await plainExport(ws, { 'a.txt': 'a' }), conv);
    expect(result.record.failed).toEqual([
      {
        model: 0,
        externalPath: 'A/Feld',
        errors: [
          'models[0]: processes[0].nodes[0].calledElement: unknown field (a call names its target with "target"; analyzr never writes calledElement from a spec)',
        ],
        errorCount: 1,
      },
      {
        model: 1,
        externalPath: 'A/Typ',
        errors: [
          expect.stringMatching(
            /^models\[1\]: processes\[0\]\.nodes\[0\]\.type: unknown type "callActivity"/,
          ) as string,
        ],
        errorCount: 1,
      },
    ]);
    expect(result.record.specs.map((s) => s.externalPath)).toEqual(['A/Gut']);
  });

  it('(b, c) calls render as collapsed subprocesses with link-unresolved; the manifest says converted or reconstructed with adhoc:<12 hex>', async () => {
    const ws = await workspace();
    const visio = await fixtureConverter(ws, 'visio-bpmn.js');
    const aris = await fixtureConverter(ws, 'aris-epk.js');
    const visioRun = await convertWith(ws, await visioExport(ws), visio, {
      out: path.join(ws, 'specs', VISIO),
    });
    const arisRun = await convertWith(ws, await arisExport(ws), aris, {
      out: path.join(ws, 'specs', ARIS),
      derived: 'reconstructed',
      llmModel: 'claude-opus-5-5',
    });
    const v = await bundled(ws, visioRun.outDir, 'visio');
    const a = await bundled(ws, arisRun.outDir, 'aris');
    const visioId = `adhoc:${visio.sha256.slice(0, 12)}`;
    const arisId = `adhoc:${aris.sha256.slice(0, 12)}`;

    for (const { result } of [v, a]) {
      expect(ManifestSchema.safeParse(result.manifest).success).toBe(true);
      expect(result.failed).toEqual([]);
    }
    expect(v.result.manifest.source).toMatchObject({
      system: 'visio',
      systemVersion: 'Visio 16.0',
      importer: { name: 'analyzr-integrate/analyzr-spec', version: '0.1.0' },
    });
    expect(a.result.manifest.source.systemVersion).toBe('ARIS 10.0.24');
    expect(v.result.manifest.files.map((f) => [f.key, f.derived])).toEqual([
      [
        'service/reklamation/reklamation',
        { kind: 'converted', converter: visioId, llmModel: null, from: [] },
      ],
      [
        'vertrieb/prozesse/auftragsabwicklung',
        { kind: 'converted', converter: visioId, llmModel: null, from: [] },
      ],
    ]);
    expect(a.result.manifest.files.map((f) => [f.key, f.externalId, f.derived])).toEqual([
      [
        'vertrieb/auftragsabwicklung',
        '0f6c2a9e-1b7d-4e5a-9c11-000000001001',
        { kind: 'reconstructed', converter: arisId, llmModel: 'claude-opus-5-5', from: [] },
      ],
      [
        'vertrieb/finanzen/bonitaetspruefung',
        '0f6c2a9e-1b7d-4e5a-9c11-000000001003',
        { kind: 'reconstructed', converter: arisId, llmModel: 'claude-opus-5-5', from: [] },
      ],
    ]);
    // the converter's losses and the renderer's, summed per code
    const order = v.result.manifest.files.find(
      (f) => f.key === 'vertrieb/prozesse/auftragsabwicklung',
    );
    expect(order?.losses?.map((l) => l.code)).toEqual([
      'element-dropped',
      'layout-generated',
      'link-unresolved',
    ]);
    expect(order?.losses?.[0]).toEqual({ code: 'element-dropped', count: 4 });
    expect(order?.losses?.[2]).toEqual({ code: 'link-unresolved', count: 1 });
    expect(v.result.files.flatMap((f) => f.calls.map((c) => c.target))).toEqual([
      'Bonitätsprüfung',
    ]);
    expect(a.result.files.flatMap((f) => f.calls.map((c) => c.target))).toEqual([
      'Bonitätsprüfung',
    ]);

    for (const { result, out } of [v, a]) {
      for (const f of result.manifest.files) {
        const xml = await readFile(path.join(out, ...f.path.split('/')), 'utf8');
        expect(structureProblems(xml), f.key).toEqual([]);
        const { definitions, warnings } = await parseRendered(xml);
        expect(warnings, f.key).toEqual([]);
        expect(walkProblems(definitions), f.key).toEqual([]);
        expect(diProblems(definitions), f.key).toEqual([]);
        const facts = await extractFacts(xml, { modelKey: f.key });
        expect(facts.warnings, f.key).toEqual([]);
        expect(
          facts.facts.filter((x) => x.kind === 'call'),
          f.key,
        ).toEqual([]);
      }
    }
    // the shape data's message names reach the facts (key tier), not just the labels
    const xml = await readFile(
      path.join(v.out, 'vertrieb/prozesse/auftragsabwicklung.bpmn'),
      'utf8',
    );
    const facts = await extractFacts(xml, { modelKey: 'vertrieb/prozesse/auftragsabwicklung' });
    expect(
      facts.facts
        .filter((f) => f.kind === 'msg_catch' || f.kind === 'msg_throw')
        .map((f) => `${f.kind} ${f.keyRaw}`)
        .sort(),
    ).toEqual(['msg_catch Auftrag', 'msg_throw Auftragsbestätigung']);
  });
});

describe('the run record at analyzr-spec', () => {
  async function converted() {
    const ws = await workspace();
    const conv = await fixtureConverter(ws, 'visio-bpmn.js');
    const run = await convertWith(ws, await visioExport(ws), conv, {
      out: path.join(ws, 'specs', VISIO),
    });
    return { ws, conv, specs: run.outDir, copy: path.join(ws, run.record.converter.file) };
  }
  const plan = (ws: string | undefined, specs: string) =>
    planSpecFolder(emptyKeymap(), specs, { system: 'visio' }, undefined, ws);

  it('validates the specs it lists as converter output and the others as written by the agent', async () => {
    const { ws, specs } = await converted();
    await writeFile(
      path.join(specs, 'bild.spec.yaml'),
      [
        'format: analyzr-spec/1',
        'source: { externalPath: Service/Bild }',
        'derived: { kind: reconstructed, llmModel: claude-opus-5-5 }',
        'processes:',
        '  - source: p',
        '    nodes: [{ source: s, type: start, name: Los }, { source: e, type: end, name: Fertig }]',
        '    flows: [{ from: s, to: e }]',
        '',
      ].join('\n'),
    );
    const scanned = await scanSpecs(specs);
    expect(scanned.recordProblem).toBeNull();
    expect(scanned.specs.map((s) => [s.file, s.errors, s.recorded === null])).toEqual([
      ['bild.spec.yaml', [], true],
      ['service/reklamation/reklamation.spec.yaml', [], false],
      ['vertrieb/prozesse/auftragsabwicklung.spec.yaml', [], false],
    ]);
    const { result } = await bundled(ws, specs, 'visio');
    expect(result.manifest.files.map((f) => [f.key, f.derived.kind, f.derived.converter])).toEqual([
      ['service/bild', 'reconstructed', null],
      [
        'service/reklamation/reklamation',
        'converted',
        `adhoc:${scanned.record?.converter.sha256.slice(0, 12) ?? ''}`,
      ],
      [
        'vertrieb/prozesse/auftragsabwicklung',
        'converted',
        `adhoc:${scanned.record?.converter.sha256.slice(0, 12) ?? ''}`,
      ],
    ]);
  });

  it('refuses a spec edited after the run', async () => {
    const { ws, specs } = await converted();
    const file = path.join(specs, 'service', 'reklamation', 'reklamation.spec.yaml');
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace('Reklamation prüfen', 'Reklamation sichten'),
    );
    const err = (await plan(ws, specs).catch((e: unknown) => e)) as SpecBundleError;
    expect(err).toBeInstanceOf(SpecBundleError);
    expect(err.code).toBe('invalid-specs');
    expect(err.message).toMatch(
      /service\/reklamation\/reklamation\.spec\.yaml: changed after converter adhoc:[0-9a-f]{12} wrote it: never edit a converter's spec; fix the converter and run it again into a new folder/,
    );
  });

  it('refuses a record whose copy is missing, changed or a link, or that cannot be read', async () => {
    const missing = await converted();
    await rm(missing.copy);
    await expect(plan(missing.ws, missing.specs)).rejects.toMatchObject({
      code: 'run-record',
      message: expect.stringMatching(
        /^analyzr-specs\.json: converter adhoc:[0-9a-f]{12} not found in converters\/ \(converters\/adhoc-[0-9a-f]{12}\.js: missing\); run analyzr-convert again$/,
      ) as unknown,
    });

    const changed = await converted();
    await writeFile(changed.copy, '// other bytes\n');
    await expect(plan(changed.ws, changed.specs)).rejects.toMatchObject({
      code: 'run-record',
      message: expect.stringMatching(
        /converter adhoc:[0-9a-f]{12} changed in converters\//,
      ) as unknown,
    });

    const linked = await converted();
    const elsewhere = path.join(linked.ws, 'elsewhere.js');
    await writeFile(elsewhere, await readFile(linked.copy));
    await rm(linked.copy);
    await symlink(elsewhere, linked.copy);
    await expect(plan(linked.ws, linked.specs)).rejects.toMatchObject({
      code: 'run-record',
      message: expect.stringMatching(/a symbolic link/) as unknown,
    });

    const hard = await converted();
    await link(hard.copy, path.join(hard.ws, 'second-name.js'));
    await expect(plan(hard.ws, hard.specs)).rejects.toMatchObject({
      message: expect.stringMatching(/a hard link/) as unknown,
    });

    const noWorkspace = await converted();
    await expect(plan(undefined, noWorkspace.specs)).rejects.toMatchObject({ code: 'run-record' });

    const forged = await converted();
    const recordFile = path.join(forged.specs, 'analyzr-specs.json');
    const record = JSON.parse(await readFile(recordFile, 'utf8')) as { converter: { id: string } };
    record.converter.id = 'adhoc:000000000000';
    await writeFile(recordFile, JSON.stringify(record));
    await expect(plan(forged.ws, forged.specs)).rejects.toMatchObject({
      code: 'run-record',
      message: expect.stringMatching(
        /converter\.id: expected adhoc:[0-9a-f]{12}, the first 12 hex characters of converter\.sha256/,
      ) as unknown,
    });
    await writeFile(recordFile, 'kein JSON');
    await expect(plan(forged.ws, forged.specs)).rejects.toMatchObject({
      message: expect.stringMatching(/^analyzr-specs\.json: not valid JSON in UTF-8/) as unknown,
    });
  });

  it('reads the record strictly in what analyzr-spec relies on', () => {
    const sha = 'a'.repeat(64);
    const base = {
      format: 'analyzr-specs/1',
      converter: {
        id: `adhoc:${sha.slice(0, 12)}`,
        sha256: sha,
        file: `converters/adhoc-${sha.slice(0, 12)}.js`,
        workingCopy: 'converters/x.js',
      },
      derived: { kind: 'converted', llmModel: null },
      systemVersion: null,
      specs: [
        { file: 'a.spec.yaml', sha256: sha, losses: [{ code: 'element-dropped', count: 2 }] },
      ],
    };
    expect(readRunRecord(base)).toMatchObject({
      specs: [{ file: 'a.spec.yaml', losses: [{ code: 'element-dropped', count: 2 }] }],
    });
    const broken = (patch: Record<string, unknown>): unknown =>
      readRunRecord({ ...base, ...patch });
    expect(broken({ format: 'analyzr-specs/2' })).toBe('format: expected "analyzr-specs/1"');
    expect(broken({ converter: { ...base.converter, file: 'converters/x.js' } })).toMatch(
      /^converter\.file: expected converters\/adhoc-a{12}\.js$/,
    );
    expect(broken({ derived: { kind: 'export', llmModel: null } })).toMatch(/^derived\.kind/);
    expect(broken({ derived: { kind: 'converted', llmModel: 'x' } })).toBe(
      'derived.llmModel: null for converted',
    );
    expect(broken({ derived: { kind: 'reconstructed', llmModel: '' } })).toMatch(
      /^derived\.llmModel/,
    );
    // what the manifest could not declare: a model id with a control character, an untidy version
    expect(broken({ derived: { kind: 'reconstructed', llmModel: 'claude\u0007' } })).toBe(
      'derived.llmModel: the model the agent runs as, 1 to 120 characters without control characters',
    );
    expect(broken({ derived: { kind: 'reconstructed', llmModel: 'x'.repeat(121) } })).toMatch(
      /^derived\.llmModel/,
    );
    for (const systemVersion of [' Visio 16.0', 'Visio\u000016', 'v'.repeat(101), 7]) {
      expect(broken({ systemVersion }), String(systemVersion)).toBe(
        'systemVersion: expected null or a tidy string of at most 100 characters, as analyzr-convert writes it',
      );
    }
    expect(readRunRecord({ ...base, systemVersion: 'Visio 16.0' })).toMatchObject({
      systemVersion: 'Visio 16.0',
    });
    expect(broken({ specs: [base.specs[0], base.specs[0]] })).toMatch(/^specs\[1\]\.file/);
    expect(broken({ specs: [{ ...base.specs[0], losses: [{ code: 'Bad', count: 1 }] }] })).toMatch(
      /^specs\[0\]\.losses\[0\]\.code/,
    );
  });
});

describe('a run record that cannot be read', () => {
  it('is one folder error: the specs are not checked as written by the agent', async () => {
    const ws = await workspace();
    const conv = await fixtureConverter(ws, 'visio-bpmn.js');
    const run = await convertWith(ws, await visioExport(ws), conv, {
      out: path.join(ws, 'specs', VISIO),
    });
    await truncate(run.recordFile, 16 * 1024 * 1024 + 1);
    const scanned = await scanSpecs(run.outDir);
    expect(scanned.recordProblem).toBe(
      'analyzr-specs.json: larger than 16777216 bytes, which analyzr-convert never writes',
    );
    expect(scanned.specs.map((s) => [s.file, s.spec, s.errors])).toEqual([
      ['service/reklamation/reklamation.spec.yaml', null, []],
      ['vertrieb/prozesse/auftragsabwicklung.spec.yaml', null, []],
    ]);
    expect(
      compactValidation(scanned.specs, scanned.skipped, [scanned.recordProblem ?? '']),
    ).toMatchObject({
      specs: 2,
      valid: 0,
      errors: {
        count: 1,
        items: [
          'analyzr-specs.json: larger than 16777216 bytes, which analyzr-convert never writes',
        ],
      },
    });
    await expect(
      planSpecFolder(emptyKeymap(), run.outDir, { system: 'visio' }, undefined, ws),
    ).rejects.toMatchObject({
      code: 'run-record',
      message:
        "analyzr-specs.json: larger than 16777216 bytes, which analyzr-convert never writes: the specs a converter wrote are read with their run's record only; run analyzr-convert again",
    });
  });
});

describe('a converter result', () => {
  it('writes the valid models and lists every invalid one with its errors (exit 1)', async () => {
    const ws = await workspace();
    const conv = await converter(
      ws,
      'mixed.js',
      returning(`{ models: [
        ${model('A/Eins')},
        { ...${model('A/Abgeleitet')}, derived: { kind: 'reconstructed', llmModel: 'x' } },
        ${model('A/Zwei', ", losses: [{ code: 'element-dropped', count: 3 }, { code: 'element-dropped', count: 1 }]")},
        ${model('A/Drei', ", losses: [{ code: 'Element', count: 1 }]")},
        'kein Modell',
        { ...${model('A/Vier')}, source: { externalPath: 'A/Vier', externalId: 'ID-1' } },
        { ...${model('A/Fuenf')}, source: { externalPath: 'A/Fuenf', externalId: 'ID-1' } },
        { ...${model('A/Eins')}, processes: [{ source: 'q', name: 'Q', nodes: [{ source: 's', type: 'start', name: 'Los' }] }] },
        ${model('A/Sechs', ", losses: [{ code: 'element-dropped', count: 2 }, { code: 'attribute-dropped', count: 0 }]")},
        ${model('A/Sechs', ", losses: [{ code: 'element-dropped', count: 2 }, { code: 'attribute-dropped', count: 0 }]")},
        ${model('A/Sieben')},
      ] }`),
    );
    const result = await convertWith(ws, await plainExport(ws, { 'a.txt': 'a' }), conv);
    expect(result.record.specs.map((s) => [s.externalPath, s.losses])).toEqual([
      ['A/Sechs', [{ code: 'element-dropped', count: 2 }]],
      ['A/Sieben', []],
    ]);
    // a model returned twice byte for byte (overlapping export files) is kept once
    expect(result.record.duplicates).toEqual([{ model: 9, of: 8 }]);
    const failure = (model: number, externalPath: string | null, error: string) => ({
      model,
      externalPath,
      errors: [error],
      errorCount: 1,
    });
    // a tool path or tool id two models share fails both: neither is known to be the right one
    expect(result.record.failed).toEqual([
      failure(
        0,
        'A/Eins',
        "models[0].source.externalPath: also models[7]'s; write one model per tool path",
      ),
      failure(
        1,
        'A/Abgeleitet',
        'models[1]: derived: set by analyzr-convert --derived; a converter does not declare its derivation',
      ),
      failure(2, 'A/Zwei', 'models[2]: losses[1].code: element-dropped appears twice'),
      failure(3, 'A/Drei', 'models[3]: losses[0].code: a lowercase slug such as element-dropped'),
      failure(4, null, 'models[4]: expected an analyzr-spec/1 mapping'),
      failure(
        5,
        'A/Vier',
        "models[5].source.externalId: also models[6]'s; an externalId identifies one model",
      ),
      failure(
        6,
        'A/Fuenf',
        "models[6].source.externalId: also models[5]'s; an externalId identifies one model",
      ),
      failure(
        7,
        'A/Eins',
        "models[7].source.externalPath: also models[0]'s; write one model per tool path",
      ),
    ]);
    expect(compactConvert(result)).toMatchObject({
      counts: { models: 2, failed: 8, duplicates: 1 },
    });
  });

  it("keeps the first lines of a model's warnings and errors in the record, with their counts", async () => {
    const ws = await workspace();
    const loose = Array.from(
      { length: 12 },
      (_, i) => `{ source: 't${i}', type: 'task', name: 'Aufgabe ${i}' }`,
    ).join(', ');
    const conv = await converter(
      ws,
      'many.js',
      returning(`{ models: [
        { source: { externalPath: 'A/Lose' }, processes: [{ source: 'p', name: 'P', nodes: [${loose}] }] },
        { source: { externalPath: 'A/Kaputt' }, processes: [{ source: 'p', nodes: [${Array.from({ length: 8 }, (_, i) => `{ source: 'x${i}', type: 'gibtsnicht' }`).join(', ')}] }] },
      ] }`),
    );
    const result = await convertWith(ws, await plainExport(ws, { 'a.txt': 'a' }), conv);
    const [spec] = result.record.specs;
    // 12 tasks without flows, no start, no end
    expect(spec?.warningCount).toBe(14);
    expect(spec?.warnings).toHaveLength(5);
    const [failed] = result.record.failed;
    expect(failed?.errorCount).toBeGreaterThanOrEqual(8);
    expect(failed?.errors).toHaveLength(5);
    expect(compactConvert(result)).toMatchObject({
      warnings: 14,
      files: { items: [{ file: 'a/lose.spec.yaml', warnings: 14 }] },
    });
  });

  it('writes nothing when the run record would be larger than analyzr-spec reads', async () => {
    const ws = await workspace();
    const conv = await converter(
      ws,
      'record.js',
      returning(`{ models: [${model('A/Eins')}, ${model('A/Zwei')}, ${model('A/Drei')}] }`),
    );
    const out = path.join(ws, 'specs', 'gross');
    const err = await refusal(
      convertWith(ws, await plainExport(ws, { 'a.txt': 'a' }), conv, {
        out,
        limits: { recordBytes: 1000 },
      }),
    );
    expect(err.code).toBe('result');
    expect(err.message).toMatch(
      /^the run record would have \d+ bytes; analyzr-spec reads one of at most 1000: run the converter on one folder or file of the export at a time, each into its own --out$/,
    );
    expect(await readdir(out).catch(() => [])).toEqual([]);
  });

  it('lists a model whose spec would be larger than a spec may be', async () => {
    const ws = await workspace();
    const conv = await converter(
      ws,
      'gross.js',
      returning(
        `{ models: [{ source: { externalPath: 'A/Gross' }, processes: [{ source: 'p', documentation: 'x'.repeat(2200000), nodes: [{ source: 's', type: 'start', name: 'Los' }] }] }] }`,
      ),
    );
    const result = await convertWith(ws, await plainExport(ws, { 'a.txt': 'a' }), conv);
    expect(result.record.specs).toEqual([]);
    expect(result.record.failed).toEqual([
      {
        model: 0,
        externalPath: 'A/Gross',
        errors: [
          expect.stringMatching(
            /^models\[0\]: \d+ bytes; a spec holds one model in at most 2097152 bytes$/,
          ) as string,
        ],
        errorCount: 1,
      },
    ]);
  });

  it('names its spec files after the tool paths, with -2 for a clash', async () => {
    const ws = await workspace();
    const conv = await converter(
      ws,
      'names.js',
      returning(
        `{ models: [${model('Vertrieb/Auftrag (neu)')}, ${model('Vertrieb/Auftrag neu')}, ${model('???')}] }`,
      ),
    );
    const result = await convertWith(ws, await plainExport(ws, { 'a.txt': 'a' }), conv);
    expect(result.record.specs.map((s) => s.file)).toEqual([
      'vertrieb/auftrag-neu.spec.yaml',
      'vertrieb/auftrag-neu-2.spec.yaml',
      'model.spec.yaml',
    ]);
  });

  it('fails the run when the result is no object with a list of models, or a field is wrong', async () => {
    const cases: [string, RegExp][] = [
      ['undefined', /^converter adhoc:[0-9a-f]{12}: run 1: convert returned nothing$/],
      ['null', /^convert returned no object/],
      ['[]', /^convert returned no object/],
      ["{ models: 'x' }", /^convert's result has no list models$/],
      ['{ models: [], extra: 1 }', /^convert's result has the unknown field "extra"/],
      ["{ models: [], skipped: [{ path: 'a' }] }", /^skipped\[0\]: expected \{ path, reason \}/],
      ['{ models: [], systemVersion: 7 }', /^systemVersion: expected a string or null$/],
    ];
    for (const [result, message] of cases) {
      const ws = await workspace();
      const conv = await converter(ws, 'bad.js', returning(result));
      const err = await refusal(convertWith(ws, await plainExport(ws, { 'a.txt': 'a' }), conv));
      expect(err.message, result).toMatch(message);
      expect(await readdir(path.join(ws, 'specs')).catch(() => []), result).toEqual([]);
    }
  });

  it('fails the run on a converter error: compile errors and throws with their line', async () => {
    const ws = await workspace();
    const exported = await plainExport(ws, { 'a.txt': 'a' });
    const syntax = await converter(ws, 'syntax.js', 'function convert(input) {\n  return {\n');
    expect((await refusal(convertWith(ws, exported, syntax))).message).toMatch(
      /^converter adhoc:[0-9a-f]{12}: the converter does not compile: Unexpected end of input \(converter\.js:3\)$/,
    );
    const thrower = await converter(
      ws,
      'throws.js',
      'function convert(input) {\n  throw new TypeError("Seite fehlt");\n}\n',
    );
    const err = await refusal(convertWith(ws, exported, thrower));
    expect(err.code).toBe('converter-error');
    expect(err.message).toMatch(
      /run 1: TypeError: Seite fehlt \(at convert \(converter\.js:2:9\)\)$/,
    );
    const top = await converter(ws, 'top.js', 'undefinedHelper();\nfunction convert() {}\n');
    expect((await refusal(convertWith(ws, exported, top))).message).toMatch(
      /run 1: ReferenceError: undefinedHelper is not defined \(at converter\.js:1:1\)$/,
    );
    const none = await converter(ws, 'none.js', 'function konvertiere() {}\n');
    expect((await refusal(convertWith(ws, exported, none))).message).toMatch(
      /run 1: the converter defines no function convert\(input, helpers\)$/,
    );
    const promise = await converter(
      ws,
      'async.js',
      'async function convert() { return { models: [] }; }\n',
    );
    expect((await refusal(convertWith(ws, exported, promise))).message).toMatch(
      /convert returned a Promise: a converter is synchronous$/,
    );
    const helperError = await converter(ws, 'helper.js', returning("helpers.text('fehlt.txt')"));
    expect((await refusal(convertWith(ws, exported, helperError))).message).toMatch(
      /run 1: Error: no file "fehlt.txt" in input.files \(at convert \(converter\.js:2:18\)\)$/,
    );
  });
});

describe('the refusals before a converter runs', () => {
  /** A workspace with an export and a converter that would succeed. */
  async function ready() {
    const ws = await workspace();
    const exported = await plainExport(ws, { 'a.txt': 'a' });
    const conv = await converter(ws, 'ok.js', returning(`{ models: [${model('A/Eins')}] }`));
    return { ws, exported, conv };
  }
  /** Nothing was written: no copy, no spec folder. */
  async function untouched(ws: string): Promise<void> {
    expect(
      (await readdir(path.join(ws, 'converters'))).filter((f) => f.startsWith('adhoc-')),
    ).toEqual([]);
    expect(await readdir(path.join(ws, 'specs')).catch(() => [])).toEqual([]);
  }

  it('refuses another sha256 than the approved one: a changed converter is a new question', async () => {
    const { ws, exported, conv } = await ready();
    const err = await refusal(convertWith(ws, exported, conv, { sha256: 'b'.repeat(64) }));
    expect(err.code).toBe('sha256');
    expect(err.message).toBe(
      `--converter ${conv.file} has the sha256 ${conv.sha256}, not the approved ${'b'.repeat(64)}: it changed after the consultant approved it; show the new version and ask again`,
    );
    // changed after the consultant saw its hash
    await writeFile(conv.file, returning('{ models: [] }'));
    expect((await refusal(convertWith(ws, exported, conv))).code).toBe('sha256');
    await expect(convertWith(ws, exported, conv, { sha256: 'xyz' })).rejects.toMatchObject({
      code: 'sha256',
    });
    await untouched(ws);
  });

  it('refuses a converter outside converters/, a link, a second name, more than 1 MB, not UTF-8, or naming import', async () => {
    const { ws, exported } = await ready();
    const outside = path.join(ws, 'reports', 'x.js');
    await writeFile(outside, returning('{ models: [] }'));
    expect(
      (
        await refusal(
          convertWith(ws, exported, { file: outside, sha256: sha256(await readFile(outside)) }),
        )
      ).message,
    ).toMatch(/lies not in .*converters\/: write the converter there$/);
    const nested = path.join(ws, 'converters', 'sub', 'x.js');
    await mkdir(path.dirname(nested));
    await writeFile(nested, returning('{ models: [] }'));
    expect(
      (
        await refusal(
          convertWith(ws, exported, { file: nested, sha256: sha256(await readFile(nested)) }),
        )
      ).code,
    ).toBe('converter');

    const linked = path.join(ws, 'converters', 'link.js');
    await symlink(outside, linked);
    expect(
      (
        await refusal(
          convertWith(ws, exported, { file: linked, sha256: sha256(await readFile(outside)) }),
        )
      ).message,
    ).toMatch(/: a symbolic link$/);
    const second = await converter(ws, 'second.js', returning('{ models: [] }'));
    await link(second.file, path.join(ws, 'reports', 'second.js'));
    expect((await refusal(convertWith(ws, exported, second))).message).toMatch(/a hard link/);
    const big = await converter(
      ws,
      'big.js',
      `// ${'x'.repeat(1024 * 1024)}\nfunction convert() {}\n`,
    );
    expect((await refusal(convertWith(ws, exported, big))).message).toMatch(
      /larger than 1048576 bytes$/,
    );
    const latin1 = path.join(ws, 'converters', 'latin1.js');
    await writeFile(latin1, Buffer.from('// Prüfung\nfunction convert() {}\n', 'latin1'));
    expect(
      (
        await refusal(
          convertWith(ws, exported, { file: latin1, sha256: sha256(await readFile(latin1)) }),
        )
      ).message,
    ).toMatch(/is not UTF-8/);

    for (const source of [
      "function convert() { return import('node:fs'); }\n",
      "function convert() { return import /* x */ ('node:fs'); }\n",
      '// import the pages\nfunction convert() {}\n',
      "function convert() { return { models: [], skipped: [{ path: 'a', reason: 'import' }] }; }\n",
    ]) {
      const named = await converter(ws, 'import.js', source);
      const err = await refusal(convertWith(ws, exported, named));
      expect(err.code, source).toBe('import');
      expect(err.message).toMatch(
        /names import \(line \d\): a converter is a classic script that imports nothing, not even dynamically; leave the word out, also in comments and strings \(for an element named so, compare with 'im' \+ 'port'\)$/,
      );
    }
    // a longer word is no import
    const words = await converter(
      ws,
      'words.js',
      returning("{ models: [], skipped: [{ path: 'a', reason: 'imports, important, reimport' }] }"),
    );
    await expect(convertWith(ws, exported, words)).resolves.toBeDefined();
  });

  it('refuses an export outside the workspace exports/, a workspace without its file, and a wrong derivation', async () => {
    const { ws, conv } = await ready();
    const other = await workspace();
    const foreign = await plainExport(other, { 'a.txt': 'a' });
    expect((await refusal(convertWith(ws, foreign, conv))).message).toMatch(
      /lies not below .*exports: a converter reads one export of the workspace/,
    );
    expect((await refusal(convertWith(ws, path.join(ws, 'exports'), conv))).code).toBe('export');
    expect((await refusal(convertWith(ws, path.join(ws, 'reports'), conv))).code).toBe('export');
    await expect(
      convertWith(path.join(ws, 'reports'), path.join(ws, 'exports', '2026-10-14-test'), conv),
    ).rejects.toMatchObject({ code: 'workspace' });
    const exported = path.join(ws, 'exports', '2026-10-14-test');
    expect(
      (await refusal(convertWith(ws, exported, conv, { derived: 'reconstructed' }))).message,
    ).toMatch(/^--derived reconstructed needs --llm-model/);
    expect(
      (await refusal(convertWith(ws, exported, conv, { derived: 'converted', llmModel: 'x' })))
        .message,
    ).toMatch(/^--llm-model goes with --derived reconstructed only/);
    const empty = await plainExport(ws, {}, '2026-10-14-leer');
    expect((await refusal(convertWith(ws, empty, conv))).message).toMatch(
      /holds no file to convert$/,
    );
    await untouched(ws);
  });

  it('refuses an --out that is not empty, below exports/ or in a checkout', async () => {
    const { ws, exported, conv } = await ready();
    const full = path.join(ws, 'specs', 'voll');
    await mkdir(full, { recursive: true });
    await writeFile(path.join(full, 'alt.txt'), 'x');
    expect((await refusal(convertWith(ws, exported, conv, { out: full }))).code).toBe('out');
    await expect(
      convertWith(ws, exported, conv, { out: path.join(exported, 'specs') }),
    ).rejects.toBeInstanceOf(PathGuardError);
    await expect(
      convertWith(ws, exported, conv, { out: path.join(PACKAGE_ROOT, 'specs-x') }),
    ).rejects.toBeInstanceOf(PathGuardError);
    expect(
      (await readdir(path.join(ws, 'converters'))).filter((f) => f.startsWith('adhoc-')),
    ).toEqual([]);
  });

  it('gives a file over 64 MB to the converter unread, and refuses an export over 512 MB before reading it', async () => {
    const { ws } = await ready();
    const exported = await plainExport(
      ws,
      { 'gross.xml': '', 'klein.txt': 'k' },
      '2026-10-14-gross',
    );
    await truncate(path.join(exported, 'gross.xml'), 64 * 1024 * 1024 + 1);
    const conv = await converter(
      ws,
      'unread.js',
      probeConverter(`
  probe('files', () => JSON.stringify(input.files.map((f) => [f.path, f.size, f.sha256 === null, f.unread])));
  probe('read it', () => { try { helpers.bytes('gross.xml'); } catch (e) { return e.message; } });
  probe('the other', () => helpers.text('klein.txt'));
`),
    );
    const reason =
      '67108865 bytes; a converter reads files of at most 67108864 bytes (a large ARIS database: export it by group, each file under 64 MB)';
    const result = await convertWith(ws, exported, conv);
    expect(probeLines(result)).toEqual([
      `files -> ${JSON.stringify([
        ['gross.xml', 67108865, true, reason],
        ['klein.txt', 1, false, null],
      ])}`,
      `read it -> "gross.xml" was not read: ${reason}`,
      'the other -> k',
    ]);
    expect(result.record.unread).toEqual([{ path: 'gross.xml', reason }]);
    expect(result.record.reads).toEqual({ files: 1, of: 2, entries: 0 });
    expect(compactConvert(result)).toMatchObject({ counts: { unread: 1 } });

    const many = await plainExport(ws, { 'a.xml': '', 'b.xml': '' }, '2026-10-14-viele');
    await truncate(path.join(many, 'a.xml'), 60 * 1024 * 1024);
    await truncate(path.join(many, 'b.xml'), 60 * 1024 * 1024);
    const out = path.join(ws, 'specs', 'viele');
    const err = await refusal(
      convertWith(ws, many, conv, { out, limits: { totalBytes: 100 * 1024 * 1024 } }),
    );
    expect(err.code).toBe('too-large');
    expect(err.message).toBe(
      "the export's files have 125829120 bytes; a converter run reads at most 104857600: run the converter on one folder or file of the export at a time, each into its own --out",
    );
    expect(await readdir(out).catch(() => [])).toEqual([]);
  });

  it('refuses a copy with other bytes than the converter (before it runs)', async () => {
    const { ws, exported, conv } = await ready();
    await writeFile(
      path.join(ws, 'converters', `adhoc-${conv.sha256.slice(0, 12)}.js`),
      '// a different converter\n',
    );
    const err = await refusal(convertWith(ws, exported, conv));
    expect(err.code).toBe('copy');
    expect(err.message).toBe(
      `converters/adhoc-${conv.sha256.slice(0, 12)}.js exists with other bytes: the copy of a converter run is never changed; move it away only if no bundle was made from it`,
    );
    expect(await readdir(path.join(ws, 'specs')).catch(() => [])).toEqual([]);
  });

  it('points the child at the entry in source mode and at the bundle itself otherwise', () => {
    expect(childScript()).toBe(path.join(PACKAGE_ROOT, 'src', 'cli', 'analyzr-convert.ts'));
    expect(childScript('file:///plugin/scripts/analyzr-convert.mjs')).toBe(
      '/plugin/scripts/analyzr-convert.mjs',
    );
  });
});

describe('losses', () => {
  it('are read strictly and summed per code', () => {
    expect(readLosses(undefined)).toEqual({ losses: [] });
    expect(
      readLosses([
        { code: 'link-unresolved', count: 2 },
        { code: 'element-dropped', count: 1 },
      ]),
    ).toEqual({
      losses: [
        { code: 'element-dropped', count: 1 },
        { code: 'link-unresolved', count: 2 },
      ],
    });
    expect(readLosses(Array.from({ length: 17 }, (_, i) => ({ code: `c${i}`, count: 1 })))).toEqual(
      {
        problem: 'losses: at most 16 codes per model',
      },
    );
    expect(readLosses([{ code: 'a', count: 1.5 }])).toEqual({
      problem: 'losses[0].count: a whole number from 0 to 1000000000',
    });
    expect(readLosses([{ code: 'a', count: 1, note: 'x' }])).toEqual({
      problem: 'losses[0]: expected {code, count}',
    });
    expect(readLosses('x')).toEqual({ problem: 'losses: expected a list of {code, count}' });
    expect(
      sumLosses(
        [
          { code: 'link-unresolved', count: 1 },
          { code: 'layout-generated', count: 999_999_999 },
        ],
        [{ code: 'layout-generated', count: 5 }],
      ),
    ).toEqual([
      { code: 'layout-generated', count: 1_000_000_000 },
      { code: 'link-unresolved', count: 1 },
    ]);
  });
});
