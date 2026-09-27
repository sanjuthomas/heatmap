import { renderHeatmap } from "./heatmap.js";
import { formatClock, formatPercent, formatPrice, formatWeight, statusLabel } from "./format.js";

const STORAGE_KEY = "heatmap.apiBase";
const REFRESH_MS = 20_000;

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

const state = {
  data: null,
  query: "",
  sector: "all",
  error: "",
  loading: true,
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

function visibleStocks() {
  const stocks = state.data?.stocks ?? [];
  if (state.sector === "all") return stocks;
  return stocks.filter((stock) => stock.sector === state.sector);
}

function matches(stock) {
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  return stock.symbol.toLowerCase().includes(query) || stock.name.toLowerCase().includes(query);
}

function applySearch() {
  const query = state.query.trim();
  const empty = document.querySelector("#search-empty");
  svg.dataset.filtering = query ? "true" : "false";
  let hits = 0;
  for (const tile of svg.querySelectorAll(".tile")) {
    const stock = bySymbol.get(tile.dataset.symbol);
    const hit = stock ? matches(stock) : false;
    tile.dataset.match = hit ? "1" : "0";
    if (hit) hits += 1;
  }
  empty.hidden = !(query && hits === 0);
}

function paintHeader() {
  const data = state.data;
  if (!data) return;
  const stocks = visibleStocks().filter((stock) => stock.changePercent != null && stock.weight);
  const weightTotal = stocks.reduce((sum, stock) => sum + stock.weight, 0);
  const move = weightTotal
    ? stocks.reduce((sum, stock) => sum + stock.weight * stock.changePercent, 0) / weightTotal
    : data.weightedChange;
  heroValue.textContent = formatPercent(move);
  heroValue.className = move == null ? "" : move > 0.005 ? "up" : move < -0.005 ? "down" : "flat";
  heroValue.title = "Each stock's index weight multiplied by its percent change, then added up.";

  const up = stocks.filter((stock) => stock.changePercent > 0.005).length;
  const down = stocks.filter((stock) => stock.changePercent < -0.005).length;
  const flat = stocks.length - up - down;
  counts.innerHTML = `<span class="up">${up} higher</span><span class="down">${down} lower</span><span>${flat} unchanged</span>`;

  const badge = statusLabel(data.marketStatus);
  status.innerHTML = `<span class="badge badge-${(data.marketStatus || "unknown").toLowerCase()}">${badge}</span><span class="clock">${data.quoteTime ? `Quotes ${data.quoteTime}` : ""}${data.stale ? " · last good snapshot" : ""}<br>Refreshed ${formatClock(data.asOf)}</span>`;
  brandNote.textContent = `${data.stockCount} stocks`;
  const weightNote = data.weightsAsOf ? ` SPY weights as of ${data.weightsAsOf}.` : "";
  disclaimer.textContent = `${data.sizing}${weightNote} ${data.comparison}`;
}

function fillSectors() {
  const sectors = [...new Set((state.data?.stocks ?? []).map((stock) => stock.sector))].sort();
  const current = state.sector;
  sectorSelect.replaceChildren(new Option("All sectors", "all"));
  for (const sector of sectors) sectorSelect.append(new Option(sector, sector));
  sectorSelect.value = sectors.includes(current) || current === "all" ? current : "all";
  state.sector = sectorSelect.value;
}

function rememberStocks(stocks) {
  bySymbol.clear();
  for (const stock of stocks) bySymbol.set(stock.symbol, stock);
}

function draw() {
  const stocks = visibleStocks();
  rememberStocks(stocks);
  renderHeatmap(svg, stocks);
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
  state.error = "";
  if (!state.data) showOverlay("Loading the S&P 500…");
  try {
    const response = await fetch(endpoint(), { cache: "no-store" });
    if (!response.ok) throw new Error(`The quote service returned ${response.status}.`);
    const data = await response.json();
    if (!Array.isArray(data.stocks)) throw new Error(data.error || "The quote service returned an unexpected response.");
    state.data = data;
    state.loading = false;
    fillSectors();
    hideOverlay();
    draw();
  } catch (error) {
    state.loading = false;
    if (!state.data) {
      showOverlay(
        `${error.message} Paste the Cloud Run address for the heatmap API. For local development, leave this empty and run the API on port 8787.`,
        { setup: true },
      );
    }
  }
}

function showTooltip(stock, x, y) {
  const direction = stock.changePercent > 0 ? "up" : stock.changePercent < 0 ? "down" : "flat";
  const afterHours =
    stock.extendedChangePercent != null
      ? `<p class="tip-extra">After the close: ${formatPercent(stock.extendedChangePercent)} from ${formatPrice(stock.regularPrice)}</p>`
      : "";
  tooltip.hidden = false;
  tooltip.innerHTML = `<p class="tip-symbol ${direction}">${stock.symbol} <span>${formatPercent(stock.changePercent)}</span></p>
    <p class="tip-name">${stock.name}</p>
    <p class="tip-meta">${stock.sector}${stock.subIndustry ? ` · ${stock.subIndustry}` : ""}</p>
    <p class="tip-price">${formatPrice(stock.price)}</p>
    <p class="tip-extra">Previous close ${formatPrice(stock.previousClose)}</p>
    ${afterHours}
    <p class="tip-extra">Index weight ${formatWeight(stock.weight)}</p>`;
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

const map = document.querySelector("#map");
const observer = new ResizeObserver(() => {
  if (state.data) draw();
});
observer.observe(map);

state.apiBase = await resolveApiBase();
await load();
setInterval(() => {
  if (document.visibilityState === "visible") load();
}, REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") load();
});
