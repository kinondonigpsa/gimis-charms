// updater.js - v2.20.0: updates this computer to the version the owner published.
// Chrome does not let an unpacked extension replace itself, so this page (opened by the extension) asks once for
// access to the extension's own folder (File System Access API), downloads the published files from Supabase,
// checks every file's SHA-256, writes them (manifest.json last, with rollback on any error) and reloads the extension.
(() => {
  const $ = (id) => document.getElementById(id);
  const bg = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(r || { ok: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'No answer' })); } catch (e) { res({ ok: false, error: String(e) }); } });
  const CUR = chrome.runtime.getManifest().version, NAME = chrome.runtime.getManifest().name;
  const cmp = (a, b) => { const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; } return 0; };
  const say = (t, k) => { const s = $('st'); s.hidden = false; s.className = k || ''; s.textContent = t; };
  const prog = (p) => { $('bar').hidden = false; $('bi').style.width = Math.round(p * 100) + '%'; };
  let meta = null, running = false;

  // ---- remember the chosen folder between sessions ----
  const idb = () => new Promise((res, rej) => { const o = indexedDB.open('gpsa-updater', 1); o.onupgradeneeded = () => o.result.createObjectStore('h'); o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error); });
  const idbGet = async (k) => { try { const d = await idb(); return await new Promise((res) => { const r = d.transaction('h').objectStore('h').get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); } catch (e) { return null; } };
  const idbSet = async (k, v) => { try { const d = await idb(); await new Promise((res) => { const t = d.transaction('h', 'readwrite'); t.objectStore('h').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch (e) {} };

  const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const sha = async (u8) => hex(await crypto.subtle.digest('SHA-256', u8));
  const fromB64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  async function readFile(dir, name) { try { const f = await (await dir.getFileHandle(name)).getFile(); return new Uint8Array(await f.arrayBuffer()); } catch (e) { return null; } }
  async function writeFile(dir, name, u8) { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(u8); await w.close(); }

  async function folder() {
    let dir = await idbGet('dir');
    if (dir && (await dir.queryPermission({ mode: 'readwrite' })) === 'granted') return dir;
    if (dir) { try { if ((await dir.requestPermission({ mode: 'readwrite' })) === 'granted') return dir; } catch (e) { /* needs a click: fall through */ } }
    if (!navigator.userActivation || !navigator.userActivation.isActive) return null;      // picking needs a click
    dir = await window.showDirectoryPicker({ id: 'gpsa-ext', mode: 'readwrite' });
    if ((await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Permission to edit the folder was not given.');
    await idbSet('dir', dir); return dir;
  }

  async function run() {
    if (running) return; running = true; $('go').disabled = true;
    try {
      say('Opening the extension folder...');
      const dir = await folder();
      if (!dir) { say('Press "Update now" and choose the extension folder.'); $('help').hidden = false; return; }
      const mfRaw = await readFile(dir, 'manifest.json');
      let mf = null; try { mf = JSON.parse(new TextDecoder().decode(mfRaw)); } catch (e) {}
      if (!mf || mf.name !== NAME) { await idbSet('dir', null); throw new Error('This is not the extension folder. Choose the folder that contains manifest.json of "' + NAME + '".'); }
      if (mf.version !== CUR && mf.version !== meta.version) { await idbSet('dir', null); throw new Error('This folder has version ' + mf.version + ' but the loaded extension is ' + CUR + '. Choose the folder you loaded the extension from (chrome://extensions > Details shows its location).'); }

      const files = (meta.files || []).filter((f) => /^[A-Za-z0-9._-]+$/.test(f.name) && (f.name !== 'config.js' || meta.includeConfig));
      const todo = [];
      for (let i = 0; i < files.length; i++) {                       // skip files that are already identical
        const old = await readFile(dir, files[i].name);
        if (!old || (await sha(old)) !== files[i].sha256) todo.push(files[i]);
        prog((i + 1) / files.length * 0.15);
      }
      if (!todo.length && mf.version === meta.version) { say('Files are already up to date. Reloading the extension...', 'ok'); return finish(); }

      const got = [];
      for (let i = 0; i < todo.length; i++) {                          // download + verify everything BEFORE touching the folder
        say(`Downloading ${i + 1} / ${todo.length}: ${todo[i].name}`);
        const r = await bg({ op: 'relFile', name: todo[i].name });
        if (!r.ok) throw new Error(r.error || 'Download failed.');
        const u8 = fromB64(r.b64);
        if ((await sha(u8)) !== todo[i].sha256) throw new Error('A downloaded file is damaged (' + todo[i].name + '). Nothing was changed. Try again.');
        got.push({ name: todo[i].name, u8 }); prog(0.15 + (i + 1) / todo.length * 0.55);
      }
      got.sort((a, b) => (a.name === 'manifest.json') - (b.name === 'manifest.json'));   // manifest.json last
      const backup = {}, written = [];
      try {
        for (let i = 0; i < got.length; i++) {
          say(`Installing ${i + 1} / ${got.length}: ${got[i].name}`);
          backup[got[i].name] = await readFile(dir, got[i].name);
          await writeFile(dir, got[i].name, got[i].u8); written.push(got[i].name);
          prog(0.7 + (i + 1) / got.length * 0.3);
        }
      } catch (e) {
        say('Something went wrong, restoring the old files...', 'bad');
        for (const n of written) { try { if (backup[n]) await writeFile(dir, n, backup[n]); } catch (x) {} }
        throw new Error('Update failed and the old version was restored: ' + (e && e.message || e));
      }
      say(`Updated to v${meta.version}. Reloading the extension...`, 'ok');
      await finish();
    } catch (e) {
      if (e && e.name === 'AbortError') say('No folder chosen.', 'bad'); else say(String((e && e.message) || e), 'bad');
      $('help').hidden = false;
    } finally { running = false; $('go').disabled = false; }
  }
  async function finish() { prog(1); await new Promise((r) => setTimeout(r, 900)); await bg({ op: 'reloadSelf', tabs: $('rt').checked }); }

  async function init() {
    $('cur').textContent = 'v' + CUR; $('cl').onclick = () => window.close();
    const r = await bg({ op: 'relMeta' });
    if (!r.ok) { $('lat').textContent = '-'; say('Could not check for updates: ' + (r.error || 'no connection') + '\nConnect to Cloud storage (GPSA Queue > Cloud storage) and try again.', 'bad'); return; }
    meta = r.meta;
    if (!meta) { $('lat').textContent = 'nothing published yet'; $('nts').textContent = '-'; say('The owner has not published an update yet.'); return; }
    $('lat').textContent = 'v' + meta.version; $('nts').textContent = meta.notes || '-';
    if (cmp(meta.version, CUR) <= 0) { say('You already have the newest version.', 'ok'); return; }
    $('go').hidden = false; $('lb').hidden = false; $('go').onclick = run;
    const dir = await idbGet('dir'); let perm = 'prompt';
    try { if (dir) perm = await dir.queryPermission({ mode: 'readwrite' }); } catch (e) {}
    if (dir && perm === 'granted') run();                   // folder already allowed: update by itself
    else $('help').hidden = false;
  }
  init();
})();
