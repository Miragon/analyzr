// The renderer of analyzr-spec/1 (src/spec/render.ts, M6 S3c §3.3, §3.7): the golden fixtures
// of test/fixtures/spec (rewrite them with ANALYZR_UPDATE_GOLDEN=1), the version pin
// RENDER_OUTPUTS, determinism, the facts analyzr extracts per golden, and done-when D1 and
// D3 (b) on the goldens and on seeded random specs.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { extractFacts, sanitizeBlock, sanitizeLine } from '@analyzr/bpmn-facts';
import { describe, expect, it } from 'vitest';

import { assignIds, capped, uniqueId } from '../src/spec/ids.ts';
import { MAX_SLOTS } from '../src/spec/layout.ts';
import { RenderError, renderSpec } from '../src/spec/render.ts';
import * as text from '../src/spec/text.ts';
import type { Spec } from '../src/spec/types.ts';
import { ANALYZR_SPEC_VERSION } from '../src/spec/version.ts';
import { parseSpecText } from '../src/spec/yaml.ts';

import { mulberry32 } from './spec-fuzz.ts';
import { parseRendered, structureProblems, walkProblems } from './spec-checks.ts';
import {
  FUZZ_COUNT,
  GOLDENS,
  goldenKey,
  goldenSpec,
  readFixture,
  renderFuzz,
  renderGolden,
  specOf,
  SPEC_FIXTURES,
} from './spec-support.ts';
import { PACKAGE_ROOT } from './support.ts';

/**
 * Per renderer version, the sha256 of the golden renders (names and bytes): a change to what
 * analyzr-spec writes for the same spec needs a new ANALYZR_SPEC_VERSION (src/spec/version.ts);
 * an optional field or enum value may join analyzr-spec/1 only when every existing render
 * stays byte-identical (M6 S3c §2.4). Only when a fixture itself changed may the hash of the
 * unreleased version be replaced. (0.1.0's was replaced once before any release, with the
 * review fixes of the step that introduced it.)
 */
const RENDER_OUTPUTS: Readonly<Record<string, string>> = {
  '0.1.0': 'f3ad4d7f248abb5145bb9d12f075dc459fcb6f5ae214dc817217862164477c20',
};

const UPDATE = process.env['ANALYZR_UPDATE_GOLDEN'] === '1';

/** The attributes of a fact the pins compare (long texts cut, with their length). */
const PINNED_ATTRS = [
  'documentation',
  'flowNodeRefs',
  'readBy',
  'writtenBy',
  'messageName',
  'signalName',
  'sourceRef',
  'targetRef',
];

/**
 * The facts of a model as analyzr extracts them, reduced to what the pins compare: kind, key,
 * event definition, element id, and the attributes that carry the model's content (a lane's
 * nodes, a data store's readers and writers, documentation, message and signal names, a
 * message flow's ends).
 */
async function factsOf(xml: string, key: string) {
  const result = await extractFacts(xml, { modelKey: key });
  const short = (s: string): string => (s.length > 60 ? `${s.slice(0, 60)}… (${s.length})` : s);
  return {
    result,
    facts: result.facts
      .map((f) => {
        const attrs = (f.attrs ?? {}) as Record<string, unknown>;
        const parts = [f.kind, JSON.stringify(f.keyRaw), f.eventDef ?? '-', f.elementId];
        for (const name of PINNED_ATTRS) {
          const v = attrs[name];
          if (v !== undefined) {
            parts.push(`${name}=${JSON.stringify(typeof v === 'string' ? short(v) : v)}`);
          }
        }
        return parts.join(' ');
      })
      .sort(),
    participants: result.processes.map((p) => p.participantName),
    modelName: result.processes[0]?.participantName ?? result.processes[0]?.name ?? null,
  };
}

