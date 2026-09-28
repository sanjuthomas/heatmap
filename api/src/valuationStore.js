import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "sp500-heatmap-sj";
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "valuations.json");
const TTL_MS = 6 * 60 * 60 * 1000;

let cache = { at: 0, snapshot: null };

function onCloudRun() {
  return Boolean(process.env.K_SERVICE);
}

async function readFileSnapshot() {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    return null;
  }
}

async function readFirestoreSnapshot() {
  const { Firestore } = await import("@google-cloud/firestore");
  const snapshot = await new Firestore({ projectId: PROJECT_ID }).collection("valuations").doc("latest").get();
  return snapshot.exists ? snapshot.data() : null;
}

export async function loadValuation() {
  if (cache.snapshot && Date.now() - cache.at < TTL_MS) return cache.snapshot;
  try {
    const snapshot = onCloudRun() ? (await readFirestoreSnapshot()) ?? (await readFileSnapshot()) : (await readFileSnapshot()) ?? (await readFirestoreSnapshot());
    cache = { at: Date.now(), snapshot: snapshot ?? { computedAt: null, stocks: {} } };
  } catch (error) {
    console.warn(`Valuation snapshot unavailable (${error.message})`);
    cache = { at: Date.now(), snapshot: cache.snapshot ?? { computedAt: null, stocks: {} } };
  }
  return cache.snapshot;
}

export function valuationFor(snapshot, symbol) {
  return snapshot?.stocks?.[symbol] ?? null;
}

export async function saveValuation(snapshot, { fileOnly = false } = {}) {
  await writeFile(FILE, JSON.stringify(snapshot));
  if (fileOnly) return { firestore: false };
  const { Firestore } = await import("@google-cloud/firestore");
  await new Firestore({ projectId: PROJECT_ID }).collection("valuations").doc("latest").set(snapshot);
  return { firestore: true };
}
