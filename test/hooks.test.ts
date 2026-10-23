import { describe, expect, test } from "bun:test";
import { registerHooks } from "../src/hooks";
import type { CharsOptions, PluginContext } from "../src/types";

interface ContextEvent {
  agent: string;
  system: Array<{ type: "text"; text: string }>;
}

interface ToolEvent {
  agent: string;
  tool: string;
}

type ContextCallback = (event: ContextEvent) => void | Promise<void>;
type ToolCallback = (event: ToolEvent) => void | Promise<void>;

function makeContext() {
  let contextCallback: ContextCallback | undefined;
  let toolCallback: ToolCallback | undefined;
  const disposed: string[] = [];

  const ctx = {
    session: {
      hook: async (name: "context", callback: ContextCallback) => {
        if (name !== "context") throw new Error(`unexpected session hook ${name}`);
        contextCallback = callback;
        return { dispose: async () => { disposed.push("session"); } };
      },
    },
    tool: {
      hook: async (name: "execute.before", callback: ToolCallback) => {
        if (name !== "execute.before") throw new Error(`unexpected tool hook ${name}`);
        toolCallback = callback;
        return { dispose: async () => { disposed.push("tool"); } };
      },
    },
  } as unknown as PluginContext;

  return {
    ctx,
    context: () => {
      if (!contextCallback) throw new Error("context hook not registered");
      return contextCallback;
    },
    tool: () => {
      if (!toolCallback) throw new Error("tool hook not registered");
      return toolCallback;
    },
    disposed,
  };
}

describe("registerHooks", () => {
  test("appends the orchestration policy for the chars agent", async () => {
    const { ctx, context } = makeContext();
    await registerHooks(ctx);
    const system: Array<{ type: "text"; text: string }> = [];

    await context()({ agent: "chars", system });

    expect(system).toHaveLength(1);
    expect(system[0]?.type).toBe("text");
    expect(system[0]?.text).toContain("Classify the request before acting");
    expect(system[0]?.text).toContain("chars-planner");
    expect(system[0]?.text).toContain("Never treat a child's completion claim as evidence");
  });

  test("leaves other agents untouched", async () => {
    const { ctx, context } = makeContext();
    await registerHooks(ctx);
    const system: Array<{ type: "text"; text: string }> = [];

    await context()({ agent: "build", system });

    expect(system).toHaveLength(0);
  });

  test("blocks write tools for read-only roles", async () => {
    const { ctx, tool } = makeContext();
    await registerHooks(ctx);

    expect(() => tool()({ agent: "chars-reviewer", tool: "edit" })).toThrow(
      "Role chars-reviewer is read-only; route edits to chars-implementer.",
    );
  });

  test("blocks shell for the researcher role", async () => {
    const { ctx, tool } = makeContext();
    await registerHooks(ctx);

    expect(() => tool()({ agent: "chars-researcher", tool: "shell" })).toThrow(
      "Role chars-researcher may not run shell commands",
    );
    expect(() => tool()({ agent: "chars-reviewer", tool: "shell" })).not.toThrow();
  });

  test("allows write tools for implementer and debugger", async () => {
    const { ctx, tool } = makeContext();
    await registerHooks(ctx);

    expect(() => tool()({ agent: "chars-implementer", tool: "edit" })).not.toThrow();
    expect(() => tool()({ agent: "chars-debugger", tool: "edit" })).not.toThrow();
  });

  test("returns early when guardReadOnly is false", async () => {
    const { ctx, tool } = makeContext();
    const options: CharsOptions = { guardReadOnly: false };
    await registerHooks(ctx, { options });

    expect(() => tool()({ agent: "chars-reviewer", tool: "edit" })).not.toThrow();
  });

  test("dispose disposes both registrations", async () => {
    const { ctx, disposed } = makeContext();
    const registration = await registerHooks(ctx);

    await registration.dispose();

    expect(disposed).toEqual(["session", "tool"]);
  });
});
