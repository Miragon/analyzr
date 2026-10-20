import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ImpactPlacement, ImportImpact, TrustReason } from '@analyzr/client';
import { describe, expect, it } from 'vitest';

import {
  agentCostText,
  claimedImportWarning,
  pairsToJudgeText,
  possibleRelationsText,
  processesToPlace,
} from '../src/lib/agent-cost';

import {
  DOCKER_CONTAINER,
  claudeCodeCommand,
  claudeDesktopNodeConfig,
  serverOrigin,
} from '../src/lib/agent-config';
import { provenanceOf } from '../src/lib/labels';
import { buildRefIndex, resolverOf, splitRef } from '../src/lib/refs';
import {
  compareRelations,
  filterRelations,
  parseRelationFilters,
} from '../src/lib/relation-filters';
import { isProjectKey, slugify } from '../src/lib/slug';
import { BPMN_FILE_SUFFIXES } from '@analyzr/contracts/paths';

import {
  BPMN_ACCEPT,
  BPMN_SUFFIX_TEXT,
  batchNoteText,
  callsWaitingText,
  elementTypeLabel,
  entriesFromFileList,
  fileProblemText,
  filesOf,
  groupWarnings,
  identityUpdateText,
  importHeadline,
  impactLines,
  isSkippedXml,
  mergeImpacts,
  placementChangeText,
  planUpload,
  previewHeadline,
  rejudgedText,
  sharedTopFolder,
  skippedReasonText,
  stripRoot,
  waitingText,
  warningCountText,
  warningDisplay,
  warningGroupCount,
  warningLabel,
} from '../src/lib/upload';
import { relation, sampleRelations } from './support/fixtures';

