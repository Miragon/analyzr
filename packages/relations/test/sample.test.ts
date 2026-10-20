// End to end over eval/corpus/_sample (real BPMN through @analyzr/bpmn-facts).
// The scored landscapes are gated by `pnpm eval:candidates` (eval/tools).
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FACTS_VERSION, extractFacts } from '@analyzr/bpmn-facts';
import type { ProjectFacts } from '@analyzr/contracts';
import { beforeAll, describe, expect, it } from 'vitest';

import { labelBaseline, generateCandidates, indexCandidates, runRules } from '../src/index.ts';

const corpus = (name: string) =>
  fileURLToPath(new URL(`../../../eval/corpus/${name}/models`, import.meta.url));
const SAMPLE = corpus('_sample');

async function sampleFacts(dir = SAMPLE): Promise<ProjectFacts> {
  const files = (await readdir(dir, { recursive: true })).filter((f) => f.endsWith('.bpmn')).sort();
  const models = await Promise.all(
    files.map(async (f) => {
      const modelKey = f.slice(0, -'.bpmn'.length).split(path.sep).join('/');
      const r = await extractFacts(await readFile(path.join(dir, f)), { modelKey });
      return {
        modelKey,
        factsVersion: FACTS_VERSION,
        processes: r.processes,
        facts: r.facts,
        messageFlows: r.messageFlows,
      };
    }),
  );
  return { models };
}

describe('_sample landscape', () => {
  let facts: ProjectFacts;
  beforeAll(async () => {
    facts = await sampleFacts();
  });

  it('accepts the unique call and proposes the shared message and signal names', () => {
    const { relations } = runRules(facts);
    expect(relations.map((r) => `${r.status} ${r.tier} ${r.type} ${r.from} -> ${r.to}`)).toEqual([
      'accepted rule call vertrieb/auftragsabwicklung#Call_ZahlungAbwickeln -> finance/payment-collection#Process_PaymentCollection',
      'proposed key message vertrieb/auftragsabwicklung#Event_WareVersandbereit -> finanzen/rechnungsstellung#Start_WareVersandbereit',
      'proposed key signal finanzen/rechnungsstellung#End_RechnungsstellungAbgeschlossen -> finance/payment-collection#Start_InvoicingCompleted',
      'proposed key signal finanzen/rechnungsstellung#End_RechnungsstellungAbgeschlossen -> vertrieb/auftragsabwicklung#Start_RechnungsstellungAbgeschlossen',
    ]);
  });

  it('reports the expected findings, plus both ends of the pair only a semantic link resolves', () => {
    const { findings } = runRules(facts);
    expect(findings.map((f) => `${f.kind} ${f.refs.join(' ')}`)).toEqual([
      'dangling-throw finance/payment-collection#Task_SendReminder',
      'dangling-throw finanzen/rechnungsstellung#Event_RechnungVersendet', // de-en must_link
      'dynamic-call finanzen/rechnungsstellung#Call_RechnungAusgeben',
      'unmatched-catch finance/payment-collection#Event_InvoiceSent', // its other end
      'unmatched-catch finance/payment-collection#Event_PaymentReceived',
      'unresolved-call finanzen/rechnungsstellung#Call_Mahnwesen',
    ]);
  });

  it('offers the German/English must_link as a lexical candidate and never the subprocess end', () => {
    const candidates = generateCandidates(facts);
    const pair = candidates.find(
      (c) =>
        c.from === 'finanzen/rechnungsstellung#Event_RechnungVersendet' &&
        c.to === 'finance/payment-collection#Event_InvoiceSent',
    );
    expect(pair?.basis).toBe('lexical');
    expect(
      candidates.some((c) => c.from === 'vertrieb/auftragsabwicklung#End_WareVersandbereit'),
    ).toBe(false);
  });

  it('lets baseline-label/1 fall for the subprocess end with the same label (event-def-mismatch)', () => {
    const baseline = labelBaseline(facts);
    expect(
      baseline.some(
        (r) =>
          r.from === 'vertrieb/auftragsabwicklung#End_WareVersandbereit' &&
          r.to === 'finanzen/rechnungsstellung#Start_WareVersandbereit',
      ),
    ).toBe(true);
  });
});

// The import's dry run asks one landscape about many focus models with one prepared index
// (M6 S2b follow-up): every focus model of the scored landscape (the holdout is left out) and
// the run without a focus give exactly the candidates of the calls without it.
describe('a prepared candidate index over a corpus landscape', () => {
  it.each(['_sample', 'nordwind-handel'])(
    '%s: the same candidates for every focus model',
    async (name) => {
      const facts = await sampleFacts(corpus(name));
      const prepared = indexCandidates(facts);
      for (const { modelKey } of facts.models) {
        expect(generateCandidates(facts, modelKey, undefined, prepared), modelKey).toEqual(
          generateCandidates(facts, modelKey),
        );
      }
      expect(generateCandidates(facts, undefined, undefined, prepared)).toEqual(
        generateCandidates(facts),
      );
    },
  );
});
