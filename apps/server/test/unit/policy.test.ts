/**
 * The policy matrix (CONCEPT §6), generated: permission × role × principal
 * kind × credential scopes × visibility. The expectation is written as an
 * independent table so a change to `evaluate` has to change both.
 */
import type { Role, Scope } from '@analyzr/contracts';
import { describe, expect, it } from 'vitest';

import type { Actor } from '../../src/domain/actor.ts';
import { effectiveScopes, evaluate, tokenRole, type Permission } from '../../src/domain/policy.ts';

const PERMISSIONS: Permission[] = ['read', 'propose', 'write', 'review', 'admin'];
const ROLES: (Role | null)[] = [null, 'viewer', 'editor', 'owner'];
const SCOPE_SETS: Scope[][] = [
  ['analyzr:read'],
  ['analyzr:read', 'analyzr:propose'],
  ['analyzr:write'],
  ['analyzr:read', 'analyzr:propose', 'analyzr:write'],
  ['analyzr:read', 'analyzr:propose', 'analyzr:write', 'analyzr:review'],
];
const PRINCIPALS = [
  { name: 'user on analyzr-web', kind: 'user', interactive: true },
  { name: 'user on another client', kind: 'user', interactive: false },
  { name: 'service (agent token)', kind: 'service', interactive: false },
] as const;

/** Independent restatement of the CONCEPT §6 table. */
function expected(
  permission: Permission,
  role: Role | null,
  scopes: Scope[],
  human: boolean,
): string | null {
  if (role === null) return 'not-found';
  const has = (s: Scope) =>
    scopes.includes(s) ||
    (s === 'analyzr:read' && scopes.length > 0) ||
    (s === 'analyzr:propose' && scopes.includes('analyzr:review'));
  const rank = { viewer: 0, editor: 1, owner: 2 }[role];
  switch (permission) {
    case 'read':
      return has('analyzr:read') ? null : 'insufficient-scope';
    case 'propose':
      if (!has('analyzr:propose')) return 'insufficient-scope';
      return rank >= 1 ? null : 'forbidden';
    case 'write':
      if (!has('analyzr:write')) return 'insufficient-scope';
      return rank >= 1 ? null : 'forbidden';
    case 'review':
      if (!human) return 'human-decision-required';
      if (!has('analyzr:review')) return 'insufficient-scope';
      return rank >= 1 ? null : 'forbidden';
    case 'admin':
      if (!human) return 'forbidden';
      if (!has('analyzr:write')) return 'insufficient-scope';
      return rank >= 2 ? null : 'forbidden';
  }
}

const cases = PERMISSIONS.flatMap((permission) =>
  ROLES.flatMap((role) =>
    SCOPE_SETS.flatMap((scopes) =>
      PRINCIPALS.map((p) => ({ permission, role, scopes, principal: p })),
    ),
  ),
);

describe('policy.evaluate (generated matrix)', () => {
  it(`covers ${cases.length} combinations`, () => {
    expect(cases.length).toBe(5 * 4 * 5 * 3);
  });

  it.each(cases)(
    '$permission / role $role / $scopes / $principal.name',
    ({ permission, role, scopes, principal }) => {
      const actor: Actor = {
        principalId: 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2Y3',
        kind: principal.kind,
        handle: 'x',
        clientId: null,
        interactive: principal.interactive,
        scopes,
        binding: null,
      };
      const human = principal.kind === 'user' && principal.interactive;
      expect(evaluate(actor, permission, role)?.code ?? null).toBe(
        expected(permission, role, scopes, human),
      );
    },
  );
});

describe('scopes and token roles', () => {
  it('nests scopes: review ⊇ propose ⊇ read, write ⊇ read', () => {
    expect([...effectiveScopes(['analyzr:review'])].sort()).toEqual([
      'analyzr:propose',
      'analyzr:read',
      'analyzr:review',
    ]);
    expect([...effectiveScopes(['analyzr:write'])].sort()).toEqual([
      'analyzr:read',
      'analyzr:write',
    ]);
    expect(effectiveScopes(['analyzr:write']).has('analyzr:propose')).toBe(false);
  });

  it('makes a token an editor unless it may only read', () => {
    expect(tokenRole(['analyzr:read'])).toBe('viewer');
    expect(tokenRole(['analyzr:read', 'analyzr:propose'])).toBe('editor');
    expect(tokenRole(['analyzr:write'])).toBe('editor');
  });

  it('never lets an agent token decide, even with every scope', () => {
    const agent: Actor = {
      principalId: 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2Y3',
      kind: 'service',
      handle: 'agent',
      clientId: 'agt_01J9Z3N4X5Q6R7S8T9V0W1X2Y3',
      interactive: false,
      scopes: ['analyzr:read', 'analyzr:propose', 'analyzr:write', 'analyzr:review'],
      binding: { projectId: 'prj_01J9Z3N4X5Q6R7S8T9V0W1X2Y3', role: 'owner' },
    };
    expect(evaluate(agent, 'review', 'owner')?.code).toBe('human-decision-required');
    expect(evaluate(agent, 'admin', 'owner')?.code).toBe('forbidden');
  });
});

describe('the read-only demo visitor (owner decision 20)', () => {
  // As `demoVisitorActor` builds it: a user on analyzr-web with analyzr:read only, viewer everywhere.
  const visitor: Actor = {
    principalId: 'prn_01J9Z3N4X5Q6R7S8T9V0W1X2Y3',
    kind: 'user',
    handle: 'visitor',
    clientId: 'analyzr-web',
    interactive: true,
    scopes: ['analyzr:read'],
    binding: null,
  };

  it('may read, nothing else: denied by scope first, by the viewer role behind it', () => {
    expect(evaluate(visitor, 'read', 'viewer')).toBeNull();
    for (const permission of ['propose', 'write', 'review', 'admin'] as const) {
      expect(evaluate(visitor, permission, 'viewer')?.code, permission).toBe('insufficient-scope');
      // Even with every scope, the viewer role denies.
      const scoped: Actor = { ...visitor, scopes: ['analyzr:review', 'analyzr:write'] };
      expect(evaluate(scoped, permission, 'viewer')?.code, permission).toBe('forbidden');
    }
    expect(evaluate(visitor, 'read', null)?.code).toBe('not-found');
  });
});
