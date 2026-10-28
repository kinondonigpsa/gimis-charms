// ai.js — "AI Assistant" tab: chat UI + wiring between Gemini (via background.js), the token list, Supabase and GIMIS (read-only).
(() => {
  const H = window.__gpsaHooks, AI = window.GpsaAI, LOGO = chrome.runtime.getURL('elapsai-logo.png');
  if (!H || !AI) return;
  const { root, $, store, cloudMsg, esc, resText } = H;
  const CFG = 'gpsaAICfg', LES = 'gpsaAILessons', LESDEL = 'gpsaAILessonsDel', DIG = 'gpsaAIDigest', CHAT = 'gpsaAIChat';
  const DEF_MODEL = 'gemini-flash-latest';
  const ALT = [{ id: 'groq', name: 'Groq', def: 'llama-3.3-70b-versatile', url: 'console.groq.com/keys' }, { id: 'openrouter', name: 'OpenRouter', def: 'openrouter/free', url: 'openrouter.ai/keys' }, { id: 'mistral', name: 'Mistral', def: 'mistral-small-latest', url: 'console.mistral.ai/api-keys' }];
  let cfg = { apiKey: '', model: DEF_MODEL, apiBase: '', collections: '', keys: {}, models: {}, prefer: 'auto' }, lessons = [], digest = null, chat = [], busy = false, opened = false;
  let cloud = { at: 0, items: [], ok: false }, colCache = {}, connected = null;

  const style = document.createElement('style');
  style.textContent = `
    #aiv{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;padding:8px;border:1px solid #e5e7eb;border-radius:8px;background:rgba(255,255,255,.94)}
    #aiv .ah{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    #aiv .ah b{font-size:17px;color:#166534} #aiv .ah small{color:#6b7280}
    #aiSet{border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;padding:8px;font-size:15px;display:grid;gap:6px}
    #aiSet label{font-weight:bold;display:block;margin-bottom:2px} #aiSet .hint{color:#6b7280;font-size:14px;font-weight:normal}
    #aiSet .r2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    #aiLes{max-height:130px;overflow:auto;border:1px solid #e5e7eb;border-radius:6px;background:#fff}
    #aiLes div{display:flex;gap:6px;align-items:flex-start;padding:3px 6px;border-bottom:1px solid #f1f1f1;font-size:15px} #aiLes div span{flex:1}
    #aiLes button{padding:0 6px;background:#9ca3af}
    #aiMsgs{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:4px}
    .bb{max-width:88%;padding:8px 11px;border-radius:12px;font-size:16px;line-height:1.5;word-break:break-word}
    .bb.u{align-self:flex-end;background:#dcfce7;border:1px solid #bbf7d0;white-space:pre-wrap}
    .bb.a{align-self:flex-start;background:#fff;border:1px solid #e5e7eb}
    .bb.e{align-self:flex-start;background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
    .bb p{margin:0 0 6px} .bb p:last-child{margin:0} .bb ul{margin:2px 0 6px 18px;padding:0} .bb h5{margin:6px 0 4px;font-size:16px;color:#166534}
    .bb table{border-collapse:collapse;margin:4px 0;font-size:15px;display:block;overflow:auto;max-width:100%} .bb th,.bb td{border:1px solid #e5e7eb;padding:3px 7px;text-align:left} .bb th{background:#f3f4f6}
    .bb code{background:#f3f4f6;padding:0 3px;border-radius:3px}
    .stp{align-self:flex-start;color:#6b7280;font-size:14px;padding:0 4px}
    .fb{margin-top:4px;display:flex;gap:6px;align-items:center;font-size:14px;color:#6b7280} .fb button{padding:1px 7px;background:#e5e7eb;color:#111}
    #aiChips{display:flex;gap:6px;flex-wrap:wrap} #aiChips button{background:#ecfdf5;color:#166534;border:1px solid #bbf7d0;padding:4px 9px;border-radius:14px}
    .fc{display:flex;gap:8px;align-items:center;margin-top:6px;padding:6px 8px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px;font-size:15px} .fc .ic{font-size:22px} .fc .nm{flex:1;min-width:0;word-break:break-all} .fc small{color:#6b7280;display:block}
    .fc a,.fc button{background:#16a34a;color:#fff;border:0;border-radius:6px;padding:4px 10px;text-decoration:none;cursor:pointer;font-size:14px} .fc button.o{background:#e5e7eb;color:#111}
    .fp{margin-top:6px} .fp img{max-width:100%;border:1px solid #e5e7eb;border-radius:8px;cursor:zoom-in;background:#fff}
    .atc{display:flex;gap:6px;flex-wrap:wrap} .atc span{background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:2px 4px 2px 9px;font-size:14px} .atc span b{cursor:pointer;margin-left:6px;color:#991b1b;padding:0 4px}
    #aiMsgs.drag{outline:3px dashed #16a34a;outline-offset:-6px}
    .tst{display:grid;gap:3px;font-size:15px} .tst .ok{color:#166534} .tst .no{color:#991b1b}
    #aiIn{display:flex;gap:6px;align-items:flex-end} #aiQ{flex:1;height:auto;min-height:38px;max-height:120px;resize:none;border:1px solid #9ca3af;border-radius:10px;padding:8px 12px;font-size:16px;field-sizing:content}
  `;
  root.appendChild(style);

  $('aiv').innerHTML = `
    <div class="ah"><img src="${LOGO}" alt="" style="width:26px;height:26px;border-radius:50%"><b>elapsAI</b><small id="aiSt" hidden style="display:none"></small><span style="margin-left:auto"></span>
      <button class="g" id="aiLearn" title="Read all saved tokens (this computer + Supabase), learn the patterns and save a summary the AI uses as background knowledge">&#128218; Learn now</button>
      <button class="g" id="aiWs" title="Datasets ambazo AI imezipakia kwenye workspace">&#128451; Workspace</button><button class="g" id="aiTest" title="Jaribu kila uwezo wa AI (GIMIS, sandbox ya code, michoro...)">&#129514; Hali ya uwezo</button><button class="g" id="aiGear">&#128218; Masomo</button><button class="g" id="aiClr">Clear chat</button></div>
    <div id="aiSet" hidden>
      <div class="hint">Privacy: your question and the token / institution / vehicle data the AI looks up are sent to the AI provider in use to write the answer. E-mails, phone numbers and GIMIS login keys are never sent.</div>
      <div><label>What the AI has learned (<span id="aiLn">0</span>)</label><div id="aiLes"></div></div>
    </div>
    <div id="aiMsgs"></div>
    <div id="aiChips"></div>
    <div class="atc" id="aiAtc" hidden></div>
    <div id="aiIn"><button class="g" id="aiAttach" title="Ambatisha picha, PDF, Excel, CSV, Word au maandishi">&#128206;</button><input type="file" id="aiFile" multiple hidden accept="image/*,.pdf,.xlsx,.xlsm,.csv,.tsv,.txt,.md,.json,.docx,.html,.xml"><textarea id="aiQ" rows="1" placeholder="Omba chochote: ripoti, Excel, chati, barua, uchambuzi wa data ya GIMIS... (Enter = tuma, Shift+Enter = mstari mpya, 📎 = ambatisha faili)"></textarea><button id="aiGo">Tuma</button></div>`;

  const CHIPS = ['Nipe muhtasari wa token zote', 'Tengeneza Excel ya token zote ambazo bado hazija-issue', 'Pakua issue notes za mwezi huu, kisha unichorere chati ya lita kwa taasisi', 'Andika ripoti ya PDF ya LPO za mafuta za mwezi huu',
    'Linganisha mauzo ya Diesel na Petrol kwa miezi 3 iliyopita (Excel + chati)', 'Tengeneza bango la tangazo la huduma za kituo (picha)', 'Eleza algorithm ya kuissue token hatua kwa hatua'];
  $('aiChips').innerHTML = CHIPS.map((c) => `<button class="g" data-c="${esc(c)}">${esc(c)}</button>`).join('');

  // ---------- storage ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  async function loadAll() {
    cfg = Object.assign(cfg, (await store.get(CFG)) || {});
    const D = (typeof GPSA_DEFAULTS !== 'undefined' && GPSA_DEFAULTS) || {};   // config.js defaults fill whatever is still empty
    if (!cfg.apiKey && D.geminiApiKey) cfg.apiKey = String(D.geminiApiKey).trim();
    if ((!cfg.model || cfg.model === DEF_MODEL) && D.geminiModel) cfg.model = D.geminiModel;
    cfg.keys = Object.assign({}, cfg.keys); cfg.models = Object.assign({}, cfg.models); ALT.forEach((x) => { if (!cfg.keys[x.id] && D[x.id + 'ApiKey']) cfg.keys[x.id] = String(D[x.id + 'ApiKey']).trim(); });
    ALT.forEach((x) => { if (D[x.id + 'ApiKey']) cfg.keys[x.id] = String(D[x.id + 'ApiKey']).trim(); }); if (D.geminiApiKey) cfg.apiKey = String(D.geminiApiKey).trim(); if (D.aiPrefer) cfg.prefer = String(D.aiPrefer).trim();
    if (!cfg.collections && D.aiCollections) cfg.collections = D.aiCollections; lessons = (await store.get(LES)) || []; digest = (await store.get(DIG)) || null; chat = (await store.get(CHAT)) || [];
  }
  const saveCfg = () => store.set(CFG, cfg);
  const saveChat = () => store.set(CHAT, chat.slice(-40));
  const collections = () => ['gpsaQueue'].concat(String(cfg.collections || '').split(/[,\s]+/).map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{1,60}$/.test(x) && x !== 'gpsaQueue' && x !== 'gpsaAI'));

  function status() {
    $('aiSt').textContent = (provOrder().length ? '' : 'No API key yet · ') + 'AI: ' + (provOrder().map(provName).join(' → ') || '-') + ' · model ' + (cfg.model || DEF_MODEL) + ' · ' + lessons.length + ' lessons' + (digest ? ' · learned ' + H.fmt(digest.at) : ' · not learned yet');
    $('aiLn').textContent = lessons.length;
    $('aiLes').innerHTML = lessons.slice().sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 60).map((l) => `<div><span>${esc(l.text)}</span><button class="g" data-del="${esc(l.id)}" title="Forget this">&#10005;</button></div>`).join('') || '<div><span class="hint">Nothing yet. Teach it by writing "kumbuka kuwa ..." or press 👍 / 👎 under an answer.</span></div>';
  }

  // ---------- cloud (Supabase) ----------
  async function isConnected(force) {
    if (connected === null || force) { const s = await cloudMsg({ op: 'cloudStatus' }); connected = !!(s.ok && s.connected); }
    return connected;
  }
  async function loadCloud(refresh) {
    if (!(await isConnected(refresh))) return [];
    if (!refresh && cloud.ok && Date.now() - cloud.at < 3 * 60e3) return cloud.items;
    const r = await cloudMsg({ op: 'cloudPull' });
    if (!r.ok) throw new Error('Supabase: ' + r.error);
    cloud = { at: Date.now(), items: r.items || [], ok: true }; return cloud.items;
  }
  async function readCollection(name) {
    if (!(await isConnected())) throw new Error('Cloud storage is not connected (use the "Cloud storage" button first).');
    const c = colCache[name]; if (c && Date.now() - c.at < 3 * 60e3) return c.items;
    const r = await cloudMsg({ op: 'colRead', collection: name, max: 1500 });
    if (!r.ok) throw new Error(r.error); colCache[name] = { at: Date.now(), items: r.items || [] }; return r.items || [];
  }
  async function pullMemory() {
    if (!(await isConnected())) return;
    const r = await cloudMsg({ op: 'aiMemPull' }); if (!r.ok) return;
    const del = new Set((await store.get(LESDEL)) || []), by = {}; lessons.forEach((l) => { by[l.id] = l; });
    (r.items || []).forEach((d) => {
      if (d.id === 'digest') { if (d.json && (!digest || (d.at || 0) > (digest.at || 0))) { try { digest = JSON.parse(d.json); store.set(DIG, digest); } catch (e) {} } return; }
      if (d.id && d.text && !del.has(d.id) && !by[d.id]) { const l = { id: d.id, text: d.text, kind: d.kind, at: d.at, by: d.by }; lessons.push(l); by[l.id] = l; }
    });
    await store.set(LES, lessons);
    const mine = lessons.filter((l) => !(r.items || []).some((d) => d.id === l.id));
    if (mine.length) await cloudMsg({ op: 'aiMemPush', items: mine.slice(0, 300) });
    status();
  }
  async function addLesson(text, kind) {
    const l = { id: 'l_' + uid(), text: String(text).slice(0, 500), kind: kind || 'taught', at: Date.now(), by: (await store.get('gpsaWho')) || '' };
    lessons.push(l); if (lessons.length > 300) lessons = lessons.sort((a, b) => b.at - a.at).slice(0, 300);
    await store.set(LES, lessons); status();
    if (await isConnected()) { const r = await cloudMsg({ op: 'aiMemPush', items: [l] }); if (!r.ok) note('Lesson saved on this computer only (' + r.error + ').'); }
  }

  // ---------- environment given to the brain ----------
  const env = {
    loadLocal: () => H.load(), loadCloud, readCollection, resText, addLesson: (t) => addLesson(t, 'taught'),
    codes: () => Object.assign({}, H.codes), get collections() { return collections(); },
    cloudStatus: () => connected === false ? 'not connected - only this computer is read' : cloud.ok ? 'connected, ' + cloud.items.length + ' records read ' + H.fmt(cloud.at) : 'connected',
    gimis: async (op, p) => { const r = await H.page(Object.assign({ op }, p)); if (!r.ok && /NO_TOKEN|BAD_SESSION/.test(String(r.error))) return { ok: false, error: 'NO_TOKEN: GIMIS session not captured. Open the GIMIS page "Get Issue Note Token" once, then ask again.' }; return r; }
  };
  // ---------- workshop: datasets, code sandbox, files ----------
  let turnFiles = [], waitEl = null, attach = [];
  const engine = window.GpsaEngine.createEngine({
    gql: async (query, variables, tag) => {
      const r = await H.page({ op: 'aiGql', query, variables, tag });
      if (!r.ok) return { ok: false, error: /NO_TOKEN|BAD_SESSION/.test(String(r.error)) ? 'NO_TOKEN: kikao cha GIMIS hakijanaswa. Mtumiaji afungue ukurasa "Get Issue Note Token" ndani ya GIMIS mara moja, kisha aulize tena.' : String(r.error) };
      return { ok: !(r.errors && r.errors.length && !r.data), data: r.data, errors: r.errors };
    },
    gimis: (op, p) => env.gimis(op, p),
    savedTokens: async () => { const cl = await loadCloud(false).catch(() => []); return AI.mergeData(await H.load(), cl).map((r) => AI.compact(r, resText, r.__src)); },
    readCollection: async (n) => (await readCollection(n)).map((d) => { const o = Object.assign({}, d); delete o.requesterEmail; return o; }),
    collections: () => collections(),
    progress: (t) => { if (waitEl) waitEl.textContent = '⏳ ' + t; },
    store: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) },
    onFile: (f) => { turnFiles.push(f); }
  });
  env.engine = engine;
  const wsText = () => [...engine.datasets.entries()].map(([k, v]) => k + ' (' + v.rows.length + ' safu): ' + Object.keys(v.rows[0] || {}).slice(0, 14).join(', ')).join('\n');

  const keyOf = (p) => String(p === 'gemini' ? (cfg.apiKey || '') : ((cfg.keys || {})[p] || '')).trim();
  const provName = (p) => p === 'gemini' ? 'Gemini' : ((ALT.find((x) => x.id === p) || {}).name || p);
  let cool = {};
  function provOrder() {
    const have = ['gemini'].concat(ALT.map((x) => x.id)).filter(keyOf); let o = have;
    if (cfg.prefer && cfg.prefer !== 'auto' && have.includes(cfg.prefer)) o = [cfg.prefer].concat(have.filter((x) => x !== cfg.prefer));
    const hot = (p) => (cool[p] || 0) > Date.now();
    return o.filter((p) => !hot(p)).concat(o.filter(hot));
  }
  async function callProv(p, body) {
    if (p === 'gemini') {
      const r = await cloudMsg({ op: 'aiGemini', apiKey: cfg.apiKey, model: cfg.model || DEF_MODEL, apiBase: cfg.apiBase || '', body });
      if (!r.ok) throw Object.assign(new Error(r.error === 'MODEL_NOT_FOUND' ? 'The model "' + (cfg.model || DEF_MODEL) + '" was not found. Press Test connection to pick another.' : r.error), { status: r.status });
      if (r.switched && r.model) { cfg.model = r.model; saveCfg(); status(); note('Model changed automatically to ' + r.model); }
      return r;
    }
    const a = ALT.find((x) => x.id === p);
    const r = await cloudMsg({ op: 'aiChat', provider: p, apiKey: keyOf(p), model: (cfg.models || {})[p] || a.def, body });
    if (!r.ok) throw Object.assign(new Error(r.error === 'MODEL_NOT_FOUND' ? a.name + ': model not found. Press Test connection to pick another.' : r.error), { status: r.status });
    if (r.switched && r.model) { cfg.models[p] = r.model; saveCfg(); note(a.name + ': model changed automatically to ' + r.model); }
    return r;
  }
  // Tries the providers in order; if one fails (quota, key, network) it moves to the next one that has a key.
  const gemini = async (body) => {
    const order = provOrder(); if (!order.length) throw new Error('AI haijawekwa. Wasiliana na msimamizi wa mfumo.');
    const errs = [];
    for (const p of order) {
      try {
        const r = await callProv(p, body);
        if (errs.length) note('⚠ ' + errs.join(' · ') + ' → nimetumia ' + provName(p) + '.');
        return r;
      } catch (e) {
        const m = String((e && e.message) || e); if (order.length === 1) throw e;
        cool[p] = Date.now() + 120000; errs.push(provName(p) + ': ' + m.slice(0, 110));
      }
    }
    throw new Error(errs.join(' | '));
  };

  // ---------- attachments (images / PDF go to the AI directly; Excel / CSV become datasets; Word / text are read) ----------
  const GF = window.GpsaFiles, slugN = window.GpsaEngine.slug;
  const kbs = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const b64 = (u8) => { let t = ''; for (let i = 0; i < u8.length; i += 8192) t += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(t); };
  async function shrinkImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Picha "' + file.name + '" haisomeki.')); i.src = url; });
      const sc = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth * sc)); c.height = Math.max(1, Math.round(im.naturalHeight * sc));
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85)); return b64(new Uint8Array(await blob.arrayBuffer()));
    } finally { URL.revokeObjectURL(url); }
  }
  async function processAttachments(list) {
    const parts = [], notes = [], texts = [];
    for (const f of list) {
      const n = f.name, ext = (n.split('.').pop() || '').toLowerCase(), base = slugN(n.replace(/\.[^.]+$/, ''), 'faili');
      if (f.type.startsWith('image/')) { parts.push({ inlineData: { mimeType: 'image/jpeg', data: await shrinkImage(f) } }); notes.push('Picha "' + n + '" (imeambatishwa - unaiona moja kwa moja)'); }
      else if (ext === 'pdf') { if (f.size > 18e6) throw new Error('PDF "' + n + '" ni kubwa sana (zaidi ya 18 MB).'); parts.push({ inlineData: { mimeType: 'application/pdf', data: b64(new Uint8Array(await f.arrayBuffer())) } }); notes.push('PDF "' + n + '" (imeambatishwa - unaisoma moja kwa moja)'); }
      else if (ext === 'xlsx' || ext === 'xlsm') {
        const sheets = await GF.readXlsx(new Uint8Array(await f.arrayBuffer())); let k = 0;
        for (const sh of sheets) { const o = GF.gridToObjects(sh.rows); if (!o.rows.length) continue; const nm = engine.put(base + (sheets.length > 1 ? '_' + slugN(sh.name, 'sheet') : ''), o.rows, 'kiambatisho ' + n); k++; notes.push('Excel "' + n + '" / sheet "' + sh.name + '" -> dataset "' + nm + '" (safu ' + o.rows.length + '; vichwa: ' + o.columns.slice(0, 15).join(', ') + ')'); }
        if (!k) notes.push('Excel "' + n + '" haina data inayosomeka.');
      } else if (ext === 'csv' || ext === 'tsv') {
        const o = GF.gridToObjects(GF.parseCsv(await f.text()), null); if (!o.rows.length) { notes.push('"' + n + '" haina data.'); continue; } const nm = engine.put(base, GF.smartTypes(o.rows), 'kiambatisho ' + n); notes.push('CSV "' + n + '" -> dataset "' + nm + '" (safu ' + o.rows.length + '; vichwa: ' + o.columns.slice(0, 15).join(', ') + ')');
      } else if (ext === 'docx') { const t = await GF.readDocxText(new Uint8Array(await f.arrayBuffer())); notes.push('Word "' + n + '" (maandishi yameingizwa hapa chini)'); texts.push('--- ' + n + ' ---\n' + t.slice(0, 20000) + (t.length > 20000 ? '\n...[imekatwa]' : '')); }
      else if (/^(txt|md|json|html|xml)$/.test(ext) || f.type.startsWith('text/')) { const t = await f.text(); notes.push('Faili "' + n + '" (maandishi yameingizwa hapa chini)'); texts.push('--- ' + n + ' ---\n' + t.slice(0, 20000) + (t.length > 20000 ? '\n...[imekatwa]' : '')); }
      else throw new Error('Aina ya faili "' + n + '" haisaidiwi. Tumia picha, PDF, Excel, CSV, Word au maandishi.');
    }
    return { parts, notes, texts };
  }
  function renderAtc() {
    const el = $('aiAtc'); el.hidden = !attach.length; el.innerHTML = attach.map((f, i) => '<span>' + esc(f.name) + ' <small>' + kbs(f.size) + '</small><b data-x="' + i + '">×</b></span>').join('');
  }
  function addAttach(list) { [...list].forEach((f) => { if (attach.length < 8 && f.size <= 25e6) attach.push(f); else note('Faili "' + f.name + '" imeachwa (kikomo: faili 8, MB 25 kila moja).'); }); renderAtc(); }

  // ---------- file cards (download / open / preview) ----------
  const ICON = { xlsx: '📊', csv: '📄', docx: '📝', pdf: '📕', png: '🖼️', svg: '🖼️', html: '🌐', txt: '📄', md: '📄', json: '🧾' };
  function fileCard(f) {
    const ext = (f.ext || f.name.split('.').pop() || '').toLowerCase(), box = document.createElement('div');
    if ((ext === 'png' || ext === 'svg') && f.url) { const p = document.createElement('div'); p.className = 'fp'; const im = document.createElement('img'); im.src = f.url; im.alt = f.name; im.title = 'Bonyeza kufungua kubwa'; im.onclick = () => window.open(f.url, '_blank'); im.onerror = () => p.remove(); p.appendChild(im); box.appendChild(p); }
    const c = document.createElement('div'); c.className = 'fc'; c.innerHTML = '<span class="ic">' + (ICON[ext] || '📎') + '</span><span class="nm"><b></b><small>' + kbs(f.size) + ' · ' + ext.toUpperCase() + '</small></span>'; c.querySelector('b').textContent = f.name;
    if (f.url) { const a = document.createElement('a'); a.href = f.url; a.download = f.name; a.textContent = 'Pakua'; c.appendChild(a);
      if (/^(pdf|html|png|svg)$/.test(ext)) { const o = document.createElement('button'); o.className = 'o'; o.textContent = 'Fungua'; o.onclick = () => window.open(f.url, '_blank'); c.appendChild(o); } }
    box.appendChild(c); return box;
  }
  const flushCards = (host) => { const list = turnFiles.splice(0); list.forEach((f) => host.appendChild(fileCard(f))); return list.length; };
  function showWorkspace() {
    const names = [...engine.datasets.keys()], box = document.createElement('div');
    if (!names.length) { bubble('a', 'Workspace ni tupu. AI ikipakia data (ripoti za GIMIS, token, faili ulizoambatisha) zitaonekana hapa. Workspace hufutwa ukurasa ukipakiwa upya.'); return; }
    names.forEach((k) => { const d = engine.datasets.get(k), r = document.createElement('div'); r.className = 'fc'; r.innerHTML = '<span class="ic">🗂</span><span class="nm"><b></b><small></small></span>'; r.querySelector('b').textContent = k; r.querySelector('small').textContent = d.rows.length + ' safu · ' + d.source;
      const b = document.createElement('button'); b.textContent = 'Excel'; b.onclick = async () => { try { await engine.tools.create_file({ type: 'xlsx', filename: k, dataset: k, title: k }); const h = document.createElement('div'); flushCards(h); r.after(h); } catch (e) { note('✗ ' + e.message); } }; r.appendChild(b); box.appendChild(r); });
    const x = document.createElement('button'); x.className = 'g'; x.textContent = 'Futa workspace yote'; x.onclick = () => { engine.tools.workspace({ action: 'clear' }); note('Workspace imefutwa.'); }; box.appendChild(x); bubble('a', '<b>Workspace</b> - data iliyopakiwa kwa ajili ya AI:', box);
  }
  async function runSelfTest() {
    const w = note('Najaribu uwezo wote wa AI...'); let res; try { res = await engine.selfTest(); } catch (e) { w.remove(); note('✗ ' + e.message); return; } w.remove();
    const box = document.createElement('div'); box.className = 'tst'; res.forEach((t) => { const d = document.createElement('div'); d.className = t.ok ? 'ok' : 'no'; d.textContent = (t.ok ? '✓ ' : '✗ ') + t.name + ': ' + t.detail; box.appendChild(d); });
    bubble('a', '<b>Hali ya uwezo wa elapsAI</b>', box);
  }

  // ---------- chat UI ----------
  const msgs = () => $('aiMsgs');
  function bubble(kind, html, extra) {
    const d = document.createElement('div'); d.className = 'bb ' + kind; d.innerHTML = html; if (extra) d.appendChild(extra); msgs().appendChild(d); msgs().scrollTop = 1e9; return d;
  }
  function note(t) { const d = document.createElement('div'); d.className = 'stp'; d.textContent = t; msgs().appendChild(d); msgs().scrollTop = 1e9; return d; }
  const STEP = { data_overview: 'Nasoma muhtasari wa data', search_tokens: 'Natafuta token', vehicle_history: 'Naangalia historia ya gari', group_stats: 'Nahesabu takwimu', gimis_lookup_token: 'Naiuliza GIMIS (token)',
    gimis_my_tokens: 'Naisoma GIMIS (token zako)', gimis_requisition: 'Naisoma GIMIS (request)', gimis_issue_notes: 'Naisoma GIMIS (issue notes)', gimis_error_codes: 'Naangalia misimbo ya GIMIS', firebase_read_collection: 'Nasoma Supabase', remember_lesson: 'Najifunza', load_data: 'Napakia data kwenye workspace', gimis_query: 'Naiuliza GIMIS (query)', gimis_schema: 'Nagundua API za GIMIS', gimis_find_api: 'Natafuta query za GIMIS', workspace: 'Naangalia workspace', dataset_query: 'Nachambua data', run_code: 'Naendesha code', create_file: 'Natengeneza faili', create_chart: 'Nachora chati', create_image: 'Natengeneza picha' };
  function feedback(q, a, tools) {
    const f = document.createElement('div'); f.className = 'fb'; f.innerHTML = '<span>Jibu hili ni sahihi?</span><button data-up>&#128077;</button><button data-down>&#128078;</button>';
    f.querySelector('[data-up]').onclick = async () => { f.textContent = 'Asante - nimejifunza mbinu hii.'; const names = [...new Set(tools.map((t) => t.name))].join(', ');
      await addLesson('Swali la aina «' + q.slice(0, 160) + '» lilijibiwa vizuri kwa kutumia zana: ' + (names || 'bila zana') + '.', 'good'); };
    f.querySelector('[data-down]').onclick = async () => { const fix = prompt('Jibu sahihi ni lipi, au nikosee wapi? (itahifadhiwa kama somo)'); if (!fix || fix.trim().length < 5) return;
      f.textContent = 'Asante - nimehifadhi marekebisho.'; await addLesson('Marekebisho ya swali «' + q.slice(0, 160) + '»: ' + fix.trim(), 'fix'); };
    return f;
  }
  function renderChat() {
    msgs().innerHTML = ''; chat.forEach((m) => bubble(m.role === 'user' ? 'u' : (m.err ? 'e' : 'a'), m.role === 'user' ? esc(m.text) : AI.mdToHtml(m.text)));
    if (!chat.length) bubble('a', AI.mdToHtml('Habari! Mimi ni **elapsAI**, nipo hapa kwa ajili ya kusaidia taasisi ya GPSA kituo cha Kinondoni. Karibu nikusaidie.'));
  }
  // Plain greetings get the correct Swahili reply straight away (exact match only; anything longer goes to the AI).
  function greetReply(q) {
    const n = q.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim(); let r = null, more = true;
    if (/^shikamoo( mzee| mama| baba| bibi| babu| dada| kaka)?$/.test(n)) r = 'Marahaba.';
    else if (/^(assalam(u)? ?alaykum|assalam(u)? ?alaikum|salaam alaykum|salaam|salam|salamu)$/.test(n)) r = 'Wa alaykum salaam.';
    else if (/^hujambo( \w+)?$/.test(n)) r = 'Sijambo, asante.';
    else if (/^hamjambo( \w+)?$/.test(n)) r = 'Hatujambo, asante.';
    else if (/^habari (za|ya) (asubuhi|mchana|jioni|usiku|kazi|siku|leo|muda huu|huko|hapo)$/.test(n)) r = 'Nzuri, asante.';
    else if (/^habari( yako| yenu| gani| zako| zenu| rafiki| boss| bosi)?$/.test(n)) r = 'Salama, asante.';
    else if (/^(mambo|mambo vipi|vipi|niaje|sema)$/.test(n)) r = 'Salama.';
    else if (/^(asubuhi njema|mchana mwema|jioni njema|usiku mwema)$/.test(n)) r = n.charAt(0).toUpperCase() + n.slice(1) + ' pia.';
    else if (/^(hello|helo|hallo|hi|hey)$/.test(n)) r = 'Karibu.';
    else if (/^(asante|asante sana|shukrani|nashukuru|ahsante)$/.test(n)) { r = 'Karibu sana.'; more = false; }
    else if (/^(kwaheri|kwa heri|baadaye|tutaonana)$/.test(n)) { r = 'Kwaheri, karibu tena.'; more = false; }
    return r && (more ? r + ' Je, nikusaidie nini kuhusu token, magari au taasisi?' : r);
  }
  async function send(q) {
    q = String(q || '').trim(); if ((!q && !attach.length) || busy) return; if (!q) q = 'Chambua faili nilizoambatisha na unipe muhtasari wake.';
    { const g = attach.length ? null : greetReply(q); if (g) { $('aiQ').value = ''; $('aiChips').hidden = true; bubble('u', esc(q)); bubble('a', AI.mdToHtml(g)); chat.push({ role: 'user', text: q }, { role: 'model', text: g }); saveChat(); return; } }
    if (!provOrder().length) { note('AI haijawekwa. Wasiliana na msimamizi wa mfumo.'); return; }
    busy = true; $('aiGo').disabled = true; $('aiQ').value = ''; $('aiChips').hidden = true;
    const clip = attach.map((f) => f.name); bubble('u', esc(q) + (clip.length ? '<br><small>📎 ' + esc(clip.join(', ')) + '</small>' : '')); const hist = chat.slice(); chat.push({ role: 'user', text: q + (clip.length ? ' [viambatisho: ' + clip.join(', ') + ']' : '') });
    const wait = note('Nafikiri...'); waitEl = wait; turnFiles = []; let qFull = q, parts = [];
    try {
      if (attach.length) { wait.textContent = '📎 Nasoma viambatisho...'; const pr = await processAttachments(attach); parts = pr.parts; qFull = q + '\n\n[VIAMBATISHO]\n' + pr.notes.map((x) => '- ' + x).join('\n') + (pr.texts.length ? '\n\n' + pr.texts.join('\n\n') : ''); attach = []; renderAtc(); }
      const out = await AI.ask({ question: qFull, attachments: parts, workspace: wsText(), maxSteps: 16, history: hist.filter((m) => !m.err), env, gemini, lessons, digest, onStep: (n, a) => { wait.textContent = '🔎 ' + (STEP[n] || n) + (a && (a.token || a.chassis || a.query || a.collection) ? ' · ' + String(a.token || a.chassis || a.query || a.collection).slice(0, 40) : '') + '...'; } });
      wait.remove(); const b = bubble('a', AI.mdToHtml(out.text) + (out.truncated ? '<p><i>(Jibu limekatwa kwa urefu - uliza kwa sehemu.)</i></p>' : ''));
      if (out.tools.length) { const s = document.createElement('div'); s.className = 'stp'; s.textContent = 'Zana zilizotumika: ' + [...new Set(out.tools.map((t) => STEP[t.name] || t.name))].join(' · '); b.appendChild(s); }
      flushCards(b);
      b.appendChild(feedback(q, out.text, out.tools)); chat.push({ role: 'model', text: out.text });
    } catch (e) { wait.remove(); const m = String((e && e.message) || e); bubble('e', esc('✗ ' + m)); chat.push({ role: 'model', text: '✗ ' + m, err: true }); }
    busy = false; waitEl = null; $('aiGo').disabled = false; saveChat(); msgs().scrollTop = 1e9;
  }

  // ---------- learn now ----------
  async function learn(silent) {
    const btn = $('aiLearn'); btn.disabled = true; if (!silent) note('Najifunza kutoka kwenye data...');
    try {
      let cl = []; try { cl = await loadCloud(true); } catch (e) { if (!silent) note('Cloud: ' + e.message); }
      const all = AI.mergeData(await H.load(), cl), cols = {};
      for (const c of collections()) { if (c === 'gpsaQueue') { cols[c] = { documents: cl.length }; continue; }
        try { const d = await readCollection(c), f = {}; d.slice(0, 80).forEach((x) => Object.keys(x).forEach((k) => { f[k] = 1; })); cols[c] = { documents: d.length, fields: Object.keys(f).slice(0, 40) }; } catch (e) { cols[c] = { error: String(e.message || e).slice(0, 100) }; } }
      digest = AI.buildDigest(all, resText, Object.assign({}, H.codes), cols);
      const live = await H.page({ op: 'aiMyTokens', limit: 500 }).catch(() => null);
      if (live && live.ok) digest.gimis_live = { tokens_total: live.total, used: live.list.filter((t) => t.used).length, not_used: live.list.filter((t) => !t.used).length };
      await store.set(DIG, digest);
      if (await isConnected()) { const r = await cloudMsg({ op: 'aiMemPush', items: [{ id: 'digest', json: JSON.stringify(digest), at: digest.at }] }); if (!r.ok && !silent) note('Summary kept on this computer only (' + r.error + ').'); }
      status(); if (!silent) note('✓ Nimejifunza: token ' + digest.total + ', taasisi ' + digest.top_institutions.length + ', sababu za kushindwa ' + digest.failure_reasons.length + (digest.gimis_live ? ', GIMIS live ' + digest.gimis_live.tokens_total : '') + '.');
    } catch (e) { if (!silent) note('✗ ' + String((e && e.message) || e)); }
    btn.disabled = false;
  }

  // ---------- events ----------
  $('aiGo').onclick = () => send($('aiQ').value);
  $('aiAttach').onclick = () => $('aiFile').click();
  $('aiFile').onchange = (e) => { addAttach(e.target.files); e.target.value = ''; };
  $('aiAtc').onclick = (e) => { const i = e.target && e.target.dataset && e.target.dataset.x; if (i != null) { attach.splice(+i, 1); renderAtc(); } };
  $('aiWs').onclick = showWorkspace; $('aiTest').onclick = runSelfTest;
  { const m = $('aiMsgs'); m.addEventListener('dragover', (e) => { e.preventDefault(); m.classList.add('drag'); }); m.addEventListener('dragleave', () => m.classList.remove('drag')); m.addEventListener('drop', (e) => { e.preventDefault(); m.classList.remove('drag'); if (e.dataTransfer && e.dataTransfer.files.length) addAttach(e.dataTransfer.files); }); }
  $('aiQ').addEventListener('paste', (e) => { const fs = [...((e.clipboardData && e.clipboardData.files) || [])]; if (fs.length) { e.preventDefault(); addAttach(fs); } });
  $('aiQ').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('aiQ').value); } });
  $('aiChips').onclick = (e) => { const c = e.target && e.target.dataset && e.target.dataset.c; if (c) send(c); };
  $('aiGear').onclick = () => { $('aiSet').hidden = !$('aiSet').hidden; };
  $('aiClr').onclick = () => { chat = []; saveChat(); renderChat(); $('aiChips').hidden = false; };
  $('aiLearn').onclick = () => learn(false);
  $('aiLes').onclick = async (e) => {
    const id = e.target && e.target.dataset && e.target.dataset.del; if (!id) return;
    lessons = lessons.filter((l) => l.id !== id); await store.set(LES, lessons); const d = (await store.get(LESDEL)) || []; d.push(id); await store.set(LESDEL, d.slice(-500)); status();
    if (await isConnected()) cloudMsg({ op: 'aiMemDelete', ids: [id] });
  };

  H.aiOpen = async () => {
    if (!opened) {
      opened = true; await loadAll(); 
      renderChat(); status(); $('aiChips').hidden = chat.length > 0;
      pullMemory().catch(() => {});
      if (!digest || Date.now() - (digest.at || 0) > 6 * 36e5) setTimeout(() => learn(true), 1500);
    }
    $('aiQ').focus();
  };
})();
