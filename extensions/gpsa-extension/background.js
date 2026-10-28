// background.js — Cloud storage (SUPABASE) kwa GPSA Token Helper.   (v2.25.0: Firestore/Firebase imeondolewa)
// Inaendesha kama service worker ili maombi ya mtandao kwenda Supabase yasizuiwe na
// CSP ya ukurasa wa gimis.gpsa.go.tz. content.js inaongea na faili hii kwa chrome.runtime.sendMessage.
//
// Hifadhi mbili tofauti za data:
//  1) Cloud (hapa): Supabase (Postgres) — akaunti ya kila mtu (Supabase Auth), inapatikana kompyuta yoyote.
//  2) External backup: JSON export/import iliyokuwepo tayari kwenye content.js (haijabadilika).
//
// Jedwali (angalia SUPABASE-SETUP.sql): gpsa_queue, gpsa_ai, gpsa_devices, gpsa_config, gpsa_release,
// gpsa_blocked_accounts, gpsa_owners. Majina ya zamani ya collection (gpsaQueue, gpsaDevices...) yanabaki ndani ya code
// kwa sababu content.js na AI zinayatumia; yanabadilishwa kuwa jina la jedwali kwenye `TABLE` hapa chini.

try { importScripts('config.js'); } catch (e) {}   // GPSA_DEFAULTS (supabaseUrl, supabaseAnonKey ...), angalia config.js

const CFG_KEY = 'gpsaCloudCfg';   // {email}  (hakuna password hapa)
const AUTH_KEY = 'gpsaCloudAuth'; // {idToken, refreshToken, expiresAt, localId}
const COLLECTION = 'gpsaQueue';
const TABLE = { gpsaQueue: 'gpsa_queue', gpsaAI: 'gpsa_ai', gpsaDevices: 'gpsa_devices', gpsaConfig: 'gpsa_config', gpsaRelease: 'gpsa_release', gpsaBlockedAccounts: 'gpsa_blocked_accounts' };

const local = {
  get: (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k]))),
  set: (k, v) => new Promise((r) => chrome.storage.local.set({ [k]: v }, r)),
  remove: (k) => new Promise((r) => chrome.storage.local.remove(k, r))
};

// v2.20.0: device registry, owner block, auto-update (must come after `local` is defined)
try { importScripts('access-bg.js'); } catch (e) { console.warn('access-bg.js not loaded', e); }

// ---------- Config ----------
// Supabase URL + anon key come from config.js (the anon key is public by design: access is protected by sign-in + Row Level Security).
const hostOf = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
async function getCfg() {
  const s = (await local.get(CFG_KEY)) || {};
  const D = (typeof GPSA_DEFAULTS !== 'undefined' && GPSA_DEFAULTS) || {};
  const url = String(D.supabaseUrl || s.url || '').trim().replace(/\/+$/, '');
  const anonKey = String(D.supabaseAnonKey || s.anonKey || '').trim();
  return { url, anonKey, apiKey: anonKey, projectId: hostOf(url), email: s.email || '' };
}
const needCfg = (cfg) => { if (!cfg.url || !cfg.anonKey) throw new Error('NOT_CONFIGURED'); };

