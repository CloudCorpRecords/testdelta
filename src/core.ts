/**
 * testdelta core: diff two named test result sets.
 *
 * A target is either a directory containing base.json and head.json, or a
 * single JSON file of shape { "base": { ... }, "head": { ... } }. Each
 * result set maps a test name to one of "pass", "fail", or "skip".
 *
 * Categories (all name lists are sorted alphabetically):
 * - regressions: pass or skip in base, fail in head
 * - fixes: fail in base, pass in head
 * - added: only in head, with the head status
 * - removed: only in base, with the base status
 * - still-failing: fail in both
 * - unchanged: in both with the same status, other than fail in both
 * - other changes: in both with a different status that is neither a
 *   regression nor a fix (for example pass to skip, or fail to skip)
 *
 * The categories are disjoint and, together with added and removed,
 * account for every test name in either set.
 *
 * Findings are emitted for the categories a human must act on first:
 * one high per regression, one info per fix, one medium per removed test
 * that was passing, and one low per added test that is failing. Every
 * other category is still counted and named in the human report.
 *
 * Deterministic output only: no timestamps, no random ordering.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Finding, Report } from "./types.js";

export const VERSION = "0.1.0";
export const CLEAN_VERDICT = "NO-REGRESSION";
export const REGRESSED_VERDICT = "REGRESSED";

/** Maximum number of test names listed per category in the human report. */
export const MAX_LISTED_PER_CATEGORY = 50;

type Status = "pass" | "fail" | "skip";

type ResultSet = Map<string, Status>;

const STATUSES: ReadonlySet<string> = new Set(["pass", "fail", "skip"]);

interface ChangedTest {
  name: string;
  base: Status;
  head: Status;
}

interface AddedTest {
  name: string;
  status: Status;
}

interface RemovedTest {
  name: string;
  status: Status;
}

interface Categories {
  regressions: ChangedTest[];
  fixes: ChangedTest[];
  added: AddedTest[];
  removed: RemovedTest[];
  stillFailing: string[];
  unchanged: string[];
  otherChanges: ChangedTest[];
}

