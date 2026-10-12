/**
 * THIRD-PARTY-NOTICES.md: the licenses of every production dependency of the
 * workspace (the packages the container images and the web bundle ship), from
 * `pnpm licenses list --prod --json`, plus the build tools whose own code the
 * web bundle contains ({@link BUNDLED_BUILD_TOOLS}: Tailwind's preflight and
 * utilities in the CSS, Vite's preload helper and Rolldown's module runtime in
 * the JavaScript), taken from `pnpm licenses list --json --filter @analyzr/web`
 * because they are devDependencies. The absolute install paths pnpm reports
 * are only used to read each package's license files and never reach the
 * output, so the file is the same on every machine with the same lockfile.
 *
 * Packages are sorted by license, name and version. Each package contributes
 * the files it ships whose name contains LICENSE, LICENCE or COPYING or starts
 * with NOTICE; packages with identical texts share one block. A package that
 * ships no such file is listed with its SPDX id, author and homepage.
 * `pnpm licenses list` reports bpmn-js as `Unknown` (its package.json says
 * `SEE LICENSE IN LICENSE`): its LICENSE, with the bpmn.io watermark clause,
 * is included in full like any other text.
 */
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/** The repository root (tools/notices/src → ../../../). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The generated file, relative to {@link REPO_ROOT}. */
export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.md';

/** One entry of `pnpm licenses list --json`, grouped there by license id. */
export interface PnpmLicenseEntry {
  name: string;
  versions: string[];
  /** Absolute install directories, one per version (same order). */
  paths: string[];
  license: string;
  author?: string;
  homepage?: string;
  description?: string;
}

export type PnpmLicenses = Record<string, PnpmLicenseEntry[]>;

/** A license or notice file a package ships. */
export interface LicenseText {
  file: string;
  text: string;
}

/** One installed package version with what the notices show of it. */
export interface NoticePackage {
  name: string;
  version: string;
  /** SPDX id or expression as pnpm reports it (`Unknown` when it found none). */
  license: string;
  /** The package.json `license` field when pnpm reports `Unknown`. */
  declared?: string;
  author?: string;
  homepage?: string;
  texts: LicenseText[];
}

/** The workspace package whose build output both images serve (apps/web/dist). */
export const WEB_PACKAGE = '@analyzr/web';

/**
 * Build-time packages (devDependencies of {@link WEB_PACKAGE}, directly or
 * through Vite) whose own code lands in apps/web/dist: tailwindcss (preflight
 * and utilities, with its `tailwindcss … | MIT License` banner in the CSS), vite (the
 * module preload helper, `vite:preloadError`) and rolldown (Vite's bundler:
 * the CommonJS interop runtime of every chunk). `pnpm licenses list --prod`
 * leaves them out. Add a package here when another build tool injects code
 * into the bundle.
 */
export const BUNDLED_BUILD_TOOLS: readonly string[] = ['rolldown', 'tailwindcss', 'vite'];

const execFileAsync = promisify(execFile);

async function pnpmLicensesJson(root: string, args: readonly string[]): Promise<PnpmLicenses> {
  const { stdout } = await execFileAsync('pnpm', ['licenses', 'list', '--json', ...args], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout) as PnpmLicenses;
}

/**
 * The entries of `names` in `extra` added to `base` (a version `base` already
 * lists is not added twice). Throws when `extra` lacks one of `names`, so a
 * renamed or dropped build tool is noticed.
 */
export function withBuildTools(
  base: PnpmLicenses,
  extra: PnpmLicenses,
  names: readonly string[],
): PnpmLicenses {
  const out: PnpmLicenses = Object.fromEntries(
    Object.entries(base).map(([license, entries]) => [license, [...entries]]),
  );
  const listed = new Set(
    Object.values(base).flatMap((entries) =>
      entries.flatMap((e) => e.versions.map((v) => `${e.name}@${v}`)),
    ),
  );
  for (const name of names) {
    const found = Object.entries(extra).flatMap(([license, entries]) =>
      entries.filter((e) => e.name === name).map((entry) => ({ license, entry })),
    );
    if (found.length === 0) {
      throw new Error(
        `${name}: not among the dependencies of ${WEB_PACKAGE} (BUNDLED_BUILD_TOOLS)`,
      );
    }
    for (const { license, entry } of found) {
      const keep = entry.versions.flatMap((version, i) => {
        if (listed.has(`${name}@${version}`)) return [];
        const dir = entry.paths[i];
        if (dir === undefined) throw new Error(`${name}@${version}: pnpm reported no path`);
        return [{ version, path: dir }];
      });
      if (keep.length === 0) continue;
      (out[license] ??= []).push({
        ...entry,
        versions: keep.map((k) => k.version),
        paths: keep.map((k) => k.path),
      });
    }
  }
  return out;
}

/**
 * Runs `pnpm licenses list --prod --json` in `root` and adds the
 * {@link BUNDLED_BUILD_TOOLS} from `pnpm licenses list --json --filter @analyzr/web`.
 */
export async function pnpmLicenses(root: string = REPO_ROOT): Promise<PnpmLicenses> {
  const [prod, web] = await Promise.all([
    pnpmLicensesJson(root, ['--prod']),
    pnpmLicensesJson(root, ['--filter', WEB_PACKAGE]),
  ]);
  return withBuildTools(prod, web, BUNDLED_BUILD_TOOLS);
}

