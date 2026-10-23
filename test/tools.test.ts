import { describe, expect, test } from "bun:test";
import { registerTools } from "../src/tools";
import { ROLE_IDS, type PluginContext } from "../src/types";

interface ToolLike {
  name: string;
  description: string;
  input: unknown;
  execute: (input: unknown, context: unknown) => Promise<{ content?: string | readonly unknown[]; metadata?: Record<string, unknown> }>;
}

type SessionMethod = (input?: unknown) => Promise<unknown>;

interface Harness {
  ctx: PluginContext;
  tools: Map<string, ToolLike>;
  calls: Record<string, unknown[]>;
  disposed: () => number;
}

function createHarness(overrides: { session?: Record<string, SessionMethod> } = {}): Harness {
  const tools = new Map<string, ToolLike>();
  const calls: Record<string, unknown[]> = {};
  let disposeCount = 0;

  const defaults: Record<string, SessionMethod> = {
    get: async () => ({ id: "ses_parent", location: { directory: "/repo" } }),
    create: async () => ({ id: "ses_child" }),
    prompt: async () => undefined,
    wait: async () => undefined,
    interrupt: async () => ({ interrupted: true }),
    context: async () => [],
  };

  const session: Record<string, SessionMethod> = {};
  for (const [method, implementation] of Object.entries({ ...defaults, ...overrides.session })) {
    session[method] = async (input?: unknown) => {
      (calls[method] ??= []).push(input);
      return implementation(input);
    };
  }

  const ctx = {
    location: { directory: "/repo" },
    tool: {
      transform: async (callback: (editor: unknown) => void) => {
        const registry = new Map<string, ToolLike>();
        callback({
          list: () => [...registry.values()],
          get: (id: string) => registry.get(id),
          namespace: () => undefined,
          add: (tool: ToolLike) => {
            registry.set(tool.name, tool);
            tools.set(tool.name, tool);
          },
          update: () => undefined,
          remove: () => undefined,
        });
        return {
          dispose: async () => {
            disposeCount += 1;
          },
        };
      },
    },
    session,
  } as unknown as PluginContext;

  return { ctx, tools, calls, disposed: () => disposeCount };
}

function toolContext(signal: AbortSignal = new AbortController().signal) {
  return {
    sessionID: "ses_parent",
    agent: "orchestrator",
    messageID: "msg_parent",
    id: "call_1",
    signal,
    progress: async () => undefined,
  };
}

async function registered(overrides: { session?: Record<string, SessionMethod> } = {}) {
  const harness = createHarness(overrides);
  const registration = await registerTools(harness.ctx);
  return { ...harness, registration };
}

describe("registerTools", () => {
  test("registers both tools and disposes the transform registration", async () => {
    const { tools, disposed, registration } = await registered();

    expect([...tools.keys()]).toEqual(["chars_roles", "chars_delegate"]);
    expect(tools.get("chars_roles")?.description).toBe("List the chars role roster, or recommend the best role for a task.");
    expect(tools.get("chars_delegate")?.description).toBe(
      "Delegate one self-contained task to a chars specialist subagent and return its final answer.",
    );

    await registration.dispose();
    expect(disposed()).toBe(1);
  });
});

describe("chars_roles", () => {
  test("lists every role id with mode and routing guidance", async () => {
    const { tools } = await registered();
    const tool = tools.get("chars_roles")!;
    const result = await tool.execute({}, toolContext());

    expect(result.metadata?.roles).toEqual([...ROLE_IDS]);
    for (const id of ROLE_IDS) expect(result.content).toContain(id);
    expect(result.content).toContain("orchestrator | primary |");
    expect(result.content).toContain("reviewer | subagent |");
    expect(result.content!.split("\n")).toHaveLength(ROLE_IDS.length);
  });

  test("recommends the reviewer for a review task", async () => {
    const { tools } = await registered();
    const result = await tools.get("chars_roles")!.execute({ task: "review the diff" }, toolContext());

    expect(result.metadata?.recommended).toBe("reviewer");
    expect(result.content!.startsWith("Recommended role: reviewer (matched: review)")).toBe(true);
    expect(result.content).toContain("planner | subagent |");
  });

  test("recommends the planner for a planning task", async () => {
    const { tools } = await registered();
    const result = await tools.get("chars_roles")!.execute({ task: "plan the migration" }, toolContext());

    expect(result.metadata?.recommended).toBe("planner");
    expect(result.content!.startsWith("Recommended role: planner (matched: plan)")).toBe(true);
  });

  test("omits the recommendation for an empty task", async () => {
    const { tools } = await registered();
    const result = await tools.get("chars_roles")!.execute({ task: "   " }, toolContext());

    expect(result.metadata?.recommended).toBeNull();
    expect(result.content!.startsWith("orchestrator | primary |")).toBe(true);
  });
});

