/**
 * „Annahmeregeln“ (owner decision 19; UX9, UX-SIMPLIFICATION.md §3.11 items
 * 3–7): the rule dialog (four criteria and the prefilled name in view, the
 * rest under „Weiter einschränken“, one „Speichern“ with the „Aktiv“
 * switch, the live preview with the bulk flags count), the rule rows (three
 * controls; the switch confirms before enabling with open proposals or
 * another author), the system rule's one line, the apply and revoke lists by
 * name, and the page (the safeguard once, „Nach Agent widerrufen…“ in the
 * header's „Mehr“).
 */
import type { AutoAcceptItem, AutoAcceptRule, Health, Project } from '@analyzr/client';
import { QueryClient, focusManager } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../src/app';
import { ApplyDialog } from '../src/components/rules/apply-dialog';
import { RevokeDialog } from '../src/components/rules/revoke-dialog';
import { RuleDialog, type RuleDraft } from '../src/components/rules/rule-dialog';
import { RuleTable } from '../src/components/rules/rule-table';
import { SystemRuleCard } from '../src/components/rules/system-rule-card';
import { healthQuery, projectQuery, projectsQuery } from '../src/lib/queries';
import { createAppRouter } from '../src/router';
import {
  OWNER,
  agentToken,
  autoAcceptPreview,
  autoAcceptRule,
  fact,
  ledgerEntry,
  model,
  relation,
} from './support/fixtures';
import {
  findToast,
  json,
  renderWithQuery,
  renderWithRouter,
  stubApi,
  type Call,
} from './support/render';

const BASE = '/api/v1/projects/demo';
const RULE_ID = 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y3';
const RULE_B = 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y4';

function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return json({ type: `urn:analyzr:problem:${code}`, title: code, status, code, ...extra }, status);
}

const detail = (rule: AutoAcceptRule) => ({ ...rule, revisions: [] });

/** What a person can fill in or switch: not inside a closed disclosure, not a form's hidden mirror. */
function visibleFields(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'input, select, textarea, [role=checkbox], [role=switch]',
    ),
  ].filter((el) => el.getAttribute('aria-hidden') !== 'true' && !el.closest('details:not([open])'));
}

/** The focusable controls of a rule row at desktop width (buttons, the switch, links; not what `md:hidden` hides). */
function controls(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')].filter(
    (el) => el.getAttribute('aria-hidden') !== 'true' && !el.closest('.md\\:hidden'),
  );
}

// ------------------------------------------------- facts for names and flags

/** One model holding every fact: „Antwort“ is generic and used by three processes, „Rechnung“ is not. */
const ALL = model({ key: 'alle' });
const FACTS = [
  fact({
    modelKey: 'vertrieb/auftrag',
    elementId: 'Send_Rechnung',
    kind: 'msg_throw',
    processId: 'P_auftrag',
    label: 'Rechnung versenden',
    attrs: { messageName: 'RechnungVersendet' },
  }),
  fact({
    modelKey: 'finanzen/debitoren',
    elementId: 'Catch_Rechnung',
    kind: 'msg_catch',
    processId: 'P_deb',
    label: 'Rechnung erhalten',
    attrs: { messageName: 'RechnungVersendet' },
  }),
  fact({
    modelKey: 'vertrieb/angebot',
    elementId: 'Send_Antwort',
    kind: 'msg_throw',
    processId: 'P_angebot',
    label: 'Antwort senden',
    attrs: { messageName: 'Antwort' },
  }),
  fact({
    modelKey: 'einkauf/anfrage',
    elementId: 'Catch_Antwort',
    kind: 'msg_catch',
    processId: 'P_anfrage',
    label: 'Antwort erhalten',
    attrs: { messageName: 'Antwort' },
  }),
  fact({
    modelKey: 'service/ticket',
    elementId: 'Catch_Antwort',
    kind: 'msg_catch',
    processId: 'P_ticket',
    label: 'Kunde hat geantwortet',
    attrs: { messageName: 'Antwort' },
  }),
];
const PROCESSES = [
  ['vertrieb/auftrag', 'P_auftrag', 'Auftragsabwicklung'],
  ['finanzen/debitoren', 'P_deb', 'Debitoren'],
  ['vertrieb/angebot', 'P_angebot', 'Angebot'],
  ['einkauf/anfrage', 'P_anfrage', 'Anfrage'],
].map(([key, id, name]) => ({
  ref: `${key}#${id}`,
  processId: id!,
  name: name!,
  participantName: null,
  isExecutable: true,
}));
const ANTWORT = relation({
  id: 'rel_01ANTWORT',
  from: 'vertrieb/angebot#Send_Antwort',
  to: 'einkauf/anfrage#Catch_Antwort',
  attrs: { messageName: 'Antwort' },
});
const RECHNUNG = relation({
  id: 'rel_01RECHNUNG',
  from: 'vertrieb/auftrag#Send_Rechnung',
  to: 'finanzen/debitoren#Catch_Rechnung',
  attrs: { messageName: 'RechnungVersendet' },
});

/** The routes `useProjectFacts` and the landscape read. */
const FACT_ROUTES = {
  [`GET ${BASE}/models`]: () => json({ items: [ALL], nextCursor: null }),
  [`GET ${BASE}/models/${ALL.id}/revisions/${ALL.headRevisionId}/facts`]: () =>
    json({
      modelKey: 'alle',
      revisionId: ALL.headRevisionId,
      factsVersion: '1',
      processes: PROCESSES,
      facts: FACTS,
      messageFlows: [],
    }),
  [`GET ${BASE}/landscape`]: () =>
    json({
      projectId: 'prj_01DEMO',
      seq: 1,
      models: [],
      relations: [ANTWORT, RECHNUNG],
      findings: [],
    }),
};

const item: AutoAcceptItem = {
  kind: 'relation',
  id: 'rel_01A',
  status: 'proposed',
  endpointState: 'ok',
  type: 'message',
  from: 'a#Send',
  to: 'b#Receive',
  valueChainKey: null,
  step: null,
  process: null,
  triggerId: 'ast_01T',
  proposedBy: 'agent',
  agent: { principalId: 'prn_01AGENT', handle: 'agent:claude code' },
  llmModel: 'sim-policy-1',
  tier: 'key',
  confidence: 0.97,
};
const itemOf = (r: typeof ANTWORT, n: number): AutoAcceptItem => ({
  ...item,
  id: r.id,
  from: r.from,
  to: r.to,
  triggerId: `ast_0${n}`,
});

const applyResult = (
  dryRun: boolean,
  count: number,
  head: { enabled?: boolean; authorIsOwner?: boolean } = {},
  items: AutoAcceptItem[] = Array.from({ length: count }, (_, i) => ({
    ...item,
    id: `rel_0${i}`,
    triggerId: `ast_0${i}`,
  })),
) => ({
  dryRun,
  ruleId: RULE_ID,
  revision: 2,
  enabled: head.enabled ?? true,
  authorIsOwner: head.authorIsOwner ?? true,
  count,
  items,
  truncated: false,
  blocked: [{ reason: 'human-involved', count: 4 }],
});

// --------------------------------------------------------------- the dialog

