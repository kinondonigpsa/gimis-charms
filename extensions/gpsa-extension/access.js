// access.js - v2.20.0 (content script, runs before content.js)
// Registers this computer with the owner, keeps checking that access is still allowed, shows the
// "register / waiting for approval / blocked / update" screens and the "update available" notice.
// content.js asks window.__gpsaAccess before talking to GIMIS (A.ready, A.locked).
(() => {
  if (window.__gpsaAccess) return;
  const BEAT_MS = 5 * 60 * 1000, FAST_MS = 20 * 1000, BLOCKED_MS = 2 * 60 * 1000, QUOTA_MS = 15 * 60 * 1000;   // v2.24.1: QUOTA_MS = slow retry while the server quota is full
  let readyRes; const A = window.__gpsaAccess = { locked: true, state: 'checking', reason: 'Checking access...', ready: new Promise((r) => { readyRes = r; }) };
  setTimeout(() => readyRes(), 15000);   // never make the page wait forever
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const msg = (m) => new Promise((res) => {
    try { chrome.runtime.sendMessage(m, (r) => res(r || { ok: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'No answer' })); }
    catch (e) { res({ ok: false, error: String((e && e.message) || e) }); }
  });

  // While access is not confirmed, the whole extension screen (#gpsa-host, made by content.js) stays hidden.
  const lockCss = document.createElement('style');
  lockCss.textContent = '#gpsa-host{display:none!important}';
  document.documentElement.appendChild(lockCss);

  const host = document.createElement('div');
  host.id = 'gpsa-access-host';
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483646;font-family:Arial,sans-serif';
  document.documentElement.appendChild(host);
  const R = host.attachShadow({ mode: 'closed' });
  R.innerHTML = `<style>
    *{box-sizing:border-box} [hidden]{display:none!important}
    #m{position:fixed;inset:0;width:100vw;height:100vh;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:16px}
    .c{background:#fff;border-radius:14px;max-width:460px;width:100%;padding:22px 24px;box-shadow:0 12px 40px rgba(0,0,0,.4);font-size:16px;line-height:1.5;color:#1f2937}
    .c h2{margin:0 0 8px;font-size:21px} .c p{margin:6px 0}
    .ic{font-size:36px;line-height:1}
    label{display:block;margin:10px 0 3px;font-weight:bold;font-size:15px} input{width:100%;font-size:16px;padding:9px 10px;border:1px solid #9ca3af;border-radius:8px}
    button{padding:9px 14px;border:0;border-radius:8px;background:#16a34a;color:#fff;font-size:15px;cursor:pointer} button.g{background:#6b7280} button:disabled{opacity:.5;cursor:wait}
    .row{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
    .err{color:#b91c1c;margin-top:8px;font-size:15px} .sm{color:#6b7280;font-size:14px} .why{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 10px;margin-top:8px;color:#991b1b}
    #t{position:fixed;left:16px;bottom:16px;max-width:380px;background:#fff;border:1px solid #bbf7d0;border-left:5px solid #16a34a;border-radius:10px;padding:12px 14px;box-shadow:0 6px 22px rgba(0,0,0,.3);font-size:15px;line-height:1.45;color:#1f2937}
    #t b{display:block;margin-bottom:2px}
    #q{position:fixed;left:50%;top:10px;transform:translateX(-50%);max-width:620px;width:calc(100% - 24px);background:#fffbeb;border:1px solid #fcd34d;border-left:5px solid #f59e0b;border-radius:10px;padding:10px 38px 10px 14px;box-shadow:0 6px 22px rgba(0,0,0,.25);font-size:14.5px;line-height:1.45;color:#78350f}
    #q b{display:block;margin-bottom:2px} #q button{position:absolute;right:6px;top:6px;padding:2px 8px;background:transparent;color:#78350f;font-size:18px;line-height:1}
    #bd{position:fixed;right:16px;bottom:16px;background:#fff;color:#0f3d3a;font-weight:bold;border:2px solid #14b8a6;border-radius:999px;padding:5px 16px 5px 5px;display:flex;align-items:center;gap:8px;box-shadow:0 4px 14px rgba(0,0,0,.3)} #bd img{width:34px;height:34px;border-radius:50%;object-fit:cover;display:block}
  </style>
  <div id="m" hidden><div class="c" id="mc"></div></div>
  <div id="t" hidden></div>
  <div id="q" hidden><button id="qx" title="Close">&times;</button><b>\u26A0\uFE0F Cloud storage is full for today</b>The free daily limit of the cloud database was reached, so access cannot be re-checked right now. <b style="display:inline">You can keep working.</b> Saving to the cloud and the AI memory will work again after the limit resets (about 10:00 am Tanzania time).<br><span style="opacity:.85">Hifadhi ya cloud imejaa kwa leo. Endelea kufanya kazi; itarudi kawaida baada ya kikomo kuisha.</span></div>
  <button id="bd" hidden></button>`;
  const $ = (id) => R.getElementById(id);
  let shown = '', dismissed = false, busy = false, nextT = null, lastBeat = 0, updToastShown = false;

  function setLocked(locked, state, reason, hideUi) {
    const was = A.locked; A.locked = locked; A.state = state; A.reason = reason || '';
    if (was && !locked) setTimeout(() => { try { window.dispatchEvent(new Event('gpsa-access-active')); } catch (e) {} }, 0);
    lockCss.disabled = !hideUi;
    readyRes();
  }
  let quotaClosed = false;
  const showQuota = () => { if (!quotaClosed) $('q').hidden = false; };
  const hideQuota = () => { $('q').hidden = true; quotaClosed = false; };
  $('qx').onclick = () => { quotaClosed = true; $('q').hidden = true; };
  const hideModal = () => { $('m').hidden = true; shown = ''; };
  function showModal(html, dismissible) {
    shown = '';
    $('mc').innerHTML = html + (dismissible ? '<div class="row"><button class="g" id="mx">Not now</button></div>' : '');
    $('m').hidden = false; $('bd').hidden = true;
    const x = $('mx'); if (x) x.onclick = () => { dismissed = true; hideModal(); showBadge(); };
  }
  function showBadge() { const b = $('bd'); b.textContent = ''; const im = document.createElement('img'); try { im.src = chrome.runtime.getURL('logo_recolored.png'); } catch (e) {} im.alt = ''; const tx = document.createElement('span'); tx.textContent = 'Gimis Charms: ' + (A.state === 'needcloud' ? 'sign in' : A.state === 'register' ? 'register this device' : A.state === 'pending' ? 'waiting for approval' : A.state === 'blocked' ? 'access stopped' : 'locked'); b.appendChild(im); b.appendChild(tx); b.hidden = false; b.onclick = () => { dismissed = false; b.hidden = true; beat(true); }; }
  const contactLine = (c) => (c ? `<p class="sm">Contact the owner: <b>${esc(c)}</b></p>` : '');

  // ---- best-effort: find which GIMIS user is logged in (looks in the page's own stored user data) ----
  function detectGimisUser() {
    let best = '';
    const consider = (o) => {
      if (!o || typeof o !== 'object') return '';
      const email = typeof o.email === 'string' && /@/.test(o.email) ? o.email : '';
      const uname = ['username', 'userName', 'login', 'userId'].map((k) => o[k]).find((v) => typeof v === 'string' && v.length > 2 && v.length < 80) || '';
      let full = ['fullName', 'fullname', 'displayName', 'name'].map((k) => o[k]).find((v) => typeof v === 'string' && /\s/.test(v.trim()) && v.length < 80) || '';
      if (!full && typeof o.firstName === 'string' && (o.lastName || o.surname)) full = (o.firstName + ' ' + (o.lastName || o.surname)).trim();
      if (!(email || uname)) return '';
      return [full, email || uname].filter(Boolean).join(' - ');
    };
    const visit = (o, d, hinted) => {
      if (best || !o || typeof o !== 'object' || d > 4) return;
      const c = hinted ? consider(o) : '';
      if (c) { best = c; return; }
      Object.keys(o).slice(0, 40).forEach((k) => { if (!best) visit(o[k], d + 1, hinted || /user|profile|account|principal|session|auth|me$/i.test(k)); });
    };
    [localStorage, sessionStorage].forEach((store) => {
      try {
        for (let i = 0; i < store.length && !best; i++) {
          const k = store.key(i), v = store.getItem(k);
          if (!v || v.length > 30000) continue;
          if (/^[{\[]/.test(v)) { try { visit(JSON.parse(v), 0, /user|profile|account|principal|session|auth/i.test(k)); } catch (e) {} }
          else if (/user(name)?$|e?mail$/i.test(k) && v.length < 100 && /[A-Za-z]/.test(v)) best = v;
        }
      } catch (e) {}
    });
    return best.slice(0, 120);
  }

  // ---- screens ----
  function showRegister(contact, email) {
    const who = detectGimisUser();
    showModal(`<div class="ic">\uD83D\uDCBB</div><h2>Register this computer</h2>
      <p>${email ? 'Signed in as <b>' + esc(email) + '</b>. ' : ''}One last step: tell us who is using Gimis Charms / elapsAI. This is asked only once.</p>
      <label for="rn">Your full name *</label><input id="rn" placeholder="Full name" autocomplete="off">
      ${who ? `<p class="sm">GIMIS account found: <b>${esc(who)}</b></p>` : ''}
      <p class="sm">The owner will see your name, browser, computer type, internet address (IP), extension version and when you last used it.</p>
      <div class="err" id="re" hidden></div>
      <div class="row"><button id="rs">Register</button><button class="g" id="rx">Use a different account</button></div>${contactLine(contact)}`, true);
    shown = 'reg';
    $('rx').onclick = async () => { await msg({ op: 'accountSignOut' }); dismissed = false; beat(true); };
    const go = async () => {
      const name = $('rn').value.trim(), phone = '', er = $('re');
      if (name.length < 3) { er.textContent = 'Please write your full name.'; er.hidden = false; return; }
      $('rs').disabled = true; er.hidden = true;
      const r = await msg({ op: 'accessRegister', name, phone, info: { gimisUser: who } });
      $('rs').disabled = false;
      if (!r || !r.ok) { er.textContent = (r && r.error) || 'Could not register. Check the internet and try again.'; er.hidden = false; return; }
      dismissed = false; apply(r);
    };
    $('rs').onclick = go; $('rn').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    setTimeout(() => { try { $('rn').focus(); } catch (e) {} }, 50);
  }
  // v2.20.2: step 1 - every person signs in (or creates an account) with their OWN email + password
  function showAuth() {
    let mode = 'in', keep = '';
    const draw = () => {
      const up = mode === 'up';
      showModal(`<div class="ic">\uD83D\uDD10</div><h2>${up ? 'Create your account' : 'Sign in'}</h2>
        <p>${up ? 'First time here? Create your own account with your email and a password. After that you will be asked for your name.' : 'Enter your email and password to use Gimis Charms and elapsAI.'}</p>
        <label for="ae">Email *</label><input id="ae" type="email" placeholder="you@example.com" autocomplete="username">
        <label for="ap">Password *</label><input id="ap" type="password" placeholder="${up ? 'At least 6 characters' : 'Your password'}" autocomplete="${up ? 'new-password' : 'current-password'}">
        ${up ? '<label for="ac">Repeat password *</label><input id="ac" type="password" autocomplete="new-password">' : ''}
        <div class="err" id="ar" hidden></div>
        <div class="row"><button id="ag">${up ? 'Create account' : 'Sign in'}</button><button class="g" id="as">${up ? 'I already have an account' : 'Create new account'}</button></div>`, true);
      shown = 'auth'; $('ae').value = keep;
      const go = async () => {
        const email = $('ae').value.trim(), pw = $('ap').value, er = $('ar'); keep = email;
        const fail = (t) => { er.textContent = t; er.hidden = false; };
        if (!email || !pw) return fail('Email and password are both required.');
        if (up && pw !== $('ac').value) return fail('The two passwords are not the same.');
        $('ag').disabled = true; er.hidden = true;
        const r = await msg({ op: up ? 'accountSignUp' : 'accountSignIn', email, password: pw });
        $('ag').disabled = false;
        if (!r || !r.ok) return fail((r && r.error) || 'Could not connect. Check the internet and try again.');
        dismissed = false; hideModal(); beat(true);
      };
      $('ag').onclick = go; $('ap').onkeydown = (e) => { if (e.key === 'Enter') go(); };
      $('as').onclick = () => { keep = $('ae').value.trim(); mode = up ? 'in' : 'up'; draw(); };
      setTimeout(() => { try { ($('ae').value ? $('ap') : $('ae')).focus(); } catch (e) {} }, 50);
    };
    draw();
  }
  function showPending(r) {
    showModal(`<div class="ic">\u23F3</div><h2>Waiting for approval</h2>
      <p>This computer is registered${r.name ? ' as <b>' + esc(r.name) + '</b>' : ''}. The owner must approve it before you can use the system.</p>
      ${r.message ? '<p>' + esc(r.message) + '</p>' : ''}${contactLine(r.contact)}
      <div class="row"><button id="ck">Check again</button></div>`, true);
    $('ck').onclick = () => beat(true);
  }
  function showBlocked(r) {
    showModal(`<div class="ic">\uD83D\uDEAB</div><h2>Access stopped</h2>
      <p>The owner of this system has stopped this device / account from using Gimis Charms and elapsAI.</p>
      ${r.reason ? '<div class="why">' + esc(r.reason) + '</div>' : ''}${contactLine(r.contact)}
      <div class="row"><button id="ck" class="g">Check again</button></div>`, true);
    $('ck').onclick = () => beat(true);
  }
  function showUpdateRequired(r) {
    showModal(`<div class="ic">\u2B06\uFE0F</div><h2>Update required</h2>
      <p>You are using version <b>${esc(r.current)}</b>. The owner requires version <b>${esc(r.latest)}</b> or newer.</p>
      ${r.notes ? '<p class="sm">' + esc(r.notes) + '</p>' : ''}
      <div class="row"><button id="up">Update now</button></div>`, true);
    $('up').onclick = () => msg({ op: 'openPage', page: 'updater' });
  }
  function showVerify() {
    showModal(`<div class="ic">\uD83C\uDF10</div><h2>Cannot verify access</h2>
      <p>The system could not reach the access server. Connect to the internet and try again.</p>
      <div class="row"><button id="ck">Try again</button></div>`, true);
    $('ck').onclick = () => beat(true);
  }
  function showStale() {
    showModal(`<div class="ic">\uD83D\uDD04</div><h2>Extension was updated</h2><p>Refresh this page (F5) to use the new version.</p>
      <div class="row"><button id="rf">Refresh page</button></div>`, false);
    $('rf').onclick = () => location.reload();
  }
  function showToast(html, ms) { const t = $('t'); t.innerHTML = html; t.hidden = false; if (ms) setTimeout(() => { t.hidden = true; }, ms); return t; }

  function apply(r) {
    clearTimeout(nextT);
    let next = BEAT_MS;
    if (!r || !r.ok) {
      if (/context invalidated|Extension context/i.test(String(r && r.error))) { setLocked(true, 'stale', 'Extension was updated. Refresh the page.', true); showStale(); return; }
      if (/full for today|quota/i.test(String(r && r.error))) { setLocked(false, 'active', '', false); hideModal(); $('bd').hidden = true; showQuota(); next = QUOTA_MS; }   // v2.24.1: never lock because of quota
      else {
        if (A.state !== 'active') { setLocked(true, 'verify', 'Could not verify access.', true); if (!dismissed) showVerify(); else showBadge(); }
        next = FAST_MS;
      }
    } else {
      const s = r.state;
      if (s !== 'quota' && !r.quota) hideQuota();
      if (s === 'quota') { setLocked(false, 'active', '', false); hideModal(); $('bd').hidden = true; showQuota(); next = QUOTA_MS; }   // v2.24.1: server quota full -> keep working, show a notice
      else if (s === 'register') { setLocked(true, 'register', 'This computer is not registered yet.', true); if (!dismissed) { if (shown !== 'reg') showRegister(r.contact, r.email); } else showBadge(); next = BEAT_MS; }
      else if (s === 'pending') { setLocked(true, 'pending', 'Waiting for the owner\'s approval.', true); if (!dismissed) showPending(r); else showBadge(); next = r.quota ? QUOTA_MS : FAST_MS; }
      else if (s === 'blocked') { setLocked(true, 'blocked', r.reason || 'Access stopped by the owner.', true); if (!dismissed) showBlocked(r); else showBadge(); next = r.quota ? QUOTA_MS : BLOCKED_MS; }
      else if (s === 'needcloud') {
        setLocked(true, 'needcloud', 'Sign in first.', true);
        if (!dismissed) { if (shown !== 'auth') showAuth(); } else showBadge();
        next = 30000;
      }
      else if (s === 'offline') {
        if (r.graceOk) { setLocked(false, 'active', '', false); hideModal(); $('bd').hidden = true; }
        else { setLocked(true, 'verify', 'Could not verify access.', true); if (!dismissed) showVerify(); else showBadge(); }
        next = FAST_MS;
      }
      else { // active or setup (access rules not published yet: behave as before)
        if (r.updateRequired) { setLocked(true, 'update', 'A required update is waiting.', true); if (!dismissed) showUpdateRequired(r); else showBadge(); }
        else {
          setLocked(false, 'active', '', false); hideModal(); $('bd').hidden = true;
          if (r.updateAvailable && !updToastShown) {
            updToastShown = true;
            const t = showToast(`<b>Update available: v${esc(r.latest)}</b>${r.notes ? esc(String(r.notes).slice(0, 160)) + '<br>' : ''}<div class="row"><button id="uu">Update now</button><button class="g" id="ul">Later</button></div>`);
            $('uu').onclick = () => { t.hidden = true; msg({ op: 'openPage', page: 'updater' }); }; $('ul').onclick = () => { t.hidden = true; };
          } else if (!r.updateAvailable && !$('t').querySelector('#uu')) $('t').hidden = true;
        }
      }
    }
    nextT = setTimeout(() => beat(false), next);
  }

  async function beat(force) {
    if (busy) return;
    if (!force && document.hidden && A.state === 'active') { clearTimeout(nextT); nextT = setTimeout(() => beat(false), BEAT_MS); return; }
    busy = true; lastBeat = Date.now();
    try { apply(await msg({ op: 'accessBeat', info: { gimisUser: detectGimisUser() } })); } finally { busy = false; }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastBeat > 30000) beat(false); });
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.gpsaCloudAuth) setTimeout(() => beat(true), 600); }); } catch (e) {}
  beat(true);
})();
