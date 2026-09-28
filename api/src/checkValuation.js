import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth } from "google-auth-library";
import { loadConstituents } from "./constituents.js";
import { buildValuation } from "./valuate.js";

const PROJECT_ID = "sp500-heatmap-sj";
const REGION = "us-east1";
const JOB = "valuation-nightly";
const CASH_TOLERANCE = 0.02;
const PEER_TOLERANCE = 0.05;

function nyParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type).value;
  return { year: get("year"), month: get("month"), day: get("day"), hour: Number(get("hour")) };
}

export function lastScheduledStart(now = new Date()) {
  const ny = nyParts(now);
  const day = ny.hour < 2
    ? new Date(Date.UTC(Number(ny.year), Number(ny.month) - 1, Number(ny.day)) - 24 * 60 * 60 * 1000)
    : new Date(Date.UTC(Number(ny.year), Number(ny.month) - 1, Number(ny.day)));
  const target = {
    year: String(day.getUTCFullYear()),
    month: String(day.getUTCMonth() + 1).padStart(2, "0"),
    day: String(day.getUTCDate()).padStart(2, "0"),
  };
  let utc = Date.parse(`${target.year}-${target.month}-${target.day}T07:00:00Z`);
  for (let step = 0; step < 4; step += 1) {
    const parts = nyParts(new Date(utc));
    if (parts.year === target.year && parts.month === target.month && parts.day === target.day && parts.hour === 2) {
      return new Date(utc);
    }
    utc -= 60 * 60 * 1000;
  }
  throw new Error("Could not resolve 2:00am America/New_York");
}

export async function latestExecution() {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const url = `https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB}/executions?pageSize=10`;
  const response = await client.request({ url });
  const executions = response.data.executions ?? [];
  executions.sort((a, b) => Date.parse(b.startTime ?? 0) - Date.parse(a.startTime ?? 0));
  return executions[0] ?? null;
}

function conditionSucceeded(condition) {
  return condition.status === "True" || condition.state === "CONDITION_SUCCEEDED";
}

function executionSucceeded(execution) {
  const completed = (execution.conditions ?? []).some((condition) => condition.type === "Completed" && conditionSucceeded(condition));
  return Boolean(execution.completionTime) && completed && (execution.succeededCount ?? 0) >= 1 && (execution.failedCount ?? 0) === 0;
}

export function checkNightlyJob(execution, cutoff) {
  if (!execution) return { ok: false, detail: `${JOB} has no executions` };
  const started = Date.parse(execution.startTime);
  const name = execution.name?.split("/").pop() ?? execution.name;
  if (Number.isNaN(started) || started < cutoff.getTime()) {
    return { ok: false, detail: `Latest execution ${name} started ${execution.startTime}, before ${cutoff.toISOString()}` };
  }
  if (!executionSucceeded(execution)) {
    return { ok: false, detail: `Latest execution ${name} did not succeed (started ${execution.startTime})` };
  }
  return { ok: true, detail: `${name} succeeded, started ${execution.startTime}, finished ${execution.completionTime}` };
}

function moneyClose(stored, fresh, tolerance) {
  if (stored == null && fresh == null) return true;
  if (stored == null || fresh == null || fresh === undefined) return false;
  return Math.abs(stored - fresh) <= tolerance;
}

function peerClose(stored, fresh) {
  if (stored == null && fresh == null) return true;
  if (stored == null || fresh == null || fresh === undefined) return false;
  const base = Math.max(Math.abs(stored), 1);
  return Math.abs(fresh - stored) / base <= PEER_TOLERANCE;
}

function compareSnapshots(stored, fresh, symbols) {
  const mismatches = [];
  for (const symbol of symbols) {
    const saved = stored.stocks?.[symbol];
    const computed = fresh.stocks?.[symbol];
    if (!saved) {
      mismatches.push(`${symbol}: missing from the stored snapshot`);
      continue;
    }
    if (!computed) {
      mismatches.push(`${symbol}: missing from the recomputed snapshot`);
      continue;
    }
    const problems = [];
    if (saved.model !== computed.model) problems.push(`model ${saved.model} vs ${computed.model}`);
    if (saved.status !== computed.status) problems.push(`status ${saved.status} vs ${computed.status}`);
    if ((saved.fiscalYearEnd ?? null) !== (computed.fiscalYearEnd ?? null)) {
      problems.push(`fiscal year ${saved.fiscalYearEnd ?? "none"} vs ${computed.fiscalYearEnd ?? "none"}`);
    }
    if (!moneyClose(saved.fairValue ?? null, computed.fairValue ?? null, CASH_TOLERANCE)) {
      problems.push(`fair value ${saved.fairValue ?? "none"} vs ${computed.fairValue ?? "none"}`);
    }
    if (!peerClose(saved.multipleFairValue ?? null, computed.multipleFairValue ?? null)) {
      problems.push(`peer value ${saved.multipleFairValue ?? "none"} vs ${computed.multipleFairValue ?? "none"}`);
    }
    if (problems.length) mismatches.push(`${symbol}: ${problems.join("; ")}`);
  }
  return mismatches;
}

async function main() {
  const cutoff = lastScheduledStart();
  console.log(`Expected nightly run at or after ${cutoff.toISOString()} (2:00am America/New_York)`);

  const execution = await latestExecution();
  const job = checkNightlyJob(execution, cutoff);
  console.log(`${job.ok ? "PASS" : "FAIL"} nightly job: ${job.detail}`);

  const stored = (await new Firestore({ projectId: PROJECT_ID }).collection("valuations").doc("latest").get()).data();
  if (!stored?.computedAt || !stored.stocks) throw new Error("Firestore snapshot is missing");
  const computedAt = Date.parse(stored.computedAt);
  const freshSnapshot = computedAt >= cutoff.getTime();
  console.log(
    `${freshSnapshot ? "PASS" : "FAIL"} stored snapshot: computedAt ${stored.computedAt}`,
  );

  const constituents = await loadConstituents();
  console.log(`Recomputing ${constituents.length} tickers`);
  console.log("Cash-flow fair values must match within $0.02. Peer values may differ by up to 5% because they use the morning quote.");
  const fresh = await buildValuation(constituents);
  const mismatches = compareSnapshots(stored, fresh, constituents.map((stock) => stock.symbol));
  console.log(`${mismatches.length ? "FAIL" : "PASS"} fair values: ${constituents.length - mismatches.length}/${constituents.length} match`);
  for (const line of mismatches.slice(0, 40)) console.log(`  ${line}`);
  if (mismatches.length > 40) console.log(`  … ${mismatches.length - 40} more`);

  if (!job.ok || !freshSnapshot || mismatches.length) process.exitCode = 1;
}

const isDirectRun = process.argv[1]?.endsWith("checkValuation.js");
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
