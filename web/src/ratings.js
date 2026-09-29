import { formatDate, formatDebtToEquity, formatEbitda, formatPrice, formatRatioPercent, formatWeight } from "./format.js";
import { industryOf } from "./industries.js";

const STORAGE_KEY = "heatmap.apiBase";
const COST_OF_EQUITY = 0.09;
const MODE = document.body.dataset.rating || "finance";
const SECTOR = document.body.dataset.sector || "";
const DURABLES = new Set([
  "Automobile Manufacturers",
  "Automotive Parts & Equipment",
  "Consumer Electronics",
  "Homebuilding",
  "Leisure Products",
]);

const status = document.querySelector("#status");
const table = document.querySelector("#table");
const note = document.querySelector("#note");

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

function includeStock(stock) {
  if (MODE === "industrials") return stock.sector === "Industrials";
  if (MODE === "utilities") return stock.sector === "Utilities";
  if (MODE === "durables") return DURABLES.has(stock.subIndustry);
  if (MODE === "return") return stock.sector === SECTOR;
  return stock.sector === "Financials";
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

function sortByScore(stocks, scoreOf) {
  return stocks.sort((left, right) => {
    const leftScore = scoreOf(left);
    const rightScore = scoreOf(right);
    if (leftScore == null && rightScore == null) return left.symbol.localeCompare(right.symbol);
    if (leftScore == null) return 1;
    if (rightScore == null) return -1;
    return rightScore - leftScore || left.symbol.localeCompare(right.symbol);
  });
}

function sharedCells(stock) {
  const filed = stock.ratios?.fiscalYearEnd ? formatDate(stock.ratios.fiscalYearEnd) : "—";
  const fair = stock.valuation?.status === "ok" ? formatPrice(stock.valuation.fairValue) : "—";
  const peer = stock.valuation?.multipleFairValue != null ? formatPrice(stock.valuation.multipleFairValue) : "—";
  return [
    cell(formatRatioPercent(stock.ratios?.roe)),
    cell(formatRatioPercent(stock.ratios?.roa)),
    cell(formatRatioPercent(stock.ratios?.roic)),
    cell(formatDebtToEquity(stock.ratios?.debtToEquity)),
    cell(fair),
    cell(peer),
    cell(formatWeight(stock.weight)),
    cell(escapeHtml(filed)),
  ].join("");
}

function identityCells(stock, index) {
  return [
    cell(String(index + 1)),
    cell(escapeHtml(stock.symbol), "ticker"),
    cell(escapeHtml(stock.name), "name"),
    cell(escapeHtml(stock.subIndustry || "—"), "name"),
    cell(formatPrice(stock.price)),
  ].join("");
}

const FINANCE_HEAD = `<th>Rank</th><th class="ticker">Ticker</th><th class="name">Company</th><th class="name">Sub-industry</th><th>Price</th><th>ROE</th><th>Excess ROE</th><th>ROA</th><th>ROIC</th><th>D/E</th><th>Fair value</th><th>Peer value</th><th>Weight</th><th>Filed</th>`;
const EBITDA_HEAD = `<th>Rank</th><th class="ticker">Ticker</th><th class="name">Company</th><th class="name">Sub-industry</th><th>Price</th><th>EBITDA margin</th><th>EBITDA</th><th>ROE</th><th>ROA</th><th>ROIC</th><th>D/E</th><th>Fair value</th><th>Peer value</th><th>Weight</th><th>Filed</th>`;

function groupsFor(stocks, scoreOf) {
  const groups = new Map();
  for (const stock of stocks) {
    const industry = industryOf(stock.subIndustry);
    const list = groups.get(industry) ?? [];
    list.push(stock);
    groups.set(industry, list);
  }
  return [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([industry, list]) => [industry, sortByScore(list, scoreOf)]);
}

function renderGroups(groups, headerHtml, rowHtml) {
  table.hidden = false;
  table.innerHTML = groups.map(([industry, stocks]) => `<section class="industry-block">
      <h2>${escapeHtml(industry)} <span>${stocks.length}</span></h2>
      <div class="table-scroll"><table class="ratings">
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${stocks.map((stock, index) => rowHtml(stock, index)).join("")}</tbody>
      </table></div>
    </section>`).join("");
}

function financeRow(stock, index) {
  const excess = excessReturn(stock);
  const excessClass = excess == null ? "" : excess > 0 ? "up" : excess < 0 ? "down" : "";
  return `<tr>
    ${identityCells(stock, index)}
    ${cell(formatRatioPercent(stock.ratios?.roe))}
    ${cell(formatExcess(excess), excessClass)}
    ${cell(formatRatioPercent(stock.ratios?.roa))}
    ${cell(formatRatioPercent(stock.ratios?.roic))}
    ${cell(formatDebtToEquity(stock.ratios?.debtToEquity))}
    ${cell(stock.valuation?.status === "ok" ? formatPrice(stock.valuation.fairValue) : "—")}
    ${cell(stock.valuation?.multipleFairValue != null ? formatPrice(stock.valuation.multipleFairValue) : "—")}
    ${cell(formatWeight(stock.weight))}
    ${cell(escapeHtml(stock.ratios?.fiscalYearEnd ? formatDate(stock.ratios.fiscalYearEnd) : "—"))}
  </tr>`;
}

function renderFinance(stocks) {
  const groups = groupsFor(stocks, excessReturn);
  renderGroups(groups, FINANCE_HEAD, financeRow);
  const ranked = stocks.filter((stock) => excessReturn(stock) != null).length;
  const sectorName = SECTOR || "Financials";
  if (note) {
    note.textContent = sectorName === "Real Estate"
      ? "Grouped by industry. Inside each industry, ranked by return on equity minus a 9% cost of equity. Depreciation reduces REIT book equity, so compare a REIT with the others in its industry."
      : "Grouped by industry. Inside each industry, ranked by return on equity minus a 9% cost of equity.";
  }
  status.textContent = `${stocks.length} ${sectorName} stocks in ${groups.length} industries. ${ranked} have a return on equity. Cost of equity is 9%.`;
}

function ebitdaRow(stock, index) {
  const margin = stock.ratios?.ebitdaMargin;
  const marginClass = margin == null ? "" : margin > 0 ? "up" : margin < 0 ? "down" : "";
  return `<tr>
    ${identityCells(stock, index)}
    ${cell(formatRatioPercent(margin), marginClass)}
    ${cell(formatEbitda(stock.ratios?.ebitda))}
    ${sharedCells(stock)}
  </tr>`;
}

function renderEbitda(stocks, rankedOnMargin) {
  const scoreOf = rankedOnMargin
    ? (stock) => (stock.ratios?.ebitdaMargin == null || Number.isNaN(stock.ratios.ebitdaMargin) ? null : stock.ratios.ebitdaMargin)
    : (stock) => (stock.ratios?.ebitda == null || Number.isNaN(stock.ratios.ebitda) ? null : stock.ratios.ebitda);
  const groups = groupsFor(stocks, scoreOf);
  renderGroups(groups, EBITDA_HEAD, ebitdaRow);
  const withEbitda = stocks.filter((stock) => stock.ratios?.ebitda != null).length;
  const withMargin = stocks.filter((stock) => stock.ratios?.ebitdaMargin != null).length;
  const label = MODE === "utilities" ? "utility" : MODE === "durables" ? "consumer-durable" : "industrial";
  if (rankedOnMargin) {
    if (note) note.textContent = "Grouped by industry. Inside each industry, ranked by EBITDA margin.";
    status.textContent = `${stocks.length} ${label} stocks in ${groups.length} industries. ${withMargin} have an EBITDA margin.`;
  } else {
    if (note) note.textContent = "Grouped by industry. Inside each industry, ranked by annual EBITDA.";
    status.textContent = `${stocks.length} ${label} stocks in ${groups.length} industries. ${withEbitda} have EBITDA.`;
  }
}

async function start() {
  try {
    const apiBase = await resolveApiBase();
    const response = await fetch(endpoint(apiBase), { cache: "no-store" });
    if (!response.ok) throw new Error(`The quote service returned ${response.status}.`);
    const data = await response.json();
    if (!Array.isArray(data.stocks)) throw new Error("The quote service returned an unexpected response.");
    const stocks = data.stocks.filter(includeStock);
    if (MODE === "finance" || MODE === "return") {
      renderFinance(stocks);
      return;
    }
    const rankedOnMargin = stocks.some((stock) => stock.ratios?.ebitdaMargin != null);
    renderEbitda(stocks, rankedOnMargin);
  } catch (error) {
    status.textContent = error.message;
  }
}

start();
