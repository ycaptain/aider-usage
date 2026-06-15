# aider-usage

[![CI](https://github.com/ycaptain/aider-usage/actions/workflows/ci.yml/badge.svg)](https://github.com/ycaptain/aider-usage/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/aider-usage)](https://www.npmjs.com/package/aider-usage)

Offline token/cost usage reports from [Aider](https://aider.chat) analytics logs.
Like [ccusage](https://github.com/ryoppippi/ccusage), but for Aider. Your aider
workflow stays exactly the same; you configure logging once and read reports anytime.

## Why

Aider already computes per-message tokens and cost (shown after each message), and
`--analytics-log` serializes that to a JSONL file. Nothing reads it back into
historical reports. AiderDesk only tracks live sessions; ccusage does not support
Aider. This fills that gap with zero token cost (it only reads a local file).

## Install

Run it directly without installing:

```sh
npx aider-usage daily
```

Or install globally to get the `aider-usage` binary:

```sh
npm install -g aider-usage
```

Requires Node.js >= 22.12.

## Setup (one time)

```sh
aider-usage setup
```

This writes `analytics-log: ~/.aider/analytics.jsonl` to `~/.aider.conf.yml`
(idempotent). After that, run aider as usual; logs accumulate automatically.

## Usage

```sh
aider-usage daily         # cost + tokens grouped by day (default)
aider-usage weekly
aider-usage monthly
aider-usage models        # grouped by model
aider-usage session       # per inferred session, most expensive first
aider-usage commands      # slash-command frequency (unique to aider-usage)

aider-usage daily --since 2026-01-01 --until 2026-06-01
aider-usage daily --json  # machine-readable output
```

`AIDER_USAGE_LOG=/path/to/log.jsonl aider-usage daily` overrides log discovery
(useful for testing or non-standard setups).

## Example output

```text
$ aider-usage daily
┌────────────┬─────────┬────────┬────────────┬──────┐
│ Date       │    Cost │ Prompt │ Completion │ Msgs │
├────────────┼─────────┼────────┼────────────┼──────┤
│ 2025-08-13 │ $0.0300 │  3,000 │        130 │    2 │
│ 2025-08-14 │ $0.0000 │    500 │         30 │    1 │
│ 2025-08-15 │ $0.0500 │  3,000 │        200 │    1 │
│ TOTAL      │ $0.0800 │  6,500 │        360 │    4 │
└────────────┴─────────┴────────┴────────────┴──────┘
note: 1 record(s) had no cost data (counted as $0).
```

## Design notes

- **Dates** are interpreted in your local timezone; `--since`/`--until` are an
  inclusive range `[since 00:00, until 23:59:59]`. `since > until` is an error.
- **Malformed lines** are skipped with a count on stderr (the report never aborts
  on one bad line).
- **Missing cost** (`cost` null/absent) is counted as `$0`, the record is still
  counted, and a footnote reports how many. A real `cost: 0` is not flagged.
- **Sessions** are inferred (Aider has no session id) from three signals in order:
  `cli session` event, `total_cost` resetting to about the current cost (new
  process), and a gap greater than 30 minutes between messages.

## Known limitations

- `session` combined with `--since`/`--until` infers sessions within the window,
  so a process crossing a date boundary may be split (a note is printed).
- History before you enabled `analytics-log` is unrecoverable.
- `user_id` is per machine, not per session; concurrent aider processes writing
  the same log cannot be told apart.
- No cache/reasoning token data (Aider does not record it in this log).
- No schema version field; fields are read defensively by key presence.

## Development

```sh
pnpm test         # vitest (unit + property-based + e2e)
pnpm typecheck
pnpm build
```

License: MIT
