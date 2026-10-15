/**
 * bpmn-moddle access for normalize-bpmn, as `packages/bpmn-facts/src/moddle.ts`
 * reads BPMN: one cached moddle per extension, camunda (C7) or zeebe (C8),
 * chosen as `extractFacts` chooses it, so the warnings normalize-bpmn reports
 * are the `parse-warning`s analyzr's extractor will report. Plus a resolver
 * that maps the elements of `xml.ts` to moddle types the way moddle-xml does,
 * so ids and references can be rewritten before bpmn-moddle reads the file.
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- adds writing and descriptors to the bpmn-facts declaration
/// <reference path="./bpmn-moddle.d.ts" />
import { BpmnModdle } from 'bpmn-moddle';
import type {
  EffectiveDescriptor,
  ModdlePackage,
  ParseResult,
  PropertyDescriptor,
} from 'bpmn-moddle';
import camunda from 'camunda-bpmn-moddle/resources/camunda.json' with { type: 'json' };
import zeebe from 'zeebe-bpmn-moddle/resources/zeebe.json' with { type: 'json' };

import { attribute, attributeNS, type XmlElement } from './xml.ts';

export type { ModdleElement, ParseWarning } from 'bpmn-moddle';

export type ModdleExtension = 'camunda' | 'zeebe';

const CAMUNDA_NS = 'http://camunda.org/schema/1.0/bpmn';
const ZEEBE_NS = 'http://camunda.org/schema/zeebe/1.0';
const MODELER_NS = 'http://camunda.org/schema/modeler/1.0';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';

/**
 * The extension `extractFacts` loads for this root (`detectEngine` in
 * `packages/bpmn-facts/src/extract.ts`): zeebe for Camunda 8 or a zeebe-only
 * namespace, camunda otherwise.
 */
export function extensionOf(root: XmlElement): ModdleExtension {
  const platform = attributeNS(root, MODELER_NS, 'executionPlatform');
  const uris = new Set(
    root.attributes
      .filter((a) => a.name === 'xmlns' || a.name.startsWith('xmlns:'))
      .map((a) => a.value),
  );
  const hasCamunda = uris.has(CAMUNDA_NS);
  const hasZeebe = uris.has(ZEEBE_NS);
  let engine: 'c7' | 'c8' | null =
    platform === 'Camunda Platform' ? 'c7' : platform === 'Camunda Cloud' ? 'c8' : null;
  if (engine === null && hasCamunda !== hasZeebe) engine = hasZeebe ? 'c8' : 'c7';
  return engine === 'c8' || (engine === null && hasZeebe) ? 'zeebe' : 'camunda';
}

const moddles = new Map<ModdleExtension, BpmnModdle>();

export function moddleFor(extension: ModdleExtension): BpmnModdle {
  let moddle = moddles.get(extension);
  if (!moddle) {
    moddle = new BpmnModdle(extension === 'camunda' ? { camunda } : { zeebe });
    moddles.set(extension, moddle);
  }
  return moddle;
}

/** Parses BPMN 2.0 XML laxly: unknown or broken content becomes warnings. */
export function parseBpmn(xml: string, extension: ModdleExtension): Promise<ParseResult> {
  return moddleFor(extension).fromXML(xml);
}

/** Writes a parsed document back, indented unless `format` is false. */
export async function writeBpmn(
  result: ParseResult,
  extension: ModdleExtension,
  options: { format: boolean } = { format: true },
): Promise<string> {
  if (!result.rootElement) throw new Error('nothing to write: the document has no root element');
  const { xml } = await moddleFor(extension).toXML(result.rootElement, { format: options.format });
  return xml;
}

/** How an element of the document maps onto the model. */
export type Resolved =
  /** An element of moddle type `type` (`null`: unknown or generic, e.g. a foreign extension). */
  | { kind: 'element'; type: string | null }
  /** A child whose text is a reference (`<bpmn:incoming>Flow_1</bpmn:incoming>`). */
  | { kind: 'reference'; property: string; many: boolean };

/** Resolves elements to moddle types, as moddle-xml's `ElementHandler.getPropertyForNode` does. */
export class TypeResolver {
  readonly moddle: BpmnModdle;
  private readonly descriptors = new Map<string, EffectiveDescriptor | null>();

