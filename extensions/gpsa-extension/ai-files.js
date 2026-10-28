// ai-files.js - GpsaFiles: dependency-free file engine (zip, xlsx read/write, docx, pdf, csv, html, svg charts, png).
// Works in the extension (content script + sandbox page) and in Node (for tests).
(function (root) {
  'use strict';
  const enc = new TextEncoder(), dec = new TextDecoder('utf-8');
  const u8 = (x) => x instanceof Uint8Array ? x : typeof x === 'string' ? enc.encode(x) : new Uint8Array(x);
  const cat = (parts) => { const n = parts.reduce((s, p) => s + p.length, 0), o = new Uint8Array(n); let k = 0; parts.forEach((p) => { o.set(p, k); k += p.length; }); return o; };
  const le16 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255]);
  const le32 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

  // ---------- ZIP (stored) ----------
  function zip(entries) {
    const chunks = [], central = []; let off = 0;
    entries.forEach(([name, data]) => {
      const nb = enc.encode(name), d = u8(data), crc = crc32(d);
      const local = cat([le32(0x04034b50), le16(20), le16(0x800), le16(0), le16(0), le16(DOS_DATE), le32(crc), le32(d.length), le32(d.length), le16(nb.length), le16(0), nb, d]);
      chunks.push(local); central.push({ nb, d, crc, off }); off += local.length;
    });
    const cd = cat(central.map((e) => cat([le32(0x02014b50), le16(20), le16(20), le16(0x800), le16(0), le16(0), le16(DOS_DATE), le32(e.crc), le32(e.d.length), le32(e.d.length), le16(e.nb.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(e.off), e.nb])));
    return cat([...chunks, cd, le32(0x06054b50), le16(0), le16(0), le16(central.length), le16(central.length), le32(cd.length), le32(off), le16(0)]);
  }
  async function inflateRaw(b) {
    const ds = new DecompressionStream('deflate-raw');
    return new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(ds)).arrayBuffer());
  }
  async function unzip(bytes) {
    bytes = u8(bytes); const out = {}; let e = -1;
    for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 70000; i--) if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 5 && bytes[i + 3] === 6) { e = i; break; }
    if (e < 0) throw new Error('Si faili la zip/xlsx/docx halali.');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nl)); p += 46 + nl + el + cl;
      const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = bytes.subarray(ds, ds + csz);
      out[name] = { method, raw };
    }
    return { names: Object.keys(out), async text(name) { const x = out[name]; if (!x) return null; return dec.decode(x.method === 0 ? x.raw : await inflateRaw(x.raw)); }, async bytes(name) { const x = out[name]; if (!x) return null; return x.method === 0 ? x.raw : inflateRaw(x.raw); } };
  }

  // ---------- helpers ----------
  const xe = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = (i) => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const toNum = (v) => { if (isNum(v)) return v; if (v == null) return NaN; const s = String(v).trim().replace(/[,\s]/g, '').replace(/^TZS|^TSh/i, ''); return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN; };
  const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;
  const serialOf = (y, m, d, H, M, S) => Date.UTC(y, m - 1, d, H || 0, M || 0, S || 0) / 86400000 + 25569;
  const idCol = /(^|[^a-z])(id|no|number|token|chassis|ref|reference|code|year|phone|tin|sno|s\/n|namba|simu|uuid)([^a-z]|$)/i;

  function normSheet(sh) {
    const rows = sh.rows || [];
    let header = sh.columns || sh.header, body;
    if (rows.length && rows[0] && !Array.isArray(rows[0]) && typeof rows[0] === 'object') {
      if (!header) { const seen = {}; rows.slice(0, 500).forEach((r) => Object.keys(r).forEach((k) => { seen[k] = 1; })); header = Object.keys(seen); }
      body = rows.map((r) => header.map((h) => r[h]));
    } else body = rows.map((r) => Array.isArray(r) ? r : [r]);
    if (!header && sh.header !== false && body.length && sh.firstRowIsHeader) { header = body[0]; body = body.slice(1); }
    return { header: header || null, body };
  }

  // ---------- XLSX writer ----------
  const XS = { title: 1, head: 2, text: 3, int: 4, dec: 5, gen: 6, date: 7, dtime: 8, tlab: 9, tnum: 10, wrap: 11 };
  function xlsx(spec) {
    const sheets = (spec.sheets || []).slice(0, 30), used = {}, files = [], wsXml = [];
    sheets.forEach((sh, si) => {
      let name = String(sh.name || ('Sheet' + (si + 1))).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || ('Sheet' + (si + 1));
      let base = name, k = 2; while (used[name.toLowerCase()]) name = base.slice(0, 28) + ' ' + (k++); used[name.toLowerCase()] = 1; sh._name = name;
      const { header, body } = normSheet(sh), ncol = Math.max(header ? header.length : 0, ...body.slice(0, 2000).map((r) => r.length), 1);
      let r = 1, out = '';
      const widths = new Array(ncol).fill(8), seeLen = (c, v) => { const l = v == null ? 0 : String(v instanceof Date ? 'yyyy-mm-dd hh:mm' : v).length; if (l + 2 > widths[c]) widths[c] = Math.min(60, l + 2); };
      if (sh.title) { out += `<row r="${r}" ht="24" customHeight="1"><c r="A${r}" s="${XS.title}" t="inlineStr"><is><t xml:space="preserve">${xe(sh.title)}</t></is></c></row>`; r += 2; }
      const merge = sh.title && ncol > 1 ? `<mergeCells count="1"><mergeCell ref="A1:${colName(ncol - 1)}1"/></mergeCells>` : '';
      let headRow = 0;
      if (header) { headRow = r; out += `<row r="${r}" ht="22" customHeight="1">` + header.map((h, c) => { seeLen(c, h); return `<c r="${colName(c)}${r}" s="${XS.head}" t="inlineStr"><is><t xml:space="preserve">${xe(h)}</t></is></c>`; }).join('') + '</row>'; r++; }
      const first = r, numeric = new Array(ncol).fill(0), strs = new Array(ncol).fill(0), sums = new Array(ncol).fill(0);
      body.forEach((row) => {
        out += `<row r="${r}">`;
        for (let c = 0; c < ncol; c++) {
          let v = row[c]; if (v == null || v === '') continue; const ref = colName(c) + r, hn = header ? String(header[c] || '') : '';
          if (v instanceof Date) v = v.toISOString().slice(0, 19).replace('T', ' ');
          if (v && typeof v === 'object' && v.f) { out += `<c r="${ref}" s="${XS.dec}"><f>${xe(String(v.f).replace(/^=/, ''))}</f></c>`; continue; }
          if (typeof v === 'string' && v.length > 1 && v[0] === '=' && sh.formulas !== false) { out += `<c r="${ref}" s="${XS.gen}"><f>${xe(v.slice(1))}</f></c>`; continue; }
          if (typeof v === 'boolean') { out += `<c r="${ref}" s="${XS.text}" t="b"><v>${v ? 1 : 0}</v></c>`; seeLen(c, 5); continue; }
          if (isNum(v)) { numeric[c]++; sums[c] += v; const s = idCol.test(hn) ? XS.gen : Number.isInteger(v) ? XS.int : XS.dec; out += `<c r="${ref}" s="${s}"><v>${v}</v></c>`; seeLen(c, v.toLocaleString ? v.toLocaleString('en-US') : v); continue; }
          if (typeof v === 'string') { const m = ISO.exec(v); if (m && v.length <= 19 && !idCol.test(hn)) { const sr = serialOf(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]); out += `<c r="${ref}" s="${m[4] ? XS.dtime : XS.date}"><v>${sr}</v></c>`; seeLen(c, 'yyyy-mm-dd hh:mm'); continue; } }
          strs[c]++; v = String(v).slice(0, 32767); seeLen(c, v.split('\n')[0]); out += `<c r="${ref}" s="${XS.text}" t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
        }
        out += '</row>'; r++;
      });
      const last = r - 1;
      if (sh.totals && body.length) {
        out += `<row r="${r}">`; let put = false;
        for (let c = 0; c < ncol; c++) {
          if (numeric[c] && !strs[c] && !(header && idCol.test(String(header[c] || '')))) { out += `<c r="${colName(c)}${r}" s="${XS.tnum}"><f>SUM(${colName(c)}${first}:${colName(c)}${last})</f><v>${sums[c]}</v></c>`; put = true; }
          else if (c === 0 || (!put && c === 0)) out += `<c r="A${r}" s="${XS.tlab}" t="inlineStr"><is><t>JUMLA / TOTAL</t></is></c>`;
          else out += `<c r="${colName(c)}${r}" s="${XS.tlab}"/>`;
        }
        out += '</row>';
      }
      const colsXml = '<cols>' + widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${(sh.widths && sh.widths[c]) || w}" customWidth="1"/>`).join('') + '</cols>';
      const view = (headRow || sh.freeze) ? `<sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ''}><pane ySplit="${headRow || 1}" topLeftCell="A${(headRow || 1) + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : `<sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ''}/></sheetViews>`;
      const af = headRow && sh.filter !== false && body.length ? `<autoFilter ref="A${headRow}:${colName(ncol - 1)}${last}"/>` : '';
      wsXml.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${view}<sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${out}</sheetData>${af}${merge}<pageMargins left="0.5" right="0.5" top="0.7" bottom="0.7" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0"/></worksheet>`);
    });
    if (!wsXml.length) throw new Error('Excel inahitaji angalau sheet moja.');
    const border = '<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>';
    const xf = (n, f, fi, b, al) => `<xf numFmtId="${n}" fontId="${f}" fillId="${fi}" borderId="${b}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${al ? ' applyAlignment="1"><alignment ' + al + '/></xf>' : '/>'}`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="FF166534"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF166534"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${border}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="12">${xf(0, 0, 0, 0)}${xf(0, 3, 0, 0)}${xf(0, 2, 2, 1, 'horizontal="center" vertical="center" wrapText="1"')}${xf(0, 0, 0, 1)}${xf(3, 0, 0, 1)}${xf(4, 0, 0, 1)}${xf(0, 0, 0, 1)}${xf(14, 0, 0, 1)}${xf(165, 0, 0, 1)}${xf(0, 1, 3, 1)}${xf(4, 1, 3, 1)}${xf(0, 0, 0, 1, 'wrapText="1" vertical="top"')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + wsXml.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>';
    const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xe(s._name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
    const wrels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wsXml.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${wsXml.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    files.push(['[Content_Types].xml', ct], ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'], ['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', wrels], ['xl/styles.xml', styles]);
    wsXml.forEach((x, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, x]));
    return zip(files);
  }

  // ---------- XLSX reader ----------
  const decEnt = (s) => s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e] || String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))));
  const tText = (x) => { let o = '', m; const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g; while ((m = re.exec(x))) if (m[1]) o += m[1]; return decEnt(o); };
  const colIdx = (L) => { let n = 0; for (let i = 0; i < L.length; i++) n = n * 26 + L.charCodeAt(i) - 64; return n - 1; };
  const fmtDate = (serial, withTime) => { const ms = Math.round((serial - 25569) * 86400000), d = new Date(ms), p = (n) => String(n).padStart(2, '0'); const s = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()); return withTime ? s + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) : s; };
  async function readXlsx(bytes) {
    const z = await unzip(bytes);
    const ss = []; const sx = await z.text('xl/sharedStrings.xml'); if (sx) { const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g; let m; while ((m = re.exec(sx))) ss.push(m[1] ? tText(m[1]) : ''); }
    const dateXf = []; const st = await z.text('xl/styles.xml');
    if (st) { const custom = {}; let m; const nre = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g; while ((m = nre.exec(st))) custom[m[1]] = m[2];
      const cx = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st); if (cx) { const xre = /<xf\b[^>]*?numFmtId="(\d+)"/g; while ((m = xre.exec(cx[1]))) { const id = m[1], f = custom[id]; dateXf.push((+id >= 14 && +id <= 22) || (+id >= 45 && +id <= 47) || (f && /[ymd]/i.test(f.replace(/"[^"]*"|\\./g, '')) && !/[#0]/.test(f.replace(/"[^"]*"|\\./g, '')))); } } }
    const wb = await z.text('xl/workbook.xml') || '', rels = await z.text('xl/_rels/workbook.xml.rels') || '', relMap = {};
    let m; const rre = /<Relationship\b[^>]*>/g; while ((m = rre.exec(rels))) { const id = /Id="([^"]+)"/.exec(m[0]), tg = /Target="([^"]+)"/.exec(m[0]); if (id && tg) relMap[id[1]] = tg[1].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/'); }
    const sheets = []; const sre = /<sheet\b[^>]*>/g;
    while ((m = sre.exec(wb))) { const nm = /name="([^"]*)"/.exec(m[0]), id = /r:id="([^"]+)"/.exec(m[0]); if (nm && id && relMap[id[1]]) sheets.push({ name: decEnt(nm[1]), path: relMap[id[1]] }); }
    if (!sheets.length) z.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).forEach((n, i) => sheets.push({ name: 'Sheet' + (i + 1), path: n }));
    const out = [];
    for (const sh of sheets) {
      const xml = await z.text(sh.path); if (!xml) continue; const rows = [];
      const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g; let rm;
      while ((rm = rowRe.exec(xml))) {
        const rn = /\br="(\d+)"/.exec(rm[1]); const ri = rn ? +rn[1] - 1 : rows.length; while (rows.length < ri) rows.push([]);
        const row = []; const inner = rm[2] || '', cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
        while ((cm = cre.exec(inner))) {
          const at = cm[1], body = cm[2] || '', ref = /\br="([A-Z]+)\d*"/.exec(at), t = (/\bt="([^"]*)"/.exec(at) || [])[1], s = (/\bs="(\d+)"/.exec(at) || [])[1];
          const ci = ref ? colIdx(ref[1]) : row.length; let v = null; const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
          if (t === 'inlineStr') v = tText(body); else if (vm) { const raw = decEnt(vm[1]); if (t === 's') v = ss[+raw] != null ? ss[+raw] : ''; else if (t === 'b') v = raw === '1'; else if (t === 'str' || t === 'e') v = raw; else { const n = Number(raw); v = isNaN(n) ? raw : (s != null && dateXf[+s] ? fmtDate(n, n % 1 !== 0) : n); } }
          while (row.length < ci) row.push(null); row[ci] = v;
        }
        rows.push(row);
      }
      out.push({ name: sh.name, rows });
    }
    return out;
  }
  async function readDocxText(bytes) {
    const z = await unzip(bytes), x = await z.text('word/document.xml'); if (!x) throw new Error('Si faili la Word halali.');
    return x.split(/<\/w:p>/).map((p) => { const t = []; let m; const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g; while ((m = re.exec(p))) t.push(m[1] != null ? decEnt(m[1]) : ' '); return t.join(''); }).filter((l) => l.trim()).join('\n');
  }
  // First row that looks like a header (several text cells, followed by data); returns objects
  function gridToObjects(grid, hint) {
    let hi = -1;
    if (hint) { const h = String(hint).toLowerCase(); hi = grid.findIndex((r) => r.some((c) => c != null && String(c).toLowerCase().trim().includes(h))); }
    if (hi < 0) for (let i = 0; i < Math.min(grid.length, 40); i++) { const r = grid[i] || [], filled = r.filter((c) => c != null && String(c).trim() !== ''); if (filled.length >= 3 && filled.every((c) => typeof c === 'string') && grid[i + 1] && (grid[i + 1] || []).filter((c) => c != null && c !== '').length >= 2) { hi = i; break; } }
    if (hi < 0) hi = 0;
    const head = (grid[hi] || []).map((c, i) => (c == null || String(c).trim() === '') ? 'Column' + (i + 1) : String(c).trim()), seen = {};
    const cols = head.map((h) => { seen[h] = (seen[h] || 0) + 1; return seen[h] > 1 ? h + ' (' + seen[h] + ')' : h; });
    const rows = []; for (let i = hi + 1; i < grid.length; i++) { const r = grid[i] || []; if (!r.some((c) => c != null && c !== '')) continue; const o = {}; cols.forEach((c, k) => { if (r[k] != null && r[k] !== '') o[c] = r[k]; }); rows.push(o); }
    return { columns: cols, rows, headerRow: hi + 1 };
  }

  // ---------- CSV ----------
  function parseCsv(text) {
    text = String(text).replace(/^\uFEFF/, ''); const first = text.split('\n', 1)[0], cnt = (ch) => first.split(ch).length - 1;
    const d = cnt('\t') > cnt(',') && cnt('\t') > cnt(';') ? '\t' : cnt(';') > cnt(',') ? ';' : ',';
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) { const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === d) { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; } else cur += ch; }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); } return rows;
  }
  function csv(rows, columns) {
    let grid = rows; if (rows.length && !Array.isArray(rows[0]) && typeof rows[0] === 'object') { const n = normSheet({ rows, columns }); grid = [n.header].concat(n.body); }
    const q = (v) => { if (v == null) return ''; if (v instanceof Date) v = v.toISOString(); v = String(v); return /[",\n\r;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return '\uFEFF' + grid.map((r) => r.map(q).join(',')).join('\r\n');
  }
  function smartTypes(objs) { // text columns that are all numbers -> numbers (skip id-like columns)
    if (!objs.length) return objs; const cols = Object.keys(objs[0]);
    cols.forEach((c) => { if (idCol.test(c)) return; const vals = objs.map((o) => o[c]).filter((v) => v != null && v !== ''); if (vals.length && vals.every((v) => typeof v === 'string' && /^-?[\d,]+(\.\d+)?$/.test(v.trim()) && !/^0\d/.test(v.trim()))) objs.forEach((o) => { if (o[c] != null && o[c] !== '') o[c] = Number(String(o[c]).replace(/,/g, '')); }); });
    return objs;
  }

  // ---------- Markdown -> blocks (shared by docx / pdf / html) ----------
  function parseInline(t) {
    t = String(t == null ? '' : t).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)');
    const runs = []; const re = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\s][^*]*)\*)/g; let k = 0, m;
    while ((m = re.exec(t))) { if (m.index > k) runs.push({ t: t.slice(k, m.index) }); if (m[2] != null || m[3] != null) runs.push({ t: m[2] != null ? m[2] : m[3], b: 1 }); else if (m[4] != null) runs.push({ t: m[4], code: 1 }); else runs.push({ t: m[5], i: 1 }); k = m.index + m[0].length; }
    if (k < t.length) runs.push({ t: t.slice(k) }); return runs.length ? runs : [{ t: '' }];
  }
  const plain = (t) => parseInline(t).map((r) => r.t).join('');
  function parseMd(src) {
    const L = String(src || '').replace(/\r/g, '').split('\n'), B = []; let i = 0, para = [];
    const flush = () => { if (para.length) { B.push({ t: 'p', text: para.join(' ') }); para = []; } };
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    while (i < L.length) {
      const ln = L[i], tr = ln.trim();
      if (/^```/.test(tr)) { flush(); const code = []; i++; while (i < L.length && !/^```/.test(L[i].trim())) code.push(L[i++]); i++; B.push({ t: 'code', text: code.join('\n') }); continue; }
      if (/^\|.*\|$/.test(tr) && i + 1 < L.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(L[i + 1])) { flush(); const head = cells(tr); i += 2; const rows = []; while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) rows.push(cells(L[i++])); B.push({ t: 'table', head, rows }); continue; }
      let m;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(tr))) { flush(); B.push({ t: 'h', l: m[1].length, text: m[2] }); i++; continue; }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(tr)) { flush(); B.push({ t: 'hr' }); i++; continue; }
      if (/^(\[\[pagebreak\]\]|\\pagebreak|<pagebreak\s*\/?>)$/i.test(tr)) { flush(); B.push({ t: 'pb' }); i++; continue; }
      if ((m = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(tr))) { flush(); B.push({ t: 'img', alt: m[1], src: m[2] }); i++; continue; }
      if (/^[-*•]\s+/.test(tr)) { flush(); const items = []; while (i < L.length && /^\s*[-*•]\s+/.test(L[i])) items.push(L[i++].replace(/^\s*[-*•]\s+/, '')); B.push({ t: 'ul', items }); continue; }
      if (/^\d+[.)]\s+/.test(tr)) { flush(); const items = []; while (i < L.length && /^\s*\d+[.)]\s+/.test(L[i])) items.push(L[i++].replace(/^\s*\d+[.)]\s+/, '')); B.push({ t: 'ol', items }); continue; }
      if (/^>\s?/.test(tr)) { flush(); const q = []; while (i < L.length && /^\s*>\s?/.test(L[i])) q.push(L[i++].replace(/^\s*>\s?/, '')); B.push({ t: 'quote', text: q.join(' ') }); continue; }
      if (!tr) { flush(); i++; continue; }
      para.push(tr); i++;
    }
    flush(); return B;
  }

  // ---------- DOCX ----------
  function pngSize(b) { return b.length > 24 && b[1] === 0x50 ? { w: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, h: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 } : { w: 800, h: 500 }; }
  function docx(md, o) {
    o = o || {}; const blocks = typeof md === 'string' ? parseMd(md) : md, imgs = o.images || {}, media = [], land = o.orientation === 'landscape';
    const run = (r) => `<w:r><w:rPr>${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}${r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ''}${r.color ? `<w:color w:val="${r.color}"/>` : ''}</w:rPr><w:t xml:space="preserve">${xe(r.t)}</w:t></w:r>`;
    const para = (text, style, extra) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra || ''}</w:pPr>${parseInline(text).map(run).join('')}</w:p>`;
    const textW = land ? 14000 : 9800; let body = '';
    blocks.forEach((b) => {
      if (b.t === 'h') body += para(b.text, b.l === 1 && o.titleFirst !== false && !body ? 'Title' : 'Heading' + Math.min(b.l, 3));
      else if (b.t === 'p') body += para(b.text, null, '<w:spacing w:after="120"/>' + (o.justify ? '<w:jc w:val="both"/>' : ''));
      else if (b.t === 'ul') b.items.forEach((it) => { body += para('•\t' + it, null, '<w:tabs><w:tab w:val="left" w:pos="540"/></w:tabs><w:spacing w:after="40"/><w:ind w:left="540" w:hanging="270"/>'); });
      else if (b.t === 'ol') b.items.forEach((it, n) => { body += para((n + 1) + '.\t' + it, null, '<w:tabs><w:tab w:val="left" w:pos="540"/></w:tabs><w:spacing w:after="40"/><w:ind w:left="540" w:hanging="360"/>'); });
      else if (b.t === 'quote') body += para(b.text, null, '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="16A34A"/></w:pBdr><w:ind w:left="360"/>');
      else if (b.t === 'code') body += b.text.split('\n').map((l) => `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${run({ t: l, code: 1 })}</w:p>`).join('');
      else if (b.t === 'hr') body += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="9CA3AF"/></w:pBdr></w:pPr></w:p>';
      else if (b.t === 'pb') body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      else if (b.t === 'img') {
        const im = imgs[b.src] || imgs[String(b.src).split('/').pop()]; if (!im) { body += para('[picha haipo: ' + b.src + ']'); return; }
        const sz = pngSize(im), maxW = (land ? 8.8 : 6.2) * 914400, w = Math.min(maxW, sz.w * 9525), h = Math.round(w * sz.h / sz.w); media.push(im); const n = media.length;
        body += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${Math.round(w)}" cy="${h}"/><wp:docPr id="${n}" name="Picha ${n}" descr="${xe(b.alt)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(w)}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
      } else if (b.t === 'table') {
        const nc = Math.max(b.head.length, ...b.rows.map((r) => r.length)), W = Math.floor(textW / nc), num = (c) => b.rows.length && b.rows.every((r) => r[c] == null || r[c] === '' || !isNaN(toNum(r[c])));
        const cell = (t, hd, c) => `<w:tc><w:tcPr><w:tcW w:w="${W}" w:type="dxa"/>${hd ? '<w:shd w:val="clear" w:color="auto" w:fill="166534"/>' : ''}</w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${!hd && num(c) ? '<w:jc w:val="right"/>' : ''}</w:pPr>${parseInline(t).map((r) => run(Object.assign({}, r, hd ? { b: 1, color: 'FFFFFF' } : {}))).join('')}</w:p></w:tc>`;
        const bd = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BFC5CC"/>`).join('') + '</w:tblBorders>';
        body += `<w:tbl><w:tblPr><w:tblW w:w="${textW}" w:type="dxa"/>${bd}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${new Array(nc).fill(`<w:gridCol w:w="${W}"/>`).join('')}</w:tblGrid>` +
          `<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.head.map((h, c) => cell(h, 1, c)).join('')}${new Array(nc - b.head.length).fill(cell('', 1, 0)).join('')}</w:tr>` +
          b.rows.map((r) => '<w:tr>' + Array.from({ length: nc }, (_, c) => cell(r[c] == null ? '' : r[c], 0, c)).join('') + '</w:tr>').join('') + '</w:tbl><w:p/>';
      }
    });
    const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rIdFoot"/><w:pgSz w:w="${land ? 16838 : 11906}" w:h="${land ? 11906 : 16838}"${land ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
    const sty = (id, name, sz, color, extra) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/>${extra || ''}</w:pPr><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${sz}"/></w:rPr></w:style>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="sw-TZ"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${sty('Title', 'Title', 40, '166534', '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="16A34A"/></w:pBdr>')}${sty('Heading1', 'heading 1', 32, '166534')}${sty('Heading2', 'heading 2', 26, '15803D')}${sty('Heading3', 'heading 3', 23, '374151')}</w:styles>`;
    const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="6B7280"/></w:rPr><w:t xml:space="preserve">${xe(o.footer || 'elapsAI - GPSA Kinondoni')}  |  Ukurasa </w:t></w:r><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="6B7280"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSty" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFoot" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${media.map((_, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.png"/>`).join('')}</Relationships>`;
    const files = [['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`], ['word/styles.xml', styles], ['word/footer1.xml', footer], ['word/_rels/document.xml.rels', rels]];
    media.forEach((m, i) => files.push([`word/media/image${i + 1}.png`, m]));
    return zip(files);
  }

  // ---------- HTML document (printable -> "Save as PDF") ----------
  const he = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inlineHtml = (t) => parseInline(t).map((r) => { const x = he(r.t); return r.b ? '<b>' + x + '</b>' : r.i ? '<i>' + x + '</i>' : r.code ? '<code>' + x + '</code>' : x; }).join('');
  function htmlDoc(md, o) {
    o = o || {}; const imgs = o.imagesDataUrl || {}; let body = '';
    parseMd(md).forEach((b) => {
      if (b.t === 'h') body += `<h${b.l}>${inlineHtml(b.text)}</h${b.l}>`; else if (b.t === 'p') body += `<p>${inlineHtml(b.text)}</p>`;
      else if (b.t === 'ul' || b.t === 'ol') body += `<${b.t}>${b.items.map((i) => '<li>' + inlineHtml(i) + '</li>').join('')}</${b.t}>`;
      else if (b.t === 'quote') body += `<blockquote>${inlineHtml(b.text)}</blockquote>`; else if (b.t === 'code') body += `<pre>${he(b.text)}</pre>`;
      else if (b.t === 'hr') body += '<hr>'; else if (b.t === 'pb') body += '<div style="page-break-after:always"></div>';
      else if (b.t === 'img') { const u = imgs[b.src] || imgs[String(b.src).split('/').pop()]; body += u ? `<p style="text-align:center"><img src="${u}" alt="${he(b.alt)}"></p>` : ''; }
      else if (b.t === 'table') { const num = (c) => b.rows.length && b.rows.every((r) => r[c] == null || r[c] === '' || !isNaN(toNum(r[c]))); body += '<table><thead><tr>' + b.head.map((h) => '<th>' + inlineHtml(h) + '</th>').join('') + '</tr></thead><tbody>' + b.rows.map((r) => '<tr>' + b.head.map((_, c) => `<td${num(c) ? ' class="n"' : ''}>${inlineHtml(r[c] == null ? '' : r[c])}</td>`).join('') + '</tr>').join('') + '</tbody></table>'; }
    });
    return `<!DOCTYPE html><html lang="sw"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${he(o.title || 'Ripoti')}</title><style>body{font-family:Calibri,Arial,sans-serif;max-width:900px;margin:24px auto;padding:0 18px;color:#111827;line-height:1.55}h1{color:#166534;border-bottom:3px solid #16a34a;padding-bottom:6px}h2{color:#15803d}h3{color:#374151}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}th{background:#166534;color:#fff;text-align:left}th,td{border:1px solid #cbd5e1;padding:5px 8px}td.n{text-align:right}tr:nth-child(even) td{background:#f8fafc}blockquote{border-left:4px solid #16a34a;margin:10px 0;padding:2px 12px;background:#f0fdf4}code,pre{background:#f3f4f6;border-radius:4px}pre{padding:10px;overflow:auto}img{max-width:100%}.foot{margin-top:28px;color:#6b7280;font-size:12px;text-align:center}@media print{body{margin:0;max-width:none}a{color:inherit}}</style></head><body>${body}<div class="foot">${he(o.footer || 'elapsAI - GPSA Kinondoni')}</div></body></html>`;
  }

  // ---------- PDF (text, tables, JPEG images) ----------
  const WR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const WB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  const WIN = { 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x20ac: 0x80, 0x2026: 0x85, 0x2192: 0x3e, 0x2713: 0x76 };
  const win = (s) => { let o = ''; for (const ch of String(s)) { let c = ch.codePointAt(0); if (WIN[c]) c = WIN[c]; else if (c === 9) c = 32; else if (c < 32 || (c > 126 && c < 160) || c > 255) c = 63; o += String.fromCharCode(c); } return o; };
  const cw = (c, b) => { const k = c.charCodeAt(0); return ((b ? WB : WR)[k - 32] || 556); };
  const tw = (s, b, sz) => { let w = 0; for (let i = 0; i < s.length; i++) w += cw(s[i], b); return w * sz / 1000; };
  const pesc = (s) => s.replace(/[\\()]/g, (m) => '\\' + m);

  function pdf(md, o) {
    o = o || {}; const blocks = typeof md === 'string' ? parseMd(md) : md, imgs = o.images || {}, land = o.orientation === 'landscape';
    const PW = land ? 841.89 : 595.28, PH = land ? 595.28 : 841.89, M = 48, AW = PW - 2 * M, GREEN = '0.086 0.396 0.204', pages = [], imgObjs = [];
    let cur = null, y = 0;
    const newPage = () => { cur = []; pages.push(cur); y = PH - M; };
    const need = (h) => { if (y - h < M + 14) newPage(); };
    const put = (x, yy, s, bold, sz, col) => { if (s !== '') cur.push(`BT ${col || '0.07 0.09 0.15'} rg /F${bold ? 2 : 1} ${sz} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td (${pesc(win(s))}) Tj ET`); };
    const wrapRuns = (runs, width, sz, forceBold) => {
      const words = []; runs.forEach((r) => { String(r.t).split(/(\s+)/).forEach((p) => { if (p !== '') words.push({ t: p.replace(/\s+/g, ' '), b: forceBold || r.b }); }); });
      const lines = []; let line = [], lw = 0;
      words.forEach((w) => { const ww = tw(win(w.t), w.b, sz), sp = w.t === ' ';
        if (!sp && lw + ww > width && line.length) { while (line.length && line[line.length - 1].t === ' ') line.pop(); lines.push(line); line = []; lw = 0; }
        if (sp && !line.length) return; line.push(w); lw += ww; });
      while (line.length && line[line.length - 1].t === ' ') line.pop(); if (line.length) lines.push(line); return lines.length ? lines : [[]];
    };
    const drawLine = (ln, x, yy, sz, col, align, width) => {
      const total = ln.reduce((s, w) => s + tw(win(w.t), w.b, sz), 0); let cx = align === 'right' ? x + width - total : x;
      let seg = '', sb = null, sx = cx; const flush = () => { if (seg) put(sx, yy, seg, sb, sz, col); seg = ''; };
      ln.forEach((w) => { if (sb !== null && !!w.b !== !!sb) { flush(); sx = cx; } if (!seg) sx = cx; sb = !!w.b; seg += w.t; cx += tw(win(w.t), w.b, sz); }); flush();
    };
    const paragraph = (text, sz, o2) => {
      o2 = o2 || {}; const ind = o2.indent || 0, lines = wrapRuns(parseInline(text), AW - ind, sz, o2.bold), lh = sz * 1.35;
      lines.forEach((ln, k) => { need(lh); y -= lh; if (o2.bullet && k === 0) put(M + ind - 12, y, o2.bullet, false, sz); drawLine(ln, M + ind, y, sz, o2.color, null, AW - ind); });
      y -= o2.after != null ? o2.after : 5;
    };
    newPage(); let firstH = true;
    blocks.forEach((b) => {
      if (b.t === 'h') { const sz = b.l === 1 ? 20 : b.l === 2 ? 15 : 12.5; need(sz * 2.2); y -= sz * 0.5; paragraph(b.text, sz, { bold: true, color: GREEN, after: 3 }); if (b.l === 1) { cur.push(`${GREEN} RG 1.5 w ${M} ${(y + 1).toFixed(1)} m ${(PW - M).toFixed(1)} ${(y + 1).toFixed(1)} l S`); y -= 6; } firstH = false; }
      else if (b.t === 'p') paragraph(b.text, 10.5);
      else if (b.t === 'ul') b.items.forEach((it) => paragraph(it, 10.5, { indent: 18, bullet: '\u2022', after: 2 }));
      else if (b.t === 'ol') b.items.forEach((it, n) => paragraph(it, 10.5, { indent: 22, bullet: (n + 1) + '.', after: 2 }));
      else if (b.t === 'quote') paragraph(b.text, 10.5, { indent: 14, color: '0.25 0.3 0.35' });
      else if (b.t === 'code') b.text.split('\n').forEach((l) => paragraph(l || ' ', 9, { indent: 8, after: 0 }));
      else if (b.t === 'hr') { need(12); y -= 6; cur.push(`0.7 G 0.8 w ${M} ${y.toFixed(1)} m ${(PW - M).toFixed(1)} ${y.toFixed(1)} l S`); y -= 6; }
      else if (b.t === 'pb') newPage();
      else if (b.t === 'img') {
        const im = imgs[b.src] || imgs[String(b.src).split('/').pop()]; if (!im || !im.jpeg) { paragraph('[picha haipo: ' + b.src + ']', 9); return; }
        let w = Math.min(AW, im.w * 0.75), h = w * im.h / im.w; const maxH = (PH - 2 * M) * 0.55; if (h > maxH) { h = maxH; w = h * im.w / im.h; }
        need(h + 8); const n = imgObjs.push(im); y -= h; cur.push(`q ${w.toFixed(1)} 0 0 ${h.toFixed(1)} ${(M + (AW - w) / 2).toFixed(1)} ${y.toFixed(1)} cm /Im${n} Do Q`); y -= 10;
      } else if (b.t === 'table') {
        const nc = Math.max(b.head.length, ...b.rows.map((r) => r.length)), sz = nc > 9 ? 7.5 : nc > 6 ? 8.5 : 9.5, pad = 4;
        const clip = (t) => String(t == null ? '' : t); const natural = Array.from({ length: nc }, (_, c) => Math.min(190, Math.max(tw(win(plain(clip(b.head[c])).split(' ').sort((a, z) => z.length - a.length)[0] || ''), true, sz) + 2 * pad, ...b.rows.slice(0, 300).map((r) => Math.min(190, tw(win(plain(clip(r[c]))), false, sz) + 2 * pad)), 28)));
        let tot = natural.reduce((s, v) => s + v, 0), colw = natural.map((v) => v * AW / tot);
        const numc = Array.from({ length: nc }, (_, c) => b.rows.length > 0 && b.rows.every((r) => r[c] == null || r[c] === '' || !isNaN(toNum(r[c]))));
        const lh = sz * 1.3, rowLines = (r, hd) => Array.from({ length: nc }, (_, c) => wrapRuns(parseInline(clip(hd ? b.head[c] : r[c])), colw[c] - 2 * pad, sz, hd));
        const drawRow = (r, hd, zebra) => {
          const cellsL = rowLines(r, hd), h = Math.max(...cellsL.map((l) => l.length)) * lh + 2 * 2.5;
          if (y - h < M + 14) { newPage(); if (!hd) drawRow(null, true); }
          const top = y; if (hd) cur.push(`${GREEN} rg ${M} ${(top - h).toFixed(1)} ${AW.toFixed(1)} ${h.toFixed(1)} re f`); else if (zebra) cur.push(`0.96 0.97 0.98 rg ${M} ${(top - h).toFixed(1)} ${AW.toFixed(1)} ${h.toFixed(1)} re f`);
          let x = M; cellsL.forEach((ls, c) => { ls.forEach((ln, k) => drawLine(ln, x + pad, top - 2.5 - lh * (k + 1) + 2.5, sz, hd ? '1 1 1' : null, numc[c] && !hd ? 'right' : null, colw[c] - 2 * pad)); cur.push(`0.75 G 0.4 w ${x.toFixed(1)} ${(top - h).toFixed(1)} ${colw[c].toFixed(1)} ${h.toFixed(1)} re S`); x += colw[c]; });
          y = top - h;
        };
        y -= 3; drawRow(null, true); b.rows.forEach((r, i) => drawRow(r, false, i % 2)); y -= 8;
      }
    });
    // assemble
    const objs = []; const add = (s) => { objs.push(s); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>'); add(''); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imgIds = imgObjs.map((im) => add({ img: im })); const kids = [], total = pages.length;
    pages.forEach((p, i) => {
      const foot = `${win(o.footer || 'elapsAI - GPSA Kinondoni')}  |  Ukurasa ${i + 1} / ${total}`, fw = tw(foot, false, 8);
      const stream = p.join('\n') + `\nBT 0.42 0.45 0.5 rg /F1 8 Tf ${((PW - fw) / 2).toFixed(1)} ${(M - 18).toFixed(1)} Td (${pesc(foot)}) Tj ET`;
      const cid = add({ stream }); const xo = imgIds.map((id, k) => `/Im${k + 1} ${id} 0 R`).join(' ');
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xo} >> >> /Contents ${cid} 0 R >>`));
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const info = add(`<< /Title (${pesc(win(o.title || 'Ripoti'))}) /Producer (elapsAI) >>`);
    const parts = [enc.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]; let off = parts[0].length; const offs = [];
    objs.forEach((ob, i) => {
      let body; if (typeof ob === 'string') body = enc.encode(ob); else if (ob.stream != null) { const sb = Uint8Array.from(ob.stream, (c) => c.charCodeAt(0) & 255), pre = enc.encode(`<< /Length ${sb.length} >>\nstream\n`); body = cat([pre, sb, enc.encode('\nendstream')]); }
      else { const im = ob.img, pre = enc.encode(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.jpeg.length} >>\nstream\n`); body = cat([pre, im.jpeg, enc.encode('\nendstream')]); }
      const head = enc.encode(`${i + 1} 0 obj\n`), tail = enc.encode('\nendobj\n'); offs.push(off); const all = cat([head, body, tail]); parts.push(all); off += all.length;
    });
    const xr = off; let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((p) => String(p).padStart(10, '0') + ' 00000 n \n').join('');
    x += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xr}\n%%EOF`; parts.push(enc.encode(x)); return cat(parts);
  }

  // ---------- Charts (SVG) ----------
  const PAL = ['#16a34a', '#2563eb', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569'];
  const fmtC = (v) => { const a = Math.abs(v); const f = (x, s) => (Math.round(x * 10) / 10).toString().replace(/\.0$/, '') + s; return a >= 1e9 ? f(v / 1e9, 'B') : a >= 1e6 ? f(v / 1e6, 'M') : a >= 1e4 ? f(v / 1e3, 'k') : (Math.round(v * 100) / 100).toLocaleString('en-US'); };
  const fmtF = (v) => (Math.round(v * 100) / 100).toLocaleString('en-US');
  function niceScale(min, max, n) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; } if (min === max) max = min + 1; const step0 = (max - min) / (n || 5), mag = Math.pow(10, Math.floor(Math.log10(step0))), nr = step0 / mag;
    const step = (nr < 1.5 ? 1 : nr < 3 ? 2 : nr < 7 ? 5 : 10) * mag, lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, t = []; for (let v = lo; v <= hi + step / 2; v += step) t.push(Math.round(v / step) * step); return { lo, hi, ticks: t };
  }
  function chartSvg(o) {
    const type = o.type || 'bar', labels = (o.labels || []).map(String); let series = (o.series || []).map((s, i) => ({ name: String(s.name || ('Series ' + (i + 1))), values: (s.values || []).map((v) => { const n = toNum(v); return isNaN(n) ? 0 : n; }) }));
    if (!series.length || !series.some((s) => s.values.length)) throw new Error('Hakuna data ya kuchora chati.');
    const n = Math.max(labels.length, ...series.map((s) => s.values.length)); while (labels.length < n) labels.push(String(labels.length + 1));
    const W = o.width || 900; let H = o.height || 520; if (type === 'hbar') H = Math.max(H, 110 + n * 30);
    const title = o.title ? String(o.title) : '', trunc = (s, k) => s.length > k ? s.slice(0, k - 1) + '\u2026' : s, fm = o.fullNumbers ? fmtF : fmtC;
    const T = (x, y, s, a) => `<text x="${x}" y="${y}" font-size="${a.sz || 12}" fill="${a.fill || '#374151'}" text-anchor="${a.anchor || 'start'}"${a.bold ? ' font-weight="bold"' : ''}${a.rot ? ` transform="rotate(${a.rot} ${x} ${y})"` : ''}>${xe(s)}</text>`;
    let g = '', top = title ? 54 : 18;
    if (title) g += T(W / 2, 32, title, { sz: 19, anchor: 'middle', bold: 1, fill: '#166534' });
    const pie = type === 'pie' || type === 'donut';
    if (!pie && series.length > 1) { let lx = 0; const widths = series.map((s) => 26 + s.name.length * 7), tot = widths.reduce((a, b) => a + b, 0); lx = Math.max(10, (W - tot) / 2); series.forEach((s, i) => { g += `<rect x="${lx}" y="${top - 2}" width="13" height="13" rx="2" fill="${PAL[i % PAL.length]}"/>` + T(lx + 18, top + 9, s.name, { sz: 12 }); lx += widths[i]; }); top += 26; }
    if (pie) {
      let items = labels.map((l, i) => ({ l, v: Math.max(0, series[0].values[i] || 0) })).filter((x) => x.v > 0); if (items.length > 10) { const rest = items.slice(9).reduce((a, x) => a + x.v, 0); items = items.slice(0, 9).concat([{ l: 'Nyingine', v: rest }]); }
      const tot = items.reduce((a, x) => a + x.v, 0); if (!tot) throw new Error('Thamani zote ni sifuri.');
      const cx = W * 0.3, cy = top + (H - top) / 2, r = Math.min(W * 0.26, (H - top) / 2 - 16); let a0 = -Math.PI / 2;
      items.forEach((it, i) => { const a1 = a0 + it.v / tot * 2 * Math.PI, big = a1 - a0 > Math.PI ? 1 : 0, c = PAL[i % PAL.length];
        if (items.length === 1) g += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`; else g += `<path d="M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${big} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z" fill="${c}" stroke="#fff" stroke-width="2"/>`;
        const ly = top + 14 + i * 26; g += `<rect x="${W * 0.6}" y="${ly}" width="14" height="14" rx="2" fill="${c}"/>` + T(W * 0.6 + 22, ly + 12, trunc(it.l, 26) + '  -  ' + fm(it.v) + '  (' + (it.v / tot * 100).toFixed(1) + '%)', { sz: 13 }); a0 = a1; });
      if (type === 'donut') g += `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#fff"/>` + T(cx, cy - 2, fm(tot), { sz: 20, anchor: 'middle', bold: 1, fill: '#111827' }) + T(cx, cy + 18, o.totalLabel || 'Jumla', { sz: 12, anchor: 'middle', fill: '#6b7280' });
    } else if (type === 'hbar') {
      const lw = Math.min(190, Math.max(...labels.map((l) => trunc(l, 28).length)) * 6.8 + 12), L = lw + 10, R = 70, plotW = W - L - R, bot = 30, ph = H - top - bot, band = ph / n;
      const stacked = !!o.stacked, maxV = Math.max(...(stacked ? labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0)) : series.flatMap((s) => s.values)), 0), sc = niceScale(0, maxV, 5), xs = (v) => L + (v - sc.lo) / (sc.hi - sc.lo) * plotW;
      sc.ticks.forEach((t) => { g += `<line x1="${xs(t)}" y1="${top}" x2="${xs(t)}" y2="${top + ph}" stroke="#e5e7eb"/>` + T(xs(t), top + ph + 18, fm(t), { sz: 11, anchor: 'middle', fill: '#6b7280' }); });
      labels.forEach((l, i) => { const cy = top + band * i; g += T(L - 8, cy + band / 2 + 4, trunc(l, 28), { sz: 12, anchor: 'end' }); const bh = stacked ? band * 0.62 : band * 0.7 / series.length; let acc = 0;
        series.forEach((s, k) => { const v = s.values[i] || 0; if (stacked) { const x0 = xs(acc), x1 = xs(acc + Math.max(0, v)); g += `<rect x="${x0}" y="${cy + band * 0.19}" width="${Math.max(0, x1 - x0)}" height="${bh}" fill="${PAL[k % PAL.length]}"/>`; acc += Math.max(0, v); } else { const y0 = cy + band * 0.15 + k * bh; g += `<rect x="${L}" y="${y0}" width="${Math.max(0, xs(v) - L)}" height="${bh - 2}" rx="2" fill="${PAL[k % PAL.length]}"/>` + T(xs(v) + 5, y0 + bh / 2 + 3, fm(v), { sz: 11 }); } });
        if (stacked) g += T(xs(acc) + 5, cy + band / 2 + 4, fm(acc), { sz: 11 }); });
      g += `<line x1="${L}" y1="${top}" x2="${L}" y2="${top + ph}" stroke="#9ca3af"/>`;
    } else {
      const L0 = 64, R = 24, rot = n > 10 || Math.max(...labels.map((l) => l.length)) > 9, bot = rot ? 96 : 52, stacked = !!o.stacked && series.length > 1;
      let minV = Math.min(0, ...series.flatMap((s) => s.values)), maxV = Math.max(...(stacked ? labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0)) : series.flatMap((s) => s.values)), 0.0001);
      const sc = niceScale(minV, maxV, 5), tl = Math.max(...sc.ticks.map((t) => fm(t).length)) * 7 + 14, L = Math.max(L0, tl + 12), plotW = W - L - R, ph = H - top - bot, band = plotW / n, ys = (v) => top + ph - (v - sc.lo) / (sc.hi - sc.lo) * ph;
      sc.ticks.forEach((t) => { g += `<line x1="${L}" y1="${ys(t)}" x2="${W - R}" y2="${ys(t)}" stroke="${t === 0 ? '#9ca3af' : '#e5e7eb'}"/>` + T(L - 8, ys(t) + 4, fm(t), { sz: 11, anchor: 'end', fill: '#6b7280' }); });
      if (o.yTitle) g += T(16, top + ph / 2, o.yTitle, { sz: 12, anchor: 'middle', rot: -90, fill: '#6b7280' });
      if (o.xTitle) g += T(L + plotW / 2, H - 8, o.xTitle, { sz: 12, anchor: 'middle', fill: '#6b7280' });
      labels.forEach((l, i) => { const x = L + band * (i + 0.5), ly = top + ph + 16; if (rot) g += T(x + 4, ly, trunc(l, 16), { sz: 11, anchor: 'end', rot: -40 }); else g += T(x, ly, trunc(l, 12), { sz: 12, anchor: 'middle' }); });
      if (type === 'line' || type === 'area') {
        series.forEach((s, k) => { const c = PAL[k % PAL.length], pts = s.values.map((v, i) => [L + band * (i + 0.5), ys(v)]); if (type === 'area') g += `<path d="M${pts[0][0]},${ys(0)} ${pts.map((p) => 'L' + p[0] + ',' + p[1]).join(' ')} L${pts[pts.length - 1][0]},${ys(0)} Z" fill="${c}" opacity="0.15"/>`;
          g += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>`; if (n <= 40) pts.forEach((p, i) => { g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${c}"/>`; if (n <= 14 && series.length <= 2) g += T(p[0], p[1] - 9, fm(s.values[i]), { sz: 10.5, anchor: 'middle' }); }); });
      } else {
        const gw = band * 0.78, bw = stacked ? gw : gw / series.length;
        labels.forEach((_, i) => { let acc = 0; series.forEach((s, k) => { const v = s.values[i] || 0, c = PAL[k % PAL.length], x = L + band * i + (band - gw) / 2 + (stacked ? 0 : k * bw);
          if (stacked) { const y0 = ys(acc), y1 = ys(acc + Math.max(0, v)); g += `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1)}" fill="${c}"/>`; acc += Math.max(0, v); }
          else { const y0 = ys(0), y1 = ys(v); g += `<rect x="${x}" y="${Math.min(y0, y1)}" width="${Math.max(1, bw - 1)}" height="${Math.abs(y0 - y1)}" rx="2" fill="${c}"/>`; if (n * series.length <= 30 && bw > 16) g += T(x + bw / 2, (v >= 0 ? y1 - 5 : y1 + 12), fm(v), { sz: 10.5, anchor: 'middle' }); } });
          if (stacked && n <= 24) g += T(L + band * (i + 0.5), ys(acc) - 5, fm(acc), { sz: 10.5, anchor: 'middle' }); });
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif"><rect width="${W}" height="${H}" fill="#ffffff"/>${g}</svg>`;
  }
  function sanitizeSvg(svg) {
    let s = String(svg || '').trim(); const i = s.search(/<svg[\s>]/i); if (i < 0) throw new Error('Hii si SVG halali (haina <svg>).'); s = s.slice(i);
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '').replace(/<!ENTITY[^>]*>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/(xlink:)?href\s*=\s*("|')(?!#|data:image\/)[^"']*\2/gi, '');
    const head = /<svg\b[^>]*>/i.exec(s)[0]; let nh = head; if (!/xmlns=/.test(nh)) nh = nh.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    const wm = /\bwidth="([\d.]+)(px)?"/.exec(nh), hm = /\bheight="([\d.]+)(px)?"/.exec(nh);
    if (!/viewBox=/.test(nh)) { const w = wm ? +wm[1] : 800, h = hm ? +hm[1] : 600; nh = nh.replace('<svg', `<svg viewBox="0 0 ${w} ${h}"`); if (!wm) nh = nh.replace('<svg', `<svg width="${w}"`); if (!hm) nh = nh.replace('<svg', `<svg height="${h}"`); }
    return s.replace(head, nh);
  }
  function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Picha/SVG haikuweza kusomwa (angalia kama SVG ni sahihi).')); im.src = src; }); }
  const canvasBytes = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => b ? b.arrayBuffer().then((a) => res(new Uint8Array(a))) : rej(new Error('Canvas haikutoa picha.')), type, q));
  async function svgToPng(svg, scale) {
    scale = scale || 2; svg = sanitizeSvg(svg); const m = /viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/.exec(svg), w = Math.round(+m[1]), h = Math.round(+m[2]);
    const im = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)), c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
    return { bytes: await canvasBytes(c, 'image/png'), w: c.width, h: c.height };
  }
  async function pngToJpeg(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); try { const im = await loadImg(url), c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0); return { jpeg: await canvasBytes(c, 'image/jpeg', 0.92), w: c.width, h: c.height }; } finally { URL.revokeObjectURL(url); }
  }
  const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', csv: 'text/csv;charset=utf-8', html: 'text/html;charset=utf-8', txt: 'text/plain;charset=utf-8', md: 'text/markdown;charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', zip: 'application/zip' };

  const api = { zip, unzip, xlsx, readXlsx, readDocxText, gridToObjects, parseCsv, csv, smartTypes, parseMd, parseInline, plain, docx, pdf, htmlDoc, chartSvg, sanitizeSvg, svgToPng, pngToJpeg, toNum, isNum, fmtNum: fmtF, fmtCompact: fmtC, MIME, u8, enc, dec, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GpsaFiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
