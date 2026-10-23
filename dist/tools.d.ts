import type { CharsOptions, PluginContext, RoleSpec } from "./types";
export interface RegisterToolsOptions {
    roles?: readonly RoleSpec[];
    options?: CharsOptions;
}
export declare function registerTools(ctx: PluginContext, input?: RegisterToolsOptions): Promise<{
    dispose: () => Promise<void>;
}>;
