// The XML reader with offsets (src/xml.ts).
import { describe, expect, it } from 'vitest';

import {
  applyEdits,
  attribute,
  attributeNS,
  decodeReferences,
  descendants,
  escapeAttribute,
  ownText,
  parseXml,
  rootNamespaces,
  XmlSyntaxError,
} from '../src/xml.ts';

describe('parseXml', () => {
  it('reads elements, namespaces, attributes with offsets and text', () => {
    const text =
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- c -->\n<a:root xmlns:a="urn:a" xmlns="urn:d" id="r&amp;1"><child x=\'1\'>T&lt;1<![CDATA[<raw>]]></child><a:leaf/></a:root>\n';
    const doc = parseXml(text);
    expect(doc.declaration).toEqual({ version: '1.0', encoding: 'UTF-8' });
    expect(doc.elements).toBe(3);
    expect(doc.root).toMatchObject({ name: 'a:root', prefix: 'a', local: 'root', ns: 'urn:a' });
    const id = doc.root.attributes.find((a) => a.name === 'id');
    expect(id?.value).toBe('r&1');
    expect(text.slice(id?.valueStart, id?.valueEnd)).toBe('r&amp;1');
    const [child, leaf] = doc.root.children;
    expect(child).toMatchObject({ local: 'child', ns: 'urn:d' });
    expect(child && ownText(child)).toBe('T<1<raw>');
    expect(child?.texts.map((t) => t.cdata)).toEqual([false, true]);
    expect(leaf?.ns).toBe('urn:a');
    expect([...descendants(doc.root)].map((e) => e.local)).toEqual(['child', 'leaf']);
    expect(rootNamespaces(doc.root)).toEqual({ '': 'urn:d', a: 'urn:a' });
    expect(attribute(doc.root, 'id')).toBe('r&1');
  });

  it('resolves attribute namespaces (unprefixed attributes have none)', () => {
    const doc = parseXml('<r xmlns="urn:d" xmlns:x="urn:x" x:type="t" type="u"/>');
    expect(attributeNS(doc.root, 'urn:x', 'type')).toBe('t');
    expect(attributeNS(doc.root, null, 'type')).toBe('u');
  });

  it('stops after the root start tag with rootOnly', () => {
    const doc = parseXml('<r a="1"><x><y/></x></r>', { rootOnly: true });
    expect(doc.elements).toBe(1);
    expect(doc.root.children).toEqual([]);
  });

  it('refuses a DOCTYPE and unknown entities unless lenient', () => {
    const aml =
      '<?xml version="1.0"?><!DOCTYPE AML SYSTEM "ARIS-Export.dtd" [<!ENTITY x "y">]><AML>&x;</AML>';
    expect(() => parseXml(aml)).toThrow(/DOCTYPE/);
    const lenient = parseXml(aml, { lenient: true });
    expect(lenient.doctype).toBe(true);
    expect(lenient.root.name).toBe('AML');
    expect(ownText(lenient.root)).toBe('&x;');
    expect(() => parseXml('<a>&nbsp;</a>')).toThrow(/unknown entity/);
  });

  it('keeps unknown entities and a bare & undecoded with keepUnknownEntities, still refusing a DOCTYPE', () => {
    const doc = parseXml('<a b="x &nbsp; &amp y &amp; z">&nbsp;&lt;</a>', {
      keepUnknownEntities: true,
    });
    expect(doc.root.attributes[0]?.value).toBe('x &nbsp; &amp y & z');
    expect(ownText(doc.root)).toBe('&nbsp;<');
    expect(() =>
      parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a/>', { keepUnknownEntities: true }),
    ).toThrow(/DOCTYPE/);
    expect(() => parseXml('<p:a/>', { keepUnknownEntities: true })).toThrow(/undeclared/);
  });

  it.each([
    ['<a><b></a>', /does not match/],
    ['<a>', /unclosed/],
    ['<a/><b/>', /content after the root/],
    ['<a x=1/>', /not quoted/],
    ['<a x="1" x="2"/>', /repeated/],
    ['<p:a/>', /undeclared namespace prefix/],
    ['text', /no root element|outside the root/],
  ])('refuses malformed XML %s', (xml, message) => {
    expect(() => parseXml(xml)).toThrow(XmlSyntaxError);
    expect(() => parseXml(xml)).toThrow(message);
  });

  it('enforces maxElements', () => {
    expect(() => parseXml('<a><b/><c/></a>', { maxElements: 2 })).toThrow(/more than 2 elements/);
  });
});

describe('helpers', () => {
  it('decodes character references', () => {
    expect(decodeReferences('&#228;&#xFC;&quot;&apos;', 0)).toBe('äü"\'');
  });

  it('escapes attribute values', () => {
    expect(escapeAttribute('a<"&\n')).toBe('a&lt;&quot;&amp;&#10;');
  });

  it('applies non-overlapping edits and refuses overlaps', () => {
    expect(
      applyEdits('abcdef', [
        { start: 4, end: 5, text: 'X' },
        { start: 0, end: 1, text: 'YY' },
      ]),
    ).toBe('YYbcdXf');
    expect(() =>
      applyEdits('abcdef', [
        { start: 0, end: 3, text: '' },
        { start: 2, end: 4, text: '' },
      ]),
    ).toThrow(/overlapping/);
  });
});
