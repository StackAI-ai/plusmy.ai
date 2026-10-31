# Scoped tar compatibility candidate

## Boundary

This source-only candidate is based on `f2b9d5a3d6bd66c5ed6b19e2f77c4b8c803715ef`.
It does not update Expo, React Native, cacache, Supabase CLI, Next.js, or any
workspace dependency declaration. No provider, database, credential, trust/TLS,
deployment, or access-setting changes are part of this work.

The root pnpm overrides are limited to these exact parent versions:

| Parent | Before | After |
| --- | --- | --- |
| `@expo/cli@0.22.28` | `tar@6.2.1` | `tar@7.5.22` |
| `cacache@18.0.4` | `tar@6.2.1` | `tar@7.5.22` |
| `supabase@2.83.0` | `tar@7.5.11` | `tar@7.5.22` |

Tar 7.5.22's CommonJS namespace has `__esModule: true`, named `extract`, and no
`default`. Expo's compiled default-import helper therefore returns a namespace
whose `.default` is undefined. A blind override breaks both streaming npm
template extraction and the JavaScript fallback used by `utils/tar.js`.

`patches/@expo__cli@0.22.28.patch` wraps only those two tar namespaces in
`{ default: require("tar") }` and enables strict warning handling in those
JavaScript extractors. It does not alter the shared interop helper, filtering,
callbacks, checksums, native-tar selection, or other dependencies. The patch hash
is enforced by the pnpm lockfile. Cacache's
published `lib/` does not import tar; its dependency edge still needs replacing
to remove the vulnerable installed package. Supabase's installer already uses
a named ESM `extract` import.

Tar 7 can reject a contained symlink chain that tar 6 extracted. Strict mode
makes that incompatibility an extraction error instead of silently reporting a
partial success. This is a deliberate compatibility change, not full tar 6
parity. `BUILD_PLAN.md` records the temporary dependency architecture; retest
and remove this shim when upgrading the owning Expo CLI.

## Verification

Run the offline consumer contracts after a normal frozen install:

```bash
pnpm install --frozen-lockfile
pnpm tar:compat
```

`scripts/tar-compat.test.mjs` loads the installed Expo CLI functions, not a
replacement extractor. Fixtures and cache directories are disposable and the
operator's Expo home is not used. Coverage includes:

- Exact parent/tar versions and the CommonJS export shape.
- Streaming extraction, default strip, MD5, `.gitignore` and app-name transforms.
- The local tarball wrapper, selected members, filter, custom strip, and SHA-256.
- The real JS fallback after a missing native executable, without a spawn mock.
- Invalid input, traversal/hardlink containment with an outside sentinel.
- Contained symlink chains in the streaming and JavaScript fallback paths must
  either extract completely or report failure rather than silent success.
- A bounded 8 MiB high-ratio gzip rejected by the new parser's default guard.
- A tiny GNU long-path archive with 12,000 segments and member selection.
- Cacache buffer/stream reads and writes, bad-integrity rejection, verification,
  removal, and temporary-directory cleanup on success and failure.
- Supabase's named ESM import and its gunzip/selected-member extraction API.

CI runs `pnpm tar:compat` immediately after the frozen install, before any local
Supabase services are started. Tests require no external service.

Observed locally on 2026-10-31:

- The strict-warning candidate passed 13 tests on native arm64 Node 22.22.2
  and Node 25.9.0, including both JavaScript symlink-chain paths and separate
  traversal and hardlink fixtures.
- `guard.py run -- pnpm typecheck` from `apps/mobile`: exit 0.
- Baseline six legitimate consumer tests passed before installing overrides.
- Baseline containment test found the forbidden hardlink; candidate rejects it.
- `guard.py run -- pnpm install --lockfile-only --ignore-scripts`: passed.
- `guard.py run -- pnpm install --frozen-lockfile`: passed, resolution skipped;
  downloaded tar 7.5.22 using unchanged trust settings. Supabase postinstall
  downloaded the darwin/arm64 2.83.0 release, verified its checksum, and succeeded.
