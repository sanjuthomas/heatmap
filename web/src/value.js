import { renderHeatmap } from "./heatmap.js";
import { formatClock, formatDate, formatPercent, formatPrice, formatWeight, statusLabel } from "./format.js";

const STORAGE_KEY = "heatmap.apiBase";
const REFRESH_MS = 5 * 60 * 1000;
const GAP_SCALE = 40;

const svg = document.querySelector("#heatmap");
const overlay = document.querySelector("#overlay");
const tooltip = document.querySelector("#tooltip");
const search = document.querySelector("#search");
const sectorSelect = document.querySelector("#sector");
const heroValue = document.querySelector("#hero-value");
const counts = document.querySelector("#counts");
const status = document.querySelector("#status");
const disclaimer = document.querySelector("#disclaimer");
const brandNote = document.querySelector("#brand-note");
const empty = document.querySelector("#search-empty");

const state = {
  data: null,
  query: "",
  sector: "all",
  mode: "both",
  apiBase: "",
};

const bySymbol = new Map();

function endpoint() {
  const base = state.apiBase.replace(/\/$/, "");
  return base ? `${base}/api/heatmap` : "./api/heatmap";
}

async function resolveApiBase() {
  const fromQuery = new URLSearchParams(location.search).get("api");
  if (fromQuery) return fromQuery.trim();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored.trim();
  try {
    const response = await fetch("./config.json", { cache: "no-store" });
    if (response.ok) {
      const config = await response.json();
      if (config.apiBase) return String(config.apiBase).trim();
    }
  } catch {
    // Same-origin /api/heatmap is the local development default.
  }
  return "";
}

function cashValue(stock) {
  const valuation = stock.valuation;
  if (!valuation || valuation.status !== "ok" || valuation.fairValue == null) return null;
  return valuation.fairValue;
}

function peerValue(stock) {
  const value = stock.valuation?.multipleFairValue;
  return value != null && value > 0 ? value : null;
}

function qualifies(stock) {
  const price = stock.price;
  if (price == null || price <= 0 || !stock.weight) return false;
  const cash = cashValue(stock);
  if (cash == null || price >= cash) return false;
  if (state.mode === "cash") return true;
  const peer = peerValue(stock);
  return peer != null && price < peer;
}

function gapPercent(stock) {
  const anchor = state.mode === "cash" ? cashValue(stock) : peerValue(stock);
  if (anchor == null || !stock.price) return null;
  return ((anchor - stock.price) / stock.price) * 100;
}

function gapSize(stock) {
  const gap = gapPercent(stock);
  if (gap == null || gap <= 0 || !stock.weight) return 0;
  return (stock.weight * gap) / 100;
}

