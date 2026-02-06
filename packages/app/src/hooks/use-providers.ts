import { useGlobalSync } from "@/context/global-sync"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"

export const popularProviders = ["opencode", "anthropic", "github-copilot", "openai", "google", "openrouter", "vercel"]

function normalizeProviderName(id: string, name: string) {
  if (id !== "opencode") return name
  return name.replace(/OpenCode/g, "ULMCode").replace(/\bopencode\b/g, "ulmcode")
}

function normalizeModelName(name: string) {
  return name.replace(/OpenCode/g, "ULMCode").replace(/\bopencode\b/g, "ulmcode")
}

export function useProviders() {
  const globalSync = useGlobalSync()
  const params = useParams()
  const currentDirectory = createMemo(() => decode64(params.dir) ?? "")
  const providers = createMemo(() => {
    if (currentDirectory()) {
      const [projectStore] = globalSync.child(currentDirectory())
      return projectStore.provider
    }
    return globalSync.data.provider
  })
  const all = createMemo(() =>
    providers().all.map((p) => ({
      ...p,
      name: normalizeProviderName(p.id, p.name),
      models: Object.fromEntries(
        Object.entries(p.models).map(([id, model]) => [
          id,
          {
            ...model,
            name: normalizeModelName(model.name),
          },
        ]),
      ),
    })),
  )
  const connected = createMemo(() => all().filter((p) => providers().connected.includes(p.id)))
  const paid = createMemo(() =>
    connected().filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input)),
  )
  const popular = createMemo(() => all().filter((p) => popularProviders.includes(p.id)))
  return {
    all,
    default: createMemo(() => providers().default),
    popular,
    connected,
    paid,
  }
}
