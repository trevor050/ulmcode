# Desktop integration

## Implementation

Desktop uses the shared ULMCode profile resolver and runtime environment. A new profile is seeded from the ULM template, with the development plugin target resolved to the local `packages/ulm` directory and the packaged target resolved to `resources/ulmcode/plugin`. Desktop restores the isolated profile after importing shell environment, removes inherited auth/config overrides, and pins the command worker to the selected Bun runtime.

The `dev:ulm`, `build:ulm`, and `package:ulm` entrypoints require Bun 1.4.4 and can re-exec under `ULMCODE_BUILD_BUN_PATH` when the invoking Bun is older. The build and package commands build the local CLI from this checkout (`packages/cli/script/build.ts --single --skip-install --skip-web-ui`) and copy that exact binary into the app; ULM prebuilds fail closed if the local binary is missing instead of silently downloading a registry CLI. Packaging includes the plugin server, worker source, trusted command catalog, isolated profile template, and Bun runtime. The packaged plugin Bun is copied from the same 1.4.4 process that builds the CLI and app. The plugin bundle leaves `effect` and `@opencode/plugin` external for the upstream plugin Host loader. Packaged startup also launches the bundled operations service. Development starts the same service through the ULM desktop launcher. Both use the desktop profile’s private credentials directory and the selected workspace; service reuse requires matching workspace and profile identity. The launcher refuses an occupied port when those identities differ.

Development permits the Vite renderer origin and the packaged service permits `oc://renderer`. The operations service binds to loopback. The desktop exposes the existing chat-first renderer and attaches operation status from the isolated service.

## Verification

- `bun run typecheck` from `packages/desktop`: passed.
- `bun ./scripts/ulm.ts build` from `packages/desktop`: passed; generated the plugin and operations service bundles. Vite reported existing large-chunk warnings.
- `ULMCODE_BUILD_BUN_PATH=/path/to/bun-1.4.4 bun ./scripts/ulm.ts package --linux --dir` from `packages/desktop`: passed and produced the final Linux x64 unpacked application on the stable `local` channel. The packaged CLI, copied desktop resource, and local CLI build have identical SHA-256 `a180deb6ae3f77556ee3a7b8f36d9f7d33ec2f03a579e89376ab4ac894336dbe`. The packaged plugin Bun reports 1.4.4 and has the same SHA-256 as the pinned build runtime (`10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235`). `resources/ulmcode` contains the plugin bundle, worker source, command catalog, profile template, operations service bundle, and executable Bun runtime.
- Actual development Electron through Xvfb: the pinned Bun 1.4.4 sidecar loaded `packages/ulm/server.ts`, exposed the synthetic OpenAI-compatible model, and rendered two distinct submitted replies. A third delayed request was stopped through the native Stop button, the interrupted session accepted a follow-up reply, and closing/relaunching Electron preserved the transcript.
- Actual packaged Electron through Xvfb: the compiled CLI loaded the bundled plugin from `resources/ulmcode/plugin/server.js`; the synthetic model rendered a submitted reply. Its provider request contained registered ULM tools including `operation_create`, `operation_plan`, `operation_run`, `operation_status`, `operation_credentials`, and the audit/report tools. The packaged operations sidehost started on loopback and the session UI showed “Attach operation”. The CLI process environment pointed `ULMCODE_BUN_PATH` and the front of `PATH` to the packaged Bun runtime, and loaded the packaged command catalog.
- Independent compiled-host `operation_run` proof: acceptance started the packaged `resources/opencode-cli` with the bundled plugin and a fixture-only provider, while the CLI PATH was exactly `/usr/bin:/bin` and the worker runtime was explicitly set to the shipped `resources/ulmcode/plugin/bun`. The real compiled host completed the fixture command with a `cmd1` receipt, a succeeded execution and a completed phase (26 bytes of synthetic output); no network execution occurred. See [compiled-host command proof](evidence/desktop-compiled-cli-command-proof.json).
- Packaged supervised command execution: launched the packaged operations bundle and fake lab with the packaged Bun runtime, shipped catalog, and `PATH=<resources>/ulmcode/plugin:/usr/bin:/bin`. The system-only portion of that PATH has no `bun`; the runtime directory supplied the catalog's `bun` executable. The shipped `local-http-observe` profile executed against `127.0.0.1:4320`, and the durable command result recorded `succeeded` with exit code 0. The operation phase completed. The operation then correctly remained blocked on separate finalization requirements (evidence normalization and report artifacts). See the sanitized result at [packaged command proof](evidence/desktop-packaged-command-proof.json).
- The dev launcher started its own operations service on port 4310, and the UI showed “Attach operation”. Health identity matched the temporary workspace and profile. The service returned CORS headers only for the configured renderer origins.
- Packaged profile/env isolation: started Electron from a pre-existing disposable profile whose config named the registry plugin and enabled updates. Startup rewrote it to the packaged plugin directory and disabled updates while preserving its model setting. The launch environment contained synthetic poison values for `OPENCODE_AUTH_CONTENT`, `OPENCODE_CONFIG_CONTENT`, `OPENAI_API_KEY`, and `OPENAI_BASE_URL`; presence-only `/proc` inspection found none of those keys in either the spawned CLI service or operations sidehost. Health identity matched the temporary profile and workspace. See the sanitized result at [packaged env isolation proof](evidence/desktop-packaged-env-isolation.json).
- Final source-built package CUA: the native Electron window submitted two synthetic prompts and rendered separate replies, stopped a delayed turn using the native Stop control, resumed the same session with a follow-up, and retained all messages after closing and reopening the app with the same profile. The reopened window reused the profile's `service-local.json` CLI registration; the CLI remained on loopback port 3084 while the app-owned operations sidehost restarted on loopback port 4310. `/health` identified the expected disposable workspace and matched the profile ID to the SHA-256 of its private credentials directory. Presence-only `/proc` checks showed all four forbidden inherited environment keys absent in both spawned services. Evidence, payload hashes, and sanitized checks are in [final source-built runtime proof](evidence/desktop-final-sourcebuilt-runtime.json), [two submitted turns](evidence/desktop-final-sourcebuilt-two-turns.png), [interrupted turn](evidence/desktop-final-sourcebuilt-stop-interrupted.png), [stop follow-up](evidence/desktop-final-sourcebuilt-stop-resume.png), and [reopened transcript](evidence/desktop-final-sourcebuilt-reopened.png).
- The provider was a loopback-only synthetic fixture with no real credential, paid API, or live profile. Evidence: [development two-turn screenshot](evidence/desktop-two-synthetic-turns.png), [interrupted session](evidence/desktop-stop-interrupted.png), [post-restart transcript](evidence/desktop-restart-persisted.png), [packaged Electron reply](evidence/desktop-packaged-turn.png), and [sanitized packaged tool names](evidence/desktop-packaged-provider-request.json).

