// The parts of bpmn-moddle that tools/integrate uses beyond the declaration of
// @analyzr/bpmn-facts (referenced here, so both live in one program and merge):
// writing, the effective type descriptors and the registered packages.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- see above
/// <reference path="../../../packages/bpmn-facts/src/bpmn-moddle.d.ts" />
declare module 'bpmn-moddle' {
  interface PropertyDescriptor {
    /** Qualified name, e.g. `bpmn:sourceRef`. */
    readonly name: string;
    readonly ns: { readonly name: string; readonly prefix: string; readonly localName: string };
    /** Qualified type name or a built-in (`String`, `Boolean`, `Element`, …). */
    readonly type: string;
    readonly isAttr?: boolean;
    readonly isReference?: boolean;
    readonly isMany?: boolean;
    readonly isVirtual?: boolean;
  }

  interface EffectiveDescriptor {
    readonly name: string;
    readonly properties: readonly PropertyDescriptor[];
    /** By local and by qualified name. */
    readonly propertiesByName: Readonly<Record<string, PropertyDescriptor | undefined>>;
    readonly idProperty?: PropertyDescriptor;
    /** Every type this one is (itself and its supertypes), by qualified name. */
    readonly allTypesByName: Readonly<Record<string, unknown>>;
  }

  interface ModdlePackage {
    readonly prefix: string;
    readonly uri: string;
    readonly xml?: { readonly tagAlias?: string; readonly typePrefix?: string };
  }

  interface BpmnModdle {
    toXML(element: ModdleElement, options?: { format?: boolean }): Promise<{ xml: string }>;
    getType(name: string): { readonly $descriptor: EffectiveDescriptor };
    getPackage(uriOrPrefix: string): ModdlePackage | undefined;
    getPackages(): readonly ModdlePackage[];
    readonly registry: { readonly typeMap: Readonly<Record<string, unknown>> };
  }
}
