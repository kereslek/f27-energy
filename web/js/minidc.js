/*
 * MiniDC: kis, saját sablon-értelmező a G3 térképhez.
 *
 * A sablon szintaxisa:
 *   {{ a.b.c }}                  pontozott útvonal (vagy true / false / szám literál)
 *   attr="{{ x }}"               nyers érték (null / false: az attribútum elmarad)
 *   attr="szöveg {{ x }} szöveg" szöveges összefűzés
 *   onClick="{{ f }}"            eseménykezelő (onPointerDown, onSubmit, ...)
 *   <sc-for list="{{ xs }}" as="x">   ismétlés ($index is elérhető)
 *   <sc-if value="{{ c }}">           feltételes rész
 *
 * A DOM-ot kulcsos összevetéssel frissíti: a sablon minden csomópontja egyedi
 * azonosítót kap, a ciklusokon belül az ismétlés sorszámával kiegészítve, így a
 * meglévő elemek (és például a beviteli mezők tartalma) megmaradnak.
 */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;
  var uid = 0;

  function textParts(str) {
    if (str.indexOf('{{') < 0) return null;
    var parts = [], last = 0, m;
    HOLE.lastIndex = 0;
    while ((m = HOLE.exec(str))) {
      if (m.index > last) parts.push(str.slice(last, m.index));
      parts.push({ p: m[1] });
      last = HOLE.lastIndex;
    }
    if (last < str.length) parts.push(str.slice(last));
    return parts;
  }

  function wholeHole(str) {
    var m = /^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/.exec(str || '');
    return m ? m[1] : null;
  }

  // JSX-szerű szóközkezelés: a sortörést tartalmazó, csak szóközből álló szöveg elmarad,
  // a többsoros szöveg sorai a széleiken levágva, szóközzel összefűzve maradnak.
  function cleanText(s) {
    if (s.indexOf('\n') < 0) return s;
    if (/^\s*$/.test(s)) return null;
    var lines = s.split('\n'), out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (i > 0) l = l.replace(/^\s+/, '');
      if (i < lines.length - 1) l = l.replace(/\s+$/, '');
      if (l) out.push(l);
    }
    return out.join(' ');
  }

  function compileKids(node) {
    var out = [];
    for (var n = node.firstChild; n; n = n.nextSibling) {
      var c = compile(n);
      if (c) out.push(c);
    }
    return out;
  }

  function compile(node) {
    if (node.nodeType === 3) {
      var s = cleanText(node.nodeValue);
      if (s === null || s === '') return null;
      var parts = textParts(s);
      return { t: 'text', id: ++uid, s: parts ? null : s, parts: parts };
    }
    if (node.nodeType !== 1) return null;
    var tag = node.localName;
    if (tag === 'sc-for') {
      return { t: 'for', id: ++uid, list: wholeHole(node.getAttribute('list')), as: node.getAttribute('as') || 'item', kids: compileKids(node) };
    }
    if (tag === 'sc-if') {
      return { t: 'if', id: ++uid, val: wholeHole(node.getAttribute('value')), kids: compileKids(node) };
    }
    var c = { t: 'el', id: ++uid, tag: tag, ns: node.namespaceURI, stat: [], dyn: [], ev: [], kids: compileKids(node) };
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i], name = a.name;
      if (name.indexOf('hint-') === 0) continue;
      var w = wholeHole(a.value);
      if (name.slice(0, 2) === 'on' && w !== null) { c.ev.push({ ev: name.slice(2).toLowerCase(), p: w }); continue; }
      if (w !== null) c.dyn.push({ n: name, p: w });
      else {
        var parts = textParts(a.value);
        if (parts) c.dyn.push({ n: name, parts: parts });
        else c.stat.push([name, a.value]);
      }
    }
    return c;
  }

  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var segs = path.split('.'), v;
    for (var s = scope; s; s = s.parent) {
      if (Object.prototype.hasOwnProperty.call(s.vars, segs[0])) { v = s.vars[segs[0]]; break; }
    }
    for (var i = 1; i < segs.length && v != null; i++) v = v[segs[i]];
    return v;
  }

  function interp(parts, scope) {
    var s = '';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (typeof p === 'string') s += p;
      else { var v = lookup(p.p, scope); if (v != null) s += v; }
    }
    return s;
  }

  // ---- virtuális fa -------------------------------------------------------------

  function renderKids(kids, scope, out, pre) {
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.t === 'text') out.push({ t: 3, k: pre + k.id, v: k.s !== null ? k.s : interp(k.parts, scope) });
      else if (k.t === 'el') out.push(renderEl(k, scope, pre));
      else if (k.t === 'if') { if (lookup(k.val, scope)) renderKids(k.kids, scope, out, pre); }
      else if (k.t === 'for') {
        var list = lookup(k.list, scope) || [];
        for (var j = 0; j < list.length; j++) {
          var vars = { $index: j };
          vars[k.as] = list[j];
          renderKids(k.kids, { vars: vars, parent: scope }, out, pre + k.id + ':' + j + '/');
        }
      }
    }
    return out;
  }

  function renderEl(k, scope, pre) {
    var a = {}, e = {}, i;
    for (i = 0; i < k.stat.length; i++) a[k.stat[i][0]] = k.stat[i][1];
    for (i = 0; i < k.dyn.length; i++) {
      var d = k.dyn[i];
      if (d.parts) { a[d.n] = interp(d.parts, scope); continue; }
      var v = lookup(d.p, scope);
      if (v == null || v === false) continue;
      a[d.n] = v === true ? '' : String(v);
    }
    for (i = 0; i < k.ev.length; i++) {
      var f = lookup(k.ev[i].p, scope);
      if (typeof f === 'function') e[k.ev[i].ev] = f;
    }
    return { t: 1, k: pre + k.id, tag: k.tag, ns: k.ns, a: a, e: e, c: renderKids(k.kids, scope, [], pre) };
  }

  // ---- valódi DOM frissítése ------------------------------------------------------

  function dispatch(ev) {
    var f = this.__h && this.__h[ev.type];
    if (f) f(ev);
  }

  function patchAttrs(el, v) {
    var old = el.__a, nw = v.a, n;
    for (n in old) if (!(n in nw)) el.removeAttribute(n);
    for (n in nw) if (old[n] !== nw[n]) el.setAttribute(n, nw[n]);
    el.__a = nw;
    for (n in v.e) {
      if (!el.__hl[n]) { el.addEventListener(n, dispatch); el.__hl[n] = true; }
    }
    el.__h = v.e;
  }

  function create(v) {
    var n;
    if (v.t === 3) { n = document.createTextNode(v.v); n.__k = v.k; n.__v = v.v; return n; }
    n = v.ns === SVG_NS ? document.createElementNS(SVG_NS, v.tag) : document.createElement(v.tag);
    n.__k = v.k; n.__tag = v.tag; n.__a = {}; n.__h = {}; n.__hl = {};
    patchAttrs(n, v);
    patchKids(n, v.c);
    return n;
  }

  function patchKids(parent, kids) {
    var old = {}, n;
    for (n = parent.firstChild; n; n = n.nextSibling) if (n.__k) old[n.__k] = n;
    var ref = parent.firstChild;
    while (ref && !ref.__k) ref = ref.nextSibling;
    for (var i = 0; i < kids.length; i++) {
      var v = kids[i];
      n = old[v.k];
      if (n && (v.t === 3 ? n.nodeType === 3 : n.__tag === v.tag)) {
        delete old[v.k];
        if (v.t === 3) { if (n.__v !== v.v) { n.nodeValue = v.v; n.__v = v.v; } }
        else { patchAttrs(n, v); patchKids(n, v.c); }
      } else {
        n = create(v);
      }
      if (n === ref) { ref = ref.nextSibling; while (ref && !ref.__k) ref = ref.nextSibling; }
      else parent.insertBefore(n, ref);
    }
    for (var k in old) if (old[k].parentNode === parent) parent.removeChild(old[k]);
  }

  // ---- komponens ------------------------------------------------------------------

  class Component {
    constructor(props) { this.props = props || {}; this.state = {}; this._root = null; this._raf = 0; }
    setState(patch) {
      var p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
      this.state = Object.assign({}, this.state, p);
      this.scheduleRender();
    }
    setProps(patch) { this.props = Object.assign({}, this.props, patch); this.scheduleRender(); }
    forceUpdate() { this.scheduleRender(); }
    scheduleRender() {
      if (!this._root || this._raf) return;
      var self = this;
      this._raf = requestAnimationFrame(function () { self._raf = 0; self.renderNow(); });
    }
    renderNow() {
      if (!this._root) return;
      var vals = this.renderVals();
      patchKids(this._root.container, renderKids(this._root.tpl, { vars: vals, parent: null }, [], ''));
      if (this.didRender) this.didRender();
    }
    renderVals() { return {}; }
  }

  function mount(container, templateEl, component) {
    var tpl = compileKids(templateEl.content || templateEl);
    component._root = { container: container, tpl: tpl };
    component.renderNow();
    return component;
  }

  global.MiniDC = { Component: Component, mount: mount };
})(window);
