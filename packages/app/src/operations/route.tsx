import type { OperationRecord } from "@ulmcode/operations/operation"
import { Button } from "@opencode/ui/button"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { createLabOperationInput, OperationList } from "./list"
import { OperationDetail, type OperationAction } from "./detail"
import { OperationApiError, operationApi, operationsApiBase } from "./api"
import { operationSort } from "./view"
import { useLanguage } from "@/runtime/i18n/language"

const localLabTarget = import.meta.env.VITE_ULMCODE_LAB_TARGET || "http://127.0.0.1:4320"
export function OperationsRoute() {
  const language = useLanguage()
  const params = useParams<{ operationID?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [items, setItems] = createSignal<OperationRecord[]>([])
  const [operation, setOperation] = createSignal<OperationRecord>()
  const [objective, setObjective] = createSignal("")
  const [target, setTarget] = createSignal(localLabTarget)
  const [loading, setLoading] = createSignal(true)
  const [hasLoaded, setHasLoaded] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [connection, setConnection] = createSignal<"checking" | "online" | "offline">("checking")
  const [error, setError] = createSignal<string>()
  const [notice, setNotice] = createSignal<string>()
  const [lastUpdated, setLastUpdated] = createSignal<string>()
  const [attachingID, setAttachingID] = createSignal<string>()
  const selectedSessionID = createMemo(() => new URLSearchParams(location.search).get("sessionID")?.trim() || undefined)
  const operationID = createMemo(() => params.operationID)
  const attached = createMemo(() => !!selectedSessionID() && !!operation()?.sessionIDs.includes(selectedSessionID()!))

  const refresh = async () => {
    setLoading(true)
    try {
      if (operationID()) {
        const result = await operationApi.get(operationID()!)
        setOperation(result.operation)
      } else {
        const result = await operationApi.list()
        setItems(operationSort(result.operations))
        setOperation(undefined)
      }
      setConnection("online")
      setError(undefined)
      setLastUpdated(new Date().toISOString())
    } catch (cause) {
      if (cause instanceof TypeError) setConnection("offline")
      if (cause instanceof OperationApiError) setConnection("online")
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setHasLoaded(true)
      setLoading(false)
    }
  }

  createEffect(() => {
    void refresh()
  })

  onMount(() => {
    const interval = window.setInterval(() => void refresh(), 5_000)
    onCleanup(() => window.clearInterval(interval))
  })

  const targetError = () => {
    const value = target().trim()
    try {
      const url = new URL(value)
      if (["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return undefined
    } catch {}
    return language.t("ulm.operations.new.loopbackOnly")
  }

  const create = async () => {
    if (!objective().trim()) return
    if (targetError()) {
      setError(targetError())
      return
    }
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const result = await operationApi.create(createLabOperationInput(objective(), selectedSessionID(), target()))
      setConnection("online")
      setOperation(result.operation)
      setNotice(language.t("ulm.operations.created"))
      setObjective("")
      navigate(`/operations/${encodeURIComponent(result.operation.id)}${location.search}`)
      await refresh()
    } catch (cause) {
      if (cause instanceof TypeError) setConnection("offline")
      if (cause instanceof OperationApiError) setConnection("online")
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const attach = async (id: string) => {
    const sessionID = selectedSessionID()
    if (!sessionID) return
    setAttachingID(id)
    setError(undefined)
    try {
      const result = await operationApi.bind(id, sessionID)
      setConnection("online")
      if (operationID() === id) setOperation(result.operation)
      setItems(items().map((item) => (item.id === id ? result.operation : item)))
      setNotice(language.t("ulm.operations.bound", { id: sessionID }))
    } catch (cause) {
      if (cause instanceof TypeError) setConnection("offline")
      if (cause instanceof OperationApiError) setConnection("online")
      setError(cause instanceof Error ? cause.message : String(cause))
      await refresh()
    } finally {
      setAttachingID(undefined)
    }
  }

  const act = async (action: OperationAction) => {
    const current = operation()
    if (!current || busy()) return
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      let next = current
      if (action === "approve") next = (await operationApi.approve(current.id, "local-operator")).operation
      if (action === "run") {
        const result = await operationApi.run(current.id)
        next = result.operation
        setNotice(language.t(`ulm.operations.decision.${result.decision.action}`))
      }
      if (action === "interrupt") next = (await operationApi.interrupt(current.id, "Operator requested an interruption.")).operation
      if (action === "recover") {
        const result = await operationApi.recover(current.id)
        next = result.operation
        setNotice(
          language.t("ulm.operations.recoveryResult", {
            recovered: result.recovery.recovered.length,
            waiting: result.recovery.waiting.length,
          }),
        )
      }
      if (action === "normalize") next = (await operationApi.normalize(current.id)).operation
      if (action === "report") next = (await operationApi.report(current.id)).operation
      if (action === "continue" || action === "done" || action === "needs_operator") {
        const result = await operationApi.reviewGoal(current.id, action)
        next = result.operation
      }
      setConnection("online")
      setOperation(next)
      if (!notice()) setNotice(language.t(`ulm.operations.actionResult.${action}`))
      setLastUpdated(new Date().toISOString())
    } catch (cause) {
      setError(cause instanceof OperationApiError ? cause.message : cause instanceof Error ? cause.message : String(cause))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const openOperation = (id: string) =>
    navigate(`/operations/${encodeURIComponent(id)}${location.search}`)

  return (
    <main class="mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 self-stretch overflow-auto rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]">
      <div class="mx-auto flex w-full max-w-[1180px] min-w-0 flex-col px-4 py-5 md:px-7 md:py-7">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-v2-border-border-base pb-3">
          <div class="flex min-w-0 items-center gap-2 text-[11px] text-v2-text-text-muted">
            <span class="size-1.5 rounded-full" classList={{
              "bg-v2-icon-icon-success": connection() === "online",
              "bg-v2-icon-icon-critical": connection() === "offline",
              "bg-v2-icon-icon-muted": connection() === "checking",
            }} />
            <span>{language.t(`ulm.operations.connection.${connection()}`)}</span>
            <span aria-hidden="true">·</span>
            <span class="truncate font-mono">{operationsApiBase}</span>
            <Show when={lastUpdated()}>
              {(value) => <time>{language.t("ulm.operations.lastUpdated", { time: new Date(value()).toLocaleTimeString() })}</time>}
            </Show>
          </div>
          <div class="flex items-center gap-2">
            <Button variant="ghost-muted" size="small" disabled={loading()} onClick={() => void refresh()}>
              {language.t("ulm.operations.refresh")}
            </Button>
            <Show when={selectedSessionID()}>
              {(id) => <span class="max-w-44 truncate text-[10px] text-v2-text-text-faint">{language.t("ulm.operations.session.bound", { id: id() })}</span>}
            </Show>
          </div>
        </div>

        <Show when={error()}>
          {(message) => (
            <div role="alert" class="mb-4 flex flex-wrap items-center justify-between gap-3 border-s-2 border-v2-border-border-critical bg-v2-background-bg-layer-01 px-3 py-2.5">
              <div class="min-w-0">
                <div class="text-[12px] font-[550] text-v2-text-text-base">{language.t("ulm.operations.error.title")}</div>
                <p class="mt-0.5 break-words text-[12px] leading-4 text-v2-text-text-muted">{message()}</p>
              </div>
            <Button variant="outline" size="small" onClick={() => void refresh()}>{language.t("ulm.operations.retry")}</Button>
            </div>
          )}
        </Show>
        <Show when={notice()}>
          {(message) => <div role="status" class="mb-4 rounded-[6px] bg-v2-background-bg-layer-01 px-3 py-2 text-[12px] text-v2-text-text-muted">{message()}</div>}
        </Show>
        <Show
          when={hasLoaded() || items().length > 0 || operation()}
          fallback={<div role="status" aria-busy="true" class="py-10 text-center text-[13px] text-v2-text-text-muted">{language.t("ulm.operations.loading")}</div>}
        >
          <Show
            when={operationID()}
            fallback={
              <Show
                when={!(error() && items().length === 0)}
                fallback={
                  <div role="status" class="py-10 text-center text-[13px] text-v2-text-text-muted">
                    {language.t("ulm.operations.unavailable.description")}
                  </div>
                }
              >
              <OperationList
                operations={items()}
                sessionID={selectedSessionID()}
                objective={objective()}
                target={target()}
                busy={busy()}
                onObjective={setObjective}
                onTarget={setTarget}
                onCreate={() => void create()}
                onOpen={openOperation}
                onAttach={(id) => void attach(id)}
                attachingID={attachingID()}
              />
              </Show>
            }
          >
            <Show
              when={operation()}
              fallback={
                <div class="py-10 text-center">
                  <h1 class="text-[15px] font-[550] text-v2-text-text-base">{language.t("ulm.operations.notFound.title")}</h1>
                  <p class="mt-1 text-[12px] text-v2-text-text-muted">{language.t("ulm.operations.notFound.description")}</p>
                  <Button class="mt-4" variant="outline" size="small" onClick={() => navigate("/operations")}>{language.t("ulm.operations.back")}</Button>
                </div>
              }
            >
              {(item) => (
                <OperationDetail
                  operation={item()}
                  sessionID={selectedSessionID()}
                  attached={attached()}
                  busy={busy()}
                  attaching={attachingID() === item().id}
                  onAction={(action) => void act(action)}
                  onAttach={() => void attach(item().id)}
                />
              )}
            </Show>
          </Show>
        </Show>
      </div>
    </main>
  )
}
