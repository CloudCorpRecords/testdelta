/**
 * Acceptance tests for the testdelta core diff.
 *
 * Fixtures:
 * - pair-regressed: 2 regressions, 1 fix, 1 added, 1 removed, plus one
 *   still-failing and one unchanged test
 * - pair-clean: identical base and head sets
 * - pair-added-failing: only additions, one of them failing
 * - single-file: the { "base": ..., "head": ... } shape in one file
 * - invalid inputs: malformed JSON, an invalid status value, a missing
 *   directory, and a directory missing one of its two files
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck, renderReport, CLEAN_VERDICT, VERSION } from "../src/core.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function rules(report: ReturnType<typeof runCheck>): string[] {
  return report.findings.map((f) => f.rule);
}

describe("constants", () => {
  it("exposes the package version and the clean verdict", () => {
    assert.equal(VERSION, "0.1.0");
    assert.equal(CLEAN_VERDICT, "NO-REGRESSION");
  });
});

describe("pair-regressed fixture", () => {
  it("verdicts REGRESSED with exact counts for every category", () => {
    const r = runCheck(join(FIXTURES, "pair-regressed"));
    assert.equal(r.tool, "testdelta");
    assert.equal(r.version, "0.1.0");
    assert.equal(r.verdict, "REGRESSED");
    assert.equal(r.counts.base, 6);
    assert.equal(r.counts.head, 6);
    assert.equal(r.counts.regressions, 2);
    assert.equal(r.counts.fixes, 1);
    assert.equal(r.counts.added, 1);
    assert.equal(r.counts.removed, 1);
    assert.equal(r.counts.stillFailing, 1);
    assert.equal(r.counts.unchanged, 1);
    assert.equal(r.counts.otherChanges, 0);
    assert.equal(r.counts.findings, r.findings.length);
  });

  it("emits the exact finding rules, severities, and evidence", () => {
    const r = runCheck(join(FIXTURES, "pair-regressed"));
    assert.deepEqual(rules(r), ["REGRESSION", "REGRESSION", "FIXED", "REMOVED-PASSING"]);
    const [alpha, beta, fix, removed] = r.findings;
    assert.equal(alpha.severity, "high");
    assert.match(alpha.message, /test-alpha/);
    assert.equal(alpha.evidence, "base=pass head=fail");
    assert.equal(beta.severity, "high");
    assert.match(beta.message, /test-beta/);
    assert.equal(beta.evidence, "base=skip head=fail");
    assert.equal(fix.severity, "info");
    assert.match(fix.message, /test-broken/);
    assert.equal(fix.evidence, "base=fail head=pass");
    assert.equal(removed.severity, "medium");
    assert.match(removed.message, /test-removed/);
    assert.equal(removed.evidence, "base=pass head=absent");
  });

  it("summary names the counts and the regression names", () => {
    const r = runCheck(join(FIXTURES, "pair-regressed"));
    assert.match(r.summary, /2 regressions/);
    assert.match(r.summary, /test-alpha/);
    assert.match(r.summary, /test-beta/);
    assert.match(r.summary, /1 fix/);
    assert.match(r.summary, /1 still-failing/);
  });

  it("human report lists test names in every category", () => {
    const text = renderReport(runCheck(join(FIXTURES, "pair-regressed")));
    for (const name of ["test-alpha", "test-beta", "test-broken", "test-new", "test-removed", "test-stable", "test-still-bad"]) {
      assert.ok(text.includes(name), `report must name ${name}`);
    }
    assert.match(text, /regressions \(2\)/);
    assert.match(text, /still-failing \(1\)/);
    assert.match(text, /unchanged \(1\)/);
  });
});

describe("pair-clean fixture", () => {
  it("identical sets verdict NO-REGRESSION with no findings", () => {
    const r = runCheck(join(FIXTURES, "pair-clean"));
    assert.equal(r.verdict, CLEAN_VERDICT);
    assert.equal(r.findings.length, 0);
    assert.equal(r.counts.regressions, 0);
    assert.equal(r.counts.fixes, 0);
    assert.equal(r.counts.added, 0);
    assert.equal(r.counts.removed, 0);
    assert.equal(r.counts.stillFailing, 1);
    assert.equal(r.counts.unchanged, 2);
    assert.equal(r.counts.otherChanges, 0);
  });
});

describe("pair-added-failing fixture", () => {
  it("an added failing test is a low finding, not a regression", () => {
    const r = runCheck(join(FIXTURES, "pair-added-failing"));
    assert.equal(r.verdict, CLEAN_VERDICT);
    assert.equal(r.counts.added, 2);
    assert.equal(r.counts.regressions, 0);
    assert.equal(r.counts.unchanged, 1);
    assert.deepEqual(rules(r), ["ADDED-FAILING"]);
    assert.equal(r.findings[0].severity, "low");
    assert.match(r.findings[0].message, /test-new-feature/);
    assert.equal(r.findings[0].evidence, "base=absent head=fail");
  });
});

describe("single-file shape", () => {
  it("diffs the base and head objects inside one JSON file", () => {
    const r = runCheck(join(FIXTURES, "single-file", "results.json"));
    assert.equal(r.verdict, "REGRESSED");
    assert.equal(r.counts.base, 2);
    assert.equal(r.counts.head, 2);
    assert.equal(r.counts.regressions, 1);
    assert.equal(r.counts.unchanged, 1);
    assert.deepEqual(rules(r), ["REGRESSION"]);
    assert.match(r.findings[0].message, /test-alpha/);
  });
});

describe("invalid input", () => {
  it("invalid JSON throws a clear error", () => {
    assert.throws(() => runCheck(join(FIXTURES, "invalid.json")), /invalid JSON/);
  });

  it("a missing directory throws a clear error", () => {
    assert.throws(() => runCheck(join(FIXTURES, "does-not-exist")), /target does not exist/);
  });

  it("a directory missing head.json throws a clear error", () => {
    const dir = mkdtempSync(join(tmpdir(), "testdelta-missing-"));
    try {
      writeFileSync(join(dir, "base.json"), JSON.stringify({ "test-a": "pass" }), "utf8");
      assert.throws(() => runCheck(dir), /missing head\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an invalid status value throws a clear error", () => {
    assert.throws(() => runCheck(join(FIXTURES, "invalid-status")), /invalid status/);
  });

  it("a single file without base and head objects throws a clear error", () => {
    const dir = mkdtempSync(join(tmpdir(), "testdelta-shape-"));
    try {
      const file = join(dir, "results.json");
      writeFileSync(file, JSON.stringify({ base: { "test-a": "pass" } }), "utf8");
      assert.throws(() => runCheck(file), /must contain "base" and "head"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ordering and list caps", () => {
  it("regression names are alphabetical regardless of file key order", () => {
    const dir = mkdtempSync(join(tmpdir(), "testdelta-order-"));
    try {
      writeFileSync(
        join(dir, "base.json"),
        JSON.stringify({ "test-zulu": "pass", "test-alpha": "pass", "test-mike": "pass" }),
        "utf8",
      );
      writeFileSync(
        join(dir, "head.json"),
        JSON.stringify({ "test-zulu": "fail", "test-alpha": "fail", "test-mike": "fail" }),
        "utf8",
      );
      const r = runCheck(dir);
      assert.deepEqual(
        r.findings.map((f) => f.message.split(" ")[0]),
        ["test-alpha", "test-mike", "test-zulu"],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the human report caps a category list at 50 names with an explicit remainder line", () => {
    const dir = mkdtempSync(join(tmpdir(), "testdelta-cap-"));
    try {
      const base: Record<string, string> = {};
      const head: Record<string, string> = {};
      for (let i = 0; i < 60; i++) {
        const name = `test-${String(i).padStart(3, "0")}`;
        base[name] = "pass";
        head[name] = "fail";
      }
      writeFileSync(join(dir, "base.json"), JSON.stringify(base), "utf8");
      writeFileSync(join(dir, "head.json"), JSON.stringify(head), "utf8");
      const text = renderReport(runCheck(dir));
      assert.match(text, /regressions \(60\)/);
      assert.ok(text.includes("test-049"), "the 50th listed name must appear");
      assert.ok(!text.includes("- test-050"), "the 51st name must be capped out of the list");
      assert.match(text, /and 10 more/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("pass to skip and fail to skip count as other changes, not regressions or fixes", () => {
    const dir = mkdtempSync(join(tmpdir(), "testdelta-other-"));
    try {
      writeFileSync(
        join(dir, "base.json"),
        JSON.stringify({ "test-a": "pass", "test-b": "fail", "test-c": "skip" }),
        "utf8",
      );
      writeFileSync(
        join(dir, "head.json"),
        JSON.stringify({ "test-a": "skip", "test-b": "skip", "test-c": "pass" }),
        "utf8",
      );
      const r = runCheck(dir);
      assert.equal(r.verdict, CLEAN_VERDICT);
      assert.equal(r.counts.otherChanges, 3);
      assert.equal(r.counts.regressions, 0);
      assert.equal(r.counts.fixes, 0);
      assert.equal(r.findings.length, 0);
      const text = renderReport(r);
      assert.match(text, /other changes \(3\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
