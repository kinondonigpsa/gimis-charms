// access-bg.js - v2.20.0, moved to SUPABASE in v2.25.0 (service worker side)
// 1) Device registry: every computer that uses the extension is listed in Supabase (table gpsa_devices) like
//    WhatsApp "linked devices": who, which browser/PC, IP, version, first/last seen, status.
// 2) Owner control: the owner can approve / block / unblock / remove a device or a whole account.
// 3) Auto-update: the owner publishes the current version to Supabase (gpsa_release); every computer sees it
//    and updates itself (updater.html).
// This file is loaded by background.js with importScripts and re-uses its helpers (ensureToken, getCfg,
// signIn, signUp, refreshIdToken, getDoc, patchDoc, delDoc, listDocs, sbFetch, local).

const DEV_COL = 'gpsaDevices', CFG_COL = 'gpsaConfig', REL_COL = 'gpsaRelease', BLK_COL = 'gpsaBlockedAccounts';
const K_QUOTA = 'gpsaQuotaHit';
const QUOTA_GRACE_MS = 36 * 60 * 60 * 1000;   // v2.24.1: while the server quota is full, a device keeps working this long (quota resets daily)
const K_DEV = 'gpsaDeviceId', K_CACHE = 'gpsaAccessCache', K_OWNER = 'gpsaOwnerAuth', K_REMOTE = 'gpsaRemote', K_TABRELOAD = 'gpsaPendingTabReload';
const GRACE_MS = 24 * 60 * 60 * 1000;     // how long a verified device may work without reaching the server
const REMOTE_TTL = 10 * 60 * 1000;        // access settings + release info are re-read at most every 10 min
const GIMIS_URL = 'https://gimis.gpsa.go.tz/*';
let beatInflight = null, ipCache = { ip: '', at: 0 };

const verOf = () => chrome.runtime.getManifest().version;
function cmpVer(a, b) {
  const x = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0), y = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
const relId = (name) => 'f_' + String(name).replace(/[^A-Za-z0-9_-]/g, '_');

function parseUA(ua) {
  ua = String(ua || '');
  let browser = 'Browser', m;
  if ((m = /Edg\/(\d+)/.exec(ua))) browser = 'Edge ' + m[1];
  else if ((m = /OPR\/(\d+)/.exec(ua))) browser = 'Opera ' + m[1];
  else if ((m = /Chrome\/(\d+)/.exec(ua))) browser = 'Chrome ' + m[1];
  let os = 'Unknown OS';
  if (/Windows NT 10/.test(ua)) os = 'Windows 10/11'; else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1'; else if (/Windows NT 6\.1/.test(ua)) os = 'Windows 7'; else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android'; else if (/CrOS/.test(ua)) os = 'ChromeOS'; else if (/Mac OS X/.test(ua)) os = 'macOS'; else if (/Linux/.test(ua)) os = 'Linux';
  return { browser, os };
}

// ---------- Supabase REST helpers (getDoc / patchDoc / delDoc / listDocs / isQuotaErr) live in background.js ----------
const isQuota = (e) => !!(e && (e.quota || e.message === 'QUOTA'));
async function quotaMark() { await local.set(K_QUOTA, { at: Date.now() }); }
async function quotaOn() { const q = await local.get(K_QUOTA); return !!(q && Date.now() - q.at < QUOTA_GRACE_MS); }
// The server is full: keep working from the last known answer and tell the person why (no lock-out).
async function quotaState() {
  await quotaMark();
  const c = await local.get(K_CACHE);
  if (c && (c.status === 'blocked' || c.status === 'pending')) return { ok: true, state: c.status, reason: '', quota: true };   // keep what we already knew
  if (c && c.updateRequired) return { ok: true, state: 'active', updateRequired: true, quota: true, current: verOf(), latest: '' };
  return { ok: true, state: 'quota', quota: true, graceOk: true, lastOk: (c && c.checkedAt) || 0 };
}