describe("chars_delegate", () => {
  test("rejects an unknown role with the role name in the message", async () => {
    const { tools, calls } = await registered();
    const attempt = tools.get("chars_delegate")!.execute({ role: "chars-ghost", task: "do it" }, toolContext());

    await expect(attempt).rejects.toThrow("Unknown chars role: chars-ghost. Known roles: orchestrator, planner");
    expect(calls.create).toBeUndefined();
  });

  test("rejects a primary role", async () => {
    const { tools, calls } = await registered();
    const attempt = tools.get("chars_delegate")!.execute({ role: "orchestrator", task: "do it" }, toolContext());

    await expect(attempt).rejects.toThrow("Role orchestrator is a primary role and cannot be delegated.");
    expect(calls.create).toBeUndefined();
  });

  test("creates a child session with the role agent, prompts it, waits, and returns the last assistant text", async () => {
    const { tools, calls } = await registered({
      session: {
        context: async () => [
          { id: "msg_user", type: "user", content: [{ type: "text", text: "parent request" }] },
          { id: "msg_old", type: "assistant", agent: "reviewer", content: [{ type: "text", text: "old answer" }] },
          { id: "msg_idle", type: "idle" },
          {
            id: "msg_new",
            type: "assistant",
            agent: "reviewer",
            content: [
              { type: "reasoning", text: "internal reasoning" },
              { type: "text", text: "Looks good." },
              { type: "text", text: "Ship it." },
            ],
          },
        ],
      },
    });

    const result = await tools
      .get("chars_delegate")!
      .execute({ role: "reviewer", task: "review the diff" }, toolContext());

    expect(calls.get?.[0]).toEqual({ sessionID: "ses_parent" });
    expect(calls.create?.[0]).toEqual({
      parentID: "ses_parent",
      title: "reviewer: review the diff",
      agent: "reviewer",
      location: { directory: "/repo" },
    });
    expect(calls.prompt?.[0]).toEqual({ sessionID: "ses_child", text: "review the diff" });
    expect(calls.wait?.[0]).toEqual({ sessionID: "ses_child" });
    expect(calls.context?.[0]).toEqual({ sessionID: "ses_child" });
    expect(result.content).toBe("Looks good.\n\nShip it.");
    expect(result.metadata).toEqual({ role: "reviewer", sessionID: "ses_child" });
  });

  test("honours a custom title and falls back when no assistant text exists", async () => {
    const { tools, calls } = await registered({
      session: {
        context: async () => [{ id: "msg_idle", type: "idle" }],
      },
    });

    const result = await tools
      .get("chars_delegate")!
      .execute({ role: "planner", task: "plan the migration", title: "Migration plan" }, toolContext());

    expect(calls.create?.[0]).toMatchObject({ title: "Migration plan", agent: "planner" });
    expect(result.content).toBe("(no assistant text returned)");
  });

  test("interrupts the child and throws when the parent signal is aborted", async () => {
    const controller = new AbortController();
    const { tools, calls } = await registered({
      session: {
        wait: async () => {
          controller.abort();
        },
      },
    });

    const attempt = tools
      .get("chars_delegate")!
      .execute({ role: "reviewer", task: "review the diff" }, toolContext(controller.signal));

    await expect(attempt).rejects.toThrow("chars_delegate aborted");
    expect(calls.interrupt?.[0]).toEqual({ sessionID: "ses_child" });
    expect(calls.context).toBeUndefined();
  });
});
