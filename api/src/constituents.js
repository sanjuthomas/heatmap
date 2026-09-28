import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry, parseCsv, USER_AGENT } from "./util.js";

const DATA_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "constituents.csv",
);
const SOURCE_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";
const TTL_MS = 12 * 60 * 60 * 1000;

let cache = { at: 0, stocks: null };

function toStocks(rows) {
  return rows
    .map((row) => ({
      symbol: (row.Symbol || "").trim(),
      name: (row.Security || "").trim(),
      sector: (row["GICS Sector"] || "Other").trim(),
      subIndustry: (row["GICS Sub-Industry"] || "").trim(),
      cik: String(row.CIK ?? "").trim() || null,
    }))
    .filter((stock) => stock.symbol);
}

async function fromDisk() {
  const text = await readFile(DATA_FILE, "utf8");
  return toStocks(parseCsv(text));
}

function mergeCik(stocks, bundled) {
  const cikBySymbol = new Map(bundled.map((stock) => [stock.symbol, stock.cik]));
  return stocks.map((stock) => ({ ...stock, cik: stock.cik || cikBySymbol.get(stock.symbol) || null }));
}

export async function loadConstituents() {
  if (cache.stocks && Date.now() - cache.at < TTL_MS) return cache.stocks;

  try {
    const response = await fetchWithRetry(SOURCE_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/csv" },
      timeoutMs: 15000,
    });
    const stocks = mergeCik(toStocks(parseCsv(await response.text())), await fromDisk());
    if (stocks.length < 450) throw new Error(`constituent list too short (${stocks.length})`);
    cache = { at: Date.now(), stocks };
    return stocks;
  } catch (error) {
    if (cache.stocks) return cache.stocks;
    const stocks = await fromDisk();
    cache = { at: Date.now(), stocks };
    console.warn(`Using bundled S&P 500 list (${error.message})`);
    return stocks;
  }
}
