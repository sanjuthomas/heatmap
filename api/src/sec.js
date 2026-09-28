import { fetchWithRetry } from "./util.js";

const SEC_USER_AGENT = "SP500Heatmap/1.0 (sanju@sanju.org)";
const FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK";

const OPERATING_CASH_FLOW = ["NetCashProvidedByUsedInOperatingActivities"];
const CAPEX = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"];
const NET_INCOME = ["NetIncomeLoss"];
const DEPRECIATION = ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "Depreciation"];
const PROPERTY_GAIN = [
  "GainLossOnSaleOfProperties",
  "GainLossOnDispositionOfAssets1",
  "GainLossOnSaleOfPropertyPlantEquipment",
];
const BOOK_EQUITY = ["StockholdersEquity"];
const DIVIDENDS = ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends", "PaymentsOfOrdinaryDividends"];
const CASH = [
  "CashAndCashEquivalentsAtCarryingValue",
  "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
];
const SHARES = [
  "WeightedAverageNumberOfDilutedSharesOutstanding",
  "WeightedAverageNumberOfShareOutstandingBasicAndDiluted",
  "CommonStockSharesOutstanding",
  "EntityCommonStockSharesOutstanding",
];
const LONG_TERM_DEBT = ["LongTermDebt"];
const LONG_TERM_NONCURRENT = ["LongTermDebtNoncurrent"];
const LONG_TERM_CURRENT = ["LongTermDebtCurrent", "DebtCurrent"];
const SHORT_DEBT = ["ShortTermBorrowings"];
const COMMERCIAL_PAPER = ["CommercialPaper"];

let paceChain = Promise.resolve();

function pace() {
  const run = paceChain.then(() => new Promise((resolve) => setTimeout(resolve, 130)));
  paceChain = run.catch(() => {});
  return run;
}

function isAnnual(row) {
  if (!row?.end || row.val == null || !Number.isFinite(Number(row.val))) return false;
  const form = row.form || "";
  if (!form.startsWith("10-K") && form !== "20-F" && form !== "40-F") return false;
  if (row.fp && row.fp !== "FY") return false;
  if (row.start) {
    const days = (Date.parse(row.end) - Date.parse(row.start)) / 86_400_000;
    if (!Number.isFinite(days) || days < 300) return false;
  }
  return true;
}

function seriesFor(facts, name) {
  const concept = facts?.facts?.["us-gaap"]?.[name] ?? facts?.facts?.dei?.[name];
  const units = concept?.units;
  if (!units) return [];
  const rows = units.USD ?? units.shares ?? units.pure ?? Object.values(units)[0];
  if (!Array.isArray(rows)) return [];
  const byEnd = new Map();
  for (const row of rows) {
    if (!isAnnual(row)) continue;
    const previous = byEnd.get(row.end);
    if (!previous || String(row.filed || "") >= String(previous.filed || "")) byEnd.set(row.end, row);
  }
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}

function valueAtEnd(facts, names, end) {
  for (const name of names) {
    const value = valueOn(seriesFor(facts, name), end);
    if (value != null) return value;
  }
  return null;
}

function valueOn(series, end) {
  if (!series.length || !end) return null;
  const exact = series.find((row) => row.end === end);
  if (exact) return Number(exact.val);
  const target = Date.parse(end);
  let best = null;
  for (const row of series) {
    const delta = Math.abs(Date.parse(row.end) - target);
    if (delta <= 5 * 86_400_000 && (!best || delta < best.delta)) best = { delta, value: Number(row.val) };
  }
  return best?.value ?? null;
}

function debtOn(facts, end) {
  const longTerm = valueAtEnd(facts, LONG_TERM_DEBT, end);
  const noncurrent = valueAtEnd(facts, LONG_TERM_NONCURRENT, end);
  const current = valueAtEnd(facts, LONG_TERM_CURRENT, end);
  const shortTerm = valueAtEnd(facts, SHORT_DEBT, end) ?? 0;
  const paper = valueAtEnd(facts, COMMERCIAL_PAPER, end) ?? 0;
  if (noncurrent != null || current != null) return (noncurrent ?? 0) + (current ?? 0) + shortTerm + paper;
  if (longTerm != null) return longTerm + shortTerm + paper;
  if (shortTerm || paper) return shortTerm + paper;
  return null;
}

function usableHistory(values) {
  if (!values.length || values.at(-1) == null) return [];
  const first = values.findIndex((value) => value != null);
  return values.slice(first).filter((value) => value != null);
}

export function fundamentalsFromFacts(facts) {
  const cashFlow = seriesFor(facts, OPERATING_CASH_FLOW[0]);
  const income = seriesFor(facts, NET_INCOME[0]);
  const fiscalYearEnd = cashFlow.at(-1)?.end ?? income.at(-1)?.end ?? null;
  if (!fiscalYearEnd) return { fiscalYearEnd: null };

  const fcfHistory = usableHistory(
    cashFlow
      .filter((row) => row.end <= fiscalYearEnd)
      .slice(-4)
      .map((row) => {
        const capex = valueAtEnd(facts, CAPEX, row.end);
        if (capex == null) return null;
        return Number(row.val) - Math.abs(capex);
      }),
  );

  const ffoHistory = usableHistory(
    income
      .filter((row) => row.end <= fiscalYearEnd)
      .slice(-4)
      .map((row) => {
        const depreciation = valueAtEnd(facts, DEPRECIATION, row.end);
        if (depreciation == null) return null;
        const gain = valueAtEnd(facts, PROPERTY_GAIN, row.end) ?? 0;
        return Number(row.val) + Math.abs(depreciation) - gain;
      }),
  );

  const shares = valueAtEnd(facts, SHARES, fiscalYearEnd);
  const cash = valueAtEnd(facts, CASH, fiscalYearEnd);
  const debt = debtOn(facts, fiscalYearEnd);
  const netDebt = debt == null && cash == null ? null : (debt ?? 0) - (cash ?? 0);

  return {
    fiscalYearEnd,
    fcfHistory,
    ffoHistory,
    netIncome: valueOn(income, fiscalYearEnd),
    bookEquity: valueAtEnd(facts, BOOK_EQUITY, fiscalYearEnd),
    dividends: valueAtEnd(facts, DIVIDENDS, fiscalYearEnd),
    shares,
    netDebt,
  };
}

export async function fetchCompanyFacts(cik) {
  const padded = String(cik).padStart(10, "0");
  await pace();
  const response = await fetchWithRetry(
    `${FACTS_URL}${padded}.json`,
    { headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json" }, timeoutMs: 30000 },
    2,
  );
  return response.json();
}
