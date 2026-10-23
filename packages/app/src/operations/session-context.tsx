import type { OperationRecord } from "@ulmcode/operations/operation"
import { Button } from "@opencode/ui/button"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/runtime/i18n/language"
import { operationApi } from "./api"
import { operationStatusKey } from "./view"

export function OperationSessionContext(props: { sessionID: string }) {
  const language = useLanguage()
  const navigate = useNavigate()
  const [state, setState] = createSignal<{
    sessionID: string
    operations: OperationRecord[]
    error?: string
    loading: boolean
  }>()

  const refresh = async (sessionID: string) => {
    setState((current) =>
      current?.sessionID === sessionID
        ? { ...current, loading: true }
        : { sessionID, operations: [], loading: true },
    )
    try {
      const result = await operationApi.list()
      setState({
        sessionID,
        operations: result.operations
          .filter((operation) => operation.sessionIDs.includes(sessionID))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        loading: false,
      })
    } catch (cause) {
      setState({
        sessionID,
        operations: state()?.sessionID === sessionID ? state()!.operations : [],
        error: cause instanceof Error ? cause.message : String(cause),
        loading: false,
      })
    }
  }

  createEffect(() => {
    const id = props.sessionID
    if (id) void refresh(id)
  })

  onMount(() => {
    const interval = window.setInterval(() => void refresh(props.sessionID), 15_000)
    onCleanup(() => window.clearInterval(interval))
  })

  const current = createMemo(() => (state()?.sessionID === props.sessionID ? state() : undefined))
  const operations = () => current()?.operations ?? []
  const open = () => navigate(`/operations?sessionID=${encodeURIComponent(props.sessionID)}`)
  const openOperation = (operation: OperationRecord) =>
    navigate(`/operations/${encodeURIComponent(operation.id)}?sessionID=${encodeURIComponent(props.sessionID)}`)

  return (
    <Show
      when={operations().length > 0}
      fallback={
        <Button
          type="button"
          variant="ghost-muted"
          size="small"
          class="max-w-44 shrink-0"
          title={current()?.error}
          disabled={current()?.loading || !current()}
          onClick={open}
        >
          {language.t(
            current()?.error
              ? "ulm.operations.context.unavailable"
              : current()?.loading
                ? "ulm.operations.context.checking"
                : "ulm.operations.context.attach",
          )}
        </Button>
      }
    >
      {(() => {
        const operation = () => operations()[0]

        return (
          <Button
            type="button"
            variant="ghost-muted"
            size="small"
            class="max-w-56 shrink-0"
            title={operations().map((item) => item.objective).join("; ")}
            onClick={() => (operations().length === 1 ? openOperation(operation()) : open())}
          >
            <span class="truncate">{language.t("ulm.operations.context.label")}</span>
            <span class="max-w-32 truncate text-v2-text-text-muted">{operation().objective}</span>
            <span class="shrink-0 text-[10px] text-v2-text-text-faint">
              {operations().length > 1
                ? language.plural("ulm.operations.context.count", operations().length)
                : language.t(operationStatusKey(operation().status))}
            </span>
          </Button>
        )
      })()}
    </Show>
  )
}