// ---------- Owner sign-in (a separate Supabase account listed in gpsa_owners, NOT the shared office account) ----------
async function ownerToken() {
  const cfg = await getCfg();
  let a = await local.get(K_OWNER);
  if (!a || !a.refreshToken) throw new Error('Owner is not signed in.');
  if (!a.expiresAt || Date.now() > a.expiresAt - 60000) {
    const t = await refreshIdToken(cfg, a.refreshToken);
    a = { ...a, idToken: t.idToken, refreshToken: t.refreshToken, expiresAt: Date.now() + Number(t.expiresIn) * 1000 };
    await local.set(K_OWNER, a);
  }
  return a;
}
const notOwner = (e) => (isQuota(e) ? e : e && e.status === 403 ? new Error('Not allowed: this account is not the owner (add it to the gpsa_owners table), or SUPABASE-SETUP.sql has not been run yet.') : e);

// ---------- Device identity ----------
async function getDeviceId() {
  let id = await local.get(K_DEV);
  if (!id) { id = (self.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9-]/g, ''); await local.set(K_DEV, id); }
  return id;
}
// v2.20.2: one device record per computer AND per account, so two people sharing a computer each register with their own name
async function devDocId(cfg) { const base = await getDeviceId(), k = slug((cfg && cfg.email) || ''); return k ? (base + '_' + k).slice(0, 120) : base; }
async function getIp() {
  if (ipCache.ip && Date.now() - ipCache.at < 3600e3) return ipCache.ip;
  try {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 6000);
    const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store', signal: ac.signal }); clearTimeout(t);
    const j = await r.json(); ipCache = { ip: String(j.ip || ''), at: Date.now() };
  } catch (e) { ipCache.at = Date.now() - 3000e3; }   // try again in ~10 minutes
  return ipCache.ip;
}

// ---------- Remote settings (access mode, contact, newest release) ----------
async function getRemote(tok, force) {
  const c = await local.get(K_REMOTE);
  if (!force && c && Date.now() - c.at < REMOTE_TTL) return c;
  const out = { at: Date.now(), access: {}, release: null };
  try { const a = await getDoc(tok, `${CFG_COL}/access`); if (a) out.access = docObj(a) || {}; } catch (e) { if ((e.network || isQuota(e)) && c) return c; if (isQuota(e)) return out; }
  try { const r = await getDoc(tok, `${REL_COL}/meta`); if (r) out.release = docObj(r); } catch (e) { if ((e.network || isQuota(e)) && c) return c; if (isQuota(e)) return out; }
  await local.set(K_REMOTE, out);
  return out;
}

// ---------- Access state ----------
function stateFrom(doc, remote, now) {
  const status = ['active', 'pending', 'blocked'].indexOf(doc.status) > -1 ? doc.status : 'active';
  const rel = remote && remote.release, cur = verOf();
  const updateAvailable = !!(rel && rel.version && cmpVer(rel.version, cur) > 0);
  const updateRequired = !!(rel && rel.minVersion && cmpVer(cur, rel.minVersion) < 0);
  return {
    ok: true, state: status, reason: doc.blockedReason || '', name: doc.name || '',
    contact: (remote && remote.access && remote.access.contact) || '', message: (remote && remote.access && remote.access.message) || '',
    updateAvailable, updateRequired, latest: rel ? rel.version || '' : '', notes: rel ? rel.notes || '' : '', current: cur, checkedAt: now
  };
}
const saveCache = (s) => local.set(K_CACHE, { status: s.state, checkedAt: s.checkedAt, updateRequired: !!s.updateRequired, setup: !!s.setup });
async function offlineState() {
  const c = await local.get(K_CACHE);
  return { ok: true, state: 'offline', graceOk: !!(c && c.status === 'active' && !c.updateRequired && Date.now() - c.checkedAt < GRACE_MS) };
}

async function officeToken() {
  try { return await ensureToken(); }
  catch (e) {
    const m = String((e && e.message) || e);
    if (m === 'NOT_CONNECTED' || m === 'NOT_CONFIGURED' || /TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND|CREDENTIAL/i.test(m)) { const er = new Error('NEEDCLOUD'); er.needCloud = true; throw er; }
    const er = new Error('NETWORK'); er.network = true; throw er;
  }
}