## Reproduction

Run the development UI with a disposable profile and synthetic fixture provider. The desktop launcher starts the matching loopback operations service and stops the service it owns when the launcher exits:

```sh
cd packages/desktop
OPENCODE_DESKTOP_TEST_ROOT=/tmp/ulmcode-desktop-test \
OPENCODE_DISABLE_MODELS_FETCH=1 \
OPENCODE_CONFIG_GLOBAL_DISABLE=1 \
bun ./scripts/ulm.ts dev -- --no-sandbox --disable-gpu
```

For packaged Linux payload verification:

```sh
cd packages/desktop
ULMCODE_BUILD_BUN_PATH=/path/to/bun-1.4.4 bun ./scripts/ulm.ts package --linux --dir
```

`ULMCODE_BUILD_BUN_PATH` is optional when the invoking Bun is version 1.4.4. It selects the build runtime for the local CLI and desktop packaging when the shell's default Bun is older.

To repeat the packaged UI pass, create a disposable test root with `profile/config/opencode.json` pointing `plugins[0].package` at the unpacked app's `resources/ulmcode/plugin`, and configure an OpenAI-compatible model at a loopback-only synthetic provider. Then launch:

```sh
cd packages/desktop
OPENCODE_DESKTOP_TEST_ROOT=/tmp/ulmcode-desktop-packaged \
OPENCODE_DISABLE_MODELS_FETCH=1 \
OPENCODE_DISABLE_FFF=1 \
ELECTRON_NO_SANDBOX=1 \
./dist/linux-unpacked/ai.ulmcode.desktop.dev --no-sandbox --disable-gpu
```

The packaged main process starts the operations host from `resources/ulmcode/operations/server.js`; `/health` reports the selected workspace and a profile identity hash. It reuses port 4310 only when both identities match, and releases its owned host on app shutdown. The packaged Electron session used a temporary profile/workspace and an isolated loopback provider; it did not read operator credentials.

The packaged supervised-command path was also exercised with a fresh `/tmp` profile and workspace on port 4311. The local synthetic lab ran on 4320. The host used the unpacked package's `resources/ulmcode/operations/server.js`, `resources/ulmcode/command-catalog.json`, bundled Bun, and worker source copied alongside the operations bundle. The host PATH was limited to the packaged runtime directory and `/usr/bin:/bin`; `command -v bun` against `/usr/bin:/bin` returned no executable. This proves the catalog command's worker and watchdog can execute using the packaged runtime without a system Bun installation.

The real-window screenshots were captured from Electron under Xvfb with native keyboard/mouse input. The final source-built model fixture and profile lived in a disposable test root and used only synthetic loopback responses.

## Remaining surface notes

The packaged Linux x64 directory build was exercised; installers and macOS/Windows packages were not. The renderer still includes upstream OpenCode wordmark assets; renderer branding belongs to the app track.
