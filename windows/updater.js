// updater.js - Auto-update ya Gimis Charms (Windows).
// GitHub Actions ikimaliza kujenga, inaandika taarifa ya toleo jipya kwenye Supabase (jedwali gpsa_release, safu "app-windows").
// Hapa tunaisoma (URL + anon key zinatoka config.js ya extension iliyo ndani ya app), tukiona "build" kubwa kuliko ya sasa
// tunaonyesha dirisha, tunapakua installer (.exe) kulingana na aina ya kompyuta (x64 / ia32 / arm64) na kuiendesha.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const EVERY_MS = 30 * 60 * 1000;

function currentBuild() {
  try { return Number(JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')).build) || 0; } catch (e) { return 0; }
}

function readCfg(extDir) {
  try {
    const js = fs.readFileSync(path.join(extDir, 'config.js'), 'utf8');
    const url = ((js.match(/supabaseUrl\s*:\s*'([^']*)'/) || [])[1] || '').trim().replace(/\/+$/, '');
    const key = ((js.match(/supabaseAnonKey\s*:\s*'([^']*)'/) || [])[1] || '').trim();
    return url && key ? { url, key } : null;
  } catch (e) { return null; }
}

function init({ app, dialog, net, getWin, extensionDir, setStatus, log }) {
  let busy = false;
  let lastOk = 0;

  async function fetchInfo() {
    const c = readCfg(extensionDir());
    if (!c) return { ok: false };
    const headers = { apikey: c.key };
    if (c.key.startsWith('eyJ')) headers.authorization = 'Bearer ' + c.key;
    const r = await net.fetch(c.url + '/rest/v1/gpsa_release?select=data&id=eq.app-windows&limit=1', { headers });
    if (!r.ok) return { ok: false };
    const rows = await r.json();
    return { ok: true, data: rows && rows[0] ? rows[0].data : null };
  }

  async function download(info, url) {
    const file = path.join(os.tmpdir(), 'Gimis-Charms-Update-' + info.build + '.exe');
    try { fs.unlinkSync(file); } catch (e) {}
    const r = await net.fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const total = Number(r.headers.get('content-length')) || info.size || 0;
    const ws = fs.createWriteStream(file);
    const reader = r.body.getReader();
    let done = 0, lastPct = -1;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      await new Promise((res, rej) => ws.write(Buffer.from(value), (e) => (e ? rej(e) : res())));
      done += value.length;
      if (total > 0) {
        const pct = Math.floor((done * 100) / total);
        if (pct !== lastPct) {
          lastPct = pct;
          setStatus('Inapakua sasisho ' + pct + '%');
          const w = getWin(); if (w && !w.isDestroyed()) w.setProgressBar(done / total);
        }
      }
    }
    await new Promise((res) => ws.end(res));
    if (info.size > 0 && fs.statSync(file).size !== info.size) { try { fs.unlinkSync(file); } catch (e) {} throw new Error('Faili halijakamilika'); }
    return file;
  }

  async function check(manual) {
    if (busy) return;
    if (!app.isPackaged && !manual) return;                       // wakati wa development hakuna sasisho la otomatiki
    if (!manual && Date.now() - lastOk < EVERY_MS) return;
    busy = true;
    try {
      const res = await fetchInfo();
      if (!res.ok) { if (manual) await dialog.showMessageBox(getWin() || undefined, { type: 'warning', message: 'Imeshindwa kuangalia sasisho (angalia mtandao).' }); return; }
      lastOk = Date.now();
      const d = res.data;
      const cur = currentBuild();
      const build = d ? Number(d.build) || 0 : 0;
      if (!d || build <= cur) {
        if (manual) await dialog.showMessageBox(getWin() || undefined, { type: 'info', message: 'Una toleo jipya zaidi tayari.' });
        return;
      }
      const url = d.urls && d.urls[process.arch];
      if (!url) { log('Update: no installer for arch', process.arch); if (manual) await dialog.showMessageBox(getWin() || undefined, { type: 'warning', message: 'Toleo jipya lipo, lakini haina installer ya kompyuta hii (' + process.arch + ').' }); return; }
      const minBuild = Number(d.minBuild) || 0;
      const required = (minBuild > 0 && cur < minBuild) || (d.force === true && build > cur);
      const info = { build, size: Number((d.sizes || {})[process.arch]) || 0 };
      const pick = await dialog.showMessageBox(getWin() || undefined, {
        type: 'info',
        title: 'Toleo jipya la Gimis Charms',
        message: 'Toleo v' + (d.version || '') + ' (build ' + build + ') liko tayari.',
        detail: String(d.notes || ''),
        buttons: required ? ['Sasisha sasa'] : ['Sasisha sasa', 'Baadaye'],
        defaultId: 0, cancelId: required ? 0 : 1, noLink: true
      });
      if (pick.response !== 0) return;
      let file;
      try { file = await download(info, url); }
      catch (e) {
        log('Update download failed', e && e.message);
        setStatus('');
        await dialog.showMessageBox(getWin() || undefined, { type: 'error', message: 'Kupakua sasisho kumeshindwa: ' + (e && e.message) });
        return;
      }
      const w = getWin(); if (w && !w.isDestroyed()) w.setProgressBar(-1);
      setStatus('Inasakinisha sasisho...');
      log('Starting installer', file);
      // Installer ya NSIS inafunga app hii, inaweka toleo jipya juu ya lililopo na kuifungua tena.
      spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => app.quit(), 800);
    } catch (e) {
      log('Update check failed', e && e.stack ? e.stack : e);
    } finally { busy = false; }
  }

  return { check };
}

module.exports = { init };