async function doBeat(info) {
  info = info || {};
  let t;
  try { t = await officeToken(); } catch (e) { return e.needCloud ? { ok: true, state: 'needcloud' } : offlineState(); }
  const tok = t.auth, cfg = t.cfg, id = await devDocId(t.cfg), path = `${DEV_COL}/${id}`, now = Date.now();
  let cur;
  try { cur = await getDoc(tok, path); }
  catch (e) {
    if (e.network) return offlineState();
    if (isQuota(e)) return quotaState();
    if (e.status === 403) { const s = { ok: true, state: 'active', setup: true, checkedAt: now, error: 'The Supabase tables / access rules are not created yet (run SUPABASE-SETUP.sql).' }; await saveCache(s); return { ...s, state: 'setup' }; }
    throw e;
  }
  if (!cur) { await local.remove(K_QUOTA); const rm = await getRemote(tok, true).catch(() => null); return { ok: true, state: 'register', email: cfg.email || '', contact: (rm && rm.access && rm.access.contact) || '' }; }
  const remote = await getRemote(tok, !!info.refresh).catch(() => null);
  let doc = docObj(cur);
  if (!info.noWrite) {
    const ua = parseUA(navigator.userAgent), ip = await getIp();
    const upd = { lastSeen: now, version: verOf(), cloudEmail: cfg.email || '', browser: ua.browser, os: ua.os, ip, gimisUser: info.gimisUser || doc.gimisUser || '' };
    try { const d = await patchDoc(tok, path, upd, Object.keys(upd), true); doc = docObj(d); }
    catch (e) { if (e.network) return offlineState(); if (isQuota(e)) { await quotaMark(); } }   // could not write 'last seen' - the read above still gave the real status
  }
  const s = stateFrom(doc, remote, now);
  await saveCache(s);
  await local.remove(K_QUOTA);   // server answered normally again
  return s;
}
function accessBeat(info) { beatInflight = doBeat(info).finally(() => { beatInflight = null; }); return beatInflight; }

async function doRegister(m) {
  const name = String(m.name || '').trim().slice(0, 80), phone = String(m.phone || '').trim().slice(0, 30), info = m.info || {};
  if (name.length < 3) throw new Error('Enter your full name.');
  let t; try { t = await officeToken(); } catch (e) { throw new Error(e.needCloud ? 'Connect to Cloud storage first.' : 'No internet connection.'); }
  const tok = t.auth, cfg = t.cfg, base = await getDeviceId(), id = await devDocId(cfg), now = Date.now();
  const key = slug(cfg.email) || slug(info.gimisUser || phone || name) || base.slice(0, 8);
  const remote = await getRemote(tok, true);
  let blocked = null; try { blocked = await sbFetch(cfg, tok, 'POST', 'rpc/gpsa_blocked_info', { k: key }); } catch (e) { if (e.network) throw new Error('No internet connection.'); if (isQuota(e)) throw new Error('QUOTA'); throw e; }
  const status = blocked ? 'blocked' : 'active';   // v2.20.2: no owner approval - a person who registers starts working at once
  const ua = parseUA(navigator.userAgent), ip = await getIp();
  const doc = { deviceId: base, name, phone, gimisUser: info.gimisUser || '', cloudEmail: cfg.email || '', accountKey: key, browser: ua.browser, os: ua.os, ua: String(navigator.userAgent || '').slice(0, 300), ip, version: verOf(), firstSeen: now, lastSeen: now, status, blockedReason: blocked ? (blocked.reason || '') : '' };
  try { await patchDoc(tok, `${DEV_COL}/${id}`, doc, null, false); }
  catch (e) { if (e.status === 409 || e.status === 400) return accessBeat({}); if (isQuota(e)) throw new Error('QUOTA'); throw e.status === 403 ? new Error('Registration was refused by the server. Try again; if it keeps failing tell the owner.') : e; }
  const s = stateFrom(doc, remote, now); await saveCache(s); return s;
}

// Every protected operation (cloud data, AI) goes through this check. Returns '' when allowed, else the reason.
async function gate() {
  let c = await local.get(K_CACHE);
  if (!c && beatInflight) { try { await beatInflight; } catch (e) {} c = await local.get(K_CACHE); }
  const q = await quotaOn();   // v2.24.1: server quota full -> do not lock the person out
  if (!c) return q ? '' : 'Access has not been verified yet. Connect to Cloud storage and keep GIMIS open.';
  if (c.status === 'blocked') return 'Access to this system has been stopped by the owner.';
  if (c.status === 'pending') return "This device is waiting for the owner's approval.";
  if (c.updateRequired) return 'A required update is waiting. Update the extension to continue.';
  if (Date.now() - c.checkedAt > GRACE_MS && !q) return 'Access could not be verified for over 24 hours. Connect to the internet.';
  return '';
}

