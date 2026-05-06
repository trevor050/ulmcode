import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { createMemo, createResource, For, onMount, Show } from "solid-js"

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
    targetDurationHours?: number
  }
  supervisor?: {
    action?: string
    reason?: string
    requiredNextTool?: string
    blockers?: string[]
  }
  toolInventory?: {
    total?: number
    installed?: number
    highValueMissing?: number
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
          targetDurationHours: typeof goal.targetDurationHours === "number" ? goal.targetDurationHours : undefined,
        }
      : undefined,
    supervisor: supervisor
      ? {
          action: typeof supervisor.action === "string" ? supervisor.action : undefined,
          reason: typeof supervisor.reason === "string" ? supervisor.reason : undefined,
          requiredNextTool: typeof supervisor.requiredNextTool === "string" ? supervisor.requiredNextTool : undefined,
          blockers: strings(supervisor.blockers),
        }
      : undefined,
    toolInventory: toolInventory
      ? {
          total: typeof toolInventory.total === "number" ? toolInventory.total : undefined,
          installed: typeof toolInventory.installed === "number" ? toolInventory.installed : undefined,
          highValueMissing: typeof toolInventory.highValueMissing === "number" ? toolInventory.highValueMissing : undefined,
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

export function DialogUlmOperations() {
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [items, { refetch }] = createResource(async () => {
    const result = await sdk.client.ulm.operation.list({ eventLimit: "2" })
    return (result.data ?? []).map(operationStatus).filter((item): item is OperationStatus => item !== undefined)
  })

  useKeyboard((evt) => {
    if (evt.name !== "r") return
    evt.preventDefault()
    void refetch()
  })

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo(() => {
    if (items.loading) {
      return [
        {
          title: "Loading ULM operations...",
          value: "",
          disabled: true,
        },
      ]
    }
    if (!items()?.length) {
      return [
        {
          title: "No ULM operations found",
          value: "",
          description: "Run a ULM operation first, then reopen this dashboard.",
          disabled: true,
        },
      ]
    }
    return items()!.map((item) => ({
      title: item.operationID,
      value: item.operationID,
      description: item.operation?.summary ?? item.operation?.objective ?? stageLabel(item),
      footer: `${stageLabel(item)} - ${countLabel(item)}`,
      category: item.operation?.riskLevel ? `risk: ${item.operation.riskLevel}` : undefined,
      gutter: () => (
        <text
          style={{
            fg: item.operation?.status === "complete" ? theme.success : theme.warning,
          }}
        >
          |
        </text>
      ),
    }))
  })

  return (
    <DialogSelect
      title="ULM Operations"
      options={options()}
      onSelect={(option) => {
        if (!option.value) return
        dialog.replace(() => <DialogUlmOperationDashboard operationID={option.value} />)
      }}
    />
  )
}

function DialogUlmOperationDashboard(props: { operationID: string }) {
  const sdk = useSDK()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [data, { refetch }] = createResource(
    () => props.operationID,
    async (operationID) => {
      const [status, audit] = await Promise.all([
        sdk.client.ulm.operation.status({ operationID, eventLimit: "5" }),
        sdk.client.ulm.operation.audit({ operationID, finalHandoff: "true" }).catch(() => undefined),
      ])
      return {
        status: operationStatus(status.data),
        audit: operationAudit(audit?.data),
      }
    },
  )

  useKeyboard((evt) => {
    if (evt.name === "r") {
      evt.preventDefault()
      void refetch()
    }
    if (evt.name === "backspace") {
      evt.preventDefault()
      dialog.replace(() => <DialogUlmOperations />)
    }
  })

  onMount(() => {
    dialog.setSize("large")
  })

  const item = createMemo(() => data()?.status)
  const audit = createMemo(() => data()?.audit)
  const reports = createMemo(() => (item() ? readyReports(item()!) : []))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          ULM {props.operationID}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          r refresh / backspace / esc
        </text>
      </box>
      <Show when={!data.loading} fallback={<text fg={theme.textMuted}>Loading operation dashboard...</text>}>
        <Show when={item()} fallback={<text fg={theme.error}>Operation not found.</text>}>
          {(status) => (
            <>
              <box>
                <text fg={theme.text}>
                  <b>{stageLabel(status())}</b>
                  <span style={{ fg: theme.textMuted }}> risk {status().operation?.riskLevel ?? "unknown"}</span>
                </text>
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
              <Show when={audit()}>
                {(result) => (
                  <box>
                    <text fg={result().ok ? theme.success : theme.warning}>
                      audit: {result().ok ? "ready" : "attention required"}
                    </text>
                    <For each={(result().blockers ?? []).slice(0, 6)}>
                      {(blocker) => <text fg={theme.textMuted} wrapMode="word">- {blocker}</text>}
                    </For>
                    <Show when={result().recommendedTools?.length}>
                      <text fg={theme.textMuted}>tools: {result().recommendedTools!.join(", ")}</text>
                    </Show>
                  </box>
                )}
              </Show>
            </>
          )}
        </Show>
      </Show>
    </box>
  )
}
