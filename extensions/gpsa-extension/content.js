(() => {
  const KEY = 'gpsaQueue', WHO = 'gpsaWho', DAYS = 7;
  const BG = chrome.runtime.getURL('bg.jpg'), LOGO = chrome.runtime.getURL('elapsai-logo.png');
  const host = document.createElement('div');
  host.id = 'gpsa-host';   // v2.20.0: access.js hides this while access is not confirmed
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;font-family:Arial,sans-serif';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = `<style>
    *{box-sizing:border-box}
    [hidden]{display:none!important}
    button{padding:8px 12px;border:0;border-radius:6px;background:#16a34a;color:#fff;cursor:pointer;font-size:15px}
    button.g{background:#6b7280} button.r{background:#dc2626} button:disabled{opacity:.4;cursor:not-allowed}
    input,textarea{width:100%;font-size:15px;padding:5px;border:1px solid #bbb;border-radius:4px}
    #who,.two textarea{height:38px;min-height:38px;padding:8px 12px;border:1px solid #9ca3af;border-radius:10px;background:#fff;line-height:20px}
    .two textarea{field-sizing:content;max-height:160px;overflow:auto}
    #p{position:fixed;top:0;left:0;right:0;bottom:0;width:100vw;height:100vh;z-index:2;display:flex;flex-direction:column;background:#cdeedd url(${BG}) center/cover no-repeat;border:0;border-radius:0;padding:16px;margin:0;box-shadow:none;font-size:15px}
    #hd{display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,.88);border-radius:8px;font-size:17px}
    #sum{margin-left:auto;color:#555;font-size:15px}
    #mn{flex:1;min-height:0;display:grid;grid-template-columns:440px minmax(0,1fr);gap:12px 58px;margin-top:8px}
    #sd{display:flex;flex-direction:column;min-height:0;overflow:hidden;padding:10px;background:rgba(255,255,255,.88);border-radius:8px}
    #ctl{flex:1 1 auto;min-height:0;overflow:auto;padding-right:4px}
    #wk{display:flex;flex-direction:column;min-height:0;gap:8px}
    #tw{flex:1 1 45%;min-height:140px;overflow:auto;border:1px solid #e5e7eb;border-radius:8px;background:rgba(255,255,255,.92)}
    #dt{flex:1 1 55%;min-height:140px;overflow:auto;padding:10px;border:1px solid #ddd;border-radius:6px;background:#f9fafb;font-size:15px}
    #t{width:100%;border-collapse:collapse;font-size:15px} #t td,#t th{border-bottom:1px solid #eee;padding:4px 6px;text-align:left;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}
    #t th{position:sticky;top:0;background:#f3f4f6;z-index:1}
    #t tr[data-k]{cursor:pointer} #t tr[data-k]:hover{background:#f0fdf4} #t tr.cur{outline:2px solid #16a34a;outline-offset:-2px}
    #t input[type=checkbox]{width:auto;margin:0} #t tr.fr{background:#dbeafe} #t tr.sel{background:#fef3c7}
    #nb{padding:6px 10px;border:1px solid #93c5fd;background:#eff6ff;border-radius:8px;font-size:15px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .pending{color:#b45309}.issued{color:#15803d}.failed{color:#b91c1c}
    #lw{flex:0 0 42%;min-height:230px;display:flex;flex-direction:column;margin-top:8px;border:1px solid #d1d5db;border-radius:8px;background:#fff;overflow:hidden}
    #lw.big{flex-basis:78%}
    #lh{display:flex;align-items:center;gap:6px;padding:5px 8px;background:#f3f4f6;font-weight:bold;font-size:15px}
    #lh button{padding:3px 8px}
    #l{flex:1;min-height:0;overflow:auto;padding:8px;font-size:16px;line-height:1.5;word-break:break-word}
    #l div{padding:3px 0;border-bottom:1px dashed #e5e7eb}
    .lg-ok{color:#15803d}.lg-bad{color:#b91c1c}.lg-warn{color:#b45309}.lg-info{color:#374151}
    .vt{width:100%;border-collapse:collapse;font-size:15px} .vt td,.vt th{border-bottom:1px solid #eee;padding:4px 6px;text-align:left;vertical-align:top} .vt th{background:#f3f4f6}
    .vt tr[data-vk]{cursor:pointer} .vt tr[data-vk]:hover{background:#f0fdf4}
    .row{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center}
    .dh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;font-size:16px}
    .badge{padding:2px 8px;border-radius:10px;font-size:14px;color:#fff;background:#6b7280} .badge.issued{background:#15803d;color:#fff} .badge.pending{background:#b45309;color:#fff} .badge.failed{background:#b91c1c;color:#fff}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:8px}
    .card h4{margin:0 0 6px;font-size:15px;color:#166534;text-transform:uppercase;letter-spacing:.4px}
    .card table{width:100%;border-collapse:collapse;font-size:15px} .card td{border-bottom:1px solid #f1f1f1;padding:3px 2px;vertical-align:top;word-break:break-word} .card td:first-child{color:#555;width:42%}
    .note{margin-top:6px;color:#6b7280;font-size:14px}
    #dup{margin-top:6px;padding:8px;border:1px solid #fca5a5;background:#fef2f2;border-radius:8px;font-size:15px;color:#991b1b;line-height:1.45}
    #dup ul{margin:4px 0 0 16px;padding:0} #dup .dx{float:right;padding:1px 7px;background:#6b7280}
    #xb{padding:6px 10px;border:1px solid #fcd34d;background:#fffbeb;border-radius:8px;font-size:15px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .exp-bad{color:#b91c1c;font-weight:bold}.exp-soon{color:#b45309;font-weight:bold}.exp-na{color:#9ca3af}
    .empty{color:#6b7280;padding:14px}
    .lb{display:block;margin:8px 0 2px;font-weight:bold} .rq{color:#dc2626}
    .two{display:grid;grid-template-columns:1fr 1fr;gap:6px} .two textarea{font-family:Consolas,monospace;resize:vertical}
    #cnt{font-size:14px;color:#555} #cnt.bad{color:#dc2626;font-weight:bold}
    select{font-size:15px;padding:5px;border:1px solid #bbb;border-radius:4px;background:#fff}
    #tabs{display:flex;gap:6px;flex-wrap:wrap} #tabs .wsep{flex-basis:100%;height:0} #tabs button.ws{background:#0b6b93} #tabs button.on{background:#16a34a} #tabs button.on#tbBad{background:#dc2626} #tabs button.on#tbNew{background:#b45309}
    #cv{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;padding:8px;border:1px solid #e5e7eb;border-radius:8px;background:rgba(255,255,255,.94)}
    #cvt{flex:1;min-height:0;overflow:auto;border:1px solid #e5e7eb;border-radius:6px;background:#fff}
    #ct{width:100%;border-collapse:collapse;font-size:15px} #ct td,#ct th{border-bottom:1px solid #eee;padding:4px 6px;text-align:left;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}
    #ct th{position:sticky;top:0;background:#f3f4f6;z-index:1} #ct input[type=checkbox]{width:auto;margin:0}
    .st-new{color:#1d4ed8;font-weight:bold}.st-ok{color:#15803d}.st-cloud{color:#b45309;font-weight:bold}.st-here{color:#6b7280}
    #fab{position:fixed;right:16px;bottom:64px;width:58px;height:58px;padding:0;border-radius:50%;border:3px solid #fff;background:#2fb98f;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer;overflow:hidden;z-index:4;animation:fabp 2.6s ease-out infinite}
    #p:not([hidden]) ~ #fab{right:auto;bottom:auto;left:463px;top:50%;margin-top:-22px;width:44px;height:44px}
    #fab:hover{transform:scale(1.08)} #fab img{width:100%;height:100%;object-fit:cover;display:block}
    @keyframes fabp{0%{box-shadow:0 4px 14px rgba(0,0,0,.35),0 0 0 0 rgba(47,185,143,.6)}70%{box-shadow:0 4px 14px rgba(0,0,0,.35),0 0 0 14px rgba(47,185,143,0)}100%{box-shadow:0 4px 14px rgba(0,0,0,.35),0 0 0 0 rgba(47,185,143,0)}}
    #aiw{position:fixed;top:0;left:0;right:0;bottom:0;width:100vw;height:100vh;z-index:3;display:flex;flex-direction:column;background:#cdeedd url(${BG}) center/cover no-repeat;padding:16px;font-size:15px}
    .nv{white-space:nowrap}
    #aih{display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,.88);border-radius:8px;font-size:18px;margin-bottom:8px} #aih img{width:34px;height:34px;border-radius:50%;object-fit:cover} #aih b{color:#166534}
    @media (max-width:900px){#mn{grid-template-columns:1fr;overflow:auto;gap:12px}#sd{overflow:visible}#p:not([hidden]) ~ #fab{left:auto;right:16px;top:auto;bottom:64px;margin-top:0;width:58px;height:58px}}
  </style>
  <div id="p" hidden>
    <div id="hd"><button class="g nv" id="nbk" title="Back" disabled>&#8592; Back</button><button class="g nv" id="nfw" title="Forward" disabled>Forward &#8594;</button><b>Gimis Charms</b><small id="ver" style="color:#6b7280"></small><span id="sum"></span><button class="g" id="ctlBtn" title="Devices, owner console and updates">&#9881; Control</button><button class="g" id="x" title="Close">&#10005;</button></div>
    <div id="mn">
      <div id="sd"><div id="ctl">
        <label class="lb" for="who" style="margin-top:0">Name of person who permitted <span class="rq">*</span></label>
        <input id="who" placeholder="Full name (required)">
        <div class="two">
          <div><label class="lb" for="tk">Token numbers <span class="rq">*</span></label>
            <textarea id="tk" rows="1" placeholder="One token per line"></textarea></div>
          <div><label class="lb" for="ch">Chassis numbers (vehicle) <span class="rq">*</span></label>
            <textarea id="ch" rows="1" placeholder="One chassis per line, same order"></textarea></div>
        </div>
        <div id="dup" hidden></div>
        <div class="row"><span id="cnt"></span><button id="add" style="margin-left:auto">Save</button></div>
        <div class="row"><button id="run" disabled title="Tick the tokens you want to issue (tick the top box to select all), then press here">Issue selected (0)</button>
          <label title="Issues the tokens that are ticked, every 5 minutes"><input type="checkbox" id="auto" style="width:auto"> Auto every 5 minutes</label></div>
        <div class="row"><button id="chk">Check issued (GIMIS)</button>
          <label><input type="checkbox" id="achk" style="width:auto"> Auto-check every 10 minutes</label></div>
        <div class="row"><button class="g" id="regen" disabled title="Asks GIMIS to renew the ticked tokens that have expired before they were issued">P.I.M.P (0)</button></div>
        <div class="row"><button id="up" title="Send everything to the cloud storage AND save a copy on this device (Excel + JSON)">&#11014; Upload</button>
          <button class="r" id="clr" hidden style="display:none">Delete issued</button></div>
        <div class="row"><button class="r" id="del" disabled hidden style="display:none">Delete selected (0)</button>
          <button class="r" id="clrAll" hidden style="display:none" title="Admin only: deletes EVERY token on this computer, in the cloud and (at their next sync) on all other computers">Delete ALL tokens (admin)</button>
          <button class="g" id="impx" title="Load token + chassis numbers from any Excel or CSV file into the boxes (or restore a file made by Upload)">Load Excel</button>
          <input type="file" id="impxf" accept=".xlsx,.xls,.csv,.json,application/json" hidden></div>
        <div class="row"><span id="cloudStat" style="font-size:14px;color:#555"></span></div>
        </div>
        <div id="lw"><div id="lh"><span>Activity log</span><span style="margin-left:auto"></span><button class="g" id="lz" title="Make the log taller / shorter">&#10530;</button><button class="g" id="lc">Clear</button></div><div id="l"></div></div>
      </div>
      <div id="wk">
        <div id="tabs"><button id="tbLocal" class="on">This computer</button><button id="tbNew" class="g">Not issued yet (0)</button><button id="tbBad" class="g">Failed to issue (0)</button><button id="tbOk" class="g">Issued successfully (0)</button><button id="tbCloud" class="g">Cloud storage records</button><span class="wsep" title="Workspaces"></span><button id="wsFuel" class="ws" title="Fuel LPO Search - what was ordered and received, LPO status">Fuel LPO</button><button id="wsVeh" class="ws" title="Search a vehicle or a token in GIMIS">Vehicle / Token</button><button id="wsBin" class="ws" title="Depot Bin Card (Diesel / Petrol) and Excel export">Depot Bin Card</button></div>
        <div id="sb" class="row" style="margin:0"><input id="sq" placeholder="Search token or vehicle (chassis) number..." style="max-width:380px"><select id="sqs"><option value="">All statuses</option><option value="pending">pending</option><option value="issued">issued</option><option value="failed">failed</option></select><span id="sqn" class="note" style="margin:0"></span></div>
        <div id="nb" hidden></div>
        <div id="xb" hidden><b>Expiry watch</b><span id="xs"></span><span style="margin-left:auto"></span><button id="xrun" title="Read the expiry date of every unissued token from GIMIS now">Track expiry now</button><label><input type="checkbox" id="axp" style="width:auto"> Auto every 30 minutes</label></div>
        <div id="tw"><table id="t"></table></div>
        <div id="dt"></div>
        <div id="cv" hidden>
          <div class="row" style="margin-top:0">
            <input id="cvq" placeholder="Search token, chassis, institution, permitter..." style="max-width:320px">
            <select id="cvs"><option value="">All statuses</option><option value="pending">pending</option><option value="issued">issued</option><option value="failed">failed</option></select>
            <button class="g" id="cvr">Refresh from cloud</button>
            <button id="cvp" disabled>Pull selected (0)</button>
            <button id="cvpp">Pull pending only</button>
            <button id="cva">Pull all</button>
          </div>
          <div id="cvn" class="note" style="margin:0"></div>
          <div id="cvt"><table id="ct"></table></div>
        </div>
      </div>
    </div>
  </div>
  <div id="aiw" hidden><div id="aih"><button class="g nv" id="abk" title="Back" disabled>&#8592; Back</button><button class="g nv" id="afw" title="Forward" disabled>Forward &#8594;</button><img src="${LOGO}" alt=""><b>elapsAI</b><span style="margin-left:auto"></span><button class="g" id="aix" title="Close">&#10005;</button></div><div id="aiv"></div></div>
  <button id="fab" title="elapsAI - msaidizi wa GPSA Kinondoni"><img src="${LOGO}" alt="elapsAI"></button>
  <button id="b"><img src="${LOGO}" alt="" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:6px">Gimis Charms</button>`;
  const $ = (id) => root.getElementById(id);
  // Activity log: coloured lines, identical consecutive lines are merged (x2, x3...), and logNew() wipes the old result when the user starts something else.
  const kindOf = (s) => /^(✓)/.test(s) ? 'ok' : /^(✗|Not saved|.*failed)/i.test(s) ? 'bad' : /^(⚠|Another task|The GIMIS session|GIMIS session)/.test(s) ? 'warn' : 'info';
  const log = (s, kind) => {
    const l = $('l'), last = l.lastElementChild;
    if (last && last.dataset.m === s) { const n = (+last.dataset.n || 1) + 1; last.dataset.n = n; last.textContent = s + '  ×' + n; }
    else { const d = document.createElement('div'); d.className = 'lg-' + (kind || kindOf(s)); d.dataset.m = s; d.textContent = s; l.appendChild(d); while (l.children.length > 300) l.removeChild(l.firstChild); }
    l.scrollTop = 1e9;
  };
  const logNew = (title, keepCur) => { $('l').textContent = ''; if (!keepCur) cur = null; if (title) log(title, 'info'); };
  $('lc').onclick = () => { $('l').textContent = ''; };
  $('lz').onclick = () => { $('lw').classList.toggle('big'); };
  $('b').onclick = () => { $('p').hidden = !$('p').hidden; render(); };
  $('x').onclick = () => { $('p').hidden = true; };

  const store = {
    get: (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v[k]))),
    set: (k, v) => new Promise((r) => chrome.storage.local.set({[k]: v}, r))
  };
  // STORAGE RULES (same on this computer and in the cloud):
  //  1. The token number is the one unique key of a record.
  //  2. updatedAt changes ONLY for records that really changed (before, every Save re-stamped every record, so cloud/local copies kept fighting).
  //  3. The newest updatedAt wins; deletes travel as "tombstones" so a deleted record is not brought back by the other side.
  const sigs = new WeakMap();
  const sigOf = (i) => JSON.stringify(i, (k, v) => (k === 'updatedAt' ? undefined : v));
  const load = async () => { const q = (await store.get(KEY)) || []; q.forEach((i) => sigs.set(i, sigOf(i))); return q; };
  const save = (q) => { const now = Date.now(); q.forEach((i) => { if (!i.updatedAt || sigs.get(i) !== sigOf(i)) i.updatedAt = now; sigs.set(i, sigOf(i)); }); schedulePush(); return store.set(KEY, q); };
  const replaceItem = (li, ci) => { Object.keys(li).forEach((k) => delete li[k]); Object.assign(li, ci); };
  const norm = (s) => String(s || '').trim().toLowerCase();
  const daysLeft = (it) => it.expireOn ? Math.ceil((it.expireOn - Date.now()) / 864e5) : null;   // only from a real GIMIS expiry date - never guessed
  const fmt = (ms) => ms ? new Date(ms).toLocaleString('en-GB', {day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false}) : '';
  const span = (a, b) => { if (!a || !b || b < a) return ''; const m = Math.floor((b - a) / 6e4), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60); return (d ? d + ' d ' : '') + h + ' h ' + (m % 60) + ' min'; };
  // Taarifa za GIN (kutoka GIMIS)
  const D = (i) => i.detail || {}, its = (i) => D(i).items || [];
  const sumL = (i) => its(i).reduce((a, x) => a + (Number(x.litres) || 0), 0);
  const estT = (i) => its(i).reduce((a, x) => a + (Number(x.litres) || 0) * (Number(x.unitPrice) || 0), 0);
  const fuelN = (i) => [...new Set(its(i).map((x) => x.name).filter(Boolean))].join(', ');
  const num = (n) => (n == null || n === '' || isNaN(n)) ? '' : Number(n).toLocaleString('en-US');
  const genAt = (i) => i.tokenCreatedAt || i.noteCreatedAt;                       // token ilitengenezwa (au issue note kama mbadala)
  const issAt = (i) => i.gimisIssuedAt || (i.status === 'issued' ? i.issuedAt : null);   // ilipo-issue GIMIS
  const legacy = [[/GIMIS haikuonyesha issued - imerudishwa pending/, 'GIMIS did not show this token as issued - set back to pending'], [/Imeexpire /, 'Expired on '], [/Haipatikani GIMIS \(expired \/ chassis si sahihi\?\)/, 'Not found in GIMIS (expired, or wrong chassis number?)'], [/Token haijapatikana \/ chassis si sahihi/, 'Token not found, or the chassis number is wrong'], [/Token not found, or the chassis number is wrong \(code (\d+)\)/, 'No Record Found (GIMIS code $1)'], [/Token not found: GIMIS has no record of this token \(it does not exist, or it has expired\) \[GIMIS code (\d+)\]\./, 'No Record Found (GIMIS code $1)'], [/Save haikukamilika/, 'Save did not complete'], [/Hakuna jibu kutoka GIMIS/, 'No response from GIMIS'], [/GIMIS imejibu HTML/, 'GIMIS returned a web page instead of data']];
  const enMsg = (m) => legacy.reduce((a, r) => a.replace(r[0], r[1]), String(m || ''));
  const tip = (i) => [resText(i), i.institution, [i.ref, i.issuedBy].filter(Boolean).join(' · '),
    genAt(i) ? 'Token created: ' + (i.tokenCreatedAt ? '' : '≈ ') + fmt(genAt(i)) : '',
    issAt(i) ? 'Issued in GIMIS: ' + fmt(issAt(i)) + (i.gimisIssuedAt ? '' : ' (local time)') : ''].filter(Boolean).join('\n');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

  // GIMIS answers with a number (code). Its own page turns that number into a pop-up ("9002 : No Record Found") that disappears after a few seconds.
  // We keep a code -> message list: 9002 is confirmed; any other code is learned automatically the first time GIMIS shows its pop-up, then remembered.
  const codes = {9002: 'No Record Found'};
  store.get('gpsaCodes').then((v) => { Object.assign(codes, v || {}); render(); });
  const gimisText = (c) => c == null ? '' : codes[c] ? codes[c] + ' (GIMIS code ' + c + ')' : 'GIMIS code ' + c + ' (message not seen yet)';
  const failText = (r) => r.reason === 'token_unknown' ? (gimisText(r.code) || 'No Record Found') : (r.message || r.error || gimisText(r.code));
  // The ONE reason shown for a token that is not issued: GIMIS' own message, or the exact finding (e.g. wrong chassis)
  const resText = (i) => i.status === 'issued' ? '' : (i.code != null && (i.reason === 'token_unknown' || i.reason === 'gimis_code')) ? gimisText(i.code) : enMsg(i.error);
  new MutationObserver((muts) => {
    for (const mu of muts) for (const n of mu.addedNodes) {
      if (!n || n.nodeType !== 1) continue;
      const t = String(n.innerText || n.textContent || '').trim(); if (!t || t.length > 300) continue;
      const x = /\b(9\d{3})\s*:\s*([A-Za-z][^\n\r]{2,70})/.exec(t); if (!x) continue;
      const c = +x[1], msg = x[2].trim().split(/\s{2,}/)[0];
      if (!codes[c]) { codes[c] = msg; store.set('gpsaCodes', codes); render(); }
    }
  }).observe(document.documentElement, {childList: true, subtree: true});
  // A manual "Request" done by hand in GIMIS: keep GIMIS' answer on the saved token, so it stays visible after the pop-up is gone
  async function onGimisCall(d) {
    if (!d.token || d.code == null || d.code === 9000) return;
    const q = await load(), it = q.find((i) => i.token === String(d.token).trim());
    if (!it || it.status === 'issued') return;
    if (d.chassis && norm(d.chassis) !== norm(it.chassis)) return;   // tested with another vehicle: not about this record
    const reason = d.code === 9002 ? 'token_unknown' : 'gimis_code';
    if (it.code === d.code && it.reason === reason) return;
    it.code = d.code; it.reason = reason; it.error = gimisText(d.code); await save(q); render();
  }

  const sel = new Set(), kOf = (i) => i.token + '|' + i.chassis; let shown = [], cur = null, veh = null;
  // Records just restored / pulled: shown highlighted at the top of "This computer" so they are never hidden.
  let fresh = new Set(), freshMsg = '', onlyFresh = false;
  let expRunAt = 0;   // when expiry dates were last read from GIMIS
  // Parts of "This computer": '' = all, 'bad' = failed to issue (status failed, or pending with a GIMIS reason), 'ok' = issued successfully
  let part = '';
  const isBad = (i) => i.status === 'failed' || (i.status === 'pending' && !!resText(i));
  const isNew = (i) => i.status === 'pending' && !resText(i);   // saved, waiting to be issued, no GIMIS problem recorded
  const inPart = (i) => part === 'bad' ? isBad(i) : part === 'ok' ? i.status === 'issued' : part === 'new' ? isNew(i) : true;
  let aview = false;   // AI Assistant tab open
  // ---------- Back / Forward through the screens (panel, tabs, cloud records, token details, elapsAI) ----------
  const navH = []; let navI = -1, navBusy = false;
  function navSnap() { return { p: !$('p').hidden, ai: !$('aiw').hidden, cv: cview, part, cur }; }
  function navPaint() { const b = navI <= 0, f = navI >= navH.length - 1; ['nbk', 'abk'].forEach((id) => { $(id).disabled = b; }); ['nfw', 'afw'].forEach((id) => { $(id).disabled = f; }); }
  function navMark() {
    if (navBusy) return; const s = navSnap();
    if (navI >= 0 && JSON.stringify(navH[navI]) === JSON.stringify(s)) return;
    navH.splice(navI + 1); navH.push(s); if (navH.length > 60) navH.shift(); navI = navH.length - 1; navPaint();
  }
  function navGo(d) {
    const i = navI + d; if (i < 0 || i >= navH.length) return;
    navBusy = true; navI = i; const s = navH[i];
    part = s.part; cur = s.cur; $('p').hidden = !s.p;
    if (s.ai) { $('aiw').hidden = false; $('fab').hidden = true; if (window.__gpsaHooks && window.__gpsaHooks.aiOpen) window.__gpsaHooks.aiOpen(); }
    else { $('aiw').hidden = true; $('fab').hidden = false; }
    setView(s.cv); render(); navBusy = false; navPaint();
  }
  function paintTabs() { const o = !cview && !aview; $('tbLocal').className = o && !part ? 'on' : 'g'; $('tbNew').className = o && part === 'new' ? 'on' : 'g'; $('tbBad').className = o && part === 'bad' ? 'on' : 'g'; $('tbOk').className = o && part === 'ok' ? 'on' : 'g'; $('tbCloud').className = cview ? 'on' : 'g'; }
  const setFresh = (keys, msg) => { fresh = new Set(keys); freshMsg = msg; onlyFresh = false; };
  async function render() {
    const q = await load();
    const c = (s) => q.filter((i) => i.status === s).length;
    $('sum').textContent = `pending ${c('pending')} · issued ${c('issued')} · failed ${c('failed')}`;
    $('tbNew').textContent = `Not issued yet (${q.filter(isNew).length})`; $('tbBad').textContent = `Failed to issue (${q.filter(isBad).length})`; $('tbOk').textContent = `Issued successfully (${c('issued')})`; paintTabs();
    const term = norm($('sq').value), sf = $('sqs').value;
    const exact = term && q.find((i) => norm(i.chassis) === term); veh = exact ? exact.chassis : null;   // exact chassis typed -> vehicle overview
    const rows = q.slice().sort((a, b) => (fresh.has(kOf(b)) ? 1 : 0) - (fresh.has(kOf(a)) ? 1 : 0) || (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || a.addedAt - b.addedAt)
      .filter((i) => inPart(i) && (!onlyFresh || fresh.has(kOf(i))) && (!sf || i.status === sf) && (!term || [i.token, i.chassis, i.ref || D(i).ref, D(i).institution || i.institution, i.permittedBy].join(' ').toLowerCase().includes(term)));
    $('sqn').innerHTML = (term || sf || part) ? (rows.length ? rows.length + ' of ' + q.length + ' shown' : 'No match on this computer. <a href="#" id="sqc">Search the cloud storage records</a>') : '';
    shown = rows; const have = new Set(q.map(kOf)); [...sel].forEach((k) => { if (!have.has(k)) sel.delete(k); });
    $('t').innerHTML = `<tr><th><input type="checkbox" id="all" ${rows.length && rows.every((i) => sel.has(kOf(i))) ? 'checked' : ''}></th><th>Token</th><th>Chassis</th><th>Institution</th><th>Fuel</th><th>Litres</th><th>Unit price</th><th>Status</th><th>Reason</th></tr>` + rows.map((i) =>
      `<tr data-k="${esc(kOf(i))}" class="${(sel.has(kOf(i)) ? 'sel' : '') + (fresh.has(kOf(i)) ? ' fr' : '') + (cur === kOf(i) ? ' cur' : '')}" title="${esc(tip(i))}"><td><input type="checkbox" class="ck" data-k="${esc(kOf(i))}" ${sel.has(kOf(i)) ? 'checked' : ''}></td><td>${esc(i.token)}</td><td>${esc(i.chassis)}</td>` +
      `<td>${esc(D(i).institution || i.institution)}</td><td>${esc(fuelN(i))}</td><td>${esc(num(sumL(i) || ''))}</td><td>${esc(num((its(i)[0] || {}).unitPrice))}</td>` +
      `<td class="${i.status}">${i.status}${i.verified === true ? ' ✓' : (i.status === 'issued' && i.verified === false ? ' ⚠' : '')}</td>` +
      `<td style="color:${i.status === 'failed' ? '#b91c1c' : '#b45309'};max-width:330px" title="${esc(resText(i))}">${esc(resText(i))}</td></td></tr>`).join('') + (rows.length ? '' : '<tr><td colspan="9" class="empty">' + (part === 'new' ? 'No saved tokens are waiting to be issued.' : part === 'bad' ? 'No tokens have failed to issue.' : part === 'ok' ? 'No tokens issued successfully yet.' : 'No tokens match.') + '</td></tr>');
    $('del').textContent = `Delete selected (${sel.size})`; $('del').disabled = !sel.size;
    $('run').textContent = `Issue selected (${sel.size})`; $('run').disabled = !sel.size;
    $('regen').textContent = `P.I.M.P (${sel.size})`; $('regen').disabled = !sel.size;
    { const nb = $('nb'); nb.hidden = cview || aview || !fresh.size; if (fresh.size) nb.innerHTML = `<b>${esc(freshMsg)}</b> <span>Highlighted in blue and kept at the top - use <b>Check issued</b> or <b>Issue all pending</b> on them.</span><button class="g" id="nbOnly">${onlyFresh ? 'Show all' : 'Show only these'}</button><button class="g" id="nbClr">Clear highlight</button>`; }
    $('xb').hidden = true;   // expiry dates of not-issued tokens are no longer shown (they were estimates)
    showDetail(q); navMark();
  }

  // GIN details (English): click any row, or shown automatically after Check / Issue
  function showDetail(q) {
    const el = $('dt'), it = cur && q.find((i) => kOf(i) === cur);
    if (!it) { if (veh) return showVehicle(q); el.innerHTML = '<div class="empty">Click a token row (or press <b>Check issued</b> / <b>Issue</b>) to see its GIN details here: institution, wallet, request, vehicle, requester, fuel and dates.</div>'; return; }
    const d = D(it), g = genAt(it), is = issAt(it), items = its(it);
    const card = (title, rows, foot) => {
      const r = rows.filter((x) => x[1] != null && x[1] !== '');
      return `<div class="card"><h4>${esc(title)}</h4>` + (r.length ? '<table>' + r.map((x) => `<tr><td>${esc(x[0])}</td><td><b>${esc(x[1])}</b></td></tr>`).join('') + '</table>' : '<div class="note">Not available yet</div>') + (foot ? `<div class="note">${esc(foot)}</div>` : '') + '</div>';
    };
    const fuel = items.length ? items.map((x, n) => card('Fuel' + (items.length > 1 ? ' #' + (n + 1) : ''), [
      ['Type', x.name], ['Litres', num(x.litres)], ['Unit price (TZS / litre)', num(x.unitPrice)],
      ['Estimated total (TZS)', x.litres && x.unitPrice ? num(x.litres * x.unitPrice) : ''], ['Item issued', x.issued ? 'Yes' + (x.issuedAt ? ' - ' + fmt(Date.parse(x.issuedAt)) : '') : 'No']
    ], 'Estimate = litres × unit price. It is an estimate, not the official amount paid.')).join('') : card('Fuel', []);
    const st = it.status + (it.verified === true ? ' ✓ (confirmed by GIMIS)' : it.status === 'issued' && it.verified === false ? ' ⚠ (not confirmed by GIMIS)' : '');
    el.innerHTML = `<div class="dh"><b>Token ${esc(it.token)}</b><span>Chassis ${esc(it.chassis)}</span><span class="badge ${esc(it.status)}">${esc(it.status)}${it.verified === true ? ' ✓' : ''}</span>` +
      (d.ref || it.ref ? `<span>GIN: <b>${esc(d.ref || it.ref)}</b></span>` : '') +
      `<span style="margin-left:auto"></span><button class="g" id="dv">All tokens of this vehicle</button><button id="dr">Refresh from GIMIS</button>${it.status !== 'issued' ? '<button class="g" id="dg" title="Ask GIMIS to renew this token if it has expired">Regenerate</button>' : ''}<button class="g" id="dc">Close</button></div>` +
      (it.detAt || items.length ? '' : '<div class="note" style="margin:0 0 8px">Details not loaded yet - press <b>Refresh from GIMIS</b>.</div>') +
      '<div class="cards">' +
      card('Institution', [['Institution', d.institution || it.institution], ['Station / shop', d.shop], ['Wallet', d.wallet]]) +
      card('Request', [['Title', d.requestTitle], ['Tracking number', d.trackingNumber], ['Type', d.requisitionType], ['Description', d.description]]) +
      card('Vehicle', [['Chassis / vehicle no.', d.vehicle || it.chassis], ['Vehicle GIMIS has for this token', it.reason === 'chassis_mismatch' ? it.gimisVehicle : ''], ['Shipping method', d.shipping]]) +
      card('Requester', [['Full name', d.requesterName], ['Email', d.requesterEmail], ['Issued to (GIMIS)', d.issuedPersonName || it.issuedBy]]) +
      fuel +
      card('Dates & status', [
        ['Status', st], ['GIN number', d.ref || it.ref],
        ['Token created', g ? (it.tokenCreatedAt ? '' : '≈ ') + fmt(g) : ''], ['Expires', it.status === 'issued' ? fmt(it.expireOn) : ''],
        ['Issued in GIMIS', is ? fmt(is) + (it.gimisIssuedAt ? '' : ' (local time - press Refresh)') : 'Not issued yet'],
        ['Time to issue', is && g ? span(g, is) : ''], ['Saved here', fmt(it.addedAt)], ['Permitted by', it.permittedBy],
        ['Last result', resText(it)], ['Attempts', it.status !== 'issued' && it.attempts ? String(it.attempts) : '']
      ], g && !it.tokenCreatedAt ? '≈ = taken from the issue note (GIMIS did not return the token date).' : '') +
      '</div>';
  }
  // Vehicle overview: everything saved for one chassis number
  function showVehicle(q) {
    const el = $('dt'), v = norm(veh), list = q.filter((i) => norm(i.chassis) === v).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const c = (s) => list.filter((i) => i.status === s).length, lit = list.reduce((a, i) => a + sumL(i), 0);
    const insts = [...new Set(list.map((i) => D(i).institution || i.institution).filter(Boolean))].join(', ');
    el.innerHTML = `<div class="dh"><b>Vehicle ${esc(veh)}</b><span>${list.length} token(s)</span><span class="badge pending">pending ${c('pending')}</span><span class="badge issued">issued ${c('issued')}</span><span class="badge failed">failed ${c('failed')}</span>` +
      (lit ? `<span>Total litres: <b>${esc(num(lit))}</b></span>` : '') + (insts ? `<span>Institution: <b>${esc(insts)}</b></span>` : '') +
      `<span style="margin-left:auto"></span><button class="g" id="dc">Close</button></div>` +
      '<table class="vt"><tr><th>Token</th><th>Status</th><th>Institution</th><th>Fuel</th><th>Litres</th><th>Token created</th><th>Issued in GIMIS</th><th>GIN</th><th>Permitted by</th><th>Last result</th></tr>' +
      list.map((i) => `<tr data-vk="${esc(kOf(i))}"><td>${esc(i.token)}</td><td class="${esc(i.status)}">${esc(i.status)}${i.verified === true ? ' ✓' : ''}</td><td>${esc(D(i).institution || i.institution)}</td><td>${esc(fuelN(i))}</td><td>${esc(num(sumL(i) || ''))}</td><td>${esc(fmt(genAt(i)))}</td><td>${esc(fmt(issAt(i)))}</td><td>${esc(D(i).ref || i.ref)}</td><td>${esc(i.permittedBy)}</td><td>${esc(resText(i))}</td></tr>`).join('') +
      '</table><div class="note">Click a row to open the full details of that token.</div>';
  }
  $('sq').addEventListener('input', async () => {
    const q = await load(), t = norm($('sq').value); sel.clear(); cur = null;
    if (!running) $('l').textContent = '';
    if (t) { const ex = q.filter((i) => norm(i.token) === t); if (ex.length === 1) cur = kOf(ex[0]); }   // exact token -> open its details
    render();
  });
  $('sqs').addEventListener('change', () => { sel.clear(); render(); });
  $('nb').addEventListener('click', (e) => { if (e.target.id === 'nbOnly') { onlyFresh = !onlyFresh; render(); } else if (e.target.id === 'nbClr') { fresh = new Set(); onlyFresh = false; render(); } });
  $('sb').addEventListener('click', (e) => { if (e.target.id === 'sqc') { e.preventDefault(); $('cvq').value = $('sq').value.trim(); setView(true); } });
  $('t').addEventListener('click', (e) => {
    const t = e.target; if (!t || t.type === 'checkbox') return;
    const tr = t.closest && t.closest('tr[data-k]'); if (!tr) return;
    if (!running) $('l').textContent = '';
    cur = cur === tr.dataset.k ? null : tr.dataset.k; render();
  });
  $('dt').addEventListener('click', (e) => {
    const vr = e.target.closest && e.target.closest('tr[data-vk]');
    if (e.target.id === 'dc') { if (cur) cur = null; else $('sq').value = ''; render(); }
    else if (e.target.id === 'dr' && cur) checkAll(false, [cur]);
    else if (e.target.id === 'dg' && cur) regen([cur]);
    else if (e.target.id === 'dv' && cur) { $('sq').value = cur.split('|')[1]; sel.clear(); cur = null; if (!running) $('l').textContent = ''; render(); }
    else if (vr) { cur = vr.dataset.vk; render(); }
  });
  $('t').addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'all') shown.forEach((i) => (t.checked ? sel.add(kOf(i)) : sel.delete(kOf(i))));
    else if (t.classList.contains('ck')) t.checked ? sel.add(t.dataset.k) : sel.delete(t.dataset.k);
    render();
  });
  $('del').onclick = async () => {
    if (!(await isOwnerNow())) { log('Only the owner of the system can delete data.', 'warn'); return; }
    if (!sel.size || !confirm(`Permanently delete the ${sel.size} selected token(s)? This cannot be undone.`)) return;
    const n = sel.size, q = await load(), gone = q.filter((i) => sel.has(kOf(i))).map((i) => i.token);
    await save(q.filter((i) => !sel.has(kOf(i)))); sel.clear(); logNew('Deleted: ' + n); render();
    cloudDeleteTokens(gone);
  };
  // Merge restored records, then show them right away (This computer tab, filters cleared, highlighted at the top).
  async function restoreRecords(inc) {
    const q = await load(), byTok = {}; q.forEach((i) => { byTok[i.token] = i; });
    const added = [], dup = [], clash = []; let bad = 0;
    for (const i of inc) {
      if (!i || !i.token || !i.chassis) { bad++; continue; }
      const ex = byTok[i.token];
      if (ex) { if (ex.chassis !== i.chassis) clash.push(i.token); else dup.push(kOf(ex)); continue; }
      q.push(i); byTok[i.token] = i; added.push(kOf(i));
    }
    await save(q);
    const msg = `Restored: ${added.length} new` + (dup.length ? `, ${dup.length} already on this computer` : '') + '.';
    setFresh(added.concat(dup), msg);
    $('sq').value = ''; $('sqs').value = ''; sel.clear(); cur = null; part = ''; setView(false);
    logNew(msg);
    if (clash.length) log(`⚠ ${clash.length} token(s) skipped - they already exist here with a different chassis number.`, 'warn');
    if (bad) log(`⚠ ${bad} row(s) skipped - no token or chassis number.`, 'warn');
    render();
  }

  const lines = (v) => v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const flag = (id, on) => { $(id).style.borderColor = on ? '#dc2626' : ''; $(id).style.background = on ? '#fef2f2' : ''; };
  const counts = () => {
    const t = lines($('tk').value).length, c = lines($('ch').value).length, bad = t > 0 && c > 0 && t !== c;
    $('cnt').textContent = `Tokens: ${t} · Chassis numbers: ${c}` + (bad ? ' (must match)' : ''); $('cnt').className = bad ? 'bad' : '';
  };
  ['who', 'tk', 'ch'].forEach((id) => $(id).addEventListener('input', () => { flag(id, false); if (id !== 'who') { flag('tk', false); flag('ch', false); } counts(); }));
  counts();
  // ---- Duplicate protection: a token may be stored only once, in ANY storage of this system ----
  // Places checked: (1) the list on this computer (all three parts: not issued / failed / issued), (2) the Supabase cloud storage (gpsaQueue).
  // A token deleted on this computer but not yet removed from the cloud counts as deleted, not as saved.
  async function findSaved(tokens) {
    const found = {}, q = await load(), by = {}; q.forEach((i) => { by[i.token] = i; });
    tokens.forEach((t) => { if (by[t]) found[t] = {where: 'this computer', rec: by[t]}; });
    const rest = tokens.filter((t) => !found[t]); let cloud = 'ok';
    const st = await cloudMsg({op: 'cloudStatus'});
    if (!st.ok || !st.connected) cloud = 'not connected';
    else if (rest.length) {
      const r = await cloudMsg({op: 'cloudHas', tokens: rest});
      if (!r.ok) cloud = 'error: ' + r.error;
      else { const tomb = (await store.get(TOMB)) || {}; rest.forEach((t) => { const c = r.found[t]; if (c && !(tomb[t] && tomb[t] >= (c.updatedAt || 0))) found[t] = {where: 'cloud storage', rec: c}; }); }
    }
    return {found, cloud};
  }
  const partOf = (r) => r.status === 'issued' ? 'Issued successfully' : r.status === 'failed' || (r.status === 'pending' && resText(r)) ? 'Failed to issue' : 'Not issued yet';
  const dupLine = (t, f) => `Token ${t} is already saved in ${f.where}` + (f.where === 'this computer' ? ` (${partOf(f.rec)})` : ` (status: ${f.rec.status || '?'})`) +
    `${f.rec.chassis ? ', chassis ' + f.rec.chassis : ''}${f.rec.permittedBy ? ', permitted by ' + f.rec.permittedBy : ''}${f.rec.addedAt ? ', saved ' + fmt(f.rec.addedAt) : ''}.`;
  const hideDup = () => { $('dup').hidden = true; $('dup').innerHTML = ''; };
  function showDup(found, extra) {
    const ks = Object.keys(found); if (!ks.length && !extra) return hideDup();
    const el = $('dup'); el.hidden = false;
    el.innerHTML = `<button class="dx" id="dupx">✕</button><b>⚠ ${ks.length} token${ks.length === 1 ? ' is' : 's are'} already saved - cannot be saved again</b><ul>` +
      ks.slice(0, 8).map((t) => `<li>${esc(dupLine(t, found[t]))}</li>`).join('') + (ks.length > 8 ? `<li>...and ${ks.length - 8} more.</li>` : '') + '</ul>' + (extra ? `<div style="margin-top:4px">${esc(extra)}</div>` : '');
    $('dupx').onclick = hideDup;
  }
  // Live check while the user types or pastes tokens
  let liveSeq = 0, liveTimer = null;
  $('tk').addEventListener('input', () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      const mine = ++liveSeq, toks = [...new Set(lines($('tk').value).filter((x) => x.length >= 10))];
      if (!toks.length) { hideDup(); return; }
      const {found} = await findSaved(toks);
      if (mine !== liveSeq) return;   // the box changed while we were checking
      Object.keys(found).length ? (showDup(found, 'Remove these tokens from the box - they will not be saved again.'), flag('tk', true)) : hideDup();
    }, 600);
  });
  $('add').onclick = async () => {
    logNew(''); hideDup();
    const who = $('who').value.trim(), tk = lines($('tk').value), ch = lines($('ch').value), errs = [];
    // all three fields are mandatory, and every token needs exactly one chassis number
    if (!who) { flag('who', true); errs.push('enter the name of the person who permitted'); }
    if (!tk.length) { flag('tk', true); errs.push('enter at least one token number'); }
    if (!ch.length) { flag('ch', true); errs.push('enter the chassis number for each token'); }
    if (tk.length && ch.length && tk.length !== ch.length) { flag('tk', true); flag('ch', true); errs.push(`${tk.length} token number(s) but ${ch.length} chassis number(s) - each token needs exactly one chassis number, in the same order`); }
    const badTk = tk.findIndex((x) => /[\s,;]/.test(x)), badCh = ch.findIndex((x) => /[\s,;]/.test(x));
    if (badTk >= 0) { flag('tk', true); errs.push(`token line ${badTk + 1} has spaces or separators - use one token per line`); }
    if (badCh >= 0) { flag('ch', true); errs.push(`chassis line ${badCh + 1} has spaces or separators - use one chassis number per line`); }
    if (errs.length) { errs.forEach((m) => log('Not saved: ' + m + '.')); $(!who ? 'who' : !tk.length ? 'tk' : 'ch').focus(); return; }
    $('add').disabled = true;
    try {
      const phone = '';
      const {found, cloud} = await findSaved([...new Set(tk)]);
      if (cloud.startsWith('error')) {
        if (!confirm(`The cloud storage could not be checked (${cloud.slice(7)}).\n\nThese tokens might already be saved there. Save anyway?`)) { log('Not saved: the cloud storage could not be checked (' + cloud.slice(7) + ').'); return; }
        log('⚠ Cloud could not be checked - only this computer was checked.', 'warn');
      } else if (cloud === 'not connected') log('⚠ Cloud is not connected - only this computer was checked.', 'warn');
      await store.set(WHO, who);
      const q = await load(), existing = new Set(q.map((i) => i.token)), seen = new Set(), newKeys = [], keepTk = [], keepCh = []; let n = 0, twice = 0;
      tk.forEach((token, k) => {
        const chassis = ch[k].toUpperCase();
        const local = existing.has(token) && q.find((i) => i.token === token);   // re-checked here in case something changed while we waited (records saved in THIS click do not count)
        if (!found[token] && local) found[token] = {where: 'this computer', rec: local};
        if (found[token]) { keepTk.push(token); keepCh.push(ch[k]); return; }
        if (seen.has(token)) { twice++; return; }
        seen.add(token);
        q.push({token, chassis, institution: '', permittedBy: who, permittedByPhone: phone, addedAt: Date.now(),
                status: 'pending', attempts: 0, error: '', issuedAt: null}); newKeys.push(token + '|' + chassis); n++;
      });
      await save(q);
      const dups = Object.keys(found).filter((t) => tk.includes(t));
      $('tk').value = keepTk.join('\n'); $('ch').value = keepCh.join('\n'); counts();
      if (dups.length) {
        showDup(Object.fromEntries(dups.map((t) => [t, found[t]])), n ? `The other ${n} token(s) were saved. The duplicates stay in the boxes so you can see them - clear them or correct the token.` : 'Nothing was saved. Correct the token or clear the boxes.');
        flag('tk', true); flag('ch', true);
      }
      log(`Saved: ${n}` + (dups.length ? `. Not saved (already exist): ${dups.length} - see the red box.` : '.') + (twice ? ` ${twice} repeated token(s) were saved once.` : ''), n ? 'ok' : 'warn');
      render();
    } finally { $('add').disabled = false; }
  };
  $('clr').onclick = async () => {
    if (!(await isOwnerNow())) { log('Only the owner of the system can delete data.', 'warn'); return; }
    if (!confirm('Delete all issued tokens from this list?')) return;
    logNew('');
    const q = await load(), gone = q.filter((i) => i.status === 'issued').map((i) => i.token);
    await save(q.filter((i) => i.status !== 'issued')); render();
    cloudDeleteTokens(gone);
  };
  // v2.25.0: ADMIN - delete ALL tokens: this computer + the cloud table, and a marker so every other computer clears its own copy at its next sync.
  $('clrAll').onclick = async () => {
    if (!(await isOwnerNow())) { log('Only the owner of the system can delete data.', 'warn'); return; }
    const q = await load();
    if (!confirm(`DELETE ALL TOKENS?\n\nThis removes every token: ${q.length} on this computer AND everything in the cloud storage. Other computers clear their copy at their next sync.\n\nThis cannot be undone.`)) return;
    if (!confirm('Last check: are you sure you want to delete ALL tokens for everyone?')) return;
    $('clrAll').disabled = true;
    try {
      const r = await cloudMsg({ op: 'tokensWipe' });
      if (!r.ok) { log('✗ Nothing was deleted: ' + r.error, 'bad'); return; }
      await store.set(KEY, []); await store.set(TOMB, {}); await store.set(WIPE_SEEN, r.at || Date.now()); sel.clear(); cur = null;
      logNew(`Deleted ALL tokens: ${q.length} on this computer, ${r.count} in the cloud.`); render();
      if (cview) loadCloudView();
    } finally { $('clrAll').disabled = false; }
  };
  // Columns of the Upload file (Excel) = the columns of the old CSV export, in the same order
  const CH = ['token', 'chassis', 'institution', 'permittedBy', 'permittedByPhone', 'status', 'attempts', 'error', 'code', 'addedAt', 'tokenCreatedAt', 'gimisIssuedAt', 'issuedAt', 'verified', 'ref', 'issuedBy', 'expireOn',
    'shop', 'wallet', 'requestTitle', 'trackingNumber', 'requisitionType', 'requesterName', 'requesterEmail', 'fuelType', 'litres', 'unitPrice', 'estimatedTotal'];
  const cval = (i, k) => {
    const d = D(i);
    if (k === 'institution') return d.institution || i.institution;
    if (k === 'ref') return d.ref || i.ref;
    if (k === 'fuelType') return fuelN(i);
    if (k === 'litres') return sumL(i) || '';
    if (k === 'unitPrice') return (its(i)[0] || {}).unitPrice;
    if (k === 'estimatedTotal') return estT(i) || '';
    if (k === 'error') return resText(i) || i.error;
    if (d[k] != null) return d[k];
    return /(At|On)$/.test(k) && i[k] ? new Date(i[k]).toISOString() : i[k];
  };

  // ===== XLSX BEGIN (no libraries: small writer + reader) =====
  const U8 = new TextEncoder(), TD = new TextDecoder();
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u) => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = crcT[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zipStore(files) {
    const parts = [], cen = []; let off = 0;
    files.forEach((f) => {
      const nm = U8.encode(f.name), data = U8.encode(f.text), crc = crc32(data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      parts.push(new Uint8Array(h.buffer), nm, data); cen.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + data.length;
    });
    const cs = cen.reduce((a, x) => a + x.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(cen, [new Uint8Array(e.buffer)]), {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  const colName = (n) => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const xe = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  function sheetXml(head, rows, widths, reasonCol) {
    const cell = (v, r, c, st) => {
      const ref = colName(c) + r, a = st ? ` s="${st}"` : '';
      if (v == null || v === '') return st ? `<c r="${ref}"${a}/>` : '';
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${a}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${a}><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
    };
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>' +
      widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols><sheetData>';
    x += '<row r="1">' + head.map((h, c) => cell(h, 1, c, 1)).join('') + '</row>';
    rows.forEach((row, ri) => { x += `<row r="${ri + 2}">` + row.map((v, c) => cell(v, ri + 2, c, c === reasonCol ? 2 : 0)).join('') + '</row>'; });
    return x + '</sheetData>' + (rows.length ? `<autoFilter ref="A1:${colName(head.length - 1)}${rows.length + 1}"/>` : '') + '</worksheet>';
  }
  function buildXlsx(sheets) {   // sheets: [{name, head, rows, widths, reasonCol}]
    const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const files = [
      {name: '[Content_Types].xml', text: H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'},
      {name: '_rels/.rels', text: H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {name: 'xl/workbook.xml', text: H + `<workbook xmlns="${NS}" xmlns:r="${R}"><sheets>` + sheets.map((s, i) => `<sheet name="${xe(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'},
      {name: 'xl/_rels/workbook.xml.rels', text: H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
      {name: 'xl/styles.xml', text: H + `<styleSheet xmlns="${NS}"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FFB91C1C"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16A34A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>`}
    ].concat(sheets.map((s, i) => ({name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s.head, s.rows, s.widths, s.reasonCol)})));
    return zipStore(files);
  }
  // ---- reader (.xlsx written by this extension OR re-saved by Excel) ----
  async function inflateRaw(data) { return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text(); }
  async function unzipAll(buf) {
    const u = new Uint8Array(buf), dv = new DataView(buf); let e = u.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('not an .xlsx file');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {};
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = TD.decode(u.subarray(p + 46, p + 46 + nl)), st = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), data = u.subarray(st, st + cs);
      out[name] = {method, data}; p += 46 + nl + xl + cl;
    }
    return out;
  }
  const zText = async (f) => f ? (f.method === 0 ? TD.decode(f.data) : inflateRaw(f.data)) : '';
  const unx = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
  const tText = (x) => { let o = ''; x.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (m, t) => { o += unx(t); return m; }); return o; };
  const colIdx = (s) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const attrOf = (tag, name) => { const m = new RegExp('\\b' + name + '="([^"]*)"').exec(tag); return m ? unx(m[1]) : ''; };
  async function readXlsx(buf) {
    const z = await unzipAll(buf), ss = [];
    (await zText(z['xl/sharedStrings.xml'])).replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, (m, x) => { ss.push(tText(x)); return m; });
    const wb = await zText(z['xl/workbook.xml']), rels = await zText(z['xl/_rels/workbook.xml.rels']), target = {};
    rels.replace(/<Relationship\b[^>]*>/g, (t) => { target[attrOf(t, 'Id')] = attrOf(t, 'Target'); return t; });
    const sheets = [];
    for (const m of wb.match(/<sheet\b[^>]*>/g) || []) {
      let t = target[attrOf(m, 'r:id')] || ''; t = t.replace(/^\//, ''); if (!/^xl\//.test(t)) t = 'xl/' + t;
      const xml = await zText(z[t]), rows = [];
      xml.replace(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g, (m1, inner) => {
        const arr = [];
        (inner || '').replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (m2, at, body) => {
          const r = /\br="([A-Z]+)\d+"/.exec(at), ty = attrOf(at, 't'); let v = '';
          if (body) {
            if (ty === 'inlineStr') v = tText(body);
            else { const vv = /<v>([\s\S]*?)<\/v>/.exec(body); if (vv) { v = unx(vv[1]); if (ty === 's') v = ss[+v] || ''; else if (ty === 'b') v = v === '1' ? 'TRUE' : 'FALSE'; else if ((!ty || ty === 'n') && /e/i.test(v) && isFinite(Number(v))) v = String(Number(v)); } }
          }
          if (r) arr[colIdx(r[1])] = v; return m2;
        });
        rows.push(Array.from(arr, (x) => x == null ? '' : x)); return m1;
      });
      sheets.push({name: attrOf(m, 'name'), rows});
    }
    return sheets;
  }
  function parseCsv(t) {
    const rows = []; let row = [], f = '', q = false; t = t.replace(/^\uFEFF/, '');
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  // ===== XLSX END =====

  // ---- UPLOAD: 1) cloud storage  2) Excel (same columns as the old CSV)  3) JSON backup - both saved on this device ----
  const XW = CH.map((k) => ({token: 20, chassis: 14, institution: 36, permittedBy: 18, error: 46, ref: 18, requestTitle: 30, requesterEmail: 30, shop: 18, wallet: 24, requesterName: 24}[k] || 16));
  const xrow = (i) => CH.map((k) => { const v = cval(i, k); return v == null ? '' : (k === 'token' || k === 'chassis') ? String(v) : (typeof v === 'boolean' ? String(v) : v); });
  function xlsxBlob(list) {
    const srt = (l) => l.slice().sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)).map(xrow);
    return buildXlsx([
      {name: 'All tokens', head: CH, rows: srt(list), widths: XW, reasonCol: 7},
      {name: 'Not issued', head: CH, rows: srt(list.filter((i) => i.status === 'pending' && !resText(i))), widths: XW, reasonCol: 7},
      {name: 'Failed', head: CH, rows: srt(list.filter((i) => i.status === 'failed' || (i.status === 'pending' && resText(i)))), widths: XW, reasonCol: 7},
      {name: 'Issued', head: CH, rows: srt(list.filter((i) => i.status === 'issued')), widths: XW, reasonCol: 7}
    ]);
  }
  const saveFile = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000); };
  let uploading = false;
  $('up').onclick = async () => {
    if (uploading) return; uploading = true; $('up').disabled = true;
    try {
      logNew('');
      const q = await load();
      if (!q.length) { log('There are no tokens to upload.', 'warn'); return; }
      let cloudOk = false;
      const st = await cloudMsg({ op: 'cloudStatus' });
      if (st.ok && st.connected) {
        while (syncing) await wait(300);
        cloudOk = await syncCloud(true) === true;
        log(cloudOk ? '✓ Saved to the cloud.' : '✗ Could not save to the cloud. The files are still being saved on this computer.', cloudOk ? 'ok' : 'bad');
      } else log('⚠ Cloud is not connected, so nothing was sent to the cloud. Files are saved on this computer.', 'warn');
      const day = new Date(), p = (n) => String(n).padStart(2, '0'), stamp = `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}_${p(day.getHours())}${p(day.getMinutes())}`;
      const fresh2 = await load();
      saveFile(xlsxBlob(fresh2), 'gpsa-tokens-' + stamp + '.xlsx');
      await wait(700);
      saveFile(new Blob([JSON.stringify({app: 'gpsa-token-helper', queue: fresh2}, null, 1)], {type: 'application/json'}), 'gpsa-backup-' + stamp + '.json');
      log(`✓ Excel and backup files downloaded (${fresh2.length} tokens).`, 'ok');
    } catch (err) { log('✗ Upload did not finish. Please try again.', 'bad'); }
    finally { uploading = false; $('up').disabled = false; }
  };

  // ---- Excel restore: reads the file made by "Export Excel" (also CSV, also a file re-saved by Excel) ----
  const hk = (h) => String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, '');
  const HM = {token: ['token'], chassis: ['chassis', 'vehicle'], institution: ['institution'], status: ['status'], reason: ['reasonrecordedbygimis', 'reason', 'error'], code: ['gimiscode', 'code'], who: ['permittedby'], phone: ['permitterphone', 'permittedbyphone'], attempts: ['attempts'], fuel: ['fuel', 'fueltype'], litres: ['litres'], price: ['unitprice'], ref: ['gin', 'ref'], created: ['tokencreated', 'tokencreatedat'], issued: ['issuedingimis', 'gimisissuedat'], expires: ['expires', 'expireon'], saved: ['savedhere', 'addedat'], by: ['issuedby'], shop: ['shop'], wallet: ['wallet'], rtitle: ['requesttitle'], track: ['trackingnumber'], rtype: ['requisitiontype'], rname: ['requestername'], remail: ['requesteremail']};
  const pd = (v) => { v = String(v == null ? '' : v).trim(); if (!v) return null; if (/^\d+(\.\d+)?$/.test(v)) return Math.round((+v - 25569) * 864e5) + new Date().getTimezoneOffset() * 6e4; const t = Date.parse(v.replace(' ', 'T')); return isNaN(t) ? null : t; };
  function recordsFromRows(rows) {
    const hi = rows.findIndex((r) => r && r.some((c) => hk(c) === 'token')); if (hi < 0) return [];
    const idx = {}; rows[hi].forEach((h, c) => { const k = hk(h); for (const f in HM) if (HM[f].includes(k) && idx[f] == null) idx[f] = c; });
    if (idx.token == null || idx.chassis == null) return [];
    const g = (r, f) => idx[f] == null ? '' : String(r[idx[f]] == null ? '' : r[idx[f]]).trim();
    const out = [], dflt = $('who').value.trim() || 'Restored from Excel';
    rows.slice(hi + 1).forEach((r) => {
      const token = g(r, 'token'), chassis = g(r, 'chassis').toUpperCase(); if (!token || !chassis) return;
      const st = g(r, 'status').toLowerCase(), status = ['pending', 'issued', 'failed'].includes(st) ? st : 'pending';
      const text = g(r, 'reason'), cn = g(r, 'code') === '' || isNaN(+g(r, 'code')) ? null : +g(r, 'code');
      const known = cn != null && codes[cn] && text.toLowerCase().startsWith(String(codes[cn]).toLowerCase());
      const gc = pd(g(r, 'created')), gi = pd(g(r, 'issued')), inst = g(r, 'institution'), lit = +g(r, 'litres') || 0, pr = +g(r, 'price') || 0, fuel = g(r, 'fuel');
      const it = {token, chassis, institution: inst, permittedBy: g(r, 'who') || dflt, permittedByPhone: g(r, 'phone'), addedAt: pd(g(r, 'saved')) || Date.now(),
        status, attempts: +g(r, 'attempts') || 0, error: status === 'issued' ? '' : text, code: status === 'issued' ? null : cn, reason: status !== 'issued' && known ? (cn === 9002 ? 'token_unknown' : 'gimis_code') : '',
        issuedAt: status === 'issued' ? (gi || Date.now()) : null};
      if (g(r, 'ref')) it.ref = g(r, 'ref'); if (g(r, 'by')) it.issuedBy = g(r, 'by');
      if (gc) it.tokenCreatedAt = gc; if (gi) it.gimisIssuedAt = gi; const ex = pd(g(r, 'expires')); if (ex) it.expireOn = ex;
      if (status === 'issued') it.verified = false;   // "Check issued" will confirm it with GIMIS
      if (inst || fuel || lit || pr || g(r, 'shop') || g(r, 'track')) it.detail = {institution: inst, ref: g(r, 'ref'), shop: g(r, 'shop'), wallet: g(r, 'wallet'), requestTitle: g(r, 'rtitle'), trackingNumber: g(r, 'track'), requisitionType: g(r, 'rtype'), requesterName: g(r, 'rname'), requesterEmail: g(r, 'remail'), items: fuel || lit || pr ? [{name: fuel, litres: lit, unitPrice: pr}] : []};
      out.push(it);
    });
    return out;
  }
  // ---- Load ANY Excel/CSV: find every token + chassis number in it and put them in the two boxes (then the user presses Save) ----
  // A file made by Upload (it has Token + Chassis + Status columns) is still restored in full, as before.
  const cleanTok = (v) => { const d = String(v == null ? '' : v).replace(/[\s\-]/g, ''); return /^\d{12,20}$/.test(d) ? d : ''; };
  const cleanCh = (v) => { const c = String(v == null ? '' : v).replace(/[\s\-]/g, '').toUpperCase(); return /^[A-Z0-9]{5,14}$/.test(c) && /[A-Z]/.test(c) && /\d/.test(c) ? c : ''; };
  function pairsFromRows(rows) {
    // 1) a header row that names a token column and a vehicle/chassis column
    const hi = rows.findIndex((r) => r && r.some((c) => /token/.test(hk(c))) && r.some((c) => /chassis|vehicle|plate|regno|registration|motor|car|gari|namba/.test(hk(c))));
    const out = [];
    if (hi >= 0) {
      const tc = rows[hi].findIndex((c) => /token/.test(hk(c))), cc = rows[hi].findIndex((c) => /chassis|vehicle|plate|regno|registration|motor|car|gari|namba/.test(hk(c)));
      rows.slice(hi + 1).forEach((r) => { if (!r) return; const t = cleanTok(r[tc]), c = String(r[cc] == null ? '' : r[cc]).replace(/\s+/g, '').toUpperCase(); if (t && c) out.push({token: t, chassis: c}); else if (t) out.push({token: t, chassis: ''}); });
      if (out.length) return out;
    }
    // 2) no usable header: look at every cell, row by row (token = 12-20 digits, chassis = letters + digits such as STN4712)
    rows.forEach((r) => {
      if (!r) return; let t = '', c = '';
      r.forEach((cell) => { if (!t) t = cleanTok(cell); if (!c) c = cleanCh(cell); });
      if (t) out.push({token: t, chassis: c});
    });
    return out;
  }
  $('impx').onclick = () => $('impxf').click();
  $('impxf').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      if (/\.json$/i.test(f.name)) {
        const j = JSON.parse(await f.text()), inc0 = Array.isArray(j) ? j : j.queue;
        if (!Array.isArray(inc0)) throw new Error('the file is not a valid backup');
        await restoreRecords(inc0); return;
      }
      if (/\.xls$/i.test(f.name)) { logNew(''); log('✗ Old .xls files cannot be read. Open it in Excel, choose Save As → Excel Workbook (.xlsx), then try again.', 'bad'); return; }
      const sheets = /\.csv$/i.test(f.name) ? [parseCsv(await f.text())] : (await readXlsx(await f.arrayBuffer())).map((s) => s.rows);
      // file made by Upload -> full restore
      const full = sheets.some((rows) => { const h = rows.find((r) => r && r.some((c) => hk(c) === 'token')); return h && h.some((c) => hk(c) === 'status') && h.some((c) => /^(attempts|savedhere|addedat|issuedby)$/.test(hk(c))); });
      if (full) {
        const seen = new Set(), inc = [];
        sheets.forEach((rows) => recordsFromRows(rows).forEach((x) => { if (!seen.has(x.token)) { seen.add(x.token); inc.push(x); } }));
        if (inc.length) { await restoreRecords(inc); return; }
      }
      // any other file -> only tokens + chassis numbers, into the boxes
      const seen = new Set(), got = []; let noCh = 0;
      sheets.forEach((rows) => pairsFromRows(rows).forEach((x) => { if (!seen.has(x.token)) { seen.add(x.token); got.push(x); if (!x.chassis) noCh++; } }));
      logNew('');
      if (!got.length) { log('✗ No token numbers found in this file.', 'bad'); return; }
      if (noCh) {
        const ok = got.filter((x) => x.chassis);
        log(`⚠ ${noCh} token(s) have no chassis number in the file, so they were left out. Loaded: ${ok.length}.`, 'warn');
        got.splice(0, got.length, ...ok);
        if (!got.length) return;
      }
      const add = (id, arr) => { const el = $(id), old = lines(el.value); el.value = old.concat(arr).join('\n'); el.dispatchEvent(new Event('input', {bubbles: true})); };
      add('tk', got.map((x) => x.token)); add('ch', got.map((x) => x.chassis));
      counts();
      log(`✓ ${got.length} token(s) and chassis number(s) loaded from the file. Enter the name of the person who permitted, then press Save.`, 'ok');
    } catch (err) { logNew(''); log('✗ Could not read this file. Use an Excel (.xlsx), CSV or JSON file.', 'bad'); }
  };

  const waiters = {}; let seq = 0, running = false, timer = null;
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.src !== 'gpsa-page') return;
    if (d.evt === 'gimis') { onGimisCall(d); return; }
    const w = waiters[d.id]; if (w) { delete waiters[d.id]; w(d); }
  });
  const page = (msg) => new Promise(async (res) => {
    // v2.20.0: nothing is sent to GIMIS unless the owner's access check (access.js) allows this computer
    const AC = window.__gpsaAccess;
    if (AC) { await AC.ready; if (AC.locked) return res({ok: false, error: 'Access is not allowed: ' + (AC.reason || 'locked')}); }
    const id = ++seq; waiters[id] = res;
    window.postMessage(Object.assign({}, msg, {src: 'gpsa-ext', id}), '*');
    setTimeout(() => { if (waiters[id]) { delete waiters[id]; res({ok: false, error: 'No response from GIMIS'}); } }, 60000);
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- Check issued: soma GIMIS kuona kama token imeshaissue ----
  // Inarudisha: issued (imewekwa issued sasa) | verified (ilikuwa issued, imethibitishwa) | reverted | unverified | notissued | notfound | error
  async function applyCheck(token, chassis, r, revert) {
    const q = await load(), it = q.find((i) => i.token === token && i.chassis === chassis);
    if (!it) return null;
    if (!r.ok) return 'error';
    if (r.expireOn) it.expireOn = Date.parse(r.expireOn) || it.expireOn;
    if (r.tokenCreatedAt) it.tokenCreatedAt = Date.parse(r.tokenCreatedAt) || it.tokenCreatedAt;
    if (r.noteCreatedAt) it.noteCreatedAt = Date.parse(r.noteCreatedAt) || it.noteCreatedAt;
    if (r.metaTried) it.metaAt = Date.now();
    if (r.detail) { const nd = Object.assign({}, it.detail || {}, r.detail); if (!(r.detail.items && r.detail.items.length) && it.detail && it.detail.items) nd.items = it.detail.items; it.detail = nd; }
    if (r.detail || r.metaTried) it.detAt = Date.now();
    if (r.institution && !it.institution) it.institution = r.institution;
    if (r.detail && r.detail.institution && !it.institution) it.institution = r.detail.institution;
    let s;
    if (r.state === 'issued') {
      s = it.status === 'issued' ? 'verified' : 'issued';
      if (it.status !== 'issued') { it.status = 'issued'; it.issuedAt = (r.issuedAt && Date.parse(r.issuedAt)) || Date.now(); }
      it.verified = true; it.verifiedAt = Date.now(); it.error = ''; it.reason = ''; it.code = null;
      if (r.issuedAt) it.gimisIssuedAt = Date.parse(r.issuedAt) || it.gimisIssuedAt;
      if (r.ref) it.ref = r.ref; if (r.issuedBy) it.issuedBy = r.issuedBy;
    } else if (it.status === 'issued') {            // sisi tuliweka issued, GIMIS haikubali
      if (revert) { it.status = 'pending'; it.verified = false; it.attempts = 0; it.error = 'GIMIS did not show this token as issued - set back to pending'; s = 'reverted'; }
      else { it.verified = false; s = 'unverified'; }
    } else if (r.state === 'notissued') {
      s = 'notissued';
    } else { it.reason = r.reason || ''; if (r.code != null) it.code = r.code; it.error = failText(r) || 'No Record Found'; if (r.gimisVehicle) it.gimisVehicle = r.gimisVehicle; s = 'notfound'; }
    await save(q); return s;
  }

  // ---- Short, plain messages for the activity log (no codes, no technical words) ----
  const SESSION_MSG = 'GIMIS login has expired. Log in to GIMIS again, refresh the page (F5), then try again.';
  const NOT_READY = 'GIMIS is not ready. Open "Get Issue Note Token" in GIMIS, press Request once, then try again.';
  const BUSY_MSG = 'Please wait - another task is still running.';
  const plainWhy = (x) => {
    x = x || {};
    if (x.reason === 'chassis_mismatch') return x.gimisVehicle ? 'wrong chassis number - this token belongs to ' + x.gimisVehicle : 'wrong chassis number for this token';
    if (x.reason === 'token_unknown') return 'not found in GIMIS (wrong token number, or it has expired)';
    if (x.reason === 'token_used') return 'already used in GIMIS';
    if (x.reason === 'token_partial') return 'only partly issued in GIMIS';
    if (x.reason === 'expired') return 'token has expired';
    if (x.reason === 'save_failed') return 'GIMIS did not finish issuing it - try again';
    if (/No response/i.test(String(x.error || ''))) return 'GIMIS did not respond - try again';
    return 'GIMIS refused it';
  };
  const isSessionErr = (r) => !r.ok && (r.error === 'NO_TOKEN' || /^BAD_SESSION/.test(r.error));

  async function checkPass(keys, opt) {
    opt = opt || {};
    const c = {iss: 0, ver: 0, pend: 0, nf: 0, err: 0, rev: 0, unv: 0, stop: false};
    const have = {}; (await load()).forEach((i) => { have[kOf(i)] = i; });
    for (const k of keys) {
      const [token, chassis] = k.split('|');
      const r = await page({op: 'check', token, chassis, meta: !!opt.meta || !(have[k] && have[k].detAt)});
      if (isSessionErr(r)) { log(SESSION_MSG, 'warn'); c.stop = true; break; }
      const s = await applyCheck(token, chassis, r, !!opt.revert);
      if (opt.focus && r.ok) cur = k;   // show this token's GIN details immediately
      if (s === 'issued') { c.iss++; log('✓ ' + token + ' is already issued', 'ok'); }
      else if (s === 'verified') c.ver++;
      else if (s === 'reverted') { c.rev++; log('⚠ ' + token + ': GIMIS does not show it as issued - moved back to pending', 'warn'); }
      else if (s === 'unverified') c.unv++;
      else if (s === 'notissued') c.pend++;
      else if (s === 'notfound') { c.nf++; if (!opt.quiet) log('✗ ' + token + ': ' + plainWhy(r), 'bad'); }
      else if (s === 'error') c.err++;
      render(); await wait(500);
    }
    return c;
  }

  // Bila uchaguzi: pending + failed + issued ambazo hazijathibitishwa. Ukichagua: zilizochaguliwa tu (issued isiyothibitika inarudi pending).
  async function checkAll(quiet, only) {
    if (running) { if (!quiet) log(BUSY_MSG, 'warn'); return; }
    running = true;
    try {
      if (!quiet) logNew('', !!only);
      const st = await page({op: 'status'});
      if (!st.valid) { if (!quiet) log(NOT_READY, 'warn'); return; }
      const q = await load(), byUser = !quiet && !only && sel.size > 0;
      const keys = q.filter((i) => only ? only.includes(kOf(i)) : byUser ? sel.has(kOf(i)) : (i.status !== 'issued' || i.verified !== true || !i.detAt)).sort((a, b) => a.addedAt - b.addedAt).map(kOf);
      if (!keys.length) { if (!quiet) log('No tokens to check.'); return; }
      const c = await checkPass(keys, {quiet, revert: byUser, meta: !!only, focus: !quiet && keys.length === 1});
      if (!c.stop && (!quiet || c.iss || c.rev)) {
        const parts = [[c.iss + c.ver, 'issued'], [c.pend, 'not issued yet'], [c.nf, 'not found in GIMIS'], [c.rev, 'moved back to pending'], [c.unv + c.err, 'could not be confirmed']].filter((x) => x[0]).map((x) => x[0] + ' ' + x[1]);
        log('Check finished: ' + (parts.join(', ') || 'nothing to report') + '.', 'info');
      }
    } finally { running = false; render(); }
  }

  const PERMANENT = ['chassis_mismatch', 'expired', 'token_partial'];   // retrying these can never succeed
  async function run(auto) {
    if (running) { if (!auto) log(BUSY_MSG, 'warn'); return; }
    running = true;
    try {
      // ISSUE SELECTED: only the ticked tokens are issued (tick the top box to issue everything shown)
      const chosen = (await load()).filter((i) => sel.has(kOf(i))), todo = chosen.filter((i) => i.status !== 'issued');
      if (!todo.length) { if (!auto) logNew(chosen.length ? 'The selected tokens are already issued.' : 'Tick the tokens you want to issue first (tick the top box to select all).'); return; }
      if (!auto) logNew('');
      const st = await page({op: 'status'});
      if (!st.valid) { log(NOT_READY, 'warn'); return; }
      { const q = await load(); q.forEach((i) => { if (sel.has(kOf(i)) && i.status === 'failed') { i.status = 'pending'; i.attempts = 0; i.error = ''; i.reason = ''; i.code = null; } }); await save(q); }   // a failed token you tick again is tried again
      const pend = (await load()).filter((i) => sel.has(kOf(i)) && i.status === 'pending').sort((a, b) => a.addedAt - b.addedAt).map(kOf);
      let ok = 0, bad = 0;
      const pre = await checkPass(pend, {quiet: true});   // skip the ones already issued in GIMIS
      if (pre.stop) return;
      const ids = (await load()).filter((i) => i.status === 'pending' && pend.includes(kOf(i))).sort((a, b) => a.addedAt - b.addedAt).map(kOf);
      if (!ids.length) return;
      for (const id of ids) {
        const [token, chassis] = id.split('|');
        const r = await page({op: 'issue', token, chassis});
        const q = await load(), it = q.find((i) => i.token === token && i.chassis === chassis); // read again: never lose changes
        if (!it) continue;
        if (r.ok) { it.status = 'issued'; it.issuedAt = Date.now(); it.error = ''; it.reason = ''; it.code = null; if (r.institution) it.institution = r.institution; if (r.detail) it.detail = r.detail; ok++;
          log(r.alreadyIssued ? '✓ ' + token + ' was already issued' : '✓ ' + token + ' issued', 'ok'); await save(q);
          await applyCheck(token, chassis, await page({op: 'check', token, chassis, meta: true}), false);   // confirm in GIMIS + get dates
          sel.delete(id); cur = id; }
        else {
          if (isSessionErr(r)) { log(SESSION_MSG, 'warn'); break; }
          it.attempts = (it.attempts || 0) + 1; it.error = failText(r); it.reason = r.reason || ''; if (r.code != null) it.code = r.code; if (r.gimisVehicle) it.gimisVehicle = r.gimisVehicle;
          if (PERMANENT.includes(r.reason) || it.attempts >= (r.reason === 'token_unknown' ? 3 : 5)) it.status = 'failed';
          bad++; log('✗ ' + token + ': ' + plainWhy(r), 'bad'); await save(q);
        }
        render(); await wait(800);
      }
      if (ok || bad) log('Done: ' + ok + ' issued' + (bad ? ', ' + bad + ' failed' : '') + '.', 'info');
    } finally { running = false; render(); }
  }
  $('run').onclick = () => run(false);
  $('auto').checked = localStorage.getItem('gpsaAuto') === '1';
  const setAuto = () => { localStorage.setItem('gpsaAuto', $('auto').checked ? '1' : '0'); clearInterval(timer); if ($('auto').checked) timer = setInterval(() => run(true), 5 * 60 * 1000); };
  $('auto').onchange = setAuto; setAuto();
  let ctimer = null;
  $('chk').onclick = () => checkAll(false);
  $('achk').checked = localStorage.getItem('gpsaAutoChk') === '1';
  const setAutoChk = () => { localStorage.setItem('gpsaAutoChk', $('achk').checked ? '1' : '0'); clearInterval(ctimer); if ($('achk').checked) ctimer = setInterval(() => checkAll(true), 10 * 60 * 1000); };
  $('achk').onchange = () => { setAutoChk(); if ($('achk').checked) checkAll(true); }; setAutoChk();
  if ($('achk').checked) setTimeout(() => checkAll(true), 15000);
  // ---- EXPIRY TRACKER: reads the REAL expiry date of every token that is NOT issued yet, straight from GIMIS (never guessed) ----
  // Sources: getIssueNoteToken (token + chassis) and, when that has nothing, GIMIS "my tokens" list (myIssueNoteTokens). Only the expiry date is updated.
  async function trackExpiry(quiet, only) {
    if (running) { if (!quiet) log(BUSY_MSG, 'warn'); return; }
    running = true;
    try {
      if (!quiet) logNew('');
      const hopeless = (i) => i.status === 'failed' && (i.reason === 'token_unknown' || PERMANENT.includes(i.reason));
      const keys = (await load()).filter((i) => i.status !== 'issued' && !hopeless(i) && (!only || only.includes(kOf(i)))).sort((a, b) => (a.expireOn || 9e15) - (b.expireOn || 9e15)).map(kOf);
      if (!keys.length) { if (!quiet) log('No unissued tokens to check.', 'info'); return; }
      const st = await page({op: 'status'});
      if (!st.valid) { if (!quiet) log(NOT_READY, 'warn'); return; }
      const ml = await page({op: 'expiryList'}), mine = {}; if (ml.ok) (ml.list || []).forEach((t) => { mine[t.token] = t; });
      let got = 0, nowIssued = 0, noDate = 0, stopped = false;
      for (const k of keys) {
        const [token, chassis] = k.split('|');
        const r = await page({op: 'check', token, chassis, meta: true});
        if (!r.ok) { if (isSessionErr(r)) { log(SESSION_MSG, 'warn'); stopped = true; break; } continue; }
        if (r.state === 'issued') { await applyCheck(token, chassis, r, false); nowIssued++; log('✓ ' + token + ' is already issued', 'ok'); }
        else {
          let ex = r.expireOn && Date.parse(r.expireOn); const m = mine[token];
          if (!ex && m && m.expireOn && !m.used) ex = Date.parse(m.expireOn);
          if (ex) { got++; const q = await load(), it = q.find((i) => kOf(i) === k); if (it && it.expireOn !== ex) { it.expireOn = ex; if (r.tokenCreatedAt) it.tokenCreatedAt = Date.parse(r.tokenCreatedAt) || it.tokenCreatedAt; await save(q); } }
          else noDate++;
        }
        render(); await wait(400);
      }
      if (!stopped) { expRunAt = Date.now(); store.set('gpsaExpRun', expRunAt); }
      if (!quiet) {
        log(`Expiry check finished: ${got} date(s) found` + (noDate ? `, ${noDate} not available in GIMIS` : '') + (nowIssued ? `, ${nowIssued} already issued` : '') + '.', 'info');
      }
    } finally { running = false; render(); }
  }

  // ---- REGENERATE: ask GIMIS to renew tokens that expired before they were issued ----
  async function regen(keysIn) {
    if (running) { log(BUSY_MSG, 'warn'); return; }
    const q0 = await load(), keys = keysIn.filter((k) => { const it = q0.find((i) => kOf(i) === k); return it && it.status !== 'issued'; });
    if (!keys.length) { logNew('Tick the expired tokens you want to renew first.'); return; }
    if (!confirm(`Ask GIMIS to renew ${keys.length} selected token(s)?\n\nOnly tokens that have already expired are renewed. Valid or used tokens are left alone.`)) return;
    running = true;
    try {
      logNew('');
      const st = await page({op: 'status'});
      if (!st.valid) { log(NOT_READY, 'warn'); return; }
      let ok = 0, no = 0;
      for (const k of keys) {
        const [token, chassis] = k.split('|');
        const r = await page({op: 'regenerate', token, chassis});
        if (!r.ok) {
          if (isSessionErr(r)) { log(SESSION_MSG, 'warn'); break; }
          no++; log('✗ ' + token + ': GIMIS did not respond - try again', 'bad');
        } else if (r.done) {
          ok++;
          const q = await load(), it = q.find((i) => kOf(i) === k);
          if (it) {
            if (r.expireOn) it.expireOn = Date.parse(r.expireOn) || it.expireOn;
            if (r.tokenCreatedAt) it.tokenCreatedAt = Date.parse(r.tokenCreatedAt) || it.tokenCreatedAt;
            it.status = 'pending'; it.attempts = 0; it.reason = ''; it.code = null; it.error = r.newToken ? 'Renewed by GIMIS with a NEW token number: ' + r.newToken : '';
            await save(q);
          }
          if (r.newToken) log(`✓ ${token} renewed, but GIMIS gave it a NEW number: ${r.newToken}. Save the new number as a token.`, 'warn');
          else if (r.unconfirmed) log(`⚠ ${token}: renewal accepted - press "Check issued" to confirm.`, 'warn');
          else log(`✓ ${token} renewed - valid until ${fmt(Date.parse(r.expireOn))}`, 'ok');
        } else {
          no++;
          const why = r.why === 'valid' ? `still valid until ${fmt(Date.parse(r.expireOn))} - no need to renew` : r.why === 'used' ? 'already used' : r.why === 'not_found' ? 'GIMIS does not know this token, so it cannot be renewed' : r.why === 'unknown' ? 'GIMIS gave no expiry date, so it was not renewed' : 'GIMIS refused to renew it' + (r.message ? ': ' + r.message : '');
          log((r.why === 'valid' || r.why === 'used' ? '⚠ ' : '✗ ') + token + ': ' + why, r.why === 'valid' || r.why === 'used' ? 'warn' : 'bad');
        }
        render(); await wait(600);
      }
      log('Done: ' + ok + ' renewed' + (no ? ', ' + no + ' not renewed' : '') + '.', 'info');
    } finally { running = false; render(); }
  }
  $('regen').onclick = () => regen([...sel]);
  $('xrun').onclick = () => trackExpiry(false);
  // Automatic expiry reading (20 s after opening, every 30 min, after Save) is switched off: the dates are not displayed any more.

  // ---------------------------------------------------------------------
  // CLOUD STORAGE (Supabase) — hifadhi ya pili, tofauti na "Backup (JSON)".
  // Token zote (na maelezo yake) zinahifadhiwa Supabase (akaunti moja ya
  // ofisi), hivyo kompyuta nyingine yoyote iliyounganishwa inaweza kuzipata
  // papo hapo. Hii HAIONDOI chrome.storage.local wala Backup/Restore JSON
  // iliyokuwepo - zote mbili zinaendelea kufanya kazi sambamba.
  // ---------------------------------------------------------------------
  const cloudMsg = (m) => new Promise((res) => {
    try { chrome.runtime.sendMessage(m, (r) => res(r || { ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message })); }
    catch (e) { res({ ok: false, error: String(e) }); }
  });

  // v2.22.0: deleting data is for the owner of the system only. The delete buttons stay hidden until the owner
  // has signed in (Control > Owner console on this computer; the sign-in is checked against the Supabase owner account).
  const isOwnerNow = async () => { const r = await cloudMsg({ op: 'ownerStatus' }); return !!(r && r.ok && r.signedIn); };
  async function applyOwnerUi() {
    const on = await isOwnerNow();
    ['clr', 'del', 'clrAll'].forEach((id) => { const b = $(id); if (b) { b.hidden = !on; b.style.display = on ? '' : 'none'; } });
  }
  applyOwnerUi(); setInterval(applyOwnerUi, 15000);
  try { window.addEventListener('focus', applyOwnerUi); } catch (e) {}

  const TOMB = 'gpsaDeleted';   // {token: deletedAt}
  const WIPE_SEEN = 'gpsaWipeSeen';   // time of the last admin "delete ALL tokens" this computer has applied
  let pushTimer = null, syncing = false, syncAgain = false;
  function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(() => syncCloud(true), 4000); }
  function setCloudNote(s) { const el = $('cloudStat'); if (el) el.textContent = s; }

  // ONE sync routine, used by every button and by automatic sync:
  //  1) read the cloud  2) newest updatedAt wins per token  3) upload only what is newer here  4) finish pending deletes
  async function syncCloud(silent) {
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    try {
      const st = await cloudMsg({ op: 'cloudStatus' });
      if (!st.ok || !st.connected) { if (!silent) setCloudNote('Not connected to cloud.'); return; }
      const r = await cloudMsg({ op: 'cloudPull' });
      if (!r.ok) { setCloudNote('Cloud sync failed: ' + r.error); if (!silent) log('✗ Cloud sync failed: ' + r.error, 'bad'); return; }
      const cloud = {}; (r.items || []).forEach((ci) => { if (ci && ci.token) cloud[ci.token] = ci; });
      let q = await load();
      // v2.25.0: the admin deleted ALL tokens at wipeAt: drop what this computer still holds from before that moment (records saved after it are kept)
      const wipeAt = Number(r.wipeAt) || 0;
      if (wipeAt > (Number(await store.get(WIPE_SEEN)) || 0)) {
        const before = q.length; q = q.filter((i) => (i.updatedAt || 0) > wipeAt);
        await store.set(KEY, q); await store.set(TOMB, {}); await store.set(WIPE_SEEN, wipeAt);
        if (before !== q.length) { log(`The admin deleted all tokens: ${before - q.length} removed from this computer.`, 'warn'); render(); }
      }
      const by = {}; q.forEach((i) => { by[i.token] = i; });
      const tomb = (await store.get(TOMB)) || {}, keep = {}, toDelete = [];
      Object.keys(tomb).forEach((t) => {
        const li = by[t], ci = cloud[t];
        if (li && (li.updatedAt || 0) > tomb[t]) return;           // saved again after it was deleted: not deleted any more
        if (ci && (ci.updatedAt || 0) > tomb[t]) return;           // edited elsewhere after the delete: keep it
        keep[t] = tomb[t]; if (ci) toDelete.push(t);
      });
      let down = 0, up = [];
      Object.keys(cloud).forEach((t) => {
        if (keep[t]) return;
        const ci = cloud[t], li = by[t];
        if (!li) { q.push(ci); by[t] = ci; down++; }
        else if ((ci.updatedAt || 0) > (li.updatedAt || 0)) { replaceItem(li, ci); down++; }
      });
      q.forEach((i) => { const c = cloud[i.token]; if (!c || (i.updatedAt || 0) > (c.updatedAt || 0)) up.push(i); });
      if (down) await store.set(KEY, q);
      if (up.length) { const p = await cloudMsg({ op: 'cloudPush', items: up }); if (!p.ok) { setCloudNote('Cloud sync failed: ' + p.error); if (!silent) log('✗ Could not send to the cloud: ' + p.error, 'bad'); return false; } }
      if (toDelete.length) { const d = await cloudMsg({ op: 'cloudDelete', tokens: toDelete }); if (d.ok) toDelete.forEach((t) => { delete keep[t]; }); }
      await store.set(TOMB, keep);
      setCloudNote('Synced to cloud: ' + fmt(Date.now()) + ' (' + Object.keys(cloud).length + ' in cloud)');
      if (!silent) log(down || up.length || toDelete.length ? '✓ Cloud updated.' : '✓ Cloud is already up to date.', 'ok');
      if (down) render();
      return true;
    } finally { syncing = false; if (syncAgain) { syncAgain = false; schedulePush(); } }
  }
  async function cloudDeleteTokens(tokens) {
    if (!tokens || !tokens.length) return;
    const tomb = (await store.get(TOMB)) || {}, now = Date.now(); tokens.forEach((t) => { tomb[t] = now; });
    await store.set(TOMB, tomb); syncCloud(true);
  }

  // ---------- Cloud storage records (dashboard tab) ----------
  let cloudItems = [], cview = false, cvShown = [];
  const csel = new Set();
  function setView(on) {
    cview = !!on; aview = false;
    $('tw').hidden = cview; $('dt').hidden = cview; $('sb').hidden = cview; $('cv').hidden = !cview;
    paintTabs(); $('nb').hidden = cview || !fresh.size; if (cview) $('xb').hidden = true;
    if (cview) loadCloudView();
  }
  async function loadCloudView() {
    $('cvn').textContent = 'Loading from cloud...';
    const st = await cloudMsg({ op: 'cloudStatus' });
    if (!st.ok || !st.connected) {
      cloudItems = []; await renderCloudView();
      $('cvn').textContent = 'Not signed in. Sign in with your email and password.';
      return;
    }
    const r = await cloudMsg({ op: 'cloudPull' });
    if (!r.ok) { $('cvn').textContent = 'Could not load cloud records: ' + r.error; return; }
    cloudItems = (r.items || []).filter((i) => i && i.token);
    const have = new Set(cloudItems.map((i) => i.token)); [...csel].forEach((t) => { if (!have.has(t)) csel.delete(t); });
    await renderCloudView();
  }
  async function renderCloudView() {
    const q = await load(), loc = {}; q.forEach((i) => { loc[i.token] = i; });
    const term = $('cvq').value.trim().toLowerCase(), stt = $('cvs').value;
    const inst = (i) => (i.detail && i.detail.institution) || i.institution || '';
    const stateOf = (i) => { const l = loc[i.token]; if (!l) return ['Not on this computer', 'st-new']; const a = i.updatedAt || 0, b = l.updatedAt || 0; return a > b ? ['Newer in cloud', 'st-cloud'] : a < b ? ['Newer on this computer', 'st-here'] : ['Up to date', 'st-ok']; };
    cvShown = cloudItems.filter((i) => (!stt || i.status === stt) && (!term || [i.token, i.chassis, inst(i), i.permittedBy, i.ref].join(' ').toLowerCase().includes(term)))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    $('ct').innerHTML = `<tr><th><input type="checkbox" id="call" ${cvShown.length && cvShown.every((i) => csel.has(i.token)) ? 'checked' : ''}></th><th>Token</th><th>Chassis</th><th>Institution</th><th>Status</th><th>Reason</th><th>Permitted by</th><th>Last updated</th><th>On this computer</th></tr>` +
      (cvShown.length ? cvShown.map((i) => { const s = stateOf(i); return `<tr><td><input type="checkbox" class="cck" data-t="${esc(i.token)}" ${csel.has(i.token) ? 'checked' : ''}></td><td>${esc(i.token)}</td><td>${esc(i.chassis)}</td><td>${esc(inst(i))}</td><td class="${esc(i.status)}">${esc(i.status)}</td><td>${esc(resText(i))}</td><td>${esc(i.permittedBy)}</td><td>${esc(fmt(i.updatedAt))}</td><td class="${s[1]}">${s[0]}</td></tr>`; }).join('') : '<tr><td colspan="9" class="empty">No records in cloud storage' + (term || stt ? ' match this search' : ' yet') + '.</td></tr>');
    const missing = cloudItems.filter((i) => stateOf(i)[1] === 'st-new').length, newer = cloudItems.filter((i) => stateOf(i)[1] === 'st-cloud').length;
    $('cvn').textContent = `${cloudItems.length} in cloud · ${missing} not on this computer · ${newer} newer in cloud · showing ${cvShown.length}`;
    $('cvp').textContent = `Pull selected (${csel.size})`; $('cvp').disabled = !csel.size;
    $('cva').disabled = !(missing || newer);
  }
  async function pullTokens(tokens, force) {
    const q = await load(), by = {}; q.forEach((i) => { by[i.token] = i; }); let added = 0, updated = 0;
    const keys = [];
    cloudItems.filter((ci) => tokens.has(ci.token)).forEach((ci) => {
      const li = by[ci.token];
      if (!li) { const n = Object.assign({}, ci); q.push(n); by[ci.token] = n; added++; keys.push(kOf(n)); }
      else if (force || (ci.updatedAt || 0) > (li.updatedAt || 0)) { replaceItem(li, ci); updated++; keys.push(kOf(li)); }
    });
    await store.set(KEY, q);
    logNew(added || updated ? `Pulled from cloud: ${added} new, ${updated} updated.` : 'Nothing new to pull - this computer is already up to date.');
    $('cvn').textContent = `Done: ${added} new and ${updated} updated on this computer.`;
    if (keys.length) {   // go straight to "This computer" so the pulled tokens are visible and ready to Check / Issue
      const msg = `Pulled from cloud: ${added} new, ${updated} updated.`;
      setFresh(keys, msg); $('sq').value = ''; $('sqs').value = ''; sel.clear(); cur = null; part = ''; setView(false); logNew(msg); render();
    } else { render(); setTimeout(renderCloudView, 50); }
  }
  const goPart = (p) => () => { if (!running) $('l').textContent = ''; cur = null; part = p; setView(false); render(); };
  $('tbLocal').onclick = goPart(''); $('tbNew').onclick = goPart('new'); $('tbBad').onclick = goPart('bad'); $('tbOk').onclick = goPart('ok');
  const openAI = () => { $('aiw').hidden = false; $('fab').hidden = true; if (window.__gpsaHooks && window.__gpsaHooks.aiOpen) window.__gpsaHooks.aiOpen(); };
  const closeAI = () => { $('aiw').hidden = true; $('fab').hidden = false; };
  $('fab').onclick = openAI; $('aix').onclick = closeAI;
  ['nbk', 'abk'].forEach((id) => { $(id).onclick = () => navGo(-1); }); ['nfw', 'afw'].forEach((id) => { $(id).onclick = () => navGo(1); });
  root.addEventListener('click', () => setTimeout(navMark, 0), true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setTimeout(navMark, 0); }, true);
  navMark();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('aiw').hidden) closeAI(); });
  $('tbCloud').onclick = () => { if (!running) $('l').textContent = ''; setView(true); };
  $('cvr').onclick = loadCloudView;
  $('cvq').oninput = renderCloudView; $('cvs').onchange = renderCloudView;
  $('ct').addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'call') cvShown.forEach((i) => (t.checked ? csel.add(i.token) : csel.delete(i.token)));
    else if (t.classList.contains('cck')) t.checked ? csel.add(t.dataset.t) : csel.delete(t.dataset.t);
    renderCloudView();
  });
  $('cvp').onclick = async () => {
    const chosen = cloudItems.filter((i) => csel.has(i.token)); if (!chosen.length) return;
    const q = await load(), by = {}; q.forEach((i) => { by[i.token] = i; });
    const overwrite = chosen.filter((i) => by[i.token] && (by[i.token].updatedAt || 0) > (i.updatedAt || 0)).length;
    if (overwrite && !confirm(`${overwrite} selected record(s) are newer on this computer than in the cloud. Replace them with the cloud copy?`)) return;
    await pullTokens(new Set(chosen.map((i) => i.token)), true); csel.clear(); renderCloudView();
  };
  $('cvpp').onclick = async () => { await pullTokens(new Set(cloudItems.filter((i) => i.status === 'pending').map((i) => i.token)), false); };
  $('cva').onclick = async () => { await pullTokens(new Set(cloudItems.map((i) => i.token)), false); };
  try { $('ver').textContent = 'v' + chrome.runtime.getManifest().version; } catch (e) {}
  $('ctlBtn').onclick = () => cloudMsg({ op: 'openPage', page: 'owner' });
  // v2.23.0: Fuel LPO / Vehicle-Token / Depot Bin Card workspaces (workspaces.js) open above this dashboard
  [['wsFuel', 'fuel'], ['wsVeh', 'vehicle'], ['wsBin', 'bin']].forEach(([id, k]) => {
    $(id).onclick = () => { const w = window.__gpsaWorkspaces; const r = w ? w.open(k) : { ok: false, reason: 'Workspaces are still loading. Try again in a few seconds.' }; if (!r.ok) { logNew(''); log('\u26A0 ' + r.reason, 'warn'); } };
  });
  cloudMsg({ op: 'cloudStatus' }).then((st) => { if (st.ok && st.connected) { setCloudNote('Checking cloud...'); syncCloud(true); } });
  window.addEventListener('gpsa-access-active', () => { cloudMsg({ op: 'cloudStatus' }).then((st) => { if (st.ok && st.connected) { setCloudNote('Checking cloud...'); syncCloud(true); if (cview) loadCloudView(); } }); });

  // Shared with ai.js (same content-script world): the AI assistant reads the data through these - it never writes tokens.
  window.__gpsaHooks = { root, $, load, store, cloudMsg, page, esc, fmt, resText, D, sumL, fuelN, codes, kOf, log, num, genAt, issAt };
  store.get(WHO).then((w) => { if (w) $('who').value = w; });
  render();
})();
