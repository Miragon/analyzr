/**
 * The command tree both `analyzr` CLIs share (M6 S3c): the checkout's and the
 * container's (`program.ts`, which adds `mcp` and `seed`) and the one the
 * integrate plugin bundles as `scripts/analyzr.mjs` (`plugin-main.ts`, owner
 * decision 30 (3)). It holds every command but `seed`, which reads the
 * checkout's eval/corpus, and `mcp`, whose MCP SDK would more than double the
 * bundle; nothing here imports either, so the bundle carries neither.
 */
import { DEFAULT_ANALYZR_URL } from '@analyzr/client';
import { AGENT_TOKEN_DEFAULT_DAYS, MAX_ANSWER_CHARS, OWNER_KEY_FILE_ENV } from '@analyzr/contracts';
import { Command, CommanderError, Option } from 'commander';

import { modelsAmendCommand, questionsAmendCommand, type AmendOptions } from './commands/amend.ts';
import {
  amendmentsExportCommand,
  amendmentsListCommand,
  amendmentsWithdrawCommand,
} from './commands/amendments.ts';
import { healthCommand } from './commands/health.ts';
import { importCommand, shellArg } from './commands/import.ts';
import {
  modelsDeleteCommand,
  modelsExternalIdsCommand,
  modelsListCommand,
  modelsPullCommand,
  modelsRequeueCommand,
} from './commands/models.ts';
import {
  collect,
  questionsLinkCommand,
  questionsOutsideCommand,
  questionsPlaceCommand,
} from './commands/questions-act.ts';
import { questionsAnswerCommand } from './commands/questions-answer.ts';
import { questionsCommand } from './commands/questions.ts';
import {
  rulesAddCommand,
  rulesApplyCommand,
  rulesEditCommand,
  rulesListCommand,
  rulesPreTrustCommand,
  rulesPreviewCommand,
  rulesRevokeCommand,
  rulesShowCommand,
  rulesSwitchCommand,
  type CriteriaFlags,
} from './commands/rules.ts';
import { statusCommand } from './commands/status.ts';
import {
  DEFAULT_SCOPES,
  tokenCreateCommand,
  tokenListCommand,
  tokenRevokeCommand,
} from './commands/token.ts';
import {
  valueChainPullCommand,
  valueChainPushCommand,
  valueChainRequeueCommand,
} from './commands/value-chain.ts';
import type { CredentialOptions } from './credentials.ts';
import { CliError } from './errors.ts';
import { BPMN_FILE_PATTERNS } from './files.ts';
import type { CliIo } from './io.ts';
import rootPackage from '../../../package.json' with { type: 'json' };

interface GlobalOptions {
  url?: string;
  token?: string;
  ownerKeyFile?: string;
}

/** How the core program differs between the two CLIs. */
export interface CoreProgramOptions {
  /** The first paragraph of `--help`. */
  description: string;
  /**
   * The command the next steps of `import` and the hint of `status` name, for
   * the URL the run talked to: `analyzr` in the checkout and the container
   * (`CLI_COMMAND`; the skill adds `--url`), in the plugin's bundle `node <path
   * of analyzr.mjs> --url <url>`, also for the default URL
   * ({@link pluginCommand}), so a consultant without a checkout can run each
   * of them against the same analyzr.
   */
  commandName: (url: string) => string;
  /**
   * The CLI entry a Claude Desktop configuration of `token create` starts
   * `mcp` with (`CLI_MAIN` of the checkout); `null` in the bundle, which has
   * no `mcp`: it names no file then.
   */
  mcpEntry: string | null;
  /**
   * The bundle (R33): the owner key goes only to analyzr on this machine
   * (`keepOwnerKeyLocal`), an agent token anywhere; the checkout keeps
   * sending the owner key to any `--url`.
   */
  ownerKeyLoopbackOnly: boolean;
}

/**
 * The global options: `--url` (`ANALYZR_URL`, default
 * http://127.0.0.1:7400), `--token` (`ANALYZR_TOKEN`, an agent token) and
 * `--owner-key-file` (`ANALYZR_OWNER_KEY_FILE`), the environment read from
 * `io.env`, so tests control it.
 */
export function globalOptions(program: Command, io: CliIo): CredentialOptions & { url: string } {
  const o = program.opts<GlobalOptions>();
  return {
    url: (o.url ?? io.env['ANALYZR_URL'] ?? DEFAULT_ANALYZR_URL).replace(/\/+$/, ''),
    token: o.token,
    ownerKeyFile: o.ownerKeyFile,
  };
}

