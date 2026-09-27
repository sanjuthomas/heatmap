import { loadConstituents } from "./constituents.js";
import { LOOKBACKS, loadHistory } from "./history.js";
import { fetchQuotes } from "./quotes.js";
import { round } from "./util.js";
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

function moveFrom(price, close, date) {
  if (price == null || close == null || close === 0) {
    return { close: close ?? null, date: date ?? null, change: null, changePercent: null };
  }
  const change = price - close;
  return {
    close: round(close, 4),
    date: date ?? null,
    change: round(change, 4),
    changePercent: round((change / close) * 100, 4),
  };
}

export async function buildHeatmap() {
  const constituents = await loadConstituents();
  const symbols = constituents.map((stock) => stock.symbol);
  const [weightBook, history, quotes] = await Promise.all([
    loadWeights(),
    loadHistory(symbols),
    fetchQuotes(symbols),
  ]);

  const stocks = constituents.map((stock) => {
    const quote = quotes.get(stock.symbol);
    const past = history.get(stock.symbol);
    const weight = weightBook.weights.get(stock.symbol) ?? null;
    const periods = {
      day: moveFrom(quote?.price, quote?.previousClose, past?.previousSession),
    };
    for (const lookback of LOOKBACKS) {
      if (lookback.id === "day") continue;
      const reference = past?.[lookback.id];
      periods[lookback.id] = moveFrom(quote?.price, reference?.close, reference?.date);
    }
    return {
      symbol: stock.symbol,
      name: stock.name,
      sector: stock.sector,
      subIndustry: stock.subIndustry,
      weight,
      price: quote?.price ?? null,
      previousClose: quote?.previousClose ?? null,
      regularPrice: quote?.regularPrice ?? null,
      change: periods.day.change,
      changePercent: periods.day.changePercent,
      extendedChangePercent: quote?.extendedChangePercent ?? null,
      session: quote?.session ?? null,
      periods,
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
    comparison: LOOKBACKS[0].comparison,
    lookbacks: LOOKBACKS.map(({ id, label, scale, comparison }) => ({ id, label, scale, comparison })),
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
