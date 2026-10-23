# Migration and acceptance contract

The new foundation is official OpenCode `v2.1.3` at `bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1`. The legacy ULM reference is `6a3df0d8bd64b3f9ab0fac0bba524887e08773f5`. Keep the original checkout/history intact. Rebuild behavior against the new [architecture](ARCHITECTURE.md); do not copy the old runtime monolith or overwrite upstream session behavior.

Migration is an explicit operator command. It never discovers a source under the home directory and never runs during launch. The current importer is verified against synthetic legacy trees; real profile/provider-auth migration remains unsupported and requires a separately reviewed adapter. Do not point the command at a live source until that support is explicitly accepted.

## Portable-state rules

1. `plan` reads the explicitly selected source roots and does not write to source or destination. Its private plan records exact roots, operation/file hashes, allowlist/quarantine decisions, credential handles, and re-authentication requirements without raw credential fields.
2. Review the saved plan and choose an explicit destination workspace and private vault outside the sources. Source/destination roots and private plan/receipt paths reject symlinked ancestors. `apply` requires `--confirm`, re-plans and compares the full saved plan, then preflights canonical operation identity, public files, credential indexes, and private-vault conflicts before writing.
3. Apply writes are individually atomic and create-only. The importer writes the private byte-preserving quarantine archive, allowlisted public artifacts, blocked canonical operation records, and private credential state in sequence. This is resumable application, not an atomic operation-directory switch: an interruption may leave some of those destination writes present.
4. Re-run `apply` with the same private plan and receipt path after an interruption. Existing matching writes are verified and reused; the run converges without overwriting different destination data. A changed source fails the plan check and requires a new dry run. A conflicting target stops before that operation's writes.
5. Imported operations remain blocked with continuation disabled and no old work resumed. Imported credentials start as `needs_review`; missing or ambiguous secrets stay `reauth_required`. No imported credential is approved by migration.
6. The tool does not implement rollback. Do not delete partial destination files by hand; retry the same plan to converge, or preserve the target for manual review if a conflict prevents retry. The source is never modified.

| Legacy input | Treatment and rationale |
| --- | --- |
| `operation.json`, supported `plans/operation-plan.json`, `goals/operation-goal.json` (and compatibility `goals/goal.json`), evidence references | Convert the supported subset into a canonical blocked operation; clear approval and disable continuation. Preserve every original operation file in the private hash-addressed archive. Unsupported or malformed records are quarantined with a reason. |
| Evidence, findings, and `deliverables/final/` files | Copy only allowlisted paths that pass credential-pattern and known-value screening. Preserve bytes and hashes; quarantine other files. This does not imply that report manifests or historical completion gates are valid in the new operation. |
| Graph/lane proofs, queue records, execution/task metadata, session binding JSON | Not converted by the current importer. Preserve privately in the source-byte archive with quarantine reasons; they are not imported as active jobs, session bindings, phases, or receipts. |
| Credential metadata/private files | Map original `(operationID, credentialID)` before normalization. Preserve usernames/notes/rules/labels privately; public records use opaque handles and safe usage policy. |
| Legacy slug collisions | Reject/quarantine ambiguous original identities; deterministic collision-safe mapping manifest. Never overwrite one operation credential with another. |
| Missing/incompatible secret store | Preserve identity/metadata and report re-entry/re-authentication required. Copying an index alone is not successful credential migration. |
| Historical final bundle | Preserve as history; regenerate from migrated canonical source before a fresh completion claim. Preserve declared stakeholder policy until explicitly reviewed. |
| Old profile plugins/config mirrors and duplicated env exports | Translate supported config via one resolver and managed-file manifest. Stage updates and preserve unknown/user additions. V1 plugins do not run as V2 plugins. |
| Old provider/session patches | Audit against the pinned new source and retain only missing behavior with regression proof. Upstream owns OAuth, execution claims, stream loop and subagents. |
| School-specific lanes and stakeholder reports | Explicit school template; professional scope and sanitized final bundle. General operations do not invent irrelevant people/board reports. |
| Old test totals/accelerated burn-in | Historical/readiness only. Rerun current named acceptance; never imply wall-clock or UI proof. |

Provider login and engagement credentials are separate. Provider tokens stay in upstream-supported auth storage; operation credentials stay in the private ULM vault. Validate portability and refresh using synthetic shaped data until the operator explicitly provides an authorized subscription login flow. Never use paid API keys or silent API fallback.

