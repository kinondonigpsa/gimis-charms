// Gimis Charms (Windows): dirisha lenye upau wa juu + ukurasa wa GIMIS, na extension ya GPSA imepakiwa ndani yake.
const { app, BrowserWindow, WebContentsView, session, shell, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const HOME = 'https://gimis.gpsa.go.tz/login';
const TOOLBAR_H = 46;
let win = null;
let view = null;
let extId = null;
let status = 'Inapakia extension...';

// Jina la app lilibadilika kuwa "Gimis Charms": kama mtumiaji alikuwa na "GPSA Browser", endelea kutumia data yake ile ile
// (login, usajili wa device) ili asilazimike kuanza upya.
try {
  const oldData = path.join(app.getPath('appData'), 'GPSA Browser');
  const newData = path.join(app.getPath('appData'), 'Gimis Charms');
  if (fs.existsSync(oldData) && !fs.existsSync(newData)) app.setPath('userData', oldData);
} catch (e) {}
app.setAppUserModelId('tz.gpsa.browser.windows');


function log(...a) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'gpsa.log'), new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch (e) {}
}

// Packaged: <resources>/extension. Development: ../extensions/gpsa-extension
function extensionDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'extension')
    : path.join(__dirname, '..', 'extensions', 'gpsa-extension');
}

async function loadExtension() {
  const dir = extensionDir();
  try {
    const exts = session.defaultSession.extensions || session.defaultSession; // Electron 35+ : session.extensions
    const ext = await exts.loadExtension(dir, { allowFileAccess: true });
    extId = ext.id;
    status = '';   // loaded OK: show nothing in the toolbar
    log('Extension loaded', ext.id, ext.name, ext.version);
  } catch (e) {
    status = 'Extension failed to load: ' + (e && e.message ? e.message : e);
    log('Extension FAILED', e && e.stack ? e.stack : e);
  }
}

function layout() {
  if (!win || !view) return;
  const [w, h] = win.getContentSize();
  view.setBounds({ x: 0, y: TOOLBAR_H, width: w, height: Math.max(0, h - TOOLBAR_H) });
}

function sendToolbar(channel, value) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, value);
}

function nav() { return view.webContents.navigationHistory || view.webContents; }

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 700, minHeight: 500,
    title: 'Gimis Charms',
    icon: path.join(__dirname, 'ui', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'ui', 'preload.js'), contextIsolation: true }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'ui', 'toolbar.html'));

  view = new WebContentsView({ webPreferences: { contextIsolation: true } });
  win.contentView.addChildView(view);
  layout();
  win.on('resize', layout);
  win.on('maximize', layout);
  win.on('unmaximize', layout);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);
  win.on('closed', () => { win = null; view = null; });

  const wc = view.webContents;
  const pushUrl = (_e, url) => sendToolbar('url', url);
  wc.on('did-navigate', pushUrl);
  wc.on('did-navigate-in-page', pushUrl);
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;   // -3 = imesitishwa na mtumiaji
    log('Load failed', code, desc, url);
    const html = '<html><body style="font-family:sans-serif;padding:24px"><h2>Ukurasa haukupakia</h2><p><b>' + desc +
      '</b> (code ' + code + ')</p><p>' + url + '</p><p>Angalia mtandao kisha bonyeza Reload.</p></body></html>';
    wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
  // Viungo vinavyofungua dirisha jipya: ukurasa wa GIMIS/extension unafunguka ndani ya app, vingine kwenye browser ya kawaida.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/gimis\.gpsa\.go\.tz\//.test(url) || url.startsWith('chrome-extension://')) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1100, height: 800, autoHideMenuBar: true } };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.loadURL(HOME);
  win.webContents.once('did-finish-load', () => { sendToolbar('status', status); sendToolbar('url', HOME); });
}

ipcMain.on('nav', (_e, action) => {
  if (!view) return;
  const wc = view.webContents;
  if (action === 'back' && nav().canGoBack()) nav().goBack();
  else if (action === 'forward' && nav().canGoForward()) nav().goForward();
  else if (action === 'reload') wc.reload();
  else if (action === 'home') wc.loadURL(HOME);
});
ipcMain.on('go', (_e, text) => {
  if (!view) return;
  let t = String(text || '').trim();
  if (!t) return;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
    t = (/\s/.test(t) || !t.includes('.')) ? 'https://duckduckgo.com/?q=' + encodeURIComponent(t) : 'https://' + t;
  }
  view.webContents.loadURL(t);
});
// Kitufe cha "GPSA Control" = kile kinachofanyika ukibonyeza icon ya extension kwenye Chrome (owner console).
ipcMain.on('control', () => {
  if (!extId) { sendToolbar('status', status); return; }
  const w = new BrowserWindow({ width: 1100, height: 800, autoHideMenuBar: true, title: 'GPSA Control' });
  w.loadURL('chrome-extension://' + extId + '/owner.html');
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Page', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'quit' }] },
      { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }
    ]));
    await loadExtension();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