  constructor(moddle: BpmnModdle) {
    this.moddle = moddle;
  }

  /** The effective descriptor of a qualified type name, `null` if moddle does not know it. */
  descriptor(type: string | null): EffectiveDescriptor | null {
    if (type === null) return null;
    let d = this.descriptors.get(type);
    if (d === undefined) {
      d = Object.hasOwn(this.moddle.registry.typeMap, type)
        ? this.moddle.getType(type).$descriptor
        : null;
      this.descriptors.set(type, d);
    }
    return d;
  }

  /** True if `type` is `of` or a subtype of it. */
  isA(type: string | null, of: string): boolean {
    const d = this.descriptor(type);
    return d !== null && Object.hasOwn(d.allTypesByName, of);
  }

  private packageOf(el: XmlElement): ModdlePackage | null {
    return el.ns === null ? null : (this.moddle.getPackage(el.ns) ?? null);
  }

  /** The type an element name stands for in its package (`bpmn:task` → `bpmn:Task`). */
  private typeByName(pkg: ModdlePackage, local: string): string | null {
    const name =
      pkg.xml?.tagAlias === 'lowerCase' ? local.charAt(0).toUpperCase() + local.slice(1) : local;
    const type = `${pkg.prefix}:${name}`;
    return this.descriptor(type) === null ? null : type;
  }

  /** The type an `xsi:type` attribute names, if any and known. */
  private xsiType(el: XmlElement): string | null {
    const value = attributeNS(el, XSI_NS, 'type');
    if (value === undefined) return null;
    const colon = value.indexOf(':');
    const prefix = colon < 0 ? '' : value.slice(0, colon);
    let local = colon < 0 ? value : value.slice(colon + 1);
    const uri = el.scope.get(prefix);
    const pkg = uri === undefined ? null : (this.moddle.getPackage(uri) ?? null);
    if (pkg === null) return null;
    const typePrefix = pkg.xml?.typePrefix;
    if (typePrefix !== undefined && local.startsWith(typePrefix)) {
      local = local.slice(typePrefix.length);
    }
    const type = `${pkg.prefix}:${local}`;
    return this.descriptor(type) === null ? null : type;
  }

  /** The root element's type (`bpmn:Definitions` for BPMN). */
  root(el: XmlElement): string | null {
    const pkg = this.packageOf(el);
    return pkg === null ? null : this.typeByName(pkg, el.local);
  }

  /** How `el`, a child of an element of type `parentType`, maps onto the model. */
  child(parentType: string | null, el: XmlElement): Resolved {
    const parent = this.descriptor(parentType);
    const pkg = this.packageOf(el);
    if (parent === null || pkg === null) return { kind: 'element', type: null };
    const property: PropertyDescriptor | undefined =
      parent.propertiesByName[`${pkg.prefix}:${el.local}`];
    if (property !== undefined && property.isAttr !== true) {
      if (property.isReference === true) {
        return {
          kind: 'reference',
          property: property.ns.localName,
          many: property.isMany === true,
        };
      }
      const declared = this.descriptor(property.type) === null ? null : property.type;
      return { kind: 'element', type: this.xsiType(el) ?? declared };
    }
    return { kind: 'element', type: this.xsiType(el) ?? this.typeByName(pkg, el.local) };
  }

  /**
   * The reference property an attribute of an element of `type` stands for
   * (`sourceRef`, `bpmnElement`, …), or `null`.
   */
  attributeReference(type: string | null, attrName: string): PropertyDescriptor | null {
    const d = this.descriptor(type);
    if (d === null || attrName.includes(':')) return null;
    const p = d.propertiesByName[attrName];
    return p !== undefined && p.isAttr === true && p.isReference === true ? p : null;
  }

  /** True if elements of `type` carry a moddle id (`idProperty`). */
  hasId(type: string | null): boolean {
    return this.descriptor(type)?.idProperty !== undefined;
  }
}

/** The moddle id attribute value of an element of a type with an id property. */
export function idOf(el: XmlElement): string | undefined {
  return attribute(el, 'id');
}