/** File names that hold a license or notice text. */
export function isLicenseFile(name: string): boolean {
  return /licen[cs]e|copying/i.test(name) || /^notice/i.test(name);
}

/** Line endings, trailing blanks and surrounding blank lines normalized. */
export function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The license and notice files in `dir`, sorted by name. */
export async function readLicenseTexts(dir: string): Promise<LicenseText[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && isLicenseFile(e.name))
    .map((e) => e.name)
    .sort(compare);
  const out: LicenseText[] = [];
  for (const file of files) {
    out.push({ file, text: normalizeText(await readFile(path.join(dir, file), 'utf8')) });
  }
  return out;
}

async function declaredLicense(dir: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
      license?: unknown;
    };
    return typeof pkg.license === 'string' ? pkg.license : undefined;
  } catch {
    return undefined;
  }
}

/** Every package version of `licenses` with its texts, sorted by license, name and version. */
export async function collectPackages(licenses: PnpmLicenses): Promise<NoticePackage[]> {
  const out: NoticePackage[] = [];
  for (const [license, entries] of Object.entries(licenses)) {
    for (const entry of entries) {
      for (const [i, version] of entry.versions.entries()) {
        const dir = entry.paths[i];
        if (dir === undefined) throw new Error(`${entry.name}@${version}: pnpm reported no path`);
        const declared = license === 'Unknown' ? await declaredLicense(dir) : undefined;
        out.push({
          name: entry.name,
          version,
          license,
          ...(declared ? { declared } : {}),
          ...(entry.author ? { author: entry.author } : {}),
          ...(entry.homepage ? { homepage: entry.homepage } : {}),
          texts: await readLicenseTexts(dir),
        });
      }
    }
  }
  return out.sort(
    (a, b) =>
      compare(a.license, b.license) || compare(a.name, b.name) || compare(a.version, b.version),
  );
}

/** A fence longer than any backtick run in `text`. */
function fence(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

const id = (p: NoticePackage): string => `\`${p.name}@${p.version}\``;

function listItem(p: NoticePackage): string {
  const parts = [id(p)];
  if (p.author) parts.push(`by ${p.author}`);
  if (p.homepage) parts.push(`<${p.homepage}>`);
  return parts.join(', ');
}

/** `a`, `a and b`, `a, b and c`. */
function listNames(names: readonly string[]): string {
  return names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** The Markdown of THIRD-PARTY-NOTICES.md. */
export function renderNotices(packages: readonly NoticePackage[]): string {
  const licenses = [...new Set(packages.map((p) => p.license))].sort(compare);
  const lines: string[] = [
    '# Third-party notices',
    '',
    'analyzr itself is licensed under the MIT License (see `LICENSE`). Its container images and',
    'the web UI it serves include the production dependencies below, each under its own license,',
    `and code of the build tools ${listNames(BUNDLED_BUILD_TOOLS)} in the web bundle.`,
    'This file is generated by `pnpm notices` (`tools/notices`) from',
    '`pnpm licenses list --prod --json` and, for those build tools,',
    '`pnpm licenses list --json --filter @analyzr/web`; do not edit it by hand.',
    '',
    'The web UI renders BPMN diagrams with bpmn-js, whose license requires the bpmn.io watermark',
    'to stay unchanged and fully visible (see bpmn-js below).',
    '',
    `## Summary (${packages.length} package versions)`,
    '',
    '| License | Package versions |',
    '| --- | ---: |',
    ...licenses.map((l) => `| ${l} | ${packages.filter((p) => p.license === l).length} |`),
  ];
  for (const license of licenses) {
    const members = packages.filter((p) => p.license === license);
    lines.push('', `## ${license}`);
    const missing = members.filter((p) => p.texts.length === 0);
    const groups = new Map<string, { texts: LicenseText[]; packages: NoticePackage[] }>();
    for (const p of members) {
      if (p.texts.length === 0) continue;
      const key = p.texts.map((t) => t.text).join('\n\u0000\n');
      const group = groups.get(key) ?? { texts: p.texts, packages: [] };
      group.packages.push(p);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      lines.push('', `### ${group.packages.map(id).join(', ')}`);
      const declared = [
        ...new Set(group.packages.flatMap((p) => (p.declared ? [p.declared] : []))),
      ];
      if (declared.length > 0) {
        lines.push('', `Declared in package.json: ${declared.map((d) => `\`${d}\``).join(', ')}.`);
      }
      for (const text of group.texts) {
        const f = fence(text.text);
        lines.push('', `${text.file}:`, '', `${f}text`, text.text, f);
      }
    }
    if (missing.length > 0) {
      lines.push(
        '',
        `### Without a license file (${license})`,
        '',
        `These packages ship no license file; their package.json declares ${license}.`,
        '',
        ...missing.map((p) => `- ${listItem(p)}`),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The current notices of `root`, rendered fresh. */
export async function generateNotices(root: string = REPO_ROOT): Promise<string> {
  return renderNotices(await collectPackages(await pnpmLicenses(root)));
}
