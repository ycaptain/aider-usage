# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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
