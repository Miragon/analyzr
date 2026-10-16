/**
 * Deterministic gap signals over the head facts (M6 §4.3): what a model
 * lacks for analyzr to build more links, as questions. Their own kinds,
 * never `FindingKind` (frozen for the live runs). Each was checked on
 * `nordwind-handel` and its descriptive variants (`eval:descriptive`) before
 * it shipped; `extractor-loss` comes with S2, which stores the extractor's
 * warnings. Pure.
 */
import { parseRef, type Fact, type OpenQuestionKind } from '@analyzr/contracts';
import { quoteDe } from '@analyzr/relations';

import { isAssigned } from '../judgements.ts';
import type { Draft, OpenQuestionIndex } from './model.ts';

/** The gap signals of S4, in the order the read model lists them. */
export const GAP_SIGNALS = [
  'black-box-partner',
  'unlabelled-boundary',
  'message-without-name',
  'undocumented-process',
  'isolated-process',
  'descriptive-model',
] as const satisfies readonly OpenQuestionKind[];
export type GapSignal = (typeof GAP_SIGNALS)[number];

/**
 * Signals that stay off, with the reason (M6 §4.3: "noisy ones stay off");
 * their code stays, so the counts can be measured (`signalCounts`) and a
 * later slice can switch them on. Counts in M6 §8 "S4 as delivered".
 */
export const SIGNALS_OFF: Readonly<Partial<Record<GapSignal, string>>> = {
  'message-without-name':
    'duplicates message-partner-missing: a message endpoint without a name and without a ' +
    'message flow never pairs in the key tier, so the rule tier already reports it as ' +
    '`dangling-throw` or `unmatched-catch` ("Eine Nachricht ohne Nachrichtennamen …"); on ' +
    "nordwind-handel's descriptive variant all 46 such endpoints were findings already (the " +
    'other 19 nameless ones are message-flow ends). What remains after an agent links one is ' +
    "a question the agent's link already answers.",
};

/** The signals the read model computes: {@link GAP_SIGNALS} without {@link SIGNALS_OFF}. */
export const SHIPPED_SIGNALS: readonly GapSignal[] = GAP_SIGNALS.filter(
  (s) => SIGNALS_OFF[s] === undefined,
);

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort(byCodePoint);

function rule(ix: OpenQuestionIndex, modelKey: string) {
  return { sourceKind: 'rule' as const, handle: null, seq: ix.headSeq([modelKey]) };
}

/**
 * `black-box-partner`: a message flow ends outside every process of its
 * file, at a pool without a process as far as facts v1 tell. Facts v1 have no
 * participant facts, so such an end is one that is neither an element with a
 * fact, nor a flow node the facts name (a lane member, an enclosing
 * subprocess, a boundary host, a data store's reader or writer:
 * `OpenQuestionIndex.processOfRef`), nor a participant some process fact
 * names (`attrs.participantId`). A collapsed subprocess or an intermediate
 * none event outside any lane still lands here, so the question calls the
 * end a pool only as the likely case. S4 shows its id (the name needs facts
 * v2). One question per end, listing its flows.
 */
function blackBoxPartners(ix: OpenQuestionIndex): Draft[] {
  const out: Draft[] = [];
  for (const model of ix.input.projectFacts.models) {
    const elements = new Set(model.facts.map((f) => f.elementId));
    const pools = new Set(
      model.facts.flatMap((f) =>
        f.kind === 'process' && f.attrs.participantId !== undefined ? [f.attrs.participantId] : [],
      ),
    );
    const boxes = new Map<string, { flow: string | null; inside: string; outgoing: boolean }[]>();
    for (const flow of model.messageFlows) {
      for (const [end, other, outgoing] of [
        [flow.to, flow.from, true],
        [flow.from, flow.to, false],
      ] as const) {
        const id = parseRef(end).elementId;
        if (elements.has(id) || pools.has(id) || ix.processOfRef.has(end)) continue;
        const list = boxes.get(end) ?? [];
        list.push({
          flow: flow.name ?? flow.messageName,
          inside: other,
          outgoing,
        });
        boxes.set(end, list);
      }
    }
    for (const [box, flows] of [...boxes].sort(([a], [b]) => byCodePoint(a, b))) {
      const id = parseRef(box).elementId;
      const inside = sorted(flows.map((f) => f.inside).filter((r) => r !== box));
      const listed = flows
        .map(
          (f) =>
            `${f.flow === null ? '' : `${quoteDe(f.flow)} `}${f.outgoing ? 'von' : 'an'} ` +
            quoteDe(ix.elementName(f.inside)),
        )
        .sort(byCodePoint);
      out.push({
        kind: 'black-box-partner',
        source: 'signal',
        subject: { type: 'ref', id: box },
        subjectLabel: quoteDe(id),
        version: ix.factsVersion([model.modelKey]),
        modelKeys: [model.modelKey],
        text:
          `Ist ${quoteDe(id)} in ${model.modelKey} ein externer Partner, oder fehlt das Modell ` +
          `seines Prozesses? ${quoteDe(id)} gehört zu keinem Prozess des Modells, ist also ` +
          `vermutlich ein Pool ohne Prozess. Nachrichtenflüsse: ${listed.join('; ')}.`,
        refs: [box, ...inside],
        raisedBy: rule(ix, model.modelKey),
        anchors: { refs: inside },
      });
    }
  }
  return out;
}

