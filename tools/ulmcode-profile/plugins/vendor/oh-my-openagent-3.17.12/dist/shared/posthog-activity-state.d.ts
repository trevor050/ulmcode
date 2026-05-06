type PostHogActivityCaptureState = {
    dayUTC: string;
    captureDaily: boolean;
};
type PluginLoadedCaptureState = {
    dayUTC: string;
    capturePluginLoaded: boolean;
};
export declare function getPostHogActivityCaptureState(now?: Date): PostHogActivityCaptureState;
export declare function getPluginLoadedCaptureState(now?: Date): PluginLoadedCaptureState;
export {};