/** A copy of a list, shuffled with a seeded generator. */
function shuffled<T>(items: readonly T[], rnd: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** The XML without its diagram (DI). */
const semantic = (xml: string): string =>
  xml.replace(/<bpmndi:BPMNDiagram[\s\S]*<\/bpmndi:BPMNDiagram>/, '');

describe('the golden renders', () => {
  it.each(GOLDENS.map((g) => g.name))('%s renders as its golden file', async (name) => {
    const { xml } = await renderGolden(name);
    const golden = path.join(SPEC_FIXTURES, `${name}.bpmn`);
    if (UPDATE) await writeFile(golden, xml);
    expect(xml, `${name}.bpmn differs from the render`).toBe(await readFile(golden, 'utf8'));
  });

  it('moves the renderer version whenever the rendered bytes change', async () => {
    const hash = createHash('sha256');
    for (const name of GOLDENS.map((g) => g.name).sort()) {
      hash
        .update(`${name}.bpmn\0`)
        .update(await readFile(path.join(SPEC_FIXTURES, `${name}.bpmn`)))
        .update('\0');
    }
    const digest = hash.digest('hex');
    expect(
      digest,
      `analyzr-spec ${ANALYZR_SPEC_VERSION} rendered these bytes before: bump ANALYZR_SPEC_VERSION in src/spec/version.ts and add {'<new version>': '${digest}'} to RENDER_OUTPUTS`,
    ).toBe(RENDER_OUTPUTS[ANALYZR_SPEC_VERSION]);
  });

  it.each(GOLDENS.map((g) => g.name))('%s: D1, no call link, no engine', async (name) => {
    const { xml, losses, summary } = await renderGolden(name);
    const { result } = await factsOf(xml, goldenKey(name));
    expect(result.warnings).toEqual([]);
    expect(result.engine).toBeNull();
    expect(structureProblems(xml)).toEqual([]);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<bpmn:definitions /);
    expect(xml).toContain(`id="Definitions_${goldenKey(name).replace(/[/-]/g, '_')}"`);
    expect(xml).toContain('exporter="analyzr-spec"');
    expect(xml).not.toMatch(/exporterVersion|modeler:|camunda|zeebe/);
    expect(losses.find((l) => l.code === 'layout-generated')?.count).toBe(summary.layout.shapes);
    expect(losses.find((l) => l.code === 'link-unresolved')?.count ?? 0).toBe(summary.calls.length);
  });
});

