import type { PluginInput } from "@opencode-ai/plugin";
import type { RalphLoopOptions, RalphLoopState } from "./types";
type LoopStateController = {
    getState: () => RalphLoopState | null;
    clear: () => boolean;
    incrementIteration: () => RalphLoopState | null;
    setSessionID: (sessionID: string) => RalphLoopState | null;
    markVerificationPending: (sessionID: string) => RalphLoopState | null;
    setVerificationSessionID: (sessionID: string, verificationSessionID: string) => RalphLoopState | null;
    restartAfterFailedVerification: (sessionID: string, messageCountAtStart?: number) => RalphLoopState | null;
};
type RalphLoopEventHandlerOptions = {
    directory: string;
    apiTimeoutMs: number;
    getTranscriptPath: (sessionID: string) => string | undefined;
    checkSessionExists?: RalphLoopOptions["checkSessionExists"];
    backgroundManager?: RalphLoopOptions["backgroundManager"];
    loopState: LoopStateController;
};
export declare function createRalphLoopEventHandler(ctx: PluginInput, options: RalphLoopEventHandlerOptions): ({ event }: {
    event: {
        type: string;
        properties?: unknown;
    };
}) => Promise<void>;
export {};
