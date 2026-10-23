import { getRole, ROLES, routeTask } from "./roles";
import type { CharsOptions, PluginContext, RoleSpec } from "./types";

export interface RegisterToolsOptions {
  roles?: readonly RoleSpec[];
  options?: CharsOptions;
}

type ToolEditor = Parameters<Parameters<PluginContext["tool"]["transform"]>[0]>[0];
type ToolDef = Parameters<ToolEditor["add"]>[0];
type ToolContext = Parameters<ToolDef["execute"]>[1];

const ROLES_INPUT = {
  type: "object",
  properties: {
    task: { type: "string" },
  },
  additionalProperties: false,
} as const;

const DELEGATE_INPUT = {
  type: "object",
  properties: {
    role: { type: "string" },
    task: { type: "string" },
    title: { type: "string" },
  },
  required: ["role", "task"],
  additionalProperties: false,
} as const;

function renderRoster(roles: readonly RoleSpec[]): string {
  return roles.map((role) => `${role.id} | ${role.mode} | ${role.when}`).join("\n");
}

function createRolesTool(roles: readonly RoleSpec[]): ToolDef {
  return {
    name: "chars_roles",
    input: ROLES_INPUT,
    description: "List the chars role roster, or recommend the best role for a task.",
    async execute(raw) {
      const input = (raw ?? {}) as { task?: unknown };
      const task = typeof input.task === "string" ? input.task.trim() : "";
      const recommended = task ? routeTask(task) : undefined;
      const header = recommended
        ? `Recommended role: ${recommended.role} (matched: ${recommended.matched.join(", ")})\n\n`
        : "";
      return {
        content: `${header}${renderRoster(roles)}`,
        metadata: {
          recommended: recommended?.role ?? null,
          roles: roles.map((role) => role.id),
        },
      };
    },
  };
}

function createDelegateTool(ctx: PluginContext, roles: readonly RoleSpec[]): ToolDef {
  return {
    name: "chars_delegate",
    input: DELEGATE_INPUT,
    description: "Delegate one self-contained task to a chars specialist subagent and return its final answer.",
    async execute(raw, context: ToolContext) {
      const input = (raw ?? {}) as { role?: unknown; task?: unknown; title?: unknown };
      const roleId = typeof input.role === "string" ? input.role : "";
      const task = typeof input.task === "string" ? input.task : "";
      const role = roles.find((candidate) => candidate.id === roleId) ?? getRole(roleId);

      if (!role) {
        throw new Error(
          `Unknown chars role: ${roleId}. Known roles: ${roles.map((candidate) => candidate.id).join(", ")}`,
        );
      }

      if (role.mode === "primary") {
        throw new Error(`Role ${role.id} is a primary role and cannot be delegated.`);
      }

      const parent = await ctx.session.get({ sessionID: context.sessionID });
      const title =
        typeof input.title === "string" && input.title.trim().length > 0
          ? input.title
          : `${role.id}: ${task.slice(0, 60)}`;
      const child = await ctx.session.create({
        parentID: context.sessionID,
        title,
        agent: role.id,
        location: parent.location ? { directory: parent.location.directory } : undefined,
      });

      await ctx.session.prompt({ sessionID: child.id, text: task });
      await ctx.session.wait({ sessionID: child.id });

      if (context.signal.aborted) {
        await ctx.session.interrupt({ sessionID: child.id });
        throw new Error("chars_delegate aborted");
      }

      const messages = await ctx.session.context({ sessionID: child.id });
      const assistant = [...messages].reverse().find((message) => message.type === "assistant");
      const text = assistant
        ? assistant.content
            .filter((entry) => entry.type === "text")
            .map((entry) => entry.text)
            .join("\n\n")
        : "";

      return {
        content: text || "(no assistant text returned)",
        metadata: { role: role.id, sessionID: child.id },
      };
    },
  };
}

export async function registerTools(
  ctx: PluginContext,
  input: RegisterToolsOptions = {},
): Promise<{ dispose: () => Promise<void> }> {
  const roles = input.roles ?? ROLES;
  const registration = await ctx.tool.transform((editor) => {
    editor.add(createRolesTool(roles));
    editor.add(createDelegateTool(ctx, roles));
  });
  return { dispose: () => registration.dispose() };
}
