import { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider';

type ModelID = string;
type ProviderID = string;
type OpenCodeModel = {
    id: ModelID;
    providerID: ProviderID;
    api: {
        id: string;
        url: string;
        npm: string;
    };
    name: string;
    family?: string;
    capabilities: {
        temperature: boolean;
        reasoning: boolean;
        attachment: boolean;
        toolcall: boolean;
        input: {
            text: boolean;
            audio: boolean;
            image: boolean;
            video: boolean;
            pdf: boolean;
        };
        output: {
            text: boolean;
            audio: boolean;
            image: boolean;
            video: boolean;
            pdf: boolean;
        };
        interleaved: boolean | {
            field: "reasoning_content" | "reasoning_details";
        };
    };
    cost: {
        input: number;
        output: number;
        cache: {
            read: number;
            write: number;
        };
    };
    limit: {
        context: number;
        input?: number;
        output: number;
    };
    status: "alpha" | "beta" | "deprecated" | "active";
    options: Record<string, unknown>;
    headers: Record<string, string>;
    release_date: string;
    variants?: Record<string, Record<string, unknown>>;
};
type OpenCodeProvider = {
    id: ProviderID;
    name?: string;
    source?: string;
    options?: Record<string, unknown>;
    models: Record<string, OpenCodeModel>;
};
type OpenCodeConfig = {
    provider?: Record<string, {
        name?: string;
        npm?: string;
        env?: string[];
        options?: Record<string, unknown>;
        models?: Record<string, unknown>;
    }>;
};
/**
 * Bus events surface to plugins. Shape mirrors what opencode core publishes
 * via `GlobalBus.emit("event", { directory, payload: { type, properties } })`
 * but kept loose since opencode adds events over time and this plugin only
 * reacts to a small subset (currently just `global.disposed`).
 */
type OpenCodeEvent = {
    type?: string;
    payload?: {
        type?: string;
        properties?: Record<string, unknown>;
    };
    [key: string]: unknown;
};
type OpenCodeHooks = {
    config?: (input: OpenCodeConfig) => Promise<void>;
    provider?: {
        id: string;
        models?: (provider: OpenCodeProvider) => Promise<Record<string, OpenCodeModel>>;
    };
    event?: (input: {
        event: OpenCodeEvent;
    }) => Promise<void>;
};
type OpenCodePlugin = (input: unknown, options?: Record<string, unknown>) => Promise<OpenCodeHooks>;

interface ClaudeCodeConfig {
    provider: string;
    cliPath: string;
    cwd?: string;
    account?: string;
    configDir?: string;
    providerID?: string;
    skipPermissions?: boolean;
    permissionMode?: PermissionMode;
    mcpConfig?: string | string[];
    strictMcpConfig?: boolean;
    bridgeOpencodeMcp?: boolean;
    controlRequestBehavior?: ControlRequestBehavior;
    controlRequestToolBehaviors?: Record<string, ControlRequestBehavior>;
    controlRequestDenyMessage?: string;
    proxyTools?: string[];
    webSearch?: WebSearchRouting;
    hotReloadMcp?: boolean;
}
type WebSearchRouting = "claude" | "disabled" | (string & {});
interface ClaudeCodeProviderSettings {
    cliPath?: string;
    cwd?: string;
    name?: string;
    providerID?: string;
    account?: string;
    configDir?: string;
    accounts?: string[];
    skipPermissions?: boolean;
    permissionMode?: PermissionMode;
    mcpConfig?: string | string[];
    strictMcpConfig?: boolean;
    /**
     * Auto-translate opencode's `mcp` config block (from opencode.json/jsonc
     * discovered via cwd/OPENCODE_CONFIG/XDG) into a Claude CLI `--mcp-config`
     * file and pass it through on spawn. Defaults to `true` so the CLI sees
     * the same MCP servers opencode is configured with.
     */
    bridgeOpencodeMcp?: boolean;
    /**
     * Behavior for Claude CLI `control_request` permission checks
     * (`subtype: can_use_tool`) when `skipPermissions` is false.
     *
     * - allow: approve tool use requests automatically.
     * - deny: reject tool use requests automatically.
     *
     * Defaults to `allow`.
     */
    controlRequestBehavior?: ControlRequestBehavior;
    /**
     * Optional per-tool overrides for control-request behavior.
     * Keys are Claude tool names (eg. `Bash`, `Read`, `mcp__github__list_prs`) and
     * values are `allow` or `deny`.
     */
    controlRequestToolBehaviors?: Record<string, ControlRequestBehavior>;
    /**
     * Custom deny message sent back to Claude CLI when behavior resolves to deny.
     */
    controlRequestDenyMessage?: string;
    /**
     * Proxy these Claude built-in tools through opencode instead of letting the
     * CLI execute them directly. When a tool is listed here, the plugin:
     *   - passes `--disallowedTools <ClaudeName>` to the CLI, and
     *   - exposes an equivalent tool via an in-process HTTP MCP server named
     *     `opencode_proxy`. Claude calls the MCP tool, which blocks on
     *     opencode's tool executor (with its native permission UI) and returns
     *     the result.
     *
     * Supported: `bash`, `write`, `edit`, `webfetch`. Leave empty or unset to disable proxying.
     */
    proxyTools?: string[];
    /**
     * Routing for Claude's built-in `WebSearch` tool.
     *
     * - `"claude"` (default): Claude CLI runs WebSearch internally via
     *   Anthropic's web search. No MCP setup required, no extra cost.
     * - `"<opencode-tool-name>"` (e.g. `"websearch_web_search_exa"`): forward
     *   the call to that opencode-side tool with `executed:false`. Requires
     *   the corresponding MCP server to be configured in opencode.
     * - `"disabled"`: prevent the model from calling WebSearch entirely
     *   (passes `WebSearch` via `--disallowedTools`).
     */
    webSearch?: WebSearchRouting;
    /**
     * Detect mid-session opencode MCP config changes and respawn the
     * underlying claude process so newly enabled / disabled MCPs become
     * visible to the model without restarting opencode or starting a new
     * chat. Eviction happens at the start of the next user turn (never mid
     * tool-call) and `--session-id` is preserved so the conversation
     * continues seamlessly. Defaults to `true`.
     *
     * Set to `false` to keep the previous behavior (cached subprocess
     * survives MCP changes until the chat is reset).
     */
    hotReloadMcp?: boolean;
}
type PermissionMode = "acceptEdits" | "auto" | "bypassPermissions" | "default" | "dontAsk" | "plan";
type ControlRequestBehavior = "allow" | "deny";
/**
 * Claude CLI stream-json message types.
 */
interface ClaudeStreamMessage {
    type: string;
    subtype?: string;
    request_id?: string;
    request?: {
        subtype?: string;
        tool_name?: string;
        input?: Record<string, unknown>;
        tool_use_id?: string;
        permission_suggestions?: unknown[];
        blocked_path?: string;
        decision_reason?: string;
        title?: string;
        display_name?: string;
        agent_id?: string;
        description?: string;
    };
    message?: {
        role?: string;
        model?: string;
        content?: Array<{
            type: string;
            text?: string;
            name?: string;
            input?: unknown;
            id?: string;
            tool_use_id?: string;
            content?: string | Array<{
                type: string;
                text?: string;
            }>;
            thinking?: string;
        }>;
    };
    tool?: {
        name?: string;
        id?: string;
        input?: unknown;
    };
    tool_result?: {
        tool_use_id?: string;
        content?: string | Array<{
            type: string;
            text?: string;
        }>;
        is_error?: boolean;
    };
    session_id?: string;
    total_cost_usd?: number;
    duration_ms?: number;
    duration_api_ms?: number;
    id?: string;
    result?: string;
    is_error?: boolean;
    num_turns?: number;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
        iterations?: Array<{
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
        }>;
    };
    content_block?: {
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: string;
        thinking?: string;
    };
    delta?: {
        type: string;
        text?: string;
        partial_json?: string;
        thinking?: string;
    };
    index?: number;
}

