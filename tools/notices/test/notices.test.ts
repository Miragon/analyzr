// THIRD-PARTY-NOTICES.md is generated (`pnpm notices`) and must match a fresh
// render of the installed production dependencies and the build tools whose
// code the web bundle contains; plus the rules the renderer follows
// (src/notices.ts).
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BUNDLED_BUILD_TOOLS,
  NOTICES_FILE,
  REPO_ROOT,
  collectPackages,
  generateNotices,
  isLicenseFile,
  normalizeText,
  pnpmLicenses,
  renderNotices,
  withBuildTools,
  type NoticePackage,
  type PnpmLicenseEntry,
} from '../src/notices.ts';

const pkg = (over: Partial<NoticePackage>): NoticePackage => ({
  name: 'a',
  version: '1.0.0',
  license: 'MIT',
  texts: [],
  ...over,
});

describe('THIRD-PARTY-NOTICES.md', () => {
  it('matches a fresh render (run pnpm notices after a dependency change)', async () => {
    const committed = await readFile(path.join(REPO_ROOT, NOTICES_FILE), 'utf8').catch(() => '');
    const fresh = await generateNotices();
    // No diff: the file is long; the message says what to do.
    expect(committed === fresh, `${NOTICES_FILE} is stale: run pnpm notices`).toBe(true);
  }, 60_000);

  it('includes the bpmn-js license with its watermark clause and never an install path', async () => {
    const packages = await collectPackages(await pnpmLicenses());
    const bpmnJs = packages.find((p) => p.name === 'bpmn-js');
    expect(bpmnJs?.texts.map((t) => t.file)).toEqual(['LICENSE']);
    expect(bpmnJs?.texts[0]?.text).toContain('watermark');
    const text = renderNotices(packages);
    expect(text).toContain('MUST NOT be');
    expect(text).not.toContain(REPO_ROOT);
    expect(text).not.toContain('node_modules/.pnpm');
  }, 60_000);

  it('includes the build tools whose code the web bundle contains (devDependencies)', async () => {
    const packages = await collectPackages(await pnpmLicenses());
    const text = renderNotices(packages);
    expect(BUNDLED_BUILD_TOOLS).toEqual(['rolldown', 'tailwindcss', 'vite']);
    for (const name of BUNDLED_BUILD_TOOLS) {
      const found = packages.filter((p) => p.name === name);
      expect(found, name).toHaveLength(1);
      expect(found[0]?.license, name).toBe('MIT');
      expect(found[0]?.texts.length, name).toBeGreaterThan(0);
      expect(text).toContain(`\`${name}@${found[0]?.version}\``);
    }
    // Tailwind's text, as its banner in the built CSS names it.
    expect(packages.find((p) => p.name === 'tailwindcss')?.texts[0]?.text).toContain('MIT License');
  }, 60_000);
});

describe('withBuildTools', () => {
  const entry = (name: string, versions: string[]): PnpmLicenseEntry => ({
    name,
    versions,
    paths: versions.map((v) => `/store/${name}@${v}`),
    license: 'MIT',
  });

  it('adds only the named packages of the full list, once per version', () => {
    const prod = { MIT: [entry('react', ['19.3.0']), entry('vite', ['8.3.2'])] };
    const full = {
      MIT: [entry('react', ['19.3.0']), entry('vite', ['8.3.2', '8.4.0']), entry('jsdom', ['30'])],
      ISC: [entry('rolldown', ['1.2.12'])],
    };
    const merged = withBuildTools(prod, full, ['rolldown', 'vite']);
    expect(merged['MIT']?.map((e) => `${e.name}:${e.versions.join(',')}`)).toEqual([
      'react:19.3.0',
      'vite:8.3.2',
      'vite:8.4.0',
    ]);
    expect(merged['MIT']?.[2]?.paths).toEqual(['/store/vite@8.4.0']);
    expect(merged['ISC']?.map((e) => e.name)).toEqual(['rolldown']);
    // The input stays as it was.
    expect(prod.MIT).toHaveLength(2);
  });

  it('fails when a named build tool is not installed', () => {
    expect(() => withBuildTools({}, { MIT: [entry('vite', ['8.3.2'])] }, ['tailwindcss'])).toThrow(
      /tailwindcss: not among the dependencies of @analyzr\/web/,
    );
  });
});

describe('renderNotices', () => {
  it('sorts by license, groups identical texts and lists packages without a license file', () => {
    const mit = { file: 'LICENSE', text: 'MIT text' };
    const text = renderNotices([
      pkg({ name: 'b', texts: [mit] }),
      pkg({ name: 'a', texts: [mit] }),
      pkg({ name: 'z', license: 'Apache-2.0', texts: [{ file: 'LICENSE', text: 'Apache' }] }),
      pkg({ name: 'c', author: 'Ada', homepage: 'https://c.example' }),
    ]);
    expect(text.indexOf('## Apache-2.0')).toBeLessThan(text.indexOf('## MIT'));
    expect(text).toContain('### `b@1.0.0`, `a@1.0.0`');
    expect(text.match(/MIT text/g)).toHaveLength(1);
    expect(text).toContain('- `c@1.0.0`, by Ada, <https://c.example>');
    expect(text).toContain('| MIT | 3 |');
  });

  it('fences a text longer than any backtick run in it', () => {
    const text = renderNotices([pkg({ texts: [{ file: 'LICENSE', text: 'a ```` b' }] })]);
    expect(text).toContain('`````text\na ```` b\n`````');
  });
});

describe('license files and texts', () => {
  it('recognizes LICENSE, LICENCE, COPYING and NOTICE files', () => {
    for (const f of [
      'LICENSE',
      'LICENSE.md',
      'license.txt',
      'LICENCE',
      'MIT-LICENSE.txt',
      'COPYING',
      'NOTICE',
    ]) {
      expect(isLicenseFile(f), f).toBe(true);
    }
    for (const f of ['README.md', 'package.json', 'index.js'])
      expect(isLicenseFile(f), f).toBe(false);
  });

  it('normalizes line endings and blanks', () => {
    expect(normalizeText('\uFEFF\n\nline one  \r\nline two\r\n\n')).toBe('line one\nline two');
  });
});
