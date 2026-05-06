import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useEvent } from "@tui/context/event"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"

type OperationStatus = {
  operationID: string
  operation?: {
    objective?: string
    stage?: string
    status?: string
    summary?: string
    riskLevel?: string
    nextActions?: string[]
    blockers?: string[]
  }
  goal?: {
    status?: string
    objective?: string
    targetDurationHours?: number
  }
  supervisor?: {
    action?: string
    reason?: string
    requiredNextTool?: string
    blockers?: string[]
    nextTools?: string[]
  }
  toolInventory?: {
    total?: number
    installed?: number
    missing?: number
    highValueMissing?: number
    installedHighValue?: string[]
    missingHighValue?: string[]
  }
  policies?: {
    foregroundCommand?: string
  }
  findings?: {
    total?: number
  }
  evidence?: {
    total?: number
  }
  reports?: Record<string, boolean>
  runtimeSummary?: boolean
}

type OperationAudit = {
  ok?: boolean
  blockers?: string[]
  recommendedTools?: string[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  return value as Record<string, unknown>
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function operationStatus(value: unknown): OperationStatus | undefined {
  const item = record(value)
  if (!item || typeof item.operationID !== "string") return
  const operation = record(item.operation)
  const findings = record(item.findings)
  const evidence = record(item.evidence)
  const reports = record(item.reports)
  const goal = record(item.goal)
  const supervisor = record(item.supervisor)
  const toolInventory = record(item.toolInventory)
  const policies = record(item.policies)
  return {
    operationID: item.operationID,
    operation: operation
      ? {
          objective: typeof operation.objective === "string" ? operation.objective : undefined,
          stage: typeof operation.stage === "string" ? operation.stage : undefined,
          status: typeof operation.status === "string" ? operation.status : undefined,
          summary: typeof operation.summary === "string" ? operation.summary : undefined,
          riskLevel: typeof operation.riskLevel === "string" ? operation.riskLevel : undefined,
          nextActions: strings(operation.nextActions),
          blockers: strings(operation.blockers),
        }
      : undefined,
    goal: goal
      ? {
          status: typeof goal.status === "string" ? goal.status : undefined,
          objective: typeof goal.objective === "string" ? goal.objective : undefined,
          targetDurationHours: typeof goal.targetDurationHours === "number" ? goal.targetDurationHours : undefined,
        }
      : undefined,
    supervisor: supervisor
      ? {
          action: typeof supervisor.action === "string" ? supervisor.action : undefined,
          reason: typeof supervisor.reason === "string" ? supervisor.reason : undefined,
          requiredNextTool: typeof supervisor.requiredNextTool === "string" ? supervisor.requiredNextTool : undefined,
          blockers: strings(supervisor.blockers),
          nextTools: strings(supervisor.nextTools),
        }
      : undefined,
    toolInventory: toolInventory
      ? {
          total: typeof toolInventory.total === "number" ? toolInventory.total : undefined,
          installed: typeof toolInventory.installed === "number" ? toolInventory.installed : undefined,
          missing: typeof toolInventory.missing === "number" ? toolInventory.missing : undefined,
          highValueMissing: typeof toolInventory.highValueMissing === "number" ? toolInventory.highValueMissing : undefined,
          installedHighValue: strings(toolInventory.installedHighValue),
          missingHighValue: strings(toolInventory.missingHighValue),
        }
      : undefined,
    policies: policies
      ? {
          foregroundCommand: typeof policies.foregroundCommand === "string" ? policies.foregroundCommand : undefined,
        }
      : undefined,
    findings: findings && typeof findings.total === "number" ? { total: findings.total } : undefined,
    evidence: evidence && typeof evidence.total === "number" ? { total: evidence.total } : undefined,
    reports: reports
      ? Object.fromEntries(Object.entries(reports).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"))
      : undefined,
    runtimeSummary: typeof item.runtimeSummary === "boolean" ? item.runtimeSummary : undefined,
  }
}

function operationAudit(value: unknown): OperationAudit | undefined {
  const item = record(value)
  if (!item) return
  return {
    ok: typeof item.ok === "boolean" ? item.ok : undefined,
    blockers: strings(item.blockers),
    recommendedTools: strings(item.recommendedTools),
  }
}

function stageLabel(item: OperationStatus) {
  const stage = item.operation?.stage ?? "unknown"
  const status = item.operation?.status ?? "unknown"
  return `${stage}/${status}`
}

function countLabel(item: OperationStatus) {
  return `${item.findings?.total ?? 0} findings, ${item.evidence?.total ?? 0} evidence`
}

function readyReports(item: OperationStatus) {
  return Object.entries(item.reports ?? {})
    .filter(([, value]) => value)
    .map(([key]) => key)
}

function mergeOperationUpdate(
  previous: OperationStatus | undefined,
  update: {
    operationID: string
    operation?: OperationStatus["operation"]
    goal?: OperationStatus["goal"]
    supervisor?: OperationStatus["supervisor"]
    toolInventory?: OperationStatus["toolInventory"]
    policies?: OperationStatus["policies"]
    findings?: OperationStatus["findings"]
    evidence?: OperationStatus["evidence"]
    reports?: OperationStatus["reports"]
    runtimeSummary?: boolean
  },
): OperationStatus {
  return {
    operationID: update.operationID,
    operation: update.operation ? { ...previous?.operation, ...update.operation } : previous?.operation,
    goal: update.goal ?? previous?.goal,
    supervisor: update.supervisor ?? previous?.supervisor,
    toolInventory: update.toolInventory ?? previous?.toolInventory,
    policies: update.policies ?? previous?.policies,
    findings: update.findings ?? previous?.findings,
    evidence: update.evidence ?? previous?.evidence,
    reports: update.reports ?? previous?.reports,
    runtimeSummary: update.runtimeSummary ?? previous?.runtimeSummary,
  }
}

export function UlmOperations() {
  const sdk = useSDK()
  const event = useEvent()
  const route = useRoute()
  const data = useRouteData("ulmOperations")
  const { theme } = useTheme()
  const [selected, setSelected] = createSignal(0)
  const [items, itemsActions] = createResource(async () => {
    const result = await sdk.client.ulm.operation.list({ eventLimit: "2" })
    return (result.data ?? []).map(operationStatus).filter((item): item is OperationStatus => item !== undefined)
  })
  const [detail, detailActions] = createResource(
    () => data.operationID ?? "",
    async (operationID) => {
      if (!operationID) return
      const [status, audit] = await Promise.all([
        sdk.client.ulm.operation.status({ operationID, eventLimit: "8" }),
        sdk.client.ulm.operation.audit({ operationID, finalHandoff: "true" }).catch(() => undefined),
      ])
      return {
        status: operationStatus(status.data),
        audit: operationAudit(audit?.data),
      }
    },
  )

  const visibleItems = createMemo(() => items() ?? [])
  const selectedItem = createMemo(() => visibleItems()[selected()])
  const activeStatus = createMemo(() => detail()?.status ?? selectedItem())
  const activeAudit = createMemo(() => detail()?.audit)
  const reports = createMemo(() => (activeStatus() ? readyReports(activeStatus()!) : []))

  createEffect(() => {
    if (selected() < visibleItems().length) return
    setSelected(Math.max(0, visibleItems().length - 1))
  })

  createEffect(() => {
    const operationID = data.operationID
    if (!operationID) return
    const index = visibleItems().findIndex((item) => item.operationID === operationID)
    if (index >= 0) setSelected(index)
  })

  const refresh = () => {
    void itemsActions.refetch()
    if (data.operationID) void detailActions.refetch()
  }

  useKeyboard((evt) => {
    if (evt.name === "r") {
      evt.preventDefault()
      refresh()
      return
    }
    if (evt.name === "up") {
      evt.preventDefault()
      setSelected((index) => Math.max(0, index - 1))
      return
    }
    if (evt.name === "down") {
      evt.preventDefault()
      setSelected((index) => Math.max(0, Math.min(visibleItems().length - 1, index + 1)))
      return
    }
    if (evt.name === "enter" && selectedItem()) {
      evt.preventDefault()
      route.navigate({ type: "ulmOperations", operationID: selectedItem()!.operationID })
      return
    }
    if (evt.name === "backspace" && data.operationID) {
      evt.preventDefault()
      route.navigate({ type: "ulmOperations" })
      return
    }
    if (evt.name === "escape") {
      evt.preventDefault()
      route.navigate({ type: "home" })
    }
  })

  const interval = setInterval(refresh, 15000)
  onCleanup(() => clearInterval(interval))

  event.on("operation.updated", (evt) => {
    itemsActions.mutate((current) => {
      const items = current ?? []
      const index = items.findIndex((item) => item.operationID === evt.properties.operationID)
      if (index === -1) return [mergeOperationUpdate(undefined, evt.properties), ...items]
      return items.map((item, itemIndex) =>
        itemIndex === index ? mergeOperationUpdate(item, evt.properties) : item,
      )
    })
    if (data.operationID !== evt.properties.operationID) return
    detailActions.mutate((current) => ({
      status: mergeOperationUpdate(current?.status, evt.properties),
      audit: current?.audit,
    }))
    if (evt.properties.artifact === "operation_audit") void detailActions.refetch()
  })

  return (
    <box flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          ULM Operations
        </text>
        <text fg={theme.textMuted}>r refresh / enter detail / backspace list / esc home</text>
      </box>
      <box flexDirection="row" flexGrow={1} gap={2} minHeight={0}>
        <box width={34} flexShrink={0} borderColor={theme.border} borderStyle="single" paddingLeft={1} paddingRight={1}>
          <Show when={!items.loading} fallback={<text fg={theme.textMuted}>Loading operations...</text>}>
            <Show when={visibleItems().length} fallback={<text fg={theme.textMuted}>No ULM operations found.</text>}>
              <For each={visibleItems().slice(0, 24)}>
                {(item, index) => (
                  <box
                    onMouseUp={() => {
                      setSelected(index())
                      route.navigate({ type: "ulmOperations", operationID: item.operationID })
                    }}
                  >
                    <text
                      fg={index() === selected() ? theme.primary : item.operation?.status === "complete" ? theme.success : theme.text}
                      attributes={index() === selected() ? TextAttributes.BOLD : undefined}
                    >
                      {index() === selected() ? "> " : "  "}
                      {item.operationID}
                    </text>
                    <text fg={theme.textMuted}>
                      {"  "}
                      {stageLabel(item)} - {countLabel(item)}
                    </text>
                  </box>
                )}
              </For>
            </Show>
          </Show>
        </box>
        <box flexGrow={1} minWidth={0} borderColor={theme.border} borderStyle="single" paddingLeft={1} paddingRight={1}>
          <Show when={activeStatus()} fallback={<text fg={theme.textMuted}>Select an operation to inspect.</text>}>
            {(status) => (
              <box gap={1}>
                <box>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {status().operationID}
                  </text>
                  <text fg={theme.textMuted}>
                    {stageLabel(status())} / risk {status().operation?.riskLevel ?? "unknown"}
                  </text>
                </box>
                <box>
                  <text fg={theme.textMuted} wrapMode="word">
                    {status().operation?.objective ?? "No objective recorded."}
                  </text>
                  <text fg={theme.text} wrapMode="word">
                    {status().operation?.summary ?? "No summary recorded."}
                  </text>
                </box>
                <box>
                  <text fg={theme.text}>
                    goal: {status().goal?.status ?? "missing"}
                    <span style={{ fg: theme.textMuted }}>
                      {status().goal?.targetDurationHours !== undefined ? ` / ${status().goal?.targetDurationHours}h` : ""}
                    </span>
                  </text>
                  <text fg={theme.textMuted} wrapMode="word">
                    supervisor: {status().supervisor?.action ?? "none"}
                    {status().supervisor?.reason ? ` - ${status().supervisor?.reason}` : ""}
                    {status().supervisor?.requiredNextTool ? ` / next ${status().supervisor?.requiredNextTool}` : ""}
                  </text>
                  <text fg={theme.textMuted} wrapMode="word">
                    tools:{" "}
                    {status().toolInventory
                      ? `${status().toolInventory?.installed ?? 0}/${status().toolInventory?.total ?? 0} installed, ${status().toolInventory?.highValueMissing ?? 0} high-value missing`
                      : "inventory missing; run tool_inventory"}
                  </text>
                </box>
                <box>
                  <text fg={theme.text}>
                    {countLabel(status())}
                    <span style={{ fg: theme.textMuted }}>
                      {" "}
                      runtime {status().runtimeSummary ? "present" : "missing"}
                    </span>
                  </text>
                  <text fg={theme.textMuted}>reports: {reports().length ? reports().join(", ") : "none"}</text>
                  <text fg={theme.textMuted} wrapMode="word">
                    {status().policies?.foregroundCommand ?? "commands expected over two minutes must run supervised/background"}
                  </text>
                </box>
                <Show when={status().operation?.nextActions?.length}>
                  <box>
                    <text fg={theme.text}>next actions</text>
                    <For each={status().operation?.nextActions ?? []}>
                      {(action) => <text fg={theme.textMuted} wrapMode="word">- {action}</text>}
                    </For>
                  </box>
                </Show>
                <Show when={(status().operation?.blockers?.length ?? 0) + (status().supervisor?.blockers?.length ?? 0)}>
                  <box>
                    <text fg={theme.warning}>blockers</text>
                    <For each={[...(status().operation?.blockers ?? []), ...(status().supervisor?.blockers ?? [])]}>
                      {(blocker) => <text fg={theme.textMuted} wrapMode="word">- {blocker}</text>}
                    </For>
                  </box>
                </Show>
                <Show when={activeAudit()}>
                  {(audit) => (
                    <box>
                      <text fg={audit().ok ? theme.success : theme.warning}>
                        audit: {audit().ok ? "ready" : "attention required"}
                      </text>
                      <For each={(audit().blockers ?? []).slice(0, 8)}>
                        {(blocker) => <text fg={theme.textMuted} wrapMode="word">- {blocker}</text>}
                      </For>
                      <Show when={audit().recommendedTools?.length}>
                        <text fg={theme.textMuted}>tools: {audit().recommendedTools!.join(", ")}</text>
                      </Show>
                    </box>
                  )}
                </Show>
              </box>
            )}
          </Show>
        </box>
      </box>
    </box>
  )
}
