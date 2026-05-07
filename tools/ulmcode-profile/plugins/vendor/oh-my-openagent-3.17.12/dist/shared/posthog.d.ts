import { PostHog } from "posthog-node";
import { getPostHogActivityCaptureState } from "./posthog-activity-state";
/** @internal test-only */
export declare function __setActivityStateProviderForTesting(provider: typeof getPostHogActivityCaptureState): void;
/** @internal test-only */
export declare function __resetActivityStateProviderForTesting(): void;
type PostHogCaptureEvent = Parameters<PostHog["capture"]>[0];
type PostHogExceptionProperties = Parameters<PostHog["captureException"]>[2];
type PostHogActivityReason = "run_started" | "plugin_loaded";
type PostHogClient = {
    capture: (message: PostHogCaptureEvent) => void;
    captureException: (error: unknown, distinctId?: string, additionalProperties?: PostHogExceptionProperties) => void;
    trackActive: (distinctId: string, reason: PostHogActivityReason) => void;
    shutdown: () => Promise<void>;
};
export declare function getPostHogDistinctId(): string;
export declare function createCliPostHog(): PostHogClient;
export declare function createPluginPostHog(): PostHogClient;
export {};