describe('RuleDialog', () => {
  function open(
    rule: AutoAcceptRule | null,
    routes: Record<string, (c: Call) => Response> = {},
    extra: { draft?: RuleDraft; ruleNames?: string[] } = {},
  ) {
    const calls = stubApi({
      [`POST ${BASE}/auto-accept-rules/preview`]: () => json(autoAcceptPreview()),
      ...routes,
    });
    const saved: AutoAcceptRule[] = [];
    renderWithQuery(
      <RuleDialog
        project="demo"
        rule={rule}
        draft={extra.draft}
        ruleNames={extra.ruleNames ?? []}
        tokens={[
          agentToken({ id: 'agt_01SIM', name: 'sim', principalId: 'prn_01SIM' }),
          agentToken({
            id: 'agt_01OLD',
            name: 'alt',
            principalId: 'prn_01OLD',
            revokedAt: '2026-10-01T00:00:00.000Z',
          }),
        ]}
        open
        onOpenChange={() => undefined}
        onSaved={(r) => saved.push(r)}
      />,
    );
    return { calls, saved, user: userEvent.setup() };
  }

  it('shows four criteria and the prefilled name; the rest under the closed „Weiter einschränken“', async () => {
    const { user } = open(null);
    const dialog = screen.getByTestId('rule-dialog');
    const fields = within(dialog).getByTestId('rule-fields');
    // Done when (UX9): 4 fields plus the prefilled name (the audit counted 10, the form had 9).
    expect(visibleFields(fields).map((el) => el.id)).toEqual(
      ['Name', 'Art', 'Grundlage', 'ab Konfidenz (%)', 'Typ'].map(
        (label) => within(fields).getByLabelText(label).id,
      ),
    );
    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe(
      'Gleicher Name ab 95 %',
    );
    const narrow = within(dialog).getByTestId<HTMLDetailsElement>('rule-narrow');
    expect(narrow.open).toBe(false);
    await user.click(within(narrow).getByText('Weiter einschränken'));
    expect(narrow.open).toBe(true);
    expect(visibleFields(fields)).toHaveLength(9);
    // One „Speichern“ with the „Aktiv“ switch (off for a new rule), no „Speichern (aus)“.
    expect(within(dialog).getByRole('switch', { name: 'Aktiv' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(within(dialog).getByRole('button', { name: 'Speichern' })).toBeTruthy();
    expect(
      within(dialog).queryByRole('button', { name: /Speichern \(aus\)|aktivieren/ }),
    ).toBeNull();
    expect(dialog.textContent).not.toContain('Erzeugt eine neue Revision');
  });

  it('shows kind-specific fields and the live preview in German', async () => {
    const { calls, user } = open(null);
    const dialog = screen.getByTestId('rule-dialog');
    expect(within(dialog).getByRole('heading', { name: 'Neue Annahmeregel' })).toBeTruthy();
    // Relations: three tiers and a type.
    const tier = within(dialog).getByLabelText('Grundlage');
    expect(
      within(tier)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Gleicher Name', 'Ähnlicher Name', 'Gleiche Bedeutung']);
    expect(within(dialog).getByLabelText('Typ')).toBeTruthy();
    // Revoked tokens are marked; agents seen in proposals without „agent:“.
    const preview = await screen.findByTestId('rule-preview');
    const agents = within(within(dialog).getByLabelText('Agent')).getAllByRole('option');
    expect(agents.map((o) => o.textContent)).toEqual([
      'Alle Agenten',
      'sim',
      'alt (widerrufen)',
      'claude code',
    ]);
    // The debounced preview: the history with the precision, unreviewed items, open, blocked, curve.
    expect(within(preview).getByTestId('preview-history').textContent).toBe(
      'Bisher: 15 von 40 entschiedenen Agentenvorschlägen hätte die Regel angenommen – davon 14 angenommen, 1 abgelehnt, 0 korrigiert (Trefferquote 93,3 %).',
    );
    expect(within(preview).getByTestId('preview-unreviewed').textContent).toBe(
      'Automatisch angenommen, nicht geprüft: 2 · noch nicht entschieden: 1',
    );
    expect(within(preview).getByTestId('preview-open').textContent).toBe(
      'Jetzt offen: 3 würden angenommen',
    );
    expect(within(preview).getByText('Offene Frage eines Agenten')).toBeTruthy();
    // The curve under the closed „Nach Konfidenz aufschlüsseln“, only rows whose numbers change.
    const curve = within(preview).getByTestId<HTMLDetailsElement>('preview-curve');
    expect(curve.open).toBe(false);
    const rows = within(curve).getAllByTestId('curve-row');
    expect(rows.map((r) => r.firstElementChild?.textContent)).toEqual(['50 %', '95 %']);
    expect(rows[1]?.dataset['current']).toBe('true');
    expect(calls.find((c) => c.path.endsWith('/preview'))?.body).toEqual({
      kind: 'relation',
      tier: 'key',
      minConfidence: 0.95,
      relationType: null,
      agentPrincipalId: null,
      llmModel: null,
      includeAdHoc: false,
      proposedBy: 'agent',
      derivedKind: null,
      converter: null,
    });

    // Placements: two tiers, no type, the @outside hint.
    await user.selectOptions(within(dialog).getByLabelText('Art'), 'placement');
    expect(
      within(within(dialog).getByLabelText('Grundlage'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Ähnlicher Name', 'Gleiche Bedeutung']);
    expect(within(dialog).queryByLabelText('Typ')).toBeNull();
    expect(within(dialog).getByText(/@outside wird nie automatisch angenommen/)).toBeTruthy();
    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe(
      'Platzierung: Ähnlicher Name ab 95 %',
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.path.endsWith('/preview')).at(-1)?.body).toMatchObject({
        kind: 'placement',
        tier: 'lexical',
      }),
    );
  });

  it('prefills the name from the criteria, with „(2)“ while taken, until the owner types one', async () => {
    const { user } = open(null, {}, { ruleNames: ['gleicher name ab 95 %', 'Andere'] });
    const dialog = screen.getByTestId('rule-dialog');
    const name = within(dialog).getByLabelText<HTMLInputElement>('Name');
    expect(name.value).toBe('Gleicher Name ab 95 % (2)');
    const min = within(dialog).getByLabelText('ab Konfidenz (%)');
    await user.clear(min);
    await user.type(min, '92,5');
    expect(name.value).toBe('Gleicher Name ab 92,5 %');
    await user.selectOptions(within(dialog).getByLabelText('Typ'), 'message');
    expect(name.value).toBe('Nachricht: Gleicher Name ab 92,5 %');
    // Once typed, the name stays the owner's.
    await user.type(name, ' (Vertrieb)');
    await user.selectOptions(within(dialog).getByLabelText('Grundlage'), 'semantic');
    expect(name.value).toBe('Nachricht: Gleicher Name ab 92,5 % (Vertrieb)');
  });

  it('validates the name and a confidence of at least 50 %', async () => {
    const { calls, user } = open(null);
    const dialog = screen.getByTestId('rule-dialog');
    const min = within(dialog).getByLabelText('ab Konfidenz (%)');
    await user.clear(min);
    await user.type(min, '40');
    expect(within(dialog).getByText('Gib einen Wert zwischen 50 und 100 % an.')).toBeTruthy();
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.click(within(dialog).getByTestId('rule-save'));
    expect(within(dialog).getByText('Gib der Regel einen Namen.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/auto-accept-rules'))).toBe(
      false,
    );
  });

  it('creates a rule switched on, narrowed under „Weiter einschränken“', async () => {
    const { calls, saved, user } = open(null, {
      [`POST ${BASE}/auto-accept-rules`]: (c) =>
        json(
          {
            outcome: 'created',
            rule: detail(
              autoAcceptRule({ id: RULE_ID, enabled: (c.body as { enabled: boolean }).enabled }),
            ),
          },
          201,
        ),
    });
    const dialog = screen.getByTestId('rule-dialog');
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Schlüssel ab 95 %');
    await user.selectOptions(within(dialog).getByLabelText('Typ'), 'message');
    await user.click(within(dialog).getByText('Weiter einschränken'));
    await user.selectOptions(within(dialog).getByLabelText('Agent'), 'prn_01SIM');
    await user.type(within(dialog).getByLabelText('LLM-Modell'), 'claude-sonnet-5-5');
    await user.click(within(dialog).getByLabelText('Auch Ad-hoc-Vorschläge'));
    await user.click(within(dialog).getByRole('switch', { name: 'Aktiv' }));
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await findToast('Regel „Schlüssel ab 95 %“ angelegt und aktiviert');
    expect(
      calls.find((c) => c.method === 'POST' && c.path.endsWith('/auto-accept-rules'))?.body,
    ).toEqual({
      kind: 'relation',
      tier: 'key',
      minConfidence: 0.95,
      relationType: 'message',
      agentPrincipalId: 'prn_01SIM',
      llmModel: 'claude-sonnet-5-5',
      includeAdHoc: true,
      proposedBy: 'agent',
      derivedKind: null,
      converter: null,
      name: 'Schlüssel ab 95 %',
      enabled: true,
      note: null,
    });
    expect(saved.map((r) => r.enabled)).toEqual([true]);
  });

  it('the bulk accept’s draft: „Gleicher Name ab 100 %“, saved off unless switched on', async () => {
    const { calls, user } = open(
      null,
      {
        [`POST ${BASE}/auto-accept-rules`]: () =>
          json({ outcome: 'created', rule: detail(autoAcceptRule({ id: RULE_ID })) }, 201),
      },
      { draft: { tier: 'key', percent: '100' } },
    );
    const dialog = screen.getByTestId('rule-dialog');
    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe(
      'Gleicher Name ab 100 %',
    );
    await user.click(within(dialog).getByTestId('rule-save'));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path.endsWith('/auto-accept-rules'))?.body,
      ).toMatchObject({ name: 'Gleicher Name ab 100 %', minConfidence: 1, enabled: false }),
    );
  });

  it('the preview counts the bulk accept’s name flags among the open items (Q8: shown only)', async () => {
    open(null, {
      ...FACT_ROUTES,
      [`POST ${BASE}/auto-accept-rules/preview`]: () =>
        json(
          autoAcceptPreview({
            open: { count: 2, items: [itemOf(ANTWORT, 1), itemOf(RECHNUNG, 2)], blocked: [] },
          }),
        ),
    });
    const preview = await screen.findByTestId('rule-preview');
    expect((await within(preview).findByTestId('preview-flags')).textContent).toBe(
      'davon 1 mit allgemeinem oder mehrfach genutztem Namen (in der Sammelannahme markiert)',
    );
  });

  it('says „mindestens“ when the preview lists only the first open items', async () => {
    open(null, {
      ...FACT_ROUTES,
      [`POST ${BASE}/auto-accept-rules/preview`]: () =>
        json(autoAcceptPreview({ open: { count: 80, items: [itemOf(ANTWORT, 1)], blocked: [] } })),
    });
    expect((await screen.findByTestId('preview-flags')).textContent).toBe(
      'davon mindestens 1 mit allgemeinem oder mehrfach genutztem Namen (in der Sammelannahme markiert)',
    );
  });

  it('edits with If-Match; on 412 loads the newer revision into the form before saving on it', async () => {
    const rule = autoAcceptRule({ id: RULE_ID, revision: 2, enabled: true, minConfidence: 0.9 });
    // Another owner narrowed the rule to one agent and raised it to 97 % meanwhile.
    const newer = {
      ...rule,
      revision: 3,
      minConfidence: 0.97,
      agentPrincipalId: 'prn_01SIM',
      agent: {
        principalId: 'prn_01SIM',
        handle: 'agent:sim',
        tokenId: 'agt_01SIM',
        revoked: false,
      },
    };
    let attempts = 0;
    const { calls, user } = open(rule, {
      [`PUT ${BASE}/auto-accept-rules/${RULE_ID}`]: (c) => {
        attempts += 1;
        return attempts === 1
          ? problem(412, 'revision-conflict', { headRev: 3 })
          : json({
              outcome: 'revised',
              rule: detail({ ...newer, ...(c.body as object), revision: 4 }),
            });
      },
      [`GET ${BASE}/auto-accept-rules/${RULE_ID}`]: () => json(detail(newer)),
    });
    const dialog = screen.getByTestId('rule-dialog');
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Art').disabled).toBe(true);
    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe('Schlüssel ab 95 %');
    expect(within(dialog).getByRole('switch', { name: 'Aktiv' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    const narrow = within(dialog).getByTestId<HTMLDetailsElement>('rule-narrow');
    expect(narrow.open).toBe(false);
    await user.click(within(narrow).getByText('Weiter einschränken'));
    await user.type(within(dialog).getByLabelText('Notiz'), 'nur die Notiz');
    await user.click(within(dialog).getByTestId('rule-save'));
    expect(
      await within(dialog).findByText('Die Regel wurde inzwischen geändert (Revision 3)'),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Neuere Revision laden' }));
    // The form now shows revision 3, and the alert says what changed.
    const reloaded = await within(dialog).findByTestId('reloaded');
    expect(reloaded.textContent).toContain('Revision 3 geladen');
    expect(reloaded.textContent).toContain('ab Konfidenz: 90 % → 97 %');
    expect(reloaded.textContent).toContain('Agent: alle Agenten → sim');
    expect(within(dialog).getByLabelText<HTMLInputElement>('ab Konfidenz (%)').value).toBe('97');
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Agent').value).toBe('prn_01SIM');
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>('Notiz').value).toBe('');
    expect(narrow.open).toBe(true);
    await waitFor(() =>
      expect(within(dialog).getByTestId('rule-save')).toHaveProperty('disabled', false),
    );
    await user.click(within(dialog).getByTestId('rule-save'));
    await findToast('Regel „Schlüssel ab 95 %“ gespeichert');
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts.map((c) => c.headers['if-match'])).toEqual(['"r2"', '"r3"']);
    expect(puts[0]?.body).toMatchObject({ minConfidence: 0.9, note: 'nur die Notiz' });
    expect(puts[1]?.body).toMatchObject({
      minConfidence: 0.97,
      agentPrincipalId: 'prn_01SIM',
      note: null,
      enabled: true,
    });
  });

  it('keeps a threshold finer than the field shows unless it is edited, and parses two decimals', async () => {
    const rule = autoAcceptRule({ id: RULE_ID, revision: 2, minConfidence: 0.92345 });
    const { calls, user } = open(rule, {
      [`PUT ${BASE}/auto-accept-rules/${RULE_ID}`]: (c) =>
        json({ outcome: 'revised', rule: detail({ ...rule, ...(c.body as object), revision: 3 }) }),
    });
    const dialog = screen.getByTestId('rule-dialog');
    const min = within(dialog).getByLabelText<HTMLInputElement>('ab Konfidenz (%)');
    expect(min.value).toBe('92,345');
    await user.click(within(dialog).getByText('Weiter einschränken'));
    await user.type(within(dialog).getByLabelText('Notiz'), 'Notiz');
    await user.click(within(dialog).getByTestId('rule-save'));
    await findToast('Regel „Schlüssel ab 95 %“ gespeichert');
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      minConfidence: 0.92345,
      enabled: false,
    });
  });

  it('opens „Weiter einschränken“ by itself for a rule that narrows', () => {
    open(autoAcceptRule({ id: RULE_ID, includeAdHoc: true }));
    expect(screen.getByTestId<HTMLDetailsElement>('rule-narrow').open).toBe(true);
  });

  it('says that saving takes over a rule whose author is no longer an owner', () => {
    open(autoAcceptRule({ id: RULE_ID, authorIsOwner: false }));
    expect(screen.getByTestId('take-over-hint').textContent).toContain(
      'ist kein Inhaber mehr; bis jemand die Regel neu speichert, nimmt sie nichts an',
    );
  });

  it('says that saving another owner’s rule active makes the caller its deciding person', async () => {
    const me = 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2ME';
    const { calls, user } = open(autoAcceptRule({ id: RULE_ID }), {
      'GET /api/v1/me': () =>
        json({
          principalId: me,
          handle: 'ich',
          kind: 'user',
          authMode: 'local',
          clientId: 'analyzr-web',
        }),
    });
    const dialog = screen.getByTestId('rule-dialog');
    await waitFor(() => expect(calls.some((c) => c.path === '/api/v1/me')).toBe(true));
    // Off, it accepts nothing either way; the „Aktiv“ switch is the second way to enable it.
    expect(within(dialog).queryByTestId('take-over-hint')).toBeNull();
    await user.click(within(dialog).getByRole('switch', { name: 'Aktiv' }));
    expect(within(dialog).getByTestId('take-over-hint').textContent).toBe(
      'Bisher entscheidet owner. Speicherst du eine Änderung, wirst du die entscheidende Person dieser Regel: Ihre Annahmen werden dann als deine Entscheidungen vermerkt.',
    );
  });

  it('hedges the take-over while the caller cannot be loaded', async () => {
    open(autoAcceptRule({ id: RULE_ID, enabled: true }), {
      'GET /api/v1/me': () => problem(500, 'internal'),
    });
    expect((await screen.findByTestId('take-over-hint')).textContent).toBe(
      'Bisher entscheidet owner. Bist du das nicht und speicherst du eine Änderung, wirst du die entscheidende Person dieser Regel: Ihre Annahmen werden dann als deine Entscheidungen vermerkt.',
    );
  });

  it('says nothing about taking over one’s own active rule', async () => {
    const { calls } = open(autoAcceptRule({ id: RULE_ID, enabled: true }), {
      'GET /api/v1/me': () =>
        json({ ...OWNER, kind: 'user', authMode: 'local', clientId: 'analyzr-web' }),
    });
    await waitFor(() => expect(calls.some((c) => c.path === '/api/v1/me')).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('take-over-hint')).toBeNull());
  });

  it('names a refused rule in German', async () => {
    const { user } = open(null, {
      [`POST ${BASE}/auto-accept-rules`]: () =>
        problem(422, 'validation-failed', { reason: 'name-taken' }),
    });
    const dialog = screen.getByTestId('rule-dialog');
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'Doppelt');
    await user.click(within(dialog).getByTestId('rule-save'));
    expect(
      await within(dialog).findByText('Eine andere Annahmeregel dieses Projekts heißt schon so.'),
    ).toBeTruthy();
  });
});

