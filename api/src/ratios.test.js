import assert from "node:assert/strict";
import test from "node:test";
import { presentRatios, usesEbitda } from "./ratios.js";
import { ratiosFromFacts } from "./sec.js";

function filing(end, val, { start = null, form = "10-K", fp = "FY" } = {}) {
  const row = { end, val, form, fp, filed: end };
  if (start) row.start = start;
  return row;
}

function factsFrom(concepts) {
  const gaap = {};
  for (const [name, rows] of Object.entries(concepts)) {
    gaap[name] = { units: { USD: rows } };
  }
  return { facts: { "us-gaap": gaap } };
}

const YEAR = {
  "2023-12-31": "2023-01-01",
  "2024-12-31": "2024-01-01",
};

test("annual ratios use average balances and year-end debt", () => {
  const rows = (values) => Object.entries(values).map(([end, val]) => filing(end, val, { start: YEAR[end] }));
  const instant = (values) => Object.entries(values).map(([end, val]) => filing(end, val));
  const ratios = ratiosFromFacts(factsFrom({
    NetIncomeLossAttributableToParent: rows({ "2023-12-31": 80, "2024-12-31": 100 }),
    StockholdersEquity: instant({ "2023-12-31": 400, "2024-12-31": 600 }),
    Assets: instant({ "2023-12-31": 900, "2024-12-31": 1100 }),
    OperatingIncomeLoss: rows({ "2024-12-31": 150 }),
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: rows({ "2024-12-31": 120 }),
    IncomeTaxExpenseBenefit: rows({ "2024-12-31": 24 }),
    LongTermDebtNoncurrent: instant({ "2023-12-31": 180, "2024-12-31": 200 }),
    LongTermDebtCurrent: instant({ "2023-12-31": 20, "2024-12-31": 20 }),
    CashAndCashEquivalentsAtCarryingValue: instant({ "2023-12-31": 40, "2024-12-31": 50 }),
  }));

  assert.equal(ratios.fiscalYearEnd, "2024-12-31");
  assert.equal(ratios.roe, 0.2);
  assert.equal(ratios.roa, 0.1);
  assert.equal(ratios.debtToEquity, 0.3667);
  assert.equal(ratios.roic, 0.1805);
  assert.equal(ratios.ebitda, null);
});

test("ebitda adds depreciation back to operating income", () => {
  const ratios = ratiosFromFacts(factsFrom({
    NetIncomeLoss: [filing("2024-12-31", 80, { start: "2024-01-01" })],
    OperatingIncomeLoss: [filing("2024-12-31", 150, { start: "2024-01-01" })],
    DepreciationDepletionAndAmortization: [filing("2024-12-31", 40, { start: "2024-01-01" })],
  }));
  assert.equal(ratios.ebitda, 190);
});

test("operating income is used ahead of the pretax fallback", () => {
  const ratios = ratiosFromFacts(factsFrom({
    NetIncomeLoss: [filing("2024-12-31", 80, { start: "2024-01-01" })],
    OperatingIncomeLoss: [filing("2024-12-31", 150, { start: "2024-01-01" })],
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: [filing("2024-12-31", 100, { start: "2024-01-01" })],
    InterestExpense: [filing("2024-12-31", 80, { start: "2024-01-01" })],
    DepreciationDepletionAndAmortization: [filing("2024-12-31", 40, { start: "2024-01-01" })],
  }));
  assert.equal(ratios.ebitda, 190);
});

test("missing operating income uses pretax, interest, and depreciation", () => {
  const ratios = ratiosFromFacts(factsFrom({
    NetIncomeLoss: [filing("2024-12-31", 80, { start: "2024-01-01" })],
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: [filing("2024-12-31", 100, { start: "2024-01-01" })],
    InterestExpense: [filing("2024-12-31", 15, { start: "2024-01-01" })],
    RealEstateInventoryCapitalizedInterestCostsCostOfSales1: [filing("2024-12-31", 5, { start: "2024-01-01" })],
    DepreciationAmortizationAndAccretionNet: [filing("2024-12-31", 10, { start: "2024-01-01" })],
  }));
  assert.equal(ratios.ebitda, 130);
});

test("pretax split between domestic and foreign is added together", () => {
  const ratios = ratiosFromFacts(factsFrom({
    NetIncomeLoss: [filing("2024-12-31", 70, { start: "2024-01-01" })],
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic: [filing("2024-12-31", 80, { start: "2024-01-01" })],
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesForeign: [filing("2024-12-31", 20, { start: "2024-01-01" })],
    DepreciationAndAmortization: [filing("2024-12-31", 12, { start: "2024-01-01" })],
  }));
  assert.equal(ratios.ebitda, 112);
});

test("a negative depreciation tag is still added back", () => {
  const ratios = ratiosFromFacts(factsFrom({
    NetIncomeLoss: [filing("2024-12-31", 40, { start: "2024-01-01" })],
    OperatingIncomeLoss: [filing("2024-12-31", 100, { start: "2024-01-01" })],
    Depreciation: [filing("2024-12-31", -25, { start: "2024-01-01" })],
  }));
  assert.equal(ratios.ebitda, 125);
});