describe('the facts analyzr extracts per golden (kind, key, event definition, id, content)', () => {
  const pins: Record<
    string,
    { facts: string[]; participants: (string | null)[]; modelName: string | null }
  > = {
    minimal: {
      facts: [
        'evt_end "Anfrage beantwortet" none Event_ende',
        'evt_start "Anfrage eingegangen" none Event_start',
        'process "Process_p" - Process_p',
        'task "Anfrage beantworten" - Activity_beantworten',
      ],
      participants: [null],
      modelName: 'Anfrage beantworten',
    },
    'lanes-gateways': {
      facts: [
        'evt_end "Bestellung abgeschlossen" none Event_e',
        'evt_end "Bestellung storniert" none Event_e-storno',
        'evt_start "Bestellung eingegangen" none Event_s',
        'lane "Einkauf" - Lane_lane-einkauf flowNodeRefs=["Activity_t-bestellen","Event_e-storno","Event_ev-frist","Event_ev-lieferung","Gateway_g-warten"]',
        'lane "Lager" - Lane_lane-lager flowNodeRefs=["Activity_t-lager","Activity_t-reservieren"]',
        'lane "Vertrieb" - Lane_lane-vertrieb flowNodeRefs=["Activity_t-kunde","Activity_t-nachfragen","Activity_t-pruefen","Event_e","Event_s","Gateway_g-join","Gateway_g-oder","Gateway_g-oder-ende","Gateway_g-ok","Gateway_g-split"]',
        'msg_catch "Lieferung eingetroffen" message Event_ev-lieferung',
        'process "Process_bestellung" - Process_bestellung documentation="Von der eingehenden Bestellung der Beispiel GmbH bis zur Ben… (74)"',
        'task "Angaben nachfordern" - Activity_t-nachfragen',
        'task "Bestellung prüfen" - Activity_t-pruefen',
        'task "Kunde informieren" - Activity_t-kunde',
        'task "Lager informieren" - Activity_t-lager',
        'task "Lagerplatz reservieren" - Activity_t-reservieren',
        'task "Ware bestellen" - Activity_t-bestellen',
      ],
      participants: ['Bestellung bearbeiten'],
      modelName: 'Bestellung bearbeiten',
    },
    collaboration: {
      facts: [
        'evt_end "Auftrag angenommen" none Event_e1',
        'message_flow "" - MessageFlow_t4_v-s sourceRef="beispiel/collaboration#Activity_t4" targetRef="beispiel/collaboration#Event_v-s"',
        'message_flow "Anfrage" - MessageFlow_pool-kunde_s1 sourceRef="beispiel/collaboration#Participant_pool-kunde" targetRef="beispiel/collaboration#Event_s1"',
        'message_flow "Angebot" - MessageFlow_t2_pool-kunde sourceRef="beispiel/collaboration#Activity_t2" targetRef="beispiel/collaboration#Participant_pool-kunde"',
        'message_flow "Auftrag" - MessageFlow_pool-kunde_t3 sourceRef="beispiel/collaboration#Participant_pool-kunde" targetRef="beispiel/collaboration#Activity_t3"',
        'message_flow "Versandbestätigung" - MessageFlow_v-e_pool-kunde sourceRef="beispiel/collaboration#Event_v-e" targetRef="beispiel/collaboration#Participant_pool-kunde"',
        'msg_catch "Auftrag" - Activity_t3 messageName="Auftrag"',
        'msg_catch "Kundenanfrage" message Event_s1 messageName="Kundenanfrage"',
        'msg_catch "Versandauftrag" message Event_v-s messageName="Versandauftrag"',
        'msg_throw "Angebot" - Activity_t2 messageName="Angebot"',
        'msg_throw "Versandauftrag" - Activity_t4 messageName="Versandauftrag"',
        'msg_throw "Versandbestätigung" message Event_v-e messageName="Versandbestätigung"',
        'process "Process_p-versand" - Process_p-versand',
        'process "Process_p-vertrieb" - Process_p-vertrieb',
        'task "Angebot erstellen" - Activity_t1',
        'task "Ware versenden" - Activity_v-t',
      ],
      participants: ['Versand', 'Vertrieb'],
      modelName: 'Versand',
    },
    'unnamed-messages': {
      facts: [
        'evt_end "Rückmeldung erfasst" none Event_e',
        'evt_start "Wochenbeginn" timer Event_s',
        'msg_catch "Antwort erhalten" message Event_ev-antwort',
        'msg_catch "Rückmeldung entgegennehmen" - Activity_t-annehmen',
        'msg_throw "Erinnerung senden" - Activity_t-erinnern',
        'process "Process_rueckmeldung" - Process_rueckmeldung',
      ],
      participants: [null],
      modelName: 'Rückmeldung einholen',
    },
    'calls-and-stores': {
      facts: [
        'data_store "ERP-System" - DataStoreReference_ds-erp readBy=["Activity_sp-belege","Activity_t-buchen"] writtenBy=["Activity_t-buchen"]',
        'evt_end "Abschluss fertig" terminate Event_e',
        'process "Process_abschluss" - Process_abschluss',
        'sig_catch "Freigabe erteilt" signal Event_ev-freigabe',
        'sig_catch "Monatsabschluss" signal Event_s signalName="Monatsabschluss"',
        'sig_throw "Monatsabschluss beendet" signal Event_ev-melden signalName="Monatsabschluss beendet"',
        'task "Buchungen übertragen" - Activity_t-buchen',
      ],
      participants: [null],
      modelName: 'Monatsabschluss',
    },
    'long-texts': {
      facts: [
        'evt_end "Ende" none Event_e',
        'evt_start "Start" none Event_s',
        'msg_throw "Auftrag (neu)" - Activity_t2 messageName="Auftrag (neu)"',
        'msg_throw "Auftrag neu" - Activity_t3 messageName="Auftrag neu"',
        'process "Process_lang" - Process_lang documentation="Dieser Absatz beschreibt einen Prozess der Beispiel GmbH aus… (2000)"',
        'task "Kollision eins" - Activity_a_b_c8687a08',
        'task "Kollision zwei" - Activity_a_b_c14cddc0',
        'task "Prüfen mit Umlaut im Quell-Id" - Activity_pruefen',
        'task "Sehr langer Name einer Aufgabe der Beispiel GmbH Sehr langer Name einer Aufgabe der Beispiel GmbH Sehr langer Name einer Aufgabe der Beispiel GmbH Sehr langer Name einer Aufgabe der Beispiel GmbH Sehr" - Activity_t1',
        'task "Sieht aus wie eine DI-Id" - Activity_t1_di',
      ],
      participants: [null],
      modelName: 'Lange Texte der Beispiel GmbH',
    },
    'converter-loose': {
      facts: [
        'evt_end "Ware eingelagert" none Event_e',
        'evt_start "Lieferung angekommen" none Event_s',
        'lane "Lager" - Lane_lane-lager flowNodeRefs=["Event_e","Event_s"]',
        'lane "Qualitätssicherung" - Lane_lane-qs flowNodeRefs=["Activity_t-pruefen"]',
        'process "Process_wareneingang" - Process_wareneingang',
        'task "Ware einlagern" - Activity_t-einlagern',
        'task "Ware prüfen" - Activity_t-pruefen',
      ],
      participants: ['Wareneingang'],
      modelName: 'Wareneingang',
    },
    reconstructed: {
      facts: [
        'evt_end "Reklamation erledigt" none Event_ende',
        'evt_start "Reklamation eingegangen" none Event_start',
        'msg_throw "Ablehnung senden" - Activity_ablehnen',
        'process "Process_p" - Process_p',
        'task "Reklamation prüfen" - Activity_pruefen',
      ],
      participants: [null],
      modelName: 'Reklamationsbearbeitung',
    },
    'as-told': {
      facts: [
        'evt_end "Antrag entschieden" none Event_e',
        'evt_start "Antrag gestellt" none Event_s',
        'process "Process_urlaub" - Process_urlaub',
        'task "Antrag genehmigen" - Activity_t-genehmigen',
      ],
      participants: [null],
      modelName: 'Urlaubsantrag',
    },
  };

  it.each(GOLDENS.map((g) => g.name))('%s', async (name) => {
    const { xml } = await renderGolden(name);
    const { facts, participants, modelName } = await factsOf(xml, goldenKey(name));
    expect({ facts, participants, modelName }).toEqual(pins[name]);
  });
});

