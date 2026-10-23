import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface ApiResponse {
  status: number;
  text: string;
  body: unknown;
}

interface ServerHandle {
  child: ChildProcess;
  url: string;
  password: string;
  logs: () => string;
}

interface AgentSnapshot {
  files: string[];
  hashes: Record<string, string>;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OPENCODE_BIN = process.env.OPENCODE_BIN ?? "/usr/local/bin/opencode";
const HOST = "127.0.0.1";
const PORT_MIN = 43000;
const PORT_MAX = 43999;
const SERVER_PASSWORD = /server password (\S+)/;
const ROLE_IDS = [
  "chars",
  "chars-planner",
  "chars-implementer",
  "chars-reviewer",
  "chars-researcher",
  "chars-debugger",
  "chars-writer",
] as const;
const AGENT_EXPECTATIONS = [
  { id: "chars", mode: "primary" },
  { id: "chars-planner", mode: "subagent" },
  { id: "chars-implementer", mode: "subagent" },
  { id: "chars-reviewer", mode: "subagent" },
  { id: "chars-researcher", mode: "subagent" },
  { id: "chars-debugger", mode: "subagent" },
  { id: "chars-writer", mode: "subagent" },
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function snippet(text: string, max = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}...`;
}

function tailLines(log: string, count: number): string {
  const lines = log.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.slice(-count).join("\n");
}

function pass(name: string, detail: string): Check {
  return { name, ok: true, detail };
}

function fail(name: string, detail: string): Check {
  return { name, ok: false, detail };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function dataOf(response: ApiResponse): unknown {
  return asRecord(response.body)?.data;
}

function authHeader(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
}

function pickPort(exclude?: number): number {
  const span = PORT_MAX - PORT_MIN + 1;
  for (;;) {
    const port = PORT_MIN + Math.floor(Math.random() * span);
    if (port !== exclude) return port;
  }
}

function nextPort(port: number): number {
  return port >= PORT_MAX ? PORT_MIN : port + 1;
}

async function apiRequest(
  server: ServerHandle,
  auth: string,
  pathname: string,
  init: { method?: string; body?: string } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { authorization: auth };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${server.url}${pathname}`, {
    method: init.method ?? "GET",
    body: init.body,
    headers,
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: response.status, text, body };
}

function launchServer(project: string, home: string, port: number) {
  let logs = "";
  let spawnError: Error | undefined;
  const child = spawn(OPENCODE_BIN, ["serve", "--hostname", HOST, "--port", String(port)], {
    cwd: project,
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const append = (chunk: Buffer | string) => {
    logs = (logs + chunk.toString()).slice(-200000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("error", (error) => {
    spawnError = error;
  });
  return {
    child,
    logs: () => logs,
    spawnError: () => spawnError,
  };
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    return Promise.resolve(true);
  }
  return new Promise((resolveWait) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolveWait(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, 5000)) return;
  console.error("opencode server did not exit after SIGTERM; sending SIGKILL");
  child.kill("SIGKILL");
  if (!(await waitForExit(child, 5000))) {
    throw new Error("opencode server process did not exit after SIGKILL");
  }
}

async function startServer(project: string, home: string, initialPort: number): Promise<ServerHandle> {
  let port = initialPort;
  let detail = "";
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    const launch = launchServer(project, home, port);
    let exitedEarly = false;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const spawnError = launch.spawnError();
      if (spawnError) {
        detail = `failed to spawn ${OPENCODE_BIN}: ${spawnError.message}`;
        break;
      }
      const match = launch.logs().match(SERVER_PASSWORD);
      if (match?.[1]) {
        return { child: launch.child, url: `http://${HOST}:${port}`, password: match[1], logs: launch.logs };
      }
      if (launch.child.exitCode !== null || launch.child.signalCode !== null) {
        exitedEarly = true;
        detail = `opencode serve exited on port ${port} (code ${String(launch.child.exitCode)}, signal ${String(launch.child.signalCode)})\n${tailLines(launch.logs(), 40)}`;
        break;
      }
      await sleep(100);
    }
    if (!exitedEarly && !launch.spawnError()) {
      detail = `opencode serve did not print a password within 20s on port ${port}\n${tailLines(launch.logs(), 40)}`;
    }
    try {
      await stopChild(launch.child);
    } catch (stopError) {
      detail = `${detail}\ncleanup failed: ${errorMessage(stopError)}`;
    }
    if (exitedEarly && attempt === 0) {
      const failedPort = port;
      port = nextPort(port);
      console.error(`opencode serve exited early on port ${failedPort}; retrying on port ${port}`);
      continue;
    }
    throw new Error(detail || "failed to start opencode serve");
  }
  throw new Error(detail || "failed to start opencode serve");
}

async function waitForCommands(server: ServerHandle, auth: string): Promise<ApiResponse> {
  const deadline = Date.now() + 60000;
  let last = "";
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      console.error("opencode server exited before commands registered. Last 40 log lines:");
      console.error(tailLines(server.logs(), 40));
      throw new Error(
        `opencode server exited before /api/command listed chars-roles (code ${String(server.child.exitCode)}, signal ${String(server.child.signalCode)})`,
      );
    }
    try {
      const response = await apiRequest(server, auth, "/api/command");
      last = `HTTP ${response.status}: ${snippet(response.text, 300)}`;
      if (response.status === 200 && response.text.includes("chars-roles")) return response;
    } catch (error) {
      last = errorMessage(error);
    }
    await sleep(500);
  }
  console.error("GET /api/command did not list chars-roles within 60s. Last 40 log lines:");
  console.error(tailLines(server.logs(), 40));
  throw new Error(`GET /api/command did not list chars-roles within 60s (last response: ${last})`);
}

