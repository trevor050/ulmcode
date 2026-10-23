# ULMCode isolated profile

Run the repository CLI with the isolated ULMCode profile:

```sh
bun tools/ulmcode/launch.ts
```

The launcher defaults to `~/.config/ulmcode`. Set `ULMCODE_PROFILE_ROOT` to use an explicit profile root, including a disposable directory for local checks. The profile stores configuration, OpenCode provider login, database, state, cache, and private operation credentials beneath that root. OpenAI ChatGPT subscription login uses OpenCode's provider auth flow; the launcher removes `OPENAI_API_KEY` and `OPENAI_BASE_URL` from the child environment so it cannot silently select a metered API key or endpoint.

On first launch, `tools/ulmcode/profile.json` is copied into the isolated config directory with the plugin target resolved to this checkout's local `packages/ulm` directory. Existing config is preserved. The profile selects `openai/gpt-5.5` at high reasoning effort, assigns `small`, `recon`, and `evidence` agents to `openai/gpt-5.4-mini-fast`, denies non-OpenAI providers, and asks before `operation_approve_plan`. The checked-in ChatGPT catalog does not currently list `gpt-5.4-mini-fast`; availability through account discovery remains unverified. Project config and Claude Code config/skills are disabled. Operation artifacts remain workspace scoped under `.ulmcode/operations/`.

Provider tokens are stored by upstream OpenCode under the isolated XDG data root. ULMCode migration does not read or copy provider auth files; sign in again through OpenCode's auth flow when needed. Operation credentials use opaque public handles and a private per-profile vault. A credential starts in `needs_review`; it can only be materialized for a target after an operator review approves that exact target and the request includes an execution ID. Each materialization appends a redacted handle/target/execution receipt to the operation credential usage log.

`@ulmcode/operations` migration helpers require explicit source, target-workspace, target-operation-store, and private-vault roots. The supported legacy `operation.json` format is imported into canonical `operation.db` and appears in the new store as **blocked** with continuation disabled and no old executions resumed. The previous plan, goal, evidence references, and scope metadata are mapped where supported; old approval is cleared so an operator must review it again. Only allowlisted evidence, findings, and final-delivery files are copied after credential scanning; all source operation bytes are retained by content hash in the private quarantine vault, and unknown or credential-bearing files stay quarantined. Malformed operation records are archived with an explicit reason. Credentials that are missing or collided under legacy slugs require re-authentication. These helpers are intended for synthetic fixture trees and never choose a home-directory source implicitly.
