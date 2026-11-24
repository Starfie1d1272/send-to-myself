# Code quality

Use the Node version in `.node-version` and pnpm version in the root `packageManager` field.

```sh
pnpm quality:install
pnpm format:check
pnpm lint
pnpm quality:audit
# Apply the same formatting locally:
pnpm format
```

The private `scripts/quality` package is a single-package workspace with its own
`pnpm-workspace.yaml` and lockfile, separate from the product workspaces. Run the
root `quality:install` and `quality:audit` scripts so pnpm loads that workspace and
its scoped overrides. It uses the same pnpm version and normal frozen-lockfile
installation; it does not change dependency safety policies.
Installing these tools does not require building native product dependencies.
The isolated lockfile is audited separately with `pnpm quality:audit`, using the
same `high` failure threshold as the existing product dependency audit.

- Prettier 3.9.10 covers maintained TS, TSX, JavaScript/MJS, CSS, HTML, JSON and YAML.
  It preserves the prevailing double quotes, semicolons and two-space indentation.
- ESLint 10.14.0 and typescript-eslint 8.72.1 apply their recommended non-type-aware
  rules to JS/TS/TSX. Browser globals are scoped to browser source and its tests.
  Parameters explicitly named with a leading underscore may be unused. Existing
  type checking remains a separate CI gate.
- Rust uses rustfmt from Rust 1.99.1, with the existing Cargo edition (2021).
  `pnpm format:rust:check` does not compile or package the Tauri application.
- Shell scripts use shfmt 3.12.0 (`-i 2 -ci`) and ShellCheck 0.11.0. Install the pinned
  CLI distributions with `python -m pip install shfmt-py==3.12.0.2 shellcheck-py==0.11.0.1`,
  then run `pnpm format:shell:check` and `pnpm lint:shell`. These commands select
  tracked shell files. Shared deployment variables and sources are checked with
  their calling scripts; the sourced helper documents its exported variables.

The existing non-release CI runs these checks alongside the existing type checks,
tests, dependency audit and builds. This change does not add tests or change release
triggers, signing, toolchains used to build releases, or security settings.

## Boundaries

- Harmony ArkTS (`.ets`) and SDK-owned JSON/JSON5 remain under
  `SendToMyself/code-linter.json5` and the existing Harmony build workflow. Standard
  TypeScript formatters are not suitable for ArkUI syntax. This cleanup does not
  claim to have run the Harmony SDK linter or device acceptance checks.
- Generated SQL migrations/Drizzle metadata, lockfiles, generated declarations,
  icons/assets, dependency trees and build output are not reformatted.
- README presentation, prose, release records and release workflows are preserved.
- TOML, XML, Dockerfile and Caddyfile do not receive a new formatter in this change.
  No blanket lint suppressions are added to those languages.

The tools are development-only and are not bundled with the product. Prettier,
ESLint and typescript-eslint use MIT licenses, rustfmt uses MIT/Apache-2.0, shfmt
uses BSD-3-Clause, and ShellCheck uses GPL-3.0. The product's MIT license is unchanged.

See [Dependency audit](DEPENDENCY_AUDIT.md) for the scoped transitive fixes,
compatibility checks and the remaining upstream advisory.