describe('upload planning', () => {
  const file = (name: string, size = 10) => new File(['x'.repeat(size)], name);

  it('keeps the path below the dropped folder', () => {
    expect(stripRoot('models/vertrieb/auftrag.bpmn')).toBe('vertrieb/auftrag.bpmn');
    expect(stripRoot('auftrag.bpmn')).toBe('auftrag.bpmn');
    const f = file('auftrag.bpmn');
    Object.defineProperty(f, 'webkitRelativePath', { value: 'models/vertrieb/auftrag.bpmn' });
    expect(entriesFromFileList([f, file('lose.bpmn')]).map((e) => e.path)).toEqual([
      'vertrieb/auftrag.bpmn',
      'lose.bpmn',
    ]);
  });

  it('takes the BPMN endings of the shared file rule (M6 S1)', () => {
    const entries = [
      'a.bpmn',
      'b.BPMN',
      'c.bpmn2',
      'd.bpmn20.xml',
      'e.xml',
      'f.yaml',
      'g.bpmn.bak',
    ];
    const plan = planUpload(entries.map((p) => ({ path: p, file: file(p) })));
    expect(plan.batches.flat().map((e) => e.path)).toEqual([
      'a.bpmn',
      'b.BPMN',
      'c.bpmn2',
      'd.bpmn20.xml',
      'e.xml',
    ]);
    expect(plan.skipped).toEqual([
      { path: 'f.yaml', reason: 'not-bpmn' },
      { path: 'g.bpmn.bak', reason: 'not-bpmn' },
    ]);
    expect(plan.failed).toEqual([]);
    // The picker and the text name every suffix of the rule.
    expect(BPMN_ACCEPT.split(',').sort()).toEqual([...BPMN_FILE_SUFFIXES].sort());
    expect(BPMN_SUFFIX_TEXT).toBe('.bpmn, .bpmn2, .bpmn20.xml und .xml');
  });

  it('drops hidden files silently, also macOS resource forks', () => {
    const entries = [
      '._auftrag.bpmn',
      'vertrieb/._x.bpmn',
      '.DS_Store',
      '.git/config.xml',
      'a.bpmn',
    ];
    const plan = planUpload(entries.map((p) => ({ path: p, file: file(p) })));
    expect(plan.batches.flat().map((e) => e.path)).toEqual(['a.bpmn']);
    expect(plan.skipped).toEqual([]);
    expect(plan.failed).toEqual([]);
  });

  it('fails a file without a valid key, or with the key of an earlier file, before sending', () => {
    const entries = ['---.bpmn', 'vertrieb/Auftrag.bpmn', 'vertrieb/auftrag.bpmn2', 'z.bpmn'];
    // One file per batch: without the check the duplicate would go in a batch of its own.
    const plan = planUpload(
      entries.map((p) => ({ path: p, file: file(p) })),
      { maxFiles: 1, maxBytes: 100, maxModelBytes: 100 },
    );
    expect(plan.batches.map((b) => b.map((e) => e.path))).toEqual([
      ['vertrieb/Auftrag.bpmn'],
      ['z.bpmn'],
    ]);
    expect(plan.failed).toEqual([
      {
        path: '---.bpmn',
        modelKey: null,
        outcome: 'failed',
        problem: {
          type: 'urn:analyzr:problem:validation-failed',
          title: 'Validation failed',
          status: 422,
          code: 'validation-failed',
          detail: 'the path gives no valid model key',
          reason: 'no-model-key',
        },
      },
      {
        path: 'vertrieb/auftrag.bpmn2',
        modelKey: 'vertrieb/auftrag',
        outcome: 'failed',
        problem: {
          type: 'urn:analyzr:problem:validation-failed',
          title: 'Validation failed',
          status: 422,
          code: 'validation-failed',
          detail:
            'another file of this import has model key vertrieb/auftrag (vertrieb/Auftrag.bpmn)',
          reason: 'duplicate-key',
          owner: 'vertrieb/Auftrag.bpmn',
        },
      },
    ]);
  });

  it('gives a key to a .bpmn… file before a plain .xml, whichever sorts first', () => {
    const entries = ['order-process.bpmn', 'Order_Process.xml', 'Order.xml', 'order.bpmn'];
    const plan = planUpload(entries.map((p) => ({ path: p, file: file(p) })));
    expect(plan.batches.flat().map((e) => e.path)).toEqual(['order-process.bpmn', 'order.bpmn']);
    expect(plan.failed).toEqual([]);
    expect(plan.skipped).toEqual([
      { path: 'Order.xml', reason: 'key-taken', takenBy: 'order.bpmn' },
      { path: 'Order_Process.xml', reason: 'key-taken', takenBy: 'order-process.bpmn' },
    ]);
  });

  it('skips a sidecar .xml whose key a .bpmn file has; two plain .xml files stay duplicates', () => {
    // As analyzr import (apps/cli/test/unit/import.test.ts): the sidecar is never sent.
    const entries = ['Prozess.bpmn', 'Prozess.xml', 'Order.xml', 'order.xml', 'big.xml'];
    const plan = planUpload(
      entries.map((p) => ({ path: p, file: file(p, p === 'big.xml' ? 200 : 10) })),
      { maxFiles: 50, maxBytes: 1000, maxModelBytes: 100 },
    );
    expect(plan.batches.flat().map((e) => e.path)).toEqual(['Order.xml', 'Prozess.bpmn']);
    expect(plan.skipped).toEqual([
      { path: 'Prozess.xml', reason: 'key-taken', takenBy: 'Prozess.bpmn' },
      { path: 'big.xml', reason: 'too-large' },
    ]);
    expect(plan.failed.map((f) => [f.path, f.problem?.detail])).toEqual([
      ['order.xml', 'another file of this import has model key order (Order.xml)'],
    ]);
    expect(plan.skipped.map(skippedReasonText)).toEqual([
      'gleicher Kurzname wie Prozess.bpmn',
      'größer als 5,0 MB',
    ]);
    expect(skippedReasonText({ path: 'a.yaml', reason: 'not-bpmn' })).toBe('kein BPMN');
  });

  it('picks the same file for a key as analyzr import: code-point order, not the locale', () => {
    // apps/cli/test/unit/import.test.ts pins the same winner for planImport.
    const plan = planUpload(['a_b.bpmn', 'a-b.bpmn'].map((p) => ({ path: p, file: file(p) })));
    expect(plan.batches.flat().map((e) => e.path)).toEqual(['a-b.bpmn']);
    expect(plan.failed.map((f) => f.path)).toEqual(['a_b.bpmn']);
  });

  it('skips a plain .xml the server found to be no BPMN; other refusals stay failed', () => {
    const refused = (path: string, reason: string) => ({
      path,
      modelKey: 'x',
      outcome: 'failed' as const,
      problem: {
        type: 'urn:analyzr:problem:bpmn-invalid',
        title: 'BPMN invalid',
        status: 422,
        code: 'bpmn-invalid' as const,
        reason,
      },
    });
    expect(isSkippedXml(refused('export/meta.xml', 'not-bpmn'))).toBe(true);
    expect(isSkippedXml(refused('export/aris.xml', 'doctype-forbidden'))).toBe(false);
    // A .bpmn that is no BPMN is a failed model, not an unrelated XML file.
    expect(isSkippedXml(refused('a.bpmn', 'not-bpmn'))).toBe(false);
    expect(isSkippedXml(refused('a.bpmn20.xml', 'not-bpmn'))).toBe(false);
    expect(isSkippedXml({ path: 'a.xml', modelKey: 'a', outcome: 'created', problem: null })).toBe(
      false,
    );
  });

  it('labels the warning codes in German; an unknown code shows its code', () => {
    expect(warningLabel('parse-warning')).toBe('Unbekannter oder fehlerhafter Inhalt');
    expect(warningLabel('missing-id')).toBe('Element ohne ID übersprungen');
    expect(warningLabel('invalid-id')).toBe('Ungültige ID: Element übersprungen');
    expect(warningLabel('duplicate-id')).toBe('Doppelte ID: zweites Element übersprungen');
    expect(warningLabel('call-without-target')).toBe('Aufruf ohne Ziel');
    expect(warningLabel('message-flow-unresolved')).toBe(
      'Nachrichtenfluss ohne gültiges Ende übersprungen',
    );
    for (const code of ['label-truncated', 'key-truncated', 'documentation-truncated']) {
      expect(warningLabel(code)).toBe('Text gekürzt');
    }
    expect(warningLabel('too-many-warnings')).toBe('Weitere Hinweise ausgelassen');
    expect(warningLabel('brand-new-code')).toBe('brand-new-code');
    expect(warningLabel('toString')).toBe('toString');
    expect(warningCountText(1)).toBe('1 Hinweis');
    expect(warningCountText(3)).toBe('3 Hinweise');
  });

  it("shows the extractor's too-many-warnings entry after the unlisted warnings", () => {
    const few = [{ code: 'parse-warning', message: 'a' }];
    expect(warningDisplay(few, 3)).toEqual({ listed: few, count: 3, unlisted: 2 });
    // Beyond 100 the server lists the first 19 and the extractor's own entry last.
    const omitted = { code: 'too-many-warnings', message: '150 more warnings omitted' };
    const capped = [
      ...Array.from({ length: 19 }, (_, i) => ({ code: 'parse-warning', message: `w${i}` })),
      omitted,
    ];
    expect(warningDisplay(capped, 101)).toEqual({
      listed: capped.slice(0, 19),
      omitted,
      count: 100,
      unlisted: 81,
    });
  });

  it('skips non-BPMN, hidden and oversized files and splits by count and bytes', () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, i) => ({
        path: `m/${i}.bpmn`,
        file: file(`${i}.bpmn`, 40),
      })),
      { path: 'README.md', file: file('README.md') },
      { path: '.git/config.xml', file: file('config.xml') },
      { path: 'big.bpmn', file: file('big.bpmn', 200) },
    ];
    const plan = planUpload(entries, { maxFiles: 2, maxBytes: 100, maxModelBytes: 100 });
    expect(plan.failed).toEqual([]);
    // Code-point order (comparePaths), as the CLI: capitals first.
    expect(plan.skipped).toEqual([
      { path: 'README.md', reason: 'not-bpmn' },
      { path: 'big.bpmn', reason: 'too-large' },
    ]);
    expect(plan.batches.map((b) => b.map((e) => e.path))).toEqual([
      ['m/0.bpmn', 'm/1.bpmn'],
      ['m/2.bpmn', 'm/3.bpmn'],
      ['m/4.bpmn'],
    ]);
    const tight = planUpload(entries.slice(0, 3), {
      maxFiles: 50,
      maxBytes: 90,
      maxModelBytes: 100,
    });
    expect(tight.batches.map((b) => b.length)).toEqual([2, 1]);
  });

  it('names each multipart part after its path', () => {
    const [part] = filesOf([{ path: 'vertrieb/auftrag.bpmn', file: file('auftrag.bpmn') }]);
    expect(part!.name).toBe('vertrieb/auftrag.bpmn');
    expect(part!.size).toBe(10);
  });
});

