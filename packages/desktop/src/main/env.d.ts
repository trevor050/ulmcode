interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
  readonly OPENCODE_VERSION?: string
  readonly ULMCODE_CLI_CHANNEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
