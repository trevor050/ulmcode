import type { OperationCreateInput, OperationRecord } from "@ulmcode/operations/operation"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { operationSort, operationStatusKey, operationTime } from "./view"

type Props = {
  operations: OperationRecord[]
  sessionID: string | undefined
  objective: string
  target: string
  busy: boolean
  onObjective: (value: string) => void
  onTarget: (value: string) => void
  onCreate: () => void
  onOpen: (id: string) => void
  onAttach: (id: string) => void
  attachingID: string | undefined
}

export function OperationList(props: Props) {
  const language = useLanguage()
  const items = createMemo(() => operationSort(props.operations))

  return (
    <div class="flex min-w-0 flex-col gap-6">
      <section class="border-b border-v2-border-border-base pb-5">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h1 class="text-[24px] font-[560] leading-8 tracking-[-0.04em] text-v2-text-text-base">
              {language.t("ulm.operations.title")}
            </h1>
            <p class="mt-1 max-w-2xl text-[13px] leading-5 text-v2-text-text-muted">
              {language.t("ulm.operations.description")}
            </p>
          </div>
          <span class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-v2-background-bg-layer-01 px-2.5 py-1 text-[11px] text-v2-text-text-muted">
            <Icon name="folder" size="small" />
            {language.t("ulm.operations.durable")}
          </span>
        </div>
      </section>

      <section class="grid gap-6 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
        <form
          class="flex min-w-0 flex-col gap-4 border-b border-v2-border-border-base pb-6 lg:border-b-0 lg:border-e lg:pe-6 lg:pb-0"
          onSubmit={(event) => {
            event.preventDefault()
            props.onCreate()
          }}
        >
          <div>
            <h2 class="text-[15px] font-[550] leading-5 text-v2-text-text-base">{language.t("ulm.operations.new.title")}</h2>
            <p class="mt-1 text-[12px] leading-4 text-v2-text-text-muted">
              {language.t("ulm.operations.new.description")}
            </p>
          </div>
          <label class="flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted">
            {language.t("ulm.operations.objective")}
            <textarea
              class="min-h-24 resize-y rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-base px-3 py-2 text-[13px] leading-5 text-v2-text-text-base outline-none focus:border-v2-border-border-active"
              value={props.objective}
              onInput={(event) => props.onObjective(event.currentTarget.value)}
              required
              maxLength={1000}
            />
          </label>
          <label class="flex flex-col gap-1.5 text-[12px] text-v2-text-text-muted">
            {language.t("ulm.operations.labTarget")}
            <input
              class="h-9 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-base px-3 text-[13px] text-v2-text-text-base outline-none focus:border-v2-border-border-active"
              value={props.target}
              onInput={(event) => props.onTarget(event.currentTarget.value)}
              required
              spellcheck={false}
            />
          </label>
          <div class="rounded-[6px] bg-v2-background-bg-layer-01 px-3 py-2 text-[12px] leading-4 text-v2-text-text-muted">
            {props.sessionID
              ? language.t("ulm.operations.session.bound", { id: props.sessionID })
              : language.t("ulm.operations.session.local")}
          </div>
          <Button type="submit" variant="contrast" size="normal" disabled={props.busy || !props.objective.trim()}>
            {language.t("ulm.operations.new.create")}
          </Button>
        </form>

        <section class="min-w-0">
          <div class="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 class="text-[15px] font-[550] leading-5 text-v2-text-text-base">{language.t("ulm.operations.list.title")}</h2>
              <p class="mt-1 text-[12px] leading-4 text-v2-text-text-muted">
                {language.t("ulm.operations.list.description")}
              </p>
            </div>
            <span class="text-[11px] tabular-nums text-v2-text-text-faint">{items().length}</span>
          </div>
          <Show
            when={items().length > 0}
            fallback={
              <div class="rounded-[7px] border border-dashed border-v2-border-border-base px-4 py-8 text-center">
                <p class="text-[13px] text-v2-text-text-base">{language.t("ulm.operations.empty.title")}</p>
                <p class="mt-1 text-[12px] leading-4 text-v2-text-text-muted">{language.t("ulm.operations.empty.description")}</p>
              </div>
            }
          >
            <div class="divide-y divide-v2-border-border-base border-y border-v2-border-border-base">
              <For each={items()}>
                {(operation) => (
                  <div class="flex min-w-0 items-start gap-3 py-3">
                    <div
                      aria-hidden="true"
                      class="mt-1.5 size-2 shrink-0 rounded-full"
                      classList={{
                        "bg-v2-icon-icon-success": operation.status === "completed",
                        "bg-v2-icon-icon-critical": operation.status === "blocked" || operation.status === "failed",
                        "bg-v2-icon-icon-warning": operation.status === "interrupted",
                        "bg-v2-icon-icon-active": operation.status === "running" || operation.status === "planned",
                        "bg-v2-icon-icon-muted": operation.status === "draft",
                      }}
                    />
                    <button type="button" class="min-w-0 flex-1 text-start" onClick={() => props.onOpen(operation.id)}>
                      <span class="block truncate text-[13px] font-[520] text-v2-text-text-base">{operation.objective}</span>
                      <span class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-v2-text-text-muted">
                        <span>{language.t(operationStatusKey(operation.status))}</span>
                        <span aria-hidden="true">·</span>
                        <span>{language.t("ulm.operations.updated", { time: operationTime(operation.updatedAt) })}</span>
                        <span aria-hidden="true">·</span>
                        <span>{language.plural("ulm.operations.phaseCount", operation.plan?.phases.length ?? 0)}</span>
                      </span>
                    </button>
                    <Show when={props.sessionID && !operation.sessionIDs.includes(props.sessionID)}>
                      <Button
                        variant="ghost-muted"
                        size="small"
                        disabled={props.busy}
                        aria-busy={props.attachingID === operation.id}
                        onClick={() => props.onAttach(operation.id)}
                      >
                        {language.t("ulm.operations.attach")}
                      </Button>
                    </Show>
                    <Show when={props.sessionID && operation.sessionIDs.includes(props.sessionID)}>
                      <span class="shrink-0 rounded-full bg-v2-background-bg-layer-01 px-2 py-1 text-[10px] text-v2-text-text-muted">
                        {language.t("ulm.operations.attached")}
                      </span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>
      </section>
    </div>
  )
}

export function createLabOperationInput(objective: string, sessionID: string | undefined, target: string): OperationCreateInput {
  const currentSession = sessionID?.trim()
  const id = currentSession ? undefined : crypto.randomUUID()
  return {
    ...(id ? { id } : {}),
    objective: objective.trim(),
    sessionID: currentSession || `operator-local-${id}`,
    scope: { mode: "synthetic_lab", targets: [target.trim()] },
  }
}
