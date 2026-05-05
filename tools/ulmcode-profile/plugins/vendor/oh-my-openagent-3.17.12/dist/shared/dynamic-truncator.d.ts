import type { PluginInput } from "@opencode-ai/plugin";
import { type ContextLimitModelCacheState } from "./context-limit-resolver";
type ContextWindowUsage = {
    usedTokens: number;
    remainingTokens: number;
    usagePercentage: number;
};
export declare function invalidateContextWindowUsageCache(ctx: PluginInput, sessionID?: string): void;
export interface TruncationResult {
    result: string;
    truncated: boolean;
    removedCount?: number;
}
export interface TruncationOptions {
    targetMaxTokens?: number;
    preserveHeaderLines?: number;
    contextWindowLimit?: number;
}
export declare function truncateToTokenLimit(output: string, maxTokens: number, preserveHeaderLines?: number): TruncationResult;
export declare function getContextWindowUsage(ctx: PluginInput, sessionID: string, modelCacheState?: ContextLimitModelCacheState): Promise<ContextWindowUsage | null>;
export declare function dynamicTruncate(ctx: PluginInput, sessionID: string, output: string, options?: TruncationOptions, modelCacheState?: ContextLimitModelCacheState): Promise<TruncationResult>;
export declare function createDynamicTruncator(ctx: PluginInput, modelCacheState?: ContextLimitModelCacheState): {
    truncate: (sessionID: string, output: string, options?: TruncationOptions) => Promise<TruncationResult>;
    getUsage: (sessionID: string) => Promise<ContextWindowUsage | null>;
    truncateSync: (output: string, maxTokens: number, preserveHeaderLines?: number) => TruncationResult;
};
export {};