describe('determinism', () => {
  it('renders the same bytes twice, and for YAML and JSON of one spec', async () => {
    const first = await renderGolden('collaboration');
    const second = await renderGolden('collaboration');
    expect(second.xml).toBe(first.xml);
    const value = await readFixture('collaboration.spec.yaml');
    const fromJson = parseSpecText(JSON.stringify(value));
    expect(fromJson.errors).toEqual([]);
    const json = await renderSpec(specOf(fromJson.value, 'converter'), {
      key: goldenKey('collaboration'),
    });
    expect(json.xml).toBe(first.xml);
  });

  it('gives the same bytes when nodes, flows, message flows and data stores are shuffled', async () => {
    for (const name of ['lanes-gateways', 'collaboration', 'calls-and-stores', 'long-texts']) {
      const spec = await goldenSpec(name);
      const { xml } = await renderSpec(spec, { key: goldenKey(name) });
      for (const seed of [1, 2, 3]) {
        const rnd = mulberry32(seed);
        const mixed: Spec = {
          ...spec,
          processes: spec.processes.map((p) => ({
            ...p,
            nodes: shuffled(p.nodes, rnd),
            flows: shuffled(p.flows, rnd),
            dataStores: shuffled(p.dataStores, rnd),
          })),
          messageFlows: shuffled(spec.messageFlows, rnd),
        };
        expect(
          (await renderSpec(mixed, { key: goldenKey(name) })).xml,
          `${name}, seed ${seed}`,
        ).toBe(xml);
      }
    }
  });

  it('keeps the semantic bytes and the facts when lanes and pools are reordered (only the DI moves)', async () => {
    for (const name of ['lanes-gateways', 'collaboration']) {
      const spec = await goldenSpec(name);
      const before = await renderSpec(spec, { key: goldenKey(name) });
      const reordered: Spec = {
        ...spec,
        processes: [...spec.processes]
          .reverse()
          .map((p) => ({ ...p, lanes: [...p.lanes].reverse() })),
      };
      const after = await renderSpec(reordered, { key: goldenKey(name) });
      expect(after.xml).not.toBe(before.xml);
      expect(semantic(after.xml)).toBe(semantic(before.xml));
      expect((await factsOf(after.xml, goldenKey(name))).facts).toEqual(
        (await factsOf(before.xml, goldenKey(name))).facts,
      );
    }
  });

  it('changes only the definitions and collaboration ids for another key', async () => {
    const spec = await goldenSpec('collaboration');
    const a = (await renderSpec(spec, { key: 'vertrieb/angebot' })).xml;
    const b = (await renderSpec(spec, { key: 'bilder/angebot-neu' })).xml;
    const neutral = (xml: string) =>
      xml.replace(/(Definitions|Collaboration)_[A-Za-z0-9_]+/g, '$1_X');
    expect(a).not.toBe(b);
    expect(neutral(a)).toBe(neutral(b));
  });

  it('keeps an element id when a task is refined to a send task or a call, or an event changes direction', async () => {
    const spec = await goldenSpec('minimal');
    const node = spec.processes[0]?.nodes[1];
    expect(node?.source).toBe('beantworten');
    const plain = (await renderSpec(spec, { key: 'k' })).xml;
    const refined: Spec = {
      ...spec,
      processes: spec.processes.map((p) => ({
        ...p,
        nodes: p.nodes.map((n) => (n === node ? { ...n, taskKind: 'send' as const } : n)),
      })),
    };
    const send = (await renderSpec(refined, { key: 'k' })).xml;
    expect(plain).toContain('<bpmn:task id="Activity_beantworten"');
    expect(send).toContain('<bpmn:sendTask id="Activity_beantworten"');
    const asCall: Spec = {
      ...spec,
      processes: spec.processes.map((p) => ({
        ...p,
        nodes: p.nodes.map((n) =>
          n === node ? { ...n, type: 'call' as const, name: null, target: 'Antwort' } : n,
        ),
      })),
    };
    expect((await renderSpec(asCall, { key: 'k' })).xml).toContain(
      '<bpmn:subProcess id="Activity_beantworten" name="Antwort"',
    );
    const stores = await goldenSpec('calls-and-stores');
    const caught = stores.processes[0]?.nodes.find((n) => n.source === 'ev-freigabe');
    expect(caught).toMatchObject({ direction: 'catch', trigger: 'signal' });
    const thrown: Spec = {
      ...stores,
      processes: stores.processes.map((p) => ({
        ...p,
        nodes: p.nodes.map((n) => (n === caught ? { ...n, direction: 'throw' as const } : n)),
      })),
    };
    expect((await renderSpec(stores, { key: 'k' })).xml).toContain(
      '<bpmn:intermediateCatchEvent id="Event_ev-freigabe"',
    );
    expect((await renderSpec(thrown, { key: 'k' })).xml).toContain(
      '<bpmn:intermediateThrowEvent id="Event_ev-freigabe"',
    );
  });

  it('notes cut texts by element id and field, the same for shuffled lists', async () => {
    const spec = await goldenSpec('long-texts');
    const { summary } = await renderSpec(spec, { key: 'k' });
    expect(summary.textTruncated).toEqual([
      { element: 'Activity_t1', field: 'name' },
      { element: 'Process_lang', field: 'documentation' },
    ]);
    const rnd = mulberry32(7);
    const mixed: Spec = {
      ...spec,
      processes: spec.processes.map((p) => ({ ...p, nodes: shuffled(p.nodes, rnd) })),
    };
    expect((await renderSpec(mixed, { key: 'k' })).summary.textTruncated).toEqual(
      summary.textTruncated,
    );
  });
});

