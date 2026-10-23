import type { PluginContext, RoleSpec } from "./types";
export interface RegisterCommandsOptions {
    roles?: readonly RoleSpec[];
}
export declare function registerCommands(ctx: PluginContext, input?: RegisterCommandsOptions): Promise<{
    dispose: () => Promise<void>;
}>;
