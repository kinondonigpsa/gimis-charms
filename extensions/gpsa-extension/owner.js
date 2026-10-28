// owner.js - v2.20.0: "GPSA Control" page. Everyone sees the top card (this computer);
// the owner signs in to see every device, block / approve them, set access rules and publish updates.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const bg = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(r || { ok: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'No answer' })); } catch (e) { res({ ok: false, error: String(e) }); } });
  const VER = chrome.runtime.getManifest().version, ONLINE_MS = 7 * 60 * 1000;
  const cmp = (a, b) => { const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; } return 0; };
  const when = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '-');
  const ago = (ms, now) => { if (!ms) return '-'; const s = Math.max(0, Math.round((now - ms) / 1000)); if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; };
  let flashT; const flash = (t) => { const m = $('msg'); m.textContent = t; m.hidden = false; clearTimeout(flashT); flashT = setTimeout(() => { m.hidden = true; }, 5000); };
  $('hv').textContent = 'v' + VER;

  let devices = [], now = Date.now(), myId = '', published = null, owner = false;

  // ---------------- this computer ----------------
  async function renderMe() {
    const s = await bg({ op: 'accessState' });
    if (!s.ok) { $('meKv').innerHTML = '<div>Error</div><div>' + esc(s.error) + '</div>'; return; }
    myId = s.deviceId; published = s.release; $('so').hidden = !s.email; $('so').textContent = 'Sign out (' + (s.email || '') + ')';
    const qn = s.quota ? ' <span class="muted">- server quota is full today, last known status is used</span>' : '';
    const c = s.cache, st = !c ? 'Not verified yet' : c.status === 'active' ? 'Active' : c.status === 'pending' ? 'Waiting for approval' : c.status === 'blocked' ? 'Blocked by the owner' : c.status;
    const newer = s.release && cmp(s.release.version, VER) > 0;
    $('meKv').innerHTML = `<div>Status</div><div><b class="${c && c.status === 'active' ? 'ok' : c && c.status ? 'bad' : ''}">${esc(st)}</b>${qn}${c && c.checkedAt ? ' <span class="muted">(checked ' + esc(when(c.checkedAt)) + ')</span>' : ''}</div>
      <div>Installed version</div><div><b>${esc(VER)}</b></div>
      <div>Newest published</div><div>${s.release ? '<b class="' + (newer ? 'old' : 'ok') + '">' + esc(s.release.version) + '</b>' + (newer ? ' - update available' : ' - up to date') : '<span class="muted">nothing published yet</span>'}</div>
      <div>Device ID</div><div class="muted">${esc(String(s.deviceId).slice(0, 13))}...</div>`;
    $('upd').hidden = !newer;
    if (owner) renderUpdates();
  }
  $('chk').onclick = async () => {
    $('chk').disabled = true; $('meNote').textContent = 'Checking...';
    const r = await bg({ op: 'accessBeat', info: { noWrite: true, refresh: true } });
    $('chk').disabled = false;
    $('meNote').textContent = r.ok ? (r.state === 'needcloud' ? 'Sign in first: open GIMIS, then enter your email and password.' : r.state === 'register' ? 'Open GIMIS: you will be asked for your name to finish registering.' : r.state === 'offline' ? 'No connection to the server.' : r.state === 'quota' ? 'Cloud storage is full for today (Supabase free limit). You can keep working; it resets about 10:00 am Tanzania time.' : '') : (r.error || 'Failed');
    await renderMe();
  };
  $('so').onclick = async () => { if (!confirm('Sign out of this account on this computer? You will be asked to sign in again in GIMIS.')) return; await bg({ op: 'accountSignOut' }); await renderMe(); flash('Signed out.'); };
  $('upd').onclick = () => bg({ op: 'openPage', page: 'updater' });

  // ---------------- owner sign-in ----------------
  async function showOwner(on, email) { owner = on; $('login').hidden = on; $('cons').hidden = !on; $('oem').textContent = email || ''; if (on) { await loadDevices(); await loadSettings(); renderUpdates(); } }
  $('ol').onclick = async () => {
    const e = $('oe').value.trim(), p = $('op').value; $('le').hidden = true; $('ol').disabled = true;
    const r = await bg({ op: 'ownerLogin', email: e, password: p }); $('ol').disabled = false;
    if (!r.ok) { $('le').textContent = r.error || 'Sign-in failed.'; $('le').hidden = false; return; }
    $('op').value = ''; await showOwner(true, r.email);
    if (r.quota) flash('Signed in. the Supabase usage limit is reached, so the device list cannot load now. Try again later.');
  };
  $('op').onkeydown = (e) => { if (e.key === 'Enter') $('ol').click(); };
  $('lo').onclick = async () => { await bg({ op: 'ownerLogout' }); await showOwner(false); };

  const tabs = ['t1', 't2', 't3'];
  // Back / Forward: every tab change is a history step, so the buttons (and the Chrome back/forward keys) move between the tabs you opened
  let navI = 0, navMax = 0;
  function navPaint() { $('nbk').disabled = navI <= 0; $('nfw').disabled = navI >= navMax; }
  function setTab(i) { tabs.forEach((x, j) => { $(x).classList.toggle('on', i === j); $('p' + (j + 1)).hidden = i !== j; }); if (i === 2) renderUpdates(); }
  try { history.replaceState({ t: 0, i: 0 }, ''); } catch (e) {}
  tabs.forEach((t, i) => { $(t).onclick = () => { const cur = tabs.findIndex((x) => $(x).classList.contains('on')); setTab(i); if (i !== cur) { navI += 1; navMax = navI; try { history.pushState({ t: i, i: navI }, ''); } catch (e) {} navPaint(); } }; });
  window.addEventListener('popstate', (ev) => { const s = ev.state; if (s && typeof s.t === 'number') { navI = s.i || 0; if (navI > navMax) navMax = navI; setTab(s.t); navPaint(); } });
  $('nbk').onclick = () => history.back();
  $('nfw').onclick = () => history.forward();

  // ---------------- devices ----------------
  async function loadDevices() {
    $('dn').textContent = 'Loading...';
    const r = await bg({ op: 'devList' });
    if (!r.ok) { $('dn').textContent = ''; flash(r.error || 'Could not load devices.'); $('tb').innerHTML = '<tr><td colspan="8" class="muted" style="padding:16px">' + esc(r.error || 'Could not load devices.') + '</td></tr>'; return; }
    devices = r.devices; now = r.now; $('dn').textContent = ''; renderDevices();
  }
  const online = (d) => d.lastSeen && now - d.lastSeen < ONLINE_MS;
  function renderDevices() {
    const q = $('q').value.trim().toLowerCase(), fs = $('fs').value;
    const cnt = (f) => devices.filter(f).length;
    const latest = published && published.version;
    $('chips').innerHTML = [['Devices', devices.length], ['Online now', cnt(online)], ['Active', cnt((d) => d.status === 'active')], ['Waiting approval', cnt((d) => d.status === 'pending')], ['Blocked', cnt((d) => d.status === 'blocked')], ['Old version', latest ? cnt((d) => cmp(d.version, latest) < 0) : 0]].map((x) => `<div class="chip"><b>${x[1]}</b>${x[0]}</div>`).join('');
    const rows = devices.filter((d) => (!fs || d.status === fs) && (!q || [d.name, d.phone, d.gimisUser, d.cloudEmail, d.ip, d.accountKey, d.note].join(' ').toLowerCase().indexOf(q) > -1))
      .sort((a, b) => (online(b) - online(a)) || ((b.lastSeen || 0) - (a.lastSeen || 0)));
    $('tb').innerHTML = rows.length ? rows.map((d) => {
      const st = d.status || 'active', old = latest && cmp(d.version, latest) < 0;
      const acts = [];
      if (st === 'pending') acts.push(['approve', 'Approve', '']);
      if (st !== 'blocked') acts.push(['block', 'Block', 'r']); else acts.push(['unblock', 'Unblock', '']);
      if (d.accountKey) acts.push(['blockacc', 'Block account', 'o']);
      acts.push(['note', 'Edit', 'g'], ['del', 'Remove', 'g']);
      return `<tr data-id="${esc(d._id)}"><td><b>${esc(d.name || '(no name)')}</b>${d._id === myId ? ' <span class="muted">(this computer)</span>' : ''}<br><span class="muted">${esc(d.phone || '')}</span>${d.note ? '<br><i class="muted">' + esc(d.note) + '</i>' : ''}</td>
        <td>${esc(d.gimisUser || '-')}<br><span class="muted">${esc(d.cloudEmail || '')}</span></td>
        <td>${esc(d.browser || '')}<br><span class="muted">${esc(d.os || '')} &middot; ${esc(d.ip || '')}</span></td>
        <td class="${old ? 'old' : ''}">${esc(d.version || '-')}</td><td>${esc(when(d.firstSeen))}</td>
        <td><span class="dot ${online(d) ? 'on' : ''}"></span>${online(d) ? 'Online' : esc(ago(d.lastSeen, now))}<br><span class="muted">${esc(when(d.lastSeen))}</span></td>
        <td><span class="b ${esc(st)}">${st === 'pending' ? 'Waiting' : esc(st)}</span>${st === 'blocked' && d.blockedReason ? '<br><span class="muted">' + esc(d.blockedReason) + '</span>' : ''}</td>
        <td><div class="acts">${acts.map((a) => `<button class="s ${a[2]}" data-a="${a[0]}">${a[1]}</button>`).join('')}</div></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="muted" style="padding:16px">No devices to show.</td></tr>';
  }
  $('q').oninput = renderDevices; $('fs').onchange = renderDevices; $('rf').onclick = loadDevices;
  $('tb').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const id = b.closest('tr').dataset.id, d = devices.find((x) => x._id === id), a = b.dataset.a; if (!d) return;
    const who = d.name || id.slice(0, 8); let r;
    b.disabled = true;
    if (a === 'approve') r = await bg({ op: 'devSet', id, fields: { status: 'active' } });
    else if (a === 'unblock') r = await bg({ op: 'devSet', id, fields: { status: 'active' } });
    else if (a === 'block') { const why = prompt(`Block ${who}? Optional reason (shown to the user):`, ''); if (why === null) { b.disabled = false; return; } r = await bg({ op: 'devSet', id, fields: { status: 'blocked', blockedReason: why } }); }
    else if (a === 'blockacc') { const why = prompt(`Block the whole account "${d.gimisUser || d.name}" (all its computers, now and later)? Optional reason:`, ''); if (why === null) { b.disabled = false; return; } r = await bg({ op: 'accBlock', accountKey: d.accountKey, label: d.gimisUser || d.name, reason: why }); }
    else if (a === 'note') { const nm = prompt('Name:', d.name || ''); if (nm === null) { b.disabled = false; return; } const nt = prompt('Note (only you see it):', d.note || ''); if (nt === null) { b.disabled = false; return; } r = await bg({ op: 'devSet', id, fields: { name: nm, note: nt } }); }
    else if (a === 'del') { if (!confirm(`Remove ${who} from the list? It will have to register again.`)) { b.disabled = false; return; } r = await bg({ op: 'devDelete', id }); }
    flash(r && r.ok ? 'Done.' : ((r && r.error) || 'Failed.')); await loadDevices(); await loadSettings();
  });

  // ---------------- access settings ----------------
  async function loadSettings() {
    const c = await bg({ op: 'cfgGet' });
    if (c.ok) { const mode = c.cfg.mode === 'approval' ? 'approval' : 'open'; document.querySelectorAll('input[name=md]').forEach((r) => { r.checked = r.value === mode; }); $('ct').value = c.cfg.contact || ''; $('ms').value = c.cfg.message || ''; }
    const a = await bg({ op: 'accList' });
    $('bl').innerHTML = a.ok && a.items.length ? a.items.map((i) => `<tr><td><b>${esc(i.label || i.accountKey)}</b><br><span class="muted">${esc(i.accountKey)}</span></td><td>${esc(i.reason || '')}</td><td>${esc(when(i.at))}</td><td><button class="s" data-k="${esc(i.accountKey)}">Unblock</button></td></tr>`).join('') : '<tr><td colspan="4" class="muted" style="padding:12px">No blocked accounts.</td></tr>';
  }
  $('sv').onclick = async () => {
    const mode = (document.querySelector('input[name=md]:checked') || {}).value || 'open';
    const r = await bg({ op: 'cfgSet', mode, contact: $('ct').value, message: $('ms').value }); flash(r.ok ? 'Settings saved.' : r.error || 'Failed.');
  };
  $('bl').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-k]'); if (!b) return;
    if (!confirm('Unblock this account and its computers?')) return;
    const r = await bg({ op: 'accUnblock', accountKey: b.dataset.k }); flash(r.ok ? 'Unblocked (' + r.devices + ' computers).' : r.error || 'Failed.'); await loadDevices(); await loadSettings();
  });

  // ---------------- updates ----------------
  function renderUpdates() {
    const p = published, newer = !p || cmp(VER, p.version) > 0;
    $('upKv').innerHTML = `<div>Installed on this computer</div><div><b>${esc(VER)}</b></div><div>Published for everyone</div><div>${p ? '<b>' + esc(p.version) + '</b>' + (p.notes ? ' - ' + esc(p.notes) : '') : '<span class="muted">nothing yet</span>'}</div><div>Computers on an older version</div><div>${p ? devices.filter((d) => cmp(d.version, p.version) < 0).length : '-'}</div>`;
    $('pbv').textContent = VER; $('pb').disabled = !newer;
    $('pn').textContent = newer ? '' : 'Raise "version" in manifest.json first (this version is already published).';
  }
  $('pb').onclick = async () => {
    if (!confirm(`Publish version ${VER} to every computer?`)) return;
    $('pb').disabled = true; $('pn').textContent = 'Uploading files...';
    const r = await bg({ op: 'relPublish', notes: $('nt').value, force: $('fc').checked });
    $('pn').textContent = r.ok ? `Published v${r.version} (${r.count} files, ${Math.round(r.bytes / 1024)} KB). Other computers will pick it up within minutes.` : (r.error || 'Publish failed.');
    await renderMe(); renderUpdates();
  };

  (async () => {
    await renderMe();
    const o = await bg({ op: 'ownerStatus' });
    if (o.ok && o.signedIn) { const t = await bg({ op: 'devList' }); if (t.ok || /full for today/i.test(String(t.error))) { await showOwner(true, o.email); return; } await bg({ op: 'ownerLogout' }); }   // v2.24.1: quota full must not sign the owner out
    await showOwner(false);
  })();
})();
