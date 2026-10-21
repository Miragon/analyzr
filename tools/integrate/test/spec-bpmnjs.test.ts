// Done-when D2 (a) of M6 S3c in CI: every rendered model reads in bpmn-moddle without warnings
// and bpmn-js's own BpmnTreeWalker walks it with a handler that refuses what BpmnImporter
// refuses, drawing every participant, lane, flow node, data store, flow and data association
// exactly once. bpmn-js itself imports the goldens and random renders in a browser only:
// apps/web/e2e/spec-render-import.spec.ts (D2 b), which the lead runs.
import { describe, expect, it } from 'vitest';

import { drawable, parseRendered, walkProblems } from './spec-checks.ts';
import { FUZZ_COUNT, GOLDENS, renderFuzz, renderGolden } from './spec-support.ts';

describe('bpmn-js’s tree walker with the importer’s refusals', () => {
  it.each(GOLDENS.map((g) => g.name))('walks %s without an error', async (name) => {
    const { definitions, warnings } = await parseRendered((await renderGolden(name)).xml);
    expect(warnings).toEqual([]);
    expect(drawable(definitions).length).toBeGreaterThan(0);
    expect(walkProblems(definitions)).toEqual([]);
  });

  it('refuses what the importer refuses', async () => {
    const { xml } = await renderGolden('minimal');
    const withoutShape = xml.replace(
      /<bpmndi:BPMNShape id="Activity_beantworten_di"[\s\S]*?<\/bpmndi:BPMNShape>/,
      '',
    );
    const { definitions } = await parseRendered(withoutShape);
    expect(walkProblems(definitions)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Activity_beantworten has no DI element/),
        expect.stringMatching(/not yet drawn/),
      ]) as unknown,
    );
    const edgeOnNode = xml.replace(
      /<bpmndi:BPMNShape id="Activity_beantworten_di" bpmnElement="Activity_beantworten">[\s\S]*?<\/bpmndi:BPMNShape>/,
      '<bpmndi:BPMNEdge id="Activity_beantworten_di" bpmnElement="Activity_beantworten"><di:waypoint x="0" y="0" /><di:waypoint x="1" y="0" /></bpmndi:BPMNEdge>',
    );
    expect(walkProblems((await parseRendered(edgeOnNode)).definitions)).toEqual(
      expect.arrayContaining([expect.stringMatching(/a BPMNEdge on the node/)]) as unknown,
    );
    const shapeOnFlow = xml.replace(
      /<bpmndi:BPMNEdge id="Flow_start_beantworten_di" bpmnElement="Flow_start_beantworten">[\s\S]*?<\/bpmndi:BPMNEdge>/,
      '<bpmndi:BPMNShape id="Flow_start_beantworten_di" bpmnElement="Flow_start_beantworten"><dc:Bounds x="236" y="150" width="60" height="20" /></bpmndi:BPMNShape>',
    );
    expect(walkProblems((await parseRendered(shapeOnFlow)).definitions)).toEqual([
      'a BPMNShape on the connection bpmn:SequenceFlow Flow_start_beantworten',
    ]);
    const noSource = xml.replace(' sourceRef="Event_start"', '');
    expect(walkProblems((await parseRendered(noSource)).definitions)).toEqual([
      'bpmn:SequenceFlow Flow_start_beantworten#sourceRef not specified',
    ]);
    const planeOnTask = xml.replace(
      /<bpmndi:BPMNShape id="Activity_beantworten_di" bpmnElement="Activity_beantworten">[\s\S]*?<\/bpmndi:BPMNShape>/,
      '<bpmndi:BPMNPlane id="Activity_beantworten_di" bpmnElement="Activity_beantworten" />',
    );
    expect(walkProblems((await parseRendered(planeOnTask)).definitions)).toEqual(
      expect.arrayContaining([
        'unknown di bpmndi:BPMNPlane Activity_beantworten_di for bpmn:Task Activity_beantworten',
      ]) as unknown,
    );
  });
});

describe(`${FUZZ_COUNT} seeded random specs`, () => {
  it('walk without an error', async () => {
    for (let seed = 0; seed < FUZZ_COUNT; seed++) {
      const { fuzz, result } = await renderFuzz(seed);
      const where = `seed ${seed} (${fuzz.origin}): ${JSON.stringify(fuzz.value).slice(0, 2000)}`;
      const { definitions, warnings } = await parseRendered(result.xml);
      expect(warnings, where).toEqual([]);
      expect(walkProblems(definitions), where).toEqual([]);
    }
  }, 120_000);
});