describe('ids', () => {
  it('derives every id from its source with a category prefix, never from list positions', async () => {
    const { xml } = await renderGolden('long-texts');
    // umlauts transliterated; unsafe sources that come out alike both suffixed; the safe
    // source t1_t2 keeps Flow_t1_t2, the generated flow t1 → t2 takes the hash; t1_di keeps
    // Activity_t1_di, the DI of Activity_t1 takes the hash
    expect(xml).toContain('id="Activity_pruefen"');
    expect(xml).toMatch(/id="Activity_a_b_[0-9a-f]{8}" name="Kollision eins"/);
    expect(xml).toMatch(/id="Activity_a_b_[0-9a-f]{8}" name="Kollision zwei"/);
    expect(xml).toContain('<bpmn:sequenceFlow id="Flow_t1_t2" sourceRef="Activity_t2"');
    expect(xml).toMatch(/<bpmn:sequenceFlow id="Flow_t1_t2_[0-9a-f]{8}" sourceRef="Activity_t1"/);
    expect(xml).toContain('<bpmn:task id="Activity_t1_di"');
    expect(xml).toMatch(
      /<bpmndi:BPMNShape id="Activity_t1_di_[0-9a-f]{8}" bpmnElement="Activity_t1"/,
    );
    expect(xml).toMatch(
      /<bpmn:message id="Message_Auftrag_neu_[0-9a-f]{8}" name="Auftrag \(neu\)"/,
    );
    expect(xml).toMatch(/<bpmn:message id="Message_Auftrag_neu_[0-9a-f]{8}" name="Auftrag neu"/);
  });

  it('caps every id at 255 characters with a hash of the raw value and keeps them unique', async () => {
    const long = 'x'.repeat(199);
    const spec = specOf(
      {
        format: 'analyzr-spec/1',
        source: { externalPath: 'A/B' },
        derived: { kind: 'reconstructed', llmModel: 'm' },
        processes: [
          {
            source: 'p',
            dataStores: [{ source: `${long}d` }],
            nodes: [
              { source: `${long}1`, type: 'task', reads: [`${long}d`] },
              { source: `${long}2`, type: 'task' },
            ],
            flows: [{ from: `${long}1`, to: `${long}2` }],
          },
        ],
      },
      'hand',
    );
    const ids = assignIds(spec, { key: 'k', messages: [], signals: [], collaboration: false });
    const all = [
      ...ids.nodes.values(),
      ...ids.flows.values(),
      ...ids.inputs.values(),
      ...ids.di.values(),
    ];
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) {
      expect(id.length).toBeLessThanOrEqual(255);
      expect(id).toMatch(/^[A-Za-z_][A-Za-z0-9_.-]*$/);
    }
    // a source is at most 200 characters, so its own id is never cut; ids made of two are
    expect([...ids.nodes.values()]).toEqual([`Activity_${long}1`, `Activity_${long}2`]);
    for (const id of [...ids.flows.values(), ...ids.inputs.values()]) {
      expect(id).toHaveLength(255);
      expect(id).toMatch(/_[0-9a-f]{8}$/);
    }
    expect(ids.rewritten).toBeGreaterThan(0);
    await expect(renderSpec(spec, { key: 'k' })).resolves.toMatchObject({
      losses: expect.arrayContaining([{ code: 'id-rewritten', count: ids.rewritten }]) as unknown,
    });
  });

  it('never gives an element the id bpmn-js derives for another one’s label or plane', async () => {
    const spec = specOf(
      {
        format: 'analyzr-spec/1',
        source: { externalPath: 'A/B' },
        derived: { kind: 'reconstructed', llmModel: 'm' },
        processes: [
          {
            source: 'p',
            dataStores: [{ source: 'd', name: 'ERP' }, { source: 'd_label' }],
            nodes: [
              { source: 'x', type: 'start', name: 'Start' },
              { source: 'c', type: 'call', target: 'Prüfung' },
              { source: 'c_plane', type: 'task', name: 'Aufgabe', reads: ['d', 'd_label'] },
              { source: 'a', type: 'task', name: 'A' },
              { source: 'b', type: 'task', name: 'B' },
              { source: 'a_b', type: 'task', name: 'AB' },
              { source: 'label', type: 'task', name: 'L' },
              { source: 'x_label', type: 'end', name: 'Ende' },
            ],
            flows: [
              { from: 'x', to: 'c', name: 'los' },
              { from: 'c', to: 'c_plane' },
              { from: 'c_plane', to: 'a' },
              { from: 'a', to: 'b', name: 'ja' },
              { from: 'b', to: 'a_b' },
              { from: 'a_b', to: 'label' },
              { from: 'label', to: 'x_label' },
            ],
          },
        ],
      },
      'hand',
    );
    const { xml, losses } = await renderSpec(spec, { key: 'k' });
    // the element that takes the suffixed form gets the hash; the one bpmn-js derives from keeps it
    expect(xml).toContain('<bpmn:startEvent id="Event_x" name="Start"');
    expect(xml).toMatch(/<bpmn:endEvent id="Event_x_label_[0-9a-f]{8}" name="Ende"/);
    expect(xml).toContain('<bpmn:subProcess id="Activity_c" name="Prüfung"');
    expect(xml).toMatch(/<bpmn:task id="Activity_c_plane_[0-9a-f]{8}" name="Aufgabe"/);
    expect(xml).toContain('<bpmn:dataStoreReference id="DataStoreReference_d" name="ERP"');
    expect(xml).toMatch(/<bpmn:dataStoreReference id="DataStoreReference_d_label_[0-9a-f]{8}"/);
    expect(xml).toMatch(
      /<bpmn:sequenceFlow id="Flow_a_b_label_[0-9a-f]{8}" sourceRef="Activity_a_b"/,
    );
    expect(xml).toContain('<bpmn:sequenceFlow id="Flow_a_b" name="ja" sourceRef="Activity_a"');
    // also where bpmn-js would derive no id (a data association has no label): every element alike
    expect(xml).toMatch(
      /<bpmn:dataInputAssociation id="DataInputAssociation_c_plane_d_label_[0-9a-f]{8}"/,
    );
    expect(losses.find((l) => l.code === 'id-rewritten')?.count).toBe(5);
    const { definitions } = await parseRendered(xml);
    expect(walkProblems(definitions)).toEqual([]);
    // the walker sees such a clash, as bpmn-js does
    const clash = xml.replaceAll(/Event_x_label_[0-9a-f]{8}/g, 'Event_x_label');
    expect(walkProblems((await parseRendered(clash)).definitions)).toEqual([
      'element Event_x_label (bpmn:EndEvent Event_x_label) already exists (the label of bpmn:StartEvent Event_x)',
    ]);
  });

  it('keeps the copies of capped and uniqueId equal to src/ids.ts', async () => {
    const source = await readFile(path.join(PACKAGE_ROOT, 'src/ids.ts'), 'utf8');
    const copy = await readFile(path.join(PACKAGE_ROOT, 'src/spec/ids.ts'), 'utf8');
    const body = (code: string, name: string): string =>
      /(?:export )?function (\w+)\([^]*?\n}\n/
        .exec(code.slice(code.indexOf(`function ${name}(`) - 7))?.[0]
        .replace(/^export /, '') ?? '';
    for (const name of ['capped', 'uniqueId']) {
      expect(body(copy, name), name).toBe(body(source, name));
      expect(body(copy, name), name).not.toBe('');
    }
    expect(capped('a'.repeat(300), 'raw')).toHaveLength(255);
    expect(uniqueId('a', (id) => id === 'a')).toBe('a_2');
  });
});

