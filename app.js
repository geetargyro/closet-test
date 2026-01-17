/* -----------------------------
   Storage + Defaults
------------------------------ */
const STORAGE_KEYS = {
  settings: "closet_settings_v1",
  shopping: "shopping_list_v1",
  searchCache: "search_preview_cache_v1"
};

const DEFAULT_SETTINGS = {
  autoShowTriggers: {
    nonObviousWinner: true,
    closeCall: true,
    highStakes: true,
    uncertainInputs: true,
    priceMismatch: true,
    bundlingSavings: true,
    dataFreshnessRisk: true
  },
  highStakesThreshold: 75
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...parsed,
      autoShowTriggers: { ...DEFAULT_SETTINGS.autoShowTriggers, ...(parsed.autoShowTriggers || {}) }
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function saveSettings(s) {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(s));
}

function loadShopping() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.shopping);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveShopping(list) {
  localStorage.setItem(STORAGE_KEYS.shopping, JSON.stringify(list));
}

function nicheKey(text) {
  return (text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/* -----------------------------
   Search preview cache (24h)
------------------------------ */
const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function loadSearchCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.searchCache);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSearchCache(cacheObj) {
  localStorage.setItem(STORAGE_KEYS.searchCache, JSON.stringify(cacheObj));
}

function getCachedPreview(upc) {
  const cache = loadSearchCache();
  const entry = cache?.[String(upc)];
  if (!entry) return null;
  if (!entry.savedAt || (Date.now() - entry.savedAt) > SEARCH_CACHE_TTL_MS) return null;
  return entry.preview || null;
}

function setCachedPreview(upc, preview) {
  const cache = loadSearchCache();
  cache[String(upc)] = { savedAt: Date.now(), preview: Array.isArray(preview) ? preview : [] };
  saveSearchCache(cache);
}

/* -----------------------------
   Shopping List: add/merge by UPC
------------------------------ */
function addScanToShopping({ upc, title, brand }) {
  const list = loadShopping();

  // If already present (same UPC, not removed), increment qty
  const idx = list.findIndex(x => String(x.upc || "") === String(upc || ""));

  if (idx >= 0) {
    const cur = list[idx];
    const nextQty = Number(cur.qty || 1) + 1;
    list[idx] = {
      ...cur,
      qty: nextQty,
      // keep better title/brand if we receive it later
      title: betterText(cur.title, title),
      brand: betterText(cur.brand, brand),
      updatedAt: Date.now()
    };
    saveShopping(list);
    return;
  }

  // New entry
  const entryTitle = title && title.trim() ? title.trim() : `UPC ${upc}`;
  const entryText = entryTitle;

  const newItem = {
    id: String(Date.now()),
    // "text" stays for the niche + UX; scan entries use parsed title
    text: entryText,
    nicheKey: nicheKey(entryText),

    // bookkeeping
    source: "scan",
    upc: String(upc || ""),
    title: entryTitle,
    brand: (brand || "").trim(),

    qty: 1,
    status: "open",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  saveShopping([newItem, ...list]);
}

function betterText(existing, incoming) {
  const e = (existing || "").trim();
  const i = (incoming || "").trim();
  if (!i) return e;
  if (!e) return i;
  // Prefer non-generic server placeholders
  const generic = /server product for upc|product for upc/i;
  if (generic.test(e) && !generic.test(i)) return i;
  return e;
}

/* -----------------------------
   Router (Home / Scan / Shopping / Options)
------------------------------ */
const app = document.getElementById("app");
const pauseModal = document.getElementById("pauseModal");

document.getElementById("btnHome").onclick = () => navigate("home");
document.getElementById("btnOptionsTop").onclick = () => navigate("options");

document.getElementById("btnResume").onclick = () => hidePause();
document.getElementById("btnRescan").onclick = () => {
  hidePause();
  resetScan();
};
document.getElementById("btnOptionsPause").onclick = () => {
  hidePause();
  navigate("options");
};
document.getElementById("btnGoHome").onclick = () => {
  hidePause();
  stopCamera();
  navigate("home");
};

let route = "home";
let routeState = {}; // NEW: per-route state (e.g., scan mode)
let reader = null;
let scanLocked = false;
let lastCode = null;
let currentScanResp = null;
let showBreakdown = false;

function navigate(to, state = {}) {
  route = to;
  routeState = state || {};
  render();
}

function render() {
  if (route === "home") return renderHome();
  if (route === "scan") return renderScan();
  if (route === "shopping") return renderShopping();
  if (route === "options") return renderOptions();
  renderHome();
}

/* -----------------------------
   Home
------------------------------ */
function renderHome() {
  stopCamera();
  app.innerHTML = `
    <div class="screen">
      <div class="card">
        <div class="h1">Fully Functioning Test (Phone-Only)</div>
        <div class="muted">Scan → Superimposed overlay → Add to Shopping List (bookkeeping fields).</div>
      </div>

      <button class="btn" id="goScan">Scan (Lookup)</button>
      <button class="btn" id="goScanAdd">Scan → Add to Shopping List</button>
      <button class="btn" id="goShopping">Shopping List</button>
      <button class="btn secondary" id="goOptions">Options</button>

      <div class="card">
        <div class="muted">
          Pricing is Phase 2. Phase 1 includes scan + overlay + web preview + shopping list bookkeeping.
        </div>
      </div>
    </div>
  `;

  document.getElementById("goScan").onclick = () => navigate("scan", { mode: "lookup" });
  document.getElementById("goScanAdd").onclick = () => navigate("scan", { mode: "add_to_shopping" });
  document.getElementById("goShopping").onclick = () => navigate("shopping");
  document.getElementById("goOptions").onclick = () => navigate("options");
}

/* -----------------------------
   Scan (camera + overlay)
------------------------------ */
function renderScan() {
  const mode = routeState?.mode || "lookup";

  app.innerHTML = `
    <div class="scanWrap">
      <video id="camera" autoplay playsinline muted></video>
      <div class="scanHud">
        <div class="crosshair"></div>
      </div>

      <div class="overlay" id="overlay"></div>

      <div style="position:absolute; left:14px; right:14px; top:14px; display:flex; gap:10px;">
        <button class="btn ghost" id="btnPause">Pause</button>
        <button class="btn ghost" id="btnRescanInline">Rescan</button>
        <button class="btn ghost" id="btnBackHome">Home</button>
      </div>

      <div style="position:absolute; left:14px; right:14px; top:62px;">
        <div style="background: rgba(0,0,0,0.45); border:1px solid rgba(255,255,255,0.12); padding:10px 12px; border-radius:14px; font-weight:900;">
          Mode: ${escapeHtml(mode === "add_to_shopping" ? "Scan → Add to Shopping List" : "Lookup")}
        </div>
      </div>
    </div>
  `;

  document.getElementById("btnPause").onclick = () => showPause();
  document.getElementById("btnRescanInline").onclick = () => resetScan();
  document.getElementById("btnBackHome").onclick = () => { stopCamera(); navigate("home"); };

  startCameraAndScan();
  drawOverlay();
}

function showPause() { pauseModal.classList.remove("hidden"); }
function hidePause() { pauseModal.classList.add("hidden"); }

function resetScan() {
  scanLocked = false;
  lastCode = null;
  currentScanResp = null;
  showBreakdown = false;
  drawOverlay();
}

function drawOverlay() {
  const overlay = document.getElementById("overlay");
  if (!overlay) return;

  const mode = routeState?.mode || "lookup";

  if (!currentScanResp) {
    overlay.innerHTML = `
      <div class="overlayCard">
        <div class="h1">Scan UPC</div>
        <div class="muted">Aim the barcode inside the box. First detection locks and shows results.</div>
        ${mode === "add_to_shopping" ? `<div class="muted" style="margin-top:8px;">This scan will be added to your Shopping List automatically.</div>` : ``}
      </div>
    `;
    return;
  }

  const r = currentScanResp;
  const s = loadSettings();

  const t = r.triggers || {};
  const shouldAuto =
    (s.autoShowTriggers.nonObviousWinner && !!t.nonObviousWinner) ||
    (s.autoShowTriggers.closeCall && !!t.closeCall) ||
    (s.autoShowTriggers.highStakes && !!t.highStakes) ||
    (s.autoShowTriggers.uncertainInputs && !!t.uncertainInputs) ||
    (s.autoShowTriggers.priceMismatch && !!t.priceMismatch) ||
    (s.autoShowTriggers.bundlingSavings && !!t.bundlingSavings) ||
    (s.autoShowTriggers.dataFreshnessRisk && !!t.dataFreshnessRisk);

  if (shouldAuto) showBreakdown = true;

  const localTop3 = Array.isArray(r.localTop3) ? r.localTop3 : [];
  const nationalTop3 = Array.isArray(r.nationalTop3) ? r.nationalTop3 : [];
  const preview = Array.isArray(r.searchPreview) ? r.searchPreview : [];

  overlay.innerHTML = `
    <div class="overlayCard">
      <div class="h1">${escapeHtml(r.product?.title || "Unknown")}</div>
      <div class="muted">${escapeHtml(r.product?.brand || "")}</div>
      <div class="muted">UPC: ${escapeHtml(r.product?.upc || "")}</div>

      <div class="smallActions" style="margin-top:10px;">
        <button class="btn" id="btnAddShopping">Add to Shopping List</button>
        <button class="btn secondary" id="btnGoShopping">Shopping List</button>
      </div>

      <div class="sectionTitle">Top 3 Local (Phase 2 pricing)</div>
      ${localTop3.length ? localTop3.map(o => `
        <div class="itemLine">${escapeHtml(o.seller)}: $${Number(o.price || 0).toFixed(2)}</div>
      `).join("") : `<div class="itemLine muted">Not loaded yet</div>`}

      <div class="sectionTitle">Top 3 National (Phase 2 pricing)</div>
      ${nationalTop3.length ? nationalTop3.map(o => `
        <div class="itemLine">${escapeHtml(o.seller)}: $${(Number(o.price || 0) + Number(o.shipping || 0)).toFixed(2)} (est)</div>
      `).join("") : `<div class="itemLine muted">Not loaded yet</div>`}

      <div class="hr"></div>

      <div class="sectionTitle">Web preview</div>
      ${preview.length ? preview.map((x) => `
        <div class="itemLine">
          <div style="display:flex; gap:10px; align-items:flex-start;">
            ${x.thumb ? `<img src="${escapeAttr(x.thumb)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,0.15);" />` : ``}
            <div style="flex:1;">
              <div style="font-weight:900;">${escapeHtml(x.title || "Result")}</div>
              <div class="muted">${escapeHtml(x.displayLink || "")}</div>
              <div class="muted" style="margin-top:4px;">${escapeHtml(x.snippet || "")}</div>
              <div class="smallActions" style="margin-top:8px;">
                <button class="btn secondary" data-open="${escapeAttr(x.link || "")}">Open</button>
              </div>
            </div>
          </div>
        </div>
      `).join("") : `
        <div class="itemLine muted">
          No preview results. (If you just added keys, redeploy and try again.)
        </div>
      `}

      <div class="hr"></div>

      <div class="sectionTitle">TRUE CHEAPEST (Phase 2)</div>
      <div class="muted">Phase 2 pricing engine plugs in here. Current values are test placeholders.</div>
      <div style="font-weight:900;">$${Number(r.trueCheapest?.total || 0).toFixed(2)} (est total)</div>

      ${showBreakdown ? `
        <div class="whyBox">
          <div style="font-weight:900;">Why this plan</div>
          <div class="muted">${escapeHtml(r.trueCheapest?.why || "")}</div>
          <div class="hr"></div>
          ${(Array.isArray(r.trueCheapest?.breakdown) ? r.trueCheapest.breakdown : []).map(b => `
            <div class="itemLine">
              <div style="font-weight:900;">${escapeHtml(b.seller || "")}</div>
              <div class="muted">
                sub $${Number(b.subtotal || 0).toFixed(2)} + ship $${Number(b.shipping || 0).toFixed(2)} + tax $${Number(b.tax || 0).toFixed(2)} − disc $${Number(b.discounts || 0).toFixed(2)}
                = <span style="font-weight:900; color:#fff;">$${Number(b.total || 0).toFixed(2)}</span>
              </div>
            </div>
          `).join("")}
        </div>
        <div class="smallActions">
          <button class="btn secondary" id="btnHideBreakdown">Hide</button>
          <button class="btn" id="btnRescan2">Rescan</button>
        </div>
      ` : `
        <div class="smallActions">
          <button class="btn secondary" id="btnShowBreakdown">Show breakdown</button>
          <button class="btn" id="btnRescan2">Rescan</button>
        </div>
      `}
    </div>
  `;

  // Preview open links
  overlay.querySelectorAll("[data-open]").forEach(btn => {
    btn.onclick = () => {
      const url = btn.getAttribute("data-open");
      if (!url) return;
      window.open(url, "_blank", "noopener,noreferrer");
    };
  });

  // Add to Shopping List (bookkeeping)
  const btnAddShopping = document.getElementById("btnAddShopping");
  if (btnAddShopping) {
    btnAddShopping.onclick = () => {
      addScanToShopping({
        upc: r.product?.upc || "",
        title: r.product?.title || "",
        brand: r.product?.brand || ""
      });
      alert("Added to Shopping List.");
    };
  }

  const btnGoShopping = document.getElementById("btnGoShopping");
  if (btnGoShopping) btnGoShopping.onclick = () => { stopCamera(); navigate("shopping"); };

  const btnRescan2 = document.getElementById("btnRescan2");
  if (btnRescan2) btnRescan2.onclick = () => resetScan();

  const btnShow = document.getElementById("btnShowBreakdown");
  if (btnShow) btnShow.onclick = () => { showBreakdown = true; drawOverlay(); };

  const btnHide = document.getElementById("btnHideBreakdown");
  if (btnHide) btnHide.onclick = () => { showBreakdown = false; drawOverlay(); };
}

async function startCameraAndScan() {
  const video = document.getElementById("camera");
  if (!video) return;

  const mode = routeState?.mode || "lookup";

  try {
    if (!window.ZXing) {
      alert("Scanner library failed to load.");
      return;
    }

    if (!reader) reader = new ZXing.BrowserMultiFormatReader();

    const devices = await reader.listVideoInputDevices();
    const back = devices.find(d => /back|rear|environment/i.test(d.label)) || devices[0];

    reader.decodeFromVideoDevice(back?.deviceId, video, (result, err) => {
      if (scanLocked) return;

      if (result && result.getText) {
        const code = result.getText();
        if (!code || code === lastCode) return;

        scanLocked = true;
        lastCode = code;

        (async () => {
          try {
            const cachedPreview = getCachedPreview(code);

            const serverResp = await fetch(`/.netlify/functions/scan?upc=${encodeURIComponent(code)}`)
              .then(r => r.json());

            const serverPreview = Array.isArray(serverResp?.searchPreview) ? serverResp.searchPreview : [];
            if (serverPreview.length) {
              setCachedPreview(code, serverPreview);
            } else if (cachedPreview && cachedPreview.length) {
              serverResp.searchPreview = cachedPreview;
            }

            currentScanResp = serverResp;

            // NEW: If in add-to-shopping mode, auto-add and jump to list
            if (mode === "add_to_shopping") {
              addScanToShopping({
                upc: serverResp?.product?.upc || code,
                title: serverResp?.product?.title || `UPC ${code}`,
                brand: serverResp?.product?.brand || ""
              });
              stopCamera();
              navigate("shopping");
              return;
            }
          } catch (e) {
            currentScanResp = {
              product: { upc: code, title: "Scan loaded but API failed", brand: "" },
              localTop3: [],
              nationalTop3: [],
              trueCheapest: { total: 0, why: "API call failed", breakdown: [] },
              runnerUp: { total: 0, why: "", breakdown: [] },
              triggers: {},
              searchPreview: getCachedPreview(code) || [],
              fetchedAt: Date.now()
            };

            if (mode === "add_to_shopping") {
              addScanToShopping({ upc: code, title: `UPC ${code}`, brand: "" });
              stopCamera();
              navigate("shopping");
              return;
            }
          }

          drawOverlay();
        })();
      }
    });
  } catch (e) {
    console.error(e);
    alert("Camera start failed. Ensure camera permission is allowed.");
  }
}

function stopCamera() {
  try { if (reader) reader.reset(); } catch {}
}

/* -----------------------------
   Shopping List
------------------------------ */
function renderShopping() {
  stopCamera();

  app.innerHTML = `
    <div class="screen">
      <div class="card">
        <div class="h1">Shopping List</div>
        <div class="muted">Add by text, or scan UPC directly into a bookkeeping entry.</div>
      </div>

      <div class="row">
        <button class="btn" id="btnScanToAdd">Scan to Add</button>
        <button class="btn secondary" id="btnHomeFromShop">Home</button>
      </div>

      <div class="row">
        <input id="shopInput" class="input" placeholder="e.g., black hoodie, Levi 511 34x32" />
        <button id="shopAdd" class="btn">Add</button>
      </div>

      <div id="shopList"></div>
    </div>
  `;

  document.getElementById("btnHomeFromShop").onclick = () => navigate("home");
  document.getElementById("btnScanToAdd").onclick = () => navigate("scan", { mode: "add_to_shopping" });

  const input = document.getElementById("shopInput");
  const addBtn = document.getElementById("shopAdd");

  addBtn.onclick = () => {
    const text = input.value.trim();
    if (!text) return;

    const next = [{
      id: String(Date.now()),
      text,
      nicheKey: nicheKey(text),
      source: "manual",
      upc: "",
      title: text,
      brand: "",
      qty: 1,
      status: "open",
      createdAt: Date.now(),
      updatedAt: Date.now()
    }, ...loadShopping()];

    saveShopping(next);
    input.value = "";
    drawShoppingList();
  };

  function drawShoppingList() {
    const wrap = document.getElementById("shopList");
    const items = loadShopping();

    if (!items.length) {
      wrap.innerHTML = `<div class="card"><div class="muted">No items yet.</div></div>`;
      return;
    }

    wrap.innerHTML = items.map(it => `
      <div class="card">
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
          <div style="flex:1;">
            <div style="font-weight:900;">${escapeHtml(it.title || it.text || "Item")}</div>
            ${it.brand ? `<div class="muted">${escapeHtml(it.brand)}</div>` : ``}
            ${it.upc ? `<div class="muted">UPC: ${escapeHtml(it.upc)}</div>` : ``}
            <div class="muted">Qty: ${Number(it.qty || 1)}</div>
            <div class="muted">Niche: ${escapeHtml(it.nicheKey || nicheKey(it.title || it.text || ""))}</div>
            <div class="muted">Source: ${escapeHtml(it.source || "manual")}</div>
          </div>
          <div style="min-width:110px; display:flex; flex-direction:column; gap:8px;">
            <button class="btn secondary" data-plus="${escapeAttr(it.id)}">+1</button>
            <button class="btn secondary" data-minus="${escapeAttr(it.id)}">-1</button>
            <button class="btn secondary" data-del="${escapeAttr(it.id)}">Remove</button>
          </div>
        </div>
      </div>
    `).join("");

    // Qty controls
    wrap.querySelectorAll("[data-plus]").forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-plus");
        const list = loadShopping();
        const idx = list.findIndex(x => x.id === id);
        if (idx < 0) return;
        list[idx].qty = Number(list[idx].qty || 1) + 1;
        list[idx].updatedAt = Date.now();
        saveShopping(list);
        drawShoppingList();
      };
    });

    wrap.querySelectorAll("[data-minus]").forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-minus");
        const list = loadShopping();
        const idx = list.findIndex(x => x.id === id);
        if (idx < 0) return;
        const nextQty = Math.max(1, Number(list[idx].qty || 1) - 1);
        list[idx].qty = nextQty;
        list[idx].updatedAt = Date.now();
        saveShopping(list);
        drawShoppingList();
      };
    });

    wrap.querySelectorAll("[data-del]").forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-del");
        saveShopping(loadShopping().filter(x => x.id !== id));
        drawShoppingList();
      };
    });
  }

  drawShoppingList();
}