describe('upload result (UX7)', () => {
  const pw = (message: string, elementId?: string) => ({
    code: 'parse-warning',
    message,
    ...(elementId ? { elementId } : {}),
  });

  it('groups skipped elements by cause and folds their shapes and references in', () => {
    const groups = groupWarnings([
      pw('unresolved reference <T1>', 'Flow_1'),
      pw(
        'unparsable content <bpmn:userTask> detected line: 3 column: 4 nested error: illegal ID <T1>',
      ),
      pw(
        'unparsable content <bpmn:task> detected line: 5 column: 4 nested error: duplicate ID <T2>',
      ),
      pw(
        'unparsable content <bpmndi:BPMNShape> detected line: 9 column: 4 nested error: illegal ID <T1_di>',
      ),
      // the extractor's own checks read the same
      { code: 'invalid-id', message: '<bpmn:Task> id "a b" is not a valid element id; skipped' },
      { code: 'duplicate-id', message: 'a second task with id T3 skipped', elementId: 'T3' },
      // a reference to an element that was not skipped, a cut message: on their own
      pw('unresolved reference <Elsewhere>'),
      pw(
        'unparsable content <bpmn:task> detected line: 7 column: 4 nested error: illegal ID <aaaa…',
      ),
    ]);
    expect(groups.map((g) => (g.kind === 'skipped' ? g.cause : g.warning.message))).toEqual([
      'invalid-id',
      'duplicate-id',
      'unresolved reference <Elsewhere>',
      'unparsable content <bpmn:task> detected line: 7 column: 4 nested error: illegal ID <aaaa…',
    ]);
    const [invalid, duplicate] = groups;
    expect(invalid).toMatchObject({
      elements: [
        { type: 'Benutzeraufgabe', id: 'T1' },
        { type: 'Aufgabe', id: 'a b' },
      ],
    });
    expect(invalid?.kind === 'skipped' && invalid.raw).toHaveLength(4);
    expect(duplicate).toMatchObject({
      elements: [
        { type: 'Aufgabe', id: 'T2' },
        { type: 'Element', id: 'T3' },
      ],
    });
    // „N Hinweise“: one per skipped element, one per other entry, the unlisted too
    expect(warningGroupCount(groups, 5)).toBe(4 + 2 + 5);
  });

  it('keeps a diagram line whose cause no element shares as an entry of its own', () => {
    const groups = groupWarnings([
      pw(
        'unparsable content <sbpmndi:BPMNEdge> detected line: 4 column: 73 nested error: duplicate ID <E>',
      ),
    ]);
    expect(groups).toEqual([
      { kind: 'single', warning: expect.objectContaining({ code: 'parse-warning' }) as unknown },
    ]);
    expect(elementTypeLabel('bpmn:dataStoreReference')).toBe('Datenspeicher');
    expect(elementTypeLabel('foo:bar')).toBe('Element');
  });

  it('heads the result with what happened, and says the progress while it runs', () => {
    const o = (outcome: 'created' | 'revised' | 'unchanged' | 'failed') => ({ outcome });
    expect(importHeadline([o('created'), o('revised'), o('failed')], 1)).toBe(
      '2 Modelle importiert · 1 Fehler · 1 übersprungen',
    );
    expect(importHeadline([o('unchanged')], 0)).toBe('Kein Modell importiert · 1 unverändert');
    expect(importHeadline([o('created')], 0, { total: 6 })).toBe('Importiere … 1 von 6 Dateien');
  });

  it('says why a file failed in German, by code, reason and encoding', () => {
    const problem = (code: string, extra: Record<string, unknown> = {}) => ({
      type: `urn:analyzr:problem:${code}`,
      title: 'x',
      status: 422,
      code: code as 'bpmn-invalid',
      ...extra,
    });
    expect(fileProblemText(problem('bpmn-invalid', { reason: 'not-bpmn' }))).toBe(
      'Die Datei enthält kein BPMN-2.0-Modell.',
    );
    expect(fileProblemText(problem('bpmn-invalid', { reason: 'not-xml' }))).toMatch(
      /^Die Datei ist kein vollständiges XML/,
    );
    expect(fileProblemText(problem('payload-too-large'))).toBe('Die Datei ist größer als 5,0 MB.');
    expect(fileProblemText(problem('validation-failed', { reason: 'no-model-key' }))).toBe(
      'Aus dem Pfad ergibt sich kein gültiger Kurzname.',
    );
    // any other problem: the shell's sentence for its code
    expect(fileProblemText(problem('conflict'))).toBe(
      'Das passt nicht mehr zum aktuellen Stand. Lade neu und prüf den neuen Stand.',
    );
  });

  it('heads a preview, says at most three of its changes, and spots a shared top folder (M6 S2b)', () => {
    const o = (outcome: 'created' | 'revised' | 'unchanged' | 'failed') => ({ outcome });
    expect(previewHeadline([o('created'), o('created'), o('revised'), o('failed')], 1)).toBe(
      'Vorschau: 2 Modelle neu · 1 neue Revision · 1 Fehler · 1 übersprungen',
    );
    expect(previewHeadline([], 0)).toBe('Vorschau: nichts zu importieren');
    const list = (count: number) => ({ count, items: [] });
    const proposedCalls = (count: number) => ({ ...list(count), wasAccepted: 0, byReason: [] });
    const impact = {
      files: [],
      acceptedCalls: list(1),
      callsProposed: proposedCalls(0),
      proposalsAdded: list(4),
      proposalsWithdrawn: list(2),
      endpointsChanged: list(0),
      findingsAdded: list(1),
      findingsResolved: list(0),
      absentKeys: list(0),
      relationsTasks: {
        queued: list(0),
        cancelled: list(0),
        claimed: 0,
        pairs: 0,
        rejudged: list(0),
      },
    };
    expect(impactLines(impact)).toEqual([
      '1 Aufruf automatisch verknüpft',
      '4 neue Vorschläge der Regeln zu prüfen',
      '2 Vorschläge der Regeln zurückgezogen',
    ]);
    expect(
      impactLines({
        ...impact,
        acceptedCalls: list(0),
        proposalsAdded: list(0),
        proposalsWithdrawn: list(0),
        findingsAdded: list(0),
      }),
    ).toEqual([]);
    const merged = mergeImpacts([impact, { ...impact, absentKeys: { count: 1, items: ['x'] } }]);
    expect(merged.proposalsAdded.count).toBe(8);
    expect(merged.absentKeys.count).toBe(0);
    // The trust rule (M6 S2c): calls of derived models only proposed, with the reason most of
    // them rest on (the server's totals, each call under its caller's first reason).
    const calls = (count: number, ...byReason: [TrustReason, number][]) => ({
      ...proposedCalls(0),
      count,
      byReason: byReason.map(([reason, n]) => ({ reason, count: n })),
    });
    const proposed = {
      ...impact,
      callsProposed: calls(12, ['no-engine', 2], ['agent-upload', 7], ['converted', 3]),
    };
    expect(impactLines(proposed)).toEqual([
      '1 Aufruf automatisch verknüpft',
      '12 Aufrufe nur vorgeschlagen (über ein Agenten-Token hochgeladen) – nach dem Import gesammelt annehmen',
      '4 neue Vorschläge der Regeln zu prüfen',
    ]);
    // A tie goes to the first reason in their order; without reasons, none.
    expect(
      impactLines({
        ...proposed,
        acceptedCalls: list(0),
        callsProposed: calls(2, ['no-engine', 1], ['converted', 1]),
      })[0],
    ).toBe(
      '2 Aufrufe nur vorgeschlagen (ohne Camunda-Engine) – nach dem Import gesammelt annehmen',
    );
    expect(impactLines({ ...proposed, acceptedCalls: list(0), callsProposed: calls(1) })[0]).toBe(
      '1 Aufruf nur vorgeschlagen – nach dem Import gesammelt annehmen',
    );
    // Batches merge by their totals, reasons in their order.
    const second = {
      ...impact,
      callsProposed: { ...calls(3, ['no-engine', 3]), wasAccepted: 2 },
    };
    expect(
      mergeImpacts([
        { ...proposed, callsProposed: { ...proposed.callsProposed, wasAccepted: 5 } },
        second,
      ]).callsProposed,
    ).toEqual({
      count: 15,
      items: [],
      wasAccepted: 7,
      byReason: [
        { reason: 'no-engine', count: 5 },
        { reason: 'agent-upload', count: 7 },
        { reason: 'converted', count: 3 },
      ],
    });
    // The models of the source system the bundle no longer names, with fewer than three
    // weightier lines.
    expect(impactLines({ ...impact, proposalsWithdrawn: list(0), absentKeys: list(3) })).toEqual([
      '1 Aufruf automatisch verknüpft',
      '4 neue Vorschläge der Regeln zu prüfen',
      '3 Modelle des Quellsystems nicht im Bundle (bleiben erhalten)',
    ]);
    expect(sharedTopFolder(['gemeinsam/a', 'gemeinsam/b/c'])).toBe('gemeinsam');
    expect(sharedTopFolder(['gemeinsam/a', 'anders/b'])).toBeNull();
    expect(sharedTopFolder(['a', 'b'])).toBeNull();
    expect(sharedTopFolder(['gemeinsam/a'])).toBeNull();
  });

  it('names the places in the tool a preview of unchanged files would record (S2b follow-up step 5)', () => {
    expect(identityUpdateText(1)).toBe('Ort im Quellsystem für 1 Modell aktualisiert');
    expect(identityUpdateText(6)).toBe('Ort im Quellsystem für 6 Modelle aktualisiert');
    expect(identityUpdateText(1214)).toBe('Ort im Quellsystem für 1.214 Modelle aktualisiert');
  });

  it('notes what a preview of several batches cannot see, the pairs between new models of two batches too, and where their whole number shows (S2b follow-up, step 3b)', () => {
    const batch = (...paths: string[]) => paths.map((path) => ({ path }));
    const outcome = (path: string, o: string) => ({ path, outcome: o });
    const calls =
      'Vorschau je 50 Dateien; Aufrufe zwischen den Teilen erscheinen hier als unaufgelöst';
    expect(batchNoteText([batch('a.bpmn', 'b.bpmn')], [outcome('a.bpmn', 'created')])).toBeNull();
    // a re-import: the pairs between two batches' models count in both, which „etwa“ covers
    expect(
      batchNoteText(
        [batch('a.bpmn'), batch('b.bpmn')],
        [outcome('a.bpmn', 'revised'), outcome('b.bpmn', 'revised')],
      ),
    ).toBe(`${calls}.`);
    // new models in one batch only: their pairs with the head's models count
    expect(
      batchNoteText(
        [batch('a.bpmn'), batch('b.bpmn', 'c.bpmn')],
        [
          outcome('a.bpmn', 'unchanged'),
          outcome('b.bpmn', 'created'),
          outcome('c.bpmn', 'created'),
        ],
      ),
    ).toBe(`${calls}.`);
    // a first import in parts: the pairs between them count in no batch
    expect(
      batchNoteText(
        [batch('a.bpmn'), batch('b.bpmn')],
        [outcome('a.bpmn', 'created'), outcome('b.bpmn', 'created')],
      ),
    ).toBe(
      `${calls}, mögliche Relationen zwischen neuen Modellen verschiedener Teile fehlen in der Zahl; die ganze Zahl steht nach dem Import unter „Als Nächstes“.`,
    );
  });

  it('adds what an owner’s rules for derived calls accept at once to the „Vorschau“ line (M6 S2c-3)', () => {
    const list = (count: number) => ({ count, items: [] });
    const call = { type: 'call' as const, from: 'a#C' as const, to: 'b#P' as const };
    const auto = (...byRule: [string, number][]) =>
      withOf(
        byRule.reduce((n, [, c]) => n + c, 0),
        byRule,
      );
    /** `ofProposed` of them among the calls proposed anew. */
    const withOf = (ofProposed: number, byRule: [string, number][]) => ({
      count: byRule.reduce((n, [, c]) => n + c, 0),
      ofProposed,
      items: byRule.flatMap(([ruleName, c]) =>
        Array.from({ length: c }, () => ({
          ...call,
          ruleId: `aar_${ruleName}` as const,
          ruleName,
        })),
      ),
      byRule: byRule.map(([ruleName, c]) => ({
        ruleId: `aar_${ruleName}` as const,
        ruleName,
        count: c,
      })),
    });
    const impact = {
      files: [],
      acceptedCalls: list(0),
      callsProposed: {
        count: 12,
        items: [],
        wasAccepted: 0,
        byReason: [{ reason: 'no-engine' as const, count: 12 }],
      },
      proposalsAdded: list(0),
      proposalsWithdrawn: list(0),
      endpointsChanged: list(0),
      findingsAdded: list(0),
      findingsResolved: list(0),
      absentKeys: list(0),
      relationsTasks: {
        queued: list(0),
        cancelled: list(0),
        claimed: 0,
        pairs: 0,
        rejudged: list(0),
      },
    };
    // All of them: nothing left to accept after the import.
    expect(impactLines({ ...impact, autoAcceptedCalls: auto(['Signavio-Export', 12]) })).toEqual([
      '12 Aufrufe nur vorgeschlagen (ohne Camunda-Engine) · deine Regel „Signavio-Export“ nimmt 12 davon gleich an',
    ]);
    expect(impactLines({ ...impact, autoAcceptedCalls: auto(['A', 3], ['B', 2]) })).toEqual([
      '12 Aufrufe nur vorgeschlagen (ohne Camunda-Engine) – nach dem Import gesammelt annehmen · deine Regeln nehmen 5 davon gleich an',
    ]);
    // An owner without such rules, and everyone else: the line of S2c.
    for (const autoAcceptedCalls of [auto(), undefined]) {
      expect(
        impactLines({ ...impact, ...(autoAcceptedCalls ? { autoAcceptedCalls } : {}) }),
      ).toEqual([
        '12 Aufrufe nur vorgeschlagen (ohne Camunda-Engine) – nach dem Import gesammelt annehmen',
      ]);
    }
    // Re-recorded proposals of calls proposed already: a line of their own.
    const none = { ...impact.callsProposed, count: 0, byReason: [] };
    expect(
      impactLines({
        ...impact,
        callsProposed: none,
        autoAcceptedCalls: withOf(0, [['Signavio-Export', 1]]),
      }),
    ).toEqual([
      '1 bereits vorgeschlagener Aufruf – deine Regel „Signavio-Export“ nimmt ihn gleich an',
    ]);
    expect(
      impactLines({ ...impact, callsProposed: none, autoAcceptedCalls: withOf(0, [['A', 3]]) }),
    ).toEqual(['3 bereits vorgeschlagene Aufrufe – deine Regel „A“ nimmt sie gleich an']);
    // Some of them among the calls proposed anew, some proposed before: never more „davon“
    // than were proposed, and the hint stays while a call proposed anew is left.
    const one = {
      ...impact.callsProposed,
      count: 1,
      byReason: [{ reason: 'no-engine' as const, count: 1 }],
    };
    expect(
      impactLines({ ...impact, callsProposed: one, autoAcceptedCalls: withOf(1, [['Export', 3]]) }),
    ).toEqual([
      '1 Aufruf nur vorgeschlagen (ohne Camunda-Engine) · deine Regel „Export“ nimmt 1 davon und 2 bereits vorgeschlagene gleich an',
    ]);
    expect(
      impactLines({
        ...impact,
        callsProposed: { ...one, count: 2 },
        autoAcceptedCalls: withOf(0, [['Export', 2]]),
      }),
    ).toEqual([
      '2 Aufrufe nur vorgeschlagen (ohne Camunda-Engine) – nach dem Import gesammelt annehmen · deine Regel „Export“ nimmt 2 bereits vorgeschlagene gleich an',
    ]);
    expect(
      impactLines({
        ...impact,
        callsProposed: { ...one, count: 2 },
        autoAcceptedCalls: withOf(1, [['Export', 2]]),
      }),
    ).toEqual([
      '2 Aufrufe nur vorgeschlagen (ohne Camunda-Engine) – nach dem Import gesammelt annehmen · deine Regel „Export“ nimmt 1 davon und 1 bereits vorgeschlagenen gleich an',
    ]);
    // Batches merge by rule; a preview without them has none.
    expect(
      mergeImpacts([
        { ...impact, autoAcceptedCalls: auto(['A', 2]) },
        { ...impact, autoAcceptedCalls: auto(['A', 1], ['B', 1]) },
      ]).autoAcceptedCalls,
    ).toMatchObject({
      count: 4,
      ofProposed: 4,
      byRule: [
        { ruleName: 'A', count: 3 },
        { ruleName: 'B', count: 1 },
      ],
    });
    expect('autoAcceptedCalls' in mergeImpacts([impact, impact])).toBe(false);
  });

  it('names the agent work a preview sets off in the last of its three lines (S2b follow-up)', () => {
    const list = <T>(count: number, items: T[] = []) => ({ count, items });
    const tasks = (
      pairs: number,
      rejudged: number,
      cancelled: ImportImpact['relationsTasks']['cancelled']['items'] = [],
      claimed = cancelled.filter((t) => t.state === 'claimed').length,
    ): ImportImpact['relationsTasks'] => ({
      queued: list(pairs > 0 ? 1 : 0, pairs > 0 ? ['a'] : []),
      cancelled: list(cancelled.length, cancelled),
      claimed,
      pairs,
      rejudged: list(rejudged),
    });
    const impact: ImportImpact = {
      files: [],
      acceptedCalls: list(3),
      callsProposed: { ...list(0), wasAccepted: 0, byReason: [] },
      proposalsAdded: list(4),
      proposalsWithdrawn: list(0),
      endpointsChanged: list(2),
      findingsAdded: list(1),
      findingsResolved: list(0),
      absentKeys: list(0),
      relationsTasks: tasks(0, 0),
    };
    // Without agent work (an unchanged re-import), the lines of S2b.
    expect(impactLines(impact)).toEqual([
      '3 Aufrufe automatisch verknüpft',
      '2 angenommene Relationen mit geändertem oder fehlendem Endpunkt',
      '4 neue Vorschläge der Regeln zu prüfen',
    ]);
    // The cost takes the third slot; the pairs judged again in brackets; de-DE numbers.
    const placement = (
      outcome: NonNullable<ImportImpact['placementTask']>['outcome'],
      newlyDue: number,
      again = 0,
      due = newlyDue + 2,
    ) => ({ placementTask: { outcome, due, newlyDue, again } });
    expect(
      impactLines({ ...impact, relationsTasks: tasks(214, 56), ...placement('queued', 7, 0, 7) }),
    ).toEqual([
      '3 Aufrufe automatisch verknüpft',
      '2 angenommene Relationen mit geändertem oder fehlendem Endpunkt',
      '214 mögliche Relationen zu beurteilen (56 davon erneut), 7 Prozesse zu platzieren',
    ]);
    expect(agentCostText({ relationsTasks: tasks(1234, 0) })).toBe(
      '1.234 mögliche Relationen zu beurteilen',
    );
    expect(agentCostText({ relationsTasks: tasks(1, 1) })).toBe(
      '1 mögliche Relation zu beurteilen (1 davon erneut)',
    );
    expect(possibleRelationsText(2)).toBe('2 mögliche Relationen');
    // On a first import too, with fewer lines before it.
    expect(
      impactLines(
        {
          ...impact,
          acceptedCalls: list(0),
          endpointsChanged: list(0),
          relationsTasks: tasks(12, 0),
        },
        1,
      ),
    ).toEqual([
      '4 neue Vorschläge der Regeln zu prüfen',
      '1 neuer Befund',
      '12 mögliche Relationen zu beurteilen',
    ]);
    // Several batches add up counts against the head: „etwa“.
    expect(agentCostText({ relationsTasks: tasks(7300, 0) }, 3)).toBe(
      'etwa 7.300 mögliche Relationen zu beurteilen',
    );
    // The placement part: a task the write queues places every process due, also those due
    // before (a deletion queues none); one waiting or held (its follow-up) the newly due ones;
    // with those placed again.
    const none = tasks(0, 0);
    expect(agentCostText({ relationsTasks: none, ...placement('queued', 1, 1, 1) })).toBe(
      '1 Prozess zu platzieren (1 davon erneut)',
    );
    expect(agentCostText({ relationsTasks: none, ...placement('queued', 0, 0, 4) })).toBe(
      '4 Prozesse zu platzieren',
    );
    expect(agentCostText({ relationsTasks: none, ...placement('queued', 2, 1, 9) })).toBe(
      '9 Prozesse zu platzieren (1 davon erneut)',
    );
    expect(agentCostText({ relationsTasks: none, ...placement('deferred', 2) })).toBe(
      '2 Prozesse zu platzieren',
    );
    expect(agentCostText({ relationsTasks: none, ...placement('open', 3, 2) }, 2)).toBe(
      'etwa 3 Prozesse zu platzieren (2 davon erneut)',
    );
    for (const p of [
      placement('not-triggered', 4),
      placement('open', 0),
      placement('deferred', 0),
      placement('nothing-due', 0, 0, 0),
    ])
      expect(agentCostText({ relationsTasks: none, ...p })).toBeNull();
    // merged batches: `due` the largest batch's, `newlyDue` their sum, never fewer than that
    expect(processesToPlace({ outcome: 'queued', due: 3, newlyDue: 5, again: 1 })).toBe(5);
    expect(processesToPlace({ outcome: 'open', due: 9, newlyDue: 1, again: 0 })).toBe(1);
    expect(processesToPlace({ outcome: 'not-triggered', due: 9, newlyDue: 9, again: 0 })).toBe(0);
    // A project without a chain, nothing to judge: no cost.
    expect(agentCostText({ relationsTasks: none })).toBeNull();

    // Accepted placements whose process changes rank right after the relations' ends.
    const placements = (count: number) => ({ placementsChanged: list<ImpactPlacement>(count) });
    expect(impactLines({ ...impact, acceptedCalls: list(0), ...placements(1) })).toEqual([
      '2 angenommene Relationen mit geändertem oder fehlendem Endpunkt',
      '1 angenommene Platzierung mit geändertem oder fehlendem Prozess',
      '4 neue Vorschläge der Regeln zu prüfen',
    ]);
    expect(
      impactLines({
        ...impact,
        endpointsChanged: list(0),
        ...placements(2),
        relationsTasks: tasks(5, 0),
      }),
    ).toEqual([
      '3 Aufrufe automatisch verknüpft',
      '2 angenommene Platzierungen mit geändertem oder fehlendem Prozess',
      '5 mögliche Relationen zu beurteilen',
    ]);

    // Every count in German: one sentence never mixes „1234“ and „1.234“.
    expect(
      impactLines({
        ...impact,
        acceptedCalls: list(1234),
        endpointsChanged: list(0),
        ...placements(2345),
        relationsTasks: tasks(3456, 0),
      }),
    ).toEqual([
      '1.234 Aufrufe automatisch verknüpft',
      '2.345 angenommene Platzierungen mit geändertem oder fehlendem Prozess',
      '3.456 mögliche Relationen zu beurteilen',
    ]);

    // „Was ändert sich?“: the pairs judged again by type, the placements by process and step.
    expect(rejudgedText({ type: 'message', from: 'a#Send', to: 'b#Catch' })).toBe(
      'Nachricht a#Send → b#Catch',
    );
    expect(
      placementChangeText({
        step: 'step-versand',
        stepName: 'Versand',
        process: 'lager/versand#Process_1',
        endpointState: 'missing',
      }),
    ).toBe('lager/versand#Process_1 → „Versand“ (fehlt)');
    expect(
      placementChangeText({
        step: '@outside',
        stepName: null,
        process: 'a#P',
        endpointState: 'changed',
      }),
    ).toBe('a#P → Außerhalb der Kette (geändert)');
    expect(
      placementChangeText({
        step: 'step-x',
        stepName: null,
        process: 'a#P',
        endpointState: 'changed',
      }),
    ).toBe('a#P → step-x (geändert)');

    // The warning for relations tasks an agent holds: one by key, several by count.
    const cancelled = (key: string, state: 'queued' | 'claimed') => ({
      modelKey: key,
      state,
      claimedBy: state === 'claimed' ? 'agent:claude' : null,
      assigned: state === 'claimed' ? 4 : null,
    });
    expect(claimedImportWarning(tasks(5, 0, [cancelled('b', 'queued')]))).toBeNull();
    expect(
      claimedImportWarning(
        tasks(5, 0, [cancelled('vertrieb/auftrag', 'claimed'), cancelled('b', 'queued')]),
      ),
    ).toEqual({
      title: 'Ein Agent bearbeitet „vertrieb/auftrag“ gerade; seine Arbeit geht verloren.',
      description: 'Der Import bricht seine Analyse ab; sie wird danach neu eingeplant.',
    });
    expect(
      claimedImportWarning(
        tasks(
          5,
          0,
          ['a', 'b', 'c', 'd', 'e'].map((k) => cancelled(k, 'claimed')),
        ),
      ),
    ).toEqual({
      title: 'Agenten bearbeiten gerade 5 dieser Modelle; ihre Arbeit geht verloren.',
      description:
        '„a“, „b“, „c“ und 2 weitere. Der Import bricht ihre Analysen ab; sie werden danach neu eingeplant.',
    });
    expect(
      claimedImportWarning(
        tasks(
          5,
          0,
          ['a', 'b', 'c'].map((k) => cancelled(k, 'claimed')),
        ),
      )?.description,
    ).toBe(
      '„a“, „b“ und „c“. Der Import bricht ihre Analysen ab; sie werden danach neu eingeplant.',
    );
    // claimed counts past the cap: the listed ones first, the rest counted
    expect(
      claimedImportWarning(tasks(5, 0, [cancelled('a', 'claimed'), cancelled('b', 'claimed')], 102))
        ?.description,
    ).toBe(
      '„a“, „b“ und 100 weitere. Der Import bricht ihre Analysen ab; sie werden danach neu eingeplant.',
    );
  });

  it('says what waits for the agent as `analyzr import` does', () => {
    expect(waitingText(0, false)).toBeNull();
    expect(waitingText(1, false)).toBe('1 Modell wartet auf den Agenten');
    expect(waitingText(5, true)).toBe('5 Modelle und die Platzierungen warten auf den Agenten');
    expect(waitingText(0, true)).toBe('Die Platzierungen warten auf den Agenten');
  });

  it('adds the pairs the waiting tasks will judge to what waits (S2b follow-up step 3b)', () => {
    expect(waitingText(5, false, 7300)).toBe(
      '5 Modelle warten auf den Agenten · etwa 7.300 mögliche Relationen',
    );
    expect(waitingText(5, true, 7300)).toBe(
      '5 Modelle und die Platzierungen warten auf den Agenten · etwa 7.300 mögliche Relationen',
    );
    expect(waitingText(1, false, 1)).toBe('1 Modell wartet auf den Agenten · 1 mögliche Relation');
    expect(waitingText(2, false, 0)).toBe('2 Modelle warten auf den Agenten');
    expect(pairsToJudgeText(0)).toBeNull();
    expect(pairsToJudgeText(1)).toBe('1 mögliche Relation');
    expect(pairsToJudgeText(2)).toBe('etwa 2 mögliche Relationen');
    expect(pairsToJudgeText(1234567)).toBe('etwa 1.234.567 mögliche Relationen');
  });

  it('says how many unique calls of derived models wait for a human (M6 S2c)', () => {
    expect(callsWaitingText(0)).toBeNull();
    expect(callsWaitingText(1)).toBe('1 eindeutiger Aufruf wartet auf deine Bestätigung');
    expect(callsWaitingText(12)).toBe('12 eindeutige Aufrufe warten auf deine Bestätigung');
  });
});

