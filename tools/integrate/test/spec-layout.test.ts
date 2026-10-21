// The layout of rendered specs (src/spec/layout.ts, M6 S3c §3.2): readable in bpmn-js on the
// golden fixtures and on seeded random specs; lanes keep their list order; nodes without a
// lane (converter output) sit in an unlaned band below the lanes.
import { describe, expect, it } from 'vitest';

import { L, textBox } from '../src/spec/layout.ts';
import { renderSpec } from '../src/spec/render.ts';

import { diProblems, layoutProblems, parseRendered, type El } from './spec-checks.ts';
import { FUZZ_COUNT, GOLDENS, renderFuzz, renderGolden, specOf } from './spec-support.ts';

interface BoundsEl {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** DI bounds by element id. */
function boundsById(definitions: El): Map<string, BoundsEl> {
  const out = new Map<string, BoundsEl>();
  const diagram = (definitions['diagrams'] as El[])[0];
  const plane = diagram?.['plane'] as El | undefined;
  for (const pe of (plane?.['planeElement'] as El[] | undefined) ?? []) {
    const target = pe['bpmnElement'] as El | undefined;
    const bounds = pe['bounds'] as BoundsEl | undefined;
    if (target?.id !== undefined && bounds !== undefined) out.set(target.id, bounds);
  }
  return out;
}

describe('the layout', () => {
  it.each(GOLDENS.map((g) => g.name))('%s is readable and its DI complete', async (name) => {
    const { definitions, warnings } = await parseRendered((await renderGolden(name)).xml);
    expect(warnings).toEqual([]);
    expect(diProblems(definitions)).toEqual([]);
    expect(layoutProblems(definitions)).toEqual([]);
  });

  it('draws lanes top to bottom in list order, not by id or name', async () => {
    const { definitions } = await parseRendered((await renderGolden('lanes-gateways')).xml);
    const b = boundsById(definitions);
    const ys = ['Lane_lane-vertrieb', 'Lane_lane-einkauf', 'Lane_lane-lager'].map(
      (id) => b.get(id)?.y ?? Number.NaN,
    );
    expect(ys).toEqual([...ys].sort((x, y) => x - y));
    expect(new Set(ys).size).toBe(3);
  });

  it('draws pools in list order: processes first, then black-box participants', async () => {
    const { definitions } = await parseRendered((await renderGolden('collaboration')).xml);
    const b = boundsById(definitions);
    const ys = ['Participant_p-vertrieb', 'Participant_p-versand', 'Participant_pool-kunde'].map(
      (id) => b.get(id)?.y ?? Number.NaN,
    );
    expect(ys).toEqual([...ys].sort((x, y) => x - y));
    expect(b.get('Participant_pool-kunde')?.height).toBe(L.BLACKBOX_H);
  });

  it('keeps the main line straight: the longest path to an end stays on its row', async () => {
    const { definitions } = await parseRendered((await renderGolden('reconstructed')).xml);
    const b = boundsById(definitions);
    const cy = (id: string): number => {
      const box = b.get(id);
      return box === undefined ? Number.NaN : box.y + box.height / 2;
    };
    // start → prüfen → berechtigt? → (ja) Gutschrift erstellen and (nein) Ablehnung senden:
    // equally long, so the smaller id (Activity_ablehnen) keeps the row
    expect(cy('Activity_pruefen')).toBe(cy('Event_start'));
    expect(cy('Gateway_berechtigt')).toBe(cy('Event_start'));
    expect(cy('Activity_ablehnen')).toBe(cy('Event_start'));
    expect(cy('Activity_gutschrift')).toBeGreaterThan(cy('Event_start'));
  });

  it('draws nodes without a lane below the lanes, inside the pool, and invents no lane', async () => {
    const { xml } = await renderGolden('converter-loose');
    const { definitions } = await parseRendered(xml);
    const b = boundsById(definitions);
    const lanesBottom = Math.max(
      ...['Lane_lane-lager', 'Lane_lane-qs'].map(
        (id) => (b.get(id)?.y ?? 0) + (b.get(id)?.height ?? 0),
      ),
    );
    const node = b.get('Activity_t-einlagern');
    const pool = b.get('Participant_wareneingang');
    expect(node?.y).toBeGreaterThanOrEqual(lanesBottom);
    expect((node?.y ?? 0) + (node?.height ?? 0)).toBeLessThanOrEqual(
      (pool?.y ?? 0) + (pool?.height ?? 0),
    );
    expect(xml.match(/<bpmn:lane /g)).toHaveLength(2);
  });

  it('keeps flow labels off every shape: in the column gap, which widens to the label', async () => {
    const spec = specOf(
      {
        format: 'analyzr-spec/1',
        source: { externalPath: 'A/B' },
        participants: [{ source: 'kunde', name: 'Kunde' }],
        processes: [
          {
            source: 'p',
            nodes: [
              { source: 's', type: 'start', name: 'Start' },
              { source: 't1', type: 'task', name: 'Prüfen' },
              { source: 'g', type: 'gateway', kind: 'exclusive', name: 'ok?' },
              { source: 't2', type: 'task', name: 'Freigeben' },
              { source: 't3', type: 'task', name: 'Nachbessern' },
              { source: 'e', type: 'end', name: 'Ende' },
            ],
            flows: [
              { from: 's', to: 't1', name: 'Bestellung eingegangen und erfasst' },
              { from: 't1', to: 'g', name: 'geprüft' },
              { from: 'g', to: 't2', name: 'ja' },
              { from: 'g', to: 't3', name: `nein, ${'zurück zur Prüfung '.repeat(8)}` },
              { from: 't3', to: 't1', name: 'erneut prüfen, sobald die Angaben vollständig sind' },
              { from: 't2', to: 'e', name: 'freigegeben' },
              { from: 't2', to: 't2', name: 'bis alles freigegeben ist' },
            ],
          },
        ],
        messageFlows: [
          { from: 't2', to: 'kunde', name: `Freigabe ${'mit allen Unterlagen '.repeat(6)}` },
        ],
      },
      'converter',
    );
    const { xml } = await renderSpec(spec, { key: 'k' });
    const { definitions } = await parseRendered(xml);
    expect(layoutProblems(definitions)).toEqual([]);
    expect(diProblems(definitions)).toEqual([]);
    const b = boundsById(definitions);
    // the gap after the start's column fits its 90 wide label
    const start = b.get('Event_s');
    const t1 = b.get('Activity_t1');
    expect((t1?.x ?? 0) - ((start?.x ?? 0) + (start?.width ?? 0))).toBeGreaterThanOrEqual(90);
  });

  it('gives flows that leave one node for different rows their labels at those rows', async () => {
    const spec = specOf(
      {
        format: 'analyzr-spec/1',
        source: { externalPath: 'A/B' },
        processes: [
          {
            source: 'p',
            nodes: [
              { source: 'a', type: 'task', name: 'Prüfen' },
              { source: 'b', type: 'task', name: 'Nachfragen' },
              { source: 'g', type: 'gateway', kind: 'exclusive' },
              { source: 'x', type: 'task', name: 'Annehmen' },
              { source: 'y', type: 'task', name: 'Ablehnen' },
              { source: 'z', type: 'task', name: 'Rückfragen' },
            ],
            flows: [
              { from: 'a', to: 'g' },
              { from: 'b', to: 'g' },
              { from: 'g', to: 'x', name: 'angenommen' },
              { from: 'g', to: 'y', name: 'abgelehnt' },
              { from: 'g', to: 'z', name: 'unklar' },
            ],
          },
        ],
      },
      'converter',
    );
    const { xml } = await renderSpec(spec, { key: 'k' });
    const { definitions } = await parseRendered(xml);
    expect(layoutProblems(definitions)).toEqual([]);
    const labels = [
      ...xml.matchAll(
        /<bpmndi:BPMNEdge id="Flow_g_\w_di"[\s\S]*?<dc:Bounds x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g,
      ),
    ].map((m) => ({ y: Number(m[2]), h: Number(m[4]) }));
    expect(labels).toHaveLength(3);
    // the gateway joins and splits, so all three leave its right side: one label per row
    for (const [i, a] of labels.entries()) {
      for (const c of labels.slice(i + 1)) {
        expect(a.y + a.h <= c.y || c.y + c.h <= a.y).toBe(true);
      }
    }
  });

  it('keeps nested loops back to one node inside their lane and pool, each on its own track', async () => {
    const tasks = Array.from({ length: 8 }, (_, i) => ({
      source: `t${i}`,
      type: 'task',
      lane: 'l1',
    }));
    const spec = specOf(
      {
        format: 'analyzr-spec/1',
        source: { externalPath: 'A/B' },
        processes: [
          {
            source: 'p',
            lanes: [
              { source: 'l1', name: 'Oben' },
              { source: 'l2', name: 'Unten' },
            ],
            nodes: [
              { source: 's', type: 'start', lane: 'l1' },
              ...tasks,
              { source: 'x', type: 'task', lane: 'l2' },
              { source: 'e', type: 'end', lane: 'l1' },
            ],
            flows: [
              { from: 's', to: 't0' },
              ...tasks.slice(1).map((t, i) => ({ from: `t${i}`, to: t.source })),
              ...tasks.slice(1).map((t) => ({ from: t.source, to: 't0', name: 'zurück' })),
              { from: 't7', to: 'e' },
              { from: 't7', to: 'x' },
            ],
          },
        ],
      },
      'converter',
    );
    const { xml } = await renderSpec(spec, { key: 'k' });
    const { definitions } = await parseRendered(xml);
    expect(layoutProblems(definitions)).toEqual([]);
    expect(diProblems(definitions)).toEqual([]);
    const lane = boundsById(definitions).get('Lane_l1');
    const ys = new Set<number>();
    for (const m of xml.matchAll(
      /<bpmndi:BPMNEdge id="Flow_t\d_t0_di"[^>]*>\s*<di:waypoint x="\d+" y="\d+" \/>\s*<di:waypoint x="\d+" y="(\d+)" \/>/g,
    )) {
      const y = Number(m[1]);
      ys.add(y);
      expect(y).toBeLessThan((lane?.y ?? 0) + (lane?.height ?? 0));
    }
    expect(ys.size).toBe(7);
  });

  it('sees what breaks the layout: a covering label, an edge out of its pool, pools on each other, fractions', async () => {
    const { xml } = await renderGolden('collaboration');
    const problems = async (broken: string) =>
      layoutProblems((await parseRendered(broken)).definitions);
    // a message flow's label and a sequence flow's moved onto a task
    const onto = (model: string, edge: string, shape: string): string => {
      const at = new RegExp(
        `<bpmndi:BPMNShape id="${shape}_di"[\\s\\S]*?<dc:Bounds x="(\\d+)" y="(\\d+)"`,
      ).exec(model);
      return model.replace(
        new RegExp(
          `(<bpmndi:BPMNEdge id="${edge}_di"[\\s\\S]*?<bpmndi:BPMNLabel>\\s*<dc:Bounds )x="\\d+" y="\\d+"`,
        ),
        `$1x="${at?.[1] ?? 0}" y="${at?.[2] ?? 0}"`,
      );
    };
    expect(await problems(onto(xml, 'MessageFlow_pool-kunde_s1', 'Activity_t2'))).toEqual([
      'the label of MessageFlow_pool-kunde_s1 covers Activity_t2',
    ]);
    const reconstructed = (await renderGolden('reconstructed')).xml;
    expect(
      await problems(onto(reconstructed, 'Flow_berechtigt_ablehnen', 'Activity_ablehnen')),
    ).toEqual(['the label of Flow_berechtigt_ablehnen covers Activity_ablehnen']);
    // a sequence flow's waypoint far below its pool
    expect(
      await problems(
        xml.replace(
          /(<bpmndi:BPMNEdge id="Flow_t1_t2_di"[^>]*>\s*<di:waypoint x="\d+" y=")\d+"/,
          '$15000"',
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Flow_t1_t2: runs outside its pool/),
      ]) as unknown,
    );
    // the black box drawn on the first pool
    const first =
      /<bpmndi:BPMNShape id="Participant_p-vertrieb_di"[\s\S]*?<dc:Bounds x="\d+" y="(\d+)"/.exec(
        xml,
      )?.[1];
    expect(
      await problems(
        xml.replace(
          /(<bpmndi:BPMNShape id="Participant_pool-kunde_di"[\s\S]*?<dc:Bounds x="\d+" y=")\d+"/,
          `$1${first ?? 0}"`,
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        'pool Participant_p-vertrieb overlaps pool Participant_pool-kunde',
      ]) as unknown,
    );
    // shape bounds and the last waypoint off the integer grid
    expect(
      await problems(
        xml
          .replace(/(<bpmndi:BPMNShape id="Activity_t1_di"[\s\S]*?<dc:Bounds x=")(\d+)"/, '$1$2.5"')
          .replace(
            /(<bpmndi:BPMNEdge id="Flow_t1_t2_di"[\s\S]*?<di:waypoint x="\d+" y="\d+" \/>\s*<di:waypoint x=")(\d+)"/,
            '$1$2.25"',
          ),
      ),
    ).toEqual(
      expect.arrayContaining([
        'Activity_t1: bounds are not on integer coordinates',
        'Flow_t1_t2: waypoint 1 is not on integer coordinates',
      ]) as unknown,
    );
  });

  it('sizes labels as bpmn-js wraps them, breaking words that do not fit', () => {
    expect(textBox('Auftrag')).toEqual({ width: 42, height: 14 });
    expect(textBox('Auftrag ist vollständig')).toEqual({ width: 66, height: 28 });
    expect(textBox('x'.repeat(40))).toEqual({ width: 90, height: 42 });
  });
});

describe(`${FUZZ_COUNT} seeded random specs`, () => {
  it('are readable with complete DI', async () => {
    for (let seed = 0; seed < FUZZ_COUNT; seed++) {
      const { fuzz, result } = await renderFuzz(seed);
      const where = `seed ${seed} (${fuzz.origin}): ${JSON.stringify(fuzz.value).slice(0, 2000)}`;
      const { definitions, warnings } = await parseRendered(result.xml);
      expect(warnings, where).toEqual([]);
      expect(diProblems(definitions), where).toEqual([]);
      expect(layoutProblems(definitions), where).toEqual([]);
    }
  }, 120_000);
});
