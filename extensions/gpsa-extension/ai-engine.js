// ai-engine.js - the "workshop" of elapsAI: workspace datasets, read-only GraphQL guard, data queries, GIMIS reports,
// API discovery, code sandbox host and file/chart creation. Tools below are called by ai-core.js (function calling).
(function (root) {
  'use strict';
  const F = root.GpsaFiles;
  const lc = (s) => String(s == null ? '' : s).toLowerCase();
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const round2 = (n) => Math.round(n * 100) / 100;

  // ================= read-only GraphQL guard =================
  function stripGql(q) {
    let o = '', i = 0;
    while (i < q.length) { const c = q[i];
      if (c === '#') { while (i < q.length && q[i] !== '\n') i++; continue; }
      if (q.startsWith('"""', i)) { const e = q.indexOf('"""', i + 3); i = e < 0 ? q.length : e + 3; o += '""'; continue; }
      if (c === '"') { i++; while (i < q.length && q[i] !== '"') { if (q[i] === '\\') i++; i++; } i++; o += '""'; continue; }
      o += c; i++; }
    return o;
  }
  // Fields whose names say "change something" are refused (GIMIS even has a query that renews tokens), and mutations are never allowed.
  const DENY = /^(regenerate|re[A-Z]\w*|issue|save|create|update|delete|remove|approve|reject|submit|cancel|reset|send|assign|revoke|activate|deactivate|pay|bill|post|add|set|change|confirm|receive|dispatch|upload|insert|edit|modify|publish|register|renew|resend|lock|unlock|block|unblock|import|clone|copy|move|transfer|close|open|finali[sz]e|complete|sign|verify|process|execute|run|trigger|notify|email|sms|login|logout|authenticate|generate|make|do|apply|merge|split|attach|detach|link|unlink|cleanup|purge|clear|sync)(?![a-z])/;
  // Read-only queries whose names start with a changing verb ("issue...") - verified from their arguments (only paging/dates) and listed on purpose.
  const ALLOW_READ = new Set(['issueNoteItemsInShopPageable', 'issueNoteTokensUsed']);
  function guardQuery(query) {
    const q = String(query || ''); if (!q.trim()) return { ok: false, reason: 'Query ni tupu.' }; if (q.length > 20000) return { ok: false, reason: 'Query ni ndefu sana.' };
    const s = stripGql(q), tk = []; const re = /\.\.\.|[A-Za-z_]\w*|[{}()\[\]:@$=!,]/g; let m; while ((m = re.exec(s))) tk.push(m[0]);
    let d = 0, p = 0, b = 0, inFrag = false, ops = 0; const roots = [];
    for (let i = 0; i < tk.length; i++) {
      const t = tk[i], prev = tk[i - 1], next = tk[i + 1];
      if (t === '(') p++; else if (t === ')') p--; else if (t === '[') b++; else if (t === ']') b--;
      else if (t === '{' && p === 0 && b === 0) { if (d === 0 && !inFrag) ops++; d++; }
      else if (t === '}' && p === 0 && b === 0) { d--; if (d === 0) inFrag = false; }
      else if (/^[A-Za-z_]/.test(t) && p === 0 && b === 0) {
        if (d === 0) { if (t === 'mutation' || t === 'subscription') return { ok: false, reason: 'Mutation/subscription haziruhusiwi - AI inasoma tu (read-only).' }; if (t === 'fragment') inFrag = true; }
        else if (d === 1 && !inFrag) { if (prev === '@' || prev === '...' || prev === 'on' || prev === '$') continue; if (next === ':') continue; roots.push(t); }
      }
    }
    if (d !== 0 || p !== 0 || b !== 0) return { ok: false, reason: 'Query haijakamilika (mabano hayalingani).' };
    if (ops !== 1) return { ok: false, reason: 'Tumia operesheni moja tu ya query kwa kila ombi.' };
    if (!roots.length) return { ok: false, reason: 'Query haina field yoyote ya juu.' };
    const bad = roots.find((r) => !/^__/.test(r) && !ALLOW_READ.has(r) && DENY.test(r)); if (bad) return { ok: false, reason: 'Field "' + bad + '" inaonekana kubadilisha data (si ya kusoma tu), kwa hiyo imekataliwa.' };
    return { ok: true, roots };
  }

  // ================= privacy: e-mail, phone, national id, passwords never reach the AI =================
  const PII_KEY = /email|phone|mobile|msisdn|password|passwd|secret|authoriz|nida|accesstoken|refreshtoken/i;
  function redact(v, d) {
    d = d || 0; if (v == null || d > 12) return v;
    if (Array.isArray(v)) { v.forEach((x) => redact(x, d + 1)); return v; }
    if (typeof v === 'object') { Object.keys(v).forEach((k) => { if (PII_KEY.test(k)) { if (v[k] != null && v[k] !== '') v[k] = '[hidden]'; } else redact(v[k], d + 1); }); }
    return v;
  }
  const dropPiiColumns = (rows) => { (rows || []).forEach((r) => { Object.keys(r).forEach((k) => { if (PII_KEY.test(k)) delete r[k]; }); }); return rows; };

  // ================= tabular helpers =================
  function getPath(o, path) { return String(path || '').split('.').filter(Boolean).reduce((a, k) => a == null ? a : a[k], o); }
  function flat(o, pre, out, depth) {
    Object.keys(o).forEach((k) => { const v = o[k], key = pre ? pre + '.' + k : k;
      if (v == null) return; if (Array.isArray(v)) { if (!v.length) return; if (v.every((x) => x == null || typeof x !== 'object')) out[key] = v.join(', '); else out[key + '.count'] = v.length, out[key + '.json'] = JSON.stringify(v).slice(0, 300); }
      else if (typeof v === 'object') { if (depth < 5) flat(v, key, out, depth + 1); } else out[key] = v; });
    return out;
  }
  const flattenRows = (rows) => rows.map((r) => isObj(r) ? flat(r, '', {}, 0) : { value: r });
  function explodeFlat(rows, path) {
    const parts = String(path).split('.'), last = parts[parts.length - 1], out = [];
    rows.forEach((r) => { const arr = getPath(r, path), base = JSON.parse(JSON.stringify(r)); let cur = base; for (let i = 0; i < parts.length - 1 && cur; i++) cur = cur[parts[i]]; if (cur) delete cur[last];
      const fb = flat(base, '', {}, 0);
      if (Array.isArray(arr) && arr.length) arr.forEach((x) => { const o = Object.assign({}, fb); if (isObj(x)) { const fx = flat(x, '', {}, 0); Object.keys(fx).forEach((k) => { o[last + '.' + k] = fx[k]; }); } else o[last] = x; out.push(o); }); else out.push(fb); });
    return out;
  }
  function findRecords(data, path) {
    if (path) { const v = getPath(data, path); if (Array.isArray(v)) return { path, rows: v }; if (isObj(v)) return { path, rows: [v] }; return { path, rows: [], missing: true }; }
    let best = null; (function walk(v, p, d) { if (d > 5 || v == null) return; if (Array.isArray(v)) { if (v.length && v.every(isObj) && (!best || v.length > best.rows.length)) best = { path: p, rows: v }; return; } if (isObj(v)) Object.keys(v).forEach((k) => walk(v[k], p ? p + '.' + k : k, d + 1)); })(data, '', 0);
    return best || { path: '', rows: [] };
  }
  function columnsOf(rows) { const seen = {}; rows.slice(0, 300).forEach((r) => Object.keys(r).forEach((k) => { seen[k] = 1; })); return Object.keys(seen); }
  const numOf = (v) => { const n = F.toNum(v); return n; };
  function typeOf(vals) {
    const v = vals.filter((x) => x != null && x !== ''); if (!v.length) return 'empty';
    if (v.every((x) => typeof x === 'number')) return 'number'; if (v.every((x) => typeof x === 'boolean')) return 'bool';
    if (v.every((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x))) return 'date'; if (v.every((x) => !isNaN(numOf(x)))) return 'number-text'; return 'text';
  }
  const cut = (v, n) => { if (typeof v !== 'string') return v; return v.length > (n || 60) ? v.slice(0, n || 60) + '\u2026' : v; };
  function profile(name, rows, nSample) {
    const cols = columnsOf(rows).slice(0, 80), info = cols.map((c) => { const vals = rows.map((r) => r[c]), t = typeOf(vals.slice(0, 2000)), o = { name: c, type: t, filled: vals.filter((x) => x != null && x !== '').length };
      if (t === 'number') { let s = 0, mn = Infinity, mx = -Infinity; vals.forEach((x) => { if (typeof x === 'number') { s += x; if (x < mn) mn = x; if (x > mx) mx = x; } }); o.sum = round2(s); o.min = mn; o.max = mx; }
      else if (t === 'date') { const ds = vals.filter(Boolean).map(String).sort(); o.min = ds[0]; o.max = ds[ds.length - 1]; }
      else if (t === 'text') { const u = {}; vals.slice(0, 3000).forEach((x) => { if (x != null && x !== '') u[x] = (u[x] || 0) + 1; }); const ks = Object.keys(u); o.distinct = ks.length; o.top = ks.sort((a, b) => u[b] - u[a]).slice(0, 4).map((k) => cut(k, 30)); }
      return o; });
    return { dataset: name, rows: rows.length, columns: info, sample: rows.slice(0, nSample == null ? 4 : nSample).map((r) => { const o = {}; cols.slice(0, 25).forEach((c) => { if (r[c] != null) o[c] = cut(r[c]); }); return o; }) };
  }

  // ================= dataset query (a tiny SQL) =================
  function resolveCol(cols, name) {
    const n = String(name || ''); if (cols.includes(n)) return n; const l = lc(n), a = cols.find((c) => lc(c) === l); if (a) return a;
    const norm = (s) => lc(s).replace(/[^a-z0-9]/g, ''), b = cols.find((c) => norm(c) === norm(n)); if (b) return b;
    const c = cols.find((x) => norm(x).includes(norm(n)) && norm(n).length > 2); if (c) return c;
    throw new Error('Safu "' + n + '" haipo. Safu zilizopo: ' + cols.slice(0, 40).join(' | '));
  }
  function bucket(v, how) { if (v == null) return '(tupu)'; let s = typeof v === 'number' && v > 1e11 ? new Date(v + 3 * 3600e3).toISOString() : String(v); const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (!m) return s;
    if (how === 'year') return m[1]; if (how === 'month') return m[1] + '-' + m[2]; if (how === 'day') return m[1] + '-' + m[2] + '-' + m[3];
    if (how === 'week') { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); } return s; }
  function cmp(v, op, x) {
    const nv = numOf(v), nx = numOf(x), bothNum = !isNaN(nv) && !isNaN(nx) && v !== '' && v != null;
    const sv = lc(v), sx = lc(x);
    switch (op) {
      case '=': case '==': case 'eq': return bothNum ? nv === nx : sv === sx; case '!=': case 'ne': return bothNum ? nv !== nx : sv !== sx;
      case '>': return bothNum ? nv > nx : sv > sx; case '>=': return bothNum ? nv >= nx : sv >= sx; case '<': return bothNum ? nv < nx : (v != null && sv < sx); case '<=': return bothNum ? nv <= nx : (v != null && sv <= sx);
      case 'contains': return sv.includes(sx); case 'not_contains': return !sv.includes(sx); case 'startswith': return sv.startsWith(sx); case 'endswith': return sv.endsWith(sx);
      case 'in': { const L = Array.isArray(x) ? x : String(x).split(','); return L.some((y) => cmp(v, '=', String(y).trim())); }
      case 'not_in': { const L = Array.isArray(x) ? x : String(x).split(','); return !L.some((y) => cmp(v, '=', String(y).trim())); }
      case 'between': { const L = Array.isArray(x) ? x : String(x).split(','); return cmp(v, '>=', L[0]) && cmp(v, '<=', L[1]); }
      case 'isnull': return v == null || v === ''; case 'notnull': return !(v == null || v === '');
      default: throw new Error('Operesheni "' + op + '" haijulikani. Tumia: = != > >= < <= contains startswith endswith in between isnull notnull');
    }
  }
  function queryDataset(rows, spec) {
    spec = spec || {}; const cols = columnsOf(rows); let r = rows;
    (spec.where || []).forEach((w) => { const c = resolveCol(cols, w.col); r = r.filter((x) => cmp(x[c], String(w.op || '=').toLowerCase(), w.value)); });
    const gb = (spec.group_by || []).map((g) => { const [c, how] = String(g).split(':'); return { col: resolveCol(cols, c), how, key: String(g) }; });
    const aggs = (spec.aggs || []).map((a) => ({ col: a.col === '*' || !a.col ? '*' : resolveCol(cols, a.col), fn: lc(a.fn || 'sum'), as: a.as }));
    let out;
    if (gb.length || aggs.length) {
      const groups = new Map();
      r.forEach((x) => { const key = gb.map((g) => g.how ? bucket(x[g.col], g.how) : (x[g.col] == null || x[g.col] === '' ? '(tupu)' : x[g.col])); const k = JSON.stringify(key); let g = groups.get(k); if (!g) { g = { key, rows: [] }; groups.set(k, g); } g.rows.push(x); });
      const doAgg = [].concat(aggs.length ? aggs : [{ col: '*', fn: 'count' }]);
      out = [...groups.values()].map((g) => { const o = {}; gb.forEach((c, i) => { o[c.key.replace(':', ' ')] = g.key[i]; });
        doAgg.forEach((a) => { const name = a.as || (a.col === '*' ? a.fn : a.fn + '_' + a.col), vals = a.col === '*' ? g.rows : g.rows.map((x) => x[a.col]); let v;
          if (a.fn === 'count') v = a.col === '*' ? g.rows.length : vals.filter((x) => x != null && x !== '').length; else if (a.fn === 'count_distinct') v = new Set(vals.filter((x) => x != null && x !== '')).size;
          else { const ns = vals.map(numOf).filter((n) => !isNaN(n)); v = !ns.length ? null : a.fn === 'sum' ? round2(ns.reduce((p, q) => p + q, 0)) : a.fn === 'avg' ? round2(ns.reduce((p, q) => p + q, 0) / ns.length) : a.fn === 'min' ? Math.min(...ns) : a.fn === 'max' ? Math.max(...ns) : (() => { throw new Error('Kazi "' + a.fn + '" haijulikani (sum, avg, min, max, count, count_distinct).'); })(); }
          o[name] = v; }); return o; });
      if (gb.length && gb.some((g) => g.how)) out.sort((a, b) => { const k = gb[0].key.replace(':', ' '); return a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0; });
    } else out = r.map((x) => Object.assign({}, x));
    if (spec.select && spec.select.length && !gb.length && !aggs.length) { const sc = spec.select.map((s) => resolveCol(cols, s)); out = out.map((x) => { const o = {}; sc.forEach((c) => { o[c] = x[c]; }); return o; }); }
    if (spec.distinct) { const seen = new Set(); out = out.filter((x) => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; }); }
    const oc = columnsOf(out);
    (spec.order_by || []).slice().reverse().forEach((o) => { let c; try { c = resolveCol(oc, o.col); } catch (e) { c = resolveCol(oc, String(o.col).replace(':', ' ')); } const dir = lc(o.dir) === 'desc' ? -1 : 1; out.sort((a, b) => { const x = a[c], y = b[c], nx = numOf(x), ny = numOf(y); if (!isNaN(nx) && !isNaN(ny) && x !== '' && y !== '') return (nx - ny) * dir; return (x == null ? '' : String(x)).localeCompare(y == null ? '' : String(y)) * dir; }); });
    const total = out.length; if (spec.limit) out = out.slice(0, Math.max(1, Number(spec.limit))); return { rows: out, total };
  }
  function monthsBetween(start, end) { const out = []; let y = +start.slice(0, 4), m = +start.slice(5, 7); const ey = +end.slice(0, 4), em = +end.slice(5, 7), p = (n) => String(n).padStart(2, '0');
    while (y < ey || (y === ey && m <= em)) { const last = new Date(Date.UTC(y, m, 0)).getUTCDate(), s = y + '-' + p(m) + '-01', e = y + '-' + p(m) + '-' + p(last); out.push([s < start ? start : s, e > end ? end : e]); if (++m > 12) { m = 1; y++; } if (out.length > 60) break; } return out; }
  const b64 = (s) => { if (typeof atob === 'function') { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } return new Uint8Array(Buffer.from(s, 'base64')); };

  const STATION = { shop: 'd999e7cc-9eef-4629-a904-9cd689c74f3f', area: '81deacc1-5bd3-4966-82e7-734d8548c208' };
  const BINCARD_Q = `query binCardItemTransactionsMyShopByItemId($pageableParam: PageableParamInput, $transactionStatus: ItemTransactionStatus, $endDate: String, $startDate: String, $itemId: Long) {
    binCardItemTransactionsMyShopByItemId(pageableParam:$pageableParam transactionStatus:$transactionStatus endDate:$endDate startDate:$startDate itemId:$itemId) {
      content { id createdAt updatedAt binCard { id } dispatchNote { dtcv { referenceNumber } } item { itemCode itemName } quantity currentStock transactionStatus unitBuyPrice unitSalePrice receiptVoucher { invoiceNo receiptVoucherNo } issueNoteItem { requisitionRequest { trackingNumber } } }
      totalElements totalPages size number } }`;
  const EXPORT_Q = `query exportIssueNoteItemsInShop($exportDocType: ExportDocType, $endDate: LocalDate, $startDate: LocalDate) { exportIssueNoteItemsInShop(exportDocType: $exportDocType, endDate: $endDate, startDate: $startDate) { code data } }`;
  const LPO_Q = `query getLpoFilteredByDepotsReport($fromDate: LocalDate, $shopStoreUuids: [String], $exportDocType: ExportDocType, $toDate: LocalDate, $administrativeAreaUuid: String, $itemGroupType: ItemGroupType, $supplierUuid: String, $itemGroupUuid: String, $itemUuid: String) { getLpoFilteredByDepotsReport(fromDate: $fromDate shopStoreUuids: $shopStoreUuids exportDocType: $exportDocType toDate: $toDate administrativeAreaUuid: $administrativeAreaUuid itemGroupType: $itemGroupType supplierUuid: $supplierUuid itemGroupUuid: $itemGroupUuid itemUuid: $itemUuid) { code data } }`;
  const INTRO_Q = `query IntrospectionQuery { __schema { queryType { name } mutationType { name } types { kind name description fields(includeDeprecated: false) { name description args { name type { ...T } } type { ...T } } inputFields { name type { ...T } } enumValues { name } } } }
    fragment T on __Type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }`;


  // ---- GraphQL documents found inside GIMIS' own web app (so the AI can reuse queries that are proven to work) ----
  function extractGqlOps(text) {
    const t = String(text).replace(/\n|\r|\t/g, ' ').replace(/\"/g, '"'), out = new Map(), re = /\b(query|mutation)\s+([A-Za-z_]\w*)\s*(\([^)]*\))?\s*\{/g; let m;
    while ((m = re.exec(t))) { let i = m.index + m[0].length, depth = 1; const st = m.index; while (i < t.length && depth > 0 && i - st < 9000) { const c = t[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; }
      if (depth !== 0) continue; if (!out.has(m[2])) out.set(m[2], { kind: m[1], name: m[2], vars: (m[3] || '').trim(), text: t.slice(st, i).replace(/\s+/g, ' ').trim() }); }
    return [...out.values()];
  }
  function extractFragments(text) {
    const t = String(text).replace(/\n|\r|\t/g, ' ').replace(/\"/g, '"'), out = {}, re = /\bfragment\s+([A-Za-z_]\w*)\s+on\s+[A-Za-z_]\w*\s*\{/g; let m;
    while ((m = re.exec(t))) { let i = m.index + m[0].length, depth = 1; while (i < t.length && depth > 0 && i - m.index < 6000) { const c = t[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; } if (depth === 0 && !out[m[1]]) out[m[1]] = t.slice(m.index, i).replace(/\s+/g, ' ').trim(); }
    return out;
  }

  const api = { ALLOW_READ, PII_KEY, redact, dropPiiColumns, extractGqlOps, extractFragments, guardQuery, stripGql, getPath, flattenRows, explodeFlat, findRecords, columnsOf, profile, queryDataset, resolveCol, monthsBetween, b64, typeOf, cmp, bucket, STATION, BINCARD_Q, EXPORT_Q, LPO_Q, INTRO_Q, DENY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GpsaEngineCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