describe('RuleDialog: a rule for derived calls (M6 S2c-3)', () => {
  const GROUPS = [
    {
      derivedKind: 'export' as const,
      converter: null,
      open: 12,
      blocked: 1,
      accepted: 4,
      rejected: 0,
    },
    {
      derivedKind: 'converted' as const,
      converter: 'normalize-bpmn@0.1.0',
      open: 3,
      blocked: 0,
      accepted: 0,
      rejected: 0,
    },
    {
      derivedKind: 'converted' as const,
      converter: 'normalize-bpmn@0.2.0',
      open: 2,
      blocked: 0,
      accepted: 0,
      rejected: 1,
    },
  ];

  function open(
    rule: AutoAcceptRule | null,
    routes: Record<string, (c: Call) => Response | Promise<Response>> = {},
    draft?: RuleDraft,
  ) {
    const calls = stubApi({
      [`POST ${BASE}/auto-accept-rules/preview`]: () =>
        json(autoAcceptPreview({ derivedGroups: GROUPS })),
      [`POST ${BASE}/auto-accept-rules`]: (c) =>
        json(
          {
            outcome: 'created',
            rule: detail(autoAcceptRule({ id: RULE_ID, ...(c.body as object) })),
          },
          201,
        ),
      ...routes,
    });
    renderWithQuery(
      <RuleDialog
        project="demo"
        rule={rule}
        draft={draft}
        ruleNames={[]}
        tokens={[]}
        open
        onOpenChange={() => undefined}
      />,
    );
    return { calls, user: userEvent.setup() };
  }

  it('asks for „Herkunft“ (with its open calls) instead of tier, confidence and type, with one hint line', async () => {
    const { calls, user } = open(null);
    const dialog = screen.getByTestId('rule-dialog');
    const art = within(dialog).getByLabelText<HTMLSelectElement>('Art');
    expect([...art.options].map((o) => o.textContent)).toEqual([
      'Relationen',
      'Platzierungen',
      'Eindeutige Aufrufe aus abgeleiteten Modellen',
    ]);
    await user.selectOptions(art, 'calls');
    const fields = within(dialog).getByTestId('rule-fields');
    expect(visibleFields(fields).map((el) => el.id)).toEqual(
      ['Name', 'Art', 'Herkunft'].map((label) => within(fields).getByLabelText(label).id),
    );
    expect(within(dialog).queryByLabelText('Grundlage')).toBeNull();
    expect(within(dialog).queryByLabelText('ab Konfidenz (%)')).toBeNull();
    expect(within(dialog).queryByLabelText('Typ')).toBeNull();
    expect(within(dialog).getByTestId('rule-source-hint').textContent).toBe(
      'Die Herkunft gibt der Import an; analyzr prüft sie nicht. Über ein Agenten-Token hochgeladene Modelle nimmt keine Regel an.',
    );
    await waitFor(() =>
      expect(
        [...within(dialog).getByLabelText<HTMLSelectElement>('Herkunft').options].map(
          (o) => o.textContent,
        ),
      ).toEqual([
        'Export ohne Camunda-Engine (12 offen)',
        'Konvertiert (5 offen)',
        'Ohne Angabe (0 offen)',
      ]),
    );
    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe(
      'Aufrufe: Export ohne Engine',
    );
    // „Weiter einschränken“ holds the note only; the preview has no curve.
    await user.click(within(dialog).getByText('Weiter einschränken'));
    expect(visibleFields(fields).map((el) => el.id)).toContain(
      within(fields).getByLabelText('Notiz').id,
    );
    expect(within(dialog).queryByLabelText('Agent')).toBeNull();
    const preview = await screen.findByTestId('rule-preview');
    await waitFor(() =>
      expect(within(preview).getByTestId('preview-history').textContent).toBe(
        'Bisher: 15 von 40 entschiedenen Aufrufen aus abgeleiteten Modellen hätte die Regel angenommen – davon 14 angenommen, 1 abgelehnt, 0 korrigiert (Trefferquote 93,3 %).',
      ),
    );
    expect(within(preview).queryByTestId('preview-curve')).toBeNull();
    expect(within(preview).getByTestId('preview-open').textContent).toBe(
      'Jetzt offen: 3 Aufrufe würden angenommen',
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.path.endsWith('/preview')).at(-1)?.body).toEqual({
        kind: 'relation',
        tier: 'key',
        minConfidence: 0.9,
        relationType: 'call',
        agentPrincipalId: null,
        llmModel: null,
        includeAdHoc: false,
        proposedBy: 'rule',
        derivedKind: 'export',
        converter: null,
      }),
    );
  });

  it('„Konvertiert“ picks a converter of the project’s derived calls and saves exactly it', async () => {
    const { calls, user } = open(null);
    const dialog = screen.getByTestId('rule-dialog');
    await user.selectOptions(within(dialog).getByLabelText('Art'), 'calls');
    await screen.findByTestId('rule-preview');
    await user.selectOptions(within(dialog).getByLabelText('Herkunft'), 'converted');
    const converter = within(dialog).getByLabelText<HTMLSelectElement>('Konverter');
    expect([...converter.options].map((o) => o.textContent)).toEqual([
      'normalize-bpmn@0.1.0 (3 offen)',
      'normalize-bpmn@0.2.0 (2 offen)',
    ]);
    expect(converter.value).toBe('normalize-bpmn@0.1.0');
    await user.selectOptions(converter, 'normalize-bpmn@0.2.0');
    // four fields at most: name, Art, Herkunft, Konverter
    expect(visibleFields(within(dialog).getByTestId('rule-fields'))).toHaveLength(4);
    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe(
      'Aufrufe: konvertiert mit normalize-bpmn@0.2.0',
    );
    await user.click(within(dialog).getByTestId('rule-save'));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path.endsWith('/auto-accept-rules'))?.body,
      ).toEqual({
        kind: 'relation',
        tier: 'key',
        minConfidence: 0.9,
        relationType: 'call',
        agentPrincipalId: null,
        llmModel: null,
        includeAdHoc: false,
        proposedBy: 'rule',
        derivedKind: 'converted',
        converter: 'normalize-bpmn@0.2.0',
        name: 'Aufrufe: konvertiert mit normalize-bpmn@0.2.0',
        enabled: false,
        note: null,
      }),
    );
  });

  it('„Konvertiert“ from a draft without a converter offers the project’s converters to choose', async () => {
    const { calls, user } = open(
      null,
      {},
      { derived: { derivedKind: 'converted', converter: null } },
    );
    const dialog = screen.getByTestId('rule-dialog');
    // the sources load although the rule is not complete yet
    await waitFor(() =>
      expect(
        [...within(dialog).getByLabelText<HTMLSelectElement>('Konverter').options].map(
          (o) => o.textContent,
        ),
      ).toEqual([
        'Konverter wählen …',
        'normalize-bpmn@0.1.0 (3 offen)',
        'normalize-bpmn@0.2.0 (2 offen)',
      ]),
    );
    expect(within(dialog).queryByTestId('rule-preview')).toBeNull();
    await user.selectOptions(within(dialog).getByLabelText('Konverter'), 'normalize-bpmn@0.1.0');
    await waitFor(() =>
      expect(calls.filter((c) => c.path.endsWith('/preview')).at(-1)?.body).toMatchObject({
        derivedKind: 'converted',
        converter: 'normalize-bpmn@0.1.0',
      }),
    );
    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe(
      'Aufrufe: konvertiert mit normalize-bpmn@0.1.0',
    );
  });

  it('„Konverter“ lists the most open calls first, says when it loads, and why a save waits', async () => {
    // the sources still load: no converter is offered yet, and „Kein Konverter“ is not said
    let answer: (r: Response) => void = () => undefined;
    const { calls, user } = open(
      null,
      {
        [`POST ${BASE}/auto-accept-rules/preview`]: () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      },
      { derived: { derivedKind: 'converted', converter: null } },
    );
    const dialog = screen.getByTestId('rule-dialog');
    const options = () =>
      [...within(dialog).getByLabelText<HTMLSelectElement>('Konverter').options].map(
        (o) => o.textContent,
      );
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/preview'))).toBe(true));
    expect(options()).toEqual(['Lädt …']);
    // a save without a converter says why nothing happens
    await user.click(within(dialog).getByTestId('rule-save'));
    expect(within(dialog).getByText('Wähle einen Konverter.')).toBeTruthy();
    answer(
      json(
        autoAcceptPreview({
          derivedGroups: GROUPS.map((g) =>
            g.converter === 'normalize-bpmn@0.2.0' ? { ...g, open: 7 } : g,
          ),
        }),
      ),
    );
    await waitFor(() =>
      expect(options()).toEqual([
        'Konverter wählen …',
        'normalize-bpmn@0.2.0 (7 offen)',
        'normalize-bpmn@0.1.0 (3 offen)',
      ]),
    );
    expect(
      calls.filter((c) => c.method === 'POST' && c.path.endsWith('/auto-accept-rules')),
    ).toEqual([]);
  });

  it('„Konvertiert“ without converted calls in the project says so', async () => {
    const { user } = open(
      null,
      {
        [`POST ${BASE}/auto-accept-rules/preview`]: () =>
          json(autoAcceptPreview({ derivedGroups: GROUPS.filter((g) => g.converter === null) })),
      },
      { derived: { derivedKind: 'converted', converter: null } },
    );
    const dialog = screen.getByTestId('rule-dialog');
    await waitFor(() =>
      expect(
        [...within(dialog).getByLabelText<HTMLSelectElement>('Konverter').options].map(
          (o) => o.textContent,
        ),
      ).toEqual(['Kein Konverter im Projekt']),
    );
    await user.click(within(dialog).getByTestId('rule-save'));
    expect(
      within(dialog).getByText(
        'Noch kein Aufruf im Projekt stammt aus einem Konverter; wähle eine andere Herkunft.',
      ),
    ).toBeTruthy();
  });

  it('opens prefilled from a draft and edits a saved one with its „Art“ fixed', () => {
    open(null, {}, { derived: { derivedKind: 'converted', converter: 'normalize-bpmn@0.2.0' } });
    const dialog = screen.getByTestId('rule-dialog');
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Art').value).toBe('calls');
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Herkunft').value).toBe('converted');
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Konverter').value).toBe(
      'normalize-bpmn@0.2.0',
    );
    cleanup();
    open(
      autoAcceptRule({
        id: RULE_ID,
        name: 'Signavio-Export',
        relationType: 'call',
        minConfidence: 0.9,
        proposedBy: 'rule',
        derivedKind: 'none',
      }),
    );
    const edit = screen.getByTestId('rule-dialog');
    expect(within(edit).getByLabelText<HTMLSelectElement>('Art').disabled).toBe(true);
    expect(within(edit).getByLabelText<HTMLSelectElement>('Art').value).toBe('calls');
    expect(within(edit).getByLabelText<HTMLSelectElement>('Herkunft').value).toBe('none');
  });
});

