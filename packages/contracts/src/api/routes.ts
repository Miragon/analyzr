import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import {
  AgentTokenId,
  AnalysisTaskId,
  AutoAcceptRuleId,
  ModelAmendmentId,
  ModelId,
  PlacementId,
  RelationId,
  RevisionId,
} from '../ids.ts';
import { ApiProblem, PROBLEMS, PROBLEM_CONTENT_TYPE, type ProblemCode } from '../problem.ts';
import { ModelKey } from '../refs.ts';
import { AgentTokenList, CreateAgentTokenBody, CreatedAgentToken } from './agent-tokens.ts';
import { MAX_AMENDMENT_ITEMS } from './amendment-core.ts';
import {
  AmendModelBody,
  AmendModelQuery,
  AmendModelResult,
  AmendableElement,
  AmendmentExportQuery,
  AmendmentListQuery,
  ModelAmendmentList,
  WithdrawAmendmentsQuery,
  WithdrawAmendmentsResult,
} from './amendments.ts';
import {
  ApplyAutoAcceptBody,
  ApplyAutoAcceptResult,
  AutoAcceptCriteria,
  AutoAcceptDryRunQuery,
  AutoAcceptLedger,
  AutoAcceptLedgerQuery,
  AutoAcceptPreview,
  AutoAcceptRevocationBody,
  AutoAcceptRevocationResult,
  AutoAcceptRuleDetail,
  AutoAcceptRuleDraft,
  AutoAcceptRuleList,
  SaveAutoAcceptRuleResult,
} from './auto-accept.ts';
import {
  AnalysisQuery,
  AnalysisSubmission,
  AnalysisSubmissionResult,
  AnalysisTaskPage,
  ClaimAnalysisBody,
  ClaimResult,
  PendingAnalyses,
  PendingQuery,
  ReleaseAnalysisBody,
  ReleaseResult,
  RequeueBody,
  RequeueResult,
  SubmitAnalysisBody,
} from './analyses.ts';
import { Me } from './auth.ts';
import { CreateSessionBody, MAX_SESSION_BODY_BYTES, SESSION_COOKIE } from './session.ts';
import { API_PREFIX, PageQuery, ProjectParam } from './common.ts';
import { Health } from './health.ts';
import { Landscape } from './landscape.ts';
import {
  ImportResult,
  Model,
  ModelPage,
  ModelStage,
  PutModelResult,
  RevisionFacts,
  RevisionPage,
} from './models.ts';
import {
  BulkPlacementDecisionBody,
  BulkPlacementDecisionResult,
  Placement,
  PlacementAssertion,
  PlacementAssertionList,
  PlacementDecisionBody,
  PlacementDecisionResult,
  PlacementPage,
  PlacementQuery,
  PostPlacementsBody,
  PostPlacementsResult,
  UnplacedProcessPage,
  ValueChainDetail,
  ValueChainFindingList,
  ValueChainStepDetail,
} from './placements.ts';
import {
  AnswerOpenQuestionBody,
  AnswerOpenQuestionResult,
  AnswerSheetBody,
  AnswerSheetQuery,
  AnswerSheetResult,
  MAX_ANSWER_CHARS,
  MAX_ANSWER_SHEET_BODY_BYTES,
  MAX_ANSWER_SHEET_ROWS,
  OPEN_QUESTION_CSV_COLUMNS,
  OpenQuestionActionBody,
  OpenQuestionActionResult,
  OpenQuestionAnswerParam,
  OpenQuestionExportQuery,
  OpenQuestionPage,
  OpenQuestionParam,
  OpenQuestionQuery,
  WithdrawOpenQuestionAnswerResult,
} from './open-questions.ts';
import { CreateProjectBody, Project, ProjectPage } from './projects.ts';
import {
  FindingList,
  NoLinkList,
  NoLinkQuery,
  Relation,
  RelationAssertion,
  RelationAssertionList,
  RelationPage,
  RelationQuery,
} from './relations.ts';
import {
  BulkDecisionBody,
  BulkDecisionResult,
  DecisionBody,
  DecisionResult,
  NoteBody,
  ProposeRelationBody,
  ProposeRelationResult,
} from './review.ts';
import {
  CreateValueChainBody,
  MAX_VALUE_CHAIN_DEPTH,
  MAX_VALUE_CHAIN_REV,
  SaveValueChainQuery,
  SaveValueChainResult,
  ValueChainDocument,
  ValueChainKey,
  ValueChainList,
  ValueChainRevisionPage,
} from './value-chains.ts';

const JSON_TYPE = 'application/json';

function json<T extends z.ZodType>(schema: T, description: string) {
  return { description, content: { [JSON_TYPE]: { schema } } };
}

/** Problem responses for the given codes (duplicates ignored), grouped by HTTP status. */
function problems(...codes: ProblemCode[]) {
  const out: Record<
    number,
    { description: string; content: Record<string, { schema: typeof ApiProblem }> }
  > = {};
  for (const code of new Set(codes)) {
    const { status } = PROBLEMS[code];
    const prev = out[status];
    out[status] = {
      description: prev ? `${prev.description}, \`${code}\`` : `Problem: \`${code}\``,
      content: { [PROBLEM_CONTENT_TYPE]: { schema: ApiProblem } },
    };
  }
  return out;
}

const projectParams = ProjectParam;
const modelParams = ProjectParam.extend({ model: ModelId });
const revisionParams = modelParams.extend({ revision: RevisionId });
const relationParams = ProjectParam.extend({ relation: RelationId });
const analysisParams = z.object({ analysis: AnalysisTaskId });
const chainParams = ProjectParam.extend({ key: ValueChainKey });
const chainRevisionParams = chainParams.extend({
  rev: z.coerce.number().int().min(1).max(MAX_VALUE_CHAIN_REV),
});
const stepParams = chainParams.extend({ elementId: z.string().min(1).max(128) });
const placementParams = chainParams.extend({ placement: PlacementId });
const projectAnalysisParams = ProjectParam.extend({ analysis: AnalysisTaskId });
const autoAcceptRuleParams = ProjectParam.extend({ rule: AutoAcceptRuleId });
const openQuestionParams = ProjectParam.extend(OpenQuestionParam.shape);
const openQuestionAnswerParams = ProjectParam.extend(OpenQuestionAnswerParam.shape);
const elementParams = modelParams.extend({ elementId: z.string().min(1).max(255) });
const amendmentParams = ProjectParam.extend({ amendment: ModelAmendmentId });

/**
 * Problems of the amendment writes (M6 §4.8 c): agents get
 * `human-decision-required` (with `reviewUrl`), a scope without `analyzr:write`
 * or `analyzr:review` `insufficient-scope`, a viewer `forbidden`.
 */
const AMENDMENT_WRITE_PROBLEMS = [
  'human-decision-required',
  'forbidden',
  'insufficient-scope',
] as const;

function jsonBody<T extends z.ZodType>(schema: T) {
  return { required: true, content: { [JSON_TYPE]: { schema } } };
}

/**
 * Problems of the pipeline routes (`/analyses/…`): the lease rules of
 * CONCEPT §3 (`lease-lost`, `task-cancelled`, `already-submitted`) on top of
 * the read problems.
 */
const LEASE_PROBLEMS = ['lease-lost', 'task-cancelled', 'already-submitted'] as const;

/**
 * Problems of the review routes: agents get `human-decision-required`
 * (with `reviewUrl`), a stale `version` or count gets `conflict`, a stale
 * `If-Match` `precondition-failed`.
 */
const REVIEW_PROBLEMS = [
  'human-decision-required',
  'forbidden',
  'conflict',
  'validation-failed',
] as const;
const BpmnXml = z.string().meta({ id: 'BpmnXml', description: 'BPMN 2.0 XML document (UTF-8).' });

/**
 * Problems of value chain writes (M4): agents get `human-decision-required`
 * with the value chain `reviewUrl`, a document that fails schema-model or the
 * analyzr rules `value-chain-invalid` (with `violations`), a newer schema
 * version `value-chain-unsupported-version`.
 */
const CHAIN_WRITE_PROBLEMS = [
  'human-decision-required',
  'forbidden',
  'value-chain-invalid',
  'value-chain-unsupported-version',
  'payload-too-large',
] as const;

/** ETag of a value chain revision: `"r<rev>"`. */
const REVISION_ETAG = z.object({ ETag: z.string().meta({ description: '`"r<rev>"`' }) });
/** ETag of an auto-accept rule's head revision: `"r<revision>"`. */
const RULE_ETAG = z.object({ ETag: z.string().meta({ description: '`"r<revision>"`' }) });
/**
 * Problems of the auto-accept rule routes (owner decision 19): owners on an
 * interactive client only (`forbidden` for agent tokens and editors). The
 * ledger is for every human reviewer instead (`human-decision-required` for
 * agent tokens, `forbidden` for viewers).
 */
