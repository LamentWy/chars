import type { CharsOptions, PluginContext, RoleSpec } from "./types";
export interface RegisterHooksOptions {
    roles?: readonly RoleSpec[];
    options?: CharsOptions;
}
export declare function registerHooks(ctx: PluginContext, input?: RegisterHooksOptions): Promise<{
    dispose: () => Promise<void>;
}>;
