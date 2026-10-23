import { describe, expect, test } from "bun:test";
import { registerCommands } from "../src/commands";
import { ROLES } from "../src/roles";
import type { PluginContext } from "../src/types";

interface Delivered {
  sessionID: string;
  delivery: "steer" | "queue";
}

interface Captured {
  name: string;
  description?: string;
  execute: (input: Delivered & { prompt: { text: string } }) => Promise<void>;
}

function makeContext() {
  const definitions = new Map<string, Captured>();
  const switchAgent: Array<{ sessionID: string; agent: string }> = [];
  const prompt: Array<{ sessionID: string; text: string; delivery: "steer" | "queue" }> = [];
  const synthetic: Array<{ sessionID: string; text: string; description?: string; resume?: boolean }> = [];
  let disposeCount = 0;

  const ctx = {
    command: {
      transform: async (callback: (editor: { add: (definition: Captured) => void }) => void) => {
        callback({
          add: (definition) => {
            definitions.set(definition.name, definition);
          },
        });
        return {
          dispose: async () => {
            disposeCount += 1;
          },
        };
      },
    },
    session: {
      switchAgent: async (input: { sessionID: string; agent: string }) => {
        switchAgent.push(input);
      },
      prompt: async (input: { sessionID: string; text: string; delivery: "steer" | "queue" }) => {
        prompt.push(input);
      },
      synthetic: async (input: { sessionID: string; text: string; description?: string; resume?: boolean }) => {
        synthetic.push(input);
      },
    },
  } as unknown as PluginContext;

  return { ctx, definitions, switchAgent, prompt, synthetic, disposed: () => disposeCount };
}

function command(definitions: Map<string, Captured>, name: string): Captured {
  const definition = definitions.get(name);
  if (!definition) throw new Error(`missing command ${name}`);
  return definition;
}

describe("registerCommands", () => {
  test("registers both slash commands", async () => {
    const { ctx, definitions } = makeContext();
    await registerCommands(ctx);

    expect([...definitions.keys()]).toEqual(["chars", "chars-roles"]);
    expect(command(definitions, "chars").description).toBe("Start or steer a chars orchestration task");
    expect(command(definitions, "chars-roles").description).toBe("Show the chars role roster");
  });

  test("switches to chars and shows guidance for an empty prompt", async () => {
    const { ctx, definitions, switchAgent, prompt, synthetic } = makeContext();
    await registerCommands(ctx);

    await command(definitions, "chars").execute({
      sessionID: "ses_1",
      prompt: { text: "   " },
      delivery: "steer",
    });

    expect(switchAgent).toEqual([{ sessionID: "ses_1", agent: "chars" }]);
    expect(prompt).toHaveLength(0);
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]).toMatchObject({ sessionID: "ses_1", resume: false });
    expect(synthetic[0]?.text).toContain("chars orchestrator active");
  });

  test("forwards a non-empty prompt to the session", async () => {
    const { ctx, definitions, switchAgent, prompt, synthetic } = makeContext();
    await registerCommands(ctx);

    await command(definitions, "chars").execute({
      sessionID: "ses_1",
      prompt: { text: "  build the parser  " },
      delivery: "queue",
    });

    expect(switchAgent).toEqual([{ sessionID: "ses_1", agent: "chars" }]);
    expect(prompt).toEqual([{ sessionID: "ses_1", text: "build the parser", delivery: "queue" }]);
    expect(synthetic).toHaveLength(0);
  });

  test("chars-roles lists every role id", async () => {
    const { ctx, definitions, synthetic } = makeContext();
    await registerCommands(ctx);

    await command(definitions, "chars-roles").execute({
      sessionID: "ses_1",
      prompt: { text: "" },
      delivery: "steer",
    });

    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]).toMatchObject({ description: "chars roles", resume: true });
    const text = synthetic[0]?.text ?? "";
    expect(text).toContain("## chars roles");
    for (const role of ROLES) {
      expect(text).toContain(role.id);
    }
  });

  test("dispose disposes the command registration", async () => {
    const { ctx, disposed } = makeContext();
    const registration = await registerCommands(ctx);

    await registration.dispose();

    expect(disposed()).toBe(1);
  });
});
