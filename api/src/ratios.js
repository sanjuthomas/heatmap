import { loadConstituents } from "./constituents.js";
import { fetchCompanyFacts, ratiosFromFacts } from "./sec.js";
import { saveRatios } from "./ratiosStore.js";

const EMPTY = { fiscalYearEnd: null, roe: null, roa: null, roic: null, debtToEquity: null, ebitda: null, ebitdaMargin: null };

const EBITDA_SECTORS = new Set(["Industrials", "Utilities"]);
const EBITDA_SUBINDUSTRIES = new Set([
  "Automobile Manufacturers",
  "Automotive Parts & Equipment",
  "Consumer Electronics",
  "Homebuilding",
  "Leisure Products",
]);

export function usesEbitda(stock) {
  if (!stock) return false;
  return EBITDA_SECTORS.has(stock.sector) || EBITDA_SUBINDUSTRIES.has(stock.subIndustry);
}

export function presentRatios(stock, ratios) {
  const row = { ...EMPTY, ...(ratios ?? {}) };
  if (!usesEbitda(stock)) {
    row.ebitda = null;
    row.ebitdaMargin = null;
  }
  return row;
}

function parseArgs(argv) {
  const symbols = [];
  let fileOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--file-only") fileOnly = true;
    if (arg === "--symbols") symbols.push(...argv[index + 1].split(",").map((symbol) => symbol.trim()).filter(Boolean));
  }
  return { symbols, fileOnly };
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export function countRatios(stocks) {
  const available = { roe: 0, roa: 0, roic: 0, debtToEquity: 0, ebitda: 0, ebitdaMargin: 0 };
  for (const row of Object.values(stocks)) {
    for (const key of Object.keys(available)) {
      if (row?.[key] != null) available[key] += 1;
    }
  }
  return available;
}

export async function buildRatios(stocks) {
  const groups = new Map();
  for (const stock of stocks) {
    if (!stock.cik) continue;
    const group = groups.get(stock.cik) ?? { cik: stock.cik, symbols: [] };
    group.symbols.push(stock.symbol);
    groups.set(stock.cik, group);
  }

  const started = Date.now();
  let completed = 0;
  const computed = await mapPool([...groups.values()], 4, async (group) => {
    try {
      const facts = await fetchCompanyFacts(group.cik);
      completed += 1;
      if (completed % 25 === 0 || completed === groups.size) {
        console.log(`Ratios ${completed}/${groups.size}`);
      }
      return [group, ratiosFromFacts(facts)];
    } catch (error) {
      completed += 1;
      console.warn(`Ratios ${group.symbols.join("/")} failed: ${error.message}`);
      return [group, null];
    }
  });

  const stockBySymbol = new Map(stocks.map((stock) => [stock.symbol, stock]));
  const bySymbol = {};
  for (const [group, ratios] of computed) {
    for (const symbol of group.symbols) bySymbol[symbol] = presentRatios(stockBySymbol.get(symbol), ratios);
  }
  for (const stock of stocks) {
    if (!bySymbol[stock.symbol]) bySymbol[stock.symbol] = presentRatios(stock, null);
  }

  const available = countRatios(bySymbol);
  console.log(
    `Ratios for ${stocks.length} stocks in ${Math.round((Date.now() - started) / 1000)}s: ROE ${available.roe}, ROA ${available.roa}, ROIC ${available.roic}, D/E ${available.debtToEquity}, EBITDA ${available.ebitda}`,
  );
  return {
    computedAt: new Date().toISOString(),
    stockCount: stocks.length,
    available,
    stocks: bySymbol,
  };
}

async function main() {
  const { symbols, fileOnly } = parseArgs(process.argv.slice(2));
  const constituents = await loadConstituents();
  const selected = symbols.length ? constituents.filter((stock) => symbols.includes(stock.symbol)) : constituents;
  if (!selected.length) throw new Error("No matching tickers");
  const snapshot = await buildRatios(selected);
  if (symbols.length) {
    for (const symbol of symbols) {
      const row = snapshot.stocks[symbol];
      console.log(
        `${symbol} ${row.fiscalYearEnd ?? "no filing"} ROE ${row.roe ?? "n/a"} ROA ${row.roa ?? "n/a"} ROIC ${row.roic ?? "n/a"} D/E ${row.debtToEquity ?? "n/a"} EBITDA ${row.ebitda ?? "n/a"} margin ${row.ebitdaMargin ?? "n/a"}`,
      );
    }
    if (symbols.length < constituents.length) return;
  }
  const saved = await saveRatios(snapshot, { fileOnly });
  console.log(`Saved ratios for ${snapshot.stockCount} stocks${saved.firestore ? " to Firestore" : " to api/data/ratios.json"}`);
}

const isDirectRun = process.argv[1]?.endsWith("ratios.js");
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
