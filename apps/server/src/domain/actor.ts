import type { PrincipalId, ProjectId, Role, Scope, SourceKind } from '@analyzr/contracts';

/**
 * The authenticated caller of a use case (CONCEPT §6). Built by the auth
 * layer from the credential; the domain never sees headers or cookies.
 */
export interface Actor {
  principalId: PrincipalId;
  kind: 'user' | 'service';
  /** Pseudonymous handle for events and the UI; never an e-mail address. */
  handle: string;
  /** Client the call came from: `analyzr-web`, `analyzr-cli`, `agt_…`. */
  clientId: string | null;
  /** A user on an interactive client (`analyzr-web`, `analyzr-cli`): counts as a human. */
  interactive: boolean;
  /** Granted scopes, before nesting (see `effectiveScopes`). */
  scopes: readonly Scope[];
  /**
   * Credentials bound to one project (agent tokens): the project and the role
   * the credential acts with. `null` for users, whose role comes from their
   * membership.
   */
  binding: { projectId: ProjectId; role: Role } | null;
}

/** Issuer of the local-mode owner principal. */
export const LOCAL_ISSUER = 'urn:analyzr:local';
/** Issuer of agent-token service principals (CONCEPT §2). */
export const AGENT_TOKEN_ISSUER = 'urn:analyzr:agent-token';
/** Issuer of system principals such as the rule tier. */
export const SYSTEM_ISSUER = 'urn:analyzr:system';
/** Subject (and handle) of the rule tier's system principal. */
export const RULES_SUBJECT = 'analyzr-rules';
/** Issuer of the read-only demo's visitor principal (owner decision 20). */
export const DEMO_ISSUER = 'urn:analyzr:demo';
/** Subject (and handle) of the read-only demo's visitor: a viewer of every project. */
export const DEMO_VISITOR_SUBJECT = 'visitor';

/**
 * `source_kind` of an assertion, derived from the credential and never sent
 * by clients (CONCEPT §6): `human` is a user on an interactive client, `agent`
 * everything else. (`rule` is reserved for the system principal.)
 */
export function sourceKindOf(actor: Actor): Exclude<SourceKind, 'rule'> {
  return actor.kind === 'user' && actor.interactive ? 'human' : 'agent';
}
