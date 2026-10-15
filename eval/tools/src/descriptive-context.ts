// What eval:descriptive's transforms (lib/descriptive.mjs) need from the
// whole landscape, computed from the original models' facts: the name of each
// call activity's callee and, for each message endpoint that talks to another
// model, its partners. Partners come from the model files alone (the rule
// tier's key-tier pairs: equal message names), never from expected.yaml, so a
// transformed model carries no ground truth.
//
// Both names are the optimistic case: a collapsed subprocess carries the
// callee's exact process name and a black-box pool the partner's exact pool
// name, both known here only through the call targets and message names the
// descriptive variants strip. Facts v1 reads neither, so no number depends on
// them today; a facts version that matches subprocess or pool names against
// processes needs a pessimistic variant first (names not copied verbatim),
// or the key tier comes back in through the names.
import type { ProcessInfo, ProjectFacts, Ref } from '@analyzr/contracts';
import { indexLandscape, runRules } from '@analyzr/relations';

import type { MessagePartners, TransformContext } from '../lib/descriptive.mjs';

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A process as a callee or a black-box pool calls it: its name, else its pool's, else its id. */
export function calleeName(p: Pick<ProcessInfo, 'name' | 'participantName' | 'processId'>): string {
  return p.name ?? p.participantName ?? p.processId;
}

/** A partner process as a black-box pool shows it: its pool's name, else its own, else its id. */
export function poolName(p: Pick<ProcessInfo, 'name' | 'participantName' | 'processId'>): string {
  return p.participantName ?? p.name ?? p.processId;
}

const elementIdOf = (ref: Ref): string => ref.slice(ref.indexOf('#') + 1);

/**
 * The pool of an endpoint the rule tier pairs with no other model: one
 * neutral name, so the pool carries neither the message name the descriptive
 * variant strips nor anything else from the endpoint.
 */
export const UNKNOWN_PARTNER = 'Externer Partner';

/**
 * The transform context of every model of a landscape (by model key):
 * - `callees`: every call activity; a static target that a process of the
 *   landscape has as id gives that process's name (the first by ref when the
 *   id is not unique), otherwise `null` (the activity keeps its name);
 * - `messages`: every message endpoint without a message flow inside its
 *   file; its partners are the processes the rule tier pairs it with by
 *   message name (pool names, deduplicated and sorted); without such a
 *   pair, the one pool {@link UNKNOWN_PARTNER}.
 */
export function transformContexts(projectFacts: ProjectFacts): Map<string, TransformContext> {
  const index = indexLandscape(projectFacts);
  const rules = runRules(projectFacts);
  const processByRef = new Map(index.processes.map((p) => [p.ref, p]));
  const contexts = new Map<string, TransformContext>();
  const ctxOf = (modelKey: string): TransformContext => {
    let ctx = contexts.get(modelKey);
    if (!ctx) {
      ctx = { callees: {}, messages: {} };
      contexts.set(modelKey, ctx);
    }
    return ctx;
  };
  for (const m of projectFacts.models) ctxOf(m.modelKey);

  for (const call of index.endpoints.call.from) {
    const target = call.name === null ? undefined : index.processesById.get(call.name)?.[0];
    ctxOf(call.modelKey).callees[call.fact.elementId] = target ? calleeName(target) : null;
  }

  const partnersOf = new Map<Ref, Set<string>>();
  const note = (ref: Ref, processRef: Ref): void => {
    const p = processByRef.get(processRef);
    if (!p) return;
    const set = partnersOf.get(ref) ?? new Set<string>();
    set.add(poolName(p));
    partnersOf.set(ref, set);
  };
  const endpoints = new Map([...index.endpoints.message.from, ...index.endpoints.message.to].map((e) => [e.ref, e]));
  for (const r of rules.relations) {
    if (r.type !== 'message') continue;
    const from = endpoints.get(r.from);
    const to = endpoints.get(r.to);
    if (from && to) {
      note(from.ref, to.process);
      note(to.ref, from.process);
    }
  }
  for (const side of ['from', 'to'] as const) {
    for (const e of index.endpoints.message[side]) {
      if (index.messageFlowRefs.has(e.ref)) continue;
      const found = [...(partnersOf.get(e.ref) ?? [])].sort(compareStrings);
      const entry: MessagePartners = {
        direction: side === 'from' ? 'out' : 'in',
        partners: found.length > 0 ? found : [UNKNOWN_PARTNER],
      };
      ctxOf(e.modelKey).messages[elementIdOf(e.ref)] = entry;
    }
  }
  return contexts;
}
