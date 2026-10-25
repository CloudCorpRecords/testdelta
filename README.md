# testdelta

Diff two named test result sets and report exactly which tests regressed, which were fixed, which were added, and which were removed. Never raw counts without names: every category in the human report lists the test names in it.

## What it does

testdelta compares a base result set against a head result set. Each set maps a test name to one of three statuses: `pass`, `fail`, or `skip`. From the two sets it computes:

- Regressions: tests that were `pass` or `skip` in base and are `fail` in head.
- Fixes: tests that were `fail` in base and are `pass` in head.
- Added: tests that exist only in head, with their head status.
- Removed: tests that exist only in base, with their base status.
- Still-failing: tests that are `fail` in both sets.
- Unchanged: tests present in both sets with the same status, other than fail in both.
- Other changes: tests present in both sets whose status changed in a way that is neither a regression nor a fix, for example `pass` to `skip`.

Name lists are sorted alphabetically within each category, and the output is deterministic: no timestamps and no random ordering.

Findings highlight the categories a human should look at first:

- One `high` finding per regression (rule `REGRESSION`, evidence such as `base=pass head=fail`).
- One `info` finding per fix (rule `FIXED`).
- One `medium` finding per removed test that was passing (rule `REMOVED-PASSING`).
- One `low` finding per added test that is failing (rule `ADDED-FAILING`).

## Input formats

### Directory with base.json and head.json

Point testdelta at a directory containing two files:

`base.json`:

```json
{
  "test-login": "pass",
  "test-checkout": "pass",
  "test-search": "fail"
}
```

`head.json`:

```json
{
  "test-login": "fail",
  "test-checkout": "pass",
  "test-search": "pass"
}
```

In this example `test-login` is a regression and `test-search` is a fix.

### Single file with base and head objects

A single JSON file can carry both sets:

```json
{
  "base": {
    "test-login": "pass",
    "test-search": "fail"
  },
  "head": {
    "test-login": "fail",
    "test-search": "pass"
  }
}
```

Missing files, missing `base` or `head` objects, malformed JSON, and status values other than `pass`, `fail`, or `skip` are errors. The CLI reports the error and exits with code 2.

## Install

```sh
npx @reneturcios/testdelta diff ./results
```

Or install it globally:

```sh
npm install -g @reneturcios/testdelta
```

## CLI usage

```sh
# Human readable report (default target is the current directory)
testdelta diff [path]

# Machine readable JSON report
testdelta diff [path] --json

# Run as an MCP server over stdio
testdelta mcp

# Print the version
testdelta --version
```

Exit codes:

- `0`: the verdict is `NO-REGRESSION`.
- `1`: the verdict is `REGRESSED`.
- `2`: usage error, including missing or invalid input.
- `141`: the reader closed the output pipe early (the shell-visible equivalent of SIGPIPE).

In the human report, each category lists test names, capped at 50 names per category. When a category has more, the list ends with an explicit `and N more` line instead of truncating silently. The JSON report always carries the full findings list.

## MCP tool

The MCP server exposes one tool:

### diff_test_results

- Input: `path`, the target directory or single result file.
- Output: the full JSON report, with the verdict, the counts for every category, the findings, and a summary that names the counts and the first regression names.

## Verdict rules

- `REGRESSED`: at least one regression exists, meaning a test that was `pass` or `skip` in base is `fail` in head.
- `NO-REGRESSION`: no regressions. Added failing tests, removed tests, and tests that were already failing in base do not change the verdict on their own; they are reported as findings and counts so a human can decide.

## Limits

- testdelta works on result files. It does not run tests, and it does not produce the `pass`, `fail`, or `skip` values itself; a test runner or CI job has to write the result sets first.
- Test name matching is exact string equality. A renamed test appears as one removed test and one added test, not as a change.
- Only the three statuses `pass`, `fail`, and `skip` are understood. Map any other runner outcome onto one of them before diffing.
