import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cssVariableOf, palette, type PaletteKey } from '../src/theme/tokens';

const tokensCss = readFileSync(
  join(import.meta.dirname, '../src/theme/cd-tokens.generated.css'),
  'utf8',
);
const brandAssetChecksums = readFileSync(
  join(import.meta.dirname, '../../../.miragon/brand-assets.sha256'),
  'utf8',
);
const indexCss = readFileSync(join(import.meta.dirname, '../src/index.css'), 'utf8');

function cssVariables(css: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    vars.set(match[1]!, match[2]!.trim());
  return vars;
}

describe('Miragon tokens (modeler-tool-design §13 drift test)', () => {
  const vars = cssVariables(tokensCss);

  it('the TS palette equals the vendored --cd-* tokens', () => {
    for (const key of Object.keys(palette) as PaletteKey[]) {
      expect(vars.get(cssVariableOf(key))?.toUpperCase(), key).toBe(palette[key].toUpperCase());
    }
  });

  it('the vendored file matches .miragon/brand-assets.sha256 and is imported by the app CSS', () => {
    const checksum = createHash('sha256').update(tokensCss).digest('hex');
    expect(brandAssetChecksums).toContain(
      `${checksum}  apps/web/src/theme/cd-tokens.generated.css`,
    );
    expect(indexCss).toContain("@import './theme/cd-tokens.generated.css';");
  });

  it('the app CSS defines no colours of its own (one mode, no dark theme)', () => {
    const own = indexCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(own).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(own).not.toMatch(/\brgba?\(/);
    expect(own).not.toMatch(/\boklch\(/);
    expect(own).not.toMatch(/^\.dark\b/m);
  });
});

describe('status colours as text (modeler-tool-design §3.3)', () => {
  const sourceDir = join(import.meta.dirname, '../src');
  const components = readdirSync(sourceDir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => ({ file, source: readFileSync(join(sourceDir, file), 'utf8') }));

  it('the app CSS never sets success or warning as the text colour', () => {
    expect(indexCss).not.toMatch(/(^|[^-])color:\s*var\(--cd-(success|warning)\)/m);
  });

  it('components colour only icons in success or warning, never text', () => {
    const textElements = components.flatMap(({ file, source }) =>
      [...source.matchAll(/<(\w+)[^<>]*?className="[^"]*\btext-(success|warning)\b/g)]
        .filter((match) => !match[1]!.endsWith('Icon'))
        .map((match) => `${file}: <${match[1]}> text-${match[2]}`),
    );
    expect(textElements).toEqual([]);
  });

  it('badges and token states put success and warning text in the text colour', () => {
    const toneClasses = components
      .flatMap(({ source }) => [...source.matchAll(/'bg-(success|warning)-soft text-[^']*'/g)])
      .map((match) => match[0]);
    expect(toneClasses.length).toBeGreaterThan(0);
    for (const classes of toneClasses) expect(classes).toContain('text-foreground');
  });
});
