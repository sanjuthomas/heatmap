import { loadConstituents } from "./constituents.js";
import { fetchQuotes } from "./quotes.js";
import { loadWeights } from "./weights.js";

const QUOTE_TTL_MS = 15_000;
let cache = { at: 0, body: null };
let pending = null;

function majority(values) {
  const counts = new Map();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export async function buildHeatmap() {
  const [constituents, weightBook] = await Promise.all([loadConstituents(), loadWeights()]);
  const quotes = await fetchQuotes(constituents.map((stock) => stock.symbol));

  const stocks = constituents.map((stock) => {
    const quote = quotes.get(stock.symbol);
    const weight = weightBook.weights.get(stock.symbol) ?? null;
    return {
      symbol: stock.symbol,
      name: stock.name,
      sector: stock.sector,
      subIndustry: stock.subIndustry,
      weight,
      price: quote?.price ?? null,
      previousClose: quote?.previousClose ?? null,
      regularPrice: quote?.regularPrice ?? null,
      change: quote?.change ?? null,
      changePercent: quote?.changePercent ?? null,
      extendedChangePercent: quote?.extendedChangePercent ?? null,
      session: quote?.session ?? null,
    };
  });

  stocks.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const quoted = stocks.filter((stock) => stock.changePercent != null);
  const weighted = quoted.filter((stock) => stock.weight != null);
  const weightTotal = weighted.reduce((sum, stock) => sum + stock.weight, 0);
  const weightedChange = weightTotal
    ? weighted.reduce((sum, stock) => sum + stock.weight * stock.changePercent, 0) / weightTotal
    : null;

  const quoteList = [...quotes.values()];

  return {
    asOf: new Date().toISOString(),
    marketStatus: majority(quoteList.map((quote) => quote.marketStatus)),
    session: majority(quoted.map((stock) => stock.session)),
    quoteTime: majority(quoteList.map((quote) => quote.quoteTime)),
    realtime: quoteList.some((quote) => quote.realtime),
    weightsAsOf: weightBook.asOf,
    weightsSource: weightBook.source,
    weightedChange,
    stockCount: stocks.length,
    quotedCount: quoted.length,
    comparison: "Latest traded price versus the previous trading day's close.",
    sizing: "Box size is the stock's weight in SPY, the ETF that tracks the S&P 500.",
    stocks,
  };
}

export function getHeatmap() {
  if (cache.body && Date.now() - cache.at < QUOTE_TTL_MS) return Promise.resolve(cache.body);
  if (pending) return pending;
  pending = buildHeatmap()
    .then((body) => {
      cache = { at: Date.now(), body };
      return body;
    })
    .catch((error) => {
      if (cache.body) return { ...cache.body, stale: true };
      throw error;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
