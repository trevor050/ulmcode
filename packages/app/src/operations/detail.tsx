import type { GoalVerdict, OperationRecord } from "@ulmcode/operations/operation"
import { Button } from "@opencode/ui/button"
import { For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { operationApi } from "./api"
import { executionStatusKey, operationStatusKey, operationTime, phaseStatusKey } from "./view"
import { OperationCredentialsPanel } from "./credentials-panel"

export type OperationAction = "approve" | "run" | "interrupt" | "recover" | "normalize" | "report" | GoalVerdict

type Props = {
  operation: OperationRecord
  sessionID: string | undefined
  busy: boolean
  onAction: (action: OperationAction) => void
  onAttach: () => void
  attached: boolean
  attaching: boolean
}

export function OperationDetail(props: Props) {
  const language = useLanguage()
  const operation = () => props.operation
  const visibleError = () => {
    if (!["failed", "interrupted", "blocked"].includes(operation().status)) return undefined
    return operation().lastError
  }
  const actions = () => {
    if (operation().status === "draft" && operation().plan) return ["approve"] as const
    if (operation().status === "planned") return ["run"] as const
    if (operation().status === "running") return ["run", "interrupt"] as const
    if (operation().status === "failed" || operation().status === "interrupted" || operation().status === "blocked")
      return ["recover"] as const
    return [] as const
  }

  return (
    <div class="flex min-w-0 flex-col gap-5">
      <header class="border-b border-v2-border-border-base pb-4">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <a href="/operations" class="text-[11px] text-v2-text-text-muted hover:text-v2-text-text-base">
              {language.t("ulm.operations.back")}
            </a>
            <h1 class="mt-2 max-w-4xl break-words text-[22px] font-[560] leading-7 tracking-[-0.035em] text-v2-text-text-base">
              {operation().objective}
            </h1>
            <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-v2-text-text-muted">
              <span>{language.t(operationStatusKey(operation().status))}</span>
              <span aria-hidden="true">·</span>
              <span>{language.t("ulm.operations.revision", { revision: operation().revision })}</span>
              <span aria-hidden="true">·</span>
              <span>{language.t("ulm.operations.updated", { time: operationTime(operation().updatedAt) })}</span>
              <span aria-hidden="true">·</span>
              <span>{operation().id}</span>
            </div>
          </div>
          <Show when={props.sessionID && !props.attached}>
            <Button
              variant="outline"
              size="normal"
              disabled={props.busy || props.attaching}
              aria-busy={props.attaching}
              onClick={props.onAttach}
            >
              {language.t("ulm.operations.attachToChat")}
            </Button>
          </Show>
          <Show when={props.sessionID && props.attached}>
            <span class="rounded-full bg-v2-background-bg-layer-01 px-2.5 py-1 text-[11px] text-v2-text-text-muted">
              {language.t("ulm.operations.attached")}
            </span>
          </Show>
        </div>
        <div class="mt-4 grid gap-2 text-[12px] leading-4 text-v2-text-text-muted sm:grid-cols-2">
          <div>
            <span class="text-v2-text-text-faint">{language.t("ulm.operations.scope")}: </span>
            <span>{operation().scope.targets.join(", ")}</span>
            <span> · {language.t(`ulm.operations.scopeMode.${operation().scope.mode}`)}</span>
          </div>
          <div>
            <span class="text-v2-text-text-faint">{language.t("ulm.operations.sessions")}: </span>
            <span>
              {operation().sessionIDs.length > 0
                ? operation()
                    .sessionIDs.map((id) => (id.startsWith("operator-local-") ? language.t("ulm.operations.session.localShort") : id))
                    .join(", ")
                : language.t("ulm.operations.session.localShort")}
            </span>
          </div>
        </div>
      </header>

      <Show when={visibleError()}>
        {(error) => (
          <section role="alert" class="border-s-2 border-v2-border-border-critical bg-v2-background-bg-layer-01 px-3 py-2.5">
            <div class="text-[12px] font-[550] text-v2-text-text-base">{language.t("ulm.operations.lastFailure")}</div>
            <div class="mt-1 text-[12px] leading-4 text-v2-text-text-muted">{error().message}</div>
            <div class="mt-1 text-[10px] text-v2-text-text-faint">{error().code} · {operationTime(error().at)}</div>
          </section>
        )}
      </Show>

      <section class="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div class="min-w-0">
          <div class="mb-2 flex items-baseline justify-between gap-2">
            <h2 class="text-[14px] font-[550] text-v2-text-text-base">
              {language.t(operation().plan?.approvedAt ? "ulm.operations.plan" : "ulm.operations.planDraft")}
            </h2>
            <Show when={operation().plan?.approvedAt}>
              {(approvedAt) => (
                <span class="text-[10px] text-v2-text-text-muted">
                  {language.t("ulm.operations.approved", { time: operationTime(approvedAt()) })}
                </span>
              )}
            </Show>
          </div>
          <Show
            when={operation().plan}
            fallback={
              <div class="rounded-[6px] border border-dashed border-v2-border-border-base px-3 py-4 text-[12px] leading-4 text-v2-text-text-muted">
                {language.t("ulm.operations.planMissing")}
              </div>
            }
          >
            {(plan) => (
              <div>
                <Show when={plan().assumptions.length > 0}>
                  <div class="mb-3 rounded-[6px] bg-v2-background-bg-layer-01 px-3 py-2">
                    <div class="text-[10px] font-[550] uppercase tracking-wide text-v2-text-text-faint">
                      {language.t("ulm.operations.assumptions")}
                    </div>
                    <For each={plan().assumptions}>
                      {(assumption) => <p class="mt-1 text-[12px] leading-4 text-v2-text-text-muted">{assumption}</p>}
                    </For>
                  </div>
                </Show>
                <ol class="divide-y divide-v2-border-border-base border-y border-v2-border-border-base">
                  <For each={plan().phases}>
                    {(phase, index) => (
                      <li class="flex gap-3 py-3">
                        <span class="mt-px w-5 shrink-0 font-mono text-[10px] tabular-nums text-v2-text-text-faint">
                          {String(index() + 1).padStart(2, "0")}
                        </span>
                        <div class="min-w-0 flex-1">
                          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <h3 class="text-[13px] font-[520] text-v2-text-text-base">{phase.title}</h3>
                            <span class="rounded-full bg-v2-background-bg-layer-01 px-2 py-0.5 text-[10px] text-v2-text-text-muted">
                              {language.t(phaseStatusKey(phase.status))}
                            </span>
                          </div>
                          <Show when={phase.successCriteria.length > 0}>
                            <ul class="mt-1.5 list-disc ps-4 text-[11px] leading-4 text-v2-text-text-muted">
                              <For each={phase.successCriteria}>{(criterion) => <li>{criterion}</li>}</For>
                            </ul>
                          </Show>
                          <Show when={phase.dependsOn.length > 0}>
                            <p class="mt-1 text-[10px] text-v2-text-text-faint">
                              {language.t("ulm.operations.dependencies", { phases: phase.dependsOn.join(", ") })}
                            </p>
                          </Show>
                        </div>
                      </li>
                    )}
                  </For>
                </ol>
              </div>
            )}
          </Show>
        </div>

        <aside class="flex min-w-0 flex-col gap-5">
          <section>
            <h2 class="text-[14px] font-[550] text-v2-text-text-base">{language.t("ulm.operations.control")}</h2>
            <p class="mt-1 text-[11px] leading-4 text-v2-text-text-muted">{language.t("ulm.operations.controlDescription")}</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <For each={actions()}>
                {(action) => (
                  <Button
                    variant={action === "interrupt" ? "outline" : "contrast"}
                    size="normal"
                    disabled={props.busy}
                    onClick={() => props.onAction(action)}
                  >
                    {language.t(
                      action === "run" && operation().status === "running"
                        ? "ulm.operations.action.checkProgress"
                        : `ulm.operations.action.${action}`,
                    )}
                  </Button>
                )}
              </For>
              <Show when={!actions().length}>
                <p class="text-[12px] leading-4 text-v2-text-text-muted">{language.t("ulm.operations.noAction")}</p>
              </Show>
            </div>
          </section>

          <Show when={operation().goal.status === "active"}>
            <section class="border-t border-v2-border-border-base pt-4">
              <h2 class="text-[14px] font-[550] text-v2-text-text-base">{language.t("ulm.operations.goal.title")}</h2>
              <p class="mt-1 text-[11px] leading-4 text-v2-text-text-muted">{language.t("ulm.operations.goal.description")}</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <For each={["continue", "done", "needs_operator"] as const}>
                  {(verdict) => (
                    <Button
                      variant={verdict === "done" ? "contrast" : "outline"}
                      size="small"
                      disabled={props.busy}
                      onClick={() => props.onAction(verdict)}
                    >
                      {language.t(`ulm.operations.goal.${verdict}`)}
                    </Button>
                  )}
                </For>
              </div>
            </section>
          </Show>

          <section class="border-t border-v2-border-border-base pt-4">
            <div class="flex items-baseline justify-between gap-2">
              <h2 class="text-[14px] font-[550] text-v2-text-text-base">{language.t("ulm.operations.evidence")}</h2>
              <Show when={operation().evidence}>
                {(evidence) => <time class="text-[10px] text-v2-text-text-muted">{operationTime(evidence().normalizedAt)}</time>}
              </Show>
            </div>
            <Show
              when={operation().evidence}
              fallback={<p class="mt-2 text-[11px] leading-4 text-v2-text-text-muted">{language.t("ulm.operations.evidenceMissing")}</p>}
            >
              {(evidence) => (
                <div class="mt-2">
                  <p class="text-[11px] text-v2-text-text-muted">
                    {language.plural("ulm.operations.claimCount", evidence().claims.length)} · {language.plural(
                      "ulm.operations.evidenceArtifactCount",
                      evidence().artifacts.length,
                    )}
                  </p>
                  <Show when={evidence().limitations.length > 0}>
                    <ul class="mt-2 list-disc ps-4 text-[11px] leading-4 text-v2-text-text-muted">
                      <For each={evidence().limitations}>{(item) => <li>{item}</li>}</For>
                    </ul>
                  </Show>
                </div>
              )}
            </Show>
            <Show when={operation().executions.some((execution) => execution.status === "succeeded") && !operation().evidence}>
              <Button class="mt-3" variant="outline" size="small" disabled={props.busy} onClick={() => props.onAction("normalize")}>
                {language.t("ulm.operations.action.normalize")}
              </Button>
            </Show>
          </section>
        </aside>
      </section>

      <OperationCredentialsPanel operationID={operation().id} />

      <section class="border-t border-v2-border-border-base pt-4">
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 class="text-[14px] font-[550] text-v2-text-text-base">{language.t("ulm.operations.handoff")}</h2>
            <p class="mt-1 text-[11px] leading-4 text-v2-text-text-muted">
              {language.t("ulm.operations.handoffDescription")}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <Show when={operation().audit}>
              {(audit) => (
                <span class="text-[11px] text-v2-text-text-muted">
                  {language.t(`ulm.operations.audit.${audit().status}`)} · {operationTime(audit().checkedAt)}
                </span>
              )}
            </Show>
            <Button
              variant="outline"
              size="small"
              disabled={props.busy || !operation().evidence}
              onClick={() => props.onAction("report")}
            >
              {language.t("ulm.operations.action.report")}
            </Button>
          </div>
        </div>
        <Show when={operation().audit?.blockers.length}>
          <ul class="mt-3 list-disc ps-4 text-[11px] leading-4 text-v2-text-text-muted">
            <For each={operation().audit?.blockers ?? []}>{(blocker) => <li>{blocker}</li>}</For>
          </ul>
        </Show>
        <Show
          when={operation().artifacts.length > 0}
          fallback={<p class="mt-3 text-[12px] text-v2-text-text-muted">{language.t("ulm.operations.artifactsEmpty")}</p>}
        >
          <ul class="mt-3 divide-y divide-v2-border-border-base border-y border-v2-border-border-base">
            <For each={operation().artifacts}>
              {(artifact) => (
                <li class="flex items-center gap-3 py-2.5">
                  <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-v2-text-text-base">{artifact.path}</span>
                  <span class="shrink-0 text-[10px] text-v2-text-text-faint">{artifact.size ?? "—"}</span>
                  <a
                    class="shrink-0 rounded-[5px] px-2 py-1 text-[11px] text-v2-text-text-muted hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base"
                    href={operationApi.artifactURL(operation().id, artifact.path)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {language.t("ulm.operations.openArtifact")}
                  </a>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <Show when={operation().executions.length > 0}>
        <section class="border-t border-v2-border-border-base pt-4">
          <h2 class="text-[14px] font-[550] text-v2-text-text-base">{language.t("ulm.operations.executions")}</h2>
          <div class="mt-2 divide-y divide-v2-border-border-base border-y border-v2-border-border-base">
            <For each={operation().executions.slice().reverse()}>
              {(execution) => (
                <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-2.5">
                  <div class="truncate text-[12px] text-v2-text-text-base">{execution.phaseID}</div>
                  <div class="text-[11px] text-v2-text-text-muted">{language.t(executionStatusKey(execution.status))}</div>
                  <div class="truncate font-mono text-[10px] text-v2-text-text-faint">{execution.id}</div>
                  <div class="text-[10px] tabular-nums text-v2-text-text-faint">
                    {language.plural("ulm.operations.attempt", execution.attempt)}
                  </div>
                  <Show when={execution.errorSummary}>
                    {(summary) => <p class="col-span-2 text-[11px] text-v2-text-text-muted">{summary()}</p>}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>
    </div>
  )
}