// ---------- Supabase Auth (REST/GoTrue, hakuna SDK inayopakuliwa) ----------
async function authReq(cfg, path, body) {
  needCfg(cfg);
  let r;
  try { r = await fetch(`${cfg.url}/auth/v1/${path}`, { method: 'POST', headers: { apikey: cfg.anonKey, 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch (e) { const er = new Error('Failed to fetch'); er.network = true; throw er; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const er = new Error(j.error_code || j.msg || j.error_description || j.message || ('Auth ' + r.status)); er.status = r.status; throw er; }
  return j;
}
const normSession = (j, email) => ({ idToken: j.access_token, refreshToken: j.refresh_token, expiresIn: j.expires_in || 3600, localId: (j.user && j.user.id) || '', email: String((j.user && j.user.email) || email || '').toLowerCase() });
async function signIn(cfg, email, password) { return normSession(await authReq(cfg, 'token?grant_type=password', { email, password }), email); }
async function signUp(cfg, email, password) {
  const j = await authReq(cfg, 'signup', { email, password });
  if (!j.access_token) throw new Error('EMAIL_CONFIRM_REQUIRED');   // "Confirm email" is ON in Supabase: no session is returned
  return normSession(j, email);
}
async function refreshIdToken(cfg, refreshToken) {
  try { const j = await authReq(cfg, 'token?grant_type=refresh_token', { refresh_token: refreshToken }); return { idToken: j.access_token, refreshToken: j.refresh_token, expiresIn: j.expires_in || 3600 }; }
  catch (e) { if (e.status === 400 || e.status === 401 || e.status === 403) e.message = 'INVALID_REFRESH_TOKEN'; throw e; }
}

// Plain-English messages for the common errors
function friendly(m) {
  const s = String(m || '');
  if (/NOT_CONFIGURED/.test(s)) return 'Supabase is not set up yet: put your Supabase URL and anon key in config.js (supabaseUrl, supabaseAnonKey), then reload the extension.';
  if (/invalid_credentials|Invalid login credentials|EMAIL_NOT_FOUND|INVALID_PASSWORD/i.test(s)) return 'Wrong email or password.';
  if (/email_not_confirmed|Email not confirmed/i.test(s)) return 'This email is not confirmed yet. Open the confirmation email, or ask the owner to turn off "Confirm email" in Supabase (Authentication > Providers > Email).';
  if (/EMAIL_CONFIRM_REQUIRED/.test(s)) return 'Account created, but Supabase wants the email confirmed first. Confirm the email (check your inbox) and then press "I already have an account". The owner can turn off "Confirm email" in Supabase (Authentication > Providers > Email).';
  if (/signup_disabled|Signups not allowed|email_provider_disabled/i.test(s)) return 'New sign-ups or Email sign-in are switched off in Supabase (Authentication > Providers > Email).';
  if (/user_already_exists|already registered|already been registered/i.test(s)) return 'This email already has an account. Press "I already have an account" and sign in.';
  if (/weak_password|Password should be at least/i.test(s)) return 'The password is too weak. Use at least 6 characters.';
  if (/validation_failed|email_address_invalid|Unable to validate email|INVALID_EMAIL/i.test(s)) return 'Enter a valid email address.';
  if (/over_request_rate_limit|over_email_send_rate_limit|rate limit|TOO_MANY/i.test(s) && !/^QUOTA$/.test(s)) return 'Too many attempts. Wait a few minutes and try again.';
  if (/user_banned|USER_DISABLED/i.test(s)) return 'This account is disabled in Supabase.';
  if (/Invalid API key|invalid.*apikey|No API key/i.test(s)) return 'The Supabase anon key in config.js is not accepted. Copy it again from Supabase > Project Settings > API.';
  if (/row-level security|42501|permission denied|not_owner/i.test(s)) return 'Supabase refused this action (Row Level Security). Run SUPABASE-SETUP.sql in the Supabase SQL editor, and for owner actions make sure the owner account is listed in gpsa_owners.';
  if (/PGRST205|PGRST202|Could not find the (table|function)|does not exist|schema cache/i.test(s)) return 'The Supabase tables are not created yet. Run SUPABASE-SETUP.sql in Supabase > SQL Editor.';
  if (/^QUOTA$|quota|RESOURCE_EXHAUSTED|exceed|Supabase (402|429)/i.test(s)) return 'The cloud storage is temporarily limited (Supabase usage / rate limit reached). Your work on this computer is NOT lost - it will sync again later, or when the owner upgrades the Supabase plan.';
  if (/Failed to fetch|NetworkError|NETWORK/i.test(s)) return 'No connection to Supabase. Check the internet. If the internet is fine, the free Supabase project may be paused: open supabase.com > your project > press "Restore project".';
  return s;
}

// If config.js has a Supabase email + password and this computer is not connected yet, sign in once automatically.
async function autoConnect() {
  const D = (typeof GPSA_DEFAULTS !== 'undefined' && GPSA_DEFAULTS) || {};
  if (!D.supabaseEmail || !D.supabasePassword) return null;
  const cfg = await getCfg();
  const t = await signIn(cfg, D.supabaseEmail, D.supabasePassword);
  await local.set(CFG_KEY, { email: t.email });
  const auth = { idToken: t.idToken, refreshToken: t.refreshToken, expiresAt: Date.now() + Number(t.expiresIn) * 1000, localId: t.localId };
  await local.set(AUTH_KEY, auth); return auth;
}

async function ensureToken() {
  const cfg = await getCfg();
  if (!cfg.url || !cfg.anonKey) throw new Error('NOT_CONFIGURED');
  let auth = await local.get(AUTH_KEY);
  if (!auth || !auth.refreshToken) { try { auth = await autoConnect(); } catch (e) { auth = null; } }
  if (!auth || !auth.refreshToken) throw new Error('NOT_CONNECTED');
  if (!auth.expiresAt || Date.now() > auth.expiresAt - 60000) {
    const t = await refreshIdToken(cfg, auth.refreshToken);
    auth = { ...auth, idToken: t.idToken, refreshToken: t.refreshToken, expiresAt: Date.now() + Number(t.expiresIn) * 1000 };
    await local.set(AUTH_KEY, auth);
  }
  return { cfg, auth };
}

// ---------- Supabase REST (PostgREST) ----------
// v2.24.1 idea kept: "limit reached" (HTTP 429 / 402) is NOT the same as "no internet" or "access denied".
function isQuotaErr(status, j) {
  const m = String((j && (j.message || j.error_description || j.msg)) || '');
  return status === 429 || status === 402 || /quota|resource.?exhausted|too many requests|exceed_/i.test(m);
}
async function sbFetch(cfg, tok, method, path, body, prefer) {
  needCfg(cfg);
  const headers = { apikey: cfg.anonKey, authorization: 'Bearer ' + ((tok && tok.idToken) || cfg.anonKey), 'content-type': 'application/json' };
  if (prefer) headers.prefer = prefer;
  let r;
  try { r = await fetch(`${cfg.url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (e) { const er = new Error('NETWORK'); er.network = true; throw er; }
  const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
  if (!r.ok) {
    const er = new Error((j && (j.message || j.error_description || j.msg)) || ('Supabase ' + r.status)); er.status = r.status; er.code = j && j.code;
    if (j && j.code === '42501') er.status = 403;
    if (isQuotaErr(r.status, j)) { er.quota = true; er.message = 'QUOTA'; }
    throw er;
  }
  return j;
}
const enc = encodeURIComponent;
const inList = (arr) => '(' + arr.map((t) => '"' + String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + ')';
const splitPath = (p) => { const i = String(p).indexOf('/'); return i < 0 ? [String(p), ''] : [String(p).slice(0, i), String(p).slice(i + 1)]; };
const tblOf = (col) => { const t = TABLE[col]; if (!t) throw new Error('Bad collection name.'); return t; };
const err = (m, status) => { const e = new Error(m); e.status = status; return e; };

// Generic "document" helpers used by access-bg.js (devices, config, release, blocked accounts).
// A document = one row {id, data jsonb}. path = "<collection>/<id>".
const docObj = (d) => (d ? d : null);   // kept for access-bg.js: documents are already plain objects
async function getDoc(tok, path) {
  const [col, id] = splitPath(path), cfg = await getCfg();
  const rows = await sbFetch(cfg, tok, 'GET', `${tblOf(col)}?select=data&id=eq.${enc(id)}&limit=1`);
  return rows && rows[0] ? rows[0].data : null;
}
// mask (array of keys) -> merge only those keys into the existing document.   mask null -> replace the whole document.
// exists === true -> the document must already exist; exists === false -> it must NOT exist yet (else HTTP 409); undefined -> create or replace.
async function patchDoc(tok, path, obj, mask, exists) {
  const [col, id] = splitPath(path), cfg = await getCfg(), t = tblOf(col);
  if (mask && mask.length) {
    const cur = await getDoc(tok, path);
    if (!cur && exists === true) throw err('NOT_FOUND', 404);
    const patch = {}; mask.forEach((k) => { if (obj[k] !== undefined) patch[k] = obj[k]; });
    const merged = Object.assign({}, cur || {}, patch);
    if (cur) {
      const rows = await sbFetch(cfg, tok, 'PATCH', `${t}?id=eq.${enc(id)}`, { data: merged }, 'return=representation');
      if (!rows || !rows.length) throw err('Not allowed (row-level security).', 403);
      return rows[0].data;
    }
    await sbFetch(cfg, tok, 'POST', t, { id, data: merged }, 'return=minimal'); return merged;
  }
  if (exists === false) { await sbFetch(cfg, tok, 'POST', t, { id, data: obj }, 'return=minimal'); return obj; }
  if (exists === true) {
    const rows = await sbFetch(cfg, tok, 'PATCH', `${t}?id=eq.${enc(id)}`, { data: obj }, 'return=representation');
    if (!rows || !rows.length) throw err('NOT_FOUND', 404);
    return rows[0].data;
  }
  await sbFetch(cfg, tok, 'POST', `${t}?on_conflict=id`, { id, data: obj }, 'resolution=merge-duplicates,return=minimal');
  return obj;
}
async function delDoc(tok, path) {
  const [col, id] = splitPath(path), cfg = await getCfg();
  await sbFetch(cfg, tok, 'DELETE', `${tblOf(col)}?id=eq.${enc(id)}`, undefined, 'return=minimal');
}
async function listDocs(tok, col) {
  const cfg = await getCfg(), t = tblOf(col); let out = [], off = 0;
  for (;;) {
    const rows = (await sbFetch(cfg, tok, 'GET', `${t}?select=id,data&order=id&limit=1000&offset=${off}`)) || [];
    rows.forEach((r) => out.push(Object.assign({}, r.data, { _id: r.id })));
    if (rows.length < 1000) break; off += 1000;
  }
  return out;
}

// ---------- Token storage (table gpsa_queue: one row per token, whole record in `data`) ----------

async function cloudPush(items) {
  const { cfg, auth } = await ensureToken();
  const uniq = new Map(); (items || []).forEach((it) => { if (it && it.token) uniq.set(String(it.token), it); });
  const rows = [...uniq.values()].map((it) => ({ token: String(it.token), data: it, updated_at: Number(it.updatedAt) || 0 }));
  let count = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await sbFetch(cfg, auth, 'POST', 'gpsa_queue?on_conflict=token', chunk, 'resolution=merge-duplicates,return=minimal');
    count += chunk.length;
  }
  return count;
}

async function cloudDeleteDocs(tokens) {
  if (!tokens.length) return 0;
  const { cfg, auth } = await ensureToken();
  for (let i = 0; i < tokens.length; i += 40) await sbFetch(cfg, auth, 'DELETE', `gpsa_queue?token=in.${enc(inList(tokens.slice(i, i + 40)))}`, undefined, 'return=minimal');
  return tokens.length;
}

// Returns all saved tokens + the time of the last "admin deleted everything" (gpsa_config/wipe), so every computer can clear its own copy.
async function cloudPullAll() {
  const { cfg, auth } = await ensureToken();
  let out = [], off = 0;
  for (;;) {
    const rows = (await sbFetch(cfg, auth, 'GET', `gpsa_queue?select=data&order=token&limit=1000&offset=${off}`)) || [];
    rows.forEach((r) => { if (r && r.data) out.push(r.data); });
    if (rows.length < 1000) break; off += 1000;
  }
  let wipeAt = 0;
  try { const w = await getDoc(auth, 'gpsaConfig/wipe'); wipeAt = Number(w && w.at) || 0; } catch (e) {}
  return { items: out, wipeAt };
}

// Look up SPECIFIC tokens (used before saving, to refuse a token that is already stored in the cloud)
async function cloudHas(tokens) {
  const found = {};
  if (!tokens.length) return found;
  const { cfg, auth } = await ensureToken();
  for (let i = 0; i < tokens.length; i += 40) {
    const rows = (await sbFetch(cfg, auth, 'GET', `gpsa_queue?select=data&token=in.${enc(inList(tokens.slice(i, i + 40)))}`)) || [];
    rows.forEach((r) => { const f = r && r.data; if (f && f.token) found[f.token] = f; });
  }
  return found;
}

// ---------- AI assistant (Gemini) + generic table reads ----------
// Gemini is called from here (service worker) so the page's CSP cannot block it. The API key lives only in chrome.storage.local.
const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
const AI_COL = 'gpsaAI';   // the ONLY table the AI side may write to (lessons + learned digest)
const okCol = (c) => /^[A-Za-z0-9_-]{1,60}$/.test(String(c || ''));

// Read rows of a table (read-only). gpsaQueue -> gpsa_queue; any other name is read as a Supabase table with that exact name.
async function colList(collection, max) {
  if (!okCol(collection)) throw new Error('Bad collection name.');
  const { cfg, auth } = await ensureToken();
  const t = TABLE[collection] || collection, lim = max || 3000; let out = [], off = 0;
  while (out.length < lim) {
    const rows = (await sbFetch(cfg, auth, 'GET', `${enc(t)}?select=*&limit=1000&offset=${off}`)) || [];
    rows.forEach((r) => { const o = (r && r.data && typeof r.data === 'object' && !Array.isArray(r.data)) ? Object.assign({}, r.data) : Object.assign({}, r); o._id = String((r && (r.id || r.token)) || ''); out.push(o); });
    if (rows.length < 1000) break; off += 1000;
  }
  return out.slice(0, lim);
}
async function aiPush(items) {
  if (!items.length) return 0;
  const { cfg, auth } = await ensureToken();
  for (let i = 0; i < items.length; i += 200) {
    const rows = items.slice(i, i + 200).map((it) => ({ id: String(it.id), data: it }));
    await sbFetch(cfg, auth, 'POST', 'gpsa_ai?on_conflict=id', rows, 'resolution=merge-duplicates,return=minimal');
  }
  return items.length;
}
async function aiDelete(ids) {
  if (!ids.length) return 0;
  const { cfg, auth } = await ensureToken();
  await sbFetch(cfg, auth, 'DELETE', `gpsa_ai?id=in.${enc(inList(ids))}`, undefined, 'return=minimal');
  return ids.length;
}

function geminiBase(b) { return String(b || GEMINI_BASE).replace(/\/+$/, ''); }
async function geminiFetch(url, apiKey, init, tries) {
  let last = null;
  for (let n = 0; n < (tries || 3); n++) {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 150000);
    try {
      const r = await fetch(url, Object.assign({ signal: ac.signal }, init, { headers: Object.assign({ 'x-goog-api-key': apiKey, 'content-type': 'application/json' }, init && init.headers) }));
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      const msg = (j.error && j.error.message) || ('Gemini ' + r.status);
      last = Object.assign(new Error(msg), { status: r.status });
      if (![429, 500, 503].includes(r.status) || n === (tries || 3) - 1) throw last;
      await new Promise((res) => setTimeout(res, 1500 * (n + 1)));
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('Gemini did not answer in 90 seconds.');
      if (e === last) throw e;
      throw e;
    } finally { clearTimeout(to); }
  }
  throw last || new Error('Gemini failed');
}
function geminiFriendly(e) {
  const m = String((e && e.message) || e), st = e && e.status;
  if (st === 400 && /API key/i.test(m)) return 'The Gemini API key is not valid. Create one at aistudio.google.com/apikey and paste it again.';
  if (st === 403) return 'Gemini refused this key (' + m + '). Check that the key is enabled for the Generative Language API.';
  if (st === 429) return 'Gemini quota/rate limit reached. Wait a minute and ask again (or use a billed key).';
  if (st === 404) return 'MODEL_NOT_FOUND';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'No internet connection to Gemini.';
  return m;
}
async function geminiModels(apiKey, apiBase) {
  const j = await geminiFetch(geminiBase(apiBase) + '/v1beta/models?pageSize=200', apiKey, { method: 'GET' }, 2);
  return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name).replace(/^models\//, ''));
}
// Pick a sensible default when the chosen model name no longer exists
function pickModel(list) {
  const flash = list.filter((n) => /flash/i.test(n) && !/lite|image|tts|live|audio|thinking|exp|preview|vision|embedding/i.test(n));
  return flash.find((n) => /latest/.test(n)) || flash.sort().reverse()[0] || list.find((n) => /gemini/i.test(n)) || list[0] || null;
}
async function geminiGenerate(m) {
  const apiKey = String(m.apiKey || '').trim();
  if (!apiKey) throw new Error('Paste your Gemini API key in the AI settings first.');
  const base = geminiBase(m.apiBase);
  let model = String(m.model || 'gemini-flash-latest').replace(/^models\//, '');
  const go = (mm) => geminiFetch(`${base}/v1beta/models/${encodeURIComponent(mm)}:generateContent`, apiKey, { method: 'POST', body: JSON.stringify(m.body) }, 3);
  try { return { json: await go(model), model }; }
  catch (e) {
    if (e && e.status === 404) {
      const alt = pickModel(await geminiModels(apiKey, m.apiBase));
      if (alt && alt !== model) { model = alt; return { json: await go(model), model, switched: true }; }
    }
    throw e;
  }
}

// ---------- Alternative AI providers (OpenAI-compatible): Groq, OpenRouter, Mistral ----------
// ai-core.js speaks the Gemini format; these helpers translate it to/from the OpenAI "chat completions" format so any provider can be plugged in.
const OA = {
  groq: { name: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'openrouter/free' },
  mistral: { name: 'Mistral', base: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' }
};
const lowTypes = (s) => Array.isArray(s) ? s.map(lowTypes) : (s && typeof s === 'object') ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, (k === 'type' && typeof v === 'string') ? v.toLowerCase() : lowTypes(v)])) : s;
function g2oBody(body, model) {
  const msgs = [], pending = []; let n = 0;
  const sys = ((body.systemInstruction || {}).parts || []).map((p) => p.text || '').join('\n'); if (sys) msgs.push({ role: 'system', content: sys });
  for (const c of body.contents || []) {
    const parts = c.parts || [];
    if (c.role === 'model') {
      const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
      const calls = parts.filter((p) => p.functionCall).map((p) => { const id = p.functionCall.id || ('call_' + (++n)); pending.push({ id, name: p.functionCall.name }); return { id, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } }; });
      if (!text && !calls.length) continue;
      const mm = { role: 'assistant', content: text || null }; if (calls.length) mm.tool_calls = calls; msgs.push(mm);
    } else {
      for (const p of parts.filter((x) => x.functionResponse)) {
        const fr = p.functionResponse; let i = pending.findIndex((x) => x.id === fr.id); if (i < 0) i = pending.findIndex((x) => x.name === fr.name);
        const id = i >= 0 ? pending.splice(i, 1)[0].id : (fr.id || 'call_x');
        msgs.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(fr.response || {}).slice(0, 20000) });
      }
      const text = parts.filter((p) => p.text).map((p) => p.text).join(''); if (text) msgs.push({ role: 'user', content: text });
    }
  }
  const out = { model, messages: msgs, temperature: (body.generationConfig || {}).temperature != null ? body.generationConfig.temperature : 0.2, max_tokens: Math.min((body.generationConfig || {}).maxOutputTokens || 4096, 8192) };
  const none = body.toolConfig && body.toolConfig.functionCallingConfig && body.toolConfig.functionCallingConfig.mode === 'NONE';
  const decl = ((body.tools || [])[0] || {}).functionDeclarations || [];
  if (decl.length && !none) { out.tools = decl.map((d) => ({ type: 'function', function: { name: d.name, description: d.description, parameters: lowTypes(d.parameters || { type: 'OBJECT', properties: {} }) } })); out.tool_choice = 'auto'; }
  return out;
}
function o2gJson(j) {
  const ch = (j.choices || [])[0];
  if (!ch || !ch.message) return { candidates: [], promptFeedback: { blockReason: (j.error && j.error.message) || 'EMPTY' } };
  const m = ch.message, parts = [];
  const text = String(m.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(); if (text) parts.push({ text });
  for (const tc of m.tool_calls || []) { let args = {}; try { args = JSON.parse((tc.function && tc.function.arguments) || '{}'); } catch (e) {} parts.push({ functionCall: { name: tc.function.name, args, id: tc.id } }); }
  return { candidates: [{ content: { role: 'model', parts }, finishReason: ch.finish_reason === 'length' ? 'MAX_TOKENS' : 'STOP' }] };
}
async function oaFetch(p, apiKey, path, init, tries) {
  const cfg = OA[p]; let last = null;
  for (let n = 0; n < (tries || 2); n++) {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 150000);
    try {
      const h = { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' }; if (p === 'openrouter') { h['HTTP-Referer'] = 'https://gimis.gpsa.go.tz'; h['X-Title'] = 'elapsAI'; }
      const r = await fetch(cfg.base + path, Object.assign({ signal: ac.signal }, init, { headers: h }));
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      const msg = (j.error && (j.error.message || (typeof j.error === 'string' && j.error))) || (cfg.name + ' ' + r.status);
      last = Object.assign(new Error(msg), { status: r.status });
      if (![500, 502, 503].includes(r.status) || n === (tries || 2) - 1) throw last;
      await new Promise((res) => setTimeout(res, 1500));
    } catch (e) { if (e && e.name === 'AbortError') throw new Error(cfg.name + ' did not answer in 90 seconds.'); throw e; } finally { clearTimeout(to); }
  }
  throw last || new Error(cfg.name + ' failed');
}
function oaFriendly(e, p) {
  const nm = (OA[p] || {}).name || 'AI', m = String((e && e.message) || e), st = e && e.status;
  if (st === 401 || st === 403) return nm + ': API key is not valid or not allowed (' + m.slice(0, 120) + ').';
  if (st === 429) return nm + ' quota/rate limit reached. Wait a minute and ask again.';
  if (st === 404) return 'MODEL_NOT_FOUND';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'No internet connection to ' + nm + '.';
  return nm + ': ' + m;
}
async function oaModels(p, apiKey) {
  const j = await oaFetch(p, apiKey, '/models', { method: 'GET' }, 2);
  return (j.data || []).map((m) => String(m.id)).filter(Boolean);
}
function oaPick(p, list) {
  const f = list.filter((n) => !/whisper|tts|guard|embed|moderation|vision|ocr|transcri|audio|image|safeguard/i.test(n));
  if (p === 'openrouter') return f.find((n) => n === 'openrouter/free') || f.find((n) => /llama-3\.3-70b.*:free$/.test(n)) || f.find((n) => /:free$/.test(n)) || f[0] || null;
  const rx = p === 'groq' ? /llama-3\.3-70b/i : /mistral-small/i;
  return f.find((n) => rx.test(n)) || f.find((n) => /70b|large|small/i.test(n)) || f[0] || null;
}
async function oaGenerate(m) {
  const p = String(m.provider || ''), cfg = OA[p]; if (!cfg) throw new Error('Unknown AI provider');
  const apiKey = String(m.apiKey || '').trim(); if (!apiKey) throw new Error('Paste the ' + cfg.name + ' API key in the AI settings first.');
  let model = String(m.model || cfg.model);
  const go = (mm) => oaFetch(p, apiKey, '/chat/completions', { method: 'POST', body: JSON.stringify(g2oBody(m.body, mm)) }, 2);
  try { return { json: o2gJson(await go(model)), model }; }
  catch (e) {
    if (e && e.status === 404) { const alt = oaPick(p, await oaModels(p, apiKey)); if (alt && alt !== model) { model = alt; return { json: o2gJson(await go(model)), model, switched: true }; } }
    throw e;
  }
}

// ---------- Message bridge (content.js <-> background.js) ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      // v2.20.0: access control (device registry / block / update) runs first; it also refuses protected operations when access is stopped
      const accessReply = (typeof accessHandle === 'function') ? await accessHandle(msg, sender) : null;
      if (accessReply) return sendResponse(accessReply);
      if (msg.op === 'cloudStatus') {
        let auth = await local.get(AUTH_KEY);
        if (!auth || !auth.refreshToken) { try { auth = await autoConnect(); } catch (e) { auth = null; } }
        const cfg = await getCfg();
        return sendResponse({ ok: true, configured: !!(cfg.url && cfg.anonKey), connected: !!(auth && auth.refreshToken), email: cfg.email, projectId: cfg.projectId });
      }
      if (msg.op === 'cloudConnect') {
        const email = String(msg.email || '').trim(), password = msg.password, cfg = await getCfg();
        if (!email || !password) throw new Error('Enter the email and the password.');
        const t = await signIn(cfg, email, password);
        await local.set(CFG_KEY, { email: t.email || email });
        await local.set(AUTH_KEY, { idToken: t.idToken, refreshToken: t.refreshToken, expiresAt: Date.now() + Number(t.expiresIn) * 1000, localId: t.localId });
        return sendResponse({ ok: true, email });
      }
      if (msg.op === 'cloudDisconnect') {
        await local.remove(CFG_KEY); await local.remove(AUTH_KEY); await local.remove('gpsaAccessCache');
        return sendResponse({ ok: true });
      }
      if (msg.op === 'cloudPush') {
        const n = await cloudPush(msg.items || []);
        return sendResponse({ ok: true, count: n });
      }
      if (msg.op === 'cloudDelete') {
        const n = await cloudDeleteDocs(msg.tokens || []);
        return sendResponse({ ok: true, count: n });
      }
      if (msg.op === 'cloudHas') {
        const found = await cloudHas((msg.tokens || []).map(String));
        return sendResponse({ ok: true, found });
      }
      if (msg.op === 'cloudPull') {
        const r = await cloudPullAll();
        return sendResponse({ ok: true, items: r.items, wipeAt: r.wipeAt });
      }
      if (msg.op === 'aiGemini') {
        const r = await geminiGenerate(msg);
        return sendResponse({ ok: true, json: r.json, model: r.model, switched: !!r.switched });
      }
      if (msg.op === 'aiModels') {
        const list = await geminiModels(String(msg.apiKey || '').trim(), msg.apiBase);
        return sendResponse({ ok: true, models: list, suggested: pickModel(list) });
      }
      if (msg.op === 'aiChat') {
        const r = await oaGenerate(msg);
        return sendResponse({ ok: true, json: r.json, model: r.model, switched: !!r.switched });
      }
      if (msg.op === 'aiChatModels') {
        const list = await oaModels(String(msg.provider), String(msg.apiKey || '').trim());
        return sendResponse({ ok: true, models: list, suggested: oaPick(String(msg.provider), list) });
      }
      if (msg.op === 'colRead') {
        const items = await colList(msg.collection, Math.min(Number(msg.max) || 1500, 5000));
        return sendResponse({ ok: true, items });
      }
      if (msg.op === 'aiMemPull') { return sendResponse({ ok: true, items: await colList(AI_COL, 1000) }); }
      if (msg.op === 'aiMemPush') { return sendResponse({ ok: true, count: await aiPush(msg.items || []) }); }
      if (msg.op === 'aiMemDelete') { return sendResponse({ ok: true, count: await aiDelete((msg.ids || []).map(String)) }); }
      sendResponse({ ok: false, error: 'Unknown op' });
    } catch (e) {
      const op = String(msg && msg.op), st = e && e.status;
      if (op === 'aiChat' || op === 'aiChatModels') return sendResponse({ ok: false, status: st, error: oaFriendly(e, String(msg.provider)) });
      const isAi = /^ai/.test(op);
      sendResponse({ ok: false, status: st, error: isAi && op !== 'aiMemPull' && op !== 'aiMemPush' && op !== 'aiMemDelete' ? geminiFriendly(e) : friendly(String((e && e.message) || e)) });
    }
  })();
  return true; // async response
});