// ---------- Release (auto-update) ----------
function packageFiles(m, includeConfig) {
  const s = new Set(['manifest.json', 'background.js', 'access-bg.js', 'access.js', 'owner.html', 'owner.js', 'updater.html', 'updater.js', 'README.md']);
  if (m.background && m.background.service_worker) s.add(m.background.service_worker);
  (m.content_scripts || []).forEach((c) => { (c.js || []).forEach((f) => s.add(f)); (c.css || []).forEach((f) => s.add(f)); });   // v2.23.0: css files too
  (m.web_accessible_resources || []).forEach((w) => (w.resources || []).forEach((f) => s.add(f)));
  Object.keys(m.icons || {}).forEach((k) => s.add(m.icons[k]));
  if (m.sandbox && m.sandbox.pages) m.sandbox.pages.forEach((f) => s.add(f));
  if (!includeConfig) s.delete('config.js');
  return [...s].filter((n) => /^[A-Za-z0-9._-]+$/.test(n));
}
const OPTIONAL_FILES = new Set(['README.md', 'config.js']);
function b64(buf) { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
async function sha256(buf) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf)); return [...h].map((x) => x.toString(16).padStart(2, '0')).join(''); }

async function relPublish(m) {
  const a = await ownerToken(), mf = chrome.runtime.getManifest(), version = mf.version;
  const old = docObj(await getDoc(a, `${REL_COL}/meta`).catch((e) => { throw notOwner(e); }));
  if (old && old.version && cmpVer(version, old.version) <= 0) throw new Error(`The version installed here (${version}) is not newer than the published one (${old.version}). Raise "version" in manifest.json, reload the extension, then publish again.`);
  const names = packageFiles(mf, !!m.includeConfig), files = []; let bytes = 0;
  for (const n of names) {
    let r; try { r = await fetch(chrome.runtime.getURL(n)); if (!r.ok) throw new Error('missing'); } catch (e) { if (OPTIONAL_FILES.has(n)) continue; throw new Error('Cannot read ' + n + ' from the installed extension.'); }
    const buf = await r.arrayBuffer(), data = b64(buf);
    if (data.length > 900000) throw new Error(n + ' is too large to publish (limit about 650 KB).');
    const h = await sha256(buf);
    await patchDoc(a, `${REL_COL}/${relId(n)}`, { name: n, b64: data, sha256: h, size: buf.byteLength, version }, null);
    files.push({ name: n, sha256: h, size: buf.byteLength }); bytes += buf.byteLength;
  }
  const meta = { version, notes: String(m.notes || '').slice(0, 2000), publishedAt: Date.now(), publishedBy: a.email || '', minVersion: m.force ? version : ((old && old.minVersion) || ''), includeConfig: !!m.includeConfig, files };
  await patchDoc(a, `${REL_COL}/meta`, meta, null);      // meta last: clients only see a release after all its files are uploaded
  const rm = (await local.get(K_REMOTE)) || { access: {} };
  await local.set(K_REMOTE, { at: Date.now(), access: rm.access || {}, release: meta });
  return { ok: true, version, count: files.length, bytes };
}

// ---------- Opening our own pages / reloading ----------
function openPage(p) { if (p !== 'owner' && p !== 'updater') return; chrome.tabs.create({ url: chrome.runtime.getURL(p + '.html') }); }
async function reloadGimisTabs() { try { const tabs = await chrome.tabs.query({ url: GIMIS_URL }); tabs.forEach((t) => chrome.tabs.reload(t.id)); return tabs.length; } catch (e) { return 0; } }
try { chrome.action.onClicked.addListener(() => openPage('owner')); } catch (e) {}
// After an update the extension reloads itself; this brings the open GIMIS tabs onto the new code.
Promise.resolve().then(() => local.get(K_TABRELOAD)).then(async (at) => { if (!at) return; await local.remove(K_TABRELOAD); if (Date.now() - at < 5 * 60 * 1000) reloadGimisTabs(); }).catch(() => {});

