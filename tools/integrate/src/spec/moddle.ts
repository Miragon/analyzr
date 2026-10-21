/**
 * bpmn-moddle for the renderer (M6 S3c §3.3): one instance without the
 * camunda and zeebe descriptors, so a rendered model names no engine (its
 * `engine` in analyzr is `null`), used to write the model and to read it
 * back in the self-check. bpmn-moddle keeps the XSD's child order, which
 * bpmn-js and bpmn-facts read.
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- adds writing to the bpmn-facts declaration
/// <reference path="../bpmn-moddle.d.ts" />
import { BpmnModdle, type ModdleElement } from 'bpmn-moddle';

/** An element the renderer creates and fills. */
export type CreatedElement = ModdleElement & { set(name: string, value: unknown): void };

declare module 'bpmn-moddle' {
  interface BpmnModdle {
    create(type: string, attrs?: Readonly<Record<string, unknown>>): CreatedElement;
  }
}

let instance: BpmnModdle | undefined;

/** The renderer's bpmn-moddle (BPMN, DI and DC only). */
export function specModdle(): BpmnModdle {
  instance ??= new BpmnModdle();
  return instance;
}

/** A new element of `type` with the given properties (`undefined` ones left out). */
export function create(type: string, props: object = {}): CreatedElement {
  const attrs = Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined));
  return specModdle().create(type, attrs);
}
