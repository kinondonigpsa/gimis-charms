// Inaendeshwa ndani ya ukurasa wa GIMIS (MAIN world): inanasa token ya session na kupiga GraphQL ya GIMIS yenyewe.
(function () {
  window.__gpsaToken = null;
  const grab = (a) => { if (a && /^Bearer /i.test(a)) window.__gpsaToken = a.replace(/^Bearer /i, ''); };
  const grabUrl = (u) => { const t = /[?&]access_token=([0-9a-f-]{36})/.exec(String(u)); if (t) window.__gpsaToken = t[1]; };
  // v2.23.0: ONE token catcher for the whole extension. The Fuel / Vehicle-Token / Bin Card workspaces get the live access_token from here
  // (each under its own message tag). Re-announced at most every 5 s, so a listener that started late still receives it.
  let wsTok = null, wsAt = 0;
  const announceUrl = (u) => {
    try {
      const t = new URL(String(u), location.origin).searchParams.get('access_token');
      if (!t || (t === wsTok && Date.now() - wsAt < 5000)) return;
      wsTok = t; wsAt = Date.now();
      ['gimis-plus', 'gimis-bin-export'].forEach((s) => window.postMessage({source: s, type: 'TOKEN', token: t}, '*'));
    } catch (e) {}
  };
  const of = window.fetch;
  window.fetch = function (input, init) {
    try {
      grabUrl(typeof input === 'string' ? input : input && input.url); announceUrl(typeof input === 'string' ? input : input && input.url);
      const h = init && init.headers;
      if (h) grab(h instanceof Headers ? h.get('authorization') : (h.authorization || h.Authorization));
    } catch (e) {}
    const pr = of.apply(this, arguments);
    try { const b = init && typeof init.body === 'string' ? init.body : null; if (b && b.indexOf('getIssueNoteToken') > -1) pr.then((r) => r.clone().text().then((t) => seen(b, t))).catch(() => {}); } catch (e) {}
    return pr;
  };
  // GIMIS' own "Get Issue Note Token" calls (done by hand): report token + answer code, so the dashboard can keep the result on that token
  function seen(body, text) {
    try {
      const q = JSON.parse(body), r = JSON.parse(text), ql = Array.isArray(q) ? q : [q], rl = Array.isArray(r) ? r : [r];
      ql.forEach((x, i) => {
        if (!x || x.operationName !== 'getIssueNoteToken') return;
        const res = rl[i] && rl[i].data && rl[i].data.getIssueNoteToken; if (!res) return;
        const v = x.variables || {};
        window.postMessage({src: 'gpsa-page', evt: 'gimis', token: v.token, chassis: v.vehicleRegNo, code: res.code}, '*');
      });
    } catch (e) {}
  }
  const xsend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    try { if (typeof body === 'string' && body.indexOf('getIssueNoteToken') > -1) this.addEventListener('load', () => { try { seen(body, this.responseText); } catch (e) {} }); } catch (e) {}
    return xsend.apply(this, arguments);
  };
  const xs = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (String(k).toLowerCase() === 'authorization') grab(v); } catch (e) {}
    return xs.apply(this, arguments);
  };
  const xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { try { grabUrl(u); announceUrl(u); } catch (e) {} return xo.apply(this, arguments); };

  // Sehemu ya issue note yenye taarifa zote za GIN (fields zote zimethibitishwa kwenye API.xlsx)
  const NOTE = `id title description createdAt issuedNoteReference issuedPersonName shippingMethod meansOfTransportId
      issueNoteItems { id quantity unitPrice issued issueDateTime item { itemName } }
      requisitionRequest { id title institutionName shopName walletName trackingNumber requisitionType }
      user { fullName email }`;
  const Q_GET = `query getIssueNoteToken($vehicleRegNo: String, $token: String) {
    getIssueNoteToken(vehicleRegNo: $vehicleRegNo, token: $token) { code data { id token used createdAt expireOn meansOfTransportId
      issueNote { ${NOTE} } } } }`;
  const M_ISSUE = `mutation issueItemsSelected($issueNoteItemDtos: [IssueNoteItemDtoInput]) {
    issueItemsSelected(issueNoteItemDtos: $issueNoteItemDtos) { id quantity issued } }`;

  // --- Check: je, token imeshakuwa issued GIMIS? (hasomi tu, haibadilishi kitu) ---
  const Q_USED = `query findUsedIssueNoteToken($token: String) {
    findUsedIssueNoteToken(token: $token) { code data { ${NOTE} } } }`;
  const Q_CHK = `query getIssueNoteToken($vehicleRegNo: String, $token: String) {
    getIssueNoteToken(vehicleRegNo: $vehicleRegNo, token: $token) { code data { id token used createdAt expireOn meansOfTransportId
      issueNote { ${NOTE} } } } }`;
  // From API.xlsx: tokens of the logged-in GIMIS user (with expireOn + used), and the renew call GIMIS' own page uses
  const Q_MY = `query myIssueNoteTokens { myIssueNoteTokens { id token used active createdAt expireOn uuid } }`;
  const Q_REGEN = `query regenerateIssueNoteToken($issueNoteId: Long) { regenerateIssueNoteToken(issueNoteId: $issueNoteId) { code data message } }`;
  const Q_NOTES = `query findIssueNotesByRequsitionId($requisitionRequestId: Long) {
    findIssueNotesByRequisitionId(requisitionRequestId: $requisitionRequestId) { ${NOTE} } }`;

  // Geuza issue note kuwa taarifa za kuonyesha (bila thamani tupu)
  const clean = (o) => { const r = {}; Object.keys(o || {}).forEach((k) => { const v = o[k]; if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) r[k] = v; }); return r; };
  function detail(n, td) {
    n = n || {}; const rr = n.requisitionRequest || {}, u = n.user || {};
    return clean({
      institution: rr.institutionName, shop: rr.shopName, wallet: rr.walletName,
      requestTitle: rr.title || n.title, trackingNumber: rr.trackingNumber, requisitionType: rr.requisitionType,
      description: n.description, vehicle: n.meansOfTransportId || (td && td.meansOfTransportId), shipping: n.shippingMethod,
      requesterName: u.fullName, requesterEmail: u.email, issuedPersonName: n.issuedPersonName, ref: n.issuedNoteReference,
      items: (n.issueNoteItems || []).map((i) => clean({name: i.item && i.item.itemName, litres: i.quantity, unitPrice: i.unitPrice, issued: !!i.issued, issuedAt: i.issueDateTime}))
    });
  }

  async function post(at, operationName, variables, query, withQuery) {
    const r = await of.call(window, '/api/graphql' + (withQuery ? '?access_token=' + at : ''), {
      method: 'POST', credentials: 'include',
      headers: {'content-type': 'application/json', accept: 'application/json, text/plain, */*', authorization: 'Bearer ' + at},
      body: JSON.stringify({operationName, variables, query})});
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    return {r, txt, j};
  }

  async function gql(at, operationName, variables, query) {
    let o = await post(at, operationName, variables, query, true);
    if (!o.j && o.r.status !== 401) o = await post(at, operationName, variables, query, false);
    if (o.r.status === 401) throw new Error('NO_TOKEN');
    if (!o.j) throw new Error('BAD_SESSION: GIMIS returned a web page instead of data (status ' + o.r.status + (o.r.redirected ? ', redirect ' + o.r.url : '') + '): ' + o.txt.replace(/\s+/g, ' ').slice(0, 80));
    if (!o.r.ok && !o.j.data) throw new Error('GIMIS ' + operationName + ' ' + o.r.status);
    if (o.j.errors) {
      const m = String(o.j.errors[0].message || '');
      if (/unauthor|unauthenticated|access denied|invalid token|expired/i.test(m) && operationName === 'checkPasswordExpiryRemainingDay') throw new Error('NO_TOKEN');
      throw new Error(m);
    }
    return o.j.data;
  }

  function candidates() {
    const c = [];
    if (window.__gpsaToken) c.push(window.__gpsaToken);
    const re = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
    const scan = (txt) => { (String(txt || '').match(re) || []).forEach((t) => { if (!c.includes(t)) c.push(t); }); };
    try { [localStorage, sessionStorage].forEach((st) => { for (let i = 0; i < st.length; i++) scan(st.getItem(st.key(i))); }); } catch (e) {}
    try { scan(document.cookie); } catch (e) {}
    return c;
  }

  // Thibitisha token inafanya kazi (query ndogo iliyo kwenye Excel), jaribu zote zinazopatikana
  async function validate() {
    let last = 'No token captured';
    for (const t of candidates()) {
      try {
        await gql(t, 'checkPasswordExpiryRemainingDay', {}, 'query checkPasswordExpiryRemainingDay { checkPasswordExpiryRemainingDay }');
        window.__gpsaToken = t; return {valid: true};
      } catch (e) { last = String(e.message || e); }
    }
    return {valid: false, detail: last};
  }

  // Error that carries a precise reason, so the dashboard can say exactly what is wrong
  class GErr extends Error { constructor(m, reason, extra) { super(m); this.reason = reason; Object.assign(this, extra || {}); } }
  const sameVeh = (a, b) => String(a || '').replace(/\s+/g, '').toUpperCase() === String(b || '').replace(/\s+/g, '').toUpperCase();

  // GIMIS answers code 9002 / empty data for several different problems. Ask again in a different way to find the real one.
  //   token_used       -> token is already used in GIMIS (all items issued)
  //   token_partial    -> token exists/used in GIMIS but not fully issued
  //   chassis_mismatch -> the token exists, but for another vehicle than the one saved here
  //   token_unknown    -> GIMIS has no record of the token at all (does not exist, or expired)
  async function diagnose(at, token, chassis) {
    let u = null;
    try { const x = (await gql(at, 'findUsedIssueNoteToken', {token}, Q_USED)).findUsedIssueNoteToken; u = x && x.data; } catch (e) { if (fatal(e)) throw e; }
    if (u) {
      const veh = u.meansOfTransportId || '', full = allIssued(u.issueNoteItems);
      return {reason: veh && !sameVeh(veh, chassis) ? 'chassis_mismatch' : (full ? 'token_used' : 'token_partial'), gimisVehicle: veh, used: u};
    }
    let d = null;
    try { const g = (await gql(at, 'getIssueNoteToken', {token, vehicleRegNo: null}, Q_CHK)).getIssueNoteToken; d = g && g.data; } catch (e) { if (fatal(e)) throw e; }
    if (d) return {reason: 'chassis_mismatch', gimisVehicle: d.meansOfTransportId || (d.issueNote && d.issueNote.meansOfTransportId) || ''};
    return {reason: 'token_unknown'};
  }
  function msgFor(dg, chassis, code) {
    if (dg.reason === 'chassis_mismatch') return dg.gimisVehicle ? 'Wrong chassis number: this token belongs to vehicle "' + dg.gimisVehicle + '", not "' + chassis + '".' : 'Wrong chassis number: this token exists in GIMIS but is registered to a different vehicle than "' + chassis + '".';
    if (dg.reason === 'token_partial') return 'Token is used in GIMIS but not all items are issued.';
    if (dg.reason === 'token_used') return 'Token is already used in GIMIS.';
    return 'No Record Found' + (code != null ? ' (GIMIS code ' + code + ')' : '');
  }

  async function issue(token, chassis) {
    const at = window.__gpsaToken;
    if (!at) throw new Error('NO_TOKEN');
    const res = (await gql(at, 'getIssueNoteToken', {token, vehicleRegNo: chassis}, Q_GET)).getIssueNoteToken;
    const data = res && res.data;
    if (!data) {
      const dg = await diagnose(at, token, chassis);
      if (dg.reason === 'token_used' && dg.used) { const rr0 = dg.used.requisitionRequest || {}; return {alreadyIssued: true, institution: rr0.institutionName, detail: detail(dg.used)}; }
      throw new GErr(msgFor(dg, chassis, res && res.code), dg.reason, {gimisVehicle: dg.gimisVehicle || '', code: res && res.code});
    }
    if (!data.used) {
      const items = data.issueNote.issueNoteItems.filter(i => !i.issued)
        .map(i => ({id: i.id, token, quantity: i.quantity, prePriceUuid: null}));
      if (items.length) {
        let out;
        try { out = (await gql(at, 'issueItemsSelected', {issueNoteItemDtos: items}, M_ISSUE)).issueItemsSelected; }
        catch (e) {
          if (fatal(e)) throw e;
          const ex = data.expireOn && Date.parse(data.expireOn);
          if (ex && ex < Date.now()) throw new GErr('Token expired on ' + String(data.expireOn).slice(0, 10) + ' - GIMIS refused to issue it (' + e.message + ').', 'expired');
          throw new GErr('GIMIS refused to issue this token: ' + e.message, 'refused');
        }
        if (!out || !out.every(i => i.issued)) throw new GErr('Save did not complete: GIMIS did not mark every item as issued.', 'save_failed');
      }
    }
    return {institution: data.issueNote.requisitionRequest.institutionName, detail: detail(data.issueNote, data)};
  }

  const allIssued = (items) => !!(items && items.length && items.every((i) => i.issued));
  const lastIso = (items) => (items || []).map((i) => i.issueDateTime).filter(Boolean).sort().pop() || null;
  const fatal = (e) => { const m = String((e && e.message) || e); return m === 'NO_TOKEN' || /^BAD_SESSION/.test(m); };

  // Hatua 3, positive ikitoka popote = issued. 'notissued' ni pale vyanzo vyote vinakubali bado.
  // meta=true: pia chukua tarehe ya token kutengenezwa (createdAt) hata kama tayari imeshaissue.
  async function check(token, chassis, meta) {
    const at = window.__gpsaToken;
    if (!at) throw new Error('NO_TOKEN');
    let hit = null, det = null;
    // 1) \"TOKEN IS USED\" ya GIMIS
    try {
      const u = (await gql(at, 'findUsedIssueNoteToken', {token}, Q_USED)).findUsedIssueNoteToken;
      const d = u && u.data;
      if (d) det = detail(d);
      if (d && allIssued(d.issueNoteItems)) hit = {state: 'issued', issuedAt: lastIso(d.issueNoteItems), ref: d.issuedNoteReference, issuedBy: d.issuedPersonName,
        institution: d.requisitionRequest && d.requisitionRequest.institutionName, noteCreatedAt: d.createdAt || null};
    } catch (e) { if (fatal(e)) throw e; }
    // 2) Token + chassis (pia inatoa tarehe ya token kutengenezwa)
    let g = null, tried = false;
    if (!hit || meta) {
      try { g = (await gql(at, 'getIssueNoteToken', {token, vehicleRegNo: chassis}, Q_CHK)).getIssueNoteToken; tried = true; }
      catch (e) { if (fatal(e) || !hit) throw e; }
    }
    const data = g && g.data, note = (data && data.issueNote) || {}, rr = note.requisitionRequest || {};
    if (data) det = Object.assign({}, det || {}, detail(note, data));
    const info = {metaTried: tried, tokenCreatedAt: (data && data.createdAt) || null, expireOn: (data && data.expireOn) || null, noteCreatedAt: note.createdAt || null, detail: det};
    if (hit) return Object.assign(info, hit, {noteCreatedAt: hit.noteCreatedAt || info.noteCreatedAt});
    if (!data) {
      const dg = await diagnose(at, token, chassis);
      return {state: 'notfound', code: g && g.code, reason: dg.reason, gimisVehicle: dg.gimisVehicle || '', message: msgFor(dg, chassis, g && g.code), metaTried: true, detail: det};
    }
    const out = Object.assign(info, {institution: rr.institutionName});
    if (data.used || allIssued(note.issueNoteItems)) return Object.assign(out, {state: 'issued', issuedAt: lastIso(note.issueNoteItems)});
    // 3) Maoni ya pili: issue notes za requisition hiyo (kwa sababu getIssueNoteToken inaweza kuchelewa kusasisha)
    if (rr.id) {
      try {
        const n = (await gql(at, 'findIssueNotesByRequsitionId', {requisitionRequestId: rr.id}, Q_NOTES)).findIssueNotesByRequisitionId;
        const mine = (n || []).find((x) => x.id === note.id);
        if (mine) out.detail = Object.assign({}, out.detail || {}, detail(mine));
        if (mine && allIssued(mine.issueNoteItems)) return Object.assign(out, {state: 'issued', issuedAt: lastIso(mine.issueNoteItems), ref: mine.issuedNoteReference, issuedBy: mine.issuedPersonName});
      } catch (e) { if (fatal(e)) throw e; }
    }
    return Object.assign(out, {state: 'notissued'});
  }

  async function myTokens(at) {
    if (!at) throw new Error('NO_TOKEN');
    const x = (await gql(at, 'myIssueNoteTokens', {}, Q_MY)).myIssueNoteTokens;
    return Array.isArray(x) ? x : [];
  }
  // Renew an expired token. GIMIS' own page sends the TOKEN record id (data.id of the token) as "issueNoteId" (see API.xlsx: id 487418).
  // Safety: we only ask GIMIS to renew when GIMIS itself shows the token as NOT used and ALREADY expired, then we read it back.
  async function regenerate(token, chassis) {
    const at = window.__gpsaToken; if (!at) throw new Error('NO_TOKEN');
    let id = null, exp = null, used = false;
    const g = (await gql(at, 'getIssueNoteToken', {token, vehicleRegNo: chassis}, Q_CHK)).getIssueNoteToken, d = g && g.data;
    if (d) { id = d.id; exp = d.expireOn ? Date.parse(d.expireOn) : null; used = !!d.used; }
    else {
      const mine = (await myTokens(at)).find((t) => String(t.token) === String(token));
      if (mine) { id = mine.id; exp = mine.expireOn ? Date.parse(mine.expireOn) : null; used = !!mine.used; }
    }
    if (id == null) return {done: false, why: 'not_found'};
    if (used) return {done: false, why: 'used'};
    if (!exp) return {done: false, why: 'unknown'};
    if (exp > Date.now()) return {done: false, why: 'valid', expireOn: new Date(exp).toISOString()};
    const rg = (await gql(at, 'regenerateIssueNoteToken', {issueNoteId: id}, Q_REGEN)).regenerateIssueNoteToken;
    if (!rg || rg.code !== 9000 || rg.data !== true) return {done: false, why: 'refused', code: rg && rg.code, message: rg && rg.message};
    const g2 = (await gql(at, 'getIssueNoteToken', {token, vehicleRegNo: chassis}, Q_CHK)).getIssueNoteToken, d2 = g2 && g2.data;
    if (d2) return {done: true, expireOn: d2.expireOn, tokenCreatedAt: d2.createdAt};
    const m2 = (await myTokens(at)).find((t) => t.id === id);   // the token number may have changed
    if (m2) return {done: true, expireOn: m2.expireOn, newToken: String(m2.token) !== String(token) ? String(m2.token) : null};
    return {done: true, unconfirmed: true};
  }

  // ---------- AI assistant: READ-ONLY lookups (queries only - nothing here can issue, save or renew a token) ----------
  // Queries copied from API.xlsx (GIMIS' own pages). Contact details (emails / phones) are removed before anything leaves this page.
  const Q_REQ = `query findRequisitionRequestById($id: Long) { findRequisitionRequestById(id: $id) { code data { id uuid active createdAt updatedAt closed completed description peStatus title comment requisitionType
      vehiclePermitRequest { id vehiclePermitNumber } institutionName shopName walletName billNumber billedAmount paidAmount trackingNumber
      createdUser { id fullName }
      requisitionRequestItems { id completed item { id itemName itemCode } quantity unitPrice }
      issueNotes { id title issueNoteItems { id quantity item { id itemName } } } } } }`;
  const noContact = (o) => { const r = Object.assign({}, o); delete r.requesterEmail; return r; };
  async function aiLookup(token, chassis) {
    const at = window.__gpsaToken; if (!at) throw new Error('NO_TOKEN');
    const out = {token: String(token)};
    let used = null, g = null;
    try { const u = (await gql(at, 'findUsedIssueNoteToken', {token}, Q_USED)).findUsedIssueNoteToken; used = u && u.data; out.usedCode = u && u.code; } catch (e) { if (fatal(e)) throw e; }
    try { g = (await gql(at, 'getIssueNoteToken', {token, vehicleRegNo: chassis || null}, Q_CHK)).getIssueNoteToken; } catch (e) { if (fatal(e)) throw e; }
    const d = g && g.data;
    out.getCode = g && g.code;
    if (d) { out.known = true; out.tokenUsed = !!d.used; out.tokenCreatedAt = d.createdAt || null; out.expireOn = d.expireOn || null; out.vehicleInGimis = d.meansOfTransportId || (d.issueNote && d.issueNote.meansOfTransportId) || null;
      out.detail = noContact(detail(d.issueNote, d)); out.allItemsIssued = allIssued(d.issueNote && d.issueNote.issueNoteItems); out.issuedAt = lastIso(d.issueNote && d.issueNote.issueNoteItems); }
    if (used) { out.known = true; out.inUsedList = true; out.detail = Object.assign({}, out.detail || {}, noContact(detail(used))); out.allItemsIssued = allIssued(used.issueNoteItems); out.issuedAt = lastIso(used.issueNoteItems) || out.issuedAt || null; out.vehicleInGimis = out.vehicleInGimis || used.meansOfTransportId || null; }
    if (!out.known) { out.known = false; out.note = 'GIMIS has no record of this token (does not exist, wrong number, or expired and removed). GIMIS code ' + (out.getCode == null ? '?' : out.getCode); }
    if (chassis && out.vehicleInGimis) out.chassisMatches = sameVeh(chassis, out.vehicleInGimis);
    return out;
  }
  async function aiRequisition(id) {
    const at = window.__gpsaToken; if (!at) throw new Error('NO_TOKEN');
    const x = (await gql(at, 'findRequisitionRequestById', {id: Number(id)}, Q_REQ)).findRequisitionRequestById;
    return {code: x && x.code, data: x && x.data};
  }
  async function aiNotes(id) {
    const at = window.__gpsaToken; if (!at) throw new Error('NO_TOKEN');
    const n = (await gql(at, 'findIssueNotesByRequsitionId', {requisitionRequestId: Number(id)}, Q_NOTES)).findIssueNotesByRequisitionId;
    return (n || []).map((x) => noContact(detail(x)));
  }


  // ---------- AI: generic READ-ONLY GraphQL (the guard from ai-engine.js refuses mutations and state-changing fields) ----------
  async function aiGraphql(query, variables, tag) {
    const at = window.__gpsaToken; if (!at) throw new Error('NO_TOKEN');
    const G = window.GpsaEngineCore; if (!G || !G.guardQuery) throw new Error('Kinga ya usalama (guard) haijapakiwa - ombi limekataliwa.');
    const g = G.guardQuery(query); if (!g.ok) throw new Error(g.reason);
    const opName = (/\bquery\s+([A-Za-z_]\w*)/.exec(query) || [])[1] || null;
    let o = await post(at, opName, variables || {}, query, true);
    if (!o.j && o.r.status !== 401) o = await post(at, opName, variables || {}, query, false);
    if (o.r.status === 401) throw new Error('NO_TOKEN');
    if (!o.j) throw new Error('BAD_SESSION: GIMIS ilirudisha ukurasa badala ya data (status ' + o.r.status + ').');
    const errs = (o.j.errors || []).slice(0, 6).map((e) => ({message: String(e.message || '').slice(0, 300)}));
    if (!o.j.data && errs.length && errs.every((e) => /unauthor|unauthenticated|access denied|invalid token|expired/i.test(e.message))) throw new Error('NO_TOKEN');
    return {data: o.j.data || null, errors: errs, status: o.r.status};
  }

  window.addEventListener('message', async (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.src !== 'gpsa-ext') return;
    const reply = (o) => window.postMessage(Object.assign({src: 'gpsa-page', id: d.id}, o), '*');
    if (d.op === 'status') return reply(Object.assign({ok: true, hasToken: !!window.__gpsaToken}, await validate()));
    if (d.op === 'issue') {
      try { reply(Object.assign({ok: true}, await issue(d.token, d.chassis))); }
      catch (err) { reply({ok: false, error: String(err.message || err), reason: err && err.reason, gimisVehicle: err && err.gimisVehicle, code: err && err.code}); }
    }
    if (d.op === 'expiryList') {
      try { reply({ok: true, list: (await myTokens(window.__gpsaToken)).map((t) => ({token: String(t.token), id: t.id, used: !!t.used, expireOn: t.expireOn}))}); }
      catch (err) { reply({ok: false, error: String(err.message || err)}); }
    }
    if (d.op === 'regenerate') {
      try { reply(Object.assign({ok: true}, await regenerate(d.token, d.chassis))); }
      catch (err) { reply({ok: false, error: String(err.message || err)}); }
    }
    if (d.op === 'aiLookup') {
      try { reply({ok: true, result: await aiLookup(d.token, d.chassis)}); } catch (err) { reply({ok: false, error: String(err.message || err)}); }
    }
    if (d.op === 'aiMyTokens') {
      try { const l = await myTokens(window.__gpsaToken); reply({ok: true, total: l.length, list: l.slice(0, Math.min(Number(d.limit) || 200, 500)).map((t) => ({token: String(t.token), used: !!t.used, active: t.active, createdAt: t.createdAt, expireOn: t.expireOn}))}); } catch (err) { reply({ok: false, error: String(err.message || err)}); }
    }
    if (d.op === 'aiGql') {
      try { const r = await aiGraphql(d.query, d.variables, d.tag); reply({ok: true, data: r.data, errors: r.errors, status: r.status}); }
      catch (err) { reply({ok: false, error: String(err.message || err)}); }
    }
    if (d.op === 'aiRequisition') {
      try { reply({ok: true, result: await aiRequisition(d.id)}); } catch (err) { reply({ok: false, error: String(err.message || err)}); }
    }
    if (d.op === 'aiNotes') {
      try { reply({ok: true, result: await aiNotes(d.id)}); } catch (err) { reply({ok: false, error: String(err.message || err)}); }
    }
    if (d.op === 'check') {
      try { reply(Object.assign({ok: true}, await check(d.token, d.chassis, !!d.meta))); }
      catch (err) { reply({ok: false, error: String(err.message || err), reason: err && err.reason, gimisVehicle: err && err.gimisVehicle, code: err && err.code}); }
    }
  });
})();
