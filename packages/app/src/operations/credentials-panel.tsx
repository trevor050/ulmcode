import { For, Show, createSignal, createEffect, onCleanup, onMount } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { OperationApiError, operationApi } from "./api"
import { operationTime } from "./view"

export function OperationCredentialsPanel(props: { operationID: string }) {
  const language = useLanguage()
  const [result, setResult] = createSignal<Awaited<ReturnType<typeof operationApi.credentials>>>()
  const [error, setError] = createSignal<"unavailable" | "failed">()

  const refresh = async () => {
    try {
      setResult(await operationApi.credentials(props.operationID))
      setError(undefined)
    } catch (cause) {
      if (cause instanceof OperationApiError && cause.status === 503) {
        setResult(undefined)
        setError("unavailable")
        return
      }
      setError("failed")
    }
  }

  createEffect(() => {
    void props.operationID
    void refresh()
  })

  onMount(() => {
    const interval = window.setInterval(() => void refresh(), 15_000)
    onCleanup(() => window.clearInterval(interval))
  })

  return (
    <section class="border-t border-v2-border-border-base pt-4">
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 class="text-[14px] font-[550] text-v2-text-text-base">{language.t("ulm.operations.credentials.title")}</h2>
          <p class="mt-1 text-[11px] leading-4 text-v2-text-text-muted">{language.t("ulm.operations.credentials.description")}</p>
        </div>
        <Show when={result()}>
          <a
            class="shrink-0 rounded-[5px] border border-v2-border-border-base px-2.5 py-1.5 text-[11px] text-v2-text-text-base hover:bg-v2-background-bg-layer-01"
            href={operationApi.vaultURL(props.operationID)}
            target="_blank"
            rel="noopener"
          >
            {language.t("ulm.operations.credentials.openVault")}
          </a>
        </Show>
      </div>

      <Show when={error() === "unavailable"}>
        <p role="status" class="mt-3 rounded-[6px] bg-v2-background-bg-layer-01 px-3 py-2 text-[12px] leading-4 text-v2-text-text-muted">
          {language.t("ulm.operations.credentials.unavailable")}
        </p>
      </Show>
      <Show when={error() === "failed"}>
        <p role="status" class="mt-3 rounded-[6px] bg-v2-background-bg-layer-01 px-3 py-2 text-[12px] leading-4 text-v2-text-text-muted">
          {language.t("ulm.operations.credentials.error")}
        </p>
      </Show>
      <Show when={result()}>
        {(value) => (
          <>
            <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-v2-text-text-muted">
              <span>{language.t(value().reviewStatus.submitted ? "ulm.operations.credentials.submitted" : "ulm.operations.credentials.notSubmitted")}</span>
              <span>{language.t("ulm.operations.credentials.reviewCounts", {
                reviewed: value().reviewStatus.reviewed,
                pending: value().reviewStatus.pending,
                reauth: value().reviewStatus.requiresReauth,
              })}</span>
            </div>
            <Show
              when={value().credentials.length > 0}
              fallback={<p class="mt-2 text-[11px] text-v2-text-text-faint">{language.t("ulm.operations.credentials.empty")}</p>}
            >
              <ul class="mt-2 divide-y divide-v2-border-border-base border-y border-v2-border-border-base">
                <For each={value().credentials}>
                  {(credential) => (
                    <li class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2">
                      <span class="font-mono text-[10px] text-v2-text-text-base">{credential.credentialID}</span>
                      <span class="text-[10px] text-v2-text-text-muted">{language.t(`ulm.operations.credentials.status.${credential.status}`)}</span>
                      <Show when={credential.usePolicy.authorizedTargets.length > 0}>
                        <span class="min-w-0 flex-1 truncate text-[10px] text-v2-text-text-faint">
                          {language.t("ulm.operations.credentials.targets", { targets: credential.usePolicy.authorizedTargets.join(", ") })}
                        </span>
                      </Show>
                      <Show when={credential.usePolicy.reviewedAt}>
                        {(reviewedAt) => <time class="text-[10px] text-v2-text-text-faint">{operationTime(reviewedAt())}</time>}
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </>
        )}
      </Show>
    </section>
  )
}