async function checkAgents(server: ServerHandle, auth: string): Promise<Check[]> {
  const deadline = Date.now() + 30000;
  return Promise.all(
    AGENT_EXPECTATIONS.map(async (expected) => {
      const name = `A agent ${expected.id}`;
      let last = "";
      while (Date.now() < deadline) {
        try {
          const response = await apiRequest(server, auth, `/api/agent/${encodeURIComponent(expected.id)}`);
          last = `HTTP ${response.status}: ${snippet(response.text)}`;
          if (response.status === 200) {
            const data = asRecord(dataOf(response));
            if (!data) return fail(name, "response data missing");
            if (data.id !== expected.id) return fail(name, `id=${String(data.id)} expected ${expected.id}`);
            if (data.mode !== expected.mode) return fail(name, `mode=${String(data.mode)} expected ${expected.mode}`);
            return pass(name, `HTTP 200 mode=${expected.mode}`);
          }
        } catch (error) {
          last = errorMessage(error);
        }
        await sleep(500);
      }
      return fail(name, `agent did not register within 30s (${last})`);
    }),
  );
}

async function checkCommands(server: ServerHandle, auth: string): Promise<Check> {
  const name = "B commands";
  try {
    const response = await apiRequest(server, auth, "/api/command");
    if (response.status !== 200) return fail(name, `HTTP ${response.status}: ${snippet(response.text)}`);
    const names = asArray(dataOf(response))
      .map((item) => asRecord(item)?.name)
      .filter((value): value is string => typeof value === "string");
    const missing = ["chars", "chars-roles"].filter((required) => !names.includes(required));
    if (missing.length > 0) {
      return fail(name, `missing ${missing.join(", ")}; registered [${names.join(", ")}]`);
    }
    return pass(name, `HTTP 200 registered [${names.join(", ")}]`);
  } catch (error) {
    return fail(name, errorMessage(error));
  }
}

async function checkSkill(server: ServerHandle, auth: string): Promise<Check> {
  const name = "C skill chars-roles";
  try {
    const response = await apiRequest(server, auth, "/api/skill");
    if (response.status !== 200) return fail(name, `HTTP ${response.status}: ${snippet(response.text)}`);
    const skills = asArray(dataOf(response))
      .map((item) => asRecord(item))
      .filter((value): value is Record<string, unknown> => value !== undefined);
    const matches = skills.filter((entry) => entry.id === "chars-roles");
    if (matches.length === 0) {
      const ids = skills.map((entry) => String(entry.id)).join(", ");
      return fail(name, `missing id chars-roles; registered [${ids}]`);
    }
    const skill = matches.find((entry) => {
      const content = typeof entry.content === "string" ? entry.content : "";
      return content.includes("chars-planner") && entry.autoinvoke !== false;
    });
    if (!skill) {
      const detail = matches
        .map((entry) => {
          const content = typeof entry.content === "string" ? entry.content : "";
          return `autoinvoke=${String(entry.autoinvoke)}, mentions chars-planner=${content.includes("chars-planner")}`;
        })
        .join("; ");
      return fail(name, detail);
    }
    return pass(name, `HTTP 200 autoinvoke=${String(skill.autoinvoke)} content mentions chars-planner`);
  } catch (error) {
    return fail(name, errorMessage(error));
  }
}