// ---------- Message handler (called first by background.js) ----------
const GATED_OP = /^(cloud(Push|Delete|Has|Pull)|ai[A-Z]\w*|colRead)$/;
async function accessHandle(msg, sender) {
  const op = msg && msg.op; if (!op) return null;
  const fromExt = !!(sender && sender.url && sender.url.indexOf(chrome.runtime.getURL('')) === 0);
  const OWNER_OPS = /^(owner(?!Status$)\w*|dev(List|Set|Delete)|acc(Block|Unblock|List)|cfgSet|relPublish)$/;   // v2.25.0: ownerStatus (read-only) may be asked by the dashboard; tokensWipe is checked by the server (owner only)
  if (OWNER_OPS.test(op) && !fromExt) return { ok: false, error: 'Not allowed from this page.' };

  switch (op) {
    case 'accessBeat': return await accessBeat(msg.info);
    case 'accessRegister': return await doRegister(msg);
    case 'accessState': { const c = (await local.get(K_CACHE)) || null, rm = (await local.get(K_REMOTE)) || null; return { ok: true, quota: await quotaOn(), cache: c, deviceId: await devDocId(await getCfg()), email: (await getCfg()).email || '', version: verOf(), release: rm && rm.release ? { version: rm.release.version, notes: rm.release.notes, minVersion: rm.release.minVersion } : null }; }
    // ---- v2.20.2: every person uses their OWN email + password ----
    case 'accountSignUp': case 'accountSignIn': {
      const email = String(msg.email || '').trim(), password = String(msg.password || '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
      if (!password) throw new Error('Enter your password.');
      const cfg = await getCfg(); let t;
      if (op === 'accountSignUp') {
        if (password.length < 6) throw new Error('The password must be at least 6 characters.');
        t = await signUp(cfg, email, password);
      } else { t = await signIn(cfg, email, password); }
      await local.set('gpsaCloudCfg', { email: t.email || email.toLowerCase() });
      await local.set('gpsaCloudAuth', { idToken: t.idToken, refreshToken: t.refreshToken, expiresAt: Date.now() + Number(t.expiresIn) * 1000, localId: t.localId });
      await local.remove(K_CACHE);
      return { ok: true, email };
    }
    case 'accountSignOut': await local.remove('gpsaCloudCfg'); await local.remove('gpsaCloudAuth'); await local.remove(K_CACHE); return { ok: true };
    case 'openPage': openPage(msg.page); return { ok: true };
    case 'reloadSelf': await local.set(K_TABRELOAD, msg.tabs === false ? 0 : Date.now()); setTimeout(() => chrome.runtime.reload(), 500); return { ok: true };
    case 'reloadGimisTabs': return { ok: true, count: await reloadGimisTabs() };
    case 'relMeta': { const t = await officeToken().then((x) => x.auth).catch(async () => ownerToken()); const d = await getDoc(t, `${REL_COL}/meta`); return { ok: true, meta: docObj(d), current: verOf() }; }
    case 'relFile': {
      const t = await officeToken().then((x) => x.auth).catch(async () => ownerToken());
      const d = docObj(await getDoc(t, `${REL_COL}/${relId(msg.name)}`)); if (!d) throw new Error('File not found in the release: ' + msg.name);
      return { ok: true, name: d.name, b64: d.b64, sha256: d.sha256, size: d.size };
    }
    // ---- owner ----
    case 'ownerStatus': { const a = await local.get(K_OWNER); return { ok: true, signedIn: !!(a && a.refreshToken), email: (a && a.email) || '' }; }
    case 'ownerLogout': await local.remove(K_OWNER); return { ok: true };
    case 'ownerLogin': {
      const email = String(msg.email || '').trim(), password = msg.password, cfg = await getCfg();
      if (!email || !password) throw new Error('Enter the owner email and password.');
      const t = await signIn(cfg, email, password);
      const a = { idToken: t.idToken, refreshToken: t.refreshToken, expiresAt: Date.now() + Number(t.expiresIn) * 1000, localId: t.localId, email: t.email || email };
      await local.set(K_OWNER, a);
      try { const yes = await sbFetch(cfg, a, 'POST', 'rpc/gpsa_is_owner', {}); if (yes !== true) throw err('NOT_OWNER', 403); }
      catch (e) { if (isQuota(e)) return { ok: true, email, quota: true }; await local.remove(K_OWNER); throw notOwner(e); }   // v2.24.1: quota full: stay signed in
      return { ok: true, email: a.email };
    }
    case 'devList': { const a = await ownerToken(); try { return { ok: true, now: Date.now(), devices: await listDocs(a, DEV_COL) }; } catch (e) { throw notOwner(e); } }
    case 'devSet': {
      const a = await ownerToken(), f = msg.fields || {}, upd = {}, now = Date.now();
      ['status', 'blockedReason', 'note', 'name', 'phone'].forEach((k) => { if (f[k] !== undefined) upd[k] = String(f[k]).slice(0, 300); });
      if (upd.status && ['active', 'pending', 'blocked'].indexOf(upd.status) < 0) throw new Error('Bad status.');
      if (upd.status) { upd.statusAt = now; if (upd.status !== 'blocked' && f.blockedReason === undefined) upd.blockedReason = ''; }
      await patchDoc(a, `${DEV_COL}/${String(msg.id).replace(/[^A-Za-z0-9_-]/g, '')}`, upd, Object.keys(upd), true).catch((e) => { throw notOwner(e); });
      return { ok: true };
    }
    case 'devDelete': { const a = await ownerToken(); await delDoc(a, `${DEV_COL}/${String(msg.id).replace(/[^A-Za-z0-9_-]/g, '')}`).catch((e) => { throw notOwner(e); }); return { ok: true }; }
    case 'accList': { const a = await ownerToken(); return { ok: true, items: await listDocs(a, BLK_COL).catch((e) => { throw notOwner(e); }) }; }
    case 'accBlock': {
      const a = await ownerToken(), key = slug(msg.accountKey); if (!key) throw new Error('This device has no account key.');
      const reason = String(msg.reason || '').slice(0, 300), now = Date.now();
      await patchDoc(a, `${BLK_COL}/${key}`, { accountKey: key, label: String(msg.label || key).slice(0, 120), reason, at: now, by: a.email || '' }, null).catch((e) => { throw notOwner(e); });
      const devs = (await listDocs(a, DEV_COL)).filter((d) => d.accountKey === key); let n = 0;
      for (const d of devs) { await patchDoc(a, `${DEV_COL}/${d._id}`, { status: 'blocked', blockedReason: reason, statusAt: now }, ['status', 'blockedReason', 'statusAt'], true); n++; }
      return { ok: true, devices: n };
    }
    case 'accUnblock': {
      const a = await ownerToken(), key = slug(msg.accountKey), now = Date.now();
      await delDoc(a, `${BLK_COL}/${key}`).catch((e) => { throw notOwner(e); });
      const devs = (await listDocs(a, DEV_COL)).filter((d) => d.accountKey === key && d.status === 'blocked'); let n = 0;
      for (const d of devs) { await patchDoc(a, `${DEV_COL}/${d._id}`, { status: 'active', blockedReason: '', statusAt: now }, ['status', 'blockedReason', 'statusAt'], true); n++; }
      return { ok: true, devices: n };
    }
    case 'cfgGet': { const a = await ownerToken(); return { ok: true, cfg: docObj(await getDoc(a, `${CFG_COL}/access`)) || {} }; }
    case 'cfgSet': {
      const a = await ownerToken(), mode = 'open';   // v2.20.2: registration is always open (no approval)
      const o = { mode, contact: String(msg.contact || '').slice(0, 200), message: String(msg.message || '').slice(0, 400), updatedAt: Date.now() };
      await patchDoc(a, `${CFG_COL}/access`, o, Object.keys(o)).catch((e) => { throw notOwner(e); });
      await local.remove(K_REMOTE); return { ok: true };
    }
    case 'relPublish': return await relPublish(msg);
    // v2.25.0: admin deletes ALL tokens (cloud table + a marker so every computer clears its own copy). Only the owner account can do it: the server function checks.
    case 'tokensWipe': {
      const a = await ownerToken().catch(() => null); if (!a) throw new Error('Sign in as the owner first (Control > Owner sign-in).');
      const r = await sbFetch(await getCfg(), a, 'POST', 'rpc/gpsa_wipe_tokens', {}).catch((e) => { throw notOwner(e); });
      return { ok: true, count: Number(r && r.count) || 0, at: Number(r && r.at) || Date.now() };
    }
  }
  if (GATED_OP.test(op)) { const why = await gate(); if (why) return { ok: false, error: why, blocked: true }; }
  return null;
}