declare class ClaudeCodeLanguageModel implements LanguageModelV3 {
    readonly specificationVersion = "v3";
    readonly modelId: string;
    private readonly config;
    constructor(modelId: string, config: ClaudeCodeConfig);
    readonly supportedUrls: Record<string, RegExp[]>;
    get provider(): string;
    private toUsage;
    private toFinishReason;
    private requestScope;
    /**
     * Build the combined `--mcp-config` list and return both the list and the
     * hash of the bridged opencode MCP block (or null when bridging is off /
     * yields nothing). The hash is used to detect mid-session config changes
     * and respawn the underlying claude process.
     *
     * `runtimeStatus` is a snapshot of opencode's `client.mcp.status()`. When
     * provided it overlays opencode's UI-toggled state on top of disk config
     * so `/mcps` toggles propagate without a config file write.
     */
    private effectiveMcpConfig;
    /** Resolve ProxyToolDef[] for the configured proxyTools names. */
    private resolvedProxyTools;
    /**
     * Create a proxy MCP server for a single active Claude process/session.
     * The process lifecycle owns the server lifecycle via session-manager.
     */
    private ensureProxyServer;
    private extractPendingProxyResult;
    /**
     * Opencode sets `x-session-affinity: <sessionID>` on LLM calls for
     * third-party providers (packages/opencode/src/session/llm.ts). Use it so
     * two chats in the same cwd+model get separate CLI processes instead of
     * stomping on each other. Falls back to "default" when absent (older
     * opencode, direct AI-SDK use, title synthesis paths, etc).
     */
    private sessionAffinity;
    private controlRequestBehaviorForTool;
    private writeControlResponse;
    /**
     * Handle Claude stream-json control requests (`can_use_tool`, etc.) and
     * respond via stdin with a matching `control_response`.
     */
    private handleControlRequest;
    private getReasoningEffort;
    private latestUserText;
    private synthesizeTitle;
    private doGenerateViaStream;
    doGenerate(options: LanguageModelV3CallOptions): Promise<Awaited<ReturnType<LanguageModelV3["doGenerate"]>>>;
    doStream(options: LanguageModelV3CallOptions): Promise<Awaited<ReturnType<LanguageModelV3["doStream"]>>>;
}

