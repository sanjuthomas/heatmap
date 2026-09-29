import { formatDate, formatDebtToEquity, formatPrice, formatRatioPercent, formatWeight } from "./format.js";

const STORAGE_KEY = "heatmap.apiBase";
const SECTOR = "Financials";
const COST_OF_EQUITY = 0.09;

const status = document.querySelector("#status");
const table = document.querySelector("#table");

function endpoint(apiBase) {
  const base = apiBase.replace(/\/$/, "");
  return base ? `${base}/api/heatmap` : "./api/heatmap";
}

async function resolveApiBase() {
  const fromQuery = new URLSearchParams(location.search).get("api");
  if (fromQuery) return fromQuery.trim();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored.trim();
  for (const url of ["./config.json", "../config.json", "../../config.json"]) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const config = await response.json();
      if (config.apiBase) return String(config.apiBase).trim();
    } catch {
      // The next candidate may be the site root.
    }
  }
  return "";
}

function excessReturn(stock) {
  const roe = stock.ratios?.roe;
  if (roe == null || Number.isNaN(roe)) return null;
  return roe - COST_OF_EQUITY;
}

function formatExcess(value) {
  if (value == null || Number.isNaN(value)) return "—";
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)} pts`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function cell(value, className = "") {
  return `<td class="${className}">${value}</td>`;
}

function render(stocks) {
  const rows = stocks.map((stock, index) => {
    const excess = excessReturn(stock);
    const excessClass = excess == null ? "" : excess > 0 ? "up" : excess < 0 ? "down" : "";
    const filed = stock.ratios?.fiscalYearEnd ? formatDate(stock.ratios.fiscalYearEnd) : "—";
    const fair = stock.valuation?.status === "ok" ? formatPrice(stock.valuation.fairValue) : "—";
    const peer = stock.valuation?.multipleFairValue != null ? formatPrice(stock.valuation.multipleFairValue) : "—";
    return `<tr>
      ${cell(String(index + 1))}
      ${cell(escapeHtml(stock.symbol), "ticker")}
      ${cell(escapeHtml(stock.name), "name")}
      ${cell(escapeHtml(stock.subIndustry || "—"), "name")}
      ${cell(formatPrice(stock.price))}
      ${cell(formatRatioPercent(stock.ratios?.roe))}
      ${cell(formatExcess(excess), excessClass)}
      ${cell(formatRatioPercent(stock.ratios?.roa))}
      ${cell(formatRatioPercent(stock.ratios?.roic))}
      ${cell(formatDebtToEquity(stock.ratios?.debtToEquity))}
      ${cell(fair)}
      ${cell(peer)}
      ${cell(formatWeight(stock.weight))}
      ${cell(escapeHtml(filed))}
    </tr>`;
  });
  table.hidden = false;
  table.innerHTML = `<table class="ratings">
    <thead>
      <tr>
        <th>Rank</th>
        <th class="ticker">Ticker</th>
        <th class="name">Company</th>
        <th class="name">Sub-industry</th>
        <th>Price</th>
        <th>ROE</th>
        <th>Excess ROE</th>
        <th>ROA</th>
        <th>ROIC</th>
        <th>D/E</th>
        <th>Fair value</th>
        <th>Peer value</th>
        <th>Weight</th>
        <th>Filed</th>
      </tr>
    </thead>
    <tbody>${rows.join("")}</tbody>
  </table>`;
  const ranked = stocks.filter((stock) => excessReturn(stock) != null).length;
  status.textContent = `${stocks.length} financial stocks. ${ranked} have a return on equity. Cost of equity is 9%.`;
}

async function start() {
  try {
    const apiBase = await resolveApiBase();
    const response = await fetch(endpoint(apiBase), { cache: "no-store" });
    if (!response.ok) throw new Error(`The quote service returned ${response.status}.`);
    const data = await response.json();
    if (!Array.isArray(data.stocks)) throw new Error("The quote service returned an unexpected response.");
    const stocks = data.stocks
      .filter((stock) => stock.sector === SECTOR)
      .sort((left, right) => {
        const leftExcess = excessReturn(left);
        const rightExcess = excessReturn(right);
        if (leftExcess == null && rightExcess == null) return left.symbol.localeCompare(right.symbol);
        if (leftExcess == null) return 1;
        if (rightExcess == null) return -1;
        return rightExcess - leftExcess || left.symbol.localeCompare(right.symbol);
      });
    render(stocks);
  } catch (error) {
    status.textContent = error.message;
  }
}

start();
