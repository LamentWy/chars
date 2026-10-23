import { type CharsOptions, type RoleID, type RoleSpec } from "./types";
export declare const ROLES: readonly RoleSpec[];
export declare const ROLE_BY_ID: ReadonlyMap<string, RoleSpec>;
export declare function getRole(id: string): RoleSpec | undefined;
export declare function isRoleId(value: string): value is RoleID;
export declare function resolveModel(role: RoleSpec, options: CharsOptions): string | undefined;
export declare function renderAgentMarkdown(role: RoleSpec, model?: string): string;
export declare function renderRoleTable(): string;
export declare function renderSkillContent(): string;
export interface RouteResult {
    role: RoleID;
    matched: string[];
    score: number;
}
export declare function routeTask(task: string): RouteResult;