/** A none start or none end event directly in a process (a trigger endpoint, if labelled). */
const isBoundary = (f: Fact): boolean =>
  (f.kind === 'evt_start' || f.kind === 'evt_end') &&
  f.eventDef === 'none' &&
  f.scope === 'process';

/**
 * `unlabelled-boundary`: a process with a none start or none end event
 * without a label. Trigger relations (labelled none end → labelled none
 * start) need both labelled.
 */
function unlabelledBoundaries(ix: OpenQuestionIndex): Draft[] {
  const out: Draft[] = [];
  for (const model of ix.input.projectFacts.models) {
    const byProcess = new Map<string, Fact[]>();
    for (const f of model.facts) {
      if (!isBoundary(f) || f.label !== '' || f.processId === null) continue;
      const process = `${model.modelKey}#${f.processId}`;
      byProcess.set(process, [...(byProcess.get(process) ?? []), f]);
    }
    for (const [process, events] of [...byProcess].sort(([a], [b]) => byCodePoint(a, b))) {
      const starts = events.some((f) => f.kind === 'evt_start');
      const ends = events.some((f) => f.kind === 'evt_end');
      const name = quoteDe(ix.processName(process));
      const question =
        starts && ends
          ? `Was startet ${name}, und womit endet er?`
          : starts
            ? `Was startet ${name}?`
            : `Womit endet ${name}?`;
      out.push({
        kind: 'unlabelled-boundary',
        source: 'signal',
        subject: { type: 'process', id: process },
        subjectLabel: name,
        version: ix.factsVersion([model.modelKey]),
        modelKeys: [model.modelKey],
        text:
          `${question} ${events.length === 1 ? 'Ein Start- oder Endereignis hat' : `${events.length} Start- oder Endereignisse haben`} ` +
          'keinen Namen; Auslöser-Beziehungen zu anderen Prozessen brauchen benannte Ereignisse.',
        refs: [process, ...events.map((f) => f.ref)],
        raisedBy: rule(ix, model.modelKey),
        anchors: { processes: [process] },
      });
    }
  }
  return out;
}

/**
 * Can a message fact be a relation endpoint (CONCEPT §2)? Starts and ends in
 * embedded subprocesses never are, ends in event subprocesses never are.
 */
function isMessageEndpoint(f: Fact): boolean {
  if (f.kind !== 'msg_throw' && f.kind !== 'msg_catch') return false;
  const type = f.attrs.elementType;
  if (f.scope === 'subprocess' && (type === 'bpmn:StartEvent' || type === 'bpmn:EndEvent')) {
    return false;
  }
  return !(f.scope === 'event_subprocess' && type === 'bpmn:EndEvent');
}

/**
 * `message-without-name`: a message endpoint without a message name (no
 * `messageRef`, so its key is its label and the key tier cannot pair it),
 * not an expression and without a message flow in its file. Leaves out the
 * refs a `message-partner-missing` finding already asks about: its detail
 * names the missing name.
 */
function messagesWithoutName(ix: OpenQuestionIndex): Draft[] {
  const asked = new Set(
    ix.input.findings
      .filter((f) => f.kind === 'dangling-throw' || f.kind === 'unmatched-catch')
      .flatMap((f) => f.refs),
  );
  const out: Draft[] = [];
  const seen = new Set<string>();
  for (const model of ix.input.projectFacts.models) {
    const flowEnds = new Set(model.messageFlows.flatMap((m) => [m.from, m.to]));
    for (const f of model.facts) {
      if (!isMessageEndpoint(f) || f.attrs.messageName !== undefined) continue;
      if (f.attrs.dynamic === true || flowEnds.has(f.ref) || asked.has(f.ref) || seen.has(f.ref)) {
        continue;
      }
      seen.add(f.ref);
      const verb = f.kind === 'msg_throw' ? 'sendet' : 'empfängt';
      out.push({
        kind: 'message-without-name',
        source: 'signal',
        subject: { type: 'ref', id: f.ref },
        subjectLabel: quoteDe(ix.elementName(f.ref)),
        version: ix.factsVersion([model.modelKey]),
        modelKeys: [model.modelKey],
        text:
          `Welche Nachricht ${verb} ${ix.elementInProcess(f.ref)}? Ohne Nachrichtennamen ` +
          'kann die Regelebene keinen Partner zuordnen; die Verbindung hängt dann allein am Urteil eines Agenten.',
        refs: [f.ref],
        raisedBy: rule(ix, model.modelKey),
        anchors: { refs: [f.ref] },
      });
    }
  }
  return out;
}

