(function () {
  const STORAGE_TOKEN_KEY = "gimisPlusToken";
  const STORAGE_CACHE_KEY = "gimisPlusReportCache"; // OLD single cache (removed automatically)
  const MONTH_PREFIX = "gimisPlusMonth_"; // one cache entry per calendar month: { fetchedAt, to, records }
  const CONCURRENCY = 4; // how many months are downloaded at the same time (lower it if GIMIS returns errors)
  const TTL_CLOSED_MONTH = 3 * 24 * 60 * 60 * 1000; // finished months: reuse for 3 days
  const TTL_CURRENT_MONTH = 30 * 60 * 1000; // current month: reuse for 30 minutes
  const DEFAULT_MONTHS = 4; // default calendar range: last 4 months
  const memMonth = new Map(); // key -> { fetchedAt, to, records }: already-parsed months kept in RAM

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
    if (!res.ok) throw new Error("GraphQL request failed (HTTP " + res.status + ")");
    const json = await res.json();
    if (json.errors && json.errors.length) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }
    return json.data;
  }

  const EXPORT_QUERY = `query exportIssueNoteItemsInShop($exportDocType: ExportDocType, $endDate: LocalDate, $startDate: LocalDate) {
  exportIssueNoteItemsInShop(exportDocType: $exportDocType, endDate: $endDate, startDate: $startDate) {
    code
    data
  }
}`;

  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }
  function todayIso() {
    const d = new Date(); // local date (Dar es Salaam), not UTC
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // Same day-of-month N months ago (local date); clamps e.g. 31 Oct - 4 months -> 30 Jun.
  function monthsAgoIso(n) {
    const d = new Date();
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() - n);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // ---------- Month-by-month download with per-month cache ----------

  function firstOfNextMonth(y, m) {
    // m is 1-12
    return m === 12 ? (y + 1) + "-01-01" : y + "-" + pad2(m + 1) + "-01";
  }

  // Calendar months touched by [startDate, endDate]
  function monthsInRange(startDate, endDate) {
    let y = parseInt(startDate.slice(0, 4), 10);
    let m = parseInt(startDate.slice(5, 7), 10);
    const endKey = endDate.slice(0, 7);
    const list = [];
    for (let guard = 0; guard < 120; guard++) {
      const key = y + "-" + pad2(m);
      if (key > endKey) break;
      list.push({ key, start: key + "-01", fullEnd: firstOfNextMonth(y, m) });
      if (m === 12) { y++; m = 1; } else { m++; }
    }
    return list;
  }

  function recordMonthKey(r) {
    const v = r["Issue Date"];
    if (v instanceof Date && !isNaN(v.getTime())) {
      return v.getUTCFullYear() + "-" + pad2(v.getUTCMonth() + 1);
    }
    return null;
  }

  // chrome.storage turns Date objects into ISO strings - turn them back.
  function reviveDates(records) {
    for (const r of records) {
      for (const k in r) {
        const v = r[k];
        if (typeof v === "string" && /date/i.test(k) && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
          const d = new Date(v);
          if (!isNaN(d.getTime())) r[k] = d;
        }
      }
    }
    return records;
  }

  async function fetchMonth(token, mo, fetchEnd) {
    const data = await graphqlRequest(token, "exportIssueNoteItemsInShop", EXPORT_QUERY, {
      exportDocType: "XLSX",
      startDate: mo.start,
      endDate: fetchEnd,
    });
    const wrapper = data.exportIssueNoteItemsInShop;
    if (!wrapper || !wrapper.data) return { records: [], code: wrapper && wrapper.code, empty: true };
    const all = await window.GimisXlsxLite.parseXlsxBase64(wrapper.data, "Sno");
    // Keep only rows that belong to this month (drops the 1-day overlap with the
    // next month, so nothing is ever duplicated).
    const records = all.filter((r) => {
      const k = recordMonthKey(r);
      return k === null || k === mo.key;
    });
    return { records, empty: false };
  }

  async function getReportCached(forceRefresh, startDate, endDate, onStatus) {
    const today = todayIso();
    const currentKey = today.slice(0, 7);
    const months = monthsInRange(startDate, endDate);
    if (months.length === 0) return [];

    // Remove the old single big cache (it wasted space and was never reused across days).
    chrome.storage.local.remove(STORAGE_CACHE_KEY);

    // Months already in RAM are used directly; only the rest are read from chrome.storage.
    const stored = {};
    const missingKeys = [];
    for (const m of months) {
      const mem = memMonth.get(m.key);
      if (mem) stored[MONTH_PREFIX + m.key] = mem;
      else missingKeys.push(MONTH_PREFIX + m.key);
    }
    if (missingKeys.length) {
      const fromDisk = await chrome.storage.local.get(missingKeys);
      for (const k in fromDisk) {
        const entry = fromDisk[k];
        entry.records = reviveDates(entry.records); // done once, then kept in RAM
        memMonth.set(k.slice(MONTH_PREFIX.length), entry);
        stored[k] = entry;
      }
    }

    const byMonth = {}; // key -> records
    const todo = [];
    for (const mo of months) {
      const fetchEnd = mo.fullEnd < today ? mo.fullEnd : today; // never ask beyond today
      const cached = stored[MONTH_PREFIX + mo.key];
      const ttl = mo.key >= currentKey ? TTL_CURRENT_MONTH : TTL_CLOSED_MONTH;
      const fresh =
        !forceRefresh &&
        cached &&
        cached.to >= fetchEnd &&
        Date.now() - cached.fetchedAt < ttl;
      if (fresh) {
        byMonth[mo.key] = cached.records;
      } else {
        todo.push({ mo, fetchEnd });
      }
    }

    if (todo.length > 0) {
      const token = await getToken();
      if (!token) {
        throw new Error(
          "Your access token hasn't been captured yet. Open any GIMIS page (e.g. Vehicles) then try again."
        );
      }
      let done = 0;
      let lastCode = null;
      const total = todo.length;
      const cachedCount = months.length - total;
      onStatus(
        "Downloading " + total + " month(s) from GIMIS" +
          (cachedCount ? " (" + cachedCount + " already saved)" : "") + "..."
      );
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      async function downloadOne(item) {
        // Up to 3 attempts; "Failed to fetch" is usually a dropped connection, so wait and retry.
        let lastErr = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const res = await fetchMonth(token, item.mo, item.fetchEnd);
            if (res.empty) lastCode = res.code;
            byMonth[item.mo.key] = res.records;
            const entry = { fetchedAt: Date.now(), to: item.fetchEnd, records: res.records };
            memMonth.set(item.mo.key, entry);
            // Save to disk in the background so the next download/parse is not held up.
            try {
              chrome.storage.local
                .set({ [MONTH_PREFIX + item.mo.key]: entry })
                .catch(() => {}); // storage full: results still show, month just isn't saved
            } catch (e) {}
            done++;
            onStatus("Downloaded " + done + " of " + total + " month(s)...");
            return null;
          } catch (err) {
            lastErr = err;
            if (attempt < 3) {
              onStatus("Month " + item.mo.key + " failed, retrying (" + attempt + "/2)...");
              await sleep(1500 * attempt);
            }
          }
        }
        return lastErr;
      }
      let next = 0;
      const failed = []; // { item, err }
      async function worker() {
        while (next < todo.length) {
          const item = todo[next++];
          const err = await downloadOne(item);
          if (err) failed.push({ item, err });
        }
      }
      const workers = [];
      for (let i = 0; i < Math.min(CONCURRENCY, todo.length); i++) workers.push(worker());
      await Promise.all(workers);

      // Last chance: one at a time, slowly, for months that failed while others were running.
      const stillFailed = [];
      for (const f of failed) {
        onStatus("Retrying month " + f.item.mo.key + " on its own...");
        await sleep(1000);
        const err = await downloadOne(f.item);
        if (err) stillFailed.push({ key: f.item.mo.key, msg: err.message });
      }
      if (stillFailed.length) {
        throw new Error(
          "Month " + stillFailed.map((x) => x.key).join(", ") + ": " + stillFailed[0].msg +
            ". Months that succeeded are saved - press Search again to continue."
        );
      }
      const totalRows = months.reduce((n, m) => n + (byMonth[m.key] ? byMonth[m.key].length : 0), 0);
      if (totalRows === 0 && lastCode !== null) {
        throw new Error("No data was returned (code: " + lastCode + ")");
      }
    } else {
      onStatus("Using previously saved data...");
    }

    // Merge in month order, then keep only the exact From/To range the user picked.
    const startMs = isoToMs(startDate);
    const endMs = isoToMs(endDate) + 24 * 60 * 60 * 1000 - 1;
    const merged = [];
    for (const mo of months) {
      for (const r of byMonth[mo.key] || []) {
        const d = r["Issue Date"];
        if (d instanceof Date && !isNaN(d.getTime())) {
          const t = d.getTime();
          if (t < startMs || t > endMs) continue;
        }
        merged.push(r);
      }
    }
    return merged;
  }

  function isoToMs(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function normalizePlate(s) {
    return (s || "").toString().toUpperCase().replace(/\s+/g, "").trim();
  }
  function normalizeToken(s) {
    return (s || "").toString().replace(/\s+/g, "").trim();
  }

  function formatDateValue(v) {
    if (v instanceof Date && !isNaN(v.getTime())) return v.toLocaleString();
    if (v === undefined || v === null || v === "") return "";
    return String(v);
  }

  function sortNewestFirst(list) {
    list.sort((a, b) => {
      const da = a["Issue Date"] instanceof Date ? a["Issue Date"].getTime() : 0;
      const db = b["Issue Date"] instanceof Date ? b["Issue Date"].getTime() : 0;
      return db - da;
    });
    return list;
  }

  function renderTable(container, matches, emptyLabel) {
    if (matches.length === 0) {
      container.innerHTML = '<p class="gimis-plus-empty">' + emptyLabel + "</p>";
      return;
    }
    const rows = matches
      .map((r) => {
        const dateStr = formatDateValue(r["Issue Date"]);
        return (
          "<tr>" +
          `<td>${r["Tokens"] ?? ""}</td>` +
          `<td>${r["Means Of Transprot"] ?? ""}</td>` +
          `<td>${r["Item"] ?? ""}</td>` +
          `<td>${r["Qty"] ?? ""}</td>` +
          `<td>${r["Status"] ?? ""}</td>` +
          `<td>${r["Is Used"] ?? ""}</td>` +
          `<td>${dateStr}</td>` +
          `<td>${r["Reference"] ?? ""}</td>` +
          `<td>${r["Institution"] ?? ""}</td>` +
          "</tr>"
        );
      })
      .join("");
    container.innerHTML = `
      <p class="gimis-plus-count">Results: ${matches.length} (newest first):</p>
      <table class="gimis-plus-table">
        <thead>
          <tr><th>Token</th><th>Vehicle</th><th>Item</th><th>Qty</th><th>Status</th><th>Is Used</th><th>Issue Date</th><th>Reference</th><th>Institution</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderByVehicle(container, records, vehicleQuery) {
    const norm = normalizePlate(vehicleQuery);
    const matches = sortNewestFirst(
      records.filter((r) => normalizePlate(r["Means Of Transprot"]) === norm)
    );
    renderTable(container, matches, 'No tokens found for vehicle "' + vehicleQuery + '" in the selected date range.');
  }

  function renderByToken(container, records, tokenQuery) {
    const norm = normalizeToken(tokenQuery);
    const matches = sortNewestFirst(
      records.filter((r) => normalizeToken(r["Tokens"]) === norm)
    );
    renderTable(container, matches, 'No information found for token "' + tokenQuery + '" in the selected date range.');
  }

  function buildUI() {
    const logoUrl = chrome.runtime.getURL("logo-icon.png");

    const toggle = document.createElement("button");
    toggle.id = "gimis-plus-toggle";
    toggle.textContent = "GIMIS+";
    document.body.appendChild(toggle);

    const panel = document.createElement("div");
    panel.id = "gimis-plus-panel";
    panel.innerHTML = `
      <div class="gimis-plus-header">
        <div class="gimis-plus-header-left">
          <img class="gimis-plus-logo" src="${logoUrl}" alt="e-LAPS" />
          <div class="gimis-plus-title-block">
            <span class="gimis-plus-title">GIMIS PLUS - Search by Vehicle or Token</span>
            <span class="gimis-plus-powered">Powered By e-LAPS</span>
          </div>
        </div>
        <div class="gimis-plus-header-actions">
          <button id="gimis-plus-expand" title="Expand">⤢</button>
          <button id="gimis-plus-close" title="Close">✕</button>
        </div>
      </div>
      <div class="gimis-plus-body">
        <label>Vehicle Registration Number</label>
        <input type="text" id="gimis-plus-vehicle" placeholder="e.g. STN2838" />
        <label>Search by Token</label>
        <input type="text" id="gimis-plus-token" placeholder="e.g. 89302722625" />
        <div class="gimis-plus-daterow">
          <label>From</label>
          <input type="date" id="gimis-plus-start" />
          <label>To</label>
          <input type="date" id="gimis-plus-end" />
        </div>
        <p class="gimis-plus-hint">A longer date range means a longer wait. Default: the last 4 months. Note: results only cover your own branch/shop (not the whole of GIMIS nationwide) — tokens from other branches won't appear here.</p>
        <div class="gimis-plus-actions">
          <button id="gimis-plus-search">Search</button>
          <button id="gimis-plus-refresh" title="Download a fresh report from GIMIS instead of using the cached one">Refresh Data</button>
        </div>
        <p id="gimis-plus-status"></p>
        <div id="gimis-plus-results"></div>
      </div>`;
    document.body.appendChild(panel);

    document.getElementById("gimis-plus-end").value = todayIso();
    document.getElementById("gimis-plus-start").value = monthsAgoIso(DEFAULT_MONTHS);

    toggle.addEventListener("click", () => {
      panel.classList.toggle("gimis-plus-open");
    });
    document.getElementById("gimis-plus-close").addEventListener("click", () => {
      panel.classList.remove("gimis-plus-open");
    });

    const expandBtn = document.getElementById("gimis-plus-expand");
    expandBtn.addEventListener("click", () => {
      const isExpanded = panel.classList.toggle("gimis-plus-expanded");
      expandBtn.textContent = isExpanded ? "⤡" : "⤢";
      expandBtn.title = isExpanded ? "Collapse" : "Expand";
    });

    async function doSearch(forceRefresh) {
      const vehicle = document.getElementById("gimis-plus-vehicle").value.trim();
      const token = document.getElementById("gimis-plus-token").value.trim();
      const startDate = document.getElementById("gimis-plus-start").value;
      const endDate = document.getElementById("gimis-plus-end").value;
      const status = document.getElementById("gimis-plus-status");
      const results = document.getElementById("gimis-plus-results");
      results.innerHTML = "";
      if (!vehicle && !token) {
        status.textContent = "Please enter a vehicle number or a token first.";
        return;
      }
      try {
        const records = await getReportCached(forceRefresh, startDate, endDate, (msg) => {
          status.textContent = msg;
        });
        status.textContent = "";
        if (token) {
          renderByToken(results, records, token);
        } else {
          renderByVehicle(results, records, vehicle);
        }
      } catch (err) {
        status.textContent = "Error: " + err.message;
      }
    }

    document.getElementById("gimis-plus-search").addEventListener("click", () => doSearch(false));
    document.getElementById("gimis-plus-refresh").addEventListener("click", () => doSearch(true));
  }

  if (document.body) {
    buildUI();
  } else {
    window.addEventListener("DOMContentLoaded", buildUI);
  }
})();