describe('texts', () => {
  const samples = [
    '',
    '  a  b  ',
    'Zeile\neins\r\nzwei\r\n\r\n\r\n\ndrei',
    '\u0000\u0007\t\u001f\u0085  x',
    '‎‏؜‪‮⁦⁩bidi',
    'ä'.repeat(250),
    `${'a'.repeat(199)}😀b`,
    '<>&"\'',
    'x'.repeat(2500),
  ];

  it('keeps the copies of sanitizeLine and sanitizeBlock equal to bpmn-facts', () => {
    for (const s of samples) {
      for (const max of [5, 200, 2000]) {
        expect(text.sanitizeLine(s, max), JSON.stringify(s)).toEqual(sanitizeLine(s, max));
        expect(text.sanitizeBlock(s, max), JSON.stringify(s)).toEqual(sanitizeBlock(s, max));
      }
    }
  });

  it('removes U+FFFE, U+FFFF and lone surrogates before sanitizing, so the extractor reads the same text', () => {
    const raw = 'a ￾ b￿ \ud800c \udc00d 😀';
    const line = text.cleanLine(raw).text;
    expect(line).toBe('a b c d 😀');
    expect(sanitizeLine(line, 200).text).toBe(line);
    expect(text.cleanBlock(`x￾\n\ny`).text).toBe('x\n\ny');
  });
});