## Operator-invoked synthetic migration command

The command accepts only explicit roots and never looks up the current home profile. Its plan and receipt files must live in a directory with mode `0700`; files are created with mode `0600`. The saved plan includes exact roots, per-operation decisions, hashes, and opaque credential handles, but no raw credential fields. Review it as private data because names and paths may be sensitive.

```sh
bun tools/ulmcode/migrate.ts plan \
  --source-operations /disposable/legacy/operations \
  --source-storage /disposable/legacy/data \
  --target-workspace /disposable/new-workspace \
  --target-credentials /disposable/private/credentials \
  --plan-file /disposable/private/migration/plan.json

bun tools/ulmcode/migrate.ts apply \
  --plan-file /disposable/private/migration/plan.json \
  --receipt-file /disposable/private/migration/receipt.json \
  --confirm
```

The first command is read-only. Inspect the plan's operation/file dispositions, quarantine reasons, and re-authentication count before applying. Apply prints only aggregate counts and a plan ID; its private receipt contains operation IDs and quarantine reasons. If interrupted, rerun the same apply command with the same plan and receipt. Existing matching writes are verified and reused; the receipt is written only after completion. A partial destination may be visible until retry finishes. Rollback is not implemented. This command is currently for synthetic validation, not an accepted live-profile migration path.

One profile resolver supplies config, XDG data/state/cache, private directory and DB identity to CLI/server/desktop. New isolated paths may differ from legacy defaults; record the mapping instead of changing live directories. Do not copy inherited auth override/API-key/base-URL values into launch metadata. Verify actual upstream configuration suppression instead of relying solely on historical environment variable names.

## Acceptance flows

Use disposable roots, real local fixture processes and loopback servers only. The local operation API defaults to `127.0.0.1:4310`; fake lab defaults to `4320`. Run package tests/typechecks from package directories and use repository `bun run check` for the canonical full check. Read the corresponding upstream test skill before adding/changing tests. Commands below are behavior requirements; the concrete implemented CLI/API commands must appear in the run record.

| ID | Required exercise | Pass condition |
| --- | --- | --- |
| A1 | Clean checkout/install at pinned upstream plus scoped rebuild commits. | Lockfile install and isolated launch work; selected commit/version/config/DB paths recorded; missing capability is diagnosed. |
| A2 | Real session start, second submission, active interruption, exact resume and host restart. | Official inbox first-admission-wins for same Session/type despite changed retry payload/delivery; cross-Session/type conflict; claimed top-level restart attempt budget preserved. |
| A3 | Two named operations/sessions and one fresh session. | Unique explicit binding, no latest fallback, unbound omission fails, nonexistent named ID never selects another operation. |
| A4 | Launch before plan approval, then approved local plan; charter-only state. | Preapproval rejected; charter launches only approved research; amended plan requires current approval. |
| A5 | Supervised probe against real local fake lab, raw capture, normalization, supported finding and phase proof. | Scope/redirect/argument checks enforced, real artifact hashes/reverse links; failed command keeps partial evidence; empty directories do not complete phases. |
| A6 | Scheduler → real upstream child → durable parent handoff. | Child returns assignment proof; downstream ownership remains scheduler; cancellation reaches owned child; concurrent ticks do not duplicate active dispatch. |
| A7 | Crash after launch intent/before receipt; process restart. | Reconcile by stable intent key; attach existing job or retry only confirmed absence; unknown outcome blocks; stale revision conflicts. |
| A8 | Interrupt/recover local long command and unrelated control process. | Restart policy honored, owned process tree ends on hard timeout, unrelated process lives, stale PID is not blindly killed. |
| A9 | Reviewer NO, YES with missing/stale artifacts, malformed/failed review, then valid completion. | Useful continuation, strict gates, visible blocker/backoff/no-tool cap; planning/child exempt; user pause/stop wins. |
| A10 | Finish finite graph before synthetic target window. | Gap audit/bounded work or justified wait; no empty runtime padding; finalization preserved; accelerated run labeled readiness. |
| A11 | Explicit synthetic vault Submit to agent, reviewed target-bound handle consumption. | Missing/revoked/wrong-operation/wrong-target blocked; secret/account sentinel absent from artifacts, logs, command text and UI. |
| A12 | Synthetic dry-run/apply/SIGKILL/retry and collision cases. | Source byte/hashes preserved; same-plan retry converges after partial destination writes; ambiguous slugs, corrupt/unknown files, escaped symlink, missing secret and conflicting target reported. Rollback is unsupported. |
| A13 | Real report HTML/PDF, summary, strict lint/audit/goal. | One shared current manifest/source digest, actual PDF render, usable pages; stale source/summary, wrong operation, bad JSON/PDF, missing citations or template files block. |
| A14 | Official app create/select/approve/progress/stop/resume/report and actual desktop restart. | Real state and second submissions; chat rows open sessions; folders open bound operation/final root; screenshots and Computer Use evidence. DOM/CDP alone is secondary evidence when compositor access is blocked. |
| A15 | CLI/package/server/desktop profile and managed update isolation. | Same intended paths/DB; unrelated project/general plugins/agents/MCPs absent; unknown user files retained; missing auth never falls back to paid API. |

