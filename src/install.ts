import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ROLES, renderAgentMarkdown, renderSkillContent, resolveModel } from "./roles";
import type { CharsOptions, InstallResult, RoleSpec } from "./types";

const MANIFEST_FILE = ".chars-manifest.json";
const SKILL_RELATIVE_PATH = join(".opencode", "skills", "chars-roles", "SKILL.md");

interface Manifest {
  version: 1;
  plugin: "chars";
  files: Record<string, string>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function resolveAgentsDir(directory: string, options: CharsOptions): string {
  if (!options.rolesDir) return join(directory, ".opencode", "agents");
  return isAbsolute(options.rolesDir) ? options.rolesDir : resolve(directory, options.rolesDir);
}

async function readManifest(manifestPath: string): Promise<Manifest> {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<Manifest>;
    if (parsed.plugin === "chars" && parsed.files && typeof parsed.files === "object") {
      return { version: 1, plugin: "chars", files: parsed.files };
    }
  } catch {
    return { version: 1, plugin: "chars", files: {} };
  }
  return { version: 1, plugin: "chars", files: {} };
}

async function fileHash(path: string): Promise<string | undefined> {
  try {
    return sha256(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

export interface InstallOptions extends CharsOptions {
  roles?: readonly RoleSpec[];
}

export async function installRoles(directory: string, options: InstallOptions = {}): Promise<InstallResult> {
  const agentsDir = resolveAgentsDir(directory, options);
  const roles = options.roles ?? ROLES;
  const result: InstallResult = { directory: agentsDir, written: [], updated: [], skipped: [], removed: [] };

  await mkdir(agentsDir, { recursive: true });
  const manifestPath = join(agentsDir, MANIFEST_FILE);
  const manifest = await readManifest(manifestPath);
  const nextFiles: Record<string, string> = {};

  for (const role of roles) {
    const fileName = `${role.id}.md`;
    const target = join(agentsDir, fileName);
    const content = renderAgentMarkdown(role, resolveModel(role, options));
    const hash = sha256(content);
    const existing = await fileHash(target);

    if (existing === undefined) {
      await writeFile(target, content, "utf8");
      result.written.push(target);
    } else if (existing === hash) {
      nextFiles[fileName] = hash;
      continue;
    } else if (manifest.files[fileName] === existing) {
      await writeFile(target, content, "utf8");
      result.updated.push(target);
    } else {
      nextFiles[fileName] = existing;
      result.skipped.push(target);
      continue;
    }
    nextFiles[fileName] = hash;
  }

  const roleFiles = new Set(roles.map((role) => `${role.id}.md`));
  for (const [fileName, hash] of Object.entries(manifest.files)) {
    if (roleFiles.has(fileName)) continue;
    const target = join(agentsDir, fileName);
    if ((await fileHash(target)) === hash) {
      await unlink(target);
      result.removed.push(target);
    }
  }

  const manifestChanged = JSON.stringify(manifest.files) !== JSON.stringify(nextFiles);
  if (manifestChanged || !(await fileHash(manifestPath))) {
    await writeFile(manifestPath, `${JSON.stringify({ version: 1, plugin: "chars", files: nextFiles }, null, 2)}\n`, "utf8");
  }

  return result;
}

export async function installSkillFile(directory: string): Promise<string | undefined> {
  const target = join(directory, SKILL_RELATIVE_PATH);
  const content = renderSkillContent();
  if ((await fileHash(target)) === sha256(content)) return undefined;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return target;
}

export async function listInstalledRoleFiles(directory: string, options: CharsOptions = {}): Promise<string[]> {
  const roleFileNames = new Set(ROLES.map((role) => `${role.id}.md`));
  try {
    const entries = await readdir(resolveAgentsDir(directory, options));
    return entries.filter((entry) => roleFileNames.has(entry)).sort();
  } catch {
    return [];
  }
}
