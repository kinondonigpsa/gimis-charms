// workspaces.js - v2.23.0
// Puts the three GIMIS PLUS workspaces (Fuel LPO Search, Vehicle / Token Search, Depot Bin Card) inside Gimis Charms.
// The workspaces themselves (ws-fuel.js, ws-vehicle.js, ws-bincard.js) are unchanged. This file only:
//  - moves their panels into one layer that sits above the Gimis Charms dashboard (opened from the dashboard buttons),
//  - opens / closes them (one at a time), also with the Esc key or a click outside the window,
//  - respects the owner's access control: nothing opens (and an open workspace closes) while this computer is blocked / not registered.
(() => {
  if (window.__gpsaWorkspaces) return;
  const WS = {
    fuel:    { id: 'gfs-panel',         open: 'gfs-open',         title: 'Fuel LPO Search' },
    vehicle: { id: 'gimis-plus-panel',  open: 'gimis-plus-open',  title: 'Vehicle / Token Search' },
    bin:     { id: 'gbe-panel',         open: 'open',             title: 'Depot Bin Card (Diesel / Petrol)' }
  };
  const HOST_Z = '2147483647', HOST_Z_LOW = '2147483000';
  let layer = null;
  const watched = new WeakSet(), watcher = new MutationObserver(() => sync());   // follows the workspaces' own X buttons

  const panel = (k) => document.getElementById(WS[k].id);
  const isOpen = (k) => { const p = panel(k); return !!(p && p.classList.contains(WS[k].open)); };
  const anyOpen = () => Object.keys(WS).some(isOpen);
  const locked = () => !!(window.__gpsaAccess && window.__gpsaAccess.locked);

  function ensureLayer() {
    if (!document.body) return null;
    if (!layer || !document.body.contains(layer)) {
      layer = document.getElementById('gpsa-ws-layer') || document.createElement('div');
      layer.id = 'gpsa-ws-layer';
      document.body.appendChild(layer);
      layer.addEventListener('mousedown', (e) => { if (e.target === layer) closeAll(); });
    }
    // The panels are built by the workspace scripts (appended to <body>); bring them into the layer.
    Object.keys(WS).forEach((k) => {
      const p = panel(k); if (!p) return;
      if (p.parentNode !== layer) layer.appendChild(p);
      if (!watched.has(p)) { watched.add(p); watcher.observe(p, { attributes: true, attributeFilter: ['class'] }); }
    });
    return layer;
  }

  function sync() {
    const l = ensureLayer(); if (!l) return;
    const on = anyOpen();
    l.classList.toggle('on', on);
    // While a workspace is open the dashboard layer must stay underneath it.
    const host = document.getElementById('gpsa-host');
    if (host) host.style.zIndex = on ? HOST_Z_LOW : HOST_Z;
  }

  function closeAll() {
    Object.keys(WS).forEach((k) => { const p = panel(k); if (p) p.classList.remove(WS[k].open); });
    sync();
  }

  function open(k) {
    if (!WS[k]) return { ok: false, reason: 'Unknown workspace.' };
    if (locked()) return { ok: false, reason: (window.__gpsaAccess && window.__gpsaAccess.reason) || 'Access is not allowed on this computer.' };
    ensureLayer();
    const p = panel(k);
    if (!p) return { ok: false, reason: WS[k].title + ' is still loading. Wait a few seconds and try again.' };
    Object.keys(WS).forEach((o) => { if (o !== k) { const q = panel(o); if (q) q.classList.remove(WS[o].open); } });
    p.classList.add(WS[k].open);
    sync();
    try { p.scrollTop = 0; } catch (e) {}
    return { ok: true };
  }

  window.__gpsaWorkspaces = { open, closeAll, isOpen, anyOpen, list: () => Object.keys(WS).map((k) => ({ key: k, title: WS[k].title })) };

  // Pick up panels that are built a little later, or re-attach the layer if the page removed it.
  let tries = 0; const t = setInterval(() => { ensureLayer(); if (++tries > 40) clearInterval(t); }, 500);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && anyOpen()) closeAll(); }, true);
  // Owner blocked / signed out this computer: close at once.
  setInterval(() => { if (locked() && anyOpen()) closeAll(); }, 2000);
  ensureLayer();
})();
