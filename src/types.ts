import type { Plugin as PluginModule } from "@opencode/plugin";

export type PluginContext = Parameters<PluginModule.Plugin["setup"]>[0];

export type RoleMode = "primary" | "subagent" | "all";

export interface PermissionRule {
  action: string;
  resource: string;
  effect: "allow" | "deny" | "ask";
}

export interface RoleSpec {
  /** Agent id, also the markdown file stem. */
  id: string;
  /** Display name. */
  name: string;
  mode: RoleMode;
  /** Shown to the model when it chooses a subagent. */
  description: string;
  /** When the orchestrator should route work to this role. */
  when: string;
  /** Six digit hex color. */
  color: string;
  /** Maximum model steps for the role. */
  steps?: number;
  hidden?: boolean;
  permissions?: PermissionRule[];
  /** Markdown body = agent system prompt. */
  prompt: string;
}

export interface CharsOptions {
  /** Install role agent files on setup. Default true. */
  install?: boolean;
  /** Override the agents directory (absolute, or relative to the location). */
  rolesDir?: string;
  /** Per-role model overrides, e.g. { "chars-reviewer": "anthropic/claude-sonnet-4-5#high" }. */
  models?: Record<string, string>;
  /** Also write the routing skill to `.opencode/skills/chars-roles/SKILL.md`. Default true. */
  writeSkillFile?: boolean;
  /** Block edit tools for read-only roles. Default true. */
  guardReadOnly?: boolean;
}

export interface InstallResult {
  directory: string;
  written: string[];
  updated: string[];
  skipped: string[];
  removed: string[];
}

export const ROLE_IDS = [
  "chars",
  "chars-planner",
  "chars-implementer",
  "chars-reviewer",
  "chars-researcher",
  "chars-debugger",
  "chars-writer",
] as const;

export type RoleID = (typeof ROLE_IDS)[number];

export const ORCHESTRATOR_ID: RoleID = "chars";

export const READ_ONLY_ROLE_IDS: readonly string[] = [
  "chars-planner",
  "chars-reviewer",
  "chars-researcher",
];

export const SHELL_DENIED_ROLE_IDS: readonly string[] = ["chars-researcher"];

export const SHELL_TOOL_NAMES: readonly string[] = ["shell", "bash"];

export const WRITE_TOOL_NAMES: readonly string[] = [
  "edit",
  "write",
  "patch",
  "multiedit",
  "apply_patch",
  "applypatch",
];