interface BridgedMcp {
    /** Path to the temp file containing the translated `--mcp-config`. */
    path: string;
    /** Stable hash of the merged opencode mcp block (pre-translation). */
    hash: string;
}
/**
 * Per-server runtime status from opencode's `client.mcp.status()`. Used as
 * an overlay on top of the on-disk merged config so opencode's UI-toggled
 * state — which lives only in-memory; `connect()`/`disconnect()` never
 * touch disk — propagates to the bridged claude subprocess.
 *
 * Treatment per server:
 *   - "connected"      → force `enabled: true` (mirror opencode)
 *   - any other status → force `enabled: false` (don't ship a server
 *     opencode can't run; user fixes it in opencode first)
 *   - missing entry    → leave disk value
 *
 * Omit the overlay and the bridge falls back to disk-only.
 */
type RuntimeMcpStatus = Record<string, string>;
/**
 * Read opencode config layers, deep-merge their `mcp` blocks per opencode's
 * own semantics, optionally apply an opencode runtime-status overlay, then
 * translate each server to Claude CLI format, write a scratch file, and
 * return its path + a stable hash. Returns null when no enabled MCP servers
 * remain after the merge + overlay.
 */
declare function bridgeOpencodeMcp(cwd: string, runtimeStatus?: RuntimeMcpStatus): BridgedMcp | null;

declare const defaultModels: Record<string, OpenCodeModel>;

interface ClaudeCodeProvider {
    specificationVersion: "v3";
    (modelId: string): LanguageModelV3;
    languageModel(modelId: string): LanguageModelV3;
}
declare function createClaudeCode(settings?: ClaudeCodeProviderSettings): ClaudeCodeProvider;
declare const _default: {
    id: string;
    server: OpenCodePlugin;
};

export { type ClaudeCodeConfig, ClaudeCodeLanguageModel, type ClaudeCodeProvider, type ClaudeCodeProviderSettings, type ClaudeStreamMessage, type OpenCodeHooks, type OpenCodeModel, type OpenCodePlugin, bridgeOpencodeMcp, createClaudeCode, _default as default, defaultModels };
