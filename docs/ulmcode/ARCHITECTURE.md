# ULMCode on OpenCode 2

This rebuild starts from official OpenCode `v2.1.3`, commit [`bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1`](https://github.com/anomalyco/opencode/commit/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1). Preserve upstream runtime behavior and implement ULMCode as one operation package with a native plugin adapter. The old fork at `6a3df0d8bd64b3f9ab0fac0bba524887e08773f5` is a requirements/migration reference, not source to copy wholesale.

ULMCode supports authorized internal pentest orchestration: explicit scope, approved plans, supervised work, subordinate agents, reviewed credential handles, durable evidence, goal continuation, and styled HTML/PDF handoff. Operation artifacts are durable product truth. Chat remains the primary interaction; operation status augments the session.

## Selected boundaries

```text
official CLI / native plugin / local API / official app
                         |
                 packages/ulm services
                         |
       operation engine + per-operation SQLite store
            |                 |                 |
      execution port     private vault     evidence/reporting
            |
     official session APIs / bounded local process adapter
```

| Module | Responsibility | Boundary |
| --- | --- | --- |
| `packages/ulm/src/operation.ts` | Shared IDs, schemas/types, operation/phase/execution state, command and adapter contracts. | No provider/UI imports. |
| `store.ts` | Canonical per-operation SQLite events/snapshot, revision/idempotency checks, JSON projection. | Persistence mechanics, not scheduling policy. |
| `engine.ts` | Approved plan, dependencies, launch intents, observations, recovery and completion decisions. | One lifecycle implementation; adapters must not create another. |
| `runtime.ts` | Native OpenCode plugin, tools, operation/session binding, context and continuation integration. | Uses official session APIs and plugin capabilities; no copied provider loop. |
| `lab.ts` | Real local synthetic fixture adapter for repeatable execution/failure/restart drills. | Fixture proof does not certify live models or production scanners. |
| `command.ts`, `command-worker.ts` | Explicit trusted catalog, fixed argv, durable process receipts, bounded capture and credential redaction. | No catalog means command phases block before launch intent; it must not substitute the local-lab adapter. |
| `scheduler.ts` | Single named-operation owner, heartbeat, dependency progress, report repair and shutdown/recovery policy. | Reuses the engine; a heartbeat cannot authorize recovery or prove useful work. |
| `profile.ts`, `credentials.ts`, `migration.ts` | Consistent isolated paths/env, private vault, reviewed handles, explicit portable imports. | Provider tokens remain upstream-owned; raw engagement credentials remain private. |
| `evidence.ts`, `findings.ts`, `report.ts`, `goal.ts` | Immutable source normalization, explicit reviewed findings, styled report and deterministic completion. | A model verdict or file's existence cannot replace evidence/integrity checks. |
| `server.ts`, `cli.ts` | Thin local API and operator commands. | Both call the same services. Development API defaults to `127.0.0.1:4310`; lab defaults to `4320`. |
| `packages/app/src/operations/` | Integrated operation UI in the official app. | Reads real service state and invokes real commands. |

The table names the agreed target layout; a file name here does not certify that its full behavior has landed. The acceptance record must identify implemented entry points and results.

Keep ULM domain code independent of upstream internals, provider SDKs, UI/global event buses, and implicit process environment. Translate upstream session IDs, location/workspace context, lifecycle events, and tool errors in `runtime.ts`. Public Protocol/Server API changes require client generation through `packages/client`; do not edit generated clients. A separate ULM local API should not be presented as if it were a generated upstream API.

## Durable operation contract

Each operation lives at `.ulmcode/operations/<id>/`. Its `operation.db` is canonical, with events/snapshot committed in a SQLite transaction. `operation.json` is an atomic, replaceable human-readable projection. Preserve useful folders for plans, executions/commands, immutable raw evidence, normalized evidence, findings, goals, memory, and deliverables. A consistent export must include committed WAL state or use a database backup/checkpoint; copying a live main database alone is unsafe.

All operation mutations have an exact operation ID, actor, expected revision and idempotency key. Exact command retries return their prior outcome; changed event type/content under the same ULM command identity conflicts. This is separate from upstream session inbox retry behavior. Validate unknown transport data once at its owning boundary. IDs and artifact paths must reject traversal, collisions and symlink escapes. Artifact references record operation-relative path, hash, size, media type and provenance.

Session binding is explicit and unique within a workspace: create/adopt/resume selects the named operation; a fresh session remains unbound. Per-operation databases cannot by themselves enforce uniqueness across operation folders. Bindings need a workspace authority or equivalent serialized enforcement. No latest-active-operation fallback is allowed.

The engine persists launch intent before a host adapter dispatches it. Execution identity, phase/work-unit ID, attempt and idempotency key survive launch receipt, process observation and restart. Unknown outcomes require inspection before replay. This is at-least-once dispatch with deduplication/reconciliation, not exactly-once external effects.

The scheduler owns downstream dispatch and bounded concurrency. A child worker receives a phase, permitted scope and artifact prefix, and returns evidence/proof or a blocker. It cannot dispatch the operation graph. Failed commands preserve partial artifacts and limitations; they do not automatically fail an entire operation or satisfy phase success criteria. Recovery inspects known jobs before launching replacements, obeys safe/inspect-first/never restart policy, and uses bounded attempts.

Supervised command profiles are loaded only from an operator-selected trusted catalog. Profiles fix the executable, argv templates, declared variables, permitted operation modes, target policy, timeout, output bound and restart policy. Materialize reviewed credential handles into child environment only; reject credential values in interpolated arguments and retain redaction across stream chunks. Public command artifacts contain bounded redacted output and non-secret receipt state. Keep private worker specs, exclusive claims and exact PID/start identities outside the operation's exportable artifacts. A confirmed terminal result wins over parent readiness bookkeeping. Unknown receipts block duplicate launch.

The command deadline covers process exit and pipe draining, including same-group descendants that outlive their parent. A hard deadline must survive capture-worker failure. Interruption may signal only the verified owned process/group; if ownership or outcome cannot be established, retain an explicit unknown outcome rather than assert successful cleanup. Scheduler shutdown and operator stop are distinct durable events: `--resume` may recover scheduler-owned interruption, while an operator stop requires explicit operation recovery. An overlapping shutdown must not relabel the operator's stop.

## Preserve official session semantics

The foundation's `AGENTS.md` and source are authoritative:

- `Session.prompt` first publishes durable inbox admission, then requests advisory wake unless `resume: false`. Delivery consumes the inbox entry and creates its visible message in one projection transaction.
- For user/synthetic inbox IDs, matching Session and type means first admission wins. Retried payload, metadata and delivery mode are ignored, pending or delivered. Cross-Session/type reuse fails. Control items retain their specific conflict rules. Do not restore the old fork's stricter payload/delivery retry comparison.
- One step is one logical `llm.stream` call, followed by history reload when continuing. The upstream runner owns streaming/tool settlement, compaction, delivery ordering and cancellation. Do not add an in-memory tool loop or describe one call as a provider turn.
- Steers deliver at safe step boundaries under upstream ordering. At idle, steers have priority; otherwise one queued item delivers before continuation is reevaluated. New user input resets the selected agent's step allowance according to upstream behavior.
- Session execution is process-global and Session-ID based; runner/permissions/tools/filesystem context remain Location-scoped. Do not cache one worktree in a process-global operation adapter and leak it to another location.
- A write-ahead execution claim survives process death/shutdown interruption. Managed startup resumes claimed top-level sessions with durable per-execution attempt accounting. Completion/failure/user interruption releases the claim. ULM reconciles its receipts with upstream recovery and must not add a competing top-level resume sweep.
- Claims mark restart recovery; they are not clustered ownership, fencing, or exactly-once execution. Known idle/locally unowned interruption is a no-op; unknown Session interruption fails through the public API.

Native subagent/background job capability should be used through official APIs/plugin contracts. Legacy `task`/`bash` permission names and V1 plugin/tool representations are not direct V2 integration points; official V2 uses `subagent`, `shell`, and `edit`.

## Planning and goal policy

Missing scope, approval, catalog authorization, or a required credential decision blocks dispatch. Existing user answers count. The current plan schema supports assumptions, success criteria, ordered phases/dependencies, restart policy, expected artifacts, command profiles and reporting closeout. Approval binds the plan content; amendments before execution require fresh approval. Resume advances the existing graph rather than rebuilding it to hide failure. Unattended catalog execution is non-destructive.

Legacy Discovery Charters, duration-aware execution blocks, automatic gap/backlog expansion and school-specific launch packets are not implemented in this rebuild. Imported plans stay blocked for review. A target duration remains a completion floor: the scheduler returns an expansion request when the finite graph finishes before that window. This is an explicit request for further work, not an implemented renewable campaign or demonstrated long-run trust.

Eligible owner-session idle continuation asks for an advisory goal review. Planning sessions and assigned child workers are exempt from operation-wide continuation. NO/continue should choose concrete work. YES/done evaluates deterministic gates; it cannot override absent, unsafe, stale or corrupt artifacts. Failed/malformed reviews and exhausted no-progress/retry/quota budgets remain visible and actionable. User stop/pause wins.

Elapsed time is a floor, not work proof. When planned work finishes while a target window remains open, the implemented scheduler returns `expand`; an operator or owner must provide further useful in-scope work. Automatic gap analysis/backlog renewal remains unsupported. Empty notes and idle heartbeats cannot establish a long-run claim. Accelerated fixtures establish readiness only.

## Evidence and final handoff

Raw evidence is immutable. Normalization records parser/version, source hash, outcome, stable lead/claim IDs and limitations. Leads are distinct from validated/report-ready findings. Findings need concrete evidence, affected scope, validation, impact, remediation and reverse links; deduplicate overlapping root causes.

Use one typed final manifest shared by renderer, lint and goal gates: exact operation ID, source revision/digest, generated paths, hashes/sizes, generator identity and render outcome. Freshness compares the dependency source digest and excludes self-referential audit/output fields. It must not require an audit to hash itself.

The legacy general handoff inventory includes `report.html`, `report.pdf`, `findings.json`, `evidence-index.json`, `executive-summary.md`, `technical-appendix.md`, `operator-review.md`, `runtime-summary.md`, `README.md`, and `manifest.json`, with machine-readable runtime summary. It is a portability/parity inventory rather than a hardcoded ten-file minimum for every operation. The essential current handoff is a usable styled HTML/PDF report derived from canonical evidence/findings, current runtime summary, and a strict shared manifest/audit. School/stakeholder extras remain explicit template capabilities. A proportionate local report does not certify those omitted templates.

Write/review canonical report source → render real HTML/PDF → refresh runtime summary → strict lint → operation audit → handoff/goal completion. Repair source and rerender. A missing renderer is a blocker, never permission for fake PDF bytes. Inspect actual HTML/PDF for readability, clipping, cover/TOC, finding scan paths, roadmap and traceable citations. Long-run page targets cannot be met with padding or duplicate findings.

## Known gaps and acceptance scope

This document is a contract/source review, not full runtime certification. Focused independent probes now verify root HTTP approval retry, persistent stop before dispatch, goal command conflict detection, fake-report rejection, actual Chromium report generation, fresh audit invalidation after PDF corruption, and concurrent dispatch without duplicate local probes. [Migration acceptance notes](MIGRATION.md) distinguish these results from native host/model/desktop proof.

Independent binding concurrency/restart, combined full/strict-domain typechecking, stopped-owner callback, child dispatch rejection, unresolved-finding and duplicate-finding probes now pass. The public artifact/finding workflow also passes: immutable source registration, candidate completion blocking, explicit reviewed disposition, known evidence links, source-driven stale-report invalidation and real rerender. Source mutation followed by normalization now rejects before writing output and preserves the registered hash. Migration probes verify the genuine legacy goal path/duration, canonical/private destination conflict preflight, symlink-ancestor rejection, generic credential quarantine, actual plan/apply CLI and retry after process death. Imports remain blocked and unapproved; application is resumable per-file work, with no automatic rollback. The current report bundle remains smaller than legacy general/stakeholder parity.

Independent real-process probes verify eight fast successful launches, a timeout killing a same-group pipe holder that ignores SIGTERM, credential-in-argument rejection, and the operator-stop/shutdown race. An actual public CLI create → approve → detached daemon run completed two dependent catalog commands once each, normalized evidence and passed fresh report lint/audit with Chromium output. This establishes the local supervised workflow slice. A separate detached guard preserves the deadline after capture-worker SIGKILL: the owned child ends and records failed/capture-unavailable; explicit interruption with the worker absent ends it and records interrupted/capture-unavailable. Repeated launch checks retain exactly one dispatch. After fixing the guard readiness acknowledgement, three independent eight-case batches of a successful leader leaving an unref'd TERM-resistant child have zero survivors beyond the deadline. These are Linux process-group proofs; current `/bin/true` fast-exit checks also remain eight of eight successful.

Source/development execution uses a real Bun host and the local plugin directory. The compiled upstream CLI does not itself supply a general-purpose Bun executable: command supervision requires a real Bun path through `ULMCODE_BUN_PATH` and worker source at the resolved plugin path. The guard uses that same worker source. The Linux package now supplies both; desktop also prepends bundled Bun for catalog executable lookup. Independent acceptance exercised the shipped compiled CLI, bundled plugin and explicit bundled Bun with `PATH=/usr/bin:/bin`: actual fixture model/tool steps created, approved and ran one authorized local command to one succeeded receipt and completed phase. That closes this Linux native-command packaging boundary, not other operating systems or live provider access.

No architecture inspection certifies subscription login/refresh, real child model execution, actual desktop Computer Use, clean installation, literal 20h+/48h autonomy, full scanner catalog setup, or a school-scale report. Record independent accepted/failed/blocked/not-run results with exact commands, commit and artifacts. [Migration and acceptance requirements](MIGRATION.md) define the portable-state and failure drills.

## Compiler boundaries

`packages/ulm` runs two mandatory checks with `bun typecheck`: a full native integration check over all source/tests/the plugin wrapper using the official upstream `noUncheckedIndexedAccess: false` convention, and a strict domain check with that flag enabled over all non-native modules and tests. Native runtime and its tests are checked in the integration compilation; they are not silently omitted. This avoids imposing different source compiler flags on upstream workspace packages while retaining the stricter gate for the rebuilt domain.
