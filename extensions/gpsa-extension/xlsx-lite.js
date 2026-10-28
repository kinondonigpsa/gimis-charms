// Very small, dependency-free XLSX reader for the browser.
// Reads just enough of the OOXML/ZIP format to pull out the first
// worksheet's rows as an array of arrays, using column headers to
// build objects. Relies on the native DecompressionStream("deflate-raw")
// API (no external library, no network fetch of any script).
window.GimisXlsxLite = (function () {
  function base64ToBytes(b64) {
    if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(b64);
    const bin = atob(b64);
    const n = bin.length;
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function readUInt32LE(bytes, offset) {
    return (
      bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)
    ) >>> 0;
  }
  function readUInt16LE(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  // Find End Of Central Directory record (search from the end).
  function findEOCD(bytes) {
    const sig = 0x06054b50;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (readUInt32LE(bytes, i) === sig) return i;
    }
    throw new Error("EOCD not found - not a valid zip/xlsx file");
  }

  // Parse the central directory into a map: fileName -> {offset, compSize, method}
  function parseCentralDirectory(bytes) {
    const eocd = findEOCD(bytes);
    const entryCount = readUInt16LE(bytes, eocd + 10);
    let cdOffset = readUInt32LE(bytes, eocd + 16);
    const entries = {};
    for (let i = 0; i < entryCount; i++) {
      const sig = readUInt32LE(bytes, cdOffset);
      if (sig !== 0x02014b50) break; // central dir file header sig
      const method = readUInt16LE(bytes, cdOffset + 10);
      const compSize = readUInt32LE(bytes, cdOffset + 20);
      const nameLen = readUInt16LE(bytes, cdOffset + 28);
      const extraLen = readUInt16LE(bytes, cdOffset + 30);
      const commentLen = readUInt16LE(bytes, cdOffset + 32);
      const localHeaderOffset = readUInt32LE(bytes, cdOffset + 42);
      const nameBytes = bytes.slice(cdOffset + 46, cdOffset + 46 + nameLen);
      const name = new TextDecoder().decode(nameBytes);
      entries[name] = { localHeaderOffset, compSize, method };
      cdOffset += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  // Given a local-file-header offset, return the raw compressed data slice.
  function getCompressedData(bytes, entry) {
    const off = entry.localHeaderOffset;
    const nameLen = readUInt16LE(bytes, off + 26);
    const extraLen = readUInt16LE(bytes, off + 28);
    const dataStart = off + 30 + nameLen + extraLen;
    return bytes.slice(dataStart, dataStart + entry.compSize);
  }

  async function inflate(compressed) {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([compressed]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function readEntryAsText(bytes, entries, name) {
    const entry = entries[name];
    if (!entry) return null;
    const compressed = getCompressedData(bytes, entry);
    let raw;
    if (entry.method === 0) {
      raw = compressed; // stored, no compression
    } else {
      raw = await inflate(compressed);
    }
    return new TextDecoder("utf-8").decode(raw);
  }

  const ENTITY_RE = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;
  function decodeEntities(str) {
    if (str.indexOf("&") === -1) return str;
    return str.replace(ENTITY_RE, (m, e) => {
      switch (e) {
        case "amp": return "&";
        case "lt": return "<";
        case "gt": return ">";
        case "quot": return '"';
        case "apos": return "'";
      }
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    });
  }

  // Concatenate the text of every <t>...</t> inside an XML fragment.
  function collectText(xml) {
    const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
    let out = "";
    let m;
    while ((m = re.exec(xml)) !== null) if (m[1]) out += m[1];
    return decodeEntities(out);
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    const list = [];
    const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
    let m;
    while ((m = re.exec(xml)) !== null) list.push(m[1] ? collectText(m[1]) : "");
    return list;
  }

  function colLettersToIndex(letters) {
    let idx = 0;
    for (let i = 0; i < letters.length; i++) {
      idx = idx * 26 + (letters.charCodeAt(i) - 64);
    }
    return idx - 1; // 0-based
  }

  // Excel serial date -> JS Date (assumes 1900 date system, ignoring the
  // 1900 leap-year bug the same way Excel itself does).
  function excelSerialToDate(serial) {
    const utcDays = Math.floor(serial - 25569);
    const utcMs = utcDays * 86400 * 1000;
    return new Date(utcMs);
  }

  // Regex-based sheet reader: much faster than building a full DOM for a big sheet.
  function parseSheetRows(xml, sharedStrings) {
    const rows = [];
    const rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    const refRe = /\br="([A-Z]+)[0-9]*"/;
    const typeRe = /\bt="([^"]*)"/;
    const vRe = /<v>([\s\S]*?)<\/v>/;
    let rm;
    while ((rm = rowRe.exec(xml)) !== null) {
      const row = [];
      const inner = rm[1];
      if (inner) {
        cellRe.lastIndex = 0;
        let cm;
        let seq = 0;
        while ((cm = cellRe.exec(inner)) !== null) {
          const attrs = cm[1];
          const body = cm[2] || "";
          const refM = refRe.exec(attrs);
          const colIdx = refM ? colLettersToIndex(refM[1]) : seq;
          seq = colIdx + 1;
          const typeM = typeRe.exec(attrs);
          const type = typeM ? typeM[1] : null;
          let value = "";
          if (type === "inlineStr") {
            value = collectText(body);
          } else {
            const vM = vRe.exec(body);
            value = vM ? vM[1] : "";
            if (type === "s") {
              value = sharedStrings[parseInt(value, 10)] || "";
            } else if (type === "str") {
              value = decodeEntities(value); // formula result string
            } else if (value !== "" && !isNaN(value)) {
              value = parseFloat(value);
            }
          }
          row[colIdx] = value;
        }
      }
      rows.push(row);
    }
    return rows;
  }

  // Public: parse a base64 XLSX string into an array of objects, using
  // whichever row contains a cell literally equal to headerHint as the
  // header row (default "Sno", matching the GIMIS report format).
  async function parseXlsxBase64(base64, headerHint) {
    headerHint = headerHint || "Sno";
    const bytes = base64ToBytes(base64);
    const entries = parseCentralDirectory(bytes);

    const sheetNames = Object.keys(entries).filter((n) =>
      /^xl\/worksheets\/sheet\d+\.xml$/.test(n)
    ).sort();
    if (sheetNames.length === 0) throw new Error("No worksheet found in xlsx");

    const [sharedStringsXml, sheetXml] = await Promise.all([
      readEntryAsText(bytes, entries, "xl/sharedStrings.xml"),
      readEntryAsText(bytes, entries, sheetNames[0]),
    ]);
    const sharedStrings = parseSharedStrings(sharedStringsXml);
    const rows = parseSheetRows(sheetXml, sharedStrings);

    function norm(v) {
      return typeof v === "string" ? v.trim().toLowerCase() : v;
    }
    const wantedHeader = norm(headerHint);
    let headerRowIdx = -1;
    let headerRow = null;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].some((v) => norm(v) === wantedHeader)) {
        headerRowIdx = i;
        headerRow = rows[i];
        break;
      }
    }
    if (headerRowIdx === -1) {
      // Fallback: pick the row with the most non-empty string-looking cells
      let bestIdx = -1;
      let bestScore = 0;
      rows.forEach((row, i) => {
        if (!row) return;
        const score = row.filter((v) => typeof v === "string" && v.trim() !== "").length;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      });
      if (bestIdx !== -1 && bestScore >= 3) {
        headerRowIdx = bestIdx;
        headerRow = rows[bestIdx];
      } else {
        throw new Error(
          "Header row not found (looked for '" + headerHint + "'). Try refreshing the data and search again."
        );
      }
    }
    // Normalize header cell text (trim) so keys match exactly what the rest
    // of the code expects (e.g. "Means Of Transprot").
    headerRow = headerRow.map((h) => (typeof h === "string" ? h.trim() : h));

    // Match any header that looks like a date column (not just the exact
    // string "Issue Date"), so this keeps working even if GIMIS renames or
    // adds date-like columns, and handles the value arriving as a raw
    // Excel serial number, a numeric-looking string, or an already
    // formatted date string.
    function isDateHeader(h) {
      return typeof h === "string" && /date/i.test(h);
    }

    const dateCols = headerRow.map(isDateHeader);
    const records = [];
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((v) => v === undefined || v === "")) continue;
      const record = {};
      headerRow.forEach((h, colIdx) => {
        if (!h) return;
        let value = row[colIdx];
        if (dateCols[colIdx] && value !== undefined && value !== "") {
          if (typeof value === "number") {
            value = excelSerialToDate(value);
          } else if (typeof value === "string") {
            const trimmed = value.trim();
            if (/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) {
              // Numeric Excel serial that came through as a string
              // (e.g. a formula result stored with type "str").
              value = excelSerialToDate(parseFloat(trimmed));
            } else {
              const parsed = new Date(trimmed);
              if (!isNaN(parsed.getTime())) value = parsed;
              // otherwise leave the original string so it still shows
              // something rather than going blank.
            }
          }
        }
        record[h] = value;
      });
      records.push(record);
    }
    return records;
  }

  return { parseXlsxBase64: parseXlsxBase64 };
})();
