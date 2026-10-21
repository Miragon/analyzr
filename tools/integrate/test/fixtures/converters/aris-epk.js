// converters/aris-epk.js: a synthetic example converter (test fixture of M6 S3c, see README.md).
// Every EPC (model type MT_EEPC) of an ARIS AML export becomes one analyzr-spec/1 model. Reading
// EPC elements as BPMN is an interpretation, so this converter runs with --derived reconstructed:
// a function is a task, a process interface a call of the process it names, an event a start
// (nothing leads to it), an end (nothing leaves it) or a plain intermediate event, an XOR, AND or
// OR rule an exclusive, parallel or inclusive gateway. Source ids come from the occurrences
// (ObjOcc), since one definition can occur twice in one model. Organizational units and their
// connections are dropped (element-dropped); other model types, and an EPC without functions,
// events or rules, are skipped. Names in German (LocaleId 1031), else the first language given;
// a styled value (StyledElement with PlainText TextValue, as ARIS may write AT_DESC) is read from
// its PlainText parts. Written for the fixture, never checked against a real ARIS export.
'use strict';

const LOCALE = '1031';
const RULES = {
  ST_OPR_XOR_1: 'exclusive',
  ST_OPR_AND_1: 'parallel',
  ST_OPR_OR_1: 'inclusive',
};

const kids = (el, local) => (el === null ? [] : el.children.filter((c) => c.local === local));
const kid = (el, local) => kids(el, local)[0] || null;
// an element's text with its children's, in document order; a PlainText part gives its TextValue
const allText = (el) =>
  el.local === 'PlainText' && typeof el.attrs.TextValue === 'string'
    ? el.attrs.TextValue
    : el.content.map((c) => (typeof c === 'number' ? allText(el.children[c]) : c)).join('');

/** The value of an attribute (AT_NAME, AT_DESC, …) in German, else in the first language given. */
function attr(el, type) {
  const def = kids(el, 'AttrDef').find((a) => a.attrs['AttrDef.Type'] === type);
  if (def === undefined) return null;
  const values = kids(def, 'AttrValue');
  const value = values.find((v) => v.attrs.LocaleId === LOCALE) || values[0];
  return value === undefined ? null : allText(value).replace(/\s+/g, ' ').trim() || null;
}

function guid(el) {
  const g = kid(el, 'GUID');
  return g === null ? null : g.text.trim();
}

function convertEpc(file, model, path, defs, helpers) {
  const name = attr(model, 'AT_NAME') || model.attrs['Model.ID'];
  const occs = kids(model, 'ObjOcc');
  const nodes = new Map();
  let dropped = 0;
  for (const occ of occs) {
    const def = defs.get(occ.attrs['ObjDef.IdRef']);
    const source = helpers.sourceId(occ.attrs['ObjOcc.ID']);
    if (def === undefined) {
      dropped++;
    } else if (def.type === 'OT_FUNC' && occ.attrs.SymbolNum === 'ST_PRCS_IF') {
      nodes.set(occ.attrs['ObjOcc.ID'], { source, type: 'call', target: def.name || 'Prozessschnittstelle' });
    } else if (def.type === 'OT_FUNC') {
      nodes.set(occ.attrs['ObjOcc.ID'], { source, type: 'task', ...(def.name ? { name: def.name } : {}) });
    } else if (def.type === 'OT_RULE' && RULES[occ.attrs.SymbolNum] !== undefined) {
      nodes.set(occ.attrs['ObjOcc.ID'], { source, type: 'gateway', kind: RULES[occ.attrs.SymbolNum] });
    } else if (def.type === 'OT_EVT') {
      nodes.set(occ.attrs['ObjOcc.ID'], { source, type: 'event', ...(def.name ? { name: def.name } : {}) });
    } else {
      dropped++;
    }
  }
  const flows = [];
  const incoming = new Map();
  const outgoing = new Map();
  for (const occ of occs) {
    for (const cxn of kids(occ, 'CxnOcc')) {
      const from = nodes.get(occ.attrs['ObjOcc.ID']);
      const to = nodes.get(cxn.attrs['ToObjOcc.IdRef']);
      if (from === undefined || to === undefined) {
        dropped++;
        continue;
      }
      flows.push({ from: from.source, to: to.source, source: helpers.sourceId(cxn.attrs['CxnOcc.ID']) });
      outgoing.set(from.source, (outgoing.get(from.source) || 0) + 1);
      incoming.set(to.source, (incoming.get(to.source) || 0) + 1);
    }
  }
  for (const node of nodes.values()) {
    if (node.type !== 'event') continue;
    if (!incoming.has(node.source)) node.type = 'start';
    else if (!outgoing.has(node.source)) node.type = 'end';
    else {
      node.direction = 'throw';
      node.trigger = 'none';
    }
  }
  if (nodes.size === 0) return null;
  const documentation = attr(model, 'AT_DESC');
  return {
    source: { externalId: guid(model), externalPath: [...path, name].join('/'), file: file.path },
    processes: [
      {
        source: helpers.sourceId(model.attrs['Model.ID']),
        name,
        ...(documentation === null ? {} : { documentation }),
        nodes: [...nodes.values()],
        flows,
      },
    ],
    losses: dropped === 0 ? [] : [{ code: 'element-dropped', count: dropped }],
  };
}

function convert(input, helpers) {
  const models = [];
  const skipped = [];
  let systemVersion = null;
  for (const file of input.files) {
    if (!/\.xml$/i.test(file.path) || file.zip !== null) {
      skipped.push({ path: file.path, reason: 'not an AML file' });
      continue;
    }
    const root = helpers.xml(helpers.text(file.path)).root;
    if (root.local !== 'AML') {
      skipped.push({ path: file.path, reason: 'not an AML file' });
      continue;
    }
    const header = kid(root, 'Header-Info');
    if (header !== null && header.attrs.ArisExeVersion) systemVersion = `ARIS ${header.attrs.ArisExeVersion}`;
    // definitions first (a model may use those of any group), then the models with their group path
    const defs = new Map();
    const found = [];
    const walk = (group, path) => {
      for (const def of kids(group, 'ObjDef')) {
        defs.set(def.attrs['ObjDef.ID'], { type: def.attrs.TypeNum, name: attr(def, 'AT_NAME') });
      }
      for (const model of kids(group, 'Model')) found.push({ model, path });
      for (const sub of kids(group, 'Group')) walk(sub, [...path, attr(sub, 'AT_NAME') || sub.attrs['Group.ID']]);
    };
    for (const top of kids(root, 'Group')) walk(top, []);
    for (const { model, path } of found) {
      if (model.attrs['Model.Type'] === 'MT_EEPC') {
        const epc = convertEpc(file, model, path, defs, helpers);
        if (epc === null) skipped.push({ path: file.path, reason: `EPC "${attr(model, 'AT_NAME')}" has no functions, events or rules` });
        else models.push(epc);
      } else {
        skipped.push({
          path: file.path,
          reason: `model "${attr(model, 'AT_NAME')}" (${model.attrs['Model.Type']}) is no EPC`,
        });
      }
    }
  }
  return { systemVersion, models, skipped };
}
