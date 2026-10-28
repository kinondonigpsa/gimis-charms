// ai-sandbox.js - "code interpreter" of elapsAI. Runs inside a sandboxed extension page (no network, no access to GIMIS or Chrome APIs).
// It receives the code + the datasets it needs, runs it, and sends back logs, the returned value and any files it created.
(function () {
  'use strict';
  const F = window.GpsaFiles, AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const show = (a) => { if (typeof a === 'string') return a; try { return JSON.stringify(a, (k, v) => typeof v === 'bigint' ? String(v) : v); } catch (e) { return String(a); } };
  function makeEnv(out) {
    const imgs = {};
    const push = (name, mime, bytes) => { out.files.push({ name, mime, bytes: bytes instanceof Uint8Array ? bytes : F.enc.encode(String(bytes)) }); };
    const fixName = (n, ext) => { n = String(n || 'faili').replace(/[\\/:*?"<>|]+/g, '_'); return /\.[a-z0-9]+$/i.test(n) ? n : n + '.' + ext; };
    const files = {
      xlsx: (name, sheets) => push(fixName(name, 'xlsx'), F.MIME.xlsx, F.xlsx(Array.isArray(sheets) ? { sheets } : sheets)),
      csv: (name, rows, columns) => push(fixName(name, 'csv'), F.MIME.csv, F.enc.encode(F.csv(rows, columns))),
      docx: (name, md, opts) => push(fixName(name, 'docx'), F.MIME.docx, F.docx(md, Object.assign({ images: imgs }, opts || {}))),
      pdf: async (name, md, opts) => { const im = {}; for (const k of Object.keys(imgs)) im[k] = await F.pngToJpeg(imgs[k]); push(fixName(name, 'pdf'), F.MIME.pdf, F.pdf(md, Object.assign({ images: im, title: String(name) }, opts || {}))); },
      html: (name, html) => push(fixName(name, 'html'), F.MIME.html, F.enc.encode(/<html[\s>]|<!doctype/i.test(html) ? html : F.htmlDoc(html, { title: String(name) }))),
      text: (name, t) => push(fixName(name, 'txt'), F.MIME.txt, F.enc.encode(String(t))),
      json: (name, o) => push(fixName(name, 'json'), F.MIME.json, F.enc.encode(JSON.stringify(o, null, 2))),
      chart: async (name, spec) => { const svg = F.chartSvg(spec), png = await F.svgToPng(svg, 2), n = fixName(name, 'png'); imgs[n] = png.bytes; push(n, F.MIME.png, png.bytes); return n; },
      image: async (name, svg, scale) => { const png = await F.svgToPng(svg, scale || 2), n = fixName(name, 'png'); imgs[n] = png.bytes; push(n, F.MIME.png, png.bytes); return n; }
    };
    const util = {
      sum: (rows, f) => rows.reduce((a, r) => a + (Number(typeof f === 'function' ? f(r) : r[f]) || 0), 0),
      groupBy: (rows, f) => { const m = {}; rows.forEach((r) => { const k = typeof f === 'function' ? f(r) : r[f]; (m[k] = m[k] || []).push(r); }); return m; },
      uniq: (a) => [...new Set(a)], num: (v) => F.toNum(v), fmt: (n) => F.fmtNum(Number(n) || 0), round: (n, d) => { const p = Math.pow(10, d == null ? 2 : d); return Math.round(Number(n) * p) / p; },
      day: (v) => typeof v === 'number' ? new Date(v + 3 * 3600e3).toISOString().slice(0, 10) : String(v || '').slice(0, 10), month: (v) => util.day(v).slice(0, 7)
    };
    return { files, util };
  }
  window.addEventListener('message', async (e) => {
    const m = e.data; if (!m || m.gpsa !== 'run') return;
    const out = { logs: [], files: [], datasets: {} }, { files, util } = makeEnv(out), logs = out.logs;
    const con = { log: (...a) => logs.push(a.map(show).join(' ')), info: (...a) => logs.push(a.map(show).join(' ')), warn: (...a) => logs.push('WARN ' + a.map(show).join(' ')), error: (...a) => logs.push('ERROR ' + a.map(show).join(' ')), table: (r) => logs.push(show(r)) };
    let reply;
    try {
      const fn = new AsyncFunction('data', 'files', 'util', 'console', 'print', 'saveDataset', '"use strict";\n' + m.code);
      const result = await fn(m.data || {}, files, util, con, con.log, (name, rows) => { out.datasets[String(name)] = Array.isArray(rows) ? rows : []; });
      let res; if (result !== undefined) { try { res = JSON.parse(JSON.stringify(result, (k, v) => typeof v === 'bigint' ? String(v) : v)); const s = JSON.stringify(res); if (s && s.length > 8000) res = { truncated: true, preview: s.slice(0, 8000) }; } catch (er) { res = String(result).slice(0, 2000); } }
      reply = { gpsaSandbox: 'result', id: m.id, ok: true, logs, result: res, files: out.files, datasets: out.datasets };
    } catch (err) { reply = { gpsaSandbox: 'result', id: m.id, ok: false, error: String((err && err.stack) || err).split('\n').slice(0, 4).join(' | '), logs, files: [], datasets: {} }; }
    parent.postMessage(reply, '*', [...new Set(reply.files.map((f) => f.bytes.buffer))]);
  });
  parent.postMessage({ gpsaSandbox: 'ready' }, '*');
})();
