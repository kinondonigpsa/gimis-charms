// ai-tools.js - host side of elapsAI's tools (runs in the extension page world). createEngine(env) returns the tool functions.
// env: { gql(query, vars) -> {ok,data,errors,error}, gimis(op,params), savedTokens(), readCollection(name), collections(), progress(text),
//        store:{get,set}, onFile(desc) }
(function (root) {
  'use strict';
  const C = root.GpsaEngineCore, F = root.GpsaFiles;
  const lc = (s) => String(s == null ? '' : s).toLowerCase();
  const safeJson = (s, what) => { if (s == null || s === '') return undefined; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch (e) { throw new Error(what + ' si JSON halali: ' + String(e.message).slice(0, 80)); } };
  const slug = (s, d) => (String(s || d || 'data').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)) || (d || 'data');
  const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const EXT = { xlsx: 'xlsx', docx: 'docx', pdf: 'pdf', csv: 'csv', html: 'html', txt: 'txt', md: 'md', json: 'json', svg: 'svg', png: 'png' };

  function createEngine(env) {
    const ds = new Map(), files = [], apiLib = new Map(); let schema = null, appIndex = null, frame = null, ready = null, runSeq = 0, waiters = {};
    const prog = (t) => { try { env.progress && env.progress(t); } catch (e) {} };

    // ---------- workspace ----------
    function put(name, rows, source) {
      name = slug(name, 'data'); if (rows.length > 200000) rows = rows.slice(0, 200000);
      let total = rows.length; ds.forEach((v, k) => { if (k !== name) total += v.rows.length; }); while (total > 600000 && ds.size) { const k = ds.keys().next().value; if (k === name) break; total -= ds.get(k).rows.length; ds.delete(k); }
      ds.set(name, { rows, source: source || '', at: Date.now() }); return name;
    }
    const need = (name) => { const k = slug(name); const d = ds.get(k) || ds.get(String(name)); if (!d) throw new Error('Dataset "' + name + '" haipo. Zilizopo: ' + ([...ds.keys()].join(', ') || '(hakuna - tumia load_data au gimis_query kwanza)')); return d; };
    const summary = (name, extra) => Object.assign(C.profile(name, ds.get(name).rows), { source: ds.get(name).source }, extra || {});
    const addFile = (name, mime, bytes, meta) => {
      const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1]; name = String(name || 'faili').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80); if (!ext) name += '.' + (meta && meta.ext || 'bin');
      const d = Object.assign({ id: 'f' + (++runSeq) + '_' + Date.now().toString(36), name, mime, size: bytes.length, bytes, at: Date.now() }, meta || {});
      if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) d.url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      files.push(d); while (files.length > 60) { const o = files.shift(); if (o.url) URL.revokeObjectURL(o.url); } try { env.onFile && env.onFile(d); } catch (e) {} return d;
    };
    const fileOut = (d) => ({ file: d.name, size_kb: Math.round(d.size / 102.4) / 10, note: 'Faili limeandaliwa; mtumiaji ataona kadi ya kulipakua chini ya jibu lako.' });

    // ---------- GraphQL (read-only) ----------
    async function runGql(query, variables, tag) {
      const g = C.guardQuery(query); if (!g.ok) throw new Error(g.reason);
      const r = await env.gql(query, variables || {}, tag); if (!r.ok && !r.data) throw new Error(r.error || (r.errors && r.errors.map((e) => e.message).slice(0, 3).join(' | ')) || 'GIMIS haikujibu'); if (r.data) C.redact(r.data); return r;
    }
    async function loadSchema() {
      if (schema) return schema;
      const r = await env.gql(C.INTRO_Q, {}, 'introspection');
      if (!r.ok || !r.data || !r.data.__schema) throw new Error('GIMIS inakataa introspection (haitoi orodha ya API zake). ' + String(r.error || (r.errors && r.errors[0] && r.errors[0].message) || '').slice(0, 140) + ' -> tumia gimis_find_api kutafuta query zinazotumika na kurasa za GIMIS yenyewe.');
      const S = r.data.__schema, types = {}; S.types.forEach((t) => { types[t.name] = t; }); schema = { types, qname: (S.queryType || {}).name || 'Query' }; return schema;
    }
    const tref = (t) => !t ? '?' : t.kind === 'NON_NULL' ? tref(t.ofType) + '!' : t.kind === 'LIST' ? '[' + tref(t.ofType) + ']' : t.name;
    const baseName = (t) => !t ? null : t.name || baseName(t.ofType);
    function selection(types, tn, depth, seen) {
      const t = types[tn]; if (!t || !t.fields) return ''; const parts = [];
      t.fields.slice(0, 45).forEach((f) => { const b = baseName(f.type), bt = types[b]; if (!bt || bt.kind === 'SCALAR' || bt.kind === 'ENUM') parts.push(f.name); else if (depth > 0 && !seen.includes(b)) { const inner = selection(types, b, depth - 1, seen.concat(b)); if (inner) parts.push(f.name + ' { ' + inner + ' }'); } });
      return parts.join(' ');
    }
    async function gimisSchema(a) {
      const S = await loadSchema(), mode = lc(a.mode || 'queries'), q = S.types[S.qname]; if (!q) throw new Error('Schema haina Query type.');
      if (mode === 'queries') { const k = lc(a.search); let list = (q.fields || []).filter((f) => !k || lc(f.name).includes(k) || lc(baseName(f.type)).includes(k)); const total = list.length;
        return { total_matches: total, queries: list.slice(0, 120).map((f) => f.name + '(' + (f.args || []).map((x) => x.name + ': ' + tref(x.type)).join(', ') + ') -> ' + tref(f.type)), note: total > 120 ? 'Orodha imekatwa; weka "search" kuchuja.' : undefined }; }
      if (mode === 'type') { const t = S.types[a.name]; if (!t) throw new Error('Type "' + a.name + '" haipo.'); return { name: t.name, kind: t.kind, fields: (t.fields || t.inputFields || []).slice(0, 120).map((f) => f.name + ': ' + tref(f.type)), enum_values: t.enumValues ? t.enumValues.map((e) => e.name) : undefined }; }
      if (mode === 'describe') { const f = (q.fields || []).find((x) => x.name === a.name); if (!f) throw new Error('Query "' + a.name + '" haipo. Tumia mode=queries na search.');
        const inputs = {}; (f.args || []).forEach((x) => { const b = S.types[baseName(x.type)]; if (b && b.inputFields) inputs[b.name] = b.inputFields.map((i) => i.name + ': ' + tref(i.type)); else if (b && b.enumValues) inputs[b.name] = b.enumValues.map((e) => e.name); });
        const sel = selection(S.types, baseName(f.type), 2, [baseName(f.type)]); const vars = (f.args || []).map((x) => '$' + x.name + ': ' + tref(x.type)).join(', '), call = (f.args || []).map((x) => x.name + ': $' + x.name).join(' ');
        return { name: f.name, returns: tref(f.type), args: (f.args || []).map((x) => x.name + ': ' + tref(x.type)), input_types: inputs, example_query: 'query ' + f.name + (vars ? '(' + vars + ')' : '') + ' { ' + f.name + (call ? '(' + call + ')' : '') + ' { ' + sel + ' } }' }; }
      throw new Error('mode lazima iwe queries | type | describe');
    }

    // ---------- API discovery inside GIMIS' own app ----------
    async function buildAppIndex() {
      if (appIndex) return appIndex; const urls = new Set(), origin = location.origin;
      [...document.scripts].forEach((s) => { if (s.src) urls.add(s.src); }); document.querySelectorAll('link[rel=modulepreload],link[rel=preload][as=script]').forEach((l) => l.href && urls.add(l.href));
      try { performance.getEntriesByType('resource').forEach((e) => { if (/\.m?js(\?|$)/i.test(e.name)) urls.add(e.name); }); } catch (e) {}
      const list = [...urls].filter((u) => u.startsWith(origin)).slice(0, 60), ops = new Map(), frags = {}; let bytes = 0, scanned = 0;
      for (const u of list) { if (bytes > 40e6) break; try { prog('Naskani faili la GIMIS ' + (++scanned) + '/' + list.length + '...'); const r = await fetch(u, { credentials: 'include' }); if (!r.ok) continue; const t = await r.text(); bytes += t.length;
        C.extractGqlOps(t).forEach((o) => { if (!ops.has(o.name)) ops.set(o.name, o); }); Object.assign(frags, C.extractFragments(t)); } catch (e) {} }
      appIndex = { ops, frags, files: scanned, at: Date.now() }; return appIndex;
    }
    function withFragments(text, frags) {
      const seen = new Set(), add = [];
      const scan = (t) => { (t.match(/\.\.\.\s*([A-Za-z_]\w*)/g) || []).forEach((m) => { const n = m.replace(/\.\.\.\s*/, ''); if (n !== 'on' && !seen.has(n) && frags[n]) { seen.add(n); add.push(frags[n]); scan(frags[n]); } }); };
      scan(text); return add.length ? text + ' ' + add.join(' ') : text;
    }
    async function gimisFindApi(a) {
      const action = lc(a.action || 'search');
      if (action === 'library') { const lib = await libLoad(); return { saved_queries: [...lib.values()].sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, 40).map((x) => ({ name: x.name, note: x.note, query: x.query.slice(0, 1500) })) }; }
      if (action === 'save') { if (!a.name || !a.query) throw new Error('Weka name na query.'); const g = C.guardQuery(a.query); if (!g.ok) throw new Error(g.reason); const lib = await libLoad(); lib.set(a.name, { name: a.name, query: String(a.query), note: String(a.note || '').slice(0, 200), at: Date.now() }); await libSave(lib); return { saved: a.name }; }
      const ix = await buildAppIndex(), k = lc(a.keyword); const all = [...ix.ops.values()].filter((o) => o.kind === 'query');
      if (action === 'names') return { files_scanned: ix.files, total_queries: all.length, names: all.map((o) => o.name).filter((n) => !k || lc(n).includes(k)).slice(0, 300) };
      const hits = all.filter((o) => !k || lc(o.name).includes(k) || lc(o.text).includes(k)).sort((x, y) => (lc(y.name).includes(k) ? 1 : 0) - (lc(x.name).includes(k) ? 1 : 0));
      return { files_scanned: ix.files, total_queries_found: all.length, matches: hits.length, queries: hits.slice(0, 6).map((o) => ({ name: o.name, variables: o.vars, query: withFragments(o.text, ix.frags).slice(0, 3500) })),
        note: all.length ? 'Hizi ni query zinazotumiwa na ukurasa wa GIMIS wenyewe - nakili kwa gimis_query. Kama hazionekani, fungua ukurasa husika wa GIMIS mara moja kisha jaribu tena (kurasa zinapakiwa kwa mahitaji).' : 'Hakuna query iliyopatikana kwenye mafaili yaliyopakiwa. Fungua kurasa za GIMIS unazohitaji kisha jaribu tena.' };
    }
    const LIBKEY = 'gpsaAIApiLib';
    async function libLoad() { if (apiLib.size) return apiLib; try { const o = (await env.store.get(LIBKEY)) || {}; Object.keys(o).forEach((k) => apiLib.set(k, o[k])); } catch (e) {} return apiLib; }
    async function libSave(lib) { const o = {}; [...lib.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 80).forEach((x) => { o[x.name] = x; }); try { await env.store.set(LIBKEY, o); } catch (e) {} }

    // ---------- gimis_query ----------
    async function walkXlsx(data) { const hits = []; (function w(v, p, d) { if (d > 4 || v == null) return; if (typeof v === 'string') { if (v.length > 200 && v.startsWith('UEsDB')) hits.push({ p, v }); } else if (typeof v === 'object') Object.keys(v).forEach((k) => w(v[k], p ? p + '.' + k : k, d + 1)); })(data, '', 0); return hits; }
    async function gimisQuery(a) {
      const vars = safeJson(a.variables, 'variables') || {}, r = await runGql(a.query, vars, 'query');
      if (r.errors && r.errors.length && !r.data) throw new Error('GIMIS ilirudisha makosa: ' + r.errors.slice(0, 3).map((e) => e.message).join(' | ').slice(0, 400));
      let data = r.data, warn = r.errors && r.errors.length ? r.errors.slice(0, 2).map((e) => e.message.slice(0, 160)) : undefined;
      const xl = await walkXlsx(data);
      if (xl.length) { const grid = (await F.readXlsx(C.b64(xl[0].v)))[0]; const o = F.gridToObjects(grid.rows, a.header_hint); C.dropPiiColumns(o.rows); const name = put(a.save_as || 'report', o.rows, 'gimis_query xlsx'); return Object.assign(summary(name), { note: 'Faili la Excel la GIMIS limesomwa kuwa dataset.' }); }
      let found = C.findRecords(data, a.rows_path), rows = found.rows, pages = 1;
      const pk = ['pageableParam', 'pageParams', 'pagebleParams'].find((k) => vars[k] && typeof vars[k] === 'object');
      if (a.fetch_all_pages && found.rows.length && pk) {
        const holder = C.getPath(data, found.path.replace(/\.content$/, '')), total = holder && Number(holder.totalElements), size = Number((vars[pk] || {}).size) || found.rows.length, cap = Math.min(Number(a.max_rows) || 20000, 50000);
        for (let off = rows.length; total && off < total && off < cap; off = rows.length) { prog('Napakua kurasa... ' + off + '/' + total); const v2 = JSON.parse(JSON.stringify(vars)); v2[pk].first = off; const n = await runGql(a.query, v2, 'page'); const nf = C.findRecords(n.data, found.path); if (!nf.rows.length) break; rows = rows.concat(nf.rows); pages++; }
      }
      const opName = (/query\s+(\w+)/.exec(a.query) || [])[1];
      if (opName && found.rows.length) { const lib = await libLoad(); lib.set(opName, { name: opName, query: String(a.query), note: 'imefanya kazi', at: Date.now() }); libSave(lib); }
      if (!found.rows.length) { const s = JSON.stringify(data); return { rows: 0, note: found.missing ? 'rows_path "' + a.rows_path + '" haikupatikana kwenye jibu.' : 'Jibu halina orodha ya rekodi; hili ndilo jibu lenyewe:', data_preview: s.length > 6000 ? s.slice(0, 6000) + '...[imekatwa]' : data, warnings: warn }; }
      let flatRows = a.explode ? C.explodeFlat(rows, a.explode.replace(new RegExp('^' + found.path.replace(/\./g, '\\.') + '\\.?'), '')) : C.flattenRows(rows);
      const name = put(a.save_as || (opName || 'query'), flatRows, 'gimis_query ' + (opName || '')); return Object.assign(summary(name), { rows_path: found.path, pages_fetched: pages, warnings: warn, truncated: a.fetch_all_pages ? undefined : (found.rows.length >= 100 ? 'Kama kuna rekodi zaidi, tumia fetch_all_pages=true (inahitaji pageableParam kwenye variables).' : undefined) });
    }


    // ---------- GIMIS API catalog (v2.21): every captured GIMIS operation, known to elapsAI ----------
    const CAT = () => root.GIMIS_API_CATALOG || null;
    const argText = (o) => (o.a || []).map((x) => x[0] + ': ' + x[1]).join(', ');
    const brief = (n, o) => ({ name: n, group: o.g, description: o.d, args: argText(o) || '(hakuna)', usable: !!o.s });
    function needCat() { const c = CAT(); if (!c) throw new Error('Katalogi ya API (gimis-api-catalog.js) haijapakiwa.'); return c; }
    function closest(c, name) { const k = lc(name); return Object.keys(c.ops).filter((n) => lc(n).includes(k) || k.includes(lc(n))).slice(0, 8); }
    async function gimisApiCatalog(a) {
      const c = needCat(), act = lc(a.action || (a.name ? 'describe' : a.keyword || a.group ? 'search' : 'groups'));
      if (act === 'groups') {
        const by = {}; Object.keys(c.ops).forEach((n) => { const o = c.ops[n]; (by[o.g] = by[o.g] || []).push([n, o]); });
        return { total_apis: c.meta.total, read_only_usable: c.meta.readSafe, blocked_for_ai: c.meta.blocked, captured: c.meta.exportedAt,
          groups: Object.keys(by).map((g) => ({ group: g, about: c.groups[g], usable: by[g].filter((x) => x[1].s).length, blocked: by[g].filter((x) => !x[1].s).length, examples: by[g].filter((x) => x[1].s).sort((x, y) => (y[1].c || 0) - (x[1].c || 0)).slice(0, 5).map((x) => x[0]) })),
          next: 'Tumia action=search (keyword/group) kisha action=describe (name), kisha gimis_call.' };
      }
      if (act === 'describe') {
        const o = c.ops[a.name]; if (!o) { const sg = closest(c, a.name || ''); throw new Error('API "' + a.name + '" haipo kwenye katalogi.' + (sg.length ? ' Inayokaribia: ' + sg.join(', ') : ' Tumia action=search.')); }
        return Object.assign({ name: a.name, type: o.t === 'm' ? 'mutation' : 'query', group: o.g, description: o.d, usable_by_ai: !!o.s },
          o.s ? { args: (o.a || []).map((x) => ({ name: x[0], type: x[1] })), default_variables: o.v || {}, returns_fields: o.r || [], used_on_gimis_pages: o.p, times_seen_in_capture: o.c, note: o.n, query: o.q, how_to_call: 'gimis_call name=' + a.name + ' variables=\'{...}\' save_as=jina' }
                 : { why_blocked: o.w, what_to_do: o.h, args: (o.a || []).map((x) => x[0] + ': ' + x[1]) });
      }
      if (act === 'search') {
        const ws = lc(a.keyword).split(/[^a-z0-9]+/).filter(Boolean), g = lc(a.group), incl = !!a.include_blocked; let rows = [];
        Object.keys(c.ops).forEach((n) => { const o = c.ops[n]; if (g && o.g !== g) return; if (!o.s && !incl) return;
          const hay = lc([n, o.d, o.g, argText(o), (o.r || []).join(' '), (o.p || []).join(' ')].join(' ')); let sc = 0;
          for (const w of ws) { if (!hay.includes(w)) { sc = -1; break; } sc += lc(n).includes(w) ? 3 : lc(o.d).includes(w) ? 2 : 1; }
          if (sc >= 0) rows.push([sc, n, o]); });
        rows.sort((x, y) => y[0] - x[0] || (y[2].c || 0) - (x[2].c || 0));
        return { matches: rows.length, shown: Math.min(rows.length, 15), apis: rows.slice(0, 15).map((x) => brief(x[1], x[2])), tip: rows.length ? 'Tumia action=describe name=... kuona fields na vigezo.' : 'Hakuna. Jaribu neno jingine la Kiingereza (mfano lpo, wallet, token, bin card) au group.' };
      }
      throw new Error('action: groups | search | describe');
    }
    async function gimisCall(a) {
      const c = needCat(), o = c.ops[a.name];
      if (!o) { const sg = closest(c, a.name || ''); throw new Error('API "' + a.name + '" haipo kwenye katalogi.' + (sg.length ? ' Inayokaribia: ' + sg.join(', ') : ' Tumia gimis_api_catalog action=search.')); }
      if (!o.s) throw new Error('"' + a.name + '" haiwezi kuendeshwa na elapsAI (' + o.w + '). ' + o.h);
      const given = safeJson(a.variables, 'variables') || {}, names = (o.a || []).map((x) => x[0]), vars = {};
      Object.keys(given).forEach((k) => { if (!names.includes(k)) throw new Error('Kigezo "' + k + '" hakipo kwenye ' + a.name + '. Vigezo halali: ' + (names.join(', ') || '(hakuna)')); });
      names.forEach((k) => { const d = o.v && o.v[k], g = given[k]; if (g !== undefined) vars[k] = (d && typeof d === 'object' && g && typeof g === 'object') ? Object.assign({}, d, g) : g; else if (d !== undefined) vars[k] = JSON.parse(JSON.stringify(d)); });
      (o.a || []).forEach(([k, ty]) => { const v = vars[k]; if ((ty === 'LocalDate' || /date$/i.test(k)) && typeof v === 'string' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Kigezo "' + k + '" lazima kiwe YYYY-MM-DD.'); });
      const res = await gimisQuery({ query: o.q, variables: JSON.stringify(vars), save_as: a.save_as || a.name, rows_path: a.rows_path, explode: a.explode, fetch_all_pages: a.fetch_all_pages, max_rows: a.max_rows, header_hint: a.header_hint });
      return Object.assign({ api: a.name, group: o.g, variables_sent: vars }, res);
    }
    // ---------- load_data ----------
    async function loadData(a) {
      const src = lc(a.source), nm = a.name; let rows;
      if (src === 'saved_tokens') { rows = await env.savedTokens(); return summary(put(nm || 'saved_tokens', rows, 'token zilizohifadhiwa (kompyuta hii + Supabase)')); }
      if (src === 'gimis_my_tokens') { const r = await env.gimis('aiMyTokens', { limit: 500 }); if (!r.ok) throw new Error(r.error); return summary(put(nm || 'gimis_my_tokens', r.list, 'GIMIS myIssueNoteTokens')); }
      if (src === 'firebase_collection') { if (!a.collection) throw new Error('Weka collection.'); if (!(env.collections() || []).includes(a.collection)) throw new Error('Collection hairuhusiwi. Zinazoruhusiwa: ' + env.collections().join(', ')); const docs = await env.readCollection(a.collection); return summary(put(nm || a.collection, C.flattenRows(docs), 'Supabase ' + a.collection)); }
      const start = a.start || today().slice(0, 8) + '01', end = a.end || today(); if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('start/end lazima ziwe YYYY-MM-DD.'); if (start > end) throw new Error('start ni baada ya end.');
      if (src === 'issue_notes_report') {
        rows = []; const notes = [];
        for (const [s, e] of C.monthsBetween(start, end)) { prog('Napakua ripoti ya Issue Notes ' + s + ' - ' + e + '...'); const r = await runGql(C.EXPORT_Q, { exportDocType: 'XLSX', startDate: s, endDate: e }, 'report'), blk = r.data && r.data.exportIssueNoteItemsInShop;
          if (!blk || !blk.data) { notes.push(s.slice(0, 7) + ': hakuna data (code ' + (blk && blk.code) + ')'); continue; } const g = (await F.readXlsx(C.b64(blk.data)))[0]; rows = rows.concat(C.dropPiiColumns(F.gridToObjects(g.rows, 'sno').rows)); }
        return Object.assign(summary(put(nm || 'issue_notes', rows, 'GIMIS Issue Notes ' + start + '..' + end)), { notes: notes.length ? notes : undefined, hint: 'Safu zinaweza kujumuisha Tokens, Means Of Transprot, Item, Qty, Status, Is Used, Issue Date, Reference, Institution.' });
      }
      if (src === 'depot_lpo_report') {
        const r = await runGql(C.LPO_Q, { fromDate: start, toDate: end, shopStoreUuids: [C.STATION.shop], administrativeAreaUuid: C.STATION.area, itemGroupType: a.item_group_type || 'Fuel', exportDocType: 'XLSX', supplierUuid: null, itemGroupUuid: null, itemUuid: null }, 'report'), blk = r.data && r.data.getLpoFilteredByDepotsReport;
        if (!blk || !blk.data) throw new Error('Ripoti ya LPO haikurudisha data (code ' + (blk && blk.code) + ').'); const g = (await F.readXlsx(C.b64(blk.data)))[0], o = F.gridToObjects(g.rows, 'lpo number'); C.dropPiiColumns(o.rows);
        return summary(put(nm || 'depot_lpo', o.rows, 'GIMIS Depot LPO Report ' + start + '..' + end));
      }
      if (src === 'bin_card') {
        const item = lc(a.item || 'diesel'), id = item === 'diesel' ? 5 : item === 'petrol' ? 6 : Number(item); if (!id) throw new Error('item lazima iwe diesel, petrol au namba ya item id.');
        let all = [], off = 0, total = null; const size = 2000;
        do { prog('Napakua Bin Card ' + item + ' ' + all.length + '...'); const r = await runGql(C.BINCARD_Q, { pageableParam: { first: off, size, sortBy: 'updatedAt', sortDirection: 'DESC' }, transactionStatus: null, startDate: start, endDate: end, itemId: id }, 'report'), p = r.data && r.data.binCardItemTransactionsMyShopByItemId; if (!p) break; total = Number(p.totalElements || 0); const c = p.content || []; all = all.concat(c); off += c.length; if (!c.length) break; } while (total != null && all.length < total && all.length < 20000);
        rows = C.flattenRows(all); return Object.assign(summary(put(nm || ('bin_card_' + (item === 'diesel' || item === 'petrol' ? item : id)), rows, 'GIMIS Depot Bin Card ' + start + '..' + end)), { total_in_gimis: total });
      }
      throw new Error('source lazima iwe: saved_tokens | gimis_my_tokens | firebase_collection | issue_notes_report | depot_lpo_report | bin_card');
    }

    // ---------- workspace / dataset_query ----------
    function workspace(a) {
      const act = lc(a.action || 'list');
      if (act === 'list') return { datasets: [...ds.entries()].map(([k, v]) => ({ name: k, rows: v.rows.length, columns: C.columnsOf(v.rows).slice(0, 30), source: v.source })), files: files.map((f) => ({ name: f.name, size_kb: Math.round(f.size / 102.4) / 10 })) };
      if (act === 'peek') { const d = need(a.name), off = Math.max(0, Number(a.offset) || 0), lim = Math.min(50, Number(a.limit) || 10); let r = d.rows.slice(off, off + lim); if (a.columns && a.columns.length) { const cols = a.columns.map((c) => C.resolveCol(C.columnsOf(d.rows), c)); r = r.map((x) => { const o = {}; cols.forEach((c) => { o[c] = x[c]; }); return o; }); } return { name: slug(a.name), total_rows: d.rows.length, offset: off, rows: r }; }
      if (act === 'drop') { const k = slug(a.name); if (!ds.delete(k)) throw new Error('Dataset haipo.'); return { dropped: k }; }
      if (act === 'clear') { ds.clear(); return { cleared: true }; }
      if (act === 'rename') { const d = need(a.name), nn = slug(a.new_name); ds.delete(slug(a.name)); ds.set(nn, d); return { renamed: nn }; }
      throw new Error('action: list | peek | drop | clear | rename');
    }
    function datasetQuery(a) {
      const d = need(a.dataset), spec = { where: safeJson(a.where, 'where'), group_by: a.group_by, aggs: safeJson(a.aggs, 'aggs'), select: a.select, order_by: safeJson(a.order_by, 'order_by'), limit: a.limit && !a.save_as ? undefined : a.limit, distinct: a.distinct };
      const r = C.queryDataset(d.rows, spec), shown = Math.min(r.rows.length, Math.min(Number(a.limit) || 60, 100)); let saved;
      if (a.save_as) saved = put(a.save_as, r.rows, 'dataset_query ' + slug(a.dataset)); return { total_rows: r.total, shown, rows: r.rows.slice(0, shown), saved_as: saved, note: r.rows.length > shown ? 'Safu zilizobaki hazijaonyeshwa; tumia save_as kisha create_file/create_chart.' : undefined };
    }

    // ---------- code sandbox ----------
    function killFrame() { if (frame) { try { frame.remove(); } catch (e) {} } frame = null; ready = null; Object.keys(waiters).forEach((k) => { waiters[k]({ ok: false, error: 'Sandbox imesimamishwa.' }); delete waiters[k]; }); }
    function onMsg(e) { const m = e.data; if (!m || !m.gpsaSandbox || !frame || e.source !== frame.contentWindow) return; if (m.gpsaSandbox === 'ready') { if (frame._ready) frame._ready(); return; } const w = waiters[m.id]; if (w) { delete waiters[m.id]; w(m); } }
    let listening = false;
    function ensureSandbox() {
      if (frame && ready) return ready; if (!listening) { window.addEventListener('message', onMsg); listening = true; }
      ready = new Promise((res, rej) => { const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.style.cssText = 'display:none;width:0;height:0;border:0'; f.src = chrome.runtime.getURL('ai-sandbox.html'); frame = f; f._ready = res;
        const to = setTimeout(() => { killFrame(); rej(new Error('Sandbox ya code haikupakia (ukurasa wa GIMIS unaweza kuzuia iframe). Tumia zana za create_file / create_chart / dataset_query badala ya run_code.')); }, 7000); f._to = to; document.documentElement.appendChild(f); });
      return ready.then((v) => { clearTimeout(frame && frame._to); return v; });
    }
    async function runCode(a) {
      const code = String(a.code || ''); if (!code.trim()) throw new Error('Weka code.'); await ensureSandbox();
      const names = a.datasets && a.datasets.length ? a.datasets.map(slug) : [...ds.keys()].filter((k) => code.includes(k)), data = {}; names.forEach((n) => { if (ds.has(n)) data[n] = ds.get(n).rows; });
      const timeout = Math.min(Math.max(Number(a.timeout_s) || 30, 5), 120) * 1000, id = ++runSeq;
      const res = await new Promise((resolve) => { const t = setTimeout(() => { delete waiters[id]; killFrame(); resolve({ ok: false, error: 'Code ilizidi muda (' + timeout / 1000 + 's) - inaweza kuwa na loop isiyoisha. Rahisisha.' }); }, timeout); waiters[id] = (m) => { clearTimeout(t); resolve(m); }; frame.contentWindow.postMessage({ gpsa: 'run', id, code, data }, '*'); });
      const out = { ok: !!res.ok, logs: (res.logs || []).join('\n').slice(0, 6000) };
      if (!res.ok) { out.error = String(res.error || 'hitilafu').slice(0, 1500); return out; }
      if (res.result !== undefined) out.result = res.result;
      const made = []; (res.files || []).forEach((f) => { const d = addFile(f.name, f.mime, f.bytes, { ext: (f.name.split('.').pop() || 'bin') }); made.push({ file: d.name, size_kb: Math.round(d.size / 102.4) / 10 }); }); if (made.length) out.files_created = made;
      const dsN = []; Object.keys(res.datasets || {}).forEach((k) => { const n = put(k, res.datasets[k], 'run_code'); dsN.push({ name: n, rows: res.datasets[k].length }); }); if (dsN.length) out.datasets_saved = dsN;
      return out;
    }

    // ---------- files ----------
    const rowsFor = (sh) => { if (sh.dataset) { const d = need(sh.dataset); let rows = d.rows; if (sh.columns && sh.columns.length) { const cols = sh.columns.map((c) => C.resolveCol(C.columnsOf(rows), c)); rows = rows.map((r) => { const o = {}; cols.forEach((c) => { o[c] = r[c]; }); return o; }); } return rows.slice(0, sh.max_rows || 100000); } return sh.rows || []; };
    const expandTables = (md) => String(md || '').replace(/\{\{table:([^|}]+)(?:\|(\d+))?(?:\|([^}]*))?\}\}/g, (m, n, lim, cols) => { const d = need(n.trim()); let c = cols ? cols.split(',').map((x) => C.resolveCol(C.columnsOf(d.rows), x.trim())) : C.columnsOf(d.rows).slice(0, 12); const cell = (v) => v == null ? '' : String(typeof v === 'number' ? F.fmtNum(v) : v).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 120); return '\n| ' + c.join(' | ') + ' |\n|' + c.map(() => '---').join('|') + '|\n' + d.rows.slice(0, Number(lim) || 50).map((r) => '| ' + c.map((k) => cell(r[k])).join(' | ') + ' |').join('\n') + '\n'; });
    async function imagesFor(md, forPdf) { const map = {}, names = []; (String(md).match(/!\[[^\]]*\]\(([^)]+)\)/g) || []).forEach((m) => names.push(/\(([^)]+)\)/.exec(m)[1])); for (const n of names) { const base = n.split('/').pop(), f = files.slice().reverse().find((x) => x.name === base && x.mime === 'image/png'); if (!f) continue; if (forPdf) { const j = await F.pngToJpeg(f.bytes); map[n] = j; } else map[n] = f.bytes; } return map; }
    async function createFile(a) {
      const type = lc(a.type || (String(a.filename || '').split('.').pop())), ext = EXT[type]; if (!ext) throw new Error('type lazima iwe xlsx | docx | pdf | csv | html | txt | md | json | svg');
      let base = String(a.filename || ('ripoti_' + today())).replace(/\.[a-z0-9]+$/i, ''), bytes, meta = { ext };
      if (type === 'xlsx') { let sheets = safeJson(a.sheets, 'sheets'); if (!sheets && a.dataset) sheets = [{ name: a.sheet_name || a.dataset, dataset: a.dataset, title: a.title, totals: a.totals }]; if (!Array.isArray(sheets) || !sheets.length) throw new Error('xlsx inahitaji "sheets" (JSON) au "dataset".');
        bytes = F.xlsx({ sheets: sheets.map((s) => Object.assign({}, s, { rows: rowsFor(s) })) }); }
      else if (type === 'csv') { const rows = a.dataset ? rowsFor({ dataset: a.dataset, columns: a.columns }) : (safeJson(a.rows, 'rows') || []); bytes = F.enc.encode(F.csv(rows)); }
      else if (type === 'docx') { const md = expandTables(a.content); bytes = F.docx(md, { orientation: a.orientation, images: await imagesFor(md, false) }); }
      else if (type === 'pdf') { const md = expandTables(a.content); bytes = F.pdf(md, { orientation: a.orientation, title: a.title || base, images: await imagesFor(md, true) }); }
      else if (type === 'html') { if (/<html[\s>]|<!doctype/i.test(a.content || '')) bytes = F.enc.encode(a.content); else { const md = expandTables(a.content), urls = {}; (md.match(/!\[[^\]]*\]\(([^)]+)\)/g) || []).forEach((m) => { const n = /\(([^)]+)\)/.exec(m)[1], f = files.slice().reverse().find((x) => x.name === n.split('/').pop() && x.mime === 'image/png'); if (f) urls[n] = 'data:image/png;base64,' + btoa(String.fromCharCode.apply(null, f.bytes.length < 60000 ? f.bytes : [])); if (f && f.bytes.length >= 60000) { let s = ''; for (let i = 0; i < f.bytes.length; i += 8192) s += String.fromCharCode.apply(null, f.bytes.subarray(i, i + 8192)); urls[n] = 'data:image/png;base64,' + btoa(s); } }); bytes = F.enc.encode(F.htmlDoc(md, { title: a.title || base, imagesDataUrl: urls })); } }
      else if (type === 'json') { let c = a.content; try { c = JSON.stringify(JSON.parse(c), null, 2); } catch (e) {} bytes = F.enc.encode(String(c == null ? '' : c)); }
      else if (type === 'svg') bytes = F.enc.encode(F.sanitizeSvg(a.content));
      else bytes = F.enc.encode(expandTables(a.content));
      return fileOut(addFile(base + '.' + ext, F.MIME[ext], bytes, meta));
    }
    async function createChart(a) {
      let labels, series; const type = lc(a.type || 'bar');
      if (a.dataset) { const d = need(a.dataset), cols = C.columnsOf(d.rows), x = a.x; if (!x) throw new Error('Weka x (safu ya makundi).'); const ys = String(a.y || '').split(',').map((s) => s.trim()).filter(Boolean), fn = lc(a.agg || (ys.length ? 'sum' : 'count'));
        const spec = { where: safeJson(a.where, 'where'), group_by: [x], aggs: ys.length ? ys.map((y) => ({ col: y, fn, as: C.resolveCol(cols, y) })) : [{ col: '*', fn: 'count', as: 'Idadi' }] }; const r = C.queryDataset(d.rows, spec).rows, xk = Object.keys(r[0] || {})[0]; const isTime = /:(day|week|month|year)$/.test(x); const vk = Object.keys(r[0] || {}).slice(1);
        const sort = lc(a.sort || (isTime ? 'none' : 'desc')); if (sort !== 'none' && vk.length) r.sort((p, q) => (sort === 'asc' ? 1 : -1) * ((Number(p[vk[0]]) || 0) - (Number(q[vk[0]]) || 0))); const top = r.slice(0, Number(a.top_n) || 25);
        labels = top.map((o) => String(o[xk])); series = vk.map((k) => ({ name: k, values: top.map((o) => o[k]) })); }
      else { labels = safeJson(a.labels, 'labels'); series = safeJson(a.series, 'series'); if (!Array.isArray(labels) || !Array.isArray(series)) throw new Error('Weka "dataset"+"x" au "labels" na "series" (JSON).'); }
      const svg = F.chartSvg({ type, title: a.title, labels, series, stacked: !!a.stacked, xTitle: a.x_title, yTitle: a.y_title, width: a.width, height: a.height, fullNumbers: !!a.full_numbers }), base = String(a.filename || a.title || 'chati').replace(/\.[a-z]+$/i, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 50) || 'chati';
      let d; try { const png = await F.svgToPng(svg, 2); d = addFile(base + '.png', F.MIME.png, png.bytes, { ext: 'png', w: png.w, h: png.h }); } catch (e) { d = addFile(base + '.svg', F.MIME.svg, F.enc.encode(svg), { ext: 'svg' }); }
      return Object.assign(fileOut(d), { points: labels.length, series: series.map((s) => s.name), tip: 'Ili kuiweka kwenye ripoti ya Word/PDF/HTML andika: ![maelezo](' + d.name + ') ndani ya content ya create_file.' });
    }
    async function createImage(a) {
      const svg = F.sanitizeSvg(a.svg), base = String(a.filename || 'picha').replace(/\.[a-z]+$/i, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 50) || 'picha';
      try { const png = await F.svgToPng(svg, Math.min(Number(a.scale) || 2, 4)); const d = addFile(base + '.png', F.MIME.png, png.bytes, { ext: 'png', w: png.w, h: png.h }); addFile(base + '.svg', F.MIME.svg, F.enc.encode(svg), { ext: 'svg' }); return Object.assign(fileOut(d), { also: base + '.svg' }); }
      catch (e) { const d = addFile(base + '.svg', F.MIME.svg, F.enc.encode(svg), { ext: 'svg' }); return Object.assign(fileOut(d), { warning: 'PNG haikutengenezwa: ' + e.message }); }
    }

    async function selfTest() {
      const out = []; const t = async (name, fn) => { try { const r = await fn(); out.push({ name, ok: true, detail: r }); } catch (e) { out.push({ name, ok: false, detail: String((e && e.message) || e).slice(0, 160) }); } };
      await t('Kikao cha GIMIS (token)', async () => { const r = await env.gimis('status', {}); if (!r.ok || !r.valid) throw new Error('Fungua "Get Issue Note Token" kwenye GIMIS mara moja.'); return 'kimeshikwa'; });
      await t('Katalogi ya API za GIMIS', async () => { const c = needCat(); return c.meta.total + ' API (' + c.meta.readSafe + ' za kusoma, ' + c.meta.blocked + ' zimezuiwa)'; });
      await t('GraphQL ya kusoma', async () => { const r = await runGql('query { checkPasswordExpiryRemainingDay }', {}, 'selftest'); return 'inafanya kazi'; });
      await t('Introspection (orodha kamili ya API)', async () => { const S = await loadSchema(); return (S.types[S.qname].fields || []).length + ' queries zimepatikana'; });
      await t('Sandbox ya code (run_code)', async () => { const r = await runCode({ code: 'return 6*7;', timeout_s: 10 }); if (r.result !== 42) throw new Error(r.error || 'jibu si sahihi'); return 'inafanya kazi'; });
      await t('Michoro / PNG (canvas)', async () => { const r = await F.svgToPng(F.chartSvg({ type: 'bar', labels: ['a'], series: [{ name: 's', values: [1] }] }), 1); return r.w + 'x' + r.h; });
      await t('Kusoma Excel (DecompressionStream)', async () => { const x = await F.readXlsx(F.xlsx({ sheets: [{ name: 'A', rows: [['x', 1]] }] })); return x.length + ' sheet'; });
      return out;
    }

    return { put, need, summary, addFile, files, datasets: ds, tools: { load_data: loadData, gimis_query: gimisQuery, gimis_schema: gimisSchema, gimis_find_api: gimisFindApi, gimis_api_catalog: gimisApiCatalog, gimis_call: gimisCall, workspace: async (a) => workspace(a), dataset_query: async (a) => datasetQuery(a), run_code: runCode, create_file: createFile, create_chart: createChart, create_image: createImage }, selfTest, killFrame };
  }
  const api = { createEngine, slug };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GpsaEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
