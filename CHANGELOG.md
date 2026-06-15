# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `summary` command — one-screen overview (active window, totals, top days and
  top models by cost). Top-N defaults to 5.
- `--format <table|json|md|csv>` — Markdown (GitHub-flavored) and RFC-4180 CSV
  joined the existing table/JSON outputs. `--json` is now shorthand for
  `--format json`.
- `--color <auto|always|never>` and `--no-color` — color is auto-enabled on a
  TTY and respects `NO_COLOR` / `TERM=dumb`. Machine formats never emit ANSI.
- Relative cost-tier markers (`▲`/`=`/`·`) on terminal tables, plus emphasized
  `TOTAL`, with a colorblind-safe luminance color axis (no red/green).
- `--sort <key|cost|prompt|completion|msgs>`, `--top N`, and `--reverse` for
  row sorting and truncation (`TOTAL` still covers all rows).

### Changed

- **The bare `aider-usage` command now runs `summary` instead of `daily`.**
  Run `aider-usage daily` for the previous default. (No existing-user
  compatibility was retained — this is pre-1.0.)
- Stream discipline and exit codes: report data is the only thing on stdout;
  all `note:`/`error:` messages go to stderr. A missing log now exits `1`
  (was `0`); an empty date range exits `0` and emits `[]` under `--json`.
- The "missing cost" footnote no longer prints to stdout (it leaked into piped
  and redirected output); it is now a `note:` on stderr.
- Presentation refactored into a pure, injected-`Style` render layer with a
  single format switch — no new runtime dependencies.
- Raised minimum Node.js to >= 22.12 (was >= 18). Node 18 and 20 are both
  end-of-life; this aligns with the toolchain below and drops EOL runtimes.
- Bumped CI/release actions to v6 (checkout, setup-node, pnpm/action-setup)
  ahead of GitHub's Node20-actions cutover.
- Upgraded dev/runtime dependencies: commander 12→15, typescript 5→6,
  vitest 2→4, @types/node 22→25, fast-check 3→4. No user-facing behavior
  change (all 47 tests pass unchanged).

## [0.1.0] - 2026-06-15

Initial public release.

### Added

- `aider-usage setup` — idempotently enables `analytics-log` in `~/.aider.conf.yml`.
- Reports: `daily` (default), `weekly`, `monthly`, `models`, `session`, `commands`.
- `--since` / `--until` inclusive local-date filtering with validation.
- `--json` machine-readable output for every report.
- `AIDER_USAGE_LOG` env override for log discovery.
- Defensive JSONL parsing: malformed lines are skipped and counted on stderr.
- Inferred sessions (cli/gui session events, cost reset, >30min gaps).

[Unreleased]: https://github.com/ycaptain/aider-usage/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ycaptain/aider-usage/releases/tag/v0.1.0
