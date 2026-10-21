/**
 * The key map and the analyzr listings `plan` reads, and the details file
 * `plan` and `bundle` write: shared by the entries of normalize-bpmn,
 * analyzr-spec and analyzr-convert (until plugin 0.1.4 analyzr-spec held a
 * copy, so the shipped normalize-bpmn.mjs stayed byte-identical).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { emptyKeymap, parseKeymap, type AnalyzrIdentity, type Keymap } from './keymap.ts';

export const KEYMAP_FILE = 'keymap.json';

export async function readKeymap(workspace: string): Promise<{ file: string; keymap: Keymap }> {
  const file = path.join(workspace, KEYMAP_FILE);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { file, keymap: emptyKeymap() };
    throw err;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
  return { file, keymap: parseKeymap(value) };
}

export async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${file} does not exist`, { cause: err });
    }
    throw new Error(`${file} is not valid JSON`, { cause: err });
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The keys of `analyzr models list --json` (objects with `key`, and `id`,
 * the model id that tells the older of two models) or a list of keys.
 */
export function existingKeysOf(
  value: unknown,
  file: string,
): { keys: string[]; modelIds: Map<string, string> } {
  if (Array.isArray(value)) {
    const models = value.map((v: unknown) =>
      typeof v === 'string'
        ? { key: v, id: null }
        : isObject(v) && typeof v['key'] === 'string'
          ? { key: v['key'], id: typeof v['id'] === 'string' ? v['id'] : null }
          : null,
    );
    if (models.every((m) => m !== null)) {
      return {
        keys: models.map((m) => m.key),
        modelIds: new Map(models.flatMap((m) => (m.id === null ? [] : [[m.key, m.id] as const]))),
      };
    }
  }
  throw new Error(
    `${file}: expected the output of analyzr models list --json (a list of models with key)`,
  );
}

const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** analyzr's identities: the output of `analyzr models external-ids --json` (`{items}`) or its list. */
export function identitiesOf(value: unknown, file: string): AnalyzrIdentity[] {
  const items = isObject(value) ? value['items'] : value;
  if (Array.isArray(items)) {
    const identities = items.map((v: unknown) =>
      isObject(v) &&
      typeof v['key'] === 'string' &&
      typeof v['system'] === 'string' &&
      isNullableString(v['externalId'] ?? null) &&
      isNullableString(v['externalPath'] ?? null)
        ? {
            key: v['key'],
            system: v['system'],
            externalId: (v['externalId'] ?? null) as string | null,
            externalPath: (v['externalPath'] ?? null) as string | null,
          }
        : null,
    );
    if (identities.every((i) => i !== null)) return identities;
  }
  throw new Error(
    `${file}: expected the output of analyzr models external-ids --json ({"items": [{key, system, externalId, externalPath}]})`,
  );
}

/** Writes the complete result as JSON (two-space indent) for the agent to read details from. */
export async function writeDetails(
  file: string | undefined,
  value: unknown,
): Promise<string | null> {
  if (file === undefined) return null;
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}
