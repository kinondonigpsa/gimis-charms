// ai-core.js — the "brain" of the AI Assistant (no DOM here, so it can be tested on its own).
// Gemini answers; it is given READ-ONLY tools that look at (1) this computer's token list, (2) the Supabase cloud data,
// (3) GIMIS live (queries only). It can never issue, save, renew or delete anything.
(function (root) {
  const TZ = 3 * 3600e3;                                   // Dar es Salaam = UTC+3
  const iso = (ms) => ms ? new Date(Number(ms) + TZ).toISOString().replace('T', ' ').slice(0, 16) : null;
  const dayOf = (ms) => ms ? new Date(Number(ms) + TZ).toISOString().slice(0, 10) : '';
  const lc = (s) => String(s == null ? '' : s).toLowerCase();
  const num = (n) => (n == null || n === '' || isNaN(n)) ? 0 : Number(n);

  // ---------- records ----------
  const items = (r) => ((r.detail || {}).items) || [];
  const litres = (r) => items(r).reduce((a, x) => a + num(x.litres), 0);
  const estTotal = (r) => items(r).reduce((a, x) => a + num(x.litres) * num(x.unitPrice), 0);
  const fuel = (r) => [...new Set(items(r).map((x) => x.name).filter(Boolean))].join(', ');
  const inst = (r) => (r.detail || {}).institution || r.institution || '';
  const issuedMs = (r) => r.gimisIssuedAt || (r.status === 'issued' ? r.issuedAt : null) || null;
  function partOf(r, resText) {
    const why = resText ? resText(r) : (r.error || '');
    if (r.status === 'issued') return 'issued';
    if (r.status === 'failed' || (r.status === 'pending' && why)) return 'failed';
    return 'not_issued';
  }
  function compact(r, resText, source) {
    const o = { token: r.token, chassis: r.chassis, status: r.status, part: partOf(r, resText), institution: inst(r) || null, fuel: fuel(r) || null,
      litres: litres(r) || null, unit_price: num((items(r)[0] || {}).unitPrice) || null, est_total_tzs: estTotal(r) || null,
      reason: (resText ? resText(r) : r.error) || null, permitted_by: r.permittedBy || null, saved_at: iso(r.addedAt),
      issued_at_gimis: iso(issuedMs(r)), token_created_at: iso(r.tokenCreatedAt || r.noteCreatedAt), gin: r.ref || (r.detail || {}).ref || null,
      requester: (r.detail || {}).requesterName || null, tracking_no: (r.detail || {}).trackingNumber || null };
    if (source) o.source = source;
    Object.keys(o).forEach((k) => { if (o[k] == null) delete o[k]; });
    return o;
  }
  // newest copy wins per token; remember where each one lives
  function mergeData(local, cloud) {
    const by = {};
    (cloud || []).forEach((r) => { if (r && r.token) by[r.token + '|' + r.chassis] = { r, src: 'cloud' }; });
    (local || []).forEach((r) => {
      const k = r.token + '|' + r.chassis, c = by[k];
      if (!c) by[k] = { r, src: 'this computer' };
      else by[k] = { r: (r.updatedAt || 0) >= (c.r.updatedAt || 0) ? r : c.r, src: 'both' };
    });
    return Object.keys(by).map((k) => Object.assign({}, by[k].r, { __src: by[k].src }));
  }

  // ---------- tools ----------
  const S = 'STRING', N = 'NUMBER', B = 'BOOLEAN', O = 'OBJECT';
  const DECLS = [
    { name: 'data_overview', description: 'Overall picture of the saved tokens (this computer + Supabase cloud): counts per part (not issued yet / failed / issued), litres, estimated value, average time to issue, oldest waiting token, where data lives, which Supabase collections can be read. Call this first for general questions.',
      parameters: { type: O, properties: { refresh_cloud: { type: B, description: 'Re-read the Supabase cloud now' } } } },
    { name: 'search_tokens', description: 'Find saved tokens. All filters are optional and combined with AND. Returns the matching rows (max 60) and the total number of matches.',
      parameters: { type: O, properties: {
        query: { type: S, description: 'Text to find in token, chassis, institution, permitter, GIN or reason' },
        part: { type: S, description: 'not_issued | failed | issued' }, status: { type: S, description: 'pending | issued | failed' },
        institution: { type: S }, permitted_by: { type: S }, reason_contains: { type: S },
        saved_from: { type: S, description: 'YYYY-MM-DD (date the token was saved here)' }, saved_to: { type: S, description: 'YYYY-MM-DD' },
        limit: { type: N } } } },
    { name: 'vehicle_history', description: 'Every saved token of one vehicle (chassis / registration number), with status, institution, litres and reasons.',
      parameters: { type: O, properties: { chassis: { type: S } }, required: ['chassis'] } },
    { name: 'group_stats', description: 'Count / litres / estimated value of saved tokens grouped by something. Use for "which institution has most...", "how many per day", "most common failure reason".',
      parameters: { type: O, properties: { group_by: { type: S, description: 'institution | permitted_by | status | part | reason | fuel | day | month' }, part: { type: S, description: 'optional filter: not_issued | failed | issued' }, limit: { type: N } }, required: ['group_by'] } },
    { name: 'gimis_lookup_token', description: 'LIVE question to the GIMIS server about ONE token (read-only): does GIMIS know it, is it used/issued, institution, litres, vehicle GIMIS has for it, creation and expiry dates. Chassis is optional.',
      parameters: { type: O, properties: { token: { type: S }, chassis: { type: S } }, required: ['token'] } },
    { name: 'gimis_my_tokens', description: 'LIVE list from GIMIS of the issue-note tokens of the logged-in GIMIS user, with used flag, creation and expiry dates.',
      parameters: { type: O, properties: { limit: { type: N } } } },
    { name: 'gimis_requisition', description: 'LIVE GIMIS request (requisition) details by its numeric id: institution, shop, wallet, billed/paid amount, items, issue notes.',
      parameters: { type: O, properties: { requisition_id: { type: N } }, required: ['requisition_id'] } },
    { name: 'gimis_issue_notes', description: 'LIVE GIMIS issue notes (GIN) of a request: items, litres, who issued, which are issued.',
      parameters: { type: O, properties: { requisition_id: { type: N } }, required: ['requisition_id'] } },
    { name: 'gimis_error_codes', description: 'The GIMIS answer codes learned so far (code = message), e.g. 9002 = No Record Found.', parameters: { type: O, properties: {} } },
    { name: 'firebase_read_collection', description: 'Read documents from an allowed Supabase collection (read-only) to learn its structure and answer from it. Returns the field names, total count and matching documents.',
      parameters: { type: O, properties: { collection: { type: S }, contains: { type: S, description: 'only documents whose text contains this' }, limit: { type: N } }, required: ['collection'] } },
    { name: 'remember_lesson', description: 'Save a lesson so the assistant remembers it next time. Use ONLY when the user explicitly teaches or corrects something ("kumbuka", "jifunze", "ukweli ni..."). Write one short, factual sentence in Swahili.',
      parameters: { type: O, properties: { text: { type: S } }, required: ['text'] } },
    // ----- v2.19: workspace, live GIMIS queries, code execution, file / chart / image creation -----
    { name: 'load_data', description: 'Load data into the WORKSPACE as a named dataset. The full data stays in this browser; you only get a profile (columns, types, totals, 4 sample rows). Sources: saved_tokens (tokens saved here + Supabase) | gimis_my_tokens | firebase_collection | issue_notes_report (GIMIS issue-note items report for any date range; columns like Sno, Title, Tokens, Means Of Transprot, Item, Qty, Status, Is Used, Issue Date, Reference, Institution) | depot_lpo_report (fuel LPOs of GPSA Kinondoni: LPO Number, Item, LPO Date, Qty Ordered, Qty Received, Unit Price, LPO Value, Status...) | bin_card (depot bin card transactions of diesel or petrol). start/end are YYYY-MM-DD (default = this month).',
      parameters: { type: O, properties: { source: { type: S }, name: { type: S, description: 'dataset name (a-z, 0-9, _)' }, start: { type: S }, end: { type: S }, item: { type: S, description: 'bin_card: diesel | petrol | item id' }, collection: { type: S }, item_group_type: { type: S, description: 'depot_lpo_report, default Fuel' } }, required: ['source'] } },
    { name: 'gimis_query', description: 'Run ONE READ-ONLY GraphQL query on live GIMIS (mutations and state-changing fields are refused). Records found in the answer become a dataset (nested fields flattened as a.b). Reuse queries from gimis_find_api / gimis_schema. For paged queries put pageableParam {first: offset, size} in variables and set fetch_all_pages. Base64 Excel strings in the answer are read automatically.',
      parameters: { type: O, properties: { query: { type: S }, variables: { type: S, description: 'JSON text of the variables' }, save_as: { type: S }, rows_path: { type: S, description: 'dot path of the records array if auto-detect picks the wrong one' }, explode: { type: S, description: 'dot path of an array inside each record to turn into one row per element' }, fetch_all_pages: { type: B }, max_rows: { type: N } }, required: ['query'] } },
    { name: 'gimis_schema', description: 'Discover GIMIS API through GraphQL introspection. mode=queries (list root queries, optional search keyword) | describe (name = one query: arguments, input types and a ready-to-run example_query with fields) | type (name = a type: its fields). If introspection is refused, use gimis_find_api.',
      parameters: { type: O, properties: { mode: { type: S }, name: { type: S }, search: { type: S } } } },
    { name: 'gimis_find_api', description: 'Find GraphQL queries used by the GIMIS web app itself (scans its loaded scripts) - these are proven to work. action=search (keyword in query name or body) | names (list names) | library (queries saved earlier) | save (name, query, note: keep a working query for next time).',
      parameters: { type: O, properties: { action: { type: S }, keyword: { type: S }, name: { type: S }, query: { type: S }, note: { type: S } } } },
    { name: 'gimis_api_catalog', description: 'CATALOG of every GIMIS API (GraphQL operation) elapsAI knows: 198 captured from the real GIMIS app, with group, description, arguments and returned fields. action=groups (overview) | search (keyword in English like lpo, wallet, token, bin card; optional group; include_blocked) | describe (name: arguments, default variables, returned fields, pages that use it; or why it is blocked). Only read-only APIs can be run; mutations are listed so you can tell the user where to do them in GIMIS. Always search/describe here BEFORE calling an API you are not sure about - never invent API names.',
      parameters: { type: O, properties: { action: { type: S }, keyword: { type: S }, group: { type: S }, name: { type: S }, include_blocked: { type: B } } } },
    { name: 'gimis_call', description: 'Run ONE read-only API from the catalog by name on live GIMIS. variables = JSON text with only the arguments you need (paging defaults {first:0,size:100,sortBy:updatedAt,sortDirection:DESC} and exportDocType XLSX are filled for you; dates YYYY-MM-DD). The records become a dataset (save_as) with a profile of columns and totals; report APIs that return Excel are read automatically. For long lists set fetch_all_pages=true (+ max_rows). Then use dataset_query / create_file / create_chart. Unknown variables, bad dates and blocked APIs are refused with a clear message.',
      parameters: { type: O, properties: { name: { type: S }, variables: { type: S, description: 'JSON text of the variables' }, save_as: { type: S }, rows_path: { type: S }, explode: { type: S }, fetch_all_pages: { type: B }, max_rows: { type: N } }, required: ['name'] } },
    { name: 'workspace', description: 'Manage datasets in the workspace. action=list | peek (name, offset, limit<=50, columns) | drop | clear | rename (name, new_name).',
      parameters: { type: O, properties: { action: { type: S }, name: { type: S }, new_name: { type: S }, offset: { type: N }, limit: { type: N }, columns: { type: 'ARRAY', items: { type: S } } } } },
    { name: 'dataset_query', description: 'Filter / group / aggregate / sort a dataset without writing code (like SQL). where = JSON text [{"col":"Status","op":"=","value":"issued"}] (ops: = != > >= < <= contains startswith endswith in between isnull notnull). group_by = columns; a date column can be bucketed as "Issue Date:month" (day|week|month|year). aggs = JSON text [{"col":"Qty","fn":"sum","as":"litres"}] (fn: sum avg min max count count_distinct; col "*" for count). order_by = JSON text [{"col":"litres","dir":"desc"}]. save_as stores the result as a new dataset (use it for files and charts).',
      parameters: { type: O, properties: { dataset: { type: S }, where: { type: S }, group_by: { type: 'ARRAY', items: { type: S } }, aggs: { type: S }, select: { type: 'ARRAY', items: { type: S } }, order_by: { type: S }, limit: { type: N }, distinct: { type: B }, save_as: { type: S } }, required: ['dataset'] } },
    { name: 'run_code', description: 'CODE INTERPRETER: run JavaScript (body of an async function; you may await and return a small JSON result) in an isolated sandbox with NO network. Use it for calculations that dataset_query cannot do, reshaping data, and custom files. Variables: data (object: dataset name -> array of row objects; only datasets named in the code or in "datasets" are loaded); files.xlsx(name, sheets) where sheets=[{name, title?, rows (arrays or objects), columns?, totals?}]; files.csv(name, rows); files.docx(name, markdown, opts); await files.pdf(name, markdown, opts); files.html(name, htmlOrMarkdown); files.text(name, t); files.json(name, obj); await files.chart(name, {type:"bar|hbar|line|area|pie|donut", title, labels:[], series:[{name, values:[]}], stacked}) returns a PNG name you can embed as ![](name) in the markdown of docx/pdf; await files.image(name, svgString); util.sum(rows,col) util.groupBy(rows,col) util.uniq util.round util.fmt util.day util.month; saveDataset(name, rows); print(...). Markdown supports # headings, lists, **bold**, tables, > quotes, ---, [[pagebreak]].',
      parameters: { type: O, properties: { code: { type: S }, datasets: { type: 'ARRAY', items: { type: S } }, timeout_s: { type: N } }, required: ['code'] } },
    { name: 'create_file', description: 'Create a downloadable file for the user. type: xlsx | docx | pdf | csv | html | txt | md | json | svg. xlsx: "sheets" = JSON text [{"name":"LPO","dataset":"depot_lpo","title":"Ripoti...","columns":["a","b"],"totals":true},{"name":"Muhtasari","columns":["K","V"],"rows":[["x",1]]}] (a dataset sheet is filled automatically; cells starting with = are formulas; totals adds SUM formulas) or just "dataset". docx/pdf/html/txt/md: "content" in markdown; put {{table:dataset|max_rows|col1,col2}} to insert a table straight from a dataset (do not retype data) and ![caption](chart.png) to embed a chart made by create_chart/run_code. orientation: portrait | landscape (use landscape for wide tables). html may also be a complete HTML page (dashboards, forms, calculators with JavaScript).',
      parameters: { type: O, properties: { type: { type: S }, filename: { type: S }, content: { type: S }, sheets: { type: S }, dataset: { type: S }, columns: { type: 'ARRAY', items: { type: S } }, title: { type: S }, totals: { type: B }, orientation: { type: S } }, required: ['type', 'filename'] } },
    { name: 'create_chart', description: 'Draw a chart as a PNG (shown to the user and embeddable in documents). type: bar | hbar | line | area | pie | donut. From a dataset: x = category column (date buckets allowed: "Issue Date:month"), y = numeric column(s) comma separated (omit y to count rows), agg = sum | avg | count | min | max, where (JSON text like dataset_query), top_n, sort asc|desc|none, stacked. Or give labels (JSON text array) and series (JSON text [{"name":"..","values":[..]}]).',
      parameters: { type: O, properties: { type: { type: S }, title: { type: S }, dataset: { type: S }, x: { type: S }, y: { type: S }, agg: { type: S }, where: { type: S }, top_n: { type: N }, sort: { type: S }, stacked: { type: B }, labels: { type: S }, series: { type: S }, x_title: { type: S }, y_title: { type: S }, filename: { type: S }, width: { type: N }, height: { type: N } }, required: ['type'] } },
    { name: 'create_image', description: 'Create a picture (poster, diagram, flow chart, org chart, banner, certificate, infographic) by writing SVG yourself; it is rendered to PNG and also kept as SVG. Give a complete <svg> with width, height and viewBox; use only inline shapes/text (no scripts, no external images). Keep texts readable and inside the canvas.',
      parameters: { type: O, properties: { svg: { type: S }, filename: { type: S }, scale: { type: N } }, required: ['svg'] } }
  ];
  const ENGINE_TOOLS = ['load_data', 'gimis_api_catalog', 'gimis_call', 'gimis_query', 'gimis_schema', 'gimis_find_api', 'workspace', 'dataset_query', 'run_code', 'create_file', 'create_chart', 'create_image'];

  const cap = (v, n) => { let s = JSON.stringify(v); if (s.length <= n) return v; return { truncated: true, note: 'Result was cut because it is too long; narrow the filters.', preview: s.slice(0, n) }; };
  const trimDoc = (d) => { const o = {}; Object.keys(d).forEach((k) => { let v = d[k]; if (typeof v === 'string') { if (v.length > 400 || /^data:/.test(v)) v = '[long text omitted]'; } else if (v && typeof v === 'object') { const s = JSON.stringify(v); if (s.length > 800) v = '[large object omitted]'; } o[k] = v; }); return o; };

  async function runTool(name, a, env) {
    a = a || {};
    const lim = (d, m) => Math.max(1, Math.min(Number(a.limit) || d, m));
    const data = async (refresh) => mergeData(await env.loadLocal(), await env.loadCloud(!!refresh));
    const rt = env.resText;
    const cp = (r) => compact(r, rt, r.__src);
    switch (name) {
      case 'data_overview': {
        const all = await data(a.refresh_cloud), cloudOk = env.cloudStatus ? env.cloudStatus() : null;
        const parts = { not_issued: 0, failed: 0, issued: 0 }; let lit = 0, est = 0, tSum = 0, tN = 0, oldest = null;
        const src = {};
        all.forEach((r) => { const p = partOf(r, rt); parts[p]++; src[r.__src] = (src[r.__src] || 0) + 1;
          if (p === 'issued') { lit += litres(r); est += estTotal(r); const i = issuedMs(r); if (i && r.addedAt && i >= r.addedAt) { tSum += i - r.addedAt; tN++; } }
          if (p !== 'issued' && r.addedAt && (!oldest || r.addedAt < oldest.addedAt)) oldest = r; });
        return { total_tokens: all.length, parts, litres_issued: lit, est_value_issued_tzs: est, avg_hours_saved_to_issued: tN ? Math.round(tSum / tN / 36e5 * 10) / 10 : null,
          oldest_waiting: oldest ? cp(oldest) : null, data_lives: src, cloud: cloudOk, firebase_collections_allowed: env.collections || [], now: iso(Date.now()) };
      }
      case 'search_tokens': {
        const all = await data(false), q = lc(a.query), ins = lc(a.institution), pb = lc(a.permitted_by), rc = lc(a.reason_contains);
        const from = a.saved_from ? Date.parse(a.saved_from + 'T00:00:00+03:00') : null, to = a.saved_to ? Date.parse(a.saved_to + 'T23:59:59+03:00') : null;
        const rows = all.filter((r) => {
          const p = partOf(r, rt);
          if (a.part && p !== a.part) return false; if (a.status && r.status !== a.status) return false;
          if (ins && !lc(inst(r)).includes(ins)) return false; if (pb && !lc(r.permittedBy).includes(pb)) return false;
          if (rc && !lc(rt(r)).includes(rc)) return false;
          if (from && (r.addedAt || 0) < from) return false; if (to && (r.addedAt || 0) > to) return false;
          if (q && ![r.token, r.chassis, inst(r), r.permittedBy, r.ref, (r.detail || {}).ref, rt(r)].map(lc).join(' ').includes(q)) return false;
          return true; }).sort((x, y) => (y.addedAt || 0) - (x.addedAt || 0));
        return { total_matches: rows.length, shown: Math.min(rows.length, lim(25, 60)), rows: rows.slice(0, lim(25, 60)).map(cp) };
      }
      case 'vehicle_history': {
        const c = lc(a.chassis).replace(/\s+/g, ''), all = (await data(false)).filter((r) => lc(r.chassis).replace(/\s+/g, '').includes(c) && c);
        return { vehicle: a.chassis, tokens: all.length, rows: all.sort((x, y) => (y.addedAt || 0) - (x.addedAt || 0)).slice(0, 60).map(cp) };
      }
      case 'group_stats': {
        const all = (await data(false)).filter((r) => !a.part || partOf(r, rt) === a.part), g = {};
        const keyOf = { institution: (r) => inst(r) || '(unknown)', permitted_by: (r) => r.permittedBy || '(unknown)', status: (r) => r.status, part: (r) => partOf(r, rt),
          reason: (r) => rt(r) || '(no problem recorded)', fuel: (r) => fuel(r) || '(unknown)', day: (r) => dayOf(r.addedAt) || '(unknown)', month: (r) => dayOf(r.addedAt).slice(0, 7) || '(unknown)' }[a.group_by];
        if (!keyOf) return { error: 'group_by must be institution | permitted_by | status | part | reason | fuel | day | month' };
        all.forEach((r) => { const k = keyOf(r); const x = g[k] || (g[k] = { group: k, tokens: 0, litres: 0, est_value_tzs: 0 }); x.tokens++; x.litres += litres(r); x.est_value_tzs += estTotal(r); });
        let rows = Object.values(g); rows = /day|month/.test(a.group_by) ? rows.sort((x, y) => x.group < y.group ? -1 : 1).slice(-lim(31, 62)) : rows.sort((x, y) => y.tokens - x.tokens).slice(0, lim(15, 40));
        return { group_by: a.group_by, total_tokens: all.length, rows };
      }
      case 'gimis_lookup_token': { const r = await env.gimis('aiLookup', { token: String(a.token || '').trim(), chassis: a.chassis ? String(a.chassis).trim() : null }); return r.ok ? r.result : { error: r.error }; }
      case 'gimis_my_tokens': { const r = await env.gimis('aiMyTokens', { limit: lim(100, 300) }); return r.ok ? { total_in_gimis: r.total, shown: r.list.length, list: r.list } : { error: r.error }; }
      case 'gimis_requisition': { const r = await env.gimis('aiRequisition', { id: a.requisition_id }); return r.ok ? cap(r.result, 9000) : { error: r.error }; }
      case 'gimis_issue_notes': { const r = await env.gimis('aiNotes', { id: a.requisition_id }); return r.ok ? cap(r.result, 9000) : { error: r.error }; }
      case 'gimis_error_codes': return env.codes();
      case 'firebase_read_collection': {
        const col = String(a.collection || '').trim();
        if (!(env.collections || []).includes(col)) return { error: 'Collection "' + col + '" is not allowed. Allowed: ' + (env.collections || []).join(', ') };
        const docs = await env.readCollection(col), t = lc(a.contains), fields = {};
        docs.slice(0, 80).forEach((d) => Object.keys(d).forEach((k) => { fields[k] = 1; }));
        const hit = t ? docs.filter((d) => lc(JSON.stringify(d)).includes(t)) : docs;
        return { collection: col, total_documents: docs.length, fields: Object.keys(fields), matches: hit.length, documents: hit.slice(0, lim(20, 40)).map(trimDoc) };
      }
      case 'remember_lesson': { const t = String(a.text || '').trim().slice(0, 500); if (t.length < 8) return { error: 'Lesson too short.' }; await env.addLesson(t); return { saved: true }; }
      default:
        if (ENGINE_TOOLS.includes(name) && env.engine && env.engine.tools[name]) return env.engine.tools[name](a);
        return { error: 'Unknown tool ' + name };
    }
  }

  // ---------- learned digest (computed from real data; stored and sent to the model as background knowledge) ----------
  function buildDigest(all, resText, codes, cols) {
    const parts = { not_issued: 0, failed: 0, issued: 0 }, ins = {}, why = {}, who = {}, perVeh = {}, month = {}; let tSum = 0, tN = 0;
    all.forEach((r) => {
      const p = partOf(r, resText); parts[p]++;
      const i = inst(r) || '(unknown)'; const x = ins[i] || (ins[i] = { n: 0, l: 0, bad: 0 }); x.n++; x.l += litres(r); if (p === 'failed') x.bad++;
      if (p === 'failed') { const w = (resText ? resText(r) : '') || '(no message)'; why[w] = (why[w] || 0) + 1; }
      if (r.permittedBy) who[r.permittedBy] = (who[r.permittedBy] || 0) + 1;
      const v = lc(r.chassis).replace(/\s+/g, ''); if (v) perVeh[v] = (perVeh[v] || 0) + 1;
      const m = dayOf(r.addedAt).slice(0, 7); if (m) month[m] = (month[m] || 0) + 1;
      const is = issuedMs(r); if (p === 'issued' && is && r.addedAt && is >= r.addedAt) { tSum += is - r.addedAt; tN++; }
    });
    const top = (o, n, f) => Object.keys(o).map((k) => f(k, o[k])).sort((a, b) => b.n - a.n).slice(0, n);
    return { at: Date.now(), total: all.length, parts,
      avg_hours_saved_to_issued: tN ? Math.round(tSum / tN / 36e5 * 10) / 10 : null,
      top_institutions: top(ins, 8, (k, v) => ({ name: k, n: v.n, litres: v.l, failed: v.bad })),
      failure_reasons: top(why, 8, (k, v) => ({ reason: k, n: v })),
      top_permitters: top(who, 6, (k, v) => ({ name: k, n: v })),
      vehicles_with_many_tokens: top(perVeh, 5, (k, v) => ({ chassis: k, n: v })).filter((x) => x.n > 1),
      tokens_per_month: month, gimis_codes: codes || {}, firebase_collections: cols || {} };
  }

  // ---------- prompt ----------
  const KNOWLEDGE = `
MUKTADHA (GPSA Kinondoni & GIMIS):
- GPSA Kinondoni (Dar es Salaam) inauzia mafuta taasisi za serikali kupitia mfumo wa GIMIS (gimis.gpsa.go.tz).
- Mtiririko wa kawaida: taasisi inaomba mafuta (Store Management) -> inapewa Control Number -> inalipa benki -> GIMIS inatengeneza TOKEN (Issue Note Token) -> mteja anakuja kituoni na token + gari -> pump attendant anaingia GET ISSUE NOTE TOKEN, anaweka Token + Vehicle Reg No (chassis), bonyeza REQUEST, kisha SAVE (inaitwa "issue") -> malipo yanapokelewa na mafuta yanajazwa.
- GIMIS husumbua (haisave, au ina-load tu). Wafanyakazi huandika Token + Chassis + Jina la taasisi kwenye daftari, kisha huzi-issue baadaye. Kila token ina maisha ya siku 7 tu; ikichelewa inaexpire na kituo kinapoteza mapato.
- Extension hii ("Gimis Charms") huhifadhi token + chassis + jina la aliye-permit (kwa audit), kuziissue kwa wingi, na kucheki kama zimeissue. Data huhifadhiwa kwenye kompyuta na Supabase (collection gpsaQueue).
- Hali (status): pending = bado haijaissue; issued = GIMIS imeissue; failed = ilishindwa mara nyingi. Sehemu 3: "Not issued yet" (pending bila tatizo), "Failed to issue" (failed, au pending yenye sababu kutoka GIMIS), "Issued successfully".
- Misimbo ya GIMIS: 9000 = mafanikio; 9002 = No Record Found (token haipo, namba/chassis si sahihi, au imeexpire). Sababu kamili hutolewa na extension: wrong chassis (gari tofauti), token_unknown, token already used, token expired.
- Token ni ufunguo wa kipekee; token ikirudiwa na chassis tofauti hukataliwa. "P.I.M.P" = kuomba GIMIS irenew token iliyoexpire bila kuissue (GIMIS ikionyesha haijatumika na imeshaexpire).
- Thamani ya makadirio = lita x bei kwa lita (si kiasi rasmi kilicholipwa).
- Kituo: GPSA KINONDONI (Dar es Salaam). Mafuta makuu: Diesel na Petrol (bin card item id: Diesel 5, Petrol 6). Fedha ni TZS.
- Ripoti zinazopatikana kwa load_data: issue_notes_report (kila issue note item: Tokens, Means Of Transprot, Item, Qty, Status, Is Used, Issue Date, Reference, Institution), depot_lpo_report (LPO za mafuta: LPO Number, Item, LPO Date, Qty Ordered, Qty Received, Unit Price, LPO Value, Status = RECEIVED / PARTIAL RECEIVED / NOT RECEIVED), bin_card (miamala ya stoo: quantity, currentStock, transactionStatus, unitBuyPrice, unitSalePrice, invoiceNo, receiptVoucherNo, trackingNumber).
- API za GIMIS: angalia sehemu "KATALOGI YA API ZA GIMIS" hapa chini.
`;

  // ---------- overview of the GIMIS API catalog (taught to the model on every request; details come from gimis_api_catalog) ----------
  function catalogText() {
    const c = root.GIMIS_API_CATALOG; if (!c) return '(katalogi haijapakiwa - tumia gimis_schema / gimis_find_api)';
    const by = {}; Object.keys(c.ops).forEach((n) => { const o = c.ops[n]; if (o.s) (by[o.g] = by[o.g] || []).push([n, o.c || 0]); });
    const lines = Object.keys(by).map((g) => '- ' + g + ' (' + by[g].length + '): ' + c.groups[g] + ' -> ' + by[g].sort((a, b) => b[1] - a[1]).slice(0, 5).map((x) => x[0]).join(', ')).join('\n');
    return 'Una katalogi ya API ' + c.meta.total + ' za GIMIS zilizonaswa kutoka GIMIS halisi (' + c.meta.readSafe + ' unaweza kuziendesha - za KUSOMA; ' + c.meta.blocked + ' zinabadilisha data na zimezuiwa kwako). Makundi:\n' + lines +
      '\nNAMNA YA KUTUMIA: (1) gimis_api_catalog action=search keyword=... (au groups) kupata API; (2) action=describe name=... kuona vigezo na fields; (3) gimis_call name=... variables={...} save_as=... kuiendesha - matokeo yanakuwa dataset; (4) dataset_query / create_file / create_chart. Kila jina la API litoke kwenye katalogi - usibuni. Ikikosekana kwenye katalogi, ndipo tumia gimis_schema / gimis_find_api. Mtu akiomba kitendo cha kubadilisha (issue, save, submit, create, update, delete, approve, renew) - hakipo kwako: mwelekeze kwenye kitufe cha dashboard au ukurasa husika wa GIMIS.';
  }
  const SOURCES = `CHANZO CHA DATA - chagua kwa mpangilio huu:
(a) Token zilizohifadhiwa, hali zao (not issued / failed / issued), historia ya gari, takwimu za ofisi -> search_tokens, vehicle_history, group_stats, data_overview. Hizi zinatoka extension storage (kompyuta hii) na Supabase gpsaQueue; hakuna ombi kwa GIMIS.
(b) Collections nyingine za Supabase zilizoruhusiwa -> firebase_read_collection au load_data source=firebase_collection.
(c) Hali ya SASA ya GIMIS (token ipo hai?, request, LPO, bin card, wallet, bills, ripoti za kipindi) -> gimis_api_catalog kisha gimis_call (token moja: gimis_lookup_token).
(d) Swali linalohitaji vyote (mfano \"token zetu zilizo pending bado zipo hai GIMIS?\") -> anza na (a), kisha thibitisha na (c). Kwenye jibu sema kila takwimu imetoka wapi: \"kompyuta hii\", \"Supabase\" au \"GIMIS (jina la API)\". Data za (a) zikipingana na (c), ya GIMIS ndiyo ya sasa.`;
  function systemPrompt(ctx) {
    const les = (ctx.lessons || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0)); let lt = '', n = 0;
    for (const l of les) { const line = '- ' + String(l.text).replace(/\s+/g, ' ').slice(0, 500) + '\n'; if (lt.length + line.length > 6000 || n >= 40) break; lt += line; n++; }
    const dg = ctx.digest ? JSON.stringify(ctx.digest).slice(0, 4000) : '(bado haijajifunza - bonyeza "Learn now")';
    const ws = ctx.workspace ? String(ctx.workspace).slice(0, 2500) : '(tupu)';
    return `Wewe ni "elapsAI", msaidizi mahiri wa Kiswahili ndani ya extension ya GPSA GIMIS Token Helper, na mfanyakazi-dijitali wa taasisi ya GPSA kituo cha Kinondoni. Ukijitambulisha, sema: mimi ni elapsAI, nipo hapa kwa ajili ya kusaidia taasisi ya GPSA kituo cha Kinondoni.
Una uwezo wa kina: kuelewa ombi lolote la kikazi, kusoma data halisi ya GIMIS na Supabase, kuichambua (hata kwa kuandika na kuendesha code), na kutengeneza matokeo yaliyokamilika - Excel, Word, PDF, CSV, ukurasa wa HTML/dashboard, chati, na picha/michoro - kwa ubora wa mtaalamu, kama msaidizi wa kiwango cha juu.

MTIRIRIKO WA KAZI (kwa kila ombi la kazi, si salamu):
1. ELEWA: lengo la mtumiaji ni nini hasa, kipindi gani, kwa nani, na muundo gani wa matokeo (jedwali, ripoti, chati, barua). Ukikosa jambo dogo, chagua dhana yenye mantiki (kipindi = mwezi huu, kituo = Kinondoni), itaje kwa sentensi moja kwenye jibu, kisha endelea. Uliza swali moja tu pale ambapo huwezi kuendelea kabisa.
2. PANGA: fikiria hatua zote kabla ya kuanza (data gani, ipi ya kuchuja/kujumlisha, faili gani). Fanya hatua nyingi kwa mfuatano bila kumsumbua mtumiaji.
3. KUSANYA DATA: tumia load_data (ripoti na token), zana za token/GIMIS zilizopo, au gimis_query kwa API nyingine. Data kubwa HAIPITI kwako - inakaa kwenye workspace; unaona muhtasari (safu, aina, jumla, sampuli). Angalia safu halisi kabla ya kuziandika (usibahatishe majina).
4. CHAMBUA: dataset_query kwa kuchuja/kupanga/kujumlisha; run_code kwa hesabu ngumu au umbo maalum. Kagua matokeo kwa mantiki (jumla zinalingana? tarehe sahihi? sampuli ina maana?).
5. TENGENEZA: create_file (xlsx/docx/pdf/csv/html/...), create_chart, create_image au run_code. Weka jedwali kubwa kwa {{table:dataset|...}} badala ya kuandika data tena. Kwenye ripoti weka chati kwa ![maelezo](jina.png) baada ya kuiunda.
6. THIBITISHA: hakikisha faili limeundwa (jibu la zana lina "file"). Zana ikikosea, soma ujumbe wa kosa, rekebisha na ujaribu tena (hadi mara 3) - kwa mfano jina la safu, JSON, query ya GraphQL. Sandbox ikishindikana, tumia dataset_query + create_file.
7. JIBU: kwa Kiswahili chenye mpangilio: (a) kilichofanyika kwa sentensi 1-2, (b) takwimu kuu au jedwali dogo (si zaidi ya safu 15), (c) majina ya faili ulizotengeneza (mtumiaji anaziona kama kadi za kupakua chini ya jibu - usiandike viungo), (d) dhana ulizotumia na hatua inayofuata ukiona inafaa. Usibandike JSON ghafi wala orodha ndefu.

ZANA - uchaguzi: swali la token/gari/taasisi kutoka data iliyohifadhiwa -> search_tokens, group_stats, vehicle_history. Token moja sasa hivi GIMIS -> gimis_lookup_token. Ripoti ya kipindi -> load_data. API ya GIMIS -> gimis_api_catalog (search/describe) kisha gimis_call; isiyo kwenye katalogi -> gimis_schema (describe) au gimis_find_api (search) kisha gimis_query. Takwimu -> dataset_query. Hesabu maalum -> run_code. Matokeo -> create_file / create_chart / create_image.

VIWANGO VYA UBORA:
- Excel: vichwa vya habari vilivyo wazi (Kiswahili au kama ilivyo kwenye GIMIS), safu zenye maana tu, jumla (totals:true) pale zinapofaa, sheet ya "Muhtasari" kwa ripoti kubwa, majina ya sheet mafupi, majina ya faili yenye tarehe (mfano ripoti_lpo_2026-10).
- Word/PDF: kichwa cha ripoti, kipindi na kituo, muhtasari mkuu (hoja 3-5), jedwali/chati, hitimisho na mapendekezo, na mahali pa saini pale ni barua/ripoti rasmi. Tumia landscape kwa jedwali lenye safu zaidi ya 6.
- Chati: kichwa wazi, vipimo (lita, TZS) kwenye kichwa au axis, usizidishe makundi 12 (tumia top_n), pie/donut tu kwa makundi machache.
- HTML/dashboard: ukurasa mmoja unaojitegemea (CSS/JS ndani), responsive, rangi za kijani za GPSA, hakuna maombi ya mtandao.
- Picha/michoro (create_image): SVG kamili, maandishi yasitoke nje ya mpaka, rangi zenye utofauti mzuri, vichwa vikubwa.
- Namba: tenganisha maelfu (1,234,567), tarehe kama YYYY-MM-DD au "21 Okt 2026", TZS kwa fedha. Kamwe usibuni data; kila kitu kitoke kwenye zana.

SHERIA:
1. Jibu kwa Kiswahili sanifu chenye mpangilio mzuri (lugha ya swali ikiwa Kiingereza, jibu Kiingereza). Jibu fupi na wazi; tumia jedwali au orodha pale inapofaa.
2. Kamwe usibuni namba, token, chassis au majina. Kila takwimu lazima itoke kwenye zana (tools) au kwenye "MUHTASARI ULIOJIFUNZWA" hapa chini. Ukikosa data, sema hujapata na pendekeza hatua.
3. USALAMA: kila kitu ni cha KUSOMA tu. Huwezi ku-issue, ku-save, kufuta, kurenew token wala kubadilisha chochote GIMIS (gimis_query inakataa mutation na field za kubadilisha). Mtumiaji akiomba hivyo, mwelekeze atumie vitufe vya dashboard (Issue selected, Check issued, P.I.M.P). Code yako inaendeshwa kwenye sandbox isiyo na mtandao - usijaribu kutuma data nje.
4. Swali la GIMIS ya moja kwa moja (token fulani sasa hivi) tumia gimis_lookup_token. Ikirudisha NO_TOKEN (au zana yoyote ya GIMIS ikisema kikao hakijanaswa), mwambie afungue ukurasa "Get Issue Note Token" ndani ya GIMIS mara moja kisha aulize tena.
5. Maswali ya "kwa nini" / mantiki (algorithm): eleza hatua kwa hatua kulingana na sheria za mfumo hapa chini na data halisi; taja sababu iliyorekodiwa na GIMIS (reason).
6. Usionyeshe barua pepe au namba za simu. Usitaje funguo za siri (access token, API keys).
7. Mtumiaji akikufundisha au kukusahihisha jambo la kudumu ("kumbuka...", "ukweli ni..."), tumia remember_lesson kisha mshukuru kwa ufupi. Query ya GraphQL iliyofanya kazi vizuri na inayoweza kutumika tena: ihifadhi kwa gimis_find_api action=save.
8. Pesa ni TZS. Tarehe zote ni saa za Dar es Salaam. Sasa hivi ni ${iso(Date.now())}. Workspace huwa tupu ukurasa ukipakiwa upya - ikiwa dataset haipo, ipakie tena kwa load_data.
9. Mtumiaji akiambatisha faili: picha/PDF unaziona moja kwa moja; Excel/CSV zimeshawekwa kama dataset (jina linaonyeshwa kwenye ujumbe) - chambua kwa dataset_query bila kuziuliza tena.
10. LUGHA NA SALAMU (muhimu sana): Tumia Kiswahili fasaha, sanifu na cha kitaaluma, bila sheng wala lugha ya mtaani, ukiweka heshima na upole wa mtaalamu wa huduma kwa wateja. Epuka kuchanganya Kiingereza isipokuwa istilahi za mfumo (token, chassis, issue, GIMIS). Andika "kwa ajili ya" (si "kwaajili"). Jibu salamu kwa usahihi: "Habari" / "Habari yako" -> "Salama" (au "Nzuri"); "Habari za asubuhi/mchana/jioni" -> "Nzuri"; "Hujambo" -> "Sijambo"; "Hamjambo" -> "Hatujambo"; "Shikamoo" -> "Marahaba" (HILI TU kwa "Shikamoo" - kamwe usijibu "Marahaba" kwa "Habari" au "Mambo"); "Mambo" -> "Salama" au "Poa"; "Salaam" -> "Wa alaykum salaam"; "Asante" -> "Karibu sana"; "Kwaheri" -> "Kwaheri, karibu tena". Baada ya salamu, uliza kwa upole unaweza kusaidia nini. Tumia sentensi kamili, zenye mpangilio mzuri, na uandike tarakimu na tarehe kwa uwazi.
${KNOWLEDGE}
KATALOGI YA API ZA GIMIS (v2.21):
${catalogText()}

${SOURCES}

WORKSPACE SASA (datasets zilizopo): ${ws}

MASOMO ULIYOFUNZWA NA WATUMIAJI (yazingatie, yanapita dhana zako):
${lt || '(hakuna bado)'}
MUHTASARI ULIOJIFUNZWA KUTOKA KWENYE DATA (kwa muktadha tu; kwa takwimu kamili tumia zana):
${dg}`;
  }

  // ---------- the loop: Gemini <-> tools ----------
  async function ask(o) {
    const { question, history, env, gemini, lessons, digest, onStep } = o, max = o.maxSteps || 16;
    const contents = (history || []).slice(-12).map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: String(m.text) }] }));
    contents.push({ role: 'user', parts: [{ text: question }].concat(o.attachments || []) });
    const base = { systemInstruction: { parts: [{ text: systemPrompt({ lessons, digest, workspace: o.workspace }) }] }, generationConfig: { temperature: 0.2, maxOutputTokens: 8192 } };
    const used = []; let model = null;
    for (let step = 0; step <= max; step++) {
      const last = step === max;
      // keep the context small on long jobs: shrink older tool results (the newest two turns stay intact)
      if (step > 3) { let size = 0; contents.forEach((c) => { size += JSON.stringify(c).length; }); if (size > 140000) contents.slice(0, -3).forEach((c) => { if (c.role === 'user') c.parts.forEach((p) => { if (p.functionResponse) { const t = JSON.stringify(p.functionResponse.response); if (t.length > 1800) p.functionResponse.response = { result: { shortened: true, preview: t.slice(0, 1500) } }; } }); }); }
      const body = Object.assign({ contents }, base, { tools: [{ functionDeclarations: DECLS }], toolConfig: { functionCallingConfig: { mode: last ? 'NONE' : 'AUTO' } } });
      const r = await gemini(body); model = r.model || model;
      const j = r.json || {}, cand = (j.candidates || [])[0];
      if (!cand || !cand.content) {
        const why = (j.promptFeedback && j.promptFeedback.blockReason) || (cand && cand.finishReason) || 'EMPTY';
        return { text: 'Gemini haikurudisha jibu (' + why + '). Jaribu kuuliza kwa maneno mengine.', tools: used, model };
      }
      const parts = cand.content.parts || [], calls = parts.filter((p) => p.functionCall);
      if (!calls.length || last) {
        const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
        return { text: text || 'Sijapata jibu kamili. Jaribu tena.', tools: used, model, truncated: cand.finishReason === 'MAX_TOKENS' };
      }
      contents.push({ role: 'model', parts });            // keep the model's parts exactly (thought signatures included)
      const resp = [];
      for (const p of calls) {
        const fc = p.functionCall; used.push({ name: fc.name, args: fc.args || {} });
        if (onStep) onStep(fc.name, fc.args || {});
        let out; try { out = await runTool(fc.name, fc.args, env); } catch (e) { out = { error: String((e && e.message) || e) }; }
        const fr = { name: fc.name, response: { result: cap(out, 14000) } }; if (fc.id) fr.id = fc.id;
        resp.push({ functionResponse: fr });
      }
      contents.push({ role: 'user', parts: resp });
    }
    return { text: 'Imeshindwa kukamilisha.', tools: used, model };
  }

  // ---------- tiny, safe markdown -> HTML for the answers ----------
  function mdToHtml(src) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const inl = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const lines = String(src || '').replace(/\r/g, '').split('\n'); let out = '', i = 0, ul = false;
    const closeUl = () => { if (ul) { out += '</ul>'; ul = false; } };
    while (i < lines.length) {
      const ln = lines[i];
      if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        closeUl(); const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        out += '<table><tr>' + cells(ln).map((c) => '<th>' + inl(c) + '</th>').join('') + '</tr>'; i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { out += '<tr>' + cells(lines[i]).map((c) => '<td>' + inl(c) + '</td>').join('') + '</tr>'; i++; }
        out += '</table>'; continue;
      }
      const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(ln);
      if (m) { if (!ul) { out += '<ul>'; ul = true; } out += '<li>' + inl(m[1]) + '</li>'; }
      else if (/^#{1,4}\s+/.test(ln)) { closeUl(); out += '<h5>' + inl(ln.replace(/^#{1,4}\s+/, '')) + '</h5>'; }
      else if (!ln.trim()) { closeUl(); }
      else { closeUl(); out += '<p>' + inl(ln) + '</p>'; }
      i++;
    }
    closeUl(); return out;
  }

  const api = { ask, runTool, mergeData, compact, partOf, buildDigest, systemPrompt, mdToHtml, DECLS, iso };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GpsaAI = api;
})(typeof window !== 'undefined' ? window : globalThis);
