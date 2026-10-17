// The positioned element scan behind model amendments (M6 §4.8 c): offsets,
// namespace scopes, indentation, and markup it refuses to read.
import { describe, expect, it } from 'vitest';

import { BpmnInputError } from '../src/index.ts';
import { scanElements } from '../src/xml-elements.ts';
import type { XmlDocument, XmlElement } from '../src/xml-elements.ts';

function byName(doc: XmlDocument, name: string): XmlElement {
  const el = doc.elements.find((e) => e.name === name);
  if (el === undefined) throw new Error(`no <${name}>`);
  return el;
}

describe('scanElements', () => {
  it('records the offsets of start tags, attributes and ends', () => {
    const text =
      '<?xml version="1.0"?>\n<!-- <fake/> -->\n<r a="1 > 2" b=\'x\'>\n  <c id="C"/>\n  <d><![CDATA[<e/>]]></d>\n</r>\n';
    const doc = scanElements(text);
    expect(doc.elements.map((e) => e.name)).toEqual(['r', 'c', 'd']);
    const r = byName(doc, 'r');
    expect(text.slice(r.start, r.startTagEnd)).toBe('<r a="1 > 2" b=\'x\'>');
    expect(text.slice(r.start, r.attrsEnd)).toBe('<r a="1 > 2" b=\'x\'');
    expect(text.slice(r.closeStart, r.end)).toBe('</r>');
    expect(r.attributes.map((a) => [a.name, a.value, a.quote])).toEqual([
      ['a', '1 > 2', '"'],
      ['b', 'x', "'"],
    ]);
    const [a] = r.attributes;
    expect(a && text.slice(a.valueStart, a.valueEnd)).toBe('1 > 2');
    const c = byName(doc, 'c');
    expect(c.selfClosing).toBe(true);
    expect(text.slice(c.start, c.end)).toBe('<c id="C"/>');
    expect(doc.byId.get('C')).toEqual([c.index]);
    expect(r.children).toEqual([c.index, byName(doc, 'd').index]);
  });

  it('resolves namespaces per scope and flags a prefix rebound to another URI', () => {
    const doc = scanElements(
      '<a:r xmlns:a="urn:a" xmlns="urn:d"><x a:k="v"/><a:y xmlns:a="urn:a"><z xmlns="urn:e" xmlns:a="urn:b"/></a:y><w/></a:r>',
    );
    expect(doc.elements.map((e) => [e.name, e.ns, e.rebinds])).toEqual([
      ['a:r', 'urn:a', false],
      ['x', 'urn:d', false],
      ['a:y', 'urn:a', false],
      ['z', 'urn:e', true],
      ['w', 'urn:d', false],
    ]);
    expect(byName(doc, 'x').attributes[0]).toMatchObject({ ns: 'urn:a', local: 'k' });
  });

  it('reads line indentation and the line break before it', () => {
    const doc = scanElements('<r>\r\n\t<a/>\r\n    <b/> <c/>\n  <d/></r>');
    expect(doc.newline).toBe('\r\n');
    expect(doc.elements.map((e) => [e.name, e.indent, e.nl])).toEqual([
      ['r', '', '\r\n'],
      ['a', '\t', '\r\n'],
      ['b', '    ', '\r\n'],
      ['c', null, '\r\n'],
      ['d', '  ', '\n'],
    ]);
  });

  it('refuses markup it cannot read', () => {
    for (const text of [
      '<r><a></b></r>',
      '<r a="1" a="2"/>',
      '<r/><s/>',
      '<r><a>',
      '<r a=1/>',
      '<r><!ELEMENT x ANY></r>',
    ]) {
      expect(() => scanElements(text), text).toThrow(BpmnInputError);
    }
  });

  it('scans deep nesting without recursion', () => {
    const depth = 100_000;
    const doc = scanElements(`${'<a>'.repeat(depth)}${'</a>'.repeat(depth)}`);
    expect(doc.elements).toHaveLength(depth);
    expect(doc.elements[depth - 1]?.parent).toBe(depth - 2);
  });
});
