import { loadConstituents } from "./constituents.js";
import { peerValuations, perShareMetric, selectModel, valueCompany } from "./models.js";
import { fetchQuotes } from "./quotes.js";
import { countRatios, presentRatios } from "./ratios.js";
import { saveRatios } from "./ratiosStore.js";
import { fetchCompanyFacts, fundamentalsFromFacts, ratiosFromFacts } from "./sec.js";
import { saveValuation } from "./valuationStore.js";

const MIN_FULL_RESULTS = 200;
const PRICE_RATIO_LIMIT = 100;

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

function withShareClass(symbol, result) {
  if (symbol !== "BRK.B" || result.fairValue == null) return result;
  return { ...result, fairValue: Math.round((result.fairValue / 1500) * 100) / 100 };
}

function withPriceCheck(result, price) {
  if (result.status !== "ok" || price == null || price <= 0) return result;
  const ratio = result.fairValue / price;
  if (ratio > PRICE_RATIO_LIMIT || ratio < 1 / PRICE_RATIO_LIMIT) {
    return {
      ...result,
      status: "unavailable",
      reason: "Share count does not match the market price",
      fairValue: null,
    };
  }
  return result;
}

export async function buildValuation(stocks) {
  const groups = new Map();
  for (const stock of stocks) {
    if (!stock.cik) continue;
    const group = groups.get(stock.cik) ?? { cik: stock.cik, symbols: [], model: selectModel(stock) };
    group.symbols.push(stock.symbol);
    groups.set(stock.cik, group);
  }

  const started = Date.now();
  let completed = 0;
  const computed = await mapPool([...groups.values()], 4, async (group) => {
    try {
      const facts = await fetchCompanyFacts(group.cik);
      const fundamentals = fundamentalsFromFacts(facts);
      const ratios = ratiosFromFacts(facts);
      completed += 1;
      if (completed % 25 === 0 || completed === groups.size) {
        console.log(`Valued ${completed}/${groups.size}`);
      }
      return [group, fundamentals, ratios];
    } catch (error) {
      completed += 1;
      console.warn(`Valuation ${group.symbols.join("/")} failed: ${error.message}`);
      return [group, null, null];
    }
  });

  let quotes = new Map();
  try {
    quotes = await fetchQuotes(
      stocks.map((stock) => stock.symbol),
      { minimum: stocks.length >= 400 ? 400 : 1 },
    );
  } catch (error) {
    console.warn(`Quote check skipped (${error.message})`);
  }

  const stockBySymbol = new Map(stocks.map((stock) => [stock.symbol, stock]));
  const observations = [];
  const bySymbol = {};
  const ratiosBySymbol = {};
  let ok = 0;
  for (const [group, fundamentals, ratios] of computed) {
    for (const symbol of group.symbols) {
      const quote = quotes.get(symbol);
      const stock = stockBySymbol.get(symbol);
      const filedShares = fundamentals?.shares > 0 ? fundamentals.shares : null;
      const quotedShares = quote?.sharesOutstanding ?? null;
      const shareRatio = filedShares && quotedShares ? filedShares / quotedShares : 1;
      const sharesMatch = shareRatio < 3 && shareRatio > 1 / 3;
      const shares = sharesMatch ? filedShares ?? quotedShares : quotedShares ?? filedShares;
      const usedFilingShares = shares != null && shares === filedShares;
      let result = fundamentals
        ? valueCompany(group.model, { ...fundamentals, shares })
        : {
            status: "unavailable",
            reason: "Filing data is unavailable",
            model: group.model,
            modelLabel: null,
            assumption: null,
            fairValue: null,
            fiscalYearEnd: null,
            growth: null,
          };
      const adjusted = withPriceCheck(usedFilingShares ? withShareClass(symbol, result) : result, quote?.price);
      bySymbol[symbol] = adjusted;
      ratiosBySymbol[symbol] = presentRatios(stock, ratios);
      if (adjusted.status === "ok") ok += 1;
      const metric = fundamentals ? perShareMetric(group.model, { ...fundamentals, shares }) : null;
      if (metric && quote?.price > 0 && stock) {
        const perShare = usedFilingShares && symbol === "BRK.B" ? metric.perShare / 1500 : metric.perShare;
        observations.push({
          symbol,
          sector: stock.sector,
          subIndustry: stock.subIndustry,
          kind: metric.kind,
          label: metric.label,
          perShare,
          ratio: quote.price / perShare,
        });
      }
    }
  }
  const multiples = peerValuations(observations);
  let multipleCount = 0;
  for (const [symbol, multiple] of Object.entries(multiples)) {
    if (!bySymbol[symbol]) continue;
    Object.assign(bySymbol[symbol], multiple);
    multipleCount += 1;
  }
  for (const stock of stocks) {
    if (!ratiosBySymbol[stock.symbol]) {
      ratiosBySymbol[stock.symbol] = presentRatios(stock, null);
    }
    if (bySymbol[stock.symbol]) continue;
    bySymbol[stock.symbol] = {
      status: "unavailable",
      reason: "Filing data is unavailable",
      model: selectModel(stock),
      modelLabel: null,
      assumption: null,
      fairValue: null,
      fiscalYearEnd: null,
      growth: null,
    };
  }

  const available = countRatios(ratiosBySymbol);
  console.log(
    `Valuation ${ok}/${stocks.length} cash-flow values, ${multipleCount} peer multiples, in ${Math.round((Date.now() - started) / 1000)}s`,
  );
  console.log(
    `Ratios: ROE ${available.roe}, ROA ${available.roa}, ROIC ${available.roic}, D/E ${available.debtToEquity}, EBITDA ${available.ebitda}, margin ${available.ebitdaMargin}`,
  );
  return {
    computedAt: new Date().toISOString(),
    ok,
    stockCount: stocks.length,
    stocks: bySymbol,
    ratios: {
      computedAt: new Date().toISOString(),
      stockCount: stocks.length,
      available,
      stocks: ratiosBySymbol,
    },
  };
}

async function main() {
  const { symbols, fileOnly } = parseArgs(process.argv.slice(2));
  const constituents = await loadConstituents();
  const selected = symbols.length ? constituents.filter((stock) => symbols.includes(stock.symbol)) : constituents;
  if (!selected.length) throw new Error("No matching tickers");
  const snapshot = await buildValuation(selected);
  if (symbols.length) {
    for (const symbol of symbols) {
      const row = snapshot.stocks[symbol];
      console.log(
        `${symbol} ${row.model} ${row.status} ${row.fairValue ?? row.reason} ${row.fiscalYearEnd ?? ""} peer ${row.multipleFairValue ?? "none"} ${row.multipleNote ?? ""}`,
      );
    }
    return;
  }
  if (snapshot.ok < MIN_FULL_RESULTS) {
    throw new Error(`Only ${snapshot.ok} fair values computed; left the stored snapshot unchanged`);
  }
  const ratios = snapshot.ratios;
  delete snapshot.ratios;
  const saved = await saveValuation(snapshot, { fileOnly });
  console.log(`Saved ${snapshot.ok} fair values${saved.firestore ? " to Firestore" : " to api/data/valuations.json"}`);
  const savedRatios = await saveRatios(ratios, { fileOnly });
  console.log(`Saved ratios for ${ratios.stockCount} stocks${savedRatios.firestore ? " to Firestore" : " to api/data/ratios.json"}`);
}

const isDirectRun = process.argv[1]?.endsWith("valuate.js");
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