/* ------------------------------------------------------------------ */
/* Loading and validation                                              */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResultSet(value: unknown, label: string): ResultSet {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a JSON object mapping test names to pass, fail, or skip`);
  }
  const out: ResultSet = new Map();
  for (const name of Object.keys(value).sort()) {
    const status = value[name];
    if (typeof status !== "string" || !STATUSES.has(status)) {
      throw new Error(
        `${label}: test "${name}" has invalid status ${JSON.stringify(status)} (expected "pass", "fail", or "skip")`,
      );
    }
    out.set(name, status as Status);
  }
  return out;
}

function readJsonFile(path: string, label: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`cannot read ${label} at ${path}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(`invalid JSON in ${label} at ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function loadPair(target: string): { base: ResultSet; head: ResultSet } {
  let st;
  try {
    st = statSync(target);
  } catch {
    throw new Error(`target does not exist: ${target}`);
  }
  if (st.isDirectory()) {
    const basePath = join(target, "base.json");
    const headPath = join(target, "head.json");
    let baseStat;
    try {
      baseStat = statSync(basePath);
    } catch {
      throw new Error(`missing base.json in target directory: ${target}`);
    }
    if (!baseStat.isFile()) throw new Error(`missing base.json in target directory: ${target}`);
    let headStat;
    try {
      headStat = statSync(headPath);
    } catch {
      throw new Error(`missing head.json in target directory: ${target}`);
    }
    if (!headStat.isFile()) throw new Error(`missing head.json in target directory: ${target}`);
    return {
      base: parseResultSet(readJsonFile(basePath, "base.json"), "base.json"),
      head: parseResultSet(readJsonFile(headPath, "head.json"), "head.json"),
    };
  }
  if (st.isFile()) {
    const data = readJsonFile(target, "result file");
    if (!isPlainObject(data) || !("base" in data) || !("head" in data)) {
      throw new Error(`result file must contain "base" and "head" objects: ${target}`);
    }
    return {
      base: parseResultSet(data.base, "base"),
      head: parseResultSet(data.head, "head"),
    };
  }
  throw new Error(`target is neither a directory nor a file: ${target}`);
}

/* ------------------------------------------------------------------ */
/* Diff                                                                */
/* ------------------------------------------------------------------ */

function diffSets(base: ResultSet, head: ResultSet): Categories {
  const regressions: ChangedTest[] = [];
  const fixes: ChangedTest[] = [];
  const added: AddedTest[] = [];
  const removed: RemovedTest[] = [];
  const stillFailing: string[] = [];
  const unchanged: string[] = [];
  const otherChanges: ChangedTest[] = [];

  for (const name of [...base.keys()].sort()) {
    const baseStatus = base.get(name) as Status;
    const headStatus = head.get(name);
    if (headStatus === undefined) {
      removed.push({ name, status: baseStatus });
      continue;
    }
    if (baseStatus === headStatus) {
      if (baseStatus === "fail") stillFailing.push(name);
      else unchanged.push(name);
      continue;
    }
    if (headStatus === "fail" && (baseStatus === "pass" || baseStatus === "skip")) {
      regressions.push({ name, base: baseStatus, head: headStatus });
    } else if (baseStatus === "fail" && headStatus === "pass") {
      fixes.push({ name, base: baseStatus, head: headStatus });
    } else {
      otherChanges.push({ name, base: baseStatus, head: headStatus });
    }
  }
  for (const name of [...head.keys()].sort()) {
    if (!base.has(name)) added.push({ name, status: head.get(name) as Status });
  }
  return { regressions, fixes, added, removed, stillFailing, unchanged, otherChanges };
}

function buildFindings(categories: Categories): Finding[] {
  const findings: Finding[] = [];
  for (const t of categories.regressions) {
    findings.push({
      rule: "REGRESSION",
      severity: "high",
      message: `${t.name} regressed: ${t.base} in base, fail in head`,
      evidence: `base=${t.base} head=fail`,
    });
  }
  for (const t of categories.fixes) {
    findings.push({
      rule: "FIXED",
      severity: "info",
      message: `${t.name} fixed: fail in base, pass in head`,
      evidence: "base=fail head=pass",
    });
  }
  for (const t of categories.removed) {
    if (t.status !== "pass") continue;
    findings.push({
      rule: "REMOVED-PASSING",
      severity: "medium",
      message: `${t.name} was passing in base and is removed in head`,
      evidence: "base=pass head=absent",
    });
  }
  for (const t of categories.added) {
    if (t.status !== "fail") continue;
    findings.push({
      rule: "ADDED-FAILING",
      severity: "low",
      message: `${t.name} is new in head and failing`,
      evidence: "base=absent head=fail",
    });
  }
  return findings;
}

function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

function buildSummary(categories: Categories, verdict: string): string {
  const parts: string[] = [];
  if (categories.regressions.length > 0) {
    const first = categories.regressions.slice(0, 3).map((t) => t.name);
    const extra = categories.regressions.length - first.length;
    const names = extra > 0 ? `${first.join(", ")}, and ${extra} more` : first.join(", ");
    parts.push(`${plural(categories.regressions.length, "regression")} (${names})`);
  } else {
    parts.push("0 regressions");
  }
  parts.push(plural(categories.fixes.length, "fix", "fixes"));
  parts.push(`${categories.added.length} added`);
  parts.push(`${categories.removed.length} removed`);
  parts.push(`${categories.stillFailing.length} still-failing`);
  parts.push(`${categories.unchanged.length} unchanged`);
  parts.push(plural(categories.otherChanges.length, "other change"));
  return `${verdict}: ${parts.join(", ")}.`;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function runCheck(target: string): Report {
  const { base, head } = loadPair(target);
  const categories = diffSets(base, head);
  const findings = buildFindings(categories);
  const verdict = categories.regressions.length > 0 ? REGRESSED_VERDICT : CLEAN_VERDICT;
  const counts: Record<string, number> = {
    base: base.size,
    head: head.size,
    regressions: categories.regressions.length,
    fixes: categories.fixes.length,
    added: categories.added.length,
    removed: categories.removed.length,
    stillFailing: categories.stillFailing.length,
    unchanged: categories.unchanged.length,
    otherChanges: categories.otherChanges.length,
    findings: findings.length,
  };
  return {
    tool: "testdelta",
    version: VERSION,
    target,
    verdict,
    counts,
    findings,
    summary: buildSummary(categories, verdict),
  };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/**
 * Recompute the name lists for a report from its target, when the target
 * is still readable. The Report type carries counts and findings only,
 * and the fleet rule is that the human report names tests in every
 * category, including categories that produce no findings (added passing
 * tests, still-failing tests, unchanged tests). When the target cannot be
 * re-read, the renderer falls back to the names carried by the findings.
 */
function tryCategories(target: string): Categories | null {
  try {
    const { base, head } = loadPair(target);
    return diffSets(base, head);
  } catch {
    return null;
  }
}

function pushNameList(out: string[], label: string, entries: string[]): void {
  out.push(`  ${label} (${entries.length}):`);
  if (entries.length === 0) {
    out.push("    none");
    return;
  }
  for (const entry of entries.slice(0, MAX_LISTED_PER_CATEGORY)) out.push(`    - ${entry}`);
  if (entries.length > MAX_LISTED_PER_CATEGORY) {
    out.push(`    and ${entries.length - MAX_LISTED_PER_CATEGORY} more`);
  }
}

export function renderReport(report: Report): string {
  const out: string[] = [];
  out.push(`testdelta diff ${report.target}: ${report.verdict}`);
  out.push(`  ${report.summary}`);
  const c = report.counts;
  out.push(
    `  counts: base ${c.base ?? 0}, head ${c.head ?? 0}, regressions ${c.regressions ?? 0}, ` +
      `fixes ${c.fixes ?? 0}, added ${c.added ?? 0}, removed ${c.removed ?? 0}, ` +
      `still-failing ${c.stillFailing ?? 0}, unchanged ${c.unchanged ?? 0}, ` +
      `other changes ${c.otherChanges ?? 0}, findings ${c.findings ?? report.findings.length}`,
  );

  const categories = tryCategories(report.target);
  if (categories) {
    pushNameList(out, "regressions", categories.regressions.map((t) => `${t.name} (base=${t.base} head=fail)`));
    pushNameList(out, "fixes", categories.fixes.map((t) => `${t.name} (base=fail head=pass)`));
    pushNameList(out, "added", categories.added.map((t) => `${t.name} (${t.status})`));
    pushNameList(out, "removed", categories.removed.map((t) => `${t.name} (was ${t.status})`));
    pushNameList(out, "still-failing", categories.stillFailing);
    pushNameList(out, "unchanged", categories.unchanged);
    if (categories.otherChanges.length > 0) {
      pushNameList(
        out,
        "other changes",
        categories.otherChanges.map((t) => `${t.name} (base=${t.base} head=${t.head})`),
      );
    }
  } else {
    const byRule = (rule: string): string[] =>
      report.findings.filter((f) => f.rule === rule).map((f) => f.message);
    pushNameList(out, "regressions", byRule("REGRESSION"));
    pushNameList(out, "fixes", byRule("FIXED"));
    pushNameList(out, "added failing", byRule("ADDED-FAILING"));
    pushNameList(out, "removed passing", byRule("REMOVED-PASSING"));
  }

  out.push(`  findings (${report.findings.length}):`);
  if (report.findings.length === 0) {
    out.push("    none");
  } else {
    for (const f of report.findings) {
      out.push(`    [${f.severity.toUpperCase()}] ${f.rule} ${f.message}${f.evidence ? ` (${f.evidence})` : ""}`);
    }
  }
  if (report.verdict === REGRESSED_VERDICT) {
    out.push("REGRESSED: at least one test that passed or was skipped in base fails in head.");
  } else {
    out.push("NO-REGRESSION: no test that passed or was skipped in base fails in head.");
  }
  return out.join("\n");
}
