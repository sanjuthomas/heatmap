import { fetchWithRetry, round } from "./util.js";

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
const RATIO_NET_INCOME = [
  "NetIncomeLossAttributableToParent",
  "NetIncomeLoss",
  "ProfitLossAttributableToOwnersOfParent",
  "ProfitLoss",
];
const RATIO_EQUITY = [
  "StockholdersEquity",
  "EquityAttributableToOwnersOfParent",
  "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
];
const RATIO_ASSETS = ["Assets"];
const RATIO_OPERATING = ["OperatingIncomeLoss", "ProfitLossFromOperatingActivities"];
const RATIO_PRETAX = [
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxExpenseBenefit",
  "ProfitLossBeforeTax",
];
const RATIO_TAX = ["IncomeTaxExpenseBenefit", "IncomeTaxExpenseContinuingOperations"];
const RATIO_CASH = [...CASH, "CashAndCashEquivalents"];
const RATIO_BORROWINGS_NONCURRENT = ["NoncurrentBorrowings"];
const RATIO_BORROWINGS_CURRENT = ["CurrentBorrowings"];
const RATIO_BORROWINGS = ["Borrowings"];
const RATIO_LONG_TERM_TOTAL = [
  "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
  "ConvertibleLongTermNotesPayable",
];

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
  const concept = facts?.facts?.["us-gaap"]?.[name] ?? facts?.facts?.dei?.[name] ?? facts?.facts?.["ifrs-full"]?.[name];
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
  const inclusive = valueAtEnd(facts, RATIO_LONG_TERM_TOTAL, end);
  // The current-maturity tag is only the portion due within a year. It is not total debt.
  if (noncurrent != null) return noncurrent + (current ?? 0) + shortTerm + paper;
  if (inclusive != null && (longTerm == null || (inclusive >= longTerm * 0.95 && inclusive <= longTerm * 1.25))) {
    return inclusive + shortTerm + paper;
  }
  if (longTerm != null) return longTerm + shortTerm + paper;
  if (inclusive != null) return inclusive + shortTerm + paper;
  if (current != null || shortTerm || paper) return (current ?? 0) + shortTerm + paper;
  return null;
}

function stockholdersEquity(facts, end) {
  const parent = valueAtEnd(facts, ["StockholdersEquity", "EquityAttributableToOwnersOfParent"], end);
  if (parent != null) return parent;
  const inclusive = valueAtEnd(facts, ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], end);
  if (inclusive == null) return null;
  const minority = valueAtEnd(facts, ["MinorityInterest", "StockholdersEquityAttributableToNoncontrollingInterest"], end) ?? 0;
  const equity = inclusive - minority;
  return equity > 0 ? equity : null;
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

function ratioOf(numerator, denominator) {
  if (numerator == null || !(denominator > 0)) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? round(value, 4) : null;
}

function averageBalance(current, prior) {
  if (current == null) return null;
  if (prior == null) return current;
  return (current + prior) / 2;
}

function latestFiscalYearEnd(facts) {
  const ends = [];
  for (const name of RATIO_NET_INCOME) {
    const end = seriesFor(facts, name).at(-1)?.end;
    if (end) ends.push(end);
  }
  return ends.sort().at(-1) ?? null;
}

function priorFiscalYearEnd(facts, end) {
  const ends = new Set();
  for (const name of [...RATIO_NET_INCOME, ...RATIO_EQUITY, ...RATIO_ASSETS]) {
    for (const row of seriesFor(facts, name)) {
      if (row.end < end) ends.add(row.end);
    }
  }
  return [...ends].sort().at(-1) ?? null;
}

function ratioDebt(facts, end) {
  const standardLongTerm = valueAtEnd(facts, LONG_TERM_DEBT, end);
  const noncurrent = valueAtEnd(facts, LONG_TERM_NONCURRENT, end);
  const current = valueAtEnd(facts, LONG_TERM_CURRENT, end);
  if (standardLongTerm == null && noncurrent == null && current == null) {
    const longTermTotal = valueAtEnd(facts, RATIO_LONG_TERM_TOTAL, end);
    if (longTermTotal != null) {
      const shortTerm = valueAtEnd(facts, SHORT_DEBT, end) ?? 0;
      const paper = valueAtEnd(facts, COMMERCIAL_PAPER, end) ?? 0;
      return longTermTotal + shortTerm + paper;
    }
  }
  const reported = debtOn(facts, end);
  if (reported != null) return reported;
  const ifrsNoncurrent = valueAtEnd(facts, RATIO_BORROWINGS_NONCURRENT, end);
  const ifrsCurrent = valueAtEnd(facts, RATIO_BORROWINGS_CURRENT, end);
  if (ifrsNoncurrent != null || ifrsCurrent != null) return (ifrsNoncurrent ?? 0) + (ifrsCurrent ?? 0);
  return valueAtEnd(facts, RATIO_BORROWINGS, end);
}