describe('the self-check and the limits', () => {
  it('refuses a render that fails the self-check', async () => {
    const spec = await goldenSpec('minimal');
    for (const tamper of [
      (xml: string) =>
        xml
          .replace('<bpmn:task ', '<bpmn:callActivity calledElement="x" ')
          .replace('</bpmn:task>', '</bpmn:callActivity>'),
      (xml: string) =>
        xml.replace(
          /<bpmndi:BPMNShape id="Activity_beantworten_di"[\s\S]*?<\/bpmndi:BPMNShape>/,
          '',
        ),
      (xml: string) => xml.replace('id="Event_ende"', 'id="Event_start"'),
      (xml: string) => xml.replace('targetRef="Event_ende"', 'targetRef="Event_nirgends"'),
    ]) {
      const err = await renderSpec(spec, { key: 'k', tamper }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RenderError);
      expect((err as RenderError).code).toBe('self-check');
      expect((err as RenderError).problems.length).toBeGreaterThan(0);
    }
  });

  it('refuses each kind of broken render on its own rule', async () => {
    const spec = await goldenSpec('calls-and-stores');
    const shapeOf = (id: string) =>
      new RegExp(
        `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"[\\s\\S]*?</bpmndi:BPMNShape>`,
      );
    const cases: [string, (xml: string) => string, RegExp][] = [
      [
        'a callActivity without calledElement',
        (xml) =>
          xml
            .replace(
              '<bpmn:subProcess id="Activity_c-bericht"',
              '<bpmn:callActivity id="Activity_c-bericht"',
            )
            .replace(
              /(<bpmn:callActivity id="Activity_c-bericht"[\s\S]*?)<\/bpmn:subProcess>/,
              '$1</bpmn:callActivity>',
            ),
        /^a callActivity element \(Activity_c-bericht\)$/,
      ],
      [
        'a calledElement on a subProcess',
        (xml) =>
          xml.replace(
            '<bpmn:subProcess id="Activity_c-bericht"',
            '<bpmn:subProcess calledElement="Process_x" id="Activity_c-bericht"',
          ),
        /^a calledElement attribute on <bpmn:subProcess>$/,
      ],
      [
        'an unsafe id',
        (xml) => xml.replaceAll('Activity_t-buchen"', 'Activity_t:buchen"'),
        /^unsafe id "Activity_t:buchen"$/,
      ],
      [
        'an id of 256 characters',
        (xml) => xml.replaceAll('"Activity_t-buchen"', `"Activity_${'x'.repeat(247)}"`),
        /^unsafe id "Activity_x+"$/,
      ],
      [
        'an edge on a task',
        (xml) =>
          xml.replace(
            shapeOf('Activity_t-buchen'),
            '<bpmndi:BPMNEdge id="Activity_t-buchen_di" bpmnElement="Activity_t-buchen"><di:waypoint x="0" y="0" /><di:waypoint x="1" y="0" /></bpmndi:BPMNEdge>',
          ),
        /^Activity_t-buchen: BPMNEdge \(expected one BPMNShape\)$/,
      ],
      [
        'two shapes for one element',
        (xml) =>
          xml.replace(
            shapeOf('Activity_t-buchen'),
            (shape) =>
              `${shape}${shape.replace('id="Activity_t-buchen_di"', 'id="Activity_t-buchen_di2"')}`,
          ),
        /^Activity_t-buchen: BPMNShape, BPMNShape \(expected one BPMNShape\)$/,
      ],
      [
        'the id bpmn-js derives for a label',
        (xml) => xml.replaceAll('"Event_e"', '"Event_ev-melden_label"'),
        /^id Event_ev-melden_label is the id bpmn-js derives for Event_ev-melden$/,
      ],
    ];
    for (const [what, tamper, rule] of cases) {
      const err = await renderSpec(spec, { key: 'k', tamper }).catch((e: unknown) => e);
      expect(err, what).toBeInstanceOf(RenderError);
      expect((err as RenderError).code, what).toBe('self-check');
      expect((err as RenderError).problems, what).toEqual(
        expect.arrayContaining([expect.stringMatching(rule)]) as unknown,
      );
    }
  });

  it('refuses a layout that would need more slots for long flows than it allows', async () => {
    // a chain of n nodes and a flow from its start to every node: about n²/2 slots
    const n = 460;
    const nodes = Array.from({ length: n }, (_, i) => ({ source: `n${i}`, type: 'task' }));
    const flows = [
      ...nodes.slice(1).map((_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
      ...nodes.slice(2).map((x) => ({ from: 'n0', to: x.source })),
    ];
    const spec = specOf(
      {
        format: 'analyzr-spec/1',
        source: { externalPath: 'A/B' },
        processes: [{ source: 'p', nodes, flows }],
      },
      'converter',
    );
    const err = await renderSpec(spec, { key: 'k' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect(err).toMatchObject({
      code: 'layout-too-large',
      message: `the layout needs ${((n - 2) * (n - 1)) / 2} slots for flows that skip layers, at most ${MAX_SLOTS}: split the model`,
    });
  });

  it('refuses a model over analyzr’s 5 MB or 50,000 elements', async () => {
    const spec = await goldenSpec('minimal');
    const big = (xml: string) =>
      xml.replace(
        '</bpmn:process>',
        `<bpmn:documentation>${'x'.repeat(5 * 1024 * 1024)}</bpmn:documentation></bpmn:process>`,
      );
    await expect(renderSpec(spec, { key: 'k', tamper: big })).rejects.toMatchObject({
      code: 'too-large',
    });
    const many = (xml: string) =>
      xml.replace('</bpmn:process>', `${'<bpmn:documentation />'.repeat(50_001)}</bpmn:process>`);
    await expect(renderSpec(spec, { key: 'k', tamper: many })).rejects.toMatchObject({
      code: 'too-many-elements',
    });
  });
});

describe(`${FUZZ_COUNT} seeded random specs`, () => {
  it('render deterministically, also with shuffled lists, and pass D1 and D3 (b)', async () => {
    for (let seed = 0; seed < FUZZ_COUNT; seed++) {
      const { fuzz, spec, result } = await renderFuzz(seed);
      const where = `seed ${seed} (${fuzz.origin}): ${JSON.stringify(fuzz.value).slice(0, 2000)}`;
      const { result: facts } = await factsOf(result.xml, `fuzz/s-${seed}`);
      expect(facts.warnings, where).toEqual([]);
      expect(facts.engine, where).toBeNull();
      expect(structureProblems(result.xml), where).toEqual([]);
      // the same bytes with every list shuffled whose order the drawing does not show
      const rnd = mulberry32(seed + 1);
      const mixed: Spec = {
        ...spec,
        processes: spec.processes.map((p) => ({
          ...p,
          nodes: shuffled(p.nodes, rnd).map((n) => ({
            ...n,
            reads: shuffled(n.reads, rnd),
            writes: shuffled(n.writes, rnd),
          })),
          flows: shuffled(p.flows, rnd),
          dataStores: shuffled(p.dataStores, rnd),
        })),
        messageFlows: shuffled(spec.messageFlows, rnd),
      };
      const again = await renderSpec(mixed, { key: `fuzz/s-${seed}` });
      expect(again.xml === result.xml, where).toBe(true);
    }
  }, 120_000);
});
