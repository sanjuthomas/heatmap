import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { fetchWithRetry, USER_AGENT } from "./util.js";

const FALLBACK_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "weights.json",
);
const SPY_URL =
  "https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx";
const TTL_MS = 6 * 60 * 60 * 1000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "row" || name === "c" || name === "si" || name === "r" || name === "t",
  parseTagValue: false,
});

let cache = { at: 0, value: null };

function textOf(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object") return textOf(node["#text"] ?? "");
  return "";
}

function sharedStrings(document) {
  const items = document?.sst?.si ?? [];
  return items.map((item) => {
    if (item.t) return textOf(item.t);
    return (item.r ?? []).map((run) => textOf(run.t)).join("");
  });
}

function cellValue(cell, strings) {
  const raw = textOf(cell.v);
  if (!raw) return "";
  if (cell["@_t"] === "s") return strings[Number(raw)] ?? "";
  return raw;
}

function columnOf(reference) {
  return String(reference ?? "").replace(/[0-9]/g, "");
}

export function parseSpyWorkbook(xmlFiles) {
  const strings = sharedStrings(parser.parse(xmlFiles.sharedStrings));
  const sheet = parser.parse(xmlFiles.sheet);
  const rows = sheet?.worksheet?.sheetData?.row ?? [];
  const weights = new Map();
  let asOf = null;

  for (const row of rows) {
    const cells = {};
    for (const cell of row.c ?? []) {
      cells[columnOf(cell["@_r"])] = cellValue(cell, strings);
    }
    if (!asOf && cells.A === "Holdings:" && cells.B) {
      asOf = cells.B.replace(/^As of\s+/i, "").trim();
    }
    const symbol = cells.B?.trim();
    const weight = Number(cells.E);
    if (!symbol || symbol === "Ticker" || symbol === "-" || !Number.isFinite(weight) || weight <= 0) {
      continue;
    }
    weights.set(symbol, weight);
  }

  if (weights.size < 450) {
    throw new Error(`SPY holdings parsed ${weights.size} weights`);
  }
  return { asOf, weights };
}

async function fromDisk() {
  const parsed = JSON.parse(await readFile(FALLBACK_FILE, "utf8"));
  return {
    asOf: parsed.asOf ?? null,
    weights: new Map(Object.entries(parsed.weights ?? {})),
    source: "snapshot",
  };
}

async function fromSsga() {
  const response = await fetchWithRetry(SPY_URL, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
    },
    timeoutMs: 20000,
  });
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
  const shared = await zip.file("xl/sharedStrings.xml")?.async("string");
  if (!sheet || !shared) throw new Error("SPY workbook is missing a worksheet");
  const parsed = parseSpyWorkbook({ sheet, sharedStrings: shared });
  return { ...parsed, source: "spy" };
}

export async function loadWeights() {
  if (cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const value = await fromSsga();
    cache = { at: Date.now(), value };
    return value;
  } catch (error) {
    if (cache.value) return cache.value;
    const value = await fromDisk();
    if (value.weights.size < 450) throw error;
    cache = { at: Date.now(), value };
    console.warn(`Using bundled SPY weights (${error.message})`);
    return value;
  }
}
