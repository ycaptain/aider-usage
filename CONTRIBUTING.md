# Contributing to aider-usage

Thanks for your interest! This is a small, focused tool — contributions that keep
it that way are very welcome.

## Development setup

```sh
pnpm install
pnpm dev -- daily      # run the CLI from source via tsx
```

## Before opening a PR

All three must pass — CI enforces them on Node 22/24 (the project requires Node >=22.12):

```sh
pnpm typecheck
pnpm test       # vitest: unit + property-based + e2e
pnpm build
```

## Methodology

This project follows a **spec-first** discipline: for anything touching parsing,
aggregation, sessionization, or date boundaries, write the contract and the edge
cases (empty / single / full / null-cost / session-boundary) as tests _before_ the
implementation. The existing `test/regression.test.ts` and property-based tests in
`test/aggregate.test.ts` are the bar to match. New behavior needs new tests.

## Scope

aider-usage reads a **local** Aider analytics log and prints reports — nothing
more. It makes no network calls and stores no state. Proposals that add telemetry,
remote calls, or live-session tracking are out of scope (use AiderDesk for live
sessions). Bug fixes, new report dimensions, and output-format improvements are in
scope.

## Reporting bugs

Open an issue with: the command you ran, what you expected, what you got, and (if
possible) a minimal redacted JSONL snippet that reproduces it. Never paste real
API keys or tokens — the analytics log does not contain them, but double-check.
