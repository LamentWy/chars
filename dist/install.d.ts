import type { CharsOptions, InstallResult, RoleSpec } from "./types";
export declare function resolveAgentsDir(directory: string, options: CharsOptions): string;
export interface InstallOptions extends CharsOptions {
    roles?: readonly RoleSpec[];
}
export declare function installRoles(directory: string, options?: InstallOptions): Promise<InstallResult>;
export declare function installSkillFile(directory: string): Promise<string | undefined>;
export declare function listInstalledRoleFiles(directory: string, options?: CharsOptions): Promise<string[]>;
