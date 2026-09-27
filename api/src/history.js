import { fetchWithRetry, parseNumber, USER_AGENT } from "./util.js";

const BARS_URL = "https://ts-api.cnbc.com/harmony/app/bars";
const HISTORY_TTL_MS = 12 * 60 * 60 * 1000;
const CONCURRENCY = 12;

export const LOOKBACKS = [
  {
    id: "day",
    label: "Day",
    scale: 3,
    comparison: "Latest traded price versus the previous trading day's close.",
  },
  {
    id: "week",
    label: "Week",
    days: 7,
    scale: 8,
    comparison: "Latest traded price versus the close from one week earlier.",
  },
  {
    id: "month",
    label: "Month",
    months: 1,
    scale: 15,
    comparison: "Latest traded price versus the close from one month earlier.",
  },
  {
    id: "quarter",
    label: "Quarter",
    months: 3,
    scale: 25,
    comparison: "Latest traded price versus the close from one quarter earlier.",
  },
  {
    id: "year",
    label: "Year",
    months: 12,
    scale: 40,
    comparison: "Latest traded price versus the close from one year earlier.",
  },
];

let cache = { at: 0, symbolsKey: "", value: null };

function stamp(ms) {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}000000`;
}

function parseTradeTime(value) {
  const text = String(value ?? "");
  if (text.length < 8) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addMonths(ms, months) {
  const date = new Date(ms);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, daysInMonth));
  return date.getTime();
}

function referenceBar(bars, targetMs) {
  const last = bars.at(-1);
  if (!last) return null;
  let chosen = null;
  for (const bar of bars) {
    if (bar.time < last.time && bar.time <= targetMs) chosen = bar;
  }
  return chosen;
}

async function fetchBars(symbol) {
  const end = Date.now() + 24 * 60 * 60 * 1000;
  const start = Date.now() - 400 * 24 * 60 * 60 * 1000;
  const url = `${BARS_URL}/${encodeURIComponent(symbol)}/1D/${stamp(start)}/${stamp(end)}/adjusted/EST5EDT.json`;
  const response = await fetchWithRetry(
    url,
    { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, timeoutMs: 12000 },
    1,
  );
  const payload = await response.json();
  const rows = payload?.barData?.priceBars;
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const bars = rows
    .map((row) => ({
      time: parseTradeTime(row.tradeTime),
      close: parseNumber(row.close),
    }))
    .filter((row) => row.time != null && row.close != null)
    .sort((a, b) => a.time - b.time);
  return bars.length > 1 ? bars : null;
}

function closesFor(bars) {
  const last = bars.at(-1);
  const closes = {};
  for (const lookback of LOOKBACKS) {
    if (lookback.id === "day") continue;
    const target = lookback.months
      ? addMonths(last.time, -lookback.months)
      : last.time - lookback.days * 24 * 60 * 60 * 1000;
    const bar = referenceBar(bars, target);
    closes[lookback.id] = bar ? { close: bar.close, date: isoDate(bar.time) } : null;
  }
  const previous = bars.at(-2);
  closes.previousSession = previous ? isoDate(previous.time) : null;
  return closes;
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function fetchHistory(symbols) {
  const started = Date.now();
  const rows = await mapPool(symbols, CONCURRENCY, async (symbol) => {
    try {
      const bars = await fetchBars(symbol);
      return [symbol, bars ? closesFor(bars) : null];
    } catch (error) {
      console.warn(`History ${symbol}: ${error.message}`);
      return [symbol, null];
    }
  });
  const bySymbol = new Map(rows.filter((row) => row[1]));
  console.log(`History ${bySymbol.size}/${symbols.length} symbols in ${Date.now() - started}ms`);
  return bySymbol;
}

export async function loadHistory(symbols) {
  const symbolsKey = symbols.join(",");
  if (cache.value && cache.symbolsKey === symbolsKey && Date.now() - cache.at < HISTORY_TTL_MS) {
    return cache.value;
  }
  try {
    const value = await fetchHistory(symbols);
    if (value.size >= 400) cache = { at: Date.now(), symbolsKey, value };
    if (value.size < 400 && cache.value) return cache.value;
    return value;
  } catch (error) {
    if (cache.value) return cache.value;
    console.warn(`History unavailable (${error.message})`);
    return new Map();
  }
}
