import { round } from "./util.js";

export const ASSUMPTIONS = {
  years: 10,
  discountRate: 0.09,
  terminalGrowth: 0.025,
  minGrowth: -0.05,
  maxGrowth: 0.12,
  assumedGrowth: 0.04,
  minRoe: -0.2,
  maxRoe: 0.3,
};

const MODEL_LABEL = {
  dcf: "Free cash flow",
  residual: "Residual income",
  ffo: "Funds from operations",
};

const RESIDUAL_INDUSTRIES = new Set([
  "Diversified Banks",
  "Regional Banks",
  "Consumer Finance",
  "Investment Banking & Brokerage",
  "Life & Health Insurance",
  "Multi-Sector Holdings",
  "Multi-line Insurance",
  "Property & Casualty Insurance",
  "Reinsurance",
]);

const MAX_FILING_AGE_MS = 800 * 24 * 60 * 60 * 1000;
const MIN_PEERS = 4;
const MULTIPLE_BOUNDS = {
  pe: [5, 60],
  pb: [0.4, 5],
  pffo: [8, 30],
};

export function perShareMetric(model, fundamentals) {
  const shares = fundamentals?.shares;
  if (!shares) return null;
  if (model === "residual") {
    if (!(fundamentals.bookEquity > 0)) return null;
    return { kind: "pb", label: "P/B", perShare: fundamentals.bookEquity / shares };
  }
  if (model === "ffo") {
    const ffo = fundamentals.ffoHistory?.at(-1);
    if (!(ffo > 0)) return null;
    return { kind: "pffo", label: "P/FFO", perShare: ffo / shares };
  }
  if (!(fundamentals.netIncome > 0)) return null;
  return { kind: "pe", label: "P/E", perShare: fundamentals.netIncome / shares };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function withinBounds(row) {
  const [min, max] = MULTIPLE_BOUNDS[row.kind];
  return row.ratio >= min && row.ratio <= max;
}

export function peerValuations(observations) {
  const grouped = new Map();
  for (const row of observations) {
    if (!withinBounds(row)) continue;
    for (const key of [`sub|${row.kind}|${row.subIndustry}`, `sector|${row.kind}|${row.sector}`]) {
      const list = grouped.get(key) ?? [];
      list.push(row);
      grouped.set(key, list);
    }
  }

  const bySymbol = {};
  for (const row of observations) {
    const sub = (grouped.get(`sub|${row.kind}|${row.subIndustry}`) ?? []).filter((peer) => peer.symbol !== row.symbol);
    const sector = (grouped.get(`sector|${row.kind}|${row.sector}`) ?? []).filter((peer) => peer.symbol !== row.symbol);
    const peers = sub.length >= MIN_PEERS ? sub : sector.length >= MIN_PEERS ? sector : null;
    if (!peers || !(row.perShare > 0)) continue;
    const multiple = median(peers.map((peer) => peer.ratio));
    const fairValue = multiple * row.perShare;
    if (!Number.isFinite(fairValue) || fairValue <= 0) continue;
    const groupName = peers === sub ? row.subIndustry : row.sector;
    bySymbol[row.symbol] = {
      multipleFairValue: round(fairValue, 2),
      multipleLabel: row.label,
      multipleNote: `Median ${groupName} ${row.label} of ${multiple.toFixed(1)}×`,
    };
  }
  return bySymbol;
}

export function selectModel(stock) {
  if (stock.sector === "Real Estate" && stock.subIndustry !== "Real Estate Services") return "ffo";
  if (RESIDUAL_INDUSTRIES.has(stock.subIndustry)) return "residual";
  return "dcf";
}

export function assumptionText(model) {
  if (model === "residual") return "10-year residual income at 9%, fading to book value";
  return "10-year discount at 9%, then 2.5% growth";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function unavailable(model, reason, fiscalYearEnd = null) {
  return {
    status: "unavailable",
    reason,
    model,
    modelLabel: MODEL_LABEL[model],
    assumption: assumptionText(model),
    fairValue: null,
    fiscalYearEnd,
    growth: null,
  };
}

function priced(model, fairValue, fiscalYearEnd, growth) {
  return {
    status: "ok",
    reason: null,
    model,
    modelLabel: MODEL_LABEL[model],
    assumption: assumptionText(model),
    fairValue: round(fairValue, 2),
    fiscalYearEnd,
    growth: growth == null ? null : round(growth, 4),
  };
}

export function growthRate(values) {
  const series = values.filter((value) => value != null && Number.isFinite(value));
  if (series.length < 3 || series[0] <= 0 || series.at(-1) <= 0) {
    return ASSUMPTIONS.assumedGrowth;
  }
  const raw = (series.at(-1) / series[0]) ** (1 / (series.length - 1)) - 1;
  return clamp(raw, ASSUMPTIONS.minGrowth, ASSUMPTIONS.maxGrowth);
}

function filingIsCurrent(fiscalYearEnd) {
  const time = Date.parse(fiscalYearEnd);
  return Number.isFinite(time) && Date.now() - time <= MAX_FILING_AGE_MS;
}

function discountCashFlows(latest, growth) {
  const { years, discountRate, terminalGrowth } = ASSUMPTIONS;
  let present = 0;
  let cash = latest;
  for (let year = 1; year <= years; year += 1) {
    const yearGrowth = growth + (terminalGrowth - growth) * (year / years);
    cash *= 1 + yearGrowth;
    present += cash / (1 + discountRate) ** year;
  }
  const terminal = (cash * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  present += terminal / (1 + discountRate) ** years;
  return present;
}

export function valueCompany(model, fundamentals) {
  const fiscalYearEnd = fundamentals.fiscalYearEnd ?? null;
  if (!fiscalYearEnd) return unavailable(model, "Annual filing is missing", null);
  if (!filingIsCurrent(fiscalYearEnd)) {
    return unavailable(model, "Filing is more than two years old", fiscalYearEnd);
  }
  if (!fundamentals.shares || fundamentals.shares <= 0) {
    return unavailable(model, "Diluted share count is missing", fiscalYearEnd);
  }

  if (model === "dcf") {
    const history = fundamentals.fcfHistory ?? [];
    const latest = history.at(-1);
    if (latest == null) return unavailable(model, "Free cash flow is missing", fiscalYearEnd);
    if (latest <= 0) return unavailable(model, "Latest free cash flow is not positive", fiscalYearEnd);
    const growth = growthRate(history);
    const enterprise = discountCashFlows(latest, growth);
    const equity = enterprise - (fundamentals.netDebt ?? 0);
    if (equity <= 0) return unavailable(model, "Debt exceeds the value of the cash flows", fiscalYearEnd);
    return priced(model, equity / fundamentals.shares, fiscalYearEnd, growth);
  }

  if (model === "ffo") {
    const history = fundamentals.ffoHistory ?? [];
    const latest = history.at(-1);
    if (latest == null) return unavailable(model, "Funds from operations are missing", fiscalYearEnd);
    if (latest <= 0) return unavailable(model, "Latest funds from operations are not positive", fiscalYearEnd);
    const growth = growthRate(history);
    const equity = discountCashFlows(latest, growth);
    if (equity <= 0) return unavailable(model, "Model did not produce a positive value", fiscalYearEnd);
    return priced(model, equity / fundamentals.shares, fiscalYearEnd, growth);
  }

  const { bookEquity, netIncome, dividends } = fundamentals;
  if (bookEquity == null || bookEquity <= 0 || netIncome == null) {
    return unavailable(model, "Book equity is missing", fiscalYearEnd);
  }
  const dividend = Math.abs(dividends ?? 0);
  const beginning = bookEquity - netIncome + dividend;
  const equityBase = beginning > bookEquity * 0.2 ? beginning : bookEquity;
  const roe = clamp(netIncome / equityBase, ASSUMPTIONS.minRoe, ASSUMPTIONS.maxRoe);
  const payout = netIncome > 0 ? clamp(dividend / netIncome, 0, 1) : 0;
  const retention = 1 - payout;
  const { years, discountRate } = ASSUMPTIONS;
  let book = bookEquity;
  let present = 0;
  for (let year = 1; year <= years; year += 1) {
    const yearRoe = roe + (discountRate - roe) * (year / years);
    present += ((yearRoe - discountRate) * book) / (1 + discountRate) ** year;
    book += yearRoe * book * retention;
  }
  const equity = bookEquity + present;
  if (equity <= 0) return unavailable(model, "Model did not produce a positive value", fiscalYearEnd);
  return priced(model, equity / fundamentals.shares, fiscalYearEnd, null);
}
