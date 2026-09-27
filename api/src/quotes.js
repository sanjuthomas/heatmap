import { fetchWithRetry, parseNumber, round, USER_AGENT } from "./util.js";

const QUOTE_URL = "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol";

function sessionPrice(quote) {
  const regularPrice = parseNumber(quote.last);
  const previousClose = parseNumber(quote.previous_day_closing);
  const status = quote.curmktstatus || "UNKNOWN";
  const extended = quote.ExtendedMktQuote;
  const extendedPrice = parseNumber(extended?.last);
  const extendedType = extended?.type;
  const useExtended =
    (status === "PRE_MKT" || status === "POST_MKT") &&
    extendedPrice != null &&
    extendedType === status;

  const price = useExtended ? extendedPrice : regularPrice;
  const session = useExtended ? (status === "PRE_MKT" ? "pre" : "post") : "regular";
  const change = price != null && previousClose ? price - previousClose : null;
  const changePercent =
    change != null && previousClose ? (change / previousClose) * 100 : null;
  const extendedChangePercent =
    session === "post" && price != null && regularPrice
      ? ((price - regularPrice) / regularPrice) * 100
      : null;

  return {
    price: round(price, 4),
    previousClose: round(previousClose, 4),
    regularPrice: round(regularPrice, 4),
    change: round(change, 4),
    changePercent: round(changePercent, 4),
    extendedChangePercent: round(extendedChangePercent, 4),
    session,
    marketStatus: status,
    quoteTime: (useExtended ? extended?.last_timedate : quote.last_timedate) || quote.last_timedate || null,
    realtime: quote.realTime === true || quote.realTime === "true",
  };
}

export async function fetchQuotes(symbols) {
  const url = new URL(QUOTE_URL);
  url.searchParams.set("symbols", symbols.join("|"));
  url.searchParams.set("requestMethod", "itv");
  url.searchParams.set("noform", "1");
  url.searchParams.set("partnerId", "2");
  url.searchParams.set("fund", "1");
  url.searchParams.set("exthrs", "1");
  url.searchParams.set("output", "json");

  const response = await fetchWithRetry(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    timeoutMs: 15000,
  });
  const payload = await response.json();
  const rows = payload?.FormattedQuoteResult?.FormattedQuote;
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const quotes = new Map();

  for (const row of list) {
    if (!row?.symbol) continue;
    if (row.code != null && Number(row.code) !== 0) continue;
    quotes.set(row.symbol, sessionPrice(row));
  }
  if (quotes.size < 400) {
    throw new Error(`quote feed returned ${quotes.size} symbols`);
  }
  return quotes;
}