function investedCapital(facts, end) {
  const equity = stockholdersEquity(facts, end);
  const debt = ratioDebt(facts, end);
  if (!(equity > 0) || debt == null) return null;
  const cash = valueAtEnd(facts, RATIO_CASH, end) ?? 0;
  const capital = equity + debt - cash;
  return capital > 0 ? capital : null;
}

function effectiveTaxRate(facts, end) {
  const pretax = valueAtEnd(facts, RATIO_PRETAX, end);
  const tax = valueAtEnd(facts, RATIO_TAX, end);
  if (!(pretax > 0) || tax == null) return null;
  return Math.min(0.5, Math.max(0, tax / pretax));
}

export function ratiosFromFacts(facts) {
  const fiscalYearEnd = latestFiscalYearEnd(facts);
  const empty = { fiscalYearEnd, roe: null, roa: null, roic: null, debtToEquity: null, ebitda: null, ebitdaMargin: null };
  if (!fiscalYearEnd) return empty;

  const priorEnd = priorFiscalYearEnd(facts, fiscalYearEnd);
  const netIncome = valueAtEnd(facts, RATIO_NET_INCOME, fiscalYearEnd);
  const equity = stockholdersEquity(facts, fiscalYearEnd);
  const priorEquity = priorEnd ? stockholdersEquity(facts, priorEnd) : null;
  const assets = valueAtEnd(facts, RATIO_ASSETS, fiscalYearEnd);
  const priorAssets = priorEnd ? valueAtEnd(facts, RATIO_ASSETS, priorEnd) : null;
  const debt = ratioDebt(facts, fiscalYearEnd);

  const operatingIncome = valueAtEnd(facts, RATIO_OPERATING, fiscalYearEnd);
  const taxRate = effectiveTaxRate(facts, fiscalYearEnd);
  const capital = averageBalance(investedCapital(facts, fiscalYearEnd), priorEnd ? investedCapital(facts, priorEnd) : null);
  const nopat = operatingIncome == null || taxRate == null ? null : operatingIncome * (1 - taxRate);
  const ebitda = ebitdaOn(facts, fiscalYearEnd);

  return {
    fiscalYearEnd,
    roe: equity > 0 ? ratioOf(netIncome, averageBalance(equity, priorEquity)) : null,
    roa: assets > 0 ? ratioOf(netIncome, averageBalance(assets, priorAssets)) : null,
    roic: ratioOf(nopat, capital),
    debtToEquity: ratioOf(debt, equity),
    ebitda,
    ebitdaMargin: ebitdaMarginOn(facts, fiscalYearEnd, ebitda),
  };
}

const EBITDA_DEPRECIATION = [...DEPRECIATION, "DepreciationAmortizationAndAccretionNet"];
const EBITDA_INTEREST = ["InterestExpense", "InterestExpenseNonoperating", "InterestAndDebtExpense"];
const EBITDA_INVENTORY_INTEREST = ["RealEstateInventoryCapitalizedInterestCostsCostOfSales1"];

function ebitdaOn(facts, end) {
  const depreciation = valueAtEnd(facts, EBITDA_DEPRECIATION, end);
  if (depreciation == null) return null;
  const operatingIncome = valueAtEnd(facts, RATIO_OPERATING, end);
  if (operatingIncome != null) {
    const ebitda = operatingIncome + Math.abs(depreciation);
    return Number.isFinite(ebitda) ? round(ebitda, 0) : null;
  }
  // Homebuilders and a few other filers never tag operating income. Pretax is after interest.
  const pretax = pretaxIncome(facts, end);
  if (pretax == null) return null;
  const ebitda = pretax + interestExpensed(facts, end) + Math.abs(depreciation);
  return Number.isFinite(ebitda) ? round(ebitda, 0) : null;
}

function pretaxIncome(facts, end) {
  const combined = valueAtEnd(facts, RATIO_PRETAX, end);
  if (combined != null) return combined;
  const domestic = valueAtEnd(facts, ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"], end);
  const foreign = valueAtEnd(facts, ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesForeign"], end);
  if (domestic == null && foreign == null) return null;
  return (domestic ?? 0) + (foreign ?? 0);
}

const EBITDA_REVENUE = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  "RegulatedAndUnregulatedOperatingRevenue",
  "OperatingRevenue",
];

function revenueOn(facts, end) {
  const total = valueAtEnd(facts, EBITDA_REVENUE, end);
  if (total > 0) return total;
  const goods = valueAtEnd(facts, ["SalesRevenueGoodsNet"], end);
  const services = valueAtEnd(facts, ["SalesRevenueServicesNet"], end);
  if (goods == null && services == null) return null;
  const revenue = (goods ?? 0) + (services ?? 0);
  return revenue > 0 ? revenue : null;
}

function ebitdaMarginOn(facts, end, ebitda) {
  if (ebitda == null) return null;
  return ratioOf(ebitda, revenueOn(facts, end));
}

function interestExpensed(facts, end) {
  const direct = valueAtEnd(facts, EBITDA_INTEREST, end) ?? 0;
  const inInventory = valueAtEnd(facts, EBITDA_INVENTORY_INTEREST, end) ?? 0;
  return Math.abs(direct) + Math.abs(inInventory);
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