const AUTO_ACCEPT_PROBLEMS = ['forbidden', 'validation-failed'] as const;
/** ETag of a placement version: `"<version>"`, for `If-Match` on decisions. */
const VERSION_ETAG = z.object({ ETag: z.string().meta({ description: '`"<version>"`' }) });

/**
 * Problems of every route below `/projects/{project}`: no or a rejected
 * credential, a token without the scope, an unknown or foreign project or
 * resource, and malformed params or query (422 from the server's validation
 * hook).
 */
const READ_PROBLEMS = [
  'unauthorized',
  'insufficient-scope',
  'not-found',
  'validation-failed',
] as const;

/**
 * Methods a read-only demo (`ANALYZR_DEMO=readonly`, owner decision 20) serves; it answers
 * every other method with 403 `demo-readonly`, except on
 * {@link DEMO_WRITE_EXEMPT_OPERATIONS}.
 */
export const DEMO_SAFE_METHODS = ['get', 'head', 'options'] as const;

/**
 * The only write routes a read-only demo serves: opening and ending the
 * visitor's (viewer) session of the web UI.
 */
export const DEMO_WRITE_EXEMPT_OPERATIONS = ['createSession', 'deleteSession'] as const;

/**
 * Adds 403 `demo-readonly` to every route a read-only demo refuses (method
 * not GET, not a session route), in status order and merged into an existing
 * 403. Done once here, so a new write route can never miss it.
 */
function withDemoReadOnly<T extends Record<string, RouteConfig>>(routes: T): T {
  const exempt: readonly string[] = DEMO_WRITE_EXEMPT_OPERATIONS;
  const safe: readonly string[] = DEMO_SAFE_METHODS;
  const demo = problems('demo-readonly')[PROBLEMS['demo-readonly'].status];
  const out: Record<string, RouteConfig> = {};
  for (const [name, route] of Object.entries(routes)) {
    if (safe.includes(route.method) || exempt.includes(route.operationId ?? name) || !demo) {
      out[name] = route;
      continue;
    }
    const status = String(PROBLEMS['demo-readonly'].status);
    const responses: RouteConfig['responses'] = {};
    let placed = false;
    for (const [code, response] of Object.entries(route.responses)) {
      if (code === status) {
        const previous = response as { description: string };
        responses[code] = {
          ...response,
          description: `${previous.description}, \`demo-readonly\``,
        };
        placed = true;
        continue;
      }
      if (!placed && Number(code) > Number(status)) {
        responses[status] = demo;
        placed = true;
      }
      responses[code] = response;
    }
    if (!placed) responses[status] = demo;
    out[name] = { ...route, responses };
  }
  return out as T;
}

/**
 * Every REST route of the analyzr API (CONCEPT §5), as zod-to-openapi route
 * configs. The server mounts them with `@hono/zod-openapi`'s `createRoute`;
 * `buildOpenApiDocument()` turns them into the OpenAPI 3.1 document the client
 * is generated from. Paths are absolute (`/health`, `/api/v1/...`).
 *
 * `{project}` takes a project id or key. `{key}` in `models/by-key/{key}` is a
 * model key with `/` percent-encoded as `%2F`.
 *
 * Every route whose method is not GET, except the session routes, also
 * documents 403 `demo-readonly` ({@link withDemoReadOnly}): a read-only demo
 * (`ANALYZR_DEMO=readonly`, owner decision 20) refuses it before anything else runs.
 */