/** `undocumented-process`: a process without documentation (agents' main evidence for placements). */
function undocumentedProcesses(ix: OpenQuestionIndex): Draft[] {
  const out: Draft[] = [];
  for (const p of [...ix.processes.values()].sort((a, b) => byCodePoint(a.ref, b.ref))) {
    if ((p.fact?.attrs.documentation ?? '').trim() !== '') continue;
    const name = quoteDe(ix.processName(p.ref));
    out.push({
      kind: 'undocumented-process',
      source: 'signal',
      subject: { type: 'process', id: p.ref },
      subjectLabel: name,
      version: ix.factsVersion([p.modelKey]),
      modelKeys: [p.modelKey],
      text:
        `Was leistet ${name}? Der Prozess hat keine Dokumentation; die Agenten brauchen sie ` +
        'vor allem, um ihn in die Wertschöpfungskette einzuordnen.',
      refs: [p.ref],
      raisedBy: rule(ix, p.modelKey),
      anchors: { processes: [p.ref] },
    });
  }
  return out;
}

/**
 * `isolated-process`: a process that no relation (in any status but
 * obsolete) and no candidate of tiers `rule`, `key` or `lexical` touches, and
 * that no message flow in its file connects to another process.
 */
function isolatedProcesses(ix: OpenQuestionIndex): Draft[] {
  const touched = new Set<string>();
  for (const r of ix.input.relations) {
    touched.add(r.fromRef);
    touched.add(r.toRef);
  }
  for (const c of ix.input.candidates) {
    if (!isAssigned(c)) continue;
    touched.add(c.from);
    touched.add(c.to);
  }
  // Message flows between two processes of one file: the processes of both ends
  // (a flow node the facts know, or the pool of a process).
  const connected = new Set<string>();
  for (const model of ix.input.projectFacts.models) {
    const poolProcess = new Map<string, string>();
    for (const f of model.facts) {
      if (f.kind === 'process' && f.attrs.participantId !== undefined) {
        poolProcess.set(`${model.modelKey}#${f.attrs.participantId}`, f.ref);
      }
    }
    const processOf = (ref: string) => ix.processOfRef.get(ref) ?? poolProcess.get(ref);
    for (const flow of model.messageFlows) {
      const a = processOf(flow.from);
      const b = processOf(flow.to);
      if (a === undefined || b === undefined || a === b) continue;
      connected.add(a);
      connected.add(b);
    }
  }
  const out: Draft[] = [];
  for (const p of [...ix.processes.values()].sort((a, b) => byCodePoint(a.ref, b.ref))) {
    if (connected.has(p.ref) || [...p.refs].some((r) => touched.has(r))) continue;
    const name = quoteDe(ix.processName(p.ref));
    out.push({
      kind: 'isolated-process',
      source: 'signal',
      subject: { type: 'process', id: p.ref },
      subjectLabel: name,
      version: ix.factsVersion([p.modelKey]),
      modelKeys: [p.modelKey],
      text:
        `Wie hängt ${name} mit dem Rest der Landschaft zusammen? Weder eine Beziehung noch ein ` +
        'Kandidat aus Regel, gleichem Namen oder ähnlicher Bezeichnung verbindet ihn mit einem anderen Prozess.',
      refs: [p.ref],
      raisedBy: rule(ix, p.modelKey),
      anchors: { processes: [p.ref] },
    });
  }
  return out;
}

/**
 * `descriptive-model` (informational): no engine and no executable process,
 * so the rule tier finds little; the agents carry the linking.
 */
function descriptiveModels(ix: OpenQuestionIndex): Draft[] {
  const out: Draft[] = [];
  for (const model of ix.input.projectFacts.models) {
    const head = ix.input.models.get(model.modelKey);
    if (!head || head.engine !== null || model.processes.length === 0) continue;
    if (model.processes.some((p) => p.isExecutable)) continue;
    out.push({
      kind: 'descriptive-model',
      source: 'signal',
      subject: { type: 'model', id: model.modelKey },
      subjectLabel: ix.modelName(model.modelKey),
      version: ix.factsVersion([model.modelKey]),
      modelKeys: [model.modelKey],
      text:
        `Hinweis: ${ix.modelName(model.modelKey)} ist ein beschreibendes Modell, ohne Engine und ` +
        'ohne ausführbaren Prozess. Die Regelebene findet hier wenig; Aufrufziele, ' +
        'Nachrichtennamen und Dokumentation helfen den Agenten, die Verbindungen zu finden.',
      refs: [],
      raisedBy: rule(ix, model.modelKey),
      // Informational: it asks nothing itself and ranks last; it counts the model's open decisions.
      anchors: { models: [model.modelKey] },
    });
  }
  return out;
}

const SIGNALS: Readonly<Record<GapSignal, (ix: OpenQuestionIndex) => Draft[]>> = {
  'black-box-partner': blackBoxPartners,
  'unlabelled-boundary': unlabelledBoundaries,
  'message-without-name': messagesWithoutName,
  'undocumented-process': undocumentedProcesses,
  'isolated-process': isolatedProcesses,
  'descriptive-model': descriptiveModels,
};

/** The drafts of the given signals, in {@link GAP_SIGNALS} order. */
export function signalQuestions(
  ix: OpenQuestionIndex,
  signals: readonly GapSignal[] = SHIPPED_SIGNALS,
): Draft[] {
  return GAP_SIGNALS.filter((s) => signals.includes(s)).flatMap((s) => SIGNALS[s](ix));
}
