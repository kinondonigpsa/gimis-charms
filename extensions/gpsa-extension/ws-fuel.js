(function () {
  const STORAGE_TOKEN_KEY = "gimisFuelToken";

  // Fixed to GPSA KINONDONI fuel scope (confirmed live from DevTools, Sep 2026)
  const ADMINISTRATIVE_AREA_UUID = "81deacc1-5bd3-4966-82e7-734d8548c208"; // DAR ES SALAAM
  const SHOP_STORE_UUIDS = ["d999e7cc-9eef-4629-a904-9cd689c74f3f"]; // GPSA KINONDONI

  // 1. Receive the live access_token captured by inject.js
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data && data.source === "gimis-plus" && data.type === "TOKEN") {
      chrome.storage.local.set({ [STORAGE_TOKEN_KEY]: data.token });
    }
  });

  async function getToken() {
    const stored = await chrome.storage.local.get(STORAGE_TOKEN_KEY);
    return stored[STORAGE_TOKEN_KEY] || null;
  }

  async function graphqlRequest(token, operationName, query, variables) {
    const res = await fetch(`/api/graphql?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operationName, query, variables }),
      credentials: "include",
    });
    if (!res.ok) throw new Error("Request failed (HTTP " + res.status + ")");
    const json = await res.json();
    if (json.errors && json.errors.length) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }
    return json.data;
  }

  // ---------------------------------------------------------------------
  // The single GraphQL call this whole extension now depends on. GIMIS's
  // own "Inventory Reports > Depot LPO Report" already computes Qty
  // Ordered, Qty Received and a ready-made Status (RECEIVED / PARTIAL
  // RECEIVED / NOT RECEIVED) per LPO item, so there is no need to stitch
  // that together ourselves from separate committee/DTCV/dispatch calls.
  // ---------------------------------------------------------------------

  const DEPOT_LPO_REPORT_QUERY = `query getLpoFilteredByDepotsReport($fromDate: LocalDate, $shopStoreUuids: [String], $exportDocType: ExportDocType, $toDate: LocalDate, $administrativeAreaUuid: String, $itemGroupType: ItemGroupType, $supplierUuid: String, $itemGroupUuid: String, $itemUuid: String) {
  getLpoFilteredByDepotsReport(
    fromDate: $fromDate
    shopStoreUuids: $shopStoreUuids
    exportDocType: $exportDocType
    toDate: $toDate
    administrativeAreaUuid: $administrativeAreaUuid
    itemGroupType: $itemGroupType
    supplierUuid: $supplierUuid
    itemGroupUuid: $itemGroupUuid
    itemUuid: $itemUuid
  ) {
    code
    data
  }
}`;

  async function fetchDepotLpoReportBase64(token, fromDate, toDate) {
    const variables = {
      fromDate,
      toDate,
      shopStoreUuids: SHOP_STORE_UUIDS,
      administrativeAreaUuid: ADMINISTRATIVE_AREA_UUID,
      itemGroupType: "Fuel",
      exportDocType: "XLSX",
      supplierUuid: null,
      itemGroupUuid: null,
      itemUuid: null,
    };
    const data = await graphqlRequest(
      token,
      "getLpoFilteredByDepotsReport",
      DEPOT_LPO_REPORT_QUERY,
      variables
    );
    const block = data.getLpoFilteredByDepotsReport;
    if (!block || !block.data) throw new Error("The report returned no data.");
    return block.data; // base64-encoded XLSX
  }

  // ---------------------------------------------------------------------
  // Minimal in-browser XLSX reader: unzip the one worksheet entry we need
  // and read its inline-string / numeric cells. No external library - the
  // browser's native DecompressionStream("deflate-raw") does the DEFLATE
  // work that a ZIP/XLSX file uses internally.
  // ---------------------------------------------------------------------

  function base64ToBytes(base64) {
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    return bytes;
  }

  // Reads a named entry out of a ZIP (XLSX) archive via its Central
  // Directory rather than by walking Local File Headers sequentially.
  // Some ZIP writers (including GIMIS's server-side export) do not put a
  // reliable compressed size in the Local File Header - the Central
  // Directory at the end of the archive is the only place that size is
  // guaranteed correct, so that is what we trust for the byte range.
  async function extractZipEntryText(bytes, entryName) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder();

    const EOCD_SIG = 0x06054b50;
    let eocdOffset = -1;
    const minPos = Math.max(0, bytes.length - 65557); // max comment length + record size
    for (let i = bytes.length - 22; i >= minPos; i--) {
      if (dv.getUint32(i, true) === EOCD_SIG) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) {
      throw new Error("ZIP End-of-Central-Directory record not found - this is not a valid xlsx file.");
    }

    const cdSize = dv.getUint32(eocdOffset + 12, true);
    const cdOffset = dv.getUint32(eocdOffset + 16, true);
    const CD_SIG = 0x02014b50;
    let pos = cdOffset;
    const cdEnd = cdOffset + cdSize;

    while (pos + 46 <= cdEnd && dv.getUint32(pos, true) === CD_SIG) {
      const compMethod = dv.getUint16(pos + 10, true);
      const compSize = dv.getUint32(pos + 20, true);
      const nameLen = dv.getUint16(pos + 28, true);
      const extraLen = dv.getUint16(pos + 30, true);
      const commentLen = dv.getUint16(pos + 32, true);
      const localHeaderOffset = dv.getUint32(pos + 42, true);
      const nameStart = pos + 46;
      const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen));

      if (name === entryName) {
        // The Local File Header's own name/extra lengths tell us exactly
        // where its compressed data starts (these can differ slightly from
        // the Central Directory copy).
        const lhNameLen = dv.getUint16(localHeaderOffset + 26, true);
        const lhExtraLen = dv.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
        const chunk = bytes.subarray(dataStart, dataStart + compSize);
        if (compMethod === 0) return decoder.decode(chunk);
        if (compMethod === 8) {
          const stream = new Blob([chunk]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
          const buf = await new Response(stream).arrayBuffer();
          return decoder.decode(buf);
        }
        throw new Error("Unrecognized compression method (" + compMethod + ").");
      }
      pos = nameStart + nameLen + extraLen + commentLen;
    }
    return null;
  }

  function colLetterToIndex(letters) {
    let idx = 0;
    for (let i = 0; i < letters.length; i++) idx = idx * 26 + (letters.charCodeAt(i) - 64);
    return idx - 1;
  }

  function parseSheetXmlToGrid(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const rowEls = Array.from(doc.getElementsByTagName("row"));
    const grid = [];
    for (const rowEl of rowEls) {
      const cellEls = Array.from(rowEl.getElementsByTagName("c"));
      const rowArr = [];
      for (const c of cellEls) {
        const ref = c.getAttribute("r") || "";
        const colIdx = colLetterToIndex(ref.replace(/[0-9]/g, ""));
        const t = c.getAttribute("t");
        let value = "";
        if (t === "inlineStr") {
          const isEl = c.getElementsByTagName("is")[0];
          value = isEl ? (isEl.textContent || "").trim() : "";
        } else {
          const vEl = c.getElementsByTagName("v")[0];
          value = vEl ? vEl.textContent : "";
        }
        rowArr[colIdx] = value;
      }
      grid.push(rowArr);
    }
    return grid;
  }

  const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
  function excelSerialToDate(serial) {
    const n = Number(serial);
    if (!isFinite(n)) return null;
    return new Date(EXCEL_EPOCH_MS + n * 86400000);
  }

  // ---------------------------------------------------------------------
  // Turn the raw spreadsheet grid into clean row objects, by matching
  // header text rather than a fixed row/column index (the report has a
  // title block above the real header row, and its position can shift).
  // ---------------------------------------------------------------------

  const COLUMN_ALIASES = {
    supplier: ["supplier name", "supplier"],
    depot: ["depot"],
    transport: ["transport"],
    reqNo: ["req no", "requisition"],
    item: ["item"],
    lpoNumber: ["lpo number"],
    lpoDate: ["lpo date"],
    expDeliver: ["exp deliver", "expected deliver"],
    qtyOrdered: ["qty ordered"],
    qtyReceived: ["qty received"],
    unitPrice: ["unit price"],
    receivedValue: ["received qty value"],
    lpoValue: ["lpo value"],
    invoiceNo: ["invoice no"],
    invoiceDate: ["invoice date"],
    status: ["status"],
  };

  function normalizeHeader(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function findHeaderRow(grid) {
    for (let i = 0; i < grid.length; i++) {
      const row = grid[i] || [];
      const normalized = row.map(normalizeHeader);
      if (normalized.some((c) => c === "lpo number") && normalized.some((c) => c.indexOf("qty ordered") !== -1)) {
        return i;
      }
    }
    return -1;
  }

  function gridToReportRows(grid) {
    const headerIdx = findHeaderRow(grid);
    if (headerIdx === -1) throw new Error("Table headers could not be found in the returned report.");
    const headerRow = grid[headerIdx];
    const colMap = {};
    headerRow.forEach((cell, idx) => {
      const norm = normalizeHeader(cell);
      if (!norm) return;
      for (const key in COLUMN_ALIASES) {
        if (colMap[key] !== undefined) continue;
        if (COLUMN_ALIASES[key].some((alias) => norm.indexOf(alias) !== -1)) colMap[key] = idx;
      }
    });

    const rows = [];
    for (let i = headerIdx + 1; i < grid.length; i++) {
      const row = grid[i];
      if (!row || row.every((c) => c === undefined || c === "")) continue;
      const get = (key) => (colMap[key] !== undefined ? row[colMap[key]] : "");
      const lpoNumber = get("lpoNumber");
      if (!lpoNumber) continue; // skip stray/total/footer rows
      rows.push({
        supplier: get("supplier"),
        depot: get("depot"),
        transport: get("transport"),
        reqNo: get("reqNo"),
        item: get("item"),
        lpoNumber,
        lpoDate: get("lpoDate"),
        expDeliver: get("expDeliver"),
        qtyOrdered: get("qtyOrdered"),
        qtyReceived: get("qtyReceived"),
        unitPrice: get("unitPrice"),
        receivedValue: get("receivedValue"),
        lpoValue: get("lpoValue"),
        invoiceNo: get("invoiceNo"),
        invoiceDate: get("invoiceDate"),
        status: get("status"),
      });
    }
    return rows;
  }

  async function fetchAndParseReportRows(token, fromDate, toDate) {
    const base64 = await fetchDepotLpoReportBase64(token, fromDate, toDate);
    const bytes = base64ToBytes(base64);
    const sheetXml = await extractZipEntryText(bytes, "xl/worksheets/sheet1.xml");
    if (!sheetXml) throw new Error("xl/worksheets/sheet1.xml was not found inside the report.");
    const grid = parseSheetXmlToGrid(sheetXml);
    return gridToReportRows(grid);
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  function esc(v) {
    return v === undefined || v === null ? "" : String(v);
  }

  function fmtMaybeDate(raw) {
    if (raw === undefined || raw === null || raw === "") return "";
    const num = Number(raw);
    if (isFinite(num) && num > 20000 && num < 60000) {
      const d = excelSerialToDate(num);
      if (d) return d.toLocaleDateString();
    }
    return esc(raw);
  }

  function fmtNumber(raw) {
    if (raw === undefined || raw === null || raw === "") return "";
    const num = Number(raw);
    return isFinite(num) ? num.toLocaleString() : esc(raw);
  }

  function statusBadgeClass(status) {
    const s = normalizeHeader(status);
    if (s.indexOf("not receive") !== -1) return "gfs-badge-red";
    if (s.indexOf("partial") !== -1) return "gfs-badge-orange";
    if (s.indexOf("receive") !== -1) return "gfs-badge-green";
    return "gfs-badge-grey";
  }

  function renderReportTable(container, rows) {
    if (rows.length === 0) {
      container.innerHTML = '<p class="gfs-empty">No fuel records were found for the selected date range.</p>';
      return;
    }
    const trs = rows
      .map(
        (r) => `<tr>
      <td>${esc(r.lpoNumber)}</td>
      <td>${esc(r.item)}</td>
      <td>${fmtMaybeDate(r.lpoDate)}</td>
      <td>${fmtMaybeDate(r.expDeliver)}</td>
      <td>${fmtNumber(r.qtyOrdered)}</td>
      <td>${fmtNumber(r.qtyReceived)}</td>
      <td>${fmtNumber(r.unitPrice)}</td>
      <td>${fmtNumber(r.lpoValue)}</td>
      <td><span class="gfs-status-badge ${statusBadgeClass(r.status)}">${esc(r.status)}</span></td>
      <td><button class="gfs-view" data-lpo="${esc(r.lpoNumber)}">Details</button></td>
    </tr>`
      )
      .join("");
    container.innerHTML = `
      <p class="gfs-count">Results: ${rows.length}</p>
      <div class="gfs-original-table-wrap">
        <table class="gfs-original-table">
          <thead><tr>
            <th>LPO No.</th><th>Item</th><th>LPO Date</th><th>Exp. Deliver</th>
            <th>Qty Ordered</th><th>Qty Received</th><th>Unit Price</th><th>LPO Value</th>
            <th>Status</th><th>Action</th>
          </tr></thead>
          <tbody>${trs}</tbody>
        </table>
      </div>`;
    container.querySelectorAll(".gfs-view").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = rows.find((r) => r.lpoNumber === btn.dataset.lpo);
        if (row) showRowDetails(row);
      });
    });
  }

  function showRowDetails(row) {
    const modal = document.createElement("div");
    modal.id = "gfs-detail-modal";
    modal.innerHTML = `
      <div class="gfs-modal-backdrop">
        <div class="gfs-modal" role="dialog" aria-modal="true">
          <div class="gfs-modal-header"><h2>LPO ${esc(row.lpoNumber)}</h2><button id="gfs-modal-close" aria-label="Close">✕</button></div>
          <div class="gfs-modal-body">
            <div class="gfs-original-section">
              <div class="gfs-section-title">LPO Details</div>
              <div class="gfs-info-grid">
                <div class="gfs-info-field"><div class="gfs-info-label">Supplier</div><div class="gfs-info-value">${esc(row.supplier)}</div></div>
                <div class="gfs-info-field"><div class="gfs-info-label">Depot</div><div class="gfs-info-value">${esc(row.depot)}</div></div>
                <div class="gfs-info-field"><div class="gfs-info-label">Transport</div><div class="gfs-info-value">${esc(row.transport)}</div></div>
                <div class="gfs-info-field"><div class="gfs-info-label">Req No.</div><div class="gfs-info-value">${esc(row.reqNo)}</div></div>
                <div class="gfs-info-field"><div class="gfs-info-label">Item</div><div class="gfs-info-value">${esc(row.item)}</div></div>
                <div class="gfs-info-field"><div class="gfs-info-label">LPO Date</div><div class="gfs-info-value">${fmtMaybeDate(row.lpoDate)}</div></div>
                <div class="gfs-info-field"><div class="gfs-info-label">Exp. Deliver</div><div class="gfs-info-value">${fmtMaybeDate(row.expDeliver)}</div></div>
                <div class="gfs-info-field"><div class="gfs-info-label">Qty Ordered</div><div class="gfs-info-value">${fmtNumber(row.qtyOrdered)}</div></div>
                <div class="gfs-info-field"><div class="gfs-info-label">Qty Received</div><div class="gfs-info-value">${fmtNumber(row.qtyReceived)}</div></div>
                <div class="gfs-info-field"><div class="gfs-info-label">Unit Price</div><div class="gfs-info-value">${fmtNumber(row.unitPrice)}</div></div>
                <div class="gfs-info-field"><div class="gfs-info-label">Received Qty Value</div><div class="gfs-info-value">${fmtNumber(row.receivedValue)}</div></div>
                <div class="gfs-info-field"><div class="gfs-info-label">LPO Value</div><div class="gfs-info-value">${fmtNumber(row.lpoValue)}</div></div>
                <div class="gfs-info-field"><div class="gfs-info-label">Invoice No.</div><div class="gfs-info-value">${esc(row.invoiceNo) || "-"}</div></div>
                <div class="gfs-info-field"><div class="gfs-info-label">Invoice Date</div><div class="gfs-info-value">${fmtMaybeDate(row.invoiceDate) || "-"}</div></div>
                <div class="gfs-info-field"><div class="gfs-info-label">Status</div><div class="gfs-info-value"><span class="gfs-status-badge ${statusBadgeClass(row.status)}">${esc(row.status)}</span></div></div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector("#gfs-modal-close").addEventListener("click", close);
    modal.querySelector(".gfs-modal-backdrop").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) close();
    });
  }

  // ---------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------

  function currentDateStr(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function buildUI() {
    const logoUrl = chrome.runtime.getURL("logo-icon.png");

    const toggle = document.createElement("button");
    toggle.id = "gfs-toggle";
    toggle.textContent = "GIMIS Fuel";
    document.body.appendChild(toggle);

    const panel = document.createElement("div");
    panel.id = "gfs-panel";
    panel.innerHTML = `
      <div class="gfs-header">
        <div class="gfs-header-left">
          <img class="gfs-logo" src="${logoUrl}" alt="e-LAPS" />
          <div class="gfs-title-block">
            <span class="gfs-title">Fuel Search - GPSA KINONDONI</span>
            <span class="gfs-powered">Powered By e-LAPS</span>
          </div>
        </div>
        <div class="gfs-header-actions">
          <button id="gfs-expand" title="Expand">⤢</button>
          <button id="gfs-close" title="Close">✕</button>
        </div>
      </div>
      <div class="gfs-body">
        <div class="gfs-daterow">
          <label>From</label>
          <input type="date" id="gfs-start" />
          <label>To</label>
          <input type="date" id="gfs-end" />
        </div>
        <div class="gfs-actions">
          <button id="gfs-search">Search</button>
        </div>
        <p id="gfs-status"></p>
        <div id="gfs-results"></div>
      </div>`;
    document.body.appendChild(panel);

    document.getElementById("gfs-end").value = currentDateStr(0);
    document.getElementById("gfs-start").value = currentDateStr(-30);

    toggle.addEventListener("click", () => panel.classList.toggle("gfs-open"));
    document.getElementById("gfs-close").addEventListener("click", () => panel.classList.remove("gfs-open"));

    const expandBtn = document.getElementById("gfs-expand");
    expandBtn.addEventListener("click", () => {
      const isExpanded = panel.classList.toggle("gfs-expanded");
      expandBtn.textContent = isExpanded ? "⤡" : "⤢";
    });

    async function doSearch() {
      const startVal = document.getElementById("gfs-start").value;
      const endVal = document.getElementById("gfs-end").value;
      const status = document.getElementById("gfs-status");
      const results = document.getElementById("gfs-results");
      results.innerHTML = "";
      if (!startVal || !endVal) {
        status.textContent = "Please select a start date and an end date.";
        return;
      }
      if (startVal > endVal) {
        status.textContent = "The start date cannot be later than the end date.";
        return;
      }
      const token = await getToken();
      if (!token) {
        status.textContent = "Access token not available yet. Open any GIMIS page and try again.";
        return;
      }
      try {
        status.textContent = "Loading report from GIMIS...";
        const rows = await fetchAndParseReportRows(token, startVal, endVal);
        status.textContent = "";
        renderReportTable(results, rows);
      } catch (err) {
        status.textContent = "Error: " + err.message;
      }
    }

    document.getElementById("gfs-search").addEventListener("click", doSearch);
  }

  if (document.body) {
    buildUI();
  } else {
    window.addEventListener("DOMContentLoaded", buildUI);
  }
})();
