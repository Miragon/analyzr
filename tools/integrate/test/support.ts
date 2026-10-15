// Shared paths and helpers of the @analyzr/integrate tests.
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach } from 'vitest';

export const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The synthetic Signavio-style export (test/fixtures/signavio/README.md). */
export const SIGNAVIO_EXPORT = path.join(
  PACKAGE_ROOT,
  'test/fixtures/signavio/2026-10-14-signavio',
);

/** The bundle normalize-bpmn writes for {@link SIGNAVIO_EXPORT} (golden; the CLI and web tests read it too). */
export const SIGNAVIO_BUNDLE = path.join(PACKAGE_ROOT, 'test/fixtures/signavio/bundle');

/** The key rule and date the golden bundle was written with. */
export const SIGNAVIO_RULE = { strip: 'Gemeinsame Dokumente', prefix: null };
export const SIGNAVIO_EXPORTED_AT = '2026-10-14';

export const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

const temps: string[] = [];

/** A fresh temporary folder, removed after the test. */
export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'analyzr-integrate-'));
  temps.push(dir);
  return dir;
}

/** A copy of the Signavio fixture export in a temporary folder. */
export async function copyExport(name = '2026-10-14-signavio'): Promise<string> {
  const target = path.join(await tempDir(), name);
  await cp(SIGNAVIO_EXPORT, target, { recursive: true });
  return target;
}

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A minimal BPMN document around `body` (process `P`, optional DI and root attributes). */
export function bpmn(
  body: string,
  options: { di?: string; attrs?: string; ns?: string } = {},
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<definitions xmlns="${BPMN_NS}" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"${options.ns ?? ''} id="Defs_1" targetNamespace="http://example.org/test"${options.attrs ?? ''}>`,
    `  <process id="P" isExecutable="false">${body}</process>`,
    options.di === undefined
      ? ''
      : `  <bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="P">${options.di}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`,
    '</definitions>',
    '',
  ].join('\n');
}

/** A shape for `id` (bounds are irrelevant to the tests). */
export const shape = (id: string, shapeId = `${id}_di`): string =>
  `<bpmndi:BPMNShape id="${shapeId}" bpmnElement="${id}"><dc:Bounds x="0" y="0" width="10" height="10" /></bpmndi:BPMNShape>`;

/** An edge for `id`. */
export const edge = (id: string, edgeId = `${id}_di`): string =>
  `<bpmndi:BPMNEdge id="${edgeId}" bpmnElement="${id}"><di:waypoint x="0" y="0" /><di:waypoint x="10" y="0" /></bpmndi:BPMNEdge>`;

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
export const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
