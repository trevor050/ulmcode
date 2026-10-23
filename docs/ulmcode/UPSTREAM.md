# Official OpenCode 2 foundation

Verified 2026-10-23 at approximately 06:13 UTC by the foundation owner, OpenAI via ChatGPT subscription, `gpt-6.1-sol`, high effort. Scope: official upstream identity, release/source pin, licensing, and migration implications. No checkout, branch, implementation, live profile, or credential changes were made.

## Decision

Use **official OpenCode V2 `v2.1.3` at `bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1`** as the rebuild foundation. OpenCode 2 is publicly available from the official `anomalyco/opencode` repository. This recommendation pins the published V2 source rather than the moving development branch. The [official V2 introduction](https://opencode.ai/v2/docs) names `@opencode/cli` and the `/v2/install` installer; the [pinned CLI manifest](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/cli/package.json) identifies version `2.1.3`.

| Field | Verified value | Evidence |
| --- | --- | --- |
| Official repository | `https://github.com/anomalyco/opencode` | [Official website's source link](https://opencode.ai/), [repository metadata](https://api.github.com/repos/anomalyco/opencode) |
| Default development branch | `dev` | Repository metadata and live `git ls-remote --symref` |
| Recommended published V2 version | `2.1.3` | [Official npm package metadata](https://registry.npmjs.org/@opencode/cli/latest), [source tag](https://github.com/anomalyco/opencode/tree/v2.1.3) |
| Immutable source commit | `bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1` | [Tag-ref API](https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.1.3), live Git ref resolution |
| Source commit timestamp | `2026-10-22T12:45:27Z` | [Commit metadata](https://api.github.com/repos/anomalyco/opencode/commits/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1); author and committer dates agree |
| Source commit subject | `release: v2.1.3` | [Commit](https://github.com/anomalyco/opencode/commit/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1) |
| npm publication timestamp | `2026-10-22T12:44:20.273Z` | `time["2.1.3"]` in [package metadata](https://registry.npmjs.org/@opencode/cli) |
| Build package manager | `bun@1.4.4` | [Pinned root manifest](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/package.json) |
| Source license | MIT; copyright `2025 opencode` | [Pinned LICENSE](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/LICENSE) |

The npm publication timestamp and Git commit timestamp describe separate events. The npm metadata does not expose a `gitHead`; package version agreement supports the release identity but does not independently prove byte-for-byte build reproducibility.

## Why GitHub's latest release can mislead

At observation, GitHub's ordinary [releases list](https://github.com/anomalyco/opencode/releases) and [release API](https://api.github.com/repos/anomalyco/opencode/releases?per_page=30) showed `v1.19.4` as the newest GitHub Release. That does not mean OpenCode 2 is unavailable. The [pinned publish workflow](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/.github/workflows/publish.yml) explicitly documents that V2 publishes a tag instead of a GitHub Release event. The `releases/tags/v2.1.3` API returns HTTP 404; GitHub's web URL for that version renders a tag page. Treat it as an official published V2 tag/npm version, not a GitHub Release object with verified release assets.

Live npm dist-tags were `latest: 2.1.3`, `dev: 0.0.0-dev-21677`, and `beta: 0.0.0-beta-19507`. The largest stable `2.*` version in the registry was `2.1.3`. The official V2 installer resolves scoped npm platform packages. Use explicit package/version selection for acceptance; generic GitHub `releases/latest` and the legacy `opencode-ai` package select the wrong release channel.

The official [V1 `v1.19.2` notes](https://github.com/anomalyco/opencode/releases/tag/v1.19.2) also distinguish the maintained 1.x update line from explicit upgrades to OpenCode 2.

## Development tip is a different choice

The observed upstream `dev` tip was `4d30794bcf4dccdcadbcb1f62bb35b4943a96426`, timestamp `2026-10-23T05:53:53Z`, subject `fix(core): use the agent's model when a session has none (#58355)`. Its root manifest still says `2.1.3`, so a version string alone cannot identify the released source. [Commit metadata](https://api.github.com/repos/anomalyco/opencode/commits/4d30794bcf4dccdcadbcb1f62bb35b4943a96426).

The [official comparison](https://github.com/anomalyco/opencode/compare/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1...4d30794bcf4dccdcadbcb1f62bb35b4943a96426) reports diverged history, with `dev` ahead by 68 commits and behind by one. Do not assume the release tag is an ancestor of `dev`. Selecting the development tip would require an explicit foundation change and separate acceptance.

## Consequences for the ULM rebuild

The [official migration guide](https://opencode.ai/v2/docs/migrate-v1/) establishes real integration boundaries: V1 plugin implementations do not execute under V2, the server API and clients have changed, the released V2 client is `@opencode/client`, and terminal settings move to global `cli.json`. Permission actions also change: `bash` becomes `shell`, `task` becomes `subagent`, and `write`/`patch` become `edit`. Rebuild the ULM interfaces against those contracts instead of moving old code without review.

The [pinned root manifest](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/package.json) launches the CLI from `packages/cli`; it also defines web and desktop development scripts. Existing ULM instructions centered on `packages/opencode` describe legacy surfaces and must be checked against this source tree before implementation.

The current local checkout was observed on `pc-rebuild` at `6a3df0d8bd64b3f9ab0fac0bba524887e08773f5`; `local-reference` resolved to the same commit. Its only configured remote was the user's fork. This verifies preservation of the reference tip, not equivalence to current official V2. Keep the reference intact. The integration owner should create the rebuild branch/worktree directly from the selected upstream commit, then port the product contracts with isolated synthetic storage.

V1 and V2 can use the same configuration locations according to the migration guide. Acceptance must therefore set isolated configuration, data, state, and cache paths before any launch. Do not run an upstream installer or auth migration against the user's live setup as part of this foundation check.

## License and provenance limits

The pinned MIT license permits modification and redistribution while requiring preservation of its copyright and permission notice. Keep that notice in the fork and distributions. Dependency, bundled asset, and trademark obligations still require a separate distribution review; this report verifies the upstream root license only. The [pinned README](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/README.md) requests a non-affiliation statement for projects using “opencode” in their name.

The tag-ref API reports a lightweight tag pointing directly to a commit. GitHub commit verification reports `verified: false`, reason `unsigned`. Do not describe this as a cryptographically signed source release. The immutable commit pin is the reproducibility anchor.

## Reproduce the identity check

These equivalent read-only commands reproduce the live Git and HTTP identity checks performed for this report. They do not change the working checkout.

```bash
git ls-remote --symref https://github.com/anomalyco/opencode.git HEAD refs/heads/dev 'refs/tags/v2*'
curl -fsSL https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.1.3
curl -fsSL https://api.github.com/repos/anomalyco/opencode/commits/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1
curl -fsSL https://registry.npmjs.org/@opencode/cli/latest
curl -fsSL https://raw.githubusercontent.com/anomalyco/opencode/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/LICENSE
```

Expected tag resolution:

```text
bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1 refs/tags/v2.1.3
```

Foundation identity is verified. Clean dependency installation, binary reproducibility, subscription authentication, runtime flows, CLI/web/desktop behavior, and ULM feature acceptance remain the responsibility of implementation and independent acceptance lanes. This report claims no runtime certification.