function formatGap(value) {
  if (value == null || Number.isNaN(value)) return "—";
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}%`;
}

function sectorStocks() {
  const stocks = state.data?.stocks ?? [];
  if (state.sector === "all") return stocks;
  return stocks.filter((stock) => stock.sector === state.sector);
}

function visibleStocks() {
  return sectorStocks().filter(qualifies);
}

function matches(stock) {
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  return stock.symbol.toLowerCase().includes(query) || stock.name.toLowerCase().includes(query);
}

function applySearch() {
  const query = state.query.trim();
  svg.dataset.filtering = query ? "true" : "false";
  let hits = 0;
  for (const tile of svg.querySelectorAll(".tile")) {
    const stock = bySymbol.get(tile.dataset.symbol);
    const hit = stock ? matches(stock) : false;
    tile.dataset.match = hit ? "1" : "0";
    if (hit) hits += 1;
  }
  const listed = visibleStocks();
  if (!listed.length) {
    empty.hidden = false;
    empty.textContent = state.sector === "all"
      ? "No stocks are trading below this value."
      : "No stocks in this sector are trading below this value.";
    return;
  }
  empty.hidden = !(query && hits === 0);
  empty.textContent = "No matching stocks.";
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function paintHeader() {
  const data = state.data;
  if (!data) return;
  const listed = visibleStocks();
  const label = state.mode === "cash" ? "Below cash-flow value" : "Below both values";
  document.querySelector("#hero-label").textContent = label;
  heroValue.textContent = String(listed.length);
  heroValue.className = listed.length ? "up" : "flat";
  heroValue.title = state.mode === "cash"
    ? "Stocks whose price is below the cash-flow fair value."
    : "Stocks whose price is below both the cash-flow fair value and the peer value.";

  const weight = listed.reduce((sum, stock) => sum + (stock.weight || 0), 0);
  const typical = median(listed.map(gapPercent).filter((gap) => gap != null));
  counts.innerHTML = `<span class="up">${formatWeight(weight)} of SPY</span><span>median gap ${typical == null ? "—" : formatGap(typical)}</span>`;

  const badge = statusLabel(data.marketStatus);
  const valued = data.valuationAsOf ? `Values ${formatDate(data.valuationAsOf.slice(0, 10))}` : "Values unavailable";
  status.innerHTML = `<span class="badge badge-${(data.marketStatus || "unknown").toLowerCase()}">${badge}</span><span class="clock">${valued}<br>Refreshed ${formatClock(data.asOf)}</span>`;
  brandNote.textContent = `${data.stockCount} stocks`;
  disclaimer.textContent = state.mode === "cash"
    ? "A stock appears when its price is below the cash-flow fair value. Box size is that gap times the stock's SPY weight, which tracks the dollar size of the gap. Color is the same gap. Quotes are unofficial."
    : "A stock appears when its price is below both the cash-flow fair value and the peer value. Box size is the peer gap times the stock's SPY weight, which tracks the dollar size of the gap. Color is the same gap. Quotes are unofficial.";
}

function fillSectors() {
  const sectors = [...new Set((state.data?.stocks ?? []).map((stock) => stock.sector))].sort();
  const current = state.sector;
  sectorSelect.replaceChildren(new Option("All sectors", "all"));
  for (const sector of sectors) sectorSelect.append(new Option(sector, sector));
  sectorSelect.value = sectors.includes(current) || current === "all" ? current : "all";
  state.sector = sectorSelect.value;
}

function draw() {
  const stocks = visibleStocks();
  bySymbol.clear();
  for (const stock of stocks) bySymbol.set(stock.symbol, stock);
  renderHeatmap(svg, stocks, {
    scale: GAP_SCALE,
    sizeOf: gapSize,
    colorOf: gapPercent,
    formatOf: formatGap,
  });
  applySearch();
  paintHeader();
}

function showOverlay(message, { setup = false } = {}) {
  overlay.hidden = false;
  overlay.classList.toggle("setup", setup);
  if (setup) {
    overlay.innerHTML = `<form id="setup">
      <h2>Connect the quote service</h2>
      <p>${message}</p>
      <label>Cloud Run URL<input id="api-url" type="url" placeholder="https://your-service.run.app" required /></label>
      <button type="submit">Save and load</button>
    </form>`;
    overlay.querySelector("#setup").addEventListener("submit", (event) => {
      event.preventDefault();
      const value = overlay.querySelector("#api-url").value.trim().replace(/\/$/, "");
      localStorage.setItem(STORAGE_KEY, value);
      state.apiBase = value;
      load();
    });
    return;
  }
  overlay.textContent = message;
}

function hideOverlay() {
  overlay.hidden = true;
  overlay.classList.remove("setup");
}

async function load() {
  if (!state.data) showOverlay("Loading the value map…");
  try {
    const response = await fetch(endpoint(), { cache: "no-store" });
    if (!response.ok) throw new Error(`The quote service returned ${response.status}.`);
    const data = await response.json();
    if (!Array.isArray(data.stocks)) throw new Error(data.error || "The quote service returned an unexpected response.");
    state.data = data;
    fillSectors();
    hideOverlay();
    draw();
  } catch (error) {
    if (!state.data) {
      showOverlay(
        `${error.message} Paste the Cloud Run address for the heatmap API. For local development, leave this empty and run the API on port 8787.`,
        { setup: true },
      );
    }
  }
}

function gapText(fairValue, price) {
  if (fairValue == null || !price) return "";
  const gap = ((fairValue - price) / price) * 100;
  const gapClass = gap > 0 ? "up" : gap < 0 ? "down" : "";
  return ` <span class="${gapClass}">${formatPercent(gap)} vs price</span>`;
}

function fairValueHtml(stock) {
  const valuation = stock.valuation;
  if (!valuation) return "";
  const lines = [];
  if (valuation.status === "ok" && valuation.fairValue != null) {
    const filed = valuation.fiscalYearEnd ? ` · filed ${formatDate(valuation.fiscalYearEnd)}` : "";
    lines.push(`<p class="tip-fair">Fair value ${formatPrice(valuation.fairValue)}${gapText(valuation.fairValue, stock.price)}</p>`);
    lines.push(`<p class="tip-extra">${valuation.modelLabel} · ${valuation.assumption}${filed}</p>`);
  }
  if (valuation.multipleFairValue != null) {
    lines.push(
      `<p class="tip-fair">Peer value ${formatPrice(valuation.multipleFairValue)}${gapText(valuation.multipleFairValue, stock.price)}</p>`,
    );
    lines.push(`<p class="tip-extra">${valuation.multipleNote}</p>`);
  }
  if (!lines.length) {
    const reason = valuation.reason ? ` ${valuation.reason}.` : "";
    return `<p class="tip-extra">Fair value unavailable.${reason}</p>`;
  }
  return lines.join("");
}

function showTooltip(stock, x, y) {
  const gap = gapPercent(stock);
  tooltip.hidden = false;
  tooltip.innerHTML = `<p class="tip-symbol up">${stock.symbol} <span>${formatGap(gap)} below</span></p>
    <p class="tip-name">${stock.name}</p>
    <p class="tip-meta">${stock.sector}${stock.subIndustry ? ` · ${stock.subIndustry}` : ""}</p>
    <p class="tip-price">${formatPrice(stock.price)}</p>
    <p class="tip-extra">Index weight ${formatWeight(stock.weight)}</p>
    ${fairValueHtml(stock)}`;
  const rect = tooltip.getBoundingClientRect();
  const pad = 12;
  let left = x + 16;
  let top = y + 16;
  if (left + rect.width > window.innerWidth - pad) left = x - rect.width - 16;
  if (top + rect.height > window.innerHeight - pad) top = y - rect.height - 16;
  tooltip.style.left = `${Math.max(pad, left)}px`;
  tooltip.style.top = `${Math.max(pad, top)}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function tooltipFromEvent(event) {
  const tile = event.target.closest?.(".tile");
  if (!tile) {
    hideTooltip();
    return;
  }
  const stock = bySymbol.get(tile.dataset.symbol);
  if (!stock) return;
  showTooltip(stock, event.clientX, event.clientY);
}

svg.addEventListener("pointermove", tooltipFromEvent);
svg.addEventListener("pointerdown", tooltipFromEvent);
svg.addEventListener("pointerleave", hideTooltip);

search.addEventListener("input", () => {
  state.query = search.value;
  applySearch();
});

sectorSelect.addEventListener("change", () => {
  state.sector = sectorSelect.value;
  hideTooltip();
  draw();
});

document.querySelector("#refresh").addEventListener("click", () => load());

document.querySelectorAll(".periods button").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    for (const item of document.querySelectorAll(".periods button")) {
      item.setAttribute("aria-pressed", item === button ? "true" : "false");
    }
    hideTooltip();
    if (state.data) draw();
  });
});

const map = document.querySelector("#map");
new ResizeObserver(() => {
  if (state.data) draw();
}).observe(map);

async function start() {
  state.apiBase = await resolveApiBase();
  await load();
  setInterval(() => {
    if (document.visibilityState === "visible") load();
  }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") load();
  });
}

start();