Operation command idempotency is stricter than upstream inbox behavior: reused command key with a different event type/content must conflict. Test both separately rather than changing official inbox semantics to satisfy the operation test.

Every acceptance row needs `accepted`, `failed`, `blocked`, `not run`, or `not applicable with rationale`, an owner, exact commands/results, commit, selected roots and artifact references. Synthetic model responses may test orchestration and must be labeled; they do not establish ChatGPT execution/authentication. Tests alone cannot certify web/desktop usability or literal 20h+/48h autonomy.

## Known gaps

Independent architecture regression probes on 2026-10-23 used the actual HTTP host, SQLite store, engine, local lab and Chromium renderer in disposable roots. Approval retry now returns 200 twice; an interrupted operation cannot dispatch before recover/resume; conflicting goal-review retries reject; fake report bytes/empty runtime cannot complete; and corruption of an actually rendered final PDF invalidates a fresh completion audit and restores an active incomplete goal. Two concurrent HTTP ticks produced one local probe, an honest revision conflict/wait, and successful receipt recovery without duplicate dispatch. These are focused results, not full product acceptance.

The native approval leaf also preserves plain permission-decline defects in a synthetic Context probe. The stopped-owner continuation defect is independently fixed: a stop before the event yields zero checker generations/continuations, and a stop during checker generation yields one checker generation/zero continuations. Both keep durable status interrupted. Live host child handoff/cancellation and model usage remain separately unverified.

Further independent rechecks pass: a bound child cannot invoke `operation_run` (typed rejection, zero executions); a `needs_validation` finding blocks actual report completion; duplicate report-ready IDs reject the report request. These use actual native leaves with upstream-shaped synthetic Context or actual HTTP/Chromium flows.

Independent migration rechecks pass the genuine legacy `goals/operation-goal.json` path (48-hour duration preserved as 172,800,000ms, operation blocked), conflicting canonical target rejection before public evidence/archive writes, and generic password/Authorization data without a vault index being excluded publicly while exact source bytes are preserved privately. The external SIGKILL harness interrupted after partial private archive writes, verified source hashes unchanged, then resumed with the same plan in a new process and verified all imported evidence and idempotence. This establishes retry convergence for that tested file boundary; it does not establish all-or-nothing atomicity or rollback. The credential-shaped fixture uses ordinary syntax, not marker-specific detection.

Initial source review also identified binding uniqueness, report manifest/digest compatibility and active legacy database conversion gaps; owners have been changing those surfaces. Do not retain an old failure allegation or declare it accepted without its exact new regression evidence. General/stakeholder report parity remains larger than the current local-lab bundle.

Full-package typechecking now includes native runtime and all adapters. Architecture independently ran the combined `bun typecheck` successfully: official upstream integration compiler settings for all source/tests and a second stricter domain config for host-neutral implementation. The initial domain-only pass excluded runtime and did not establish integration correctness. A separate simultaneous same-session A/B-create probe verifies one binding succeeds/one conflicts, survives a fresh-store restart, and leaves a fresh session unbound.

No live profile/credentials have been migrated by this contract. Real subscription sign-in/refresh, child model execution, desktop Computer Use, full scanner catalog installation, literal long-duration unattended work, and school-scale report quality remain unverified until separately exercised. Preserve these limits in the final handoff rather than treating a scaffold or local engine test as full product acceptance.
