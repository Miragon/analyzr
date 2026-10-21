// Seeded random specs for the renderer's tests (M6 S3c §3.7) and the browser check
// (apps/web/e2e/spec-render-import.spec.ts, through spec-fuzz-write.ts): valid analyzr-spec/1
// values of 1–4 processes with 1–40 nodes each, sources of 1–200 characters (150–200 in a
// third of the specs), sources that look like generated ids (`Task_a_Task_b`, `x_di`,
// `<from>_<to>`) or like the ids bpmn-js derives (`x_label`, `x_plane`), unsafe sources and
// message names that come out alike, and texts from a hostile alphabet (`<>&"'`,
// U+0000–U+001F, U+0085, U+2028, bidi marks, U+FFFE, lone surrogates U+D800 and U+DFFF).
// Even seeds write specs as the agent does, odd ones as a converter (loose positions,
// tool ids and links). Imports nothing from vitest, so a plain Node script can use it.

/** A seeded pseudo-random generator (mulberry32): the same seed gives the same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FuzzSpec {
  seed: number;
  origin: 'hand' | 'converter';
  value: Record<string, unknown>;
}

const SOURCE_CHARS = Array.from(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.:äöüßÄÖÜé€ <>&"\'/#😀',
);
const SAFE_CHARS = Array.from('abcdefghijklmnopqrstuvwxyz0123456789_');
const TEXT_CHARS = [
  ...Array.from(
    'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ äöüß <>&"\'' +
      '\u0000\u0001\u0007\t\n\r\u001f\u0085  ‎‮⁦￾￿𐀀😀',
  ),
  // lone surrogates (two picked in a row may pair up, which is fine)
  '\ud800',
  '\udfff',
];
/** Message and signal names, among them pairs that come out alike as ids. */
const MESSAGE_NAMES = [
  'Auftrag',
  'Auftrag (neu)',
  'Auftrag neu',
  'Auftrag!',
  'Bestätigung',
  'Bestaetigung',
  'Rechnung <A&B>',
  'Rechnung "A&B"',
  'Mahnung\u0000',
  '‮Storno',
];