async function checkPlugin(server: ServerHandle, auth: string): Promise<Check> {
  const name = "B plugin active";
  try {
    const response = await apiRequest(server, auth, "/api/plugin");
    if (response.status !== 200) return fail(name, `HTTP ${response.status}: ${snippet(response.text)}`);
    const plugins = asArray(dataOf(response))
      .map((item) => asRecord(item))
      .filter((value): value is Record<string, unknown> => value !== undefined);
    const chars = plugins.find((entry) => entry.id === "chars");
    if (!chars) {
      const ids = plugins.map((entry) => String(entry.id)).join(", ");
      return fail(name, `plugin id chars missing; active [${ids}]`);
    }
    const state = asRecord(chars.state);
    if (state?.status !== "active") {
      return fail(name, `plugin chars state=${JSON.stringify(chars.state)}`);
    }
    return pass(name, "HTTP 200 plugin chars state=active");
  } catch (error) {
    return fail(name, errorMessage(error));
  }
}

async function checkSessionCommand(server: ServerHandle, auth: string): Promise<Check> {
  const name = "D session chars-roles";
  try {
    const created = await apiRequest(server, auth, "/api/session", {
      method: "POST",
      body: JSON.stringify({ title: "chars verify" }),
    });
    if (created.status < 200 || created.status >= 300) {
      return fail(name, `POST /api/session HTTP ${created.status}: ${snippet(created.text)}`);
    }
    const sessionID = asRecord(dataOf(created))?.id;
    if (typeof sessionID !== "string" || sessionID.length === 0) {
      return fail(name, "POST /api/session response data.id missing");
    }
    const run = await apiRequest(server, auth, `/api/session/${encodeURIComponent(sessionID)}/command`, {
      method: "POST",
      body: JSON.stringify({ name: "chars-roles", text: "" }),
    });
    if (run.status !== 204) {
      return fail(name, `POST command HTTP ${run.status}: ${snippet(run.text)}`);
    }
    const deadline = Date.now() + 30000;
    let last = "";
    while (Date.now() < deadline) {
      const context = await apiRequest(server, auth, `/api/session/${encodeURIComponent(sessionID)}/context`);
      if (context.status !== 200) {
        last = `HTTP ${context.status}: ${snippet(context.text)}`;
      } else {
        const messages = asArray(dataOf(context))
          .map((item) => asRecord(item))
          .filter((value): value is Record<string, unknown> => value !== undefined);
        const synthetics = messages.filter((message) => message.type === "synthetic");
        last = `messages=${messages.length}, synthetic=${synthetics.length}`;
        const matched = synthetics.some(
          (message) =>
            typeof message.text === "string" && ROLE_IDS.every((roleID) => message.text.includes(roleID)),
        );
        if (matched) {
          return pass(name, `session=${sessionID} command HTTP 204, synthetic message contains all 7 role ids`);
        }
      }
      await sleep(500);
    }
    return fail(name, `no synthetic message with all 7 role ids within 30s (${last})`);
  } catch (error) {
    return fail(name, errorMessage(error));
  }
}

async function hashAgents(project: string): Promise<AgentSnapshot> {
  const agentsDir = join(project, ".opencode", "agents");
  let entries;
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return { files: [], hashes: {} };
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  const hashes: Record<string, string> = {};
  for (const file of files) {
    const content = await readFile(join(agentsDir, file));
    hashes[file] = createHash("sha256").update(content).digest("hex");
  }
  return { files, hashes };
}

async function findTmpFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith(".tmp")) {
        found.push(fullPath);
      }
    }
  };
  await walk(root);
  return found.sort();
}

