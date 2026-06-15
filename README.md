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
aider-usage               # overview: window, totals, top days/models (default)
aider-usage summary       # same as the bare command
aider-usage daily         # cost + tokens grouped by day (ascending)
aider-usage weekly
aider-usage monthly
aider-usage models        # grouped by model (ascending)
aider-usage session       # per inferred session, most expensive first
aider-usage commands      # slash-command frequency (unique to aider-usage)

aider-usage daily --since 2026-01-01 --until 2026-06-01
```

> **Note:** the bare `aider-usage` now runs `summary` (it used to run `daily`).
> Use `aider-usage daily` for the day-by-day table.

### Output format and color

```sh
aider-usage models --format json   # machine-readable (alias: --json)
aider-usage monthly --format md > report.md   # GitHub-flavored markdown table
aider-usage models --format csv    # RFC-4180 CSV (data rows only, no TOTAL)

aider-usage daily --color always   # force color even when piped
aider-usage daily --no-color       # disable color (also honors NO_COLOR / TERM=dumb)
```

Color and cost-tier markers (`▲` high / `=` mid / `·` low) appear only on an
interactive terminal. Piped and machine formats (`json`/`md`/`csv`) are always
plain bytes with no ANSI and no notes on stdout, so they are safe to parse.

### Sorting and truncation

```sh
aider-usage models --sort cost --top 5   # five most expensive models
aider-usage daily --sort msgs --reverse  # fewest messages first
```

`--sort` accepts `key|cost|prompt|completion|msgs`. `--top N` truncates the
displayed rows but the `TOTAL` row still covers everything.

`AIDER_USAGE_LOG=/path/to/log.jsonl aider-usage` overrides log discovery
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
```

Notes such as `note: 1 record(s) had no cost data, counted as $0.` are written to
**stderr**, never stdout, so they never contaminate piped or redirected reports.

## Design notes

- **Dates** are interpreted in your local timezone; `--since`/`--until` are an
  inclusive range `[since 00:00, until 23:59:59]`. `since > until` is an error.
- **Malformed lines** are skipped with a count on stderr (the report never aborts
  on one bad line).
- **Missing cost** (`cost` null/absent) is counted as `$0`, the record is still
  counted, and a `note:` on stderr reports how many. A real `cost: 0` is not flagged.
- **Streams and exit codes**: report data goes to stdout; all `note:`/`error:`
  messages go to stderr. A missing log exits `1`; an empty date range exits `0`
  (and emits `[]` under `--json`).
- **Cost tiers** are relative to the largest row in the current view
  (`high ≥ 0.66·max`, `mid ≥ 0.33·max`); an all-zero view shows no high tier.
  Color is purely redundant — markers and the `TOTAL` label carry the same
  information after stripping ANSI (colorblind-safe luminance axis, no red/green).
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
