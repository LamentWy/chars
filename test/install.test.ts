import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installRoles, installSkillFile, listInstalledRoleFiles } from "../src/install";
import { ROLES } from "../src/roles";

async function withTemp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "chars-install-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("installRoles", () => {
  test("writes every role once and is idempotent", () =>
    withTemp(async (dir) => {
      const first = await installRoles(dir);
      expect(first.written).toHaveLength(ROLES.length);
      expect(await listInstalledRoleFiles(dir)).toHaveLength(ROLES.length);

      const second = await installRoles(dir);
      expect(second.written).toHaveLength(0);
      expect(second.updated).toHaveLength(0);
      expect(second.skipped).toHaveLength(0);
    }));

  test("updates plugin-owned files when the role definition changes", () =>
    withTemp(async (dir) => {
      await installRoles(dir);
      const reviewer = ROLES.find((role) => role.id === "reviewer")!;
      const changed = { ...reviewer, prompt: reviewer.prompt + "\n\nExtra line." };
      const result = await installRoles(dir, { roles: ROLES.map((role) => (role.id === changed.id ? changed : role)) });
      expect(result.updated).toHaveLength(1);
      expect(await readFile(join(dir, ".opencode", "agents", "reviewer.md"), "utf8")).toContain("Extra line.");
    }));

  test("never overwrites a user-modified role file", () =>
    withTemp(async (dir) => {
      await installRoles(dir);
      const target = join(dir, ".opencode", "agents", "writer.md");
      await writeFile(target, "---\nmode: subagent\n---\nmy custom writer\n", "utf8");
      const result = await installRoles(dir);
      expect(result.skipped).toContain(target);
      expect(await readFile(target, "utf8")).toContain("my custom writer");
    }));

  test("removes legacy plugin-owned role files that are no longer in the catalog", () =>
    withTemp(async (dir) => {
      await installRoles(dir);
      const legacy = join(dir, ".opencode", "agents", "chars-planner.md");
      const legacyContent = "---\nmode: subagent\n---\nlegacy role\n";
      await writeFile(legacy, legacyContent, "utf8");
      const manifestPath = join(dir, ".opencode", "agents", ".chars-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.files["chars-planner.md"] = createHash("sha256").update(legacyContent).digest("hex");
      await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

      const result = await installRoles(dir);

      expect(result.removed).toContain(legacy);
      expect(await listInstalledRoleFiles(dir)).toHaveLength(ROLES.length);
    }));

  test("honours a custom roles directory", () =>
    withTemp(async (dir) => {
      const result = await installRoles(dir, { rolesDir: "custom/agents" });
      expect(result.directory).toBe(join(dir, "custom", "agents"));
      expect(await listInstalledRoleFiles(dir, { rolesDir: "custom/agents" })).toHaveLength(ROLES.length);
    }));
});

describe("installSkillFile", () => {
  test("writes the routing skill once", () =>
    withTemp(async (dir) => {
      const first = await installSkillFile(dir);
      expect(first).toBe(join(dir, ".opencode", "skills", "chars-roles", "SKILL.md"));
      const second = await installSkillFile(dir);
      expect(second).toBeUndefined();
      expect(await readFile(first!, "utf8")).toContain("planner");
    }));
});
