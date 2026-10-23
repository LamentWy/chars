import { describe, expect, test } from "bun:test";
import { ROLES, getRole, isRoleId, renderAgentMarkdown, renderRoleTable, renderSkillContent, routeTask } from "../src/roles";
import { ORCHESTRATOR_ID, READ_ONLY_ROLE_IDS, ROLE_IDS } from "../src/types";

describe("role catalog", () => {
  test("contains the orchestrator and six specialists", () => {
    expect(ROLES).toHaveLength(7);
    expect(ROLES.map((role) => role.id)).toEqual([...ROLE_IDS]);
    expect(getRole(ORCHESTRATOR_ID)?.mode).toBe("primary");
    expect(ROLE_IDS.filter((id) => id !== ORCHESTRATOR_ID).every((id) => getRole(id)?.mode === "subagent")).toBe(true);
  });

  test("read-only roles deny edit", () => {
    for (const id of READ_ONLY_ROLE_IDS) {
      expect(isRoleId(id)).toBe(true);
      expect(getRole(id)?.permissions?.some((rule) => rule.action === "edit" && rule.effect === "deny")).toBe(true);
    }
  });

  test("renders valid agent frontmatter", () => {
    const markdown = renderAgentMarkdown(getRole("chars-reviewer")!, "anthropic/claude-sonnet-4-5#high");
    expect(markdown.startsWith("---\n")).toBe(true);
    expect(markdown).toContain('description: "Independent reviewer.');
    expect(markdown).toContain("mode: subagent");
    expect(markdown).toContain("model: anthropic/claude-sonnet-4-5#high");
    expect(markdown).toContain('  - action: "edit"');
    expect(markdown.trimEnd().endsWith("supported by evidence.")).toBe(true);
  });

  test("skill content names every role and the protocol", () => {
    const content = renderSkillContent();
    for (const id of ROLE_IDS) expect(content).toContain(id);
    expect(content).toContain("subagent");
    expect(content).toContain("read-only");
  });

  test("role table has one row per role", () => {
    const rows = renderRoleTable().split("\n").filter((line) => line.startsWith("| `"));
    expect(rows).toHaveLength(ROLES.length);
  });
});

describe("routeTask", () => {
  test("routes review work to the reviewer", () => {
    expect(routeTask("review the diff").role).toBe("chars-reviewer");
    expect(routeTask("请审查这次改动").role).toBe("chars-reviewer");
  });

  test("routes planning work to the planner", () => {
    expect(routeTask("plan the migration").role).toBe("chars-planner");
    expect(routeTask("设计一下模块边界").role).toBe("chars-planner");
  });

  test("routes failures to the debugger", () => {
    expect(routeTask("the build fails with an error").role).toBe("chars-debugger");
  });

  test("falls back to the orchestrator", () => {
    expect(routeTask("hello there").role).toBe(ORCHESTRATOR_ID);
  });
});
