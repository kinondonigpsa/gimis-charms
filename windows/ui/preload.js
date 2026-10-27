const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gpsa', {
  nav: (a) => ipcRenderer.send('nav', a),
  go: (u) => ipcRenderer.send('go', u),
  control: () => ipcRenderer.send('control'),
  onUrl: (cb) => ipcRenderer.on('url', (_e, u) => cb(u)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s))
});