async function checkIdempotency(
  before: AgentSnapshot,
  after: AgentSnapshot,
  project: string,
): Promise<Check> {
  const name = "E idempotency";
  const issues: string[] = [];
  if (before.files.length === 0) issues.push("no .md agent files after first server");
  if (before.files.length !== ROLE_IDS.length) {
    issues.push(`first snapshot has ${before.files.length} agent files, expected ${ROLE_IDS.length}`);
  }
  if (after.files.length !== before.files.length) {
    issues.push(`agent count changed ${before.files.length} -> ${after.files.length}`);
  }
  const fileSetChanged =
    before.files.length !== after.files.length ||
    before.files.some((file, index) => file !== after.files[index]);
  if (fileSetChanged) {
    issues.push(`agent files changed [${before.files.join(", ")}] -> [${after.files.join(", ")}]`);
  } else {
    const changed = before.files.filter((file) => before.hashes[file] !== after.hashes[file]);
    if (changed.length > 0) issues.push(`changed hashes: ${changed.join(", ")}`);
  }
  const tmpFiles = await findTmpFiles(project);
  if (tmpFiles.length > 0) {
    issues.push(`.tmp files remain: ${tmpFiles.map((file) => relative(project, file)).join(", ")}`);
  }
  if (issues.length > 0) return fail(name, issues.join("; "));
  return pass(name, `${after.files.length} agent hashes unchanged across restart; no .tmp files`);
}

function printReport(checks: Check[]): boolean {
  const passOverall = checks.length > 0 && checks.every((check) => check.ok);
  const width = Math.max(4, ...checks.map((check) => check.name.length));
  console.log(`PASS/FAIL  ${"CHECK".padEnd(width)}  DETAIL`);
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"}       ${check.name.padEnd(width)}  ${check.detail}`);
  }
  console.log("");
  console.log(JSON.stringify({ pass: passOverall, checks }, null, 2));
  return passOverall;
}

async function run(): Promise<void> {
  const distEntry = join(REPO_ROOT, "dist", "index.js");
  try {
    const entry = await stat(distEntry);
    if (!entry.isFile()) throw new Error("dist/index.js is not a file");
  } catch {
    console.log("run bun run build first");
    process.exitCode = 2;
    return;
  }

  const keep = process.argv.includes("--keep");
  const checks: Check[] = [];
  let root = "";
  let live: ServerHandle | undefined;
  let cleanupError = "";

  try {
    root = await mkdtemp(join(tmpdir(), "chars-verify-v2-"));
    const project = join(root, "project");
    const home = join(root, "home");
    await mkdir(project, { recursive: true });
    await mkdir(home, { recursive: true });
    const git = spawnSync("git", ["init", "-q"], { cwd: project, stdio: "ignore" });
    if (git.error) throw git.error;
    if (git.status !== 0) throw new Error(`git init exited with status ${String(git.status)}`);
    const config = {
      $schema: "https://opencode.ai/config.json",
      plugins: [REPO_ROOT],
    };
    await writeFile(join(project, "opencode.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const first = await startServer(project, home, pickPort());
    live = first;
    const firstAuth = authHeader(first.password);
    await waitForCommands(first, firstAuth);

    checks.push(...(await checkAgents(first, firstAuth)));
    checks.push(await checkCommands(first, firstAuth));
    checks.push(await checkPlugin(first, firstAuth));
    checks.push(await checkSkill(first, firstAuth));
    checks.push(await checkSessionCommand(first, firstAuth));

    const before = await hashAgents(project);
    await stopChild(first.child);
    live = undefined;

    const second = await startServer(project, home, pickPort(first.port));
    live = second;
    const secondAuth = authHeader(second.password);
    await waitForCommands(second, secondAuth);
    const after = await hashAgents(project);
    checks.push(await checkIdempotency(before, after, project));
  } catch (error) {
    checks.push(fail("runtime", errorMessage(error)));
  } finally {
    if (live) {
      try {
        await stopChild(live.child);
      } catch (error) {
        cleanupError = errorMessage(error);
      }
      live = undefined;
    }
    if (root && keep) {
      console.error(`kept temp root at ${root}`);
    } else if (root) {
      try {
        await rm(root, { recursive: true, force: true });
      } catch (error) {
        cleanupError = cleanupError ? `${cleanupError}; ${errorMessage(error)}` : errorMessage(error);
      }
    }
  }

  if (cleanupError) checks.push(fail("cleanup", cleanupError));
  const passOverall = printReport(checks);
  process.exitCode = passOverall ? 0 : 1;
}

run().catch((error) => {
  const checks = [fail("runtime", errorMessage(error))];
  printReport(checks);
  process.exitCode = 1;
});
