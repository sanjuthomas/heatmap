import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "sp500-heatmap-sj";
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "ratios.json");

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
  const snapshot = await new Firestore({ projectId: PROJECT_ID }).collection("ratios").doc("latest").get();
  return snapshot.exists ? snapshot.data() : null;
}

export async function loadRatios() {
  try {
    return onCloudRun()
      ? (await readFirestoreSnapshot()) ?? (await readFileSnapshot())
      : (await readFileSnapshot()) ?? (await readFirestoreSnapshot());
  } catch (error) {
    console.warn(`Ratio snapshot unavailable (${error.message})`);
    return readFileSnapshot();
  }
}

export async function saveRatios(snapshot, { fileOnly = false } = {}) {
  await writeFile(FILE, JSON.stringify(snapshot));
  if (fileOnly) return { firestore: false };
  const { Firestore } = await import("@google-cloud/firestore");
  await new Firestore({ projectId: PROJECT_ID }).collection("ratios").doc("latest").set(snapshot);
  return { firestore: true };
}
