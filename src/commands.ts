import { ROLES, renderRoleTable } from "./roles";
import type { PluginContext, RoleSpec } from "./types";

export interface RegisterCommandsOptions {
  roles?: readonly RoleSpec[];
}

interface CommandEditor {
  add(definition: {
    name: string;
    description?: string;
    execute: (input: {
      sessionID: string;
      prompt: { text: string };
      delivery: "steer" | "queue";
    }) => Promise<void>;
  }): void;
}

interface CommandsContext {
  command: {
    transform: (callback: (editor: CommandEditor) => void) => Promise<{ dispose: () => Promise<void> }>;
  };
  session: {
    switchAgent: (input: { sessionID: string; agent: string }) => Promise<void>;
    prompt: (input: { sessionID: string; text: string; delivery: "steer" | "queue" }) => Promise<unknown>;
    synthetic: (input: {
      sessionID: string;
      text: string;
      description?: string;
      resume?: boolean;
    }) => Promise<unknown>;
  };
}

function renderRoster(roles: readonly RoleSpec[]): string {
  if (roles === ROLES) return renderRoleTable();
  return roles.map((role) => `- \`${role.id}\` - ${role.description}`).join("\n");
}

export async function registerCommands(
  ctx: PluginContext,
  input: RegisterCommandsOptions = {},
): Promise<{ dispose: () => Promise<void> }> {
  const roles = input.roles ?? ROLES;
  const context = ctx as unknown as CommandsContext;
  const registration = await context.command.transform((editor) => {
    editor.add({
      name: "chars",
      description: "Start or steer a chars orchestration task",
      async execute({ sessionID, prompt, delivery }) {
        await context.session.switchAgent({ sessionID, agent: "chars" });
        const text = prompt.text.trim();
        if (text) {
          await context.session.prompt({ sessionID, text, delivery });
        } else {
          await context.session.synthetic({
            sessionID,
            text: "chars orchestrator active. Ask for a task, or run /chars-roles to see the team.",
            resume: false,
          });
        }
      },
    });
    editor.add({
      name: "chars-roles",
      description: "Show the chars role roster",
      async execute({ sessionID }) {
        const table = renderRoster(roles);
        await context.session.synthetic({
          sessionID,
          text: "## chars roles\n\n" + table + "\n\nDelegate with the subagent tool using one of these agent ids.",
          description: "chars roles",
          resume: true,
        });
      },
    });
  });
  return { dispose: () => registration.dispose() };
}
