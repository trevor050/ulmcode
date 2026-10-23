# Desktop integration

## Implementation

Desktop uses the shared ULMCode profile resolver and runtime environment. A new profile is seeded from the ULM template, with the development plugin target resolved to the local `packages/ulm` directory and the packaged target resolved to `resources/ulmcode/plugin`. Desktop restores the isolated profile after importing shell environment, removes inherited auth/config overrides, and pins the command worker to the selected Bun runtime.

The `dev:ulm`, `build:ulm`, and `package:ulm` entrypoints build the native plugin bundle. Packaging includes the plugin server, the worker source, trusted command catalog, isolated profile template, and Bun runtime. The plugin bundle leaves `effect` and `@opencode/plugin` external for the upstream plugin Host loader. Packaged startup also launches the bundled operations service. Development starts the same service through the ULM desktop launcher. Both use the desktop profile’s private credentials directory and the selected workspace; service reuse requires matching workspace and profile identity. The launcher refuses an occupied port when those identities differ.

Development permits the Vite renderer origin and the packaged service permits `oc://renderer`. The operations service binds to loopback. The desktop exposes the existing chat-first renderer and attaches operation status from the isolated service.

## Verification

- `bun run typecheck` from `packages/desktop`: passed.
- `bun ./scripts/ulm.ts build` from `packages/desktop`: passed; generated the plugin and operations service bundles. Vite reported existing large-chunk warnings.
- `bun ./scripts/ulm.ts package --linux --dir` from `packages/desktop`: passed and produced a Linux x64 unpacked application. `resources/ulmcode` contains the plugin bundle, worker source, command catalog, profile template, operations service bundle, and executable Bun runtime.
- Actual development Electron through Xvfb: the pinned Bun 1.4.4 sidecar loaded `packages/ulm/server.ts`, exposed the synthetic OpenAI-compatible model, and rendered two distinct submitted replies. A third delayed request was stopped through the native Stop button, the interrupted session accepted a follow-up reply, and closing/relaunching Electron preserved the transcript.
- Actual packaged Electron through Xvfb: the compiled CLI loaded the bundled plugin from `resources/ulmcode/plugin/server.js`; the synthetic model rendered a submitted reply. Its provider request contained registered ULM tools including `operation_create`, `operation_plan`, `operation_run`, `operation_status`, `operation_credentials`, and the audit/report tools. The packaged operations sidehost started on loopback and the session UI showed “Attach operation”. The CLI process environment pointed `ULMCODE_BUN_PATH` and the front of `PATH` to the packaged Bun runtime, and loaded the packaged command catalog.
- Independent compiled-host `operation_run` proof: acceptance started the packaged `resources/opencode-cli` with the bundled plugin and a fixture-only provider, while the CLI PATH was exactly `/usr/bin:/bin` and the worker runtime was explicitly set to the shipped `resources/ulmcode/plugin/bun`. The real compiled host completed the fixture command with a `cmd1` receipt, a succeeded execution and a completed phase (26 bytes of synthetic output); no network execution occurred. See [compiled-host command proof](evidence/desktop-compiled-cli-command-proof.json).
- Packaged supervised command execution: launched the packaged operations bundle and fake lab with the packaged Bun runtime, shipped catalog, and `PATH=<resources>/ulmcode/plugin:/usr/bin:/bin`. The system-only portion of that PATH has no `bun`; the runtime directory supplied the catalog's `bun` executable. The shipped `local-http-observe` profile executed against `127.0.0.1:4320`, and the durable command result recorded `succeeded` with exit code 0. The operation phase completed. The operation then correctly remained blocked on separate finalization requirements (evidence normalization and report artifacts). See the sanitized result at [packaged command proof](evidence/desktop-packaged-command-proof.json).
- The dev launcher started its own operations service on port 4310, and the UI showed “Attach operation”. Health identity matched the temporary workspace and profile. The service returned CORS headers only for the configured renderer origins.
- Packaged profile/env isolation: started Electron from a pre-existing disposable profile whose config named the registry plugin and enabled updates. Startup rewrote it to the packaged plugin directory and disabled updates while preserving its model setting. The launch environment contained synthetic poison values for `OPENCODE_AUTH_CONTENT`, `OPENCODE_CONFIG_CONTENT`, `OPENAI_API_KEY`, and `OPENAI_BASE_URL`; presence-only `/proc` inspection found none of those keys in either the spawned CLI service or operations sidehost. Health identity matched the temporary profile and workspace. See the sanitized result at [packaged env isolation proof](evidence/desktop-packaged-env-isolation.json).
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
bun ./scripts/ulm.ts package --linux --dir
```

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

The real-window screenshots were captured from Electron under Xvfb with native keyboard/mouse input. The model fixture and profile lived under `/tmp` and used only synthetic loopback responses.

## Remaining surface notes

The packaged Linux x64 directory build was exercised; installers and macOS/Windows packages were not. The renderer still includes upstream OpenCode wordmark assets; renderer branding belongs to the app track.
