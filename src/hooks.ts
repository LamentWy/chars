import { READ_ONLY_ROLE_IDS, SHELL_DENIED_ROLE_IDS, SHELL_TOOL_NAMES, WRITE_TOOL_NAMES } from "./types";
import type { CharsOptions, PluginContext, RoleSpec } from "./types";

export interface RegisterHooksOptions {
  roles?: readonly RoleSpec[];
  options?: CharsOptions;
}

interface HookRegistration {
  dispose: () => Promise<void>;
}

interface ContextHookEvent {
  agent: string;
  system?: Array<{ type: "text"; text: string }>;
}

interface ToolHookEvent {
  agent: string;
  tool: string;
}

interface HooksContext {
  session: {
    hook: (name: "context", callback: (event: ContextHookEvent) => void) => Promise<HookRegistration>;
  };
  tool: {
    hook: (name: "execute.before", callback: (event: ToolHookEvent) => void) => Promise<HookRegistration>;
  };
}

const POLICY = [
  "## chars orchestration policy",
  "",
  "1. Classify the request before acting: split it into independent units, each with a deliverable, scope, verification, and stop condition.",
  "2. Delegate each independent unit with the subagent tool using the exact agent id: chars-planner, chars-implementer, chars-debugger, chars-reviewer, chars-researcher, or chars-writer.",
  "3. Keep integration and final verification in chars: read the real diff and run the real checks yourself.",
  "4. Never treat a child's completion claim as evidence; require the child's captured command, test, or output.",
].join("\n");

export async function registerHooks(
  ctx: PluginContext,
  input: RegisterHooksOptions = {},
): Promise<{ dispose: () => Promise<void> }> {
  const options = input.options ?? {};
  const context = ctx as unknown as HooksContext;
  const session = await context.session.hook("context", (event) => {
    if (event.agent === "chars" && event.system) {
      event.system.push({ type: "text", text: POLICY });
    }
  });
  const tool = await context.tool.hook("execute.before", (event) => {
    if (options.guardReadOnly === false) return;
    if (READ_ONLY_ROLE_IDS.includes(event.agent) && WRITE_TOOL_NAMES.includes(event.tool)) {
      throw new Error(`Role ${event.agent} is read-only; route edits to chars-implementer.`);
    }
    if (SHELL_DENIED_ROLE_IDS.includes(event.agent) && SHELL_TOOL_NAMES.includes(event.tool)) {
      throw new Error(`Role ${event.agent} may not run shell commands; route execution to chars-implementer.`);
    }
  });
  return {
    dispose: async () => {
      await session.dispose();
      await tool.dispose();
    },
  };
}