/* -----------------------------
   Options (Triggers)
------------------------------ */
function renderOptions() {
  stopCamera();
  const s = loadSettings();

  app.innerHTML = `
    <div class="screen">
      <div class="card">
        <div class="h1">Options</div>
        <div class="muted">Breakdown is hidden by default and only auto-shows when enabled triggers fire.</div>
      </div>

      <div class="card" id="toggles"></div>

      <div class="card">
        <div style="font-weight:900;">High-stakes threshold</div>
        <div class="muted">Auto-show breakdown when TRUE CHEAPEST total is at/above this amount.</div>
        <input id="highStakes" class="input" type="number" min="0" step="1" value="${Number(s.highStakesThreshold)}" />
      </div>

      <div class="row">
        <button id="saveOptions" class="btn">Save</button>
        <button id="resetOptions" class="btn secondary">Reset</button>
      </div>

      <button class="btn secondary" id="backHome3">Home</button>
    </div>
  `;

  document.getElementById("backHome3").onclick = () => navigate("home");

  const toggles = document.getElementById("toggles");
  const keys = Object.keys(s.autoShowTriggers);

  toggles.innerHTML = `
    ${keys.map(k => `
      <div class="toggleRow">
        <label for="t_${k}">${escapeHtml(k)}</label>
        <input id="t_${k}" type="checkbox" ${s.autoShowTriggers[k] ? "checked" : ""} />
      </div>
    `).join("")}
  `;

  document.getElementById("saveOptions").onclick = () => {
    const next = loadSettings();
    keys.forEach(k => {
      next.autoShowTriggers[k] = !!document.getElementById(`t_${k}`).checked;
    });
    const hs = Number(document.getElementById("highStakes").value || DEFAULT_SETTINGS.highStakesThreshold);
    next.highStakesThreshold = Number.isFinite(hs) ? hs : DEFAULT_SETTINGS.highStakesThreshold;
    saveSettings(next);
    navigate("home");
  };

  document.getElementById("resetOptions").onclick = () => {
    saveSettings(structuredClone(DEFAULT_SETTINGS));
    navigate("options");
  };
}

/* -----------------------------
   Utils
------------------------------ */
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/* Boot */
render();