describe('agent configuration', () => {
  it('points MCP clients at the server, also under the Vite dev server', () => {
    expect(serverOrigin({ protocol: 'http:', hostname: '127.0.0.1', port: '7400' }, false)).toBe(
      'http://127.0.0.1:7400',
    );
    expect(serverOrigin({ protocol: 'http:', hostname: 'localhost', port: '7401' }, true)).toBe(
      'http://localhost:7400',
    );
    expect(serverOrigin({ protocol: 'http:', hostname: '::1', port: '7400' }, false)).toBe(
      'http://[::1]:7400',
    );
  });

  it('quotes the token for the shell only when needed', () => {
    expect(claudeCodeCommand('http://localhost:7400', null).split('\n')[0]).toBe(
      "export ANALYZR_TOKEN='analyzr_at_…'",
    );
    expect(claudeCodeCommand('http://localhost:7400', 'analyzr_at_abc123').split('\n')).toEqual([
      'export ANALYZR_TOKEN=analyzr_at_abc123',
      'claude mcp add --transport http analyzr http://localhost:7400/mcp --header "Authorization: Bearer ${ANALYZR_TOKEN}"',
    ]);
  });

  it('uses a placeholder until the checkout path is known', () => {
    const config = JSON.parse(claudeDesktopNodeConfig('http://localhost:7400', null, '  ')) as {
      mcpServers: { analyzr: { args: string[] } };
    };
    expect(config.mcpServers.analyzr.args[0]).toBe('/pfad/zu/analyzr/apps/cli/src/main.ts');
  });

  it('names the container of the compose service `server` (docker/compose.yaml)', () => {
    const compose = readFileSync(join(import.meta.dirname, '../../../docker/compose.yaml'), 'utf8');
    const project = /^name: (\S+)$/m.exec(compose)?.[1];
    expect(project).toBe('analyzr');
    expect(compose).toMatch(/^ {2}server:$/m);
    expect(DOCKER_CONTAINER).toBe(`${project ?? ''}-server-1`);
    // The CLI's `analyzr token create` prints the same container (ANALYZR_CONTAINER).
    expect(/^ +ANALYZR_CONTAINER: (\S+)$/m.exec(compose)?.[1]).toBe(DOCKER_CONTAINER);
  });
});