- Trust inspection: no `NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_EXTRA_CA_CERTS`,
  Node trust flags, pnpm `strict-ssl`, or `cafile` overrides. Registry is the
  standard `https://registry.npmjs.org/`. No trust settings were changed.
- `node_modules/supabase/bin/supabase --version`: exit 0, `2.83.0`.
- Machine comparison to the base lockfile: importers unchanged; no surviving
  package records changed; the only added package is tar 7.5.22. Removed packages
  are tar 6.2.1, tar 7.5.11, and tar-6-only chownr 2.0.0, fs-minipass 2.1.0,
  minipass 5.0.0, and minizlib 2.1.2. The reviewed snapshot delta is limited to
  the three tar edges and the Expo patch hash/reference.

## Audit Result And Remaining Scope

`pnpm audit --json` was run against both lockfiles. It exited 1 both times:

| Audit | Low | Moderate | High | Critical |
| --- | --- | --- | --- | --- |
| Baseline | 13 | 54 | 109 | 6 |
| Candidate | 13 | 48 | 99 | 4 |

The candidate audit reports no tar advisories. This is not a clean repository
audit or proof that every archive-consuming path is resource-bounded. The
critical tar advisory is [GHSA-23hp-3jrh-7fpw](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw)
(affected through 7.5.18); the member-selection recursion advisory is
[GHSA-r292-9mhp-454m](https://github.com/isaacs/node-tar/security/advisories/GHSA-r292-9mhp-454m)
(affected through 7.5.20).

Remaining audit-critical modules are shell-quote 1.8.3 under React Native's
react-devtools-core (`GHSA-w7jw-789q-3m8p`) and Next.js 15.5.14
(`GHSA-p293-qw3h-jr36`, `GHSA-2xp9-vwfh-vxw4`, `GHSA-2464-fhr4-w9xw`).
Their exploitability has not been independently assessed here. No audit fix,
forced update, or unrelated override was applied. Audit counts are dated
registry evidence and may change.

Known unchanged boundaries and verification gaps:

- Strict extraction can fail after writing earlier archive entries. The caller
  must treat the output as incomplete and clean it up; atomic staging and cleanup
  are not established by this candidate. Real-world archives, including valid
  symlink chains, need compatibility testing before release.
- Supabase's `scripts/postinstall.js` gunzips before calling tar. Tar's new
  compressed-input ratio check cannot measure compression on that already
  decompressed stream. The actual checksum-verified installer passed, but this
  candidate does not claim a general archive-size or pre-gunzip resource limit.
- Expo's non-Windows native-tar fast path does not call the patched JS parser.
  No claim is made about the host executable's security or resource limits.
- A missing local tarball can emit an uncaught `ENOENT` while Expo awaits
  directory creation, before its pipeline attaches an error handler. This was
  observed on the unmodified baseline and is not repaired by the interop shim.
  Follow up on stream/error-handler ordering separately.
- Existing React Native 0.76.9 peer warnings for React/@types/react 19 remain
  unchanged. No Expo app/device/simulator session or Windows run was performed.
- The first cross-provider investigator launch failed before review: the agent
  MCP used Claude Code 2.1.107, while Opus 5.5 requires at least 2.1.280. Do not
  treat that session as a completed independent review. A fresh native CLI
  2.1.316 attempt used Opus 5.5 with explicit `max` effort (actual model verified
  in the CLI result), but exited at its 14-tool-turn limit without a verdict.
  Its same-session report-only continuation was interrupted after returning no
  report; the CLI marked it `aborted_streaming`, not success. No independent
  approval is claimed. Both owned processes have exited; central review remains
  required.
- No hosted CI, build, live provider, database, migration, deployment, or release
  acceptance is established by these local checks.

The smallest follow-up scope is independent review of these six changed files,
then targeted upstream-owner dependency upgrades and a separate assessment of
the remaining audit-critical modules. Do not use a global tar override or
`pnpm audit --fix --force` as a substitute for the compatibility contracts.
