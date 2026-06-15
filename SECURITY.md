# Security Policy

## Threat model

aider-usage is a read-only, offline CLI. It:

- reads a single local Aider analytics JSONL file,
- writes one config key during `aider-usage setup` (to `~/.aider.conf.yml`),
- makes **no** network calls and collects **no** telemetry.

The analytics log contains token counts, costs, model names, and timestamps —
not prompts, code, or API keys. Reports print aggregates of that local data.

## Reporting a vulnerability

If you find a security issue (e.g. a path-traversal in log/config handling, or a
way the setup writer could clobber unintended files), please report it privately:

- Open a [GitHub security advisory](https://github.com/ycaptain/aider-usage/security/advisories/new), or
- email cz.ycaptain@gmail.com.

Please do not open a public issue for vulnerabilities. We aim to acknowledge
within a few days.

## Supported versions

The latest published version on npm receives fixes. This is a small project; old
versions are not back-patched.
