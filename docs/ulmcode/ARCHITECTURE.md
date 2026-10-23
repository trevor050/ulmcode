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
| `profile.ts`, `credentials.ts`, `migration.ts` | Consistent isolated paths/env, private vault, reviewed handles, explicit portable imports. | Provider tokens remain upstream-owned; raw engagement credentials remain private. |
| `evidence.ts`, `report.ts`, `goal.ts` | Source-traceable normalization, source-driven styled report, strict deterministic completion. | A model verdict or file's existence cannot replace evidence/integrity checks. |
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

Missing scope, safety limits, approval, or a required credential decision blocks dispatch. Existing user answers count. Under two hours can use an approved compact plan. Two hours or more retains approved Discovery Charter → scoped research → approved full duration-aware plan. Charter-only state permits research, not full graph execution. Approval binds a version/content hash, and changes need an audited amendment.

The full plan includes phases/dependencies, assumptions, success criteria, delegation policy, execution blocks, resource bounds, reporting closeout and a protected finalization window. Resume advances the existing graph rather than rebuilding it to hide failure. Unattended mode is non-destructive; destructive dispatch needs an explicit human-present action. Never use timeout fallback as new authorization.

Eligible owner-session idle continuation asks for an advisory goal review. Planning sessions and assigned child workers are exempt from operation-wide continuation. NO/continue should choose concrete work. YES/done evaluates deterministic gates; it cannot override absent, unsafe, stale or corrupt artifacts. Failed/malformed reviews and exhausted no-progress/retry/quota budgets remain visible and actionable. User stop/pause wins.

Elapsed time is a floor, not work proof. If planned work finishes while a target window is open, gap analysis can add bounded useful in-scope work or record a justified wait/blocker. Empty notes and idle heartbeats cannot establish a long-run claim. Accelerated fixtures establish readiness only.

## Evidence and final handoff

Raw evidence is immutable. Normalization records parser/version, source hash, outcome, stable lead/claim IDs and limitations. Leads are distinct from validated/report-ready findings. Findings need concrete evidence, affected scope, validation, impact, remediation and reverse links; deduplicate overlapping root causes.

Use one typed final manifest shared by renderer, lint and goal gates: exact operation ID, source revision/digest, generated paths, hashes/sizes, generator identity and render outcome. Freshness compares the dependency source digest and excludes self-referential audit/output fields. It must not require an audit to hash itself.

The intended general handoff preserves `report.html`, `report.pdf`, `findings.json`, `evidence-index.json`, `executive-summary.md`, `technical-appendix.md`, `operator-review.md`, `runtime-summary.md`, `README.md`, and `manifest.json`, with machine-readable runtime summary. School/stakeholder templates preserve their additional role/identity and board/CEH/team reports without imposing those on unrelated operations. A reduced lab package must be labeled as a slice, not full product parity.

Write/review canonical report source → render real HTML/PDF → refresh runtime summary → strict lint → operation audit → handoff/goal completion. Repair source and rerender. A missing renderer is a blocker, never permission for fake PDF bytes. Inspect actual HTML/PDF for readability, clipping, cover/TOC, finding scan paths, roadmap and traceable citations. Long-run page targets cannot be met with padding or duplicate findings.

## Known gaps and acceptance scope

This document is a contract/source review, not full runtime certification. Focused independent probes now verify root HTTP approval retry, persistent stop before dispatch, goal command conflict detection, fake-report rejection, actual Chromium report generation, fresh audit invalidation after PDF corruption, and concurrent dispatch without duplicate local probes. [Migration acceptance notes](MIGRATION.md) distinguish these results from native host/model/desktop proof.

Independent binding concurrency/restart, combined full/strict-domain typechecking, stopped-owner callback, child dispatch rejection, unresolved-finding and duplicate-finding probes now pass. Migration probes also verify the genuine legacy goal path/duration, canonical-target conflict preflight and generic credential quarantine without a vault index. These are focused regression results; broader migration interruption/rollback coverage remains the acceptance owner's responsibility. The current local-lab report bundle also remains smaller than full general/stakeholder parity.

No architecture inspection certifies subscription login/refresh, real child model execution, actual desktop Computer Use, clean installation, literal 20h+/48h autonomy, full scanner catalog setup, or a school-scale report. Record independent accepted/failed/blocked/not-run results with exact commands, commit and artifacts. [Migration and acceptance requirements](MIGRATION.md) define the portable-state and failure drills.

## Compiler boundaries

`packages/ulm` runs two mandatory checks with `bun typecheck`: a full native integration check over all source/tests/the plugin wrapper using the official upstream `noUncheckedIndexedAccess: false` convention, and a strict domain check with that flag enabled over all non-native modules and tests. Native runtime and its tests are checked in the integration compilation; they are not silently omitted. This avoids imposing different source compiler flags on upstream workspace packages while retaining the stricter gate for the rebuilt domain.
