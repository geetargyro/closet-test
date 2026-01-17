/* -----------------------------
   Storage + Defaults
------------------------------ */
const STORAGE_KEYS = {
  settings: "closet_settings_v1",
  shopping: "shopping_list_v1"
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
   Mock Engine (test-only)
   Replace later with real APIs
------------------------------ */
function mockScanResponse(upc) {
  const product = { upc, title: `Product for UPC ${String(upc).slice(-6)}`, brand: "Demo Brand" };

  const localTop3 = [
    { seller:"Target (Pickup)", channel:"LOCAL", price:19.99, shipping:0, taxRate:0.0825, discounts:0, inStock:true },
    { seller:"Walmart (Pickup)", channel:"LOCAL", price:20.49, shipping:0, taxRate:0.0825, discounts:0, inStock:true },
    { seller:"Best Buy (Pickup)", channel:"LOCAL", price:22.99, shipping:0, taxRate:0.0825, discounts:2.00, inStock:true }
  ].filter(o => o.inStock).slice(0,3);

  const nationalTop3 = [
    { seller:"Amazon", channel:"NATIONAL", price:18.49, shipping:4.99, taxRate:0.0825, discounts:0, inStock:true },
    { seller:"eBay", channel:"NATIONAL", price:17.99, shipping:6.50, taxRate:0.0, discounts:0, inStock:true },
    { seller:"Brand Site", channel:"NATIONAL", price:21.99, shipping:0.00, taxRate:0.0825, discounts:5.00, inStock:true }
  ].sort((a,b)=> (a.price+a.shipping)-(b.price+b.shipping)).slice(0,3);

  function totalsFor(offers) {
    const subtotal = offers.reduce((a,o)=>a+o.price,0);
    const shipping = offers.reduce((a,o)=>a+o.shipping,0);
    const discounts= offers.reduce((a,o)=>a+o.discounts,0);
    const tax      = offers.reduce((a,o)=>a+(o.price*o.taxRate),0);
    const total    = subtotal + shipping + tax - discounts;
    const r = (x)=> Math.round(x*100)/100;
    return { subtotal:r(subtotal), shipping:r(shipping), tax:r(tax), discounts:r(discounts), total:r(total) };
  }

  const planA = {
    name: "TRUE CHEAPEST",
    why: "Selected a higher sticker price because discount/free shipping reduced the final total.",
    breakdown: [
      { seller: nationalTop3[2].seller, ...totalsFor([nationalTop3[2]]) }
    ]
  };
  const planB = {
    name: "Runner-up",
    why: "Lower sticker price, but shipping made the final total higher.",
    breakdown: [
      { seller: nationalTop3[1].seller, ...totalsFor([nationalTop3[1]]) }
    ]
  };

  planA.total = planA.breakdown.reduce((a,b)=>a+b.total,0);
  planB.total = planB.breakdown.reduce((a,b)=>a+b.total,0);

  const winner = planA.total <= planB.total ? planA : planB;
  const runner = planA.total <= planB.total ? planB : planA;

  const delta = Math.abs(winner.total - runner.total);
  const triggers = {
    nonObviousWinner: nationalTop3[2].price > nationalTop3[1].price,
    closeCall: delta <= 2 || (delta / Math.max(winner.total,1)) <= 0.02,
    highStakes: winner.total >= loadSettings().highStakesThreshold,
    uncertainInputs: nationalTop3.some(o=>o.taxRate===0) || nationalTop3.some(o=>o.shipping===0 && o.price>20),
    priceMismatch: false,
    bundlingSavings: winner.breakdown.some(b=>b.discounts >= 5),
    dataFreshnessRisk: false
  };

  return { product, localTop3, nationalTop3, trueCheapest: winner, runnerUp: runner, triggers, fetchedAt: Date.now() };
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
let reader = null;
let scanLocked = false;
let lastCode = null;
let currentScanResp = null;
let showBreakdown = false;

function navigate(to) {
  route = to;
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
        <div class="muted">Scan → Superimposed overlay → Pause → Options. Shopping list persists locally.</div>
      </div>

      <button class="btn" id="goScan">Scan (UPC Overlay)</button>
      <button class="btn" id="goShopping">Shopping List</button>
      <button class="btn secondary" id="goOptions">Options</button>

      <div class="card">
        <div class="muted">
          Note: This test uses a mocked pricing engine. Next step is swapping mock data with real UPC + pricing sources.
        </div>
      </div>
    </div>
  `;
  document.getElementById("goScan").onclick = () => navigate("scan");
  document.getElementById("goShopping").onclick = () => navigate("shopping");
  document.getElementById("goOptions").onclick = () => navigate("options");
}

/* -----------------------------
   Scan (camera + superimpose overlay)
------------------------------ */
function renderScan() {
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
    </div>
  `;

  document.getElementById("btnPause").onclick = () => showPause();
  document.getElementById("btnRescanInline").onclick = () => resetScan();
  document.getElementById("btnBackHome").onclick = () => { stopCamera(); navigate("home"); };

  startCameraAndScan();
  drawOverlay();
}

function showPause(){ pauseModal.classList.remove("hidden"); }
function hidePause(){ pauseModal.classList.add("hidden"); }

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

  if (!currentScanResp) {
    overlay.innerHTML = `
      <div class="overlayCard">
        <div class="h1">Scan UPC</div>
        <div class="muted">Aim the barcode inside the box. First detection locks and shows results.</div>
      </div>
    `;
    return;
  }

  const r = currentScanResp;
  const s = loadSettings();

  const t = r.triggers;
  const shouldAuto =
    (s.autoShowTriggers.nonObviousWinner && t.nonObviousWinner) ||
    (s.autoShowTriggers.closeCall && t.closeCall) ||
    (s.autoShowTriggers.highStakes && t.highStakes) ||
    (s.autoShowTriggers.uncertainInputs && t.uncertainInputs) ||
    (s.autoShowTriggers.priceMismatch && t.priceMismatch) ||
    (s.autoShowTriggers.bundlingSavings && t.bundlingSavings) ||
    (s.autoShowTriggers.dataFreshnessRisk && t.dataFreshnessRisk);

  // If any trigger fires, we auto-open the minimal breakdown panel.
  if (shouldAuto) showBreakdown = true;

  overlay.innerHTML = `
    <div class="overlayCard">
      <div class="h1">${escapeHtml(r.product.title)}</div>
      <div class="muted">${escapeHtml(r.product.brand || "")}</div>

      <div class="sectionTitle">Top 3 Local</div>
      ${r.localTop3.map(o => `<div class="itemLine">${escapeHtml(o.seller)}: $${o.price.toFixed(2)}</div>`).join("")}

      <div class="sectionTitle">Top 3 National</div>
      ${r.nationalTop3.map(o => `<div class="itemLine">${escapeHtml(o.seller)}: $${(o.price+o.shipping).toFixed(2)} (est)</div>`).join("")}

      <div class="hr"></div>
      <div class="sectionTitle">TRUE CHEAPEST</div>
      <div style="font-weight:900;">$${r.trueCheapest.total.toFixed(2)} (est total)</div>

      ${showBreakdown ? `
        <div class="whyBox">
          <div style="font-weight:900;">Why this plan</div>
          <div class="muted">${escapeHtml(r.trueCheapest.why)}</div>
          <div class="hr"></div>
          ${r.trueCheapest.breakdown.map(b => `
            <div class="itemLine">
              <div style="font-weight:900;">${escapeHtml(b.seller)}</div>
              <div class="muted">
                sub $${b.subtotal.toFixed(2)} + ship $${b.shipping.toFixed(2)} + tax $${b.tax.toFixed(2)} − disc $${b.discounts.toFixed(2)}
                = <span style="font-weight:900; color:#fff;">$${b.total.toFixed(2)}</span>
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

  try {
    if (!window.ZXing) {
      alert("Scanner library failed to load.");
      return;
    }

    // Create reader if needed
    if (!reader) reader = new ZXing.BrowserMultiFormatReader();

    // Prefer back camera
    const devices = await reader.listVideoInputDevices();
    const back = devices.find(d => /back|rear|environment/i.test(d.label)) || devices[0];

    // Start decoding continuously
    reader.decodeFromVideoDevice(back?.deviceId, video, (result, err) => {
      if (scanLocked) return;

      if (result && result.getText) {
        const code = result.getText();
        if (!code || code === lastCode) return;

        scanLocked = true;
        lastCode = code;

        // Mock “found product + offers”
        (async () => {
  try {
    currentScanResp = await fetch(`/.netlify/functions/scan?upc=${encodeURIComponent(code)}`)
      .then(r => r.json());
  } catch (e) {
    currentScanResp = null;
    alert("API call failed");
  }
  drawOverlay();
})();
        // If you want to allow auto-unlock after some seconds, you can:
        // setTimeout(() => { scanLocked = false; }, 5000);
      }
    });

  } catch (e) {
    console.error(e);
    alert("Camera start failed. If iPhone blocks camera, try Chrome iOS or ensure camera permission is allowed.");
  }
}

function stopCamera() {
  try {
    if (reader) reader.reset();
  } catch {}
}

/* -----------------------------
   Shopping List
------------------------------ */
function renderShopping() {
  stopCamera();
  const list = loadShopping();

  app.innerHTML = `
    <div class="screen">
      <div class="card">
        <div class="h1">Shopping List</div>
        <div class="muted">Type generic or specific. It locks into a stable niche key.</div>
      </div>

      <div class="row">
        <input id="shopInput" class="input" placeholder="e.g., black hoodie, 34x32 jeans" />
        <button id="shopAdd" class="btn">Add</button>
      </div>

      <div id="shopList"></div>

      <button class="btn secondary" id="backHome2">Home</button>
    </div>
  `;

  document.getElementById("backHome2").onclick = () => navigate("home");

  const input = document.getElementById("shopInput");
  const addBtn = document.getElementById("shopAdd");

  addBtn.onclick = () => {
    const text = input.value.trim();
    if (!text) return;
    const next = [{ id: String(Date.now()), text, nicheKey: nicheKey(text), createdAt: Date.now() }, ...loadShopping()];
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
        <div style="font-weight:900;">${escapeHtml(it.text)}</div>
        <div class="muted">Niche: ${escapeHtml(it.nicheKey)}</div>
        <div class="muted">Auto-find: wired in concept. Next step: connect to real offer engine by niche.</div>
        <div class="smallActions">
          <button class="btn secondary" data-del="${escapeHtml(it.id)}">Remove</button>
        </div>
      </div>
    `).join("");

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
        <input id="highStakes" class="input" type="number" min="0" step="1" value="${s.highStakesThreshold}" />
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
        <label for="t_${k}">${k}</label>
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
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* Boot */
render();