/** Builds one random valid spec. */
export function fuzzSpec(seed: number): FuzzSpec {
  const rnd = mulberry32(seed * 7919 + 17);
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  const chance = (p: number): boolean => rnd() < p;
  const pick = <T>(items: readonly T[]): T => {
    const item = items[int(0, items.length - 1)];
    if (item === undefined) throw new Error('empty pick');
    return item;
  };
  const origin = seed % 2 === 0 ? 'hand' : 'converter';
  const longSources = seed % 3 === 0;

  /** A string of `length` UTF-16 code units at most, from `chars`, never splitting a pair. */
  const randomText = (chars: readonly string[], length: number): string => {
    let out = '';
    while (out.length < length) {
      const c = pick(chars);
      if (out.length + c.length > length) break;
      out += c;
    }
    return out;
  };

  /** The first `max` code units of `s`, never ending in half a surrogate pair. */
  const cut = (s: string, max: number): string => s.slice(0, max).replace(/[\ud800-\udbff]$/, '');
  const used = new Set<string>();
  const unique = (candidate: string): string => {
    let s = candidate === '' ? 'x' : cut(candidate, 200);
    for (let n = 2; used.has(s); n++) s = `${cut(candidate, 190)}~${n}`;
    used.add(s);
    return s;
  };
  const sources: string[] = [];
  const source = (): string => {
    const r = rnd();
    let s: string;
    const prev = sources.length > 0 ? pick(sources) : null;
    if (prev !== null && r < 0.08) {
      s = `${prev}_di`; // like a generated DI id
    } else if (prev !== null && r < 0.12) {
      s = `${prev}${pick(['_label', '_plane'])}`; // like an id bpmn-js derives
    } else if (prev !== null && r < 0.16) {
      s = prev.replace(/_/g, ' '); // comes out alike as an id
    } else if (prev !== null && r < 0.22) {
      s = `Task_${cut(prev, 40)}_Task_${cut(pick(sources), 40)}`;
    } else if (r < 0.5) {
      s = randomText(SAFE_CHARS, longSources ? int(150, 200) : int(1, 12));
      if (/^[0-9]/.test(s)) s = `n${s.slice(1)}`;
    } else {
      s = randomText(SOURCE_CHARS, longSources ? int(150, 200) : int(1, 20));
    }
    if (s.trim() === '') s = `s${int(0, 999)}`;
    s = unique(s);
    sources.push(s);
    return s;
  };
  const text = (): string => {
    const r = rnd();
    const length = r < 0.08 ? int(190, 260) : int(0, 40);
    return randomText(TEXT_CHARS, length);
  };
  const maybeName = (): Record<string, string> => (chance(0.85) ? { name: text() } : {});
  const documentation = (): Record<string, string> =>
    chance(0.15)
      ? { documentation: randomText(TEXT_CHARS, chance(0.3) ? int(1900, 2600) : int(1, 300)) }
      : {};

  const participants = Array.from({ length: int(0, 2) }, () => ({
    source: source(),
    ...maybeName(),
  }));
  interface Node {
    source: string;
    type: string;
    process: number;
    record: Record<string, unknown>;
  }
  const allNodes: Node[] = [];
  const processes = Array.from({ length: int(1, 4) }, (_, pi) => {
    const lanes = Array.from({ length: chance(0.5) ? int(1, 3) : 0 }, () => ({
      source: source(),
      ...maybeName(),
    }));
    const stores = Array.from({ length: chance(0.4) ? int(1, 2) : 0 }, () => ({
      source: source(),
      ...maybeName(),
    }));
    const count = int(1, 40);
    const nodes: Node[] = [];
    for (let i = 0; i < count; i++) {
      const type =
        i === 0 && chance(0.9)
          ? 'start'
          : i === count - 1 && count > 1
            ? 'end'
            : pick([
                'task',
                'task',
                'task',
                'gateway',
                'event',
                'subprocess',
                'call',
                'start',
                'end',
              ]);
      const record: Record<string, unknown> = { source: source(), type };
      if (type !== 'call') Object.assign(record, maybeName());
      Object.assign(record, documentation());
      if (lanes.length > 0 && (origin === 'hand' || chance(0.85)))
        record['lane'] = pick(lanes).source;
      const messageName = (): void => {
        if (chance(0.6)) record['message'] = pick(MESSAGE_NAMES);
      };
      switch (type) {
        case 'start': {
          const trigger = pick(['none', 'message', 'signal', 'timer', 'absent']);
          if (trigger !== 'absent') record['trigger'] = trigger;
          if (trigger === 'message') messageName();
          if (trigger === 'signal' && chance(0.6)) record['signal'] = pick(MESSAGE_NAMES);
          break;
        }
        case 'end': {
          const trigger = pick(['none', 'message', 'signal', 'terminate', 'absent']);
          if (trigger !== 'absent') record['trigger'] = trigger;
          if (trigger === 'message') messageName();
          if (trigger === 'signal' && chance(0.6)) record['signal'] = pick(MESSAGE_NAMES);
          break;
        }
        case 'event': {
          const direction = pick(['catch', 'throw']);
          const trigger = pick(
            direction === 'catch' ? ['message', 'signal', 'timer'] : ['none', 'message', 'signal'],
          );
          Object.assign(record, { direction, trigger });
          if (trigger === 'message') messageName();
          if (trigger === 'signal' && chance(0.6)) record['signal'] = pick(MESSAGE_NAMES);
          break;
        }
        case 'task': {
          const kind = pick(['none', 'user', 'manual', 'service', 'send', 'receive', 'absent']);
          if (kind !== 'absent') record['kind'] = kind;
          if (kind === 'send' || kind === 'receive') messageName();
          break;
        }
        case 'gateway':
          record['kind'] = pick(['exclusive', 'parallel', 'inclusive', 'event-based']);
          break;
        case 'call':
          record['target'] = `P${text()}`;
          break;
        default:
          break;
      }
      if ((type === 'task' || type === 'subprocess') && stores.length > 0) {
        if (chance(0.4)) record['reads'] = [pick(stores).source];
        if (chance(0.3)) record['writes'] = [pick(stores).source];
      }
      const node = { source: String(record['source']), type, process: pi, record };
      nodes.push(node);
      allNodes.push(node);
    }

    // flows: each node after the first from an earlier one, some extra, some back, some to itself
    const flows: Record<string, unknown>[] = [];
    const pairs = new Map<string, Record<string, unknown>[]>();
    const canLeave = (n: Node): boolean => origin === 'converter' || n.type !== 'end';
    const canEnter = (n: Node): boolean => origin === 'converter' || n.type !== 'start';
    const addFlow = (from: Node, to: Node): void => {
      if (!canLeave(from) || !canEnter(to)) return;
      const flow: Record<string, unknown> = { from: from.source, to: to.source };
      if (chance(0.3)) flow['name'] = text();
      if (chance(0.15)) {
        flow['source'] = chance(0.5) ? unique(`${from.source}_${to.source}`) : source();
      }
      const key = `${from.source}\u0000${to.source}`;
      const same = pairs.get(key) ?? [];
      if (same.length > 0) {
        for (const f of [...same, flow]) f['source'] ??= source();
      }
      pairs.set(key, [...same, flow]);
      flows.push(flow);
    };
    for (let i = 1; i < nodes.length; i++) {
      const to = nodes[i];
      const candidates = nodes.slice(0, i).filter(canLeave);
      if (to !== undefined && candidates.length > 0) addFlow(pick(candidates), to);
    }
    for (let k = int(0, Math.ceil(nodes.length / 4)); k > 0; k--) {
      const a = pick(nodes);
      const b = pick(nodes);
      if (a !== b) addFlow(a, b);
    }
    if (chance(0.2)) {
      const loop = nodes.filter((n) => n.type === 'task' || n.type === 'gateway');
      if (loop.length > 0) {
        const n = pick(loop);
        addFlow(n, n);
      }
    }
    return {
      source: source(),
      ...maybeName(),
      ...documentation(),
      ...(chance(0.3) ? { pool: text() } : {}),
      ...(lanes.length > 0 ? { lanes } : {}),
      ...(stores.length > 0 ? { dataStores: stores } : {}),
      nodes: nodes.map((n) => n.record),
      ...(flows.length > 0 ? { flows } : {}),
    };
  });

  // message flows between different pools (never a gateway)
  const ends: { source: string; pool: string }[] = [
    ...allNodes
      .filter((n) => n.type !== 'gateway')
      .map((n) => ({ source: n.source, pool: `p${n.process}` })),
    ...processes.map((p, i) => ({ source: p.source, pool: `p${i}` })),
    ...participants.map((p) => ({ source: p.source, pool: p.source })),
  ];
  const messageFlows: Record<string, unknown>[] = [];
  const mfPairs = new Map<string, Record<string, unknown>[]>();
  const pools = new Set(ends.map((e) => e.pool));
  if (pools.size > 1) {
    for (let k = int(0, 6); k > 0; k--) {
      const a = pick(ends);
      const b = pick(ends);
      if (a.pool === b.pool) continue;
      const flow: Record<string, unknown> = { from: a.source, to: b.source };
      if (chance(0.5)) flow['name'] = text();
      const key = `${a.source}\u0000${b.source}`;
      const same = mfPairs.get(key) ?? [];
      if (same.length > 0) for (const f of [...same, flow]) f['source'] ??= source();
      mfPairs.set(key, [...same, flow]);
      messageFlows.push(flow);
    }
  }

  const value: Record<string, unknown> = {
    format: 'analyzr-spec/1',
    source: {
      externalPath: `Fuzz/Modell ${seed}`,
      ...(origin === 'converter' && chance(0.5) ? { externalId: `fuzz-${seed}` } : {}),
      ...(origin === 'converter' && chance(0.3)
        ? { url: `https://tool.beispiel.example/model/${seed}` }
        : {}),
    },
    ...(origin === 'hand'
      ? { derived: { kind: 'reconstructed', llmModel: 'claude-opus-5-5' } }
      : {}),
    ...(participants.length > 0 ? { participants } : {}),
    processes,
    ...(messageFlows.length > 0 ? { messageFlows } : {}),
  };
  return { seed, origin, value };
}