// ------------------------------------------------------------------ the rows

describe('RuleTable', () => {
  const dryRoute = (counts: Record<string, number>) => (c: Call) => {
    const id = c.path.split('/').at(-2) ?? '';
    return json({ ...applyResult(true, counts[id] ?? 0), ruleId: id });
  };

  async function table(
    rules: AutoAcceptRule[],
    routes: Record<string, (c: Call) => Response> = {},
    me: string | null = OWNER.principalId,
  ) {
    const calls = stubApi(routes);
    const seen = { apply: [] as AutoAcceptRule[], revoke: [] as string[], history: [] as string[] };
    let reloaded = 0;
    await renderWithRouter(
      <RuleTable
        project="demo"
        rules={rules}
        me={me}
        onEdit={() => undefined}
        onApply={(r) => seen.apply.push(r)}
        onRevoke={(r) => seen.revoke.push(r.id)}
        onHistory={(r) => seen.history.push(r.id)}
        onReload={() => (reloaded += 1)}
      />,
    );
    return { calls, seen, reloaded: () => reloaded, user: userEvent.setup() };
  }

  it('a row: three controls, the criteria, only the counts above 0; no revision', async () => {
    const rules = [
      autoAcceptRule({
        id: RULE_ID,
        revision: 2,
        enabled: true,
        relationType: 'message',
        stats: { inForce: 5, confirmed: 2, revoked: 0, overruled: 1, lastAcceptedAt: null },
      }),
      autoAcceptRule({
        id: RULE_B,
        name: 'Platzierungen ab 90 %',
        kind: 'placement',
        tier: 'semantic',
        minConfidence: 0.9,
        authorIsOwner: false,
      }),
    ];
    await table(rules, {
      [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: dryRoute({}),
    });
    const rows = await screen.findAllByTestId('rule-row');
    // Done when (UX9): 3 controls per row (6 today) – the switch, „Bearbeiten“, „Mehr“.
    expect(controls(rows[1]!).map((c) => c.textContent || c.getAttribute('aria-label'))).toEqual([
      'Regel „Platzierungen ab 90 %“ aktiv',
      'Bearbeiten',
      'Mehr',
    ]);
    // … plus, where acceptances are in force, the link to them.
    expect(controls(rows[0]!)).toHaveLength(4);
    expect(
      within(rows[0]!).getByRole('switch', { name: 'Regel „Schlüssel ab 95 %“ aktiv' }),
    ).toBeTruthy();
    expect(within(rows[0]!).getByTestId('rule-criteria').textContent).toBe(
      'Relationen · Gleicher Name · ab 95 %Typ Nachricht',
    );
    expect(within(rows[0]!).getByTestId('rule-stats').textContent).toBe(
      '5 in Kraft2 bestätigt1 abgelehnt, korrigiert oder vorgemerkt',
    );
    expect(
      within(within(rows[0]!).getByTestId('rule-stats')).getByRole('link', { name: '5 in Kraft' }),
    ).toBeTruthy();
    expect(rows[0]?.textContent).not.toMatch(/\br2\b|owner,/);
    expect(within(rows[1]!).getByTestId('rule-stats').textContent).toBe('–');
    expect(within(rows[1]!).getByTestId('author-not-owner').textContent).toContain(
      'Urheber ist kein Inhaber mehr',
    );
    expect(within(rows[1]!).getByTestId('rule-criteria').textContent).toBe(
      'Platzierungen · Gleiche Bedeutung · ab 90 %',
    );
    // Below 768 px „Bisher“ hides and its counts follow the name in one line (nothing while all are 0).
    const line = within(rows[0]!).getByTestId('rule-stats-line');
    expect(line.classList.contains('md:hidden')).toBe(true);
    expect(line.textContent).toBe(
      '5 in Kraft · 2 bestätigt · 1 abgelehnt, korrigiert oder vorgemerkt',
    );
    expect(within(line).getByRole('link', { name: '5 in Kraft' }).getAttribute('href')).toBe(
      within(within(rows[0]!).getByTestId('rule-stats'))
        .getByRole('link', { name: '5 in Kraft' })
        .getAttribute('href'),
    );
    expect(within(rows[1]!).queryByTestId('rule-stats-line')).toBeNull();
  });

  it('„Mehr“: „Verlauf“, and „Widerrufen…“ only while acceptances are in force', async () => {
    const rules = [
      autoAcceptRule({
        id: RULE_ID,
        stats: { inForce: 2, confirmed: 0, revoked: 0, overruled: 0, lastAcceptedAt: null },
      }),
      autoAcceptRule({ id: RULE_B, name: 'Ohne Annahmen' }),
    ];
    const { seen, user } = await table(rules);
    const rows = await screen.findAllByTestId('rule-row');
    await user.click(within(rows[1]!).getByRole('button', { name: 'Mehr' }));
    let menu = screen.getByRole('menu', { name: 'Mehr zu „Ohne Annahmen“' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Verlauf']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Verlauf' }));
    expect(seen.history).toEqual([RULE_B]);
    await user.click(within(rows[0]!).getByRole('button', { name: 'Mehr' }));
    menu = screen.getByRole('menu', { name: 'Mehr zu „Schlüssel ab 95 %“' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Verlauf', 'Widerrufen…']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Widerrufen…' }));
    expect(seen.revoke).toEqual([RULE_ID]);
  });

  it('an active rule whose dry run finds open proposals offers them in one line', async () => {
    const rules = [
      autoAcceptRule({ id: RULE_ID, enabled: true }),
      autoAcceptRule({ id: RULE_B, name: 'Aus', enabled: false }),
    ];
    const { calls, seen, user } = await table(rules, {
      [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: dryRoute({ [RULE_ID]: 2 }),
    });
    const rows = await screen.findAllByTestId('rule-row');
    const hint = await within(rows[0]!).findByTestId('rule-apply');
    expect(hint.textContent).toBe('2 offene Vorschläge passen – ansehen …');
    await user.click(hint);
    expect(seen.apply.map((r) => r.id)).toEqual([RULE_ID]);
    // A rule that is off runs no dry run and offers nothing.
    expect(within(rows[1]!).queryByTestId('rule-apply')).toBeNull();
    expect(calls.filter((c) => c.path.includes(RULE_B))).toEqual([]);
    // A hint: its dry run is not repeated when the window regains the focus.
    try {
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls.filter((c) => c.path.endsWith(`${RULE_ID}/apply`))).toHaveLength(1);
    } finally {
      focusManager.setFocused(undefined);
    }
  });

  it('disabling asks nothing and writes with If-Match; a 412 offers the newer revision', async () => {
    const rule = autoAcceptRule({
      id: RULE_ID,
      revision: 2,
      enabled: true,
      relationType: 'message',
    });
    let attempt = 0;
    const { calls, reloaded, user } = await table([rule], {
      [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: dryRoute({}),
      [`PUT ${BASE}/auto-accept-rules/${RULE_ID}`]: () => {
        attempt += 1;
        return attempt === 1
          ? json({ outcome: 'revised', rule: detail({ ...rule, revision: 3, enabled: false }) })
          : problem(412, 'revision-conflict', { headRev: 4 });
      },
    });
    const [row] = await screen.findAllByTestId('rule-row');
    await user.click(within(row!).getByRole('switch'));
    await findToast('Regel „Schlüssel ab 95 %“ deaktiviert');
    expect(screen.queryByTestId('enable-confirm')).toBeNull();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toMatchObject({ headers: { 'if-match': '"r2"' } });
    expect(put?.body).toMatchObject({ enabled: false, relationType: 'message' });

    await user.click(within(row!).getByRole('switch'));
    expect(
      await screen.findByText('Die Regel „Schlüssel ab 95 %“ wurde inzwischen geändert'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Neuere Revision laden' }));
    expect(reloaded()).toBe(1);
  });

  it('enabling one’s own rule without open proposals asks nothing', async () => {
    const rule = autoAcceptRule({ id: RULE_ID, revision: 2 });
    const { calls, user } = await table([rule], {
      [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: dryRoute({}),
      [`PUT ${BASE}/auto-accept-rules/${RULE_ID}`]: () =>
        json({ outcome: 'revised', rule: detail({ ...rule, revision: 3, enabled: true }) }),
    });
    const [row] = await screen.findAllByTestId('rule-row');
    await user.click(within(row!).getByRole('switch'));
    await findToast('Regel „Schlüssel ab 95 %“ aktiviert');
    expect(screen.queryByTestId('enable-confirm')).toBeNull();
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ enabled: true });
  });

  it('enabling with open proposals confirms first and offers the list', async () => {
    const rule = autoAcceptRule({ id: RULE_ID, revision: 2 });
    const { calls, seen, user } = await table([rule], {
      [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: dryRoute({ [RULE_ID]: 2 }),
      [`PUT ${BASE}/auto-accept-rules/${RULE_ID}`]: () =>
        json({ outcome: 'revised', rule: detail({ ...rule, revision: 3, enabled: true }) }),
    });
    const [row] = await screen.findAllByTestId('rule-row');
    await user.click(within(row!).getByRole('switch'));
    const confirm = await screen.findByTestId('enable-confirm');
    expect(within(confirm).getByRole('heading').textContent).toBe(
      'Regel „Schlüssel ab 95 %“ aktivieren?',
    );
    expect(within(confirm).getByTestId('enable-open').textContent).toContain(
      '2 offene Vorschläge passen schon jetzt. Regeln wirken nur auf neue Vorschläge.',
    );
    expect(within(confirm).queryByTestId('enable-take-over')).toBeNull();
    // Nothing is written before the owner confirms.
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    await user.click(
      within(confirm).getByRole('button', { name: 'Aktivieren und Liste ansehen…' }),
    );
    await findToast('Regel „Schlüssel ab 95 %“ aktiviert');
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ enabled: true });
    // The apply dialog opens on the new revision.
    await waitFor(() => expect(seen.apply.map((r) => r.revision)).toEqual([3]));
  });

  it('enabling another owner’s rule says the caller becomes its deciding person', async () => {
    const rule = autoAcceptRule({ id: RULE_ID, revision: 2 });
    const { calls, seen, user } = await table(
      [rule],
      {
        [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: dryRoute({}),
        [`PUT ${BASE}/auto-accept-rules/${RULE_ID}`]: () =>
          json({ outcome: 'revised', rule: detail({ ...rule, revision: 3, enabled: true }) }),
      },
      'prn_01J9Z3N4X5Q6R7S8T9V0W1X2ME',
    );
    const [row] = await screen.findAllByTestId('rule-row');
    await user.click(within(row!).getByRole('switch'));
    const confirm = await screen.findByTestId('enable-confirm');
    expect(within(confirm).getByTestId('enable-take-over').textContent).toBe(
      'Bisher entscheidet owner. Du wirst damit die entscheidende Person dieser Regel: Ihre Annahmen werden als deine Entscheidungen vermerkt.',
    );
    expect(within(confirm).queryByTestId('enable-open')).toBeNull();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: 'Aktivieren' }));
    await findToast('Regel „Schlüssel ab 95 %“ aktiviert');
    expect(seen.apply).toEqual([]);
  });

  it('enabling a rule whose author lost the owner role says so, also while „me“ is unknown', async () => {
    const rule = autoAcceptRule({ id: RULE_ID, authorIsOwner: false });
    const { calls, user } = await table(
      [rule],
      { [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: dryRoute({}) },
      null,
    );
    const [row] = await screen.findAllByTestId('rule-row');
    await user.click(within(row!).getByRole('switch'));
    const confirm = await screen.findByTestId('enable-confirm');
    expect(within(confirm).getByTestId('enable-take-over').textContent).toContain(
      'owner ist kein Inhaber mehr, deshalb nimmt die Regel bisher nichts an. Du wirst damit die entscheidende Person dieser Regel',
    );
    await user.click(within(confirm).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByTestId('enable-confirm')).toBeNull());
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('an enabled rule whose author lost the owner role is drawn off; turning it on takes it over after asking', async () => {
    const former = { principalId: 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2FO', handle: 'ehemalig' };
    const rule = autoAcceptRule({
      id: RULE_ID,
      revision: 2,
      enabled: true,
      authorIsOwner: false,
      author: former,
    });
    const { calls, user } = await table([rule], {
      [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: dryRoute({}),
      [`PUT ${BASE}/auto-accept-rules/${RULE_ID}`]: () =>
        json({ outcome: 'revised', rule: detail({ ...rule, revision: 3, author: OWNER }) }),
    });
    const [row] = await screen.findAllByTestId('rule-row');
    // It accepts nothing: the switch is off and no open proposals are offered.
    const toggle = within(row!).getByRole('switch', { name: 'Regel „Schlüssel ab 95 %“ aktiv' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(within(row!).getByTestId('author-not-owner').title).toContain('„Aktiv“ auf aus');
    expect(within(row!).queryByTestId('rule-apply')).toBeNull();
    await user.click(toggle);
    const confirm = await screen.findByTestId('enable-confirm');
    expect(within(confirm).getByTestId('enable-take-over').textContent).toBe(
      'ehemalig ist kein Inhaber mehr, deshalb nimmt die Regel bisher nichts an. Du wirst damit die entscheidende Person dieser Regel: Ihre Annahmen werden als deine Entscheidungen vermerkt.',
    );
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: 'Aktivieren' }));
    await findToast('Regel „Schlüssel ab 95 %“ aktiviert');
    // The same fields, enabled: the server writes the take-over revision.
    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toMatchObject({ headers: { 'if-match': '"r2"' } });
    expect(put?.body).toMatchObject({ enabled: true, name: 'Schlüssel ab 95 %' });
  });

  it('enabling while „me“ is not loaded yet fetches it: one’s own rule asks nothing', async () => {
    const rule = autoAcceptRule({ id: RULE_ID, revision: 2 });
    const { calls, user } = await table(
      [rule],
      {
        'GET /api/v1/me': () =>
          json({ ...OWNER, kind: 'user', authMode: 'local', clientId: 'analyzr-web' }),
        [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: dryRoute({}),
        [`PUT ${BASE}/auto-accept-rules/${RULE_ID}`]: () =>
          json({ outcome: 'revised', rule: detail({ ...rule, revision: 3, enabled: true }) }),
      },
      null,
    );
    const [row] = await screen.findAllByTestId('rule-row');
    await user.click(within(row!).getByRole('switch'));
    await findToast('Regel „Schlüssel ab 95 %“ aktiviert');
    expect(screen.queryByTestId('enable-confirm')).toBeNull();
    expect(calls.some((c) => c.path === '/api/v1/me')).toBe(true);
  });

  it('enabling while „me“ cannot be loaded asks, since the author may be someone else', async () => {
    const rule = autoAcceptRule({ id: RULE_ID, revision: 2 });
    const { calls, user } = await table(
      [rule],
      {
        'GET /api/v1/me': () => problem(500, 'internal'),
        [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: dryRoute({}),
      },
      null,
    );
    const [row] = await screen.findAllByTestId('rule-row');
    await user.click(within(row!).getByRole('switch'));
    const confirm = await screen.findByTestId('enable-confirm');
    expect(within(confirm).getByTestId('enable-take-over').textContent).toBe(
      'Bisher entscheidet owner. Bist du das nicht, wirst du damit die entscheidende Person dieser Regel: Ihre Annahmen werden als deine Entscheidungen vermerkt.',
    );
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('a rule for derived calls names its source; enabled it acts on new call proposals (M6 S2c-3)', async () => {
    const rule = autoAcceptRule({
      id: RULE_ID,
      name: 'Aufrufe: konvertiert mit x@1',
      relationType: 'call',
      minConfidence: 0.9,
      proposedBy: 'rule',
      derivedKind: 'converted',
      converter: 'x@1',
    });
    const { user } = await table([rule], {
      [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: dryRoute({}),
      [`PUT ${BASE}/auto-accept-rules/${RULE_ID}`]: (c) =>
        json({ outcome: 'revised', rule: detail({ ...rule, ...(c.body as object), revision: 2 }) }),
    });
    const row = await screen.findByTestId('rule-row');
    expect(within(row).getByTestId('rule-criteria').textContent).toBe(
      'Eindeutige Aufrufe aus abgeleiteten Modellen · Konvertiert mit x@1',
    );
    expect(controls(row)).toHaveLength(3);
    await user.click(within(row).getByRole('switch'));
    const toast = await findToast('Regel „Aufrufe: konvertiert mit x@1“ aktiviert');
    expect(toast.textContent).toContain(
      'Sie wirkt auf neue Aufrufvorschläge aus abgeleiteten Modellen.',
    );
  });
});

describe('the system rule', () => {
  const system = {
    id: 'analyzr-rules/1.0.0',
    name: 'Eindeutige Aufrufe',
    description: '',
    kind: 'relation',
    relationType: 'call',
    readOnly: true,
    accepted: 10,
    proposed: 0,
  } as const;

  it('one line with the real count, no matching rule or procedure', async () => {
    await renderWithRouter(<SystemRuleCard project="demo" system={system} />);
    const card = await screen.findByTestId('system-rule');
    expect(card.textContent).toBe(
      'Eindeutige Aufrufe aus Camunda-Modellen nimmt analyzr beim Hochladen an · immer aktiv · 10 angenommen',
    );
    expect(within(card).getByRole('link', { name: '10 angenommen' })).toBeTruthy();
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('names the calls of derived models it only proposed (the trust rule), leading to their bulk accept', async () => {
    await renderWithRouter(<SystemRuleCard project="demo" system={{ ...system, proposed: 12 }} />);
    const card = await screen.findByTestId('system-rule');
    expect(card.textContent).toBe(
      'Eindeutige Aufrufe aus Camunda-Modellen nimmt analyzr beim Hochladen an · immer aktiv · 10 angenommen · 12 aus abgeleiteten Modellen vorgeschlagen',
    );
    // The bulk dialog opens with exactly those calls selected (M6 S2c, `?bulk=calls`).
    expect(
      within(card)
        .getAllByRole('link')
        .map((l) => [l.textContent, l.getAttribute('href')]),
    ).toEqual([
      ['10 angenommen', '/projects/demo/relations?status=accepted&tier=rule'],
      ['12 aus abgeleiteten Modellen vorgeschlagen', '/projects/demo/review?bulk=calls'],
    ]);
    expect(within(card).getByTestId('system-rule-proposed').textContent).toBe(
      '12 aus abgeleiteten Modellen vorgeschlagen',
    );
  });
});

// ------------------------------------------------------ apply and revoke lists

describe('ApplyDialog and RevokeDialog', () => {
  it('apply: dry run, then the head revision and expectedCount; a 409 reloads the dry run', async () => {
    let dryRuns = 0;
    let real = 0;
    const calls = stubApi({
      [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: (c) => {
        if (c.search === '?dryRun=true') {
          dryRuns += 1;
          return json(applyResult(true, dryRuns === 1 ? 2 : 3));
        }
        real += 1;
        return real === 1
          ? problem(409, 'conflict', { count: 3, revision: 2 })
          : json(applyResult(false, 3));
      },
    });
    const rule = autoAcceptRule({ id: RULE_ID, revision: 2, enabled: true });
    renderWithQuery(<ApplyDialog project="demo" rule={rule} open onOpenChange={() => undefined} />);
    const user = userEvent.setup();
    const dialog = screen.getByTestId('apply-dialog');
    expect((await within(dialog).findByTestId('apply-summary')).textContent).toBe(
      '2 offene Vorschläge erfüllen die Regel.',
    );
    // The agent without „agent:“, the confidence in percent, no LLM model.
    const first = within(dialog).getAllByTestId('apply-item')[0]?.textContent ?? '';
    expect(first).toContain('claude code · 97 %');
    expect(first).not.toMatch(/0,97|sim-policy-1|agent:/);
    expect(within(dialog).getByText('Ein Mensch war schon beteiligt')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: '2 Vorschläge annehmen' }));
    expect(
      await within(dialog).findByText('Die offenen Vorschläge haben sich geändert'),
    ).toBeTruthy();
    await user.click(await within(dialog).findByRole('button', { name: '3 Vorschläge annehmen' }));
    await findToast('3 Vorschläge automatisch angenommen');
    // (besides the dialog's reads of the names and flags)
    const applied = calls.filter((c) => c.path.endsWith('/apply') && c.search === '');
    expect(applied.map((c) => c.body)).toEqual([
      { revision: 2, expectedCount: 2 },
      { revision: 2, expectedCount: 3 },
    ]);
  });

  it('apply: names the elements, lists every item (scrolling) and counts the name flags', async () => {
    const many = [
      itemOf(ANTWORT, 1),
      ...Array.from({ length: 24 }, (_, i) => ({ ...itemOf(RECHNUNG, 2), triggerId: `ast_1${i}` })),
    ];
    stubApi({
      ...FACT_ROUTES,
      [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: () =>
        json(applyResult(true, many.length, {}, many)),
    });
    renderWithQuery(
      <ApplyDialog
        project="demo"
        rule={autoAcceptRule({ id: RULE_ID, enabled: true })}
        open
        onOpenChange={() => undefined}
      />,
    );
    const dialog = screen.getByTestId('apply-dialog');
    await waitFor(() => expect(within(dialog).getAllByTestId('apply-item')).toHaveLength(25));
    expect(dialog.textContent).not.toContain('weitere');
    await waitFor(() =>
      expect(within(dialog).getAllByTestId('apply-item')[0]?.textContent).toBe(
        'Angebot → AnfrageNachricht · Antwort senden → Antwort erhalten · claude code · 97 %',
      ),
    );
    expect(dialog.textContent).not.toContain('vertrieb/angebot#');
    expect(within(dialog).getByTestId('apply-flags').textContent).toBe(
      'davon 1 mit allgemeinem oder mehrfach genutztem Namen (in der Sammelannahme markiert)',
    );
  });

  it('apply: a disabled rule accepts nothing', async () => {
    stubApi({
      [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: () =>
        json(applyResult(true, 2, { enabled: false })),
    });
    renderWithQuery(
      <ApplyDialog
        project="demo"
        rule={autoAcceptRule({ id: RULE_ID })}
        open
        onOpenChange={() => undefined}
      />,
    );
    const dialog = screen.getByTestId('apply-dialog');
    await within(dialog).findByTestId('apply-summary');
    expect(within(dialog).getByText(/Die Regel ist aus/)).toBeTruthy();
    expect(within(dialog).getByTestId('apply-confirm')).toHaveProperty('disabled', true);
  });

  it('apply: the dry run tells when the author is no longer an owner (the row may be older)', async () => {
    stubApi({
      [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: () =>
        json(applyResult(true, 2, { authorIsOwner: false })),
    });
    renderWithQuery(
      <ApplyDialog
        project="demo"
        rule={autoAcceptRule({ id: RULE_ID, enabled: true })}
        open
        onOpenChange={() => undefined}
      />,
    );
    const dialog = screen.getByTestId('apply-dialog');
    await within(dialog).findByTestId('apply-summary');
    expect(
      within(dialog).getByText(
        /Der Urheber der Regel ist kein Inhaber mehr\. Speichere die Regel neu/,
      ),
    ).toBeTruthy();
    expect(within(dialog).getByTestId('apply-confirm')).toHaveProperty('disabled', true);
  });

  it('revoke: dry run summary, the list by name, reason, then expectedCount', async () => {
    const result = (dryRun: boolean) => ({
      dryRun,
      count: 2,
      toProposed: 1,
      toObsolete: 1,
      humanDecidedSince: 1,
      alreadyRevoked: 0,
      items: [
        {
          ...ledgerEntry({ id: ANTWORT.id, from: ANTWORT.from, to: ANTWORT.to }),
          outcome: 'proposed',
        },
        { ...ledgerEntry({ id: 'rel_01B', decisionId: 'ast_01B' }), outcome: 'obsolete' },
      ],
      truncated: false,
    });
    const calls = stubApi({
      ...FACT_ROUTES,
      [`POST ${BASE}/auto-accept-revocations`]: (c) => json(result(c.search === '?dryRun=true')),
    });
    let closed = false;
    renderWithQuery(
      <RevokeDialog
        project="demo"
        open
        onOpenChange={(o) => (closed = !o)}
        selection={{ ruleId: RULE_ID }}
        title="Annahmen der Regel „Schlüssel ab 95 %“ widerrufen"
      />,
    );
    const user = userEvent.setup();
    const dialog = screen.getByTestId('revoke-dialog');
    expect((await within(dialog).findByTestId('revoke-summary')).textContent).toBe(
      '2 automatische Annahmen: 1 geht zurück in die Prüfung (ein Vorschlag ist noch offen); 1 wird veraltet und von den Agenten neu beurteilt (kein offener Vorschlag mehr). 1 wurde inzwischen von einem Menschen entschieden und bleibt unverändert.',
    );
    await waitFor(() =>
      expect(within(dialog).getAllByTestId('revoke-item')[0]?.textContent).toBe(
        'Angebot → AnfrageNachricht · Antwort senden → Antwort erhalten · claude code · 97 % · zurück in die Prüfung',
      ),
    );
    expect(within(dialog).getAllByTestId('revoke-item')[1]?.textContent).toContain('wird veraltet');
    await user.type(within(dialog).getByLabelText('Grund (optional)'), 'Stichprobe falsch');
    await user.click(within(dialog).getByRole('button', { name: '2 widerrufen' }));
    await findToast('2 automatische Annahmen widerrufen');
    // (The project refresh after the write may run the still mounted dry run once more.)
    const revocations = calls.filter((c) => c.path.endsWith('/auto-accept-revocations'));
    expect(revocations.slice(0, 2).map((c) => [c.search, c.body])).toEqual([
      ['?dryRun=true', { ruleId: RULE_ID }],
      ['', { ruleId: RULE_ID, expectedCount: 2, reason: 'Stichprobe falsch' }],
    ]);
    expect(closed).toBe(true);
  });
});

// ------------------------------------------------------------------ the page

describe('the page „Annahmeregeln“', () => {
  const LOCAL: Health = { status: 'ok', version: '0.1.0-test', db: 'ok' };
  const PROJECT: Project = {
    id: 'prj_01DEMO',
    key: 'demo',
    name: 'Demo',
    role: 'owner',
    lastSeq: 1,
    createdAt: '2026-10-07T09:00:00.000Z',
  };
  const SYSTEM = {
    id: 'analyzr-rules/1.0.0',
    name: 'Eindeutige Aufrufe',
    description: '',
    kind: 'relation',
    relationType: 'call',
    readOnly: true,
    accepted: 10,
    proposed: 0,
  };

  function page(
    rules: AutoAcceptRule[],
    ledger: ReturnType<typeof ledgerEntry>[] = [],
    path = '/projects/demo/rules',
    routes: Record<string, (c: Call) => Response | Promise<Response>> = {},
  ) {
    const calls = stubApi({
      'GET /api/v1/projects': () => json({ items: [PROJECT], nextCursor: null }),
      [`GET ${BASE}`]: () => json(PROJECT),
      'GET /api/v1/me': () =>
        json({ ...OWNER, kind: 'user', authMode: 'local', clientId: 'analyzr-web' }),
      [`GET ${BASE}/auto-accept-rules`]: () => json({ items: rules, system: SYSTEM }),
      [`GET ${BASE}/agent-tokens`]: () => json({ items: [] }),
      [`GET ${BASE}/auto-accepted`]: () => json({ items: ledger }),
      [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: () => json(applyResult(true, 0)),
      [`POST ${BASE}/auto-accept-revocations`]: (c) =>
        json({
          dryRun: c.search === '?dryRun=true',
          count: 2,
          toProposed: 0,
          toObsolete: 2,
          humanDecidedSince: 0,
          alreadyRevoked: 0,
          items: [],
          truncated: false,
        }),
      [`GET ${BASE}/auto-accept-rules/${RULE_ID}`]: () =>
        json(detail(rules.find((r) => r.id === RULE_ID) ?? autoAcceptRule({ id: RULE_ID }))),
      ...routes,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    queryClient.setQueryData(healthQuery.queryKey, LOCAL);
    queryClient.setQueryData(projectsQuery.queryKey, [PROJECT]);
    queryClient.setQueryData(projectQuery('demo').queryKey, PROJECT);
    const router = createAppRouter({
      queryClient,
      history: createMemoryHistory({ initialEntries: [path] }),
    });
    render(<App queryClient={queryClient} router={router} />);
    return { calls, router, user: userEvent.setup() };
  }

  it('after a bulk accept (`?new=key`) opens the new rule prefilled „Gleicher Name ab 100 %“', async () => {
    const { router } = page(
      [autoAcceptRule({ id: RULE_ID, name: 'Gleicher Name ab 100 %' })],
      [],
      '/projects/demo/rules?new=key',
    );
    const dialog = await screen.findByTestId('rule-dialog');
    // the name is taken by the existing rule: the suggestion counts on
    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe(
      'Gleicher Name ab 100 % (2)',
    );
    expect(within(dialog).getByLabelText<HTMLInputElement>('ab Konfidenz (%)').value).toBe('100');
    await waitFor(() => expect(router.state.location.href).toBe('/projects/demo/rules'));
  });

  it('says the safeguard once; the empty page has „Erste Regel anlegen“ only', async () => {
    page([]);
    const rulesPage = await screen.findByTestId('rules-page');
    expect(within(rulesPage).getByTestId('rules-safeguard').textContent).toBe(
      'analyzr nimmt neue Vorschläge, die eine aktive Regel trifft, selbst an – nie bei einer offenen Frage, einem Einwand oder wenn du schon entschieden hast.',
    );
    expect(within(rulesPage).getByTestId('system-rule').textContent).toBe(
      'Eindeutige Aufrufe aus Camunda-Modellen nimmt analyzr beim Hochladen an · immer aktiv · 10 angenommen',
    );
    expect(
      within(rulesPage)
        .getAllByTestId('new-rule')
        .map((b) => b.textContent),
    ).toEqual(['Erste Regel anlegen']);
    expect(within(rulesPage).queryByTestId('rules-more')).toBeNull();
    expect(rulesPage.textContent).not.toMatch(/calledElement|analyzr-rules|Agenten sehen keine/);
  });

  it('„Neue Regel“ beside the rules; „Nach Agent widerrufen…“ in the header’s „Mehr“ while acceptances are in force', async () => {
    const { calls, user } = page(
      [
        autoAcceptRule({
          id: RULE_ID,
          stats: { inForce: 2, confirmed: 0, revoked: 0, overruled: 0, lastAcceptedAt: null },
        }),
      ],
      [ledgerEntry({ id: 'rel_01A' }), ledgerEntry({ id: 'rel_01B', decisionId: 'ast_01B' })],
    );
    const rulesPage = await screen.findByTestId('rules-page');
    expect(
      within(rulesPage)
        .getAllByTestId('new-rule')
        .map((b) => b.textContent),
    ).toEqual(['Neue Regel']);
    expect(within(rulesPage).queryByTestId('agent-revoke')).toBeNull();
    await user.click(await within(rulesPage).findByTestId('rules-more'));
    await user.click(screen.getByRole('menuitem', { name: 'Nach Agent widerrufen…' }));
    const dialog = await screen.findByTestId('revoke-dialog');
    expect(within(dialog).getByRole('heading').textContent).toBe(
      'Annahmen von claude code widerrufen',
    );
    expect(within(dialog).queryByLabelText('Agent')).toBeNull();
    expect((await within(dialog).findByTestId('revoke-summary')).textContent).toBe(
      '2 automatische Annahmen: 2 werden veraltet und von den Agenten neu beurteilt (kein offener Vorschlag mehr).',
    );
    await user.click(within(dialog).getByRole('button', { name: '2 widerrufen' }));
    await findToast('2 automatische Annahmen widerrufen');
    const revocations = calls.filter((c) => c.path.endsWith('/auto-accept-revocations'));
    expect(revocations.slice(0, 2).map((c) => [c.search, c.body])).toEqual([
      ['?dryRun=true', { agentPrincipalId: 'prn_01AGENT' }],
      ['', { agentPrincipalId: 'prn_01AGENT', expectedCount: 2 }],
    ]);
  });

  // The menus close as their dialog opens, so Radix has nothing to return the focus to.
  const IN_FORCE = { inForce: 2, confirmed: 0, revoked: 0, overruled: 0, lastAcceptedAt: null };
  const LEDGER = [
    ledgerEntry({ id: 'rel_01A' }),
    ledgerEntry({ id: 'rel_01B', decisionId: 'ast_01B' }),
  ];

  it.each([
    ['Verlauf', 'rule-history'],
    ['Widerrufen…', 'revoke-dialog'],
  ])('„%s“ from a row’s „Mehr“ returns the focus to it on closing', async (item, testId) => {
    const { user } = page([autoAcceptRule({ id: RULE_ID, stats: IN_FORCE })], LEDGER);
    const row = await screen.findByTestId('rule-row');
    const more = within(row).getByTestId('rule-more');
    await user.click(more);
    await user.click(screen.getByRole('menuitem', { name: item }));
    await screen.findByTestId(testId);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId(testId)).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(more));
  });

  it('„Nach Agent widerrufen…“ returns the focus to the page’s „Mehr“ on closing', async () => {
    const { user } = page([autoAcceptRule({ id: RULE_ID, stats: IN_FORCE })], LEDGER);
    const more = await screen.findByTestId('rules-more');
    await user.click(more);
    await user.click(screen.getByRole('menuitem', { name: 'Nach Agent widerrufen…' }));
    const dialog = await screen.findByTestId('revoke-dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByTestId('revoke-dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(more));
  });

  it('the apply dialog of a row’s hint runs its own dry run and returns the focus to the row’s „Mehr“', async () => {
    let dryRuns = 0;
    let release: () => void = () => undefined;
    const { user } = page(
      [autoAcceptRule({ id: RULE_ID, revision: 2, enabled: true })],
      [],
      undefined,
      {
        [`POST ${BASE}/auto-accept-rules/${RULE_ID}/apply`]: () => {
          dryRuns += 1;
          if (dryRuns === 1) return json(applyResult(true, 2));
          return new Promise<Response>((resolve) => {
            release = () => resolve(json(applyResult(true, 3)));
          });
        },
      },
    );
    const row = await screen.findByTestId('rule-row');
    const hint = await within(row).findByTestId('rule-apply');
    expect(hint.textContent).toBe('2 offene Vorschläge passen – ansehen …');
    await user.click(hint);
    const dialog = await screen.findByTestId('apply-dialog');
    // While its own dry run runs, the dialog shows no count: never the hint's cached one.
    await waitFor(() => expect(dryRuns).toBe(2));
    expect(within(dialog).queryByTestId('apply-summary')).toBeNull();
    act(() => release());
    expect((await within(dialog).findByTestId('apply-summary')).textContent).toBe(
      '3 offene Vorschläge erfüllen die Regel.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByTestId('apply-dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(row).getByTestId('rule-more')));
  });
  it('after a bulk accept of derived calls (`?new=calls`) opens a rule for their source (M6 S2c-3)', async () => {
    const { router } = page(
      [],
      [],
      '/projects/demo/rules?new=calls&derivedKind=converted&converter=normalize-bpmn%400.1.0',
      {
        [`POST ${BASE}/auto-accept-rules/preview`]: () => json(autoAcceptPreview()),
      },
    );
    const dialog = await screen.findByTestId('rule-dialog');
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Art').value).toBe('calls');
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Herkunft').value).toBe('converted');
    expect(within(dialog).getByLabelText<HTMLSelectElement>('Konverter').value).toBe(
      'normalize-bpmn@0.1.0',
    );
    expect(within(dialog).getByLabelText<HTMLInputElement>('Name').value).toBe(
      'Aufrufe: konvertiert mit normalize-bpmn@0.1.0',
    );
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });
});