/** A word that reads as a flag: `--` and no whitespace (`--dry-run`, `--`, `--x=y`). */
const FLAG_LIKE = /^--\S*$/;

/** The word the parse guard asks for where an option's placeholder is no plain word. */
const PLACEHOLDER_WORDS: ReadonlyMap<string, string> = new Map([
  ['n', 'number'],
  ['rev', 'revision'],
  ['seq', 'sequence number'],
  ['llmModel', 'model id'],
  ['name@version', 'converter'],
]);

function refusedValue(option: Option, value: string): CliError {
  const placeholder = (/[<[]([^>\]]+?)(?:\.\.\.)?[>\]]/.exec(option.flags)?.[1] ?? 'value').trim();
  return new CliError(
    `${option.long ?? option.flags} ${JSON.stringify(value)}: an option value never starts with --; did you forget the ${PLACEHOLDER_WORDS.get(placeholder) ?? placeholder}?`,
    2,
  );
}

/** `command` and every command below it, depth first. */
const commandTree = (command: Command): Command[] => [
  command,
  ...command.commands.flatMap(commandTree),
];

/**
 * The parse guard of both CLIs (M6 S3c, R34), set on the whole tree before
 * it parses ({@link runProgram}): commander gives an option that takes a
 * value the next word, whatever it is, so `import b -p p --create --name
 * --dry-run` parses as a real import into a project named "--dry-run". A
 * word that reads as a flag (`--` and no whitespace) is never an option
 * value: at each occurrence on the command line (also one a repeated option
 * would overwrite, one of a list, `--name=--x`, `-p--x`) it is a usage
 * error, exit 2 (commander's own usage errors keep its 1), before any action
 * runs. Nor is it an argument, which it can only be after the `--` that ends
 * the options (`import -p p -- --dry-run`). Text with a space (`--text "--
 * siehe oben"`), an environment value and a default pass.
 */
export function guardValues(program: Command): void {
  for (const command of commandTree(program)) {
    for (const option of command.options) {
      if (!option.required && !option.optional) continue;
      // commander emits this at every occurrence, with the word as given
      command.on(`option:${option.name()}`, (value: unknown) => {
        if (typeof value === 'string' && FLAG_LIKE.test(value)) throw refusedValue(option, value);
      });
    }
  }
  program.hook('preAction', (_program, action) => {
    const flag = action.args.find((arg) => FLAG_LIKE.test(arg));
    if (flag !== undefined) {
      throw new CliError(
        `argument ${JSON.stringify(flag)}: an argument never starts with --; an option belongs before the -- that ends them`,
        2,
      );
    }
  });
}

/**
 * Builds the core of the `analyzr` command tree: every command but `mcp`
 * and `seed` ({@link CoreProgramOptions} for what the two CLIs set), with
 * the global options ({@link globalOptions}); {@link runProgram} adds the
 * parse guard.
 */
