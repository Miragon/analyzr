/**
 * The Claude Code plugin `plugins/analyzr` carries a generated skill per
 * released pipeline procedure (`/analyzr:relations`, `/analyzr:placements`). These
 * tests fail when the committed files lag behind the procedures;
 * `pnpm --filter @analyzr/procedures generate` rewrites them. They also fail when
 * the skill of a released procedure version changes, or a skill changes
 * without a new plugin version.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  PLUGIN_VERSION,
  getProcedure,
  pipelineProcedures,
  renderSkill,
  skillPath,
  type Procedure,
} from '../src/index.ts';

const ROOT = new URL('../../../', import.meta.url);
const GENERATE = 'stale: run `pnpm --filter @analyzr/procedures generate` and commit the result';

/**
 * sha256 of the skill of every released procedure version, per procedure id.
 * A release never changes: runs are recorded under `<id>@<version>`. So a
 * change to a procedure text or to the wrapper (wrappers.ts) needs a new
 * procedure version, and that version's hash is added here.
 */
const RELEASED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'analyzr-relations': {
    '0.2.0': '7b5fdf32a6c588d9517dd1bc9e2786e241d61578b2a699dd5bcae2e462f37069',
  },
  'analyzr-placements': {
    '0.1.0': '6fcb9822b2683eb9032eba93f3114854decdb948599791f0452ce65253e27ffb',
  },
};

/**
 * Per plugin release, the sha256 of every skill it ships, by skill name.
 * Claude Code keeps an installed plugin until its version changes, so every
 * change to a shipped skill needs a new plugin version (`PLUGIN_VERSION`,
 * src/plugin.ts) with its row here.
 */
const PLUGIN_RELEASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '0.3.0': {
    relations: RELEASED['analyzr-relations']?.['0.2.0'] ?? '',
    placements: RELEASED['analyzr-placements']?.['0.1.0'] ?? '',
  },
};

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function procedure(id: string): Procedure {
  const p = getProcedure(id);
  if (!p) throw new Error(`the ${id} procedure is missing`);
  return p;
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
}

describe('Claude Code plugin (plugins/analyzr)', () => {
  it('ships one skill per released pipeline procedure', () => {
    expect(pipelineProcedures().map((p) => p.id)).toEqual([
      'analyzr-placements',
      'analyzr-relations',
    ]);
    expect(skillPath(procedure('analyzr-relations'))).toBe(
      'plugins/analyzr/skills/relations/SKILL.md',
    );
    expect(skillPath(procedure('analyzr-placements'))).toBe(
      'plugins/analyzr/skills/placements/SKILL.md',
    );
    expect(readdirSync(new URL('plugins/analyzr/skills/', ROOT)).sort()).toEqual([
      'placements',
      'relations',
    ]);
  });

  it.each(['analyzr-relations', 'analyzr-placements'])(
    'ships the skill generated from %s',
    (id) => {
      const p = procedure(id);
      expect(readFileSync(new URL(skillPath(p), ROOT), 'utf8'), GENERATE).toBe(renderSkill(p));
    },
  );

  it('gives the placements skill its arguments and keeps it out of model invocation', () => {
    const skill = renderSkill(procedure('analyzr-placements'));
    expect(skill).toContain('\nname: placements\n');
    expect(skill).toContain('\nargument-hint: "[project] [max-tasks]"\n');
    expect(skill).toContain('\ndisable-model-invocation: true\n');
    expect(skill).toContain(
      'claim_analysis({projectId: "<project>", kinds: ["placement"], max: 1})',
    );
  });

  it.each(['analyzr-relations', 'analyzr-placements'])(
    'never changes the skill of a released version of %s',
    (id) => {
      const p = procedure(id);
      const hash = sha256(renderSkill(p));
      expect(
        hash,
        `the skill of ${p.id}@${p.version} is not the released one: bump the procedure version (${p.name}.md frontmatter), run \`pnpm --filter @analyzr/procedures generate\` and add the new version's hash ${hash} to RELEASED`,
      ).toBe(RELEASED[p.id]?.[p.version]);
    },
  );

  it('ships exactly the skills its plugin release pins', () => {
    const shipped = Object.fromEntries(
      pipelineProcedures().map((p) => [p.name, sha256(renderSkill(p))]),
    );
    expect(
      shipped,
      `the skills differ from plugin release ${PLUGIN_VERSION}: bump PLUGIN_VERSION (src/plugin.ts), add its row to PLUGIN_RELEASES and run \`pnpm --filter @analyzr/procedures generate\``,
    ).toEqual(PLUGIN_RELEASES[PLUGIN_VERSION]);
  });

  it('has the plugin version', () => {
    expect(json('plugins/analyzr/.claude-plugin/plugin.json'), GENERATE).toMatchObject({
      name: 'analyzr',
      version: PLUGIN_VERSION,
    });
  });

  it('is listed in the repository marketplace and declares no MCP server', () => {
    // The second plugin, analyzr-integrate (M6 §3.7), is unversioned here: tools/integrate
    // tests its files and pins its releases.
    expect(json('.claude-plugin/marketplace.json')).toEqual({
      name: 'analyzr',
      owner: { name: 'Miragon' },
      metadata: {
        description:
          'Claude Code plugins for analyzr, the headless store for BPMN process landscapes.',
      },
      plugins: [
        {
          name: 'analyzr',
          source: './plugins/analyzr',
          description:
            'The analyzr pipeline procedures as skills: /analyzr:relations judges candidate relations between BPMN processes, /analyzr:placements places processes on the value chain. Connect the analyzr MCP server separately.',
        },
        {
          name: 'analyzr-integrate',
          source: './plugins/analyzr-integrate',
          description:
            'Interactive skills that bring customer process landscapes into analyzr: /analyzr-integrate:integrate-landscape turns a BPMN 2.0 export (Signavio, ARIS, ADONIS, Bizagi, …) into an import bundle and a German report; the consultant runs the import. Needs a shell and Node 24.',
        },
      ],
    });
    // The connection is configured separately, so tool names stay mcp__analyzr__*.
    expect(json('plugins/analyzr/.claude-plugin/plugin.json')).not.toHaveProperty('mcpServers');
    expect(() => readFileSync(new URL('plugins/analyzr/.mcp.json', ROOT))).toThrow(/ENOENT/);
  });
});