describe('project keys', () => {
  it('slugifies names like the server slugifies paths', () => {
    expect(slugify('Nordwind Handel GmbH')).toBe('nordwind-handel-gmbh');
    expect(slugify('Stadtwerke Auental – Netz & Messung')).toBe('stadtwerke-auental-netz-messung');
    expect(slugify('Größenprüfung für Ölfässer')).toBe('groessenpruefung-fuer-oelfaesser');
    expect(slugify('Café Crème')).toBe('cafe-creme');
    expect(slugify('x'.repeat(70)).length).toBe(64);
    expect(isProjectKey('nordwind-handel')).toBe(true);
    expect(isProjectKey('Nordwind')).toBe(false);
    expect(isProjectKey('a--b')).toBe(false);
    expect(isProjectKey('')).toBe(false);
  });
});

describe('refs', () => {
  it('splits refs at the first #', () => {
    expect(splitRef('vertrieb/auftrag#Task_1')).toEqual({
      modelKey: 'vertrieb/auftrag',
      elementId: 'Task_1',
    });
  });

  it('resolves labels and the enclosing process, falling back to the element id', () => {
    const resolve = resolverOf(
      buildRefIndex(
        [
          {
            modelKey: 'a',
            ref: 'a#T1',
            kind: 'task',
            label: '',
            processId: 'P',
          },
        ],
        [
          {
            ref: 'a#P',
            processId: 'P',
            name: null,
            participantName: 'Pool A',
            isExecutable: false,
          },
        ],
      ),
    );
    expect(resolve('a#T1')).toMatchObject({ label: null, kind: 'task', processName: 'Pool A' });
    expect(resolve('a#P')).toMatchObject({ label: 'Pool A', kind: 'process' });
    expect(resolve('b#X')).toEqual({
      ref: 'b#X',
      modelKey: 'b',
      elementId: 'X',
      label: null,
      kind: null,
      processName: null,
    });
  });
});