export function buildCoreProgram(io: CliIo, options: CoreProgramOptions): Command {
  const program = new Command('analyzr')
    .description(options.description)
    .version(rootPackage.version, '-v, --version')
    .option('--url <url>', `analyzr server URL (env ANALYZR_URL, default ${DEFAULT_ANALYZR_URL})`)
    .option('--token <token>', 'agent token analyzr_at_… (env ANALYZR_TOKEN)')
    .option(
      '--owner-key-file <file>',
      `local owner key file (env ${OWNER_KEY_FILE_ENV}, default ~/.local/state/analyzr/owner-key)`,
    )
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .showHelpAfterError()
    .exitOverride();

  const globals = (): CredentialOptions & { url: string } => ({
    ...globalOptions(program, io),
    ...(options.ownerKeyLoopbackOnly ? { ownerKeyLoopbackOnly: true } : {}),
  });

  program
    .command('health')
    .description('check that the server and its database are up')
    .action(() => healthCommand(io, globals()));

  program
    .command('status')
    .description('server health and, per project, models by stage, relations and findings')
    .option('-p, --project <project>', 'only this project (key or id)')
    .option('--json', 'print JSON')
    .action((opts: { project?: string; json?: boolean }) => {
      const g = globals();
      return statusCommand(io, { ...g, ...opts, commandName: options.commandName(g.url) });
    });

  program
    .command('import')
    .description(
      'import every BPMN file below <dir> into a project (model key: the one analyzr-import.json pins, else the path); then says what waits for an agent',
    )
    .argument('<dir>', `directory with BPMN files (${BPMN_FILE_PATTERNS})`)
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--create', 'create the project if it does not exist (owner key)')
    .option('--name <name>', 'project name for --create (default: the key)')
    .option('--verbose', 'list every extractor warning the server reports (up to 20 per file)')
    .option('--json', 'print JSON')
    .option(
      '--dry-run',
      'preview into an existing project: the outcomes and what the import would change; import nothing (any credential)',
    )
    .action(
      (
        dir: string,
        opts: {
          project: string;
          create?: boolean;
          name?: string;
          verbose?: boolean;
          json?: boolean;
          dryRun?: boolean;
        },
      ) => {
        const g = globals();
        return importCommand(io, dir, { ...g, ...opts, commandName: options.commandName(g.url) });
      },
    );

  /** The value flags of `models amend` and `questions amend`, and the dry run. */
  const amendFlags = (cmd: Command): Command =>
    cmd
      .option(
        '--call-target <target>',
        'the target of a call activity: a ref, the key of a model with one process, or a unique process name',
      )
      .option(
        '--message-name <name>',
        'the name of the message or signal an endpoint references (every element referencing it reads the new name)',
      )
      .option('--name <label>', 'the name of a start or end event')
      .option('--documentation <text>', 'the documentation of a process that has none')
      .option(
        '--partner <ref>',
        'with --message-name: the endpoint of another process whose name it is; the proposal between them is accepted as your decision',
      )
      .option('--dry-run', 'print the effect and the cost; record nothing')
      .option(
        '--yes',
        "save even when an agent holds the model's relations task (the new head cancels it, and the agent's work is lost)",
      )
      .option('--json', 'print JSON');

  const models = program
    .command('models')
    .description(
      "list, requeue, delete, amend and pull a project's models, and their source-system ids",
    );
  models
    .command('list')
    .description('list the models: key, stage, head revision, engine, open items')
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--stage <stage>', 'only models in this pipeline stage, e.g. agent_failed')
    .option('--json', 'print JSON')
    .action((opts: { project: string; stage?: string; json?: boolean }) =>
      modelsListCommand(io, { ...globals(), ...opts }),
    );
  models
    .command('requeue')
    .description(
      'queue the relations task of models again, e.g. after a failed task (owner key or a token with analyzr:write)',
    )
    .argument('[key...]', 'model keys (at most 1000)')
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--all', 'every live model of the project')
    .option('--json', 'print JSON')
    .action((keys: string[], opts: { project: string; all?: boolean; json?: boolean }) =>
      modelsRequeueCommand(io, keys, { ...globals(), ...opts }),
    );
  models
    .command('delete')
    .description(
      'delete models (owner key): lists them without --yes; partner relations turn missing, uploading a key again revives its model',
    )
    .argument('<key...>', 'model keys')
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--yes', 'delete them')
    .option('--json', 'print JSON')
    .action((keys: string[], opts: { project: string; yes?: boolean; json?: boolean }) =>
      modelsDeleteCommand(io, keys, { ...globals(), ...opts }),
    );
  models
    .command('external-ids')
    .description(
      "list each live model's identity in its source system (key, tool id, tool folder) as the newest import declared it, to rebuild a key map (any credential)",
    )
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--system <system>', 'only this source system, e.g. signavio')
    .option('--json', 'print JSON')
    .action((opts: { project: string; system?: string; json?: boolean }) =>
      modelsExternalIdsCommand(io, { ...globals(), ...opts }),
    );
  amendFlags(
    models
      .command('amend')
      .description(
        'amend one field of a model as a human (owner key): the call target, a message or signal name, a start or end name, or the documentation of a process without one, where an open question names it or it is empty; a new amended revision computed from the uploaded one, which the next import applies again while the source tool leaves the field as it was. Dry run first; prints the effect and the cost',
      )
      .argument('<key>', 'model key')
      .requiredOption('-p, --project <project>', 'project key or id')
      .option('--element <id>', 'the element whose field is set: its id in the BPMN file'),
  ).action((key: string, opts: AmendOptions & { project: string }) =>
    modelsAmendCommand(io, key, { ...globals(), ...opts }),
  );
  models
    .command('pull')
    .description(
      "write a model's BPMN verbatim: the head (amended when amendments apply), or with --original the uploaded revision it is computed from; r<rev> <sha256> on stderr (any credential)",
    )
    .argument('<key>', 'model key')
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--original', 'the uploaded revision, without the amendments')
    .option('-o, --output <file>', 'write to this file (default: stdout)')
    .action((key: string, opts: { project: string; original?: boolean; output?: string }) =>
      modelsPullCommand(io, key, { ...globals(), ...opts }),
    );

  // `questions` lists (its default subcommand, so `analyzr questions -p …` lists), takes notes
  // and runs the actions; subcommands, so each has its own flags beside the list's filters.
  const questions = program
    .command('questions')
    .description(
      'list and export the open questions of a project (list, the default), add notes (answer) or act on them (outside, link, place, amend)',
    );
  questions
    .command('list', { isDefault: true })
    .description(
      'the open questions of a project, questions before value chain findings and informational items, each most open decisions first: a table with the primary action and the suggested targets, JSON, or the Markdown or CSV export (any credential)',
    )
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--model <key>', 'only questions touching this model, or a model below this folder')
    .option('--kind <kind>', 'only this kind, e.g. call-target-unknown or black-box-partner')
    .option('--source <source>', 'only this source, e.g. finding, hold, agent-question or signal')
    .option(
      '--ask-who <name>',
      'only questions whose contact hint names this lane, step owner or folder exactly',
    )
    .option(
      '--state <state>',
      'only open, or only answered questions (marked outside the landscape)',
    )
    .option(
      '--group <group>',
      "only this group: ask (to clarify), agent (the agents' questions on their proposals), proposal (decided on the value chain) or info; repeat or comma-separate for several (the export holds only ask without it)",
      collect,
    )
    .option(
      '--format <format>',
      'text (a table, the default), md (the Markdown export), csv (the CSV export for the customer, its column Antwort empty or holding the latest note; both only the questions to clarify unless --group, --kind or --source says otherwise) or json',
    )
    .option('-o, --output <file>', 'write to this file (default: stdout)')
    .action(
      (opts: {
        project: string;
        model?: string;
        kind?: string;
        source?: string;
        askWho?: string;
        state?: string;
        group?: string[];
        format?: string;
        output?: string;
      }) => questionsCommand(io, { ...globals(), ...opts }),
    );
  questions
    .command('answer')
    .description(
      'record notes as a human (owner key): one with <id> --text, or the filled-in CSV sheet of the export with --from; on a relation or placement the note lands on it; a note leaves the question open',
    )
    .argument('[id]', 'open question id (q-…), as analyzr questions lists it')
    .requiredOption('-p, --project <project>', 'project key or id')
    .option(
      '--text <text>',
      `the note (at most ${MAX_ANSWER_CHARS} characters; no names or other personal data)`,
    )
    // S5a's answer kinds are gone (M6 S5c-1): hidden, refused with the way to the outside mark.
    .addOption(new Option('--kind <kind>').hideHelp())
    .option(
      '--from <file>',
      'the CSV of analyzr questions --format csv with the column Antwort filled in (UTF-8; a sheet exported with Antwortart still reads)',
    )
    .option('--dry-run', 'with --from: list what would be recorded; record nothing')
    .option('--json', 'print JSON')
    .action(
      (
        id: string | undefined,
        opts: {
          project: string;
          text?: string;
          kind?: string;
          from?: string;
          dryRun?: boolean;
          json?: boolean;
        },
      ) => questionsAnswerCommand(io, id, { ...globals(), ...opts }),
    );
  const noteHelp = `an optional note (at most ${MAX_ANSWER_CHARS} characters; no names or other personal data)`;
  questions
    .command('outside')
    .description(
      'mark an open question „Liegt außerhalb der Landschaft“ as a human (owner key): the question turns answered; --undo withdraws a mark',
    )
    .argument('<id>', 'open question id (q-…), as analyzr questions lists it')
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--note <text>', `${noteHelp}, kept as the mark's text`)
    .option('--undo <answer>', 'withdraw this outside mark (oqa_…, as the mark printed it)')
    .option('--json', 'print JSON')
    .action((id: string, opts: { project: string; note?: string; undo?: string; json?: boolean }) =>
      questionsOutsideCommand(io, id, { ...globals(), ...opts }),
    );
  questions
    .command('link')
    .description(
      "answer an open question with a link as a human (owner key): a live proposal between the question's element and the target is accepted, else an accepted manual relation is written",
    )
    .argument('<id>', 'open question id (q-…), as analyzr questions lists it')
    .requiredOption('-p, --project <project>', 'project key or id')
    .option(
      '--to <target>',
      'the target: a ref, the key of a model with one process, or a unique process name; repeat for several where the question takes several (at most 10)',
      collect,
    )
    .option(
      '--pair <ref...>',
      'the two refs of one of the pairs the question lists (Paare ohne Urteil), instead of --to',
    )
    .option('--note <text>', `${noteHelp}, added to the rationale`)
    .option('--json', 'print JSON')
    .action(
      (
        id: string,
        opts: { project: string; to?: string[]; pair?: string[]; note?: string; json?: boolean },
      ) => questionsLinkCommand(io, id, { ...globals(), ...opts }),
    );
  questions
    .command('place')
    .description(
      "answer an open question with a placement as a human (owner key): the question's process on a step of the value chain or on @outside, or for a step without a process the process on that step; accepted at once",
    )
    .argument('<id>', 'open question id (q-…), as analyzr questions lists it')
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--step <step>', 'the step element id of the value chain, or @outside (no step)')
    .option(
      '--process <target>',
      'for a step without a process: the process to place on it (a ref, the key of a model with one process, or a unique process name)',
    )
    .option('--note <text>', `${noteHelp}, added to the rationale`)
    .option('--json', 'print JSON')
    .action(
      (
        id: string,
        opts: { project: string; step?: string; process?: string; note?: string; json?: boolean },
      ) => questionsPlaceCommand(io, id, { ...globals(), ...opts }),
    );
  amendFlags(
    questions
      .command('amend')
      .description(
        "answer an open question by amending the model as a human (owner key): the field its amend action names, in one new amended revision; without a value it records the action's prefilled one („Meine Ergänzung behalten“). Dry run first; prints the effect and the cost",
      )
      .argument('<id>', 'open question id (q-…), as analyzr questions lists it')
      .requiredOption('-p, --project <project>', 'project key or id')
      .option(
        '--element <id>',
        'which of the targets the action lists (start and end events without a name)',
      ),
  ).action((id: string, opts: AmendOptions & { project: string }) =>
    questionsAmendCommand(io, id, { ...globals(), ...opts }),
  );

  const amendments = program
    .command('amendments')
    .description(
      "list, export and withdraw a project's model amendments („Ergänzungen“): fields a human set in analyzr, applied to every import of the model while the source tool leaves them as they were",
    );
  amendments
    .command('list')
    .description(
      'the amendments of a project, oldest first: id, model, element, op, state (applied, in-source, conflict, withdrawn, superseded), before → after (any credential)',
    )
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--model <key>', 'only amendments of this model, or of a model below this folder')
    .option('--state <state>', 'only this state, e.g. conflict')
    .option('--json', 'print JSON')
    .action((opts: { project: string; model?: string; state?: string; json?: boolean }) =>
      amendmentsListCommand(io, { ...globals(), ...opts }),
    );
  amendments
    .command('export')
    .description(
      'the change list to carry into the source tool by hand, grouped per model, as Markdown or CSV, written verbatim; analyzr writes nothing back (any credential)',
    )
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--model <key>', 'only amendments of this model, or of a model below this folder')
    .option('--state <state>', 'only this state, e.g. applied')
    .option(
      '--since <seq>',
      'only what was recorded or ended after this event (the export names the event it reflects)',
    )
    .option('--format <format>', 'md (Markdown, the default) or csv (UTF-8 with a byte order mark)')
    .option('-o, --output <file>', 'write to this file (default: stdout)')
    .action(
      (opts: {
        project: string;
        model?: string;
        state?: string;
        since?: string;
        format?: string;
        output?: string;
      }) => amendmentsExportCommand(io, { ...globals(), ...opts }),
    );
  amendments
    .command('withdraw')
    .description(
      'withdraw an amendment as a human (owner key), or with --model every live amendment of a model: a new head re-derived from the uploaded revision without them (a deleted model gets none, only the withdrawals)',
    )
    .argument('[id]', 'amendment id (mam_…), as analyzr amendments list shows it')
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--model <key>', 'every live amendment of this model, in one step')
    .option(
      '--rev <n>',
      "withdraw only while the model's head is still r<n> (as analyzr models lists it): an amendment recorded since is never withdrawn unseen",
    )
    .option('--json', 'print JSON')
    .action(
      (
        id: string | undefined,
        opts: { project: string; model?: string; rev?: string; json?: boolean },
      ) => amendmentsWithdrawCommand(io, id, { ...globals(), ...opts }),
    );

  const token = program.command('token').description('manage agent tokens (owner key)');
  token
    .command('create')
    .description('create an agent token; prints its secret once plus MCP client configurations')
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('-n, --name <name>', 'token name', 'agent')
    .option(
      '-s, --scopes <scope...>',
      'scopes: analyzr:read, analyzr:propose, analyzr:write (also "read,propose")',
      [...DEFAULT_SCOPES],
    )
    .option(
      '-e, --expires <duration>',
      'expiry, e.g. 90d or 12w (≤ 365 days)',
      `${AGENT_TOKEN_DEFAULT_DAYS}d`,
    )
    .option('--json', 'print the token as JSON')
    .action(
      (opts: {
        project: string;
        name: string;
        scopes: string[];
        expires: string;
        json?: boolean;
      }) => tokenCreateCommand(io, { ...globals(), ...opts, mcpEntry: options.mcpEntry }),
    );
  token
    .command('list')
    .description("list a project's agent tokens (never their secrets)")
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--json', 'print JSON')
    .action((opts: { project: string; json?: boolean }) =>
      tokenListCommand(io, { ...globals(), ...opts }),
    );
  token
    .command('revoke')
    .description('revoke an agent token')
    .argument('<id>', 'token id (agt_…)')
    .requiredOption('-p, --project <project>', 'project key or id')
    .action((id: string, opts: { project: string }) =>
      tokenRevokeCommand(io, id, { ...globals(), ...opts }),
    );

  const valueChain = program
    .command('value-chain')
    .description(
      'push and pull the value chain document (.vc.json) of a project, requeue its placement task',
    );
  valueChain
    .command('push')
    .description(
      'save a .vc.json file as the next revision (owner key; If-Match on --base, a dry run first)',
    )
    .argument('<file>', 'the .vc.json document')
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--key <key>', 'value chain key', 'main')
    .option(
      '--base <rev>',
      'the revision the file comes from (pull prints it); required for an existing chain',
    )
    .option('--force', 'save on the current head without --base (may overwrite newer saves)')
    .option('--dry-run', 'print what the save would do to steps and placements; save nothing')
    .option('--yes', 'save even if placements would be stranded or need re-confirmation')
    .option('--json', 'print JSON')
    .action(
      (
        file: string,
        opts: {
          project: string;
          key: string;
          base?: string;
          force?: boolean;
          dryRun?: boolean;
          yes?: boolean;
          json?: boolean;
        },
      ) => valueChainPushCommand(io, file, { ...globals(), ...opts }),
    );
  valueChain
    .command('pull')
    .description(
      'write the canonical .vc.json of the head (or --rev) verbatim; r<rev> <hash> on stderr',
    )
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--key <key>', 'value chain key', 'main')
    .option('--rev <rev>', 'revision number (default: the head)')
    .option('-o, --output <file>', 'write to this file (default: stdout)')
    .action((opts: { project: string; key: string; rev?: string; output?: string }) =>
      valueChainPullCommand(io, { ...globals(), ...opts }),
    );
  valueChain
    .command('requeue')
    .description(
      "queue the value chain's placement task when a process is due: after a failed task, or for what reviewers' decisions made due (owner key or a token with analyzr:write)",
    )
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--json', 'print JSON')
    .action((opts: { project: string; json?: boolean }) =>
      valueChainRequeueCommand(io, { ...globals(), ...opts }),
    );

  const rules = program
    .command('rules')
    .description(
      "manage a project's auto-accept rules (owner key; owner decision 19): agent proposals at or above a confidence, or with --derived the rule tier's unique calls from derived models of one declared source, are accepted as the owner's decision",
    );
  /** The criteria flags of add, edit and preview. */
  const criteria = (cmd: Command): Command =>
    cmd
      .option('--name <name>', 'rule name (unique in the project)')
      .option('--kind <kind>', 'relation or placement (never changes)')
      .option(
        '--tier <tier>',
        'proposal tier: key, lexical, semantic (placements: lexical, semantic)',
      )
      .option('--min <confidence>', 'minimum confidence, inclusive: 0.9 or 90% (at least 50%)')
      .option('--type <type>', 'relations only: call, message, signal or trigger (any: every type)')
      .option(
        '--agent <agent>',
        'only this agent: token id agt_…, token name or principal prn_… (any: every agent)',
      )
      .option(
        '--model <llmModel>',
        'only proposals declaring exactly this LLM model (any: every model)',
      )
      .option('--ad-hoc', 'also ad-hoc proposals (default: pipeline proposals only)')
      .option('--no-ad-hoc', 'pipeline proposals only')
      .option('--note <text>', 'a note for reviewers ("" removes it)')
      .option(
        '--derived <source>',
        'a rule for derived calls (the rule tier’s unique calls from derived models): export, converted or none (no kind declared); fixes kind, tier, type and minimum; never accepts an agent token’s upload',
      )
      .option(
        '--converter <name@version>',
        'with --derived converted: the converter exactly as the manifest declares it',
      );
  rules
    .command('list')
    .description(
      'list the rules with their head revision and what they accepted, and the system rule',
    )
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--json', 'print JSON')
    .action((opts: { project: string; json?: boolean }) =>
      rulesListCommand(io, { ...globals(), ...opts }),
    );
  rules
    .command('show')
    .description('show a rule and its immutable revisions')
    .argument('<id>', 'rule id (aar_…)')
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--json', 'print JSON')
    .action((id: string, opts: { project: string; json?: boolean }) =>
      rulesShowCommand(io, id, { ...globals(), ...opts }),
    );
  criteria(
    rules
      .command('add')
      .description(
        'create a rule (off unless --enable; never retroactive) and print its preview; needs --name, --kind, --tier, --min, or --name and --derived for a rule for derived calls',
      ),
  )
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--enable', 'enable the rule right away')
    .option('--json', 'print JSON')
    .action((opts: CriteriaFlags & { project: string; enable?: boolean; json?: boolean }) =>
      rulesAddCommand(io, { ...globals(), ...opts }),
    );
  criteria(
    rules
      .command('edit')
      .description('save the flags as the next revision of a rule (If-Match on its head)')
      .argument('<id>', 'rule id (aar_…)'),
  )
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--json', 'print JSON')
    .action((id: string, opts: CriteriaFlags & { project: string; json?: boolean }) =>
      rulesEditCommand(io, id, { ...globals(), ...opts }),
    );
  for (const [name, enabled] of [
    ['enable', true],
    ['disable', false],
  ] as const) {
    rules
      .command(name)
      .description(
        enabled
          ? 'enable a rule (a new revision); reports how many open proposals already match'
          : 'disable a rule (a new revision); its acceptances stay and remain revocable',
      )
      .argument('<id>', 'rule id (aar_…)')
      .requiredOption('-p, --project <project>', 'project key or id')
      .option('--json', 'print JSON')
      .action((id: string, opts: { project: string; json?: boolean }) =>
        rulesSwitchCommand(io, id, enabled, { ...globals(), ...opts }),
      );
  }
  criteria(
    rules
      .command('preview')
      .description(
        'what a rule would have accepted so far (with the precision of the human decisions), would accept now, and the confidence curve (a rule for derived calls: the calls per declared source instead); a saved rule (<id>, changed by flags) or an unsaved one (--kind, --tier, --min, or --derived)',
      )
      .argument('[id]', 'rule id (aar_…)'),
  )
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--json', 'print JSON')
    .action((id: string | undefined, opts: CriteriaFlags & { project: string; json?: boolean }) =>
      rulesPreviewCommand(io, id, { ...globals(), ...opts }),
    );
  rules
    .command('apply')
    .description(
      "accept the open proposals a rule's head revision matches: prints the dry run; accepts only with --yes",
    )
    .argument('<id>', 'rule id (aar_…)')
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--dry-run', 'only print what would be accepted')
    .option('--yes', "accept them (the dry run's count must still hold)")
    .option('--json', 'print JSON')
    .action(
      (id: string, opts: { project: string; dryRun?: boolean; yes?: boolean; json?: boolean }) =>
        rulesApplyCommand(io, id, { ...globals(), ...opts }),
    );
  rules
    .command('revoke')
    .description(
      'revoke auto-acceptances still in force (by rule, revision, agent, kind or ids): back to review, or obsolete when no proposal remains; a human decision taken since is never touched. Prints the dry run; revokes only with --yes',
    )
    .argument('[id]', 'rule id (aar_…)')
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--revision <rev>', 'only acceptances of this revision of the rule')
    .option(
      '--agent <agent>',
      'only acceptances triggered by this agent (token id, name or principal)',
    )
    .option('--kind <kind>', 'relation or placement')
    .option('--ids <id...>', 'relation or placement ids (rel_…, plc_…; also comma-separated)')
    .option('--reason <text>', 'added to the revocation in the history')
    .option('--dry-run', 'only print what would be revoked')
    .option('--yes', "revoke them (the dry run's count must still hold)")
    .option('--json', 'print JSON')
    .action(
      (
        id: string | undefined,
        opts: {
          project: string;
          revision?: string;
          agent?: string;
          kind?: string;
          ids?: string[];
          reason?: string;
          dryRun?: boolean;
          yes?: boolean;
          json?: boolean;
        },
      ) => rulesRevokeCommand(io, id, { ...globals(), ...opts }),
    );
  rules
    .command('pre-trust')
    .description(
      'the unique calls the rule tier accepted before the trust rule from callers that would be derived today (no engine, an agent token, a declared conversion): list them, send them back to review (--revoke) or keep them accepted (--keep), each model once. Prints the dry run; changes something only with --yes',
    )
    .requiredOption('-p, --project <project>', 'project key or id')
    .option('--model <key...>', 'only these models (keys; also comma-separated)')
    .option('--revoke', 'send the calls back to review: they become proposals of the rule tier')
    .option('--keep', 'keep the calls accepted; the models are never listed again')
    .option('--dry-run', 'only print what would change')
    .option('--yes', "review them (the dry run's count must still hold)")
    .option('--json', 'print JSON')
    .action(
      (opts: {
        project: string;
        model?: string[];
        revoke?: boolean;
        keep?: boolean;
        dryRun?: boolean;
        yes?: boolean;
        json?: boolean;
      }) => rulesPreTrustCommand(io, { ...globals(), ...opts }),
    );

  return program;
}

/** The `--help` description of the plugin's bundled CLI. */
export const PLUGIN_DESCRIPTION =
  'analyzr command line, bundled with the analyzr-integrate plugin (no seed, no mcp; run it as node <path of analyzr.mjs> <command>, as its next steps name it): import, list, requeue, delete, amend and pull models, list, export, answer and act on open questions, list, export and withdraw model amendments, push and pull the value chain, manage agent tokens and auto-accept rules';

/** `node <script>`, the script shell-quoted ({@link shellArg}): the command a consultant can paste. */
export function nodeCommand(script: string): string {
  return `node ${shellArg(script)}`;
}

/**
 * The command the bundled CLI's next steps name: {@link nodeCommand}, then
 * always `--url <url>`, also the default one, so a step goes to the analyzr
 * the command went to, not to another one on this machine that the shell
 * running the step names in `ANALYZR_URL` (the integrate skill passes these
 * lines on as printed).
 */
export function pluginCommand(script: string, url: string): string {
  return `${nodeCommand(script)} --url ${shellArg(url)}`;
}

/**
 * The bundled CLI of the integrate plugin (`plugin-main.ts`): the core
 * program naming `node <script>` in its next steps ({@link pluginCommand}),
 * without a Claude Desktop entry, and sending the owner key only to analyzr
 * on this machine.
 */
export function buildPluginProgram(io: CliIo, script: string): Command {
  return buildCoreProgram(io, {
    description: PLUGIN_DESCRIPTION,
    commandName: (url) => pluginCommand(script, url),
    mcpEntry: null,
    ownerKeyLoopbackOnly: true,
  });
}

/**
 * Runs the program `build` makes, with the parse guard ({@link guardValues}),
 * and returns the process exit code; never throws.
 */
export async function runProgram(
  argv: readonly string[],
  io: CliIo,
  build: (io: CliIo) => Command,
): Promise<number> {
  const program = build(io);
  guardValues(program);
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode;
    if (err instanceof CliError) {
      io.stderr(`analyzr: ${err.message}\n`);
      return err.exitCode;
    }
    io.stderr(`analyzr: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
