# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