describe('relation filters', () => {
  it('accepts only known values from the URL', () => {
    expect(
      parseRelationFilters({ status: 'accepted', tier: 'nope', type: 'call', model: '', x: 1 }),
    ).toEqual({ status: 'accepted', type: 'call' });
    expect(parseRelationFilters({ model: 'vertrieb/auftrag' })).toEqual({
      model: 'vertrieb/auftrag',
    });
  });

  it('filters by model on either end and sorts stably', () => {
    const filtered = filterRelations(sampleRelations, { model: 'finance/payment-collection' });
    expect(filtered.map((r) => r.id)).toEqual([
      'rel_01CALL000000000000000000001',
      'rel_01STEM000000000000000000001',
    ]);
    const a = relation({ id: 'rel_a', from: 'a#1', to: 'b#1' });
    const b = relation({ id: 'rel_b', from: 'a#1', to: 'b#2' });
    expect([b, a].sort(compareRelations).map((r) => r.id)).toEqual(['rel_a', 'rel_b']);
  });

  it('falls back to tier and rule attributes without API provenance', () => {
    expect(provenanceOf({ tier: 'rule', type: 'call', attrs: {}, provenance: null })).toEqual({
      source: 'rule',
      label: 'analyzr-rules/1.0.0',
      detail: 'eindeutiger Aufruf',
    });
    expect(
      provenanceOf({
        tier: 'key',
        type: 'call',
        attrs: { match: 'duplicate-process-id' },
        provenance: null,
      }).detail,
    ).toBe('Prozess-ID mehrdeutig');
    // The trust rule (M6 S2c): a unique call of a derived model, only proposed.
    expect(
      provenanceOf({
        tier: 'key',
        type: 'call',
        attrs: { calledElement: 'P', match: 'derived-caller' },
        provenance: null,
      }),
    ).toEqual({
      source: 'rule',
      label: 'analyzr-rules/1.0.0',
      detail: 'eindeutiger Aufruf aus abgeleitetem Modell',
    });
    expect(provenanceOf({ tier: 'key', type: 'signal', attrs: {}, provenance: null }).detail).toBe(
      'gleicher Signalname',
    );
    expect(
      provenanceOf({
        tier: 'lexical',
        type: 'call',
        attrs: { match: 'process-name' },
        provenance: null,
      }).source,
    ).toBe('rule');
    expect(
      provenanceOf({ tier: 'lexical', type: 'message', attrs: {}, provenance: null }).source,
    ).toBe('agent');
  });
});