test("ebitda is kept for industrials, utilities, and consumer durables", () => {
  const ratios = { fiscalYearEnd: "2024-12-31", roe: 0.1, ebitda: 190 };
  assert.equal(usesEbitda({ sector: "Industrials", subIndustry: "Industrial Machinery & Supplies & Components" }), true);
  assert.equal(usesEbitda({ sector: "Utilities", subIndustry: "Electric Utilities" }), true);
  assert.equal(usesEbitda({ sector: "Consumer Discretionary", subIndustry: "Automobile Manufacturers" }), true);
  assert.equal(usesEbitda({ sector: "Consumer Discretionary", subIndustry: "Homebuilding" }), true);
  assert.equal(usesEbitda({ sector: "Consumer Discretionary", subIndustry: "Restaurants" }), false);
  assert.equal(usesEbitda({ sector: "Financials", subIndustry: "Diversified Banks" }), false);
  assert.equal(presentRatios({ sector: "Industrials", subIndustry: "Building Products" }, ratios).ebitda, 190);
  assert.equal(presentRatios({ sector: "Financials", subIndustry: "Diversified Banks" }, ratios).ebitda, null);
  assert.equal(presentRatios({ sector: "Consumer Discretionary", subIndustry: "Restaurants" }, ratios).ebitda, null);
});

test("missing operating income leaves return on capital empty", () => {
  const ratios = ratiosFromFacts(factsFrom({
    NetIncomeLoss: [filing("2024-12-31", 50, { start: "2024-01-01" })],
    StockholdersEquity: [filing("2024-12-31", 200)],
    Assets: [filing("2024-12-31", 500)],
    LongTermDebt: [filing("2024-12-31", 100)],
  }));
  assert.equal(ratios.roe, 0.25);
  assert.equal(ratios.roa, 0.1);
  assert.equal(ratios.debtToEquity, 0.5);
  assert.equal(ratios.roic, null);
});

test("negative equity does not produce a ratio", () => {
  const ratios = ratiosFromFacts(factsFrom({
    NetIncomeLoss: [filing("2024-12-31", 10, { start: "2024-01-01" })],
    StockholdersEquity: [filing("2024-12-31", -20)],
    Assets: [filing("2024-12-31", 80)],
  }));
  assert.equal(ratios.roe, null);
  assert.equal(ratios.debtToEquity, null);
  assert.equal(ratios.roa, 0.125);
});

test("uses the inclusive long-term debt total when the usual debt tags are absent", () => {
  const ratios = ratiosFromFacts(factsFrom({
    NetIncomeLoss: [filing("2024-12-31", 20, { start: "2024-01-01" })],
    StockholdersEquity: [filing("2024-12-31", 100)],
    ShortTermBorrowings: [filing("2024-12-31", 15)],
    LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: [filing("2024-12-31", 85)],
  }));
  assert.equal(ratios.debtToEquity, 1);
});

test("current maturities are not treated as total debt", () => {
  const ratios = ratiosFromFacts(factsFrom({
    NetIncomeLoss: [filing("2025-12-31", 21.9, { start: "2025-01-01" })],
    StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest: [filing("2025-12-31", 126.49)],
    MinorityInterest: [filing("2025-12-31", 15.96)],
    Assets: [filing("2025-12-31", 420.2)],
    LongTermDebt: [filing("2025-12-31", 134.72)],
    DebtCurrent: [filing("2025-12-31", 9.01)],
    LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: [filing("2025-12-31", 136.1)],
  }));
  assert.equal(ratios.debtToEquity, 1.2313);
});

test("does not add the inclusive debt total on top of standard long-term debt", () => {
  const ratios = ratiosFromFacts(factsFrom({
    NetIncomeLoss: [filing("2024-12-31", 20, { start: "2024-01-01" })],
    StockholdersEquity: [filing("2024-12-31", 100)],
    LongTermDebtNoncurrent: [filing("2024-12-31", 50)],
    LongTermDebtCurrent: [filing("2024-12-31", 10)],
    ShortTermBorrowings: [filing("2024-12-31", 5)],
    LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: [filing("2024-12-31", 200)],
  }));
  assert.equal(ratios.debtToEquity, 0.65);
});

test("falls back to equity that includes noncontrolling interest", () => {
  const ratios = ratiosFromFacts(factsFrom({
    NetIncomeLoss: [filing("2024-12-31", 20, { start: "2024-01-01" })],
    StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest: [filing("2024-12-31", 80)],
    Assets: [filing("2024-12-31", 400)],
    LongTermDebt: [filing("2024-12-31", 40)],
  }));
  assert.equal(ratios.roe, 0.25);
  assert.equal(ratios.debtToEquity, 0.5);
});

test("quarterly facts are ignored", () => {
  const ratios = ratiosFromFacts(factsFrom({
    NetIncomeLoss: [filing("2024-09-30", 10, { start: "2024-07-01", form: "10-Q", fp: "Q3" })],
    StockholdersEquity: [filing("2024-09-30", 100)],
  }));
  assert.equal(ratios.fiscalYearEnd, null);
  assert.equal(ratios.roe, null);
});
