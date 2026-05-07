import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import nodePath from "path"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { activeOperationGoal } from "@/ulm/operation-context"
import { operationPath } from "@/ulm/artifact"

const id = "internal:sidebar-footer"

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const has = createMemo(() =>
    props.api.state.provider.some(
      (item) => item.id !== "opencode" || Object.values(item.models).some((model) => model.cost?.input !== 0),
    ),
  )
  const done = createMemo(() => props.api.kv.get("dismissed_getting_started", false))
  const show = createMemo(() => !has() && !done())
  const [operationFile, setOperationFile] = createSignal<string | undefined>()

  async function refreshOperationFile() {
    const root = props.api.state.path.worktree || props.api.state.path.directory || process.cwd()
    const operation = await activeOperationGoal(root)
    setOperationFile(
      operation
        ? nodePath.join(operationPath(operation.worktree, operation.operationID), "goals", "operation-goal.json")
        : undefined,
    )
  }

  onMount(() => {
    void refreshOperationFile()
    const interval = setInterval(() => void refreshOperationFile(), 5_000)
    onCleanup(() => clearInterval(interval))
  })

  return (
    <box gap={1}>
      <Show when={show()}>
        <box
          backgroundColor={theme().backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="row"
          gap={1}
        >
          <text flexShrink={0} fg={theme().text}>
            ⬖
          </text>
          <box flexGrow={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme().text}>
                <b>Getting started</b>
              </text>
              <text fg={theme().textMuted} onMouseDown={() => props.api.kv.set("dismissed_getting_started", true)}>
                ✕
              </text>
            </box>
            <text fg={theme().textMuted}>ULMCode includes free models so you can start immediately.</text>
            <text fg={theme().textMuted}>
              Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
            </text>
            <box flexDirection="row" gap={1} justifyContent="space-between">
              <text fg={theme().text}>Connect provider</text>
              <text fg={theme().textMuted}>/connect</text>
            </box>
          </box>
        </box>
      </Show>
      <Show
        when={operationFile()}
        fallback={
          <text fg={theme().textMuted}>
            op: <span style={{ fg: theme().text }}>no active operation</span>
          </text>
        }
      >
        {(file) => (
          <text>
            <span style={{ fg: theme().textMuted }}>op: </span>
            <span style={{ fg: theme().text }}>{file()}</span>
          </text>
        )}
      </Show>
      <text fg={theme().textMuted}>
        <span style={{ fg: theme().success }}>•</span> <b>ULM</b>
        <span style={{ fg: theme().text }}>
          <b>Code</b>
        </span>{" "}
        <span>{props.api.app.version}</span>
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_footer() {
        return <View api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