export const apiRoutes = withDemoReadOnly({
  getHealth: {
    method: 'get',
    path: '/health',
    operationId: 'getHealth',
    tags: ['system'],
    summary: 'Liveness and database ping',
    security: [],
    responses: { 200: json(Health, 'Server health'), 503: json(Health, 'Database unreachable') },
  },
  createSession: {
    method: 'post',
    path: `${API_PREFIX}/session`,
    operationId: 'createSession',
    tags: ['system'],
    summary: 'Local mode: open an owner session (HttpOnly cookie) for the web UI or the CLI',
    description:
      `Local mode only (\`ANALYZR_AUTH=local\`). Sets the \`${SESSION_COOKIE}\` cookie (HttpOnly, ` +
      'SameSite=Strict); requests carrying it act as the single owner on an interactive client. ' +
      'The server accepts it only from localhost (Host and Origin checks). On a read-only demo ' +
      '(`ANALYZR_DEMO=readonly`, `Health.demo`) the session is a viewer with scope `analyzr:read` ' +
      "instead, accepted from the demo's public origins. A body over " +
      `${MAX_SESSION_BODY_BYTES} bytes answers 413 \`payload-too-large\` before it is read.`,
    security: [],
    request: {
      body: { required: false, content: { [JSON_TYPE]: { schema: CreateSessionBody } } },
    },
    responses: {
      200: {
        ...json(Me, 'The owner'),
        headers: z.object({
          'Set-Cookie': z.string().meta({ description: `\`${SESSION_COOKIE}=…\`` }),
        }),
      },
      ...problems('forbidden', 'payload-too-large', 'unsupported-media-type', 'validation-failed'),
    },
  },
  deleteSession: {
    method: 'delete',
    path: `${API_PREFIX}/session`,
    operationId: 'deleteSession',
    tags: ['system'],
    summary: 'Local mode: end the owner session (clears the cookie)',
    security: [],
    responses: { 204: { description: 'Session cookie cleared' } },
  },
  getMe: {
    method: 'get',
    path: `${API_PREFIX}/me`,
    operationId: 'getMe',
    tags: ['system'],
    summary: 'The authenticated caller',
    responses: { 200: json(Me, 'The caller'), ...problems('unauthorized') },
  },

  listProjects: {
    method: 'get',
    path: `${API_PREFIX}/projects`,
    operationId: 'listProjects',
    tags: ['projects'],
    summary: 'Projects the caller is a member of',
    request: { query: PageQuery },
    responses: {
      200: json(ProjectPage, 'A page of projects'),
      ...problems('unauthorized', 'insufficient-scope', 'validation-failed'),
    },
  },
  createProject: {
    method: 'post',
    path: `${API_PREFIX}/projects`,
    operationId: 'createProject',
    tags: ['projects'],
    summary: 'Create a project; the caller becomes its owner',
    request: { body: { required: true, content: { [JSON_TYPE]: { schema: CreateProjectBody } } } },
    responses: {
      201: json(Project, 'The new project'),
      ...problems('unauthorized', 'forbidden', 'conflict', 'validation-failed'),
    },
  },
  getProject: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}`,
    operationId: 'getProject',
    tags: ['projects'],
    summary: 'One project',
    request: { params: projectParams },
    responses: { 200: json(Project, 'The project'), ...problems(...READ_PROBLEMS) },
  },

  listModels: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/models`,
    operationId: 'listModels',
    tags: ['models'],
    summary: 'Models of a project, optionally filtered by pipeline stage',
    request: { params: projectParams, query: PageQuery.extend({ stage: ModelStage.optional() }) },
    responses: { 200: json(ModelPage, 'A page of models'), ...problems(...READ_PROBLEMS) },
  },
  getModel: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/models/{model}`,
    operationId: 'getModel',
    tags: ['models'],
    summary: 'One model',
    request: { params: modelParams },
    responses: { 200: json(Model, 'The model'), ...problems(...READ_PROBLEMS) },
  },
  deleteModel: {
    method: 'delete',
    path: `${API_PREFIX}/projects/{project}/models/{model}`,
    operationId: 'deleteModel',
    tags: ['models'],
    summary: 'Delete a model; partner relations become `missing`',
    request: { params: modelParams },
    responses: { 204: { description: 'Deleted' }, ...problems(...READ_PROBLEMS, 'forbidden') },
  },
  putModelByKey: {
    method: 'put',
    path: `${API_PREFIX}/projects/{project}/models/by-key/{key}`,
    operationId: 'putModelByKey',
    tags: ['models'],
    summary: 'Upload raw BPMN: 201 new model, 200 new revision or unchanged',
    request: {
      params: projectParams.extend({ key: ModelKey }),
      body: {
        required: true,
        content: { 'application/xml': { schema: BpmnXml }, 'text/xml': { schema: BpmnXml } },
      },
    },
    responses: {
      200: json(PutModelResult, 'New revision, or `unchanged` for identical content'),
      201: json(PutModelResult, 'New model'),
      ...problems(
        ...READ_PROBLEMS,
        'forbidden',
        'payload-too-large',
        'unsupported-media-type',
        'bpmn-invalid',
        'validation-failed',
      ),
    },
  },
  listRevisions: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/models/{model}/revisions`,
    operationId: 'listRevisions',
    tags: ['models'],
    summary: 'Revisions of a model, newest first',
    request: { params: modelParams, query: PageQuery },
    responses: { 200: json(RevisionPage, 'A page of revisions'), ...problems(...READ_PROBLEMS) },
  },
  getRevisionContent: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/models/{model}/revisions/{revision}/content`,
    operationId: 'getRevisionContent',
    tags: ['models'],
    summary: 'The verbatim BPMN bytes of a revision',
    request: { params: revisionParams },
    responses: {
      200: { description: 'BPMN XML', content: { 'application/xml': { schema: BpmnXml } } },
      ...problems(...READ_PROBLEMS),
    },
  },
  getRevisionFacts: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/models/{model}/revisions/{revision}/facts`,
    operationId: 'getRevisionFacts',
    tags: ['models'],
    summary: 'Facts extracted from a revision',
    request: { params: revisionParams },
    responses: { 200: json(RevisionFacts, 'Facts'), ...problems(...READ_PROBLEMS) },
  },
  importModels: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/imports`,
    operationId: 'importModels',
    tags: ['models'],
    summary: 'Import up to 50 BPMN files; the model key is the slugified path',
    request: {
      params: projectParams,
      body: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: z
              .object({
                files: z
                  .array(z.string().meta({ format: 'binary' }))
                  .min(1)
                  .meta({
                    description:
                      'BPMN files; each part’s filename is its path below the import root.',
                  }),
              })
              .meta({ id: 'ImportModelsBody' }),
          },
        },
      },
    },
    responses: {
      200: json(ImportResult, 'Outcome per file'),
      ...problems(
        ...READ_PROBLEMS,
        'forbidden',
        'payload-too-large',
        'unsupported-media-type',
        'validation-failed',
      ),
    },
  },

  getAmendable: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/models/{model}/elements/{elementId}/amendable`,
    operationId: 'getAmendable',
    tags: ['amendments'],
    summary: 'The fields of an element a model amendment can set (ETag `"r<headRev>"`)',
    description:
      'M6 §4.8 c: per field the element allows (call target, message or signal name, start or ' +
      'end name, process documentation), the value on the head and on the uploaded revision, ' +
      'whether it can be set and why not (`only-open-questions`: no open question names it, it ' +
      'is neither empty nor unresolved and no live amendment set it; `expression`, ' +
      '`cmmn-call`, …), its live amendment, the elements reading a message name and the ' +
      "suggestions (processes, names with their endpoints, labels), plus the element's " +
      'amendment history. An endpoint that references a message or signal yields the field of ' +
      'that message or signal (every endpoint referencing it changes with it); a pool resolves ' +
      'to its process. `ETag: "r<headRev>"` is what the save sends as `If-Match`. A deleted ' +
      'model, or an element the head has no fact and no amendable field for, is 404 `not-found`.',
    request: { params: elementParams },
    responses: {
      200: {
        ...json(AmendableElement, 'The amendable fields'),
        headers: z.object({ ETag: z.string().meta({ description: '`"r<headRev>"`' }) }),
      },
      ...problems(...READ_PROBLEMS),
    },
  },
  amendModel: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/models/{model}/amendments`,
    operationId: 'amendModel',
    tags: ['amendments'],
    summary:
      'Amend fields of a model: a new amended head (`If-Match: "r<headRev>"`; `?dryRun=true` first)',
    description:
      `Records up to ${MAX_AMENDMENT_ITEMS} amendments of one model (M6 §4.8 c) in one transaction ` +
      'under the project lock: the uploaded revision stays as it came, and analyzr writes an ' +
      'amended revision computed from its bytes by byte-preserving splices (never a ' +
      'bpmn-moddle round trip), checked by extracting it again; it becomes the head, with ' +
      '`source.kind: amendment`, its `upstream` and the plan of every live amendment. A new ' +
      'amendment of an element and op supersedes the live one. Events: `model.amended` (ids, ' +
      "elements and ops, no values), then the amended revision's `model.revised`. The new head " +
      'sets off what any change from the tool does (rules, endpoint states, the relations task, ' +
      'the placement input); a manual link from the call to the target it now calls, and one to ' +
      'a `partner` whose key-tier proposal the amendment accepts, is retired by a human ' +
      'rejection. Each item is `recorded`, `unchanged` (identical to its live amendment) or ' +
      '`not-applicable` with the reason; a request with a `not-applicable` item writes nothing ' +
      "(422 `validation-failed`, `reason: 'amendment-not-applicable'`, the items in `items`). " +
      'The answer carries the effect at the element and the cost (pairs to re-judge, a claimed ' +
      'relations task); `dryRun=true` computes the same and writes nothing. `If-Match: ' +
      '"r<headRev>"` is required (428 `precondition-required`) and checked under the lock (412 ' +
      '`revision-conflict` with `headRev`). Humans only and both permissions `review` and ' +
      '`write`: agent tokens get 403 `human-decision-required` with `reviewUrl`, a scope ' +
      'without both 403 `insufficient-scope`. A deleted model is 404 `not-found`.',
    request: {
      params: modelParams,
      query: AmendModelQuery,
      headers: z.object({ 'if-match': z.string().max(200).optional() }),
      body: jsonBody(AmendModelBody),
    },
    responses: {
      200: json(AmendModelResult, 'A dry run, or `unchanged`'),
      201: json(AmendModelResult, 'The amendments were recorded'),
      ...problems(
        ...READ_PROBLEMS,
        ...AMENDMENT_WRITE_PROBLEMS,
        'conflict',
        'revision-conflict',
        'precondition-required',
      ),
    },
  },
  withdrawModelAmendments: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/models/{model}/amendments/withdrawal`,
    operationId: 'withdrawModelAmendments',
    tags: ['amendments'],
    summary: 'Withdraw every live amendment of a model in one step (humans only)',
    description:
      '„Alle Ergänzungen dieses Modells zurücknehmen“ (M6 §4.8 c): one withdrawal row per live ' +
      'amendment (reason `withdrawn`, a `model.amendment_withdrawn` event each) and one ' +
      're-derivation from the uploaded revision, a new revision whose bytes equal the uploaded ' +
      "revision's. A deleted model keeps its amendments live until withdrawn; a withdrawal " +
      'there records its rows only and writes no revision. Nothing live answers 200 ' +
      '`unchanged`. `If-Match: "r<headRev>"` (optional) names the head the human saw and is ' +
      'checked under the project lock (412 `revision-conflict` with `headRev`), so an amendment ' +
      'recorded meanwhile is not withdrawn unseen. `dryRun=true` answers what would be ' +
      'withdrawn and the `cost` of the new head (pairs to re-judge, a claimed relations task) ' +
      'and writes nothing. Permissions `review` and `write`, humans only.',
    request: {
      params: modelParams,
      query: WithdrawAmendmentsQuery,
      headers: z.object({ 'if-match': z.string().max(200).optional() }),
    },
    responses: {
      200: json(WithdrawAmendmentsResult, 'A dry run, or nothing was live (`unchanged`)'),
      201: json(WithdrawAmendmentsResult, 'The amendments were withdrawn'),
      ...problems(...READ_PROBLEMS, ...AMENDMENT_WRITE_PROBLEMS, 'revision-conflict'),
    },
  },
  listAmendments: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/amendments`,
    operationId: 'listAmendments',
    tags: ['amendments'],
    summary: 'The model amendments of a project, oldest first, filtered by model and state',
    description:
      "Every amendment with its state: a live one's outcome on its model's head (`applied`, " +
      '`in-source`, `conflict` with its reason) or how it ended (`withdrawn`, `superseded`); ' +
      '`modelDeleted` marks those of a deleted model. `modelKey` matches a model or a folder.',
    request: { params: projectParams, query: AmendmentListQuery },
    responses: {
      200: json(ModelAmendmentList, 'The amendments'),
      ...problems(...READ_PROBLEMS),
    },
  },
  exportAmendments: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/amendments/export`,
    operationId: 'exportAmendments',
    tags: ['amendments'],
    summary: 'The change list for the source tool, as Markdown or CSV (`since=<seq>`)',
    description:
      'The amendments matching the filters, grouped per model (name and key), each with the ' +
      "pool or process and lane, the element's German type and name, the field, before → " +
      'after, who, when and the state; a call target names its process and model, marked ' +
      '„Ziel nicht mehr in der Landschaft“ when no head process has that id; a shared message ' +
      'lists every element referencing it. Every export names the seq it reflects („Stand: ' +
      'Ereignis …“), and `since` lists only what was recorded or ended after it. analyzr writes ' +
      'nothing back to the source tool (decision 7). CSV: UTF-8 with a byte order mark, ' +
      '`;`-separated, CRLF, every field quoted, formula-like cells escaped.',
    request: { params: projectParams, query: AmendmentExportQuery },
    responses: {
      200: {
        description: 'The change list',
        headers: z.object({
          'Content-Disposition': z.string().meta({
            description:
              '`attachment; filename="ergaenzungen-<project key>.md"` (or `.csv`); with filters, ' +
              'their values as an ASCII slug before the extension',
          }),
        }),
        content: {
          'text/markdown': { schema: z.string() },
          'text/csv': { schema: z.string() },
        },
      },
      ...problems(...READ_PROBLEMS),
    },
  },
  withdrawAmendment: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/amendments/{amendment}/withdrawal`,
    operationId: 'withdrawAmendment',
    tags: ['amendments'],
    summary: 'Withdraw one amendment („Ergänzung zurücknehmen“; humans only)',
    description:
      'Records the withdrawal (reason `withdrawn`, a `model.amendment_withdrawn` event naming ' +
      'the id and op) and re-derives the head from the uploaded revision with the remaining ' +
      'live amendments: a new revision, with none left one whose bytes equal the uploaded ' +
      "revision's. On a deleted model only the row is recorded, no revision. An amendment that " +
      'ended before answers 200 `unchanged`. `If-Match: "r<headRev>"` (optional) names the ' +
      "head of the amendment's model the human saw and is checked under the project lock (412 " +
      '`revision-conflict` with `headRev`). `dryRun=true` answers the `cost` of the new head ' +
      '(pairs to re-judge, a claimed relations task) and writes nothing. Permissions `review` ' +
      'and `write`, humans only.',
    request: {
      params: amendmentParams,
      query: WithdrawAmendmentsQuery,
      headers: z.object({ 'if-match': z.string().max(200).optional() }),
    },
    responses: {
      200: json(
        WithdrawAmendmentsResult,
        'A dry run, or the amendment had ended before (`unchanged`)',
      ),
      201: json(WithdrawAmendmentsResult, 'The amendment was withdrawn'),
      ...problems(...READ_PROBLEMS, ...AMENDMENT_WRITE_PROBLEMS, 'revision-conflict'),
    },
  },

  getLandscape: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/landscape`,
    operationId: 'getLandscape',
    tags: ['relations'],
    summary: 'The project head: models, processes, relations, findings (ETag `"s<seq>"`)',
    request: { params: projectParams },
    responses: {
      200: {
        ...json(Landscape, 'The landscape'),
        headers: z.object({ ETag: z.string().meta({ description: '`"s<seq>"`' }) }),
      },
      304: { description: 'Not modified (`If-None-Match` matched)' },
      ...problems(...READ_PROBLEMS),
    },
  },
  listRelations: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/relations`,
    operationId: 'listRelations',
    tags: ['relations'],
    summary: 'Relations, filtered by type, status, tier or model',
    request: { params: projectParams, query: RelationQuery },
    responses: { 200: json(RelationPage, 'A page of relations'), ...problems(...READ_PROBLEMS) },
  },
  getRelation: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/relations/{relation}`,
    operationId: 'getRelation',
    tags: ['relations'],
    summary: 'One relation',
    request: { params: relationParams },
    responses: { 200: json(Relation, 'The relation'), ...problems(...READ_PROBLEMS) },
  },
  listFindings: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/findings`,
    operationId: 'listFindings',
    tags: ['relations'],
    summary: 'Deterministic findings of the project head',
    request: { params: projectParams },
    responses: { 200: json(FindingList, 'Findings'), ...problems(...READ_PROBLEMS) },
  },
  listNoLinks: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/no-links`,
    operationId: 'listNoLinks',
    tags: ['relations'],
    summary:
      "Agents' live, current no-links (pairs judged unrelated), also on pairs without a relation",
    description:
      'Every live no-link whose basis is still current (both models unchanged, the procedure ' +
      'claims name now), oldest first; `modelKey` keeps those with an endpoint in that model. ' +
      'A no-link on a pair that also has a relation shows there too (`Relation.noLinks`).',
    request: { params: projectParams, query: NoLinkQuery },
    responses: { 200: json(NoLinkList, 'No-links'), ...problems(...READ_PROBLEMS) },
  },

  listOpenQuestions: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/open-questions`,
    operationId: 'listOpenQuestions',
    tags: ['open-questions'],
    summary:
      'Open questions: the gaps that block links and placements, from every source and the gap signals',
    description:
      'Computed on read, never stored (M6 §4.2): relation and value chain findings, holds (note, ' +
      "question, label), agents' questions on proposals waiting for review, current unsure " +
      'placement verdicts, no-links coded `call-target` or `collaboration`, the summaries of ' +
      'current submissions and the pairs they left unjudged, and the gap signals over the head ' +
      'facts. Questions first, then the value chain findings (`process-without-step`, ' +
      '`step-without-process`, `unresolved-link`), then informational items (`summary-note`, ' +
      '`descriptive-model`), each group ordered by `unlocks` (descending), then subject, kind ' +
      'and id. `modelKey` matches a model ' +
      'or a folder (`finanzen` matches `finanzen/mahnwesen`); `askWho` matches a lane, one of the ' +
      'step owners or the folder exactly. Each item carries its `actions` (M6 §4.8 a: at most ' +
      'one primary, German labels from code) and its `answers` (notes and outside marks); it is ' +
      '`answered` while a live outside mark names its id (M6 S5c-1), and `state` filters by it. ' +
      "An item whose call, coded end or pool flows a human, an owner's rule or the rule tier " +
      'linked by an accepted relation to another process leaves the list (R1), and so does a ' +
      'duplicated process id while no call towards its copies waits for a decision (R1b); ' +
      '`listFindings` keeps listing their findings.',
    request: { params: projectParams, query: OpenQuestionQuery },
    responses: {
      200: json(OpenQuestionPage, 'A page of open questions'),
      ...problems(...READ_PROBLEMS),
    },
  },
  exportOpenQuestions: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/open-questions/export`,
    operationId: 'exportOpenQuestions',
    tags: ['open-questions'],
    summary: 'The open questions as a Markdown or CSV download, with the filters of the list',
    description:
      'Every open question matching the filters, in list order, as an attachment. `markdown` ' +
      '(default): German headings, grouped by the contact hint (step owners, else folder, else ' +
      'lanes). `csv`: the questions without the informational items (`summary-note`, ' +
      '`descriptive-model`, which ask nothing), UTF-8 with a byte order mark, `;`-separated (what ' +
      'German spreadsheet programs open directly), CRLF, every field quoted, the columns ' +
      `${OPEN_QUESTION_CSV_COLUMNS.map((c) => `\`${c}\``).join(', ')}; \`Antwort\` is empty for ` +
      "the customer to fill in, or holds the item's latest note (M6 S5c-1; read back, it is " +
      '`unchanged`); the Markdown lists every note and outside mark. A cell starting with `=`, ' +
      '`+`, `-`, `@`, a tab, a carriage return ' +
      "or their full-width forms (also after a run of `'`) gets a leading `'`, so spreadsheets " +
      'never run it as a formula. The file name carries the filters (`offene-fragen-<project ' +
      'key>-<filters>.csv`).',
    request: { params: projectParams, query: OpenQuestionExportQuery },
    responses: {
      200: {
        description: 'The export',
        headers: z.object({
          'Content-Disposition': z.string().meta({
            description:
              '`attachment; filename="offene-fragen-<project key>.md"` (or `.csv`); with filters, ' +
              'their values as an ASCII slug before the extension, e.g. ' +
              '`offene-fragen-p-finanzen-black-box-partner.csv`',
          }),
        }),
        content: {
          'text/markdown': { schema: z.string() },
          'text/csv': { schema: z.string() },
        },
      },
      ...problems(...READ_PROBLEMS),
    },
  },

  answerOpenQuestion: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/open-questions/{question}/answers`,
    operationId: 'answerOpenQuestion',
    tags: ['open-questions'],
    summary: 'Add a note to an open question (humans only)',
    description:
      'Records the note („Notiz hinzufügen“, M6 §4.8 b) in the append-only ' +
      '`open_question_answer`; a note informs and leaves the item `open` (only an outside mark ' +
      "makes it `answered`, `actOnOpenQuestion`). The body is `{text}` only: S5a's `kind` is " +
      'gone and gets 422. Where the text lands: on a relation (held, ' +
      "or proposed with an agent's question) a human note through the note use case, so the " +
      'next claim of either model shows it (a hold stays until a human decides it); on a ' +
      "placement a human note through the placement note use case (on an agent's question the " +
      'process becomes due, nothing is queued; a held placement keeps homing its process, so ' +
      'it is not due until a human decides the hold); anything else stays with the answer ' +
      '(shown and exported, it reaches no agent before M6 S7). A note identical to the ' +
      "id's latest note answers " +
      '200 `unchanged` and writes nothing. The text is compared and stored with LF line breaks ' +
      `and in Unicode NFC, trimmed; it has at most ${MAX_ANSWER_CHARS} characters; a ` +
      'deterministic check for e-mail ' +
      'addresses, phone numbers and IBANs returns `warnings` and never blocks. Owner or editor ' +
      'on an interactive client: agent tokens get 403 `human-decision-required` with ' +
      '`reviewUrl`. An id that names no current open question (its source changed, which ' +
      'changes the id) is 404 `not-found`.',
    request: { params: openQuestionParams, body: jsonBody(AnswerOpenQuestionBody) },
    responses: {
      200: json(AnswerOpenQuestionResult, 'An identical note was recorded earlier'),
      201: json(AnswerOpenQuestionResult, 'The note was recorded'),
      ...problems(...READ_PROBLEMS, 'human-decision-required', 'forbidden'),
    },
  },
  answerOpenQuestions: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/open-questions/answers`,
    operationId: 'answerOpenQuestions',
    tags: ['open-questions'],
    summary: 'Record the answers of a filled-in sheet (`?dryRun=true` first; humans only)',
    description:
      'The rows of the CSV the export wrote (`id`, `Antwort`; `readAnswerSheet` in ' +
      '`@analyzr/contracts/open-question-csv` reads them), each filled `Antwort` recorded as a ' +
      'note as by `answerOpenQuestion`, all in one transaction. A sheet exported before M6 ' +
      'S5c-1 still reads: its `Antwortart` „Liegt außerhalb der Landschaft“ ' +
      '(`outside-landscape`) records an outside mark with the text as its note, except on a ' +
      'relation or placement item (a note); „Antwort“, „Wird im Modell ergänzt“ and an empty ' +
      'cell record a note. Rows with an empty answer are ' +
      'ignored (counted only); an id that names no current open question (also one whose ' +
      'source changed since the export) is listed `unknown` and never stored; a row with a ' +
      `text over ${MAX_ANSWER_CHARS} characters, control characters, an unknown ` +
      '`Antwortart` or an id an earlier row answers is listed `invalid` and never stored; a ' +
      "note identical to the item's latest note, or a mark on an item a live mark marks, is " +
      '`unchanged`. `row` is the position in `rows`. ' +
      '`dryRun=true` lists the same and ' +
      `stores nothing. At most ${MAX_ANSWER_SHEET_ROWS} rows and ` +
      `${MAX_ANSWER_SHEET_BODY_BYTES} bytes per call (413 \`payload-too-large\` above).`,
    request: {
      params: projectParams,
      query: AnswerSheetQuery,
      body: jsonBody(AnswerSheetBody),
    },
    responses: {
      200: json(AnswerSheetResult, 'What the sheet stored or would store'),
      ...problems(...READ_PROBLEMS, 'human-decision-required', 'forbidden', 'payload-too-large'),
    },
  },
  actOnOpenQuestion: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/open-questions/{question}/actions`,
    operationId: 'actOnOpenQuestion',
    tags: ['open-questions'],
    summary: 'Act on an open question: link, place, choose the valid copy, mark outside (humans)',
    description:
      "Runs one of the item's `actions` (M6 §4.8 a) in one transaction under the project " +
      'lock, through the use cases that exist. `link`: per target a live typed relation ' +
      'between the anchor and the target (proposed or held: a rule-tier or key-tier proposal, ' +
      "an agent's) is accepted as the human's decision, else an accepted `manual` relation is " +
      "written (a pool's flows: one per anchor, directed like its flow); the rationale is " +
      'German and from code („Aus „Offene Fragen“: …“) plus the note. `place`: a manual ' +
      'placement, accepted at once. `choose-copy`: the calls towards the copies are accepted ' +
      'towards the valid copy and rejected towards the others, all or nothing with their ' +
      'versions (409 `conflict` otherwise); with `placeOthersOutside` the other copies without ' +
      'a home step go to `@outside`; the note is a note on the item. `outside`: an outside mark ' +
      '(an `open_question_answer` of kind `outside-landscape`, its text the note or null); ' +
      'while a live mark exists, 200 `unchanged`. The answer names the relations and ' +
      'placements written (`manual`: „Rückgängig“ rejects them through the decision routes) or ' +
      'decided, and the item as the list now shows it (`null` when the action took it off). ' +
      'An id that names no current item is 404 `not-found`; an action the item does not offer ' +
      "is 422 `validation-failed` with `reason: 'action-not-offered'`. Owner or editor on an " +
      'interactive client: agent tokens get 403 `human-decision-required` with `reviewUrl`.',
    request: { params: openQuestionParams, body: jsonBody(OpenQuestionActionBody) },
    responses: {
      200: json(OpenQuestionActionResult, 'Nothing to write (`unchanged`)'),
      201: json(OpenQuestionActionResult, 'The action was applied'),
      ...problems(...READ_PROBLEMS, 'human-decision-required', 'forbidden', 'conflict'),
    },
  },
  withdrawOpenQuestionAnswer: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/open-questions/{question}/answers/{answer}/withdrawal`,
    operationId: 'withdrawOpenQuestionAnswer',
    tags: ['open-questions'],
    summary: 'Withdraw an outside mark („Rückgängig“; humans only)',
    description:
      'Ends an outside mark of the item (M6 §4.8 b) with a row in the append-only ' +
      '`open_question_answer_withdrawal` and an `open_question.answer_withdrawn` event; the ' +
      'mark no longer counts, so the item is `open` again unless another live mark names it, ' +
      'and marking again records a new mark. A mark withdrawn before answers 200 `unchanged`. ' +
      'Only outside marks are withdrawn (a note is 422 `validation-failed` with `reason: ' +
      "'not-an-outside-mark'`); an id that names no current item, or an answer of another item, " +
      'is 404 `not-found`. Owner or editor on an interactive client: agent tokens get 403 ' +
      '`human-decision-required` with `reviewUrl`.',
    request: { params: openQuestionAnswerParams },
    responses: {
      200: json(WithdrawOpenQuestionAnswerResult, 'The mark was withdrawn before'),
      201: json(WithdrawOpenQuestionAnswerResult, 'The mark was withdrawn'),
      ...problems(...READ_PROBLEMS, 'human-decision-required', 'forbidden'),
    },
  },

  getRelationAssertions: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/relations/{relation}/assertions`,
    operationId: 'getRelationAssertions',
    tags: ['relations'],
    summary: 'The history (timeline) of a relation: every assertion, oldest first',
    request: { params: relationParams },
    responses: {
      200: json(RelationAssertionList, 'The assertions'),
      ...problems(...READ_PROBLEMS),
    },
  },
  proposeRelation: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/relations`,
    operationId: 'proposeRelation',
    tags: ['review'],
    summary:
      'Propose a relation ad hoc (analyzr:propose), or add an accepted manual relation (humans)',
    description:
      'Agents and humans propose `call`, `message`, `signal` and `trigger` relations; the server ' +
      'computes the tier. An invalid proposal (unknown ref, wrong endpoint kinds, same process) is ' +
      '422 with `reason`. `manual` relations are for humans only and are accepted at once.',
    request: { params: projectParams, body: jsonBody(ProposeRelationBody) },
    responses: {
      200: json(ProposeRelationResult, 'The outcome and the relation'),
      ...problems(...READ_PROBLEMS, 'human-decision-required', 'forbidden'),
    },
  },
  withdrawProposal: {
    method: 'delete',
    path: `${API_PREFIX}/projects/{project}/relations/{relation}/proposal`,
    operationId: 'withdrawProposal',
    tags: ['review'],
    summary: "Withdraw the caller's own live proposal of a relation",
    request: { params: relationParams },
    responses: {
      200: json(Relation, 'The relation after the withdrawal'),
      ...problems(...READ_PROBLEMS, 'forbidden', 'conflict'),
    },
  },
  decideRelation: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/relations/{relation}/decision`,
    operationId: 'decideRelation',
    tags: ['review'],
    summary: 'Decide a relation: accept, reject, hold or correct (humans only)',
    description:
      'Owner on an interactive client (local mode: the web UI or the CLI). Agent tokens get 403 ' +
      '`human-decision-required` with `reviewUrl`. `If-Match: "<version>"` (or `version` in the ' +
      'body) makes the decision conditional: 412 `precondition-failed` (409 `conflict` for the ' +
      'body field) if the relation changed.',
    request: {
      params: relationParams,
      headers: z.object({ 'if-match': z.string().max(100).optional() }),
      body: jsonBody(DecisionBody),
    },
    responses: {
      200: json(DecisionResult, 'The decided relation'),
      ...problems(...READ_PROBLEMS, ...REVIEW_PROBLEMS, 'precondition-failed'),
    },
  },
  decideRelations: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/decisions`,
    operationId: 'decideRelations',
    tags: ['review'],
    summary: 'Bulk decision with ids, versions and expectedCount (all or nothing)',
    request: { params: projectParams, body: jsonBody(BulkDecisionBody) },
    responses: {
      200: json(BulkDecisionResult, 'The decided relations'),
      ...problems(...READ_PROBLEMS, ...REVIEW_PROBLEMS),
    },
  },
  addRelationNote: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/relations/{relation}/notes`,
    operationId: 'addRelationNote',
    tags: ['review'],
    summary: 'Add a note to a relation, e.g. the answer to a held question (humans only)',
    request: { params: relationParams, body: jsonBody(NoteBody) },
    responses: {
      201: json(RelationAssertion, 'The note'),
      ...problems(...READ_PROBLEMS, ...REVIEW_PROBLEMS),
    },
  },

  listValueChains: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/value-chains`,
    operationId: 'listValueChains',
    tags: ['value-chains'],
    summary: 'The value chains of a project (M4: at most one, key `main`)',
    request: { params: projectParams },
    responses: { 200: json(ValueChainList, 'Value chains'), ...problems(...READ_PROBLEMS) },
  },
  createValueChain: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/value-chains`,
    operationId: 'createValueChain',
    tags: ['value-chains'],
    summary: 'Create the value chain from a name or a document (humans only)',
    description:
      'Creates the chain `main` (the only key in M4) with its first revision: an empty document ' +
      'named `name`, or `content`, validated with schema-model and the analyzr rules. A deleted ' +
      'chain is revived (same id, `rev` continues, outcome `revived`). 409 `conflict` if a live ' +
      'chain has the key.',
    request: { params: projectParams, body: jsonBody(CreateValueChainBody) },
    responses: {
      201: { ...json(SaveValueChainResult, 'The new chain'), headers: REVISION_ETAG },
      ...problems(...READ_PROBLEMS, ...CHAIN_WRITE_PROBLEMS, 'conflict'),
    },
  },
  getValueChain: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}`,
    operationId: 'getValueChain',
    tags: ['value-chains'],
    summary: 'The value chain: head structure (steps with kinds, ranks, owners), placements',
    request: { params: chainParams },
    responses: {
      200: json(ValueChainDetail, 'The chain with steps and placements'),
      ...problems(...READ_PROBLEMS),
    },
  },
  deleteValueChain: {
    method: 'delete',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}`,
    operationId: 'deleteValueChain',
    tags: ['value-chains'],
    summary: 'Delete the value chain; its placements turn `missing` (humans only)',
    request: { params: chainParams },
    responses: {
      204: { description: 'Deleted' },
      ...problems(...READ_PROBLEMS, 'human-decision-required', 'forbidden'),
    },
  },
  getValueChainContent: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/content`,
    operationId: 'getValueChainContent',
    tags: ['value-chains'],
    summary: 'The head document: canonical `.vc.json` bytes (ETag `"r<rev>"`)',
    request: {
      params: chainParams,
      headers: z.object({ 'if-none-match': z.string().max(200).optional() }),
    },
    responses: {
      200: { ...json(ValueChainDocument, 'The canonical document'), headers: REVISION_ETAG },
      304: { description: 'Not modified (`If-None-Match` names the head revision)' },
      ...problems(...READ_PROBLEMS),
    },
  },
  putValueChainContent: {
    method: 'put',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/content`,
    operationId: 'putValueChainContent',
    tags: ['value-chains'],
    summary:
      'Save a revision: `If-Match: "r<rev>"` required; `?dryRun=true` returns the impact only',
    description:
      'Saves the document as the next revision (humans only). `If-Match: "r<rev>"` must name the ' +
      'head revision: without it 428 `precondition-required`, a stale one 412 ' +
      '`revision-conflict` with `headRev`; content equal to the head answers 200 `unchanged` ' +
      'whatever the `If-Match`. `If-None-Match: *` creates (or revives) the chain instead: 201, ' +
      'or 412 `revision-conflict` if it exists. `dryRun=true` checks the same and returns the ' +
      'impact (removed and changed steps with their placements) without writing anything. The ' +
      'body is the `.vc.json` document as `application/json`, at most 2 MiB; its canonical ' +
      'form may have at most 1 MiB (`document-too-large`).',
    request: {
      params: chainParams,
      query: SaveValueChainQuery,
      headers: z.object({
        'if-match': z.string().max(200).optional(),
        'if-none-match': z.string().max(200).optional(),
      }),
      body: jsonBody(ValueChainDocument),
    },
    responses: {
      200: {
        ...json(SaveValueChainResult, '`revised`, `unchanged`, or a dry run'),
        headers: REVISION_ETAG,
      },
      201: {
        ...json(SaveValueChainResult, '`created` or `revived` (`If-None-Match: *`)'),
        headers: REVISION_ETAG,
      },
      ...problems(
        ...READ_PROBLEMS,
        ...CHAIN_WRITE_PROBLEMS,
        'revision-conflict',
        'precondition-required',
        'unsupported-media-type',
      ),
    },
  },
  listValueChainRevisions: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/revisions`,
    operationId: 'listValueChainRevisions',
    tags: ['value-chains'],
    summary: 'Revisions of the value chain, newest first',
    request: { params: chainParams, query: PageQuery },
    responses: {
      200: json(ValueChainRevisionPage, 'A page of revisions'),
      ...problems(...READ_PROBLEMS),
    },
  },
  getValueChainRevisionContent: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/revisions/{rev}/content`,
    operationId: 'getValueChainRevisionContent',
    tags: ['value-chains'],
    summary: 'The canonical document of one revision (ETag `"r<rev>"`)',
    request: { params: chainRevisionParams },
    responses: {
      200: { ...json(ValueChainDocument, 'The canonical document'), headers: REVISION_ETAG },
      ...problems(...READ_PROBLEMS),
    },
  },
  getValueChainStep: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/steps/{elementId}`,
    operationId: 'getValueChainStep',
    tags: ['value-chains'],
    summary: `The drill-down of a step: breadcrumb, sub-steps (up to level ${MAX_VALUE_CHAIN_DEPTH}), processes`,
    request: { params: stepParams },
    responses: {
      200: json(ValueChainStepDetail, 'The step'),
      ...problems(...READ_PROBLEMS),
    },
  },
  getValueChainFindings: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/findings`,
    operationId: 'getValueChainFindings',
    tags: ['value-chains'],
    summary:
      'Findings of the value chain: processes without a step, steps without a process, unresolved links',
    description:
      'Deterministic, recomputed on read, never blocking (M4 §3.4): `process-without-step` for a ' +
      'head process without an accepted placement on a live step (`@outside` counts), with ' +
      '`state` (pending or held) and the steps of accepted callers; `step-without-process` at ' +
      'the topmost step without an accepted placement on it or below it; `unresolved-link` for ' +
      'a link that is neither `analyzr:process/<ref>` of a head process nor an http(s) URL.',
    request: { params: chainParams },
    responses: {
      200: json(ValueChainFindingList, 'The findings'),
      ...problems(...READ_PROBLEMS),
    },
  },
  listUnplacedProcesses: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/unplaced-processes`,
    operationId: 'listUnplacedProcesses',
    tags: ['value-chains'],
    summary: 'Processes without a home step and without a placement waiting for review, with hints',
    request: { params: chainParams, query: PageQuery },
    responses: {
      200: json(UnplacedProcessPage, 'A page of unplaced processes'),
      ...problems(...READ_PROBLEMS),
    },
  },
  listPlacements: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/placements`,
    operationId: 'listPlacements',
    tags: ['value-chains'],
    summary: 'Placements, filtered by step, process, model, status, tier or endpoint state',
    request: { params: chainParams, query: PlacementQuery },
    responses: { 200: json(PlacementPage, 'A page of placements'), ...problems(...READ_PROBLEMS) },
  },
  postPlacements: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/placements`,
    operationId: 'postPlacements',
    tags: ['value-chains'],
    summary: 'Propose placements ad hoc (analyzr:propose), or add an accepted manual one (humans)',
    description:
      '`kind: "propose"`: up to 200 items, each answered `applied`, `duplicate`, `suppressed`, ' +
      '`reopened` or `invalid:<reason>`; the server computes the tier. `kind: "manual"`: a human ' +
      'accepts a process on a step at once (agents get `human-decision-required`).',
    request: { params: chainParams, body: jsonBody(PostPlacementsBody) },
    responses: {
      200: json(PostPlacementsResult, 'The outcome'),
      ...problems(...READ_PROBLEMS, 'human-decision-required', 'forbidden'),
    },
  },
  decidePlacements: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/placements/decisions`,
    operationId: 'decidePlacements',
    tags: ['value-chains'],
    summary: 'Bulk decision on placements with ids, versions and expectedCount (all or nothing)',
    request: { params: chainParams, body: jsonBody(BulkPlacementDecisionBody) },
    responses: {
      200: json(BulkPlacementDecisionResult, 'The decided placements'),
      ...problems(...READ_PROBLEMS, ...REVIEW_PROBLEMS),
    },
  },
  getPlacement: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/placements/{placement}`,
    operationId: 'getPlacement',
    tags: ['value-chains'],
    summary: 'One placement (ETag `"<version>"`)',
    request: { params: placementParams },
    responses: {
      200: { ...json(Placement, 'The placement'), headers: VERSION_ETAG },
      ...problems(...READ_PROBLEMS),
    },
  },
  withdrawPlacementProposal: {
    method: 'delete',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/placements/{placement}/proposal`,
    operationId: 'withdrawPlacementProposal',
    tags: ['value-chains'],
    summary: "Withdraw the caller's own live proposal of a placement",
    request: { params: placementParams },
    responses: {
      200: json(Placement, 'The placement after the withdrawal'),
      ...problems(...READ_PROBLEMS, 'forbidden', 'conflict'),
    },
  },
  decidePlacement: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/placements/{placement}/decision`,
    operationId: 'decidePlacement',
    tags: ['value-chains'],
    summary: 'Decide a placement: accept, reject, hold or correct (humans only)',
    description:
      'Agents get 403 `human-decision-required` with `reviewUrl`. `If-Match: "<version>"` (or ' +
      '`version` in the body) makes the decision conditional: 412 `precondition-failed` (409 ' +
      '`conflict` for the body field) if the placement changed. A placement on a removed step ' +
      'can only be rejected or corrected (422 `unknown-step`).',
    request: {
      params: placementParams,
      headers: z.object({ 'if-match': z.string().max(100).optional() }),
      body: jsonBody(PlacementDecisionBody),
    },
    responses: {
      200: { ...json(PlacementDecisionResult, 'The decided placement'), headers: VERSION_ETAG },
      ...problems(...READ_PROBLEMS, ...REVIEW_PROBLEMS, 'precondition-failed'),
    },
  },
  addPlacementNote: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/placements/{placement}/notes`,
    operationId: 'addPlacementNote',
    tags: ['value-chains'],
    summary: 'Add a note to a placement, e.g. the answer to a held question (humans only)',
    request: { params: placementParams, body: jsonBody(NoteBody) },
    responses: {
      201: json(PlacementAssertion, 'The note'),
      ...problems(...READ_PROBLEMS, ...REVIEW_PROBLEMS),
    },
  },
  getPlacementAssertions: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/value-chains/{key}/placements/{placement}/assertions`,
    operationId: 'getPlacementAssertions',
    tags: ['value-chains'],
    summary: 'The history (timeline) of a placement: every assertion, oldest first',
    request: { params: placementParams },
    responses: {
      200: json(PlacementAssertionList, 'The assertions'),
      ...problems(...READ_PROBLEMS),
    },
  },

  claimAnalyses: {
    method: 'post',
    path: `${API_PREFIX}/analyses/claim`,
    operationId: 'claimAnalyses',
    tags: ['analyses'],
    summary: 'Claim up to 5 queued analysis tasks (15-minute lease, analyzr:propose)',
    description:
      'Claims queued tasks (and tasks whose lease expired with attempts left), oldest first, in ' +
      'the projects where the caller may propose (`projectId` narrows it), of the kinds the ' +
      'caller handles (`kinds`, default `["relations"]`), with `FOR UPDATE SKIP LOCKED`. Each ' +
      'item carries its `kind`, a lease token (shown once, bound to the task and the caller) and ' +
      'the compact claim input, rendered in the claim transaction. A `relations` item: the ' +
      'current agent judgements on pairs touching the model (`judged`) and the pairs a partner ' +
      'analysis judges (`skip`), both left out of `candidates`; the remaining `rule`, `key` and ' +
      '`lexical` candidates and the relations in neither list, accepted pairs, unchanged ' +
      'rejections and missing ends aside, are the task’s assignment, and the other ' +
      '`compatible` candidates the search space for missing partners. A `placement` item ' +
      '(`analyzr-claim-placement/1`): the chain’s steps, the open processes whose input changed ' +
      'since an agent last judged them (at most 50, `truncated` when more are due) with their ' +
      'proposals and the human decisions, and accepted placements as examples. ' +
      'Empty when nothing is claimable.',
    request: { body: jsonBody(ClaimAnalysisBody) },
    responses: {
      200: json(ClaimResult, 'The claimed tasks'),
      ...problems(...READ_PROBLEMS, 'forbidden'),
    },
  },
  getPendingAnalyses: {
    method: 'get',
    path: `${API_PREFIX}/analyses/pending`,
    operationId: 'getPendingAnalyses',
    tags: ['analyses'],
    summary: 'Claimable tasks per project; `wait=1..30` long-polls until work arrives',
    request: { query: PendingQuery },
    responses: {
      200: json(PendingAnalyses, 'Claimable tasks'),
      ...problems(...READ_PROBLEMS, 'forbidden'),
    },
  },
  submitAnalysis: {
    method: 'post',
    path: `${API_PREFIX}/analyses/{analysis}/submission`,
    operationId: 'submitAnalysis',
    tags: ['analyses'],
    summary: 'Submit the result of a claimed task (idempotent by submissionId)',
    description:
      'A `relations` task: validates every item (refs in the head facts, one endpoint in the ' +
      'task model, endpoint kinds, limits) and answers per relation `applied`, `duplicate`, ' +
      '`suppressed`, `reopened` or `invalid:<reason>`, per no-link `stored`, `duplicate` or ' +
      '`invalid:<reason>`, and the assigned pairs left unjudged (`uncovered`). Earlier pipeline ' +
      'proposals and no-links on pairs touching the model that were judged on another version of ' +
      'the model or under another procedure are withdrawn; current judgements stay. A ' +
      '`placement` task (`kind: "placement"` in the result): per placement and unsure item an ' +
      'outcome, the withdrawn stale or replaced pipeline proposals, the input processes left ' +
      'without a verdict (`skipped`) and whether a follow-up task was queued. 422 ' +
      '`wrong-task-kind` (items of the other kind); 409 `lease-lost` (another holder, a ' +
      'release, a wrong token), `task-cancelled` (new revision), `already-submitted` (another ' +
      'submissionId).',
    request: { params: analysisParams, body: jsonBody(SubmitAnalysisBody) },
    responses: {
      200: json(AnalysisSubmissionResult, 'The outcome per item'),
      ...problems(
        ...READ_PROBLEMS,
        'forbidden',
        'payload-too-large',
        'wrong-task-kind',
        ...LEASE_PROBLEMS,
      ),
    },
  },
  releaseAnalysis: {
    method: 'post',
    path: `${API_PREFIX}/analyses/{analysis}/release`,
    operationId: 'releaseAnalysis',
    tags: ['analyses'],
    summary: 'Hand a claimed task back; it is queued again',
    request: { params: analysisParams, body: jsonBody(ReleaseAnalysisBody) },
    responses: {
      200: json(ReleaseResult, 'The task is queued again'),
      ...problems(...READ_PROBLEMS, 'forbidden', ...LEASE_PROBLEMS),
    },
  },
  listAnalyses: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/analyses`,
    operationId: 'listAnalyses',
    tags: ['analyses'],
    summary: 'Analysis tasks of a project, newest first',
    request: { params: projectParams, query: AnalysisQuery },
    responses: { 200: json(AnalysisTaskPage, 'A page of tasks'), ...problems(...READ_PROBLEMS) },
  },
  requeueAnalyses: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/analyses/requeue`,
    operationId: 'requeueAnalyses',
    tags: ['analyses'],
    summary:
      'Queue models again, e.g. after a procedure upgrade, or the value chain placement task (analyzr:write)',
    request: { params: projectParams, body: jsonBody(RequeueBody) },
    responses: {
      200: json(RequeueResult, 'Outcome per model'),
      ...problems(...READ_PROBLEMS, 'forbidden'),
    },
  },
  getAnalysisSubmission: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/analyses/{analysis}/submission`,
    operationId: 'getAnalysisSubmission',
    tags: ['analyses'],
    summary: 'The stored submission of a done task: verbatim payload and result',
    request: { params: projectAnalysisParams },
    responses: {
      200: json(AnalysisSubmission, 'The submission'),
      ...problems(...READ_PROBLEMS),
    },
  },

  listAgentTokens: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/agent-tokens`,
    operationId: 'listAgentTokens',
    tags: ['agent-tokens'],
    summary: "A project's agent tokens (owner only)",
    request: { params: projectParams },
    responses: {
      200: json(AgentTokenList, 'Agent tokens'),
      ...problems(...READ_PROBLEMS, 'forbidden'),
    },
  },
  createAgentToken: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/agent-tokens`,
    operationId: 'createAgentToken',
    tags: ['agent-tokens'],
    summary: 'Create an agent token; the secret is shown once (owner, interactive client)',
    request: {
      params: projectParams,
      body: { required: true, content: { [JSON_TYPE]: { schema: CreateAgentTokenBody } } },
    },
    responses: {
      201: json(CreatedAgentToken, 'The new token with its secret'),
      ...problems(...READ_PROBLEMS, 'forbidden', 'validation-failed'),
    },
  },
  revokeAgentToken: {
    method: 'delete',
    path: `${API_PREFIX}/projects/{project}/agent-tokens/{token}`,
    operationId: 'revokeAgentToken',
    tags: ['agent-tokens'],
    summary: 'Revoke an agent token (owner, interactive client)',
    request: { params: projectParams.extend({ token: AgentTokenId }) },
    responses: { 204: { description: 'Revoked' }, ...problems(...READ_PROBLEMS, 'forbidden') },
  },

  listAutoAcceptRules: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/auto-accept-rules`,
    operationId: 'listAutoAcceptRules',
    tags: ['auto-accept'],
    summary: "The project's auto-accept rules with their statistics, and the system rule (owner)",
    request: { params: projectParams },
    responses: {
      200: json(AutoAcceptRuleList, 'The rules in creation order'),
      ...problems(...READ_PROBLEMS, ...AUTO_ACCEPT_PROBLEMS),
    },
  },
  createAutoAcceptRule: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/auto-accept-rules`,
    operationId: 'createAutoAcceptRule',
    tags: ['auto-accept'],
    summary: 'Create an auto-accept rule (owner, interactive client; off unless `enabled`)',
    description:
      'Revision 1 of a new rule, authored by the caller: while it is enabled, agent proposals ' +
      'recorded afterwards that meet it are accepted as decisions of the author (never ' +
      'retroactive: open proposals need `apply`). 422 `validation-failed` with `reason` ' +
      '`unknown-agent` or `name-taken`; a draft the schema refuses (a tier of another kind, a ' +
      'type on a placement rule, a confidence outside 0.5–1, control characters) is 422 ' +
      '`validation-failed` with `errors` naming the fields instead.',
    request: { params: projectParams, body: jsonBody(AutoAcceptRuleDraft) },
    responses: {
      201: { ...json(SaveAutoAcceptRuleResult, 'The new rule'), headers: RULE_ETAG },
      ...problems(...READ_PROBLEMS, ...AUTO_ACCEPT_PROBLEMS),
    },
  },
  previewAutoAcceptRule: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/auto-accept-rules/preview`,
    operationId: 'previewAutoAcceptRule',
    tags: ['auto-accept'],
    summary: 'What a rule (saved or not) would have accepted so far and would accept now',
    description:
      'Replays the project history: the agent proposals humans decided that the rule would ' +
      'have accepted, with the humans’ verdicts (an empirical precision; acceptances by ' +
      'auto-accept rules are no ground truth and counted apart), the open proposals it would ' +
      'accept now (what `apply` would do) with the blocked ones per reason, and a curve over ' +
      'minimum confidences. Nothing is written.',
    request: { params: projectParams, body: jsonBody(AutoAcceptCriteria) },
    responses: {
      200: json(AutoAcceptPreview, 'The preview'),
      ...problems(...READ_PROBLEMS, ...AUTO_ACCEPT_PROBLEMS),
    },
  },
  getAutoAcceptRule: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/auto-accept-rules/{rule}`,
    operationId: 'getAutoAcceptRule',
    tags: ['auto-accept'],
    summary: 'One auto-accept rule with every revision (ETag `"r<revision>"`)',
    request: { params: autoAcceptRuleParams },
    responses: {
      200: { ...json(AutoAcceptRuleDetail, 'The rule'), headers: RULE_ETAG },
      ...problems(...READ_PROBLEMS, ...AUTO_ACCEPT_PROBLEMS),
    },
  },
  reviseAutoAcceptRule: {
    method: 'put',
    path: `${API_PREFIX}/projects/{project}/auto-accept-rules/{rule}`,
    operationId: 'reviseAutoAcceptRule',
    tags: ['auto-accept'],
    summary: 'Edit, enable or disable a rule: a new revision (`If-Match: "r<revision>"` required)',
    description:
      'Writes the draft as the next immutable revision, authored by the caller (decisions ' +
      'already recorded keep their revision). `If-Match` must name the head revision: without ' +
      'it 428 `precondition-required`, a stale one 412 `revision-conflict` with `headRev`. A ' +
      'draft equal to the head answers `unchanged`, unless the head’s author is no longer an ' +
      'owner: then the caller takes the rule over (a new revision with the same fields). The ' +
      'kind of a rule never changes (422 `validation-failed` with `reason` `kind-changed`); ' +
      'otherwise the reasons and `errors` of the create route.',
    request: {
      params: autoAcceptRuleParams,
      headers: z.object({ 'if-match': z.string().max(200).optional() }),
      body: jsonBody(AutoAcceptRuleDraft),
    },
    responses: {
      200: { ...json(SaveAutoAcceptRuleResult, 'The rule'), headers: RULE_ETAG },
      ...problems(
        ...READ_PROBLEMS,
        ...AUTO_ACCEPT_PROBLEMS,
        'revision-conflict',
        'precondition-required',
      ),
    },
  },
  applyAutoAcceptRule: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/auto-accept-rules/{rule}/apply`,
    operationId: 'applyAutoAcceptRule',
    tags: ['auto-accept'],
    summary: 'Apply an enabled rule to the open proposals (`?dryRun=true` first)',
    description:
      'Evaluates the head revision against every open proposal of its kind, with every ' +
      'safeguard. `dryRun=true` lists what it would accept and what is blocked. The real call ' +
      'needs the head `revision`, an enabled rule whose author is still an owner, and ' +
      '`expectedCount` equal to the fresh count: 409 `conflict` with `count`, `revision` and ' +
      '`reason` (`rule-disabled`, `author-not-owner`, `revision-changed`, `count-changed`) ' +
      'otherwise; 422 `validation-failed` with `reason` `expected-count-required` without ' +
      '`revision` and `expectedCount`. The result says whether the head is enabled and its ' +
      'author still an owner.',
    request: {
      params: autoAcceptRuleParams,
      query: AutoAcceptDryRunQuery,
      body: jsonBody(ApplyAutoAcceptBody),
    },
    responses: {
      200: json(ApplyAutoAcceptResult, 'What it did or would do'),
      ...problems(...READ_PROBLEMS, ...AUTO_ACCEPT_PROBLEMS, 'conflict'),
    },
  },
  revokeAutoAccepted: {
    method: 'post',
    path: `${API_PREFIX}/projects/{project}/auto-accept-revocations`,
    operationId: 'revokeAutoAccepted',
    tags: ['auto-accept'],
    summary: 'Revoke auto-acceptances by rule, agent, kind or ids (`?dryRun=true` first)',
    description:
      'Each acceptance still in force is withdrawn (a human withdrawal under the decision’s ' +
      'principal): its item returns to `proposed` while a live proposal remains, else it ' +
      'turns `obsolete` and the agents judge it again. Items a human decided since are never ' +
      'touched. The real call needs `expectedCount` equal to the fresh count (409 `conflict`; ' +
      '422 `validation-failed` with `reason` `expected-count-required` without it).',
    request: {
      params: projectParams,
      query: AutoAcceptDryRunQuery,
      body: jsonBody(AutoAcceptRevocationBody),
    },
    responses: {
      200: json(AutoAcceptRevocationResult, 'What it did or would do'),
      ...problems(...READ_PROBLEMS, ...AUTO_ACCEPT_PROBLEMS, 'conflict'),
    },
  },
  listAutoAccepted: {
    method: 'get',
    path: `${API_PREFIX}/projects/{project}/auto-accepted`,
    operationId: 'listAutoAccepted',
    tags: ['auto-accept'],
    summary:
      'The auto-acceptances of the project and their state (every human reviewer: the review UI marks)',
    description:
      'One entry per acceptance an auto-accept rule recorded: the item, the rule’s name and ' +
      'revision, the decider, the triggering agent proposal and the state (`in-force`, ' +
      '`revoked`, `human-decided`). Readable by editors and owners on an interactive client ' +
      '(permission `review`), so every reviewer sees which acceptances were made by a rule; ' +
      'agent tokens get 403 `human-decision-required`. The rules themselves stay owner-only.',
    request: { params: projectParams, query: AutoAcceptLedgerQuery },
    responses: {
      200: json(AutoAcceptLedger, 'The auto-acceptances, oldest first'),
      ...problems(...READ_PROBLEMS, ...AUTO_ACCEPT_PROBLEMS, 'human-decision-required'),
    },
  },
} as const satisfies Record<string, RouteConfig>);

export type ApiRouteName = keyof typeof apiRoutes;
