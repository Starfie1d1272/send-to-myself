# Dependency audit

Snapshot: 2026-11-07. Run with the repository's pinned Node and pnpm versions.

The product audit changed from 4 low / 6 moderate findings to 1 low / 0 moderate.
The separate quality workspace changed from 1 moderate finding to no findings.
Neither workspace had high or critical findings. These counts describe the audit
snapshot, not a guarantee about future advisories.

No audit threshold, advisory exclusion, dependency safety policy, application
source, existing test, release workflow or security setting changed. The existing
CI audits still fail at `high`; low and moderate findings remain visible.

## Compatible updates within upstream ranges

These updates use normal lockfile resolution without changing product manifests:

- `serialize-javascript` 7.1.0 → 7.1.4, through
  `apps/web → vite-plugin-pwa → workbox-build → @rollup/plugin-terser`.
  [GHSA-m5mm-p8h7-m29v](https://github.com/advisories/GHSA-m5mm-p8h7-m29v)
  is fixed in 7.1.3 and later. The parent's `^7.0.3` range accepts the update.
- `fast-uri` 3.1.8 → 3.1.9, through
  `apps/web → vite-plugin-pwa → workbox-build → ajv`, including the additional
  `@apideck/better-ajv-errors → ajv` path. The parent's `^3.0.1` range accepts it.
  Version 3.1.9 fixes all four reported findings:
  [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg),
  [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h),
  [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr) and
  [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp).
- `seroval` and `seroval-plugins` 1.6.8 → 1.7.7, through
  `apps/web → @tanstack/react-router → @tanstack/router-core`.
  Both remain inside the parent's `^1.6.7` ranges, and the plugin's seroval peer
  range remains satisfied. This fixes
  [GHSA-f86p-h4j2-7qgj](https://github.com/advisories/GHSA-f86p-h4j2-7qgj)
  (seroval >=1.6.11) and
  [GHSA-9wx9-5pv9-3349](https://github.com/advisories/GHSA-9wx9-5pv9-3349)
  (seroval >=1.6.10). Normal pnpm release-age checks remain enabled; these are the
  eligible versions selected by the update, not a request to bypass that policy.

## Scoped major-version fixes

These advisories do not have patched versions inside the immediate parents'
existing dependency ranges:

- [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4):
  `glob` 11.1.0 → 14.0.4 (fixed >=14.0.2), only for `workbox-build@7.4.1`.
  The latest Workbox 7.4.1 still requests `glob ^11.0.1`.
- [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249):
  `minimatch` 10.2.6 → 11.0.5 (fixed >=11.0.1), only for
  `@oclif/core@4.14.0` in the product workspace and `eslint@10.14.0`,
  `@eslint/config-array@0.23.5`, `@typescript-eslint/typescript-estree@8.72.1`
  in the quality workspace. Glob 14 already requests the patched minimatch major.
  The latest ESLint/typescript-eslint and even oclif 5.1.11 still request
  minimatch 10, so upgrading those parents alone does not resolve the advisory.

The overrides name exact parent versions. Re-evaluate or remove them when those
parents change. This avoids silently applying a major upgrade to future consumers.
There is deliberately no global minimatch override: glob 11 depends on the old
RegExp-oriented matcher internals, whereas minimatch 11 replaces those internals.
See the upstream [minimatch documentation](https://github.com/isaacs/minimatch)
and [glob changelog](https://github.com/isaacs/node-glob/blob/main/changelog.md).

Compatibility review and checks:

- Workbox's `get-file-details.js` uses the public `globSync` API with `cwd`,
  `follow` and `ignore`, not the changed walker internals or removed glob CLI.
  The full Web build output, including the service worker and precache entries,
  was byte-identical before and after the scoped overrides, with the compatible
  updates above present on both sides.
- oclif's plugin loader uses the public `minimatch` function. ESLint/config-array
  and typescript-estree use public matcher construction, `match` and `pattern`,
  not the removed RegExp internals. Full ESLint JSON output was identical before
  and after the overrides: the same 95 files and the same results.
- All updated package engine ranges support the repository's Node versions.
- Existing type checks, all 68 non-Docker tests, and Web, desktop frontend and
  Raycast builds pass. No tests or assertions were added, removed or weakened.
  The existing CI additionally checks Rust/shell formatting and lint, builds the
  Docker image and runs its existing backup/restore test.

The quality package remains independent from the product workspace. Its small
`pnpm-workspace.yaml` declares only `.` and holds its own scoped overrides.
The root quality commands no longer pass `--ignore-workspace`, which would ignore
that configuration. This is a persistent boundary between development tooling and
product dependencies, not a temporary memory workaround.

## Remaining low-severity upstream issue

[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
affects `deepmerge` 4.3.1 through
`apps/web → vite-plugin-pwa@2.0.0 → workbox-build@7.4.1 →
@rollup/plugin-node-resolve@16.0.3 → deepmerge`.

The advisory has no published patched version. Both deepmerge 4.3.1 and
plugin-node-resolve 16.0.3 are their latest published versions at this snapshot.
There is no ordinary upstream upgrade that removes this finding.

The installed plugin's only deepmerge call is
`deepFreeze(deepMerge({}, defaults))`. `defaults` is the plugin's fixed internal
object; caller options are combined separately using object spread. No
untrusted-input path to that call was found in the current version. This limits
the observed exposure but does **not** mean the vulnerable dependency is fixed.
The finding is retained in audit output without an exclusion or downgraded policy.
Replacing the plugin, downgrading it or shipping a custom security patch is not
part of this dependency-update change.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm quality:install
pnpm audit --audit-level low
# Expected at this snapshot: nonzero, with the single deepmerge finding above.
pnpm --dir scripts/quality audit --audit-level low
# Expected at this snapshot: no findings.
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @sendtomyself/web build
pnpm --filter desktop build
pnpm --filter send-to-myself-raycast build
```

Use the existing CI for Docker and native-style checks. The lockfiles pin the
reviewed versions and integrity hashes; do not use an unfrozen install to reproduce
the exact reviewed dependency tree.
