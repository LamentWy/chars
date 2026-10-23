// src/types.ts
var ORCHESTRATOR_ID = "orchestrator";
var READ_ONLY_ROLE_IDS = [
  "planner",
  "reviewer",
  "researcher"
];
var SHELL_DENIED_ROLE_IDS = ["researcher"];
var SHELL_TOOL_NAMES = ["shell", "bash"];
var WRITE_TOOL_NAMES = [
  "edit",
  "write",
  "patch",
  "multiedit",
  "apply_patch",
  "applypatch"
];

// src/roles.ts
var ALLOW = [{ action: "*", resource: "*", effect: "allow" }];
var DENY_EDIT = [{ action: "edit", resource: "*", effect: "deny" }];
var DENY_WRITE_AND_SHELL = [
  { action: "edit", resource: "*", effect: "deny" },
  { action: "shell", resource: "*", effect: "deny" }
];
var MARKDOWN_ONLY = [
  { action: "edit", resource: "*", effect: "deny" },
  { action: "edit", resource: "**/*.md", effect: "allow" },
  { action: "edit", resource: "**/*.mdx", effect: "allow" }
];
var ROLES = [
  {
    id: "orchestrator",
    name: "Orchestrator",
    mode: "primary",
    color: "#7c9cff",
    steps: 60,
    description: "Orchestrator that divides work across specialist subagents and integrates their results.",
    when: "Any multi-step software task: planning, implementation, debugging, review, research, or documentation.",
    prompt: `You are orchestrator, the orchestrating agent of the chars plugin. Your job is responsibility division, not doing every part yourself.

## Team
- planner: read-only investigation and decision-complete plans.
- implementer: scoped production code changes with their own verification.
- debugger: reproduce a failure, find the root cause, ship the minimal fix.
- reviewer: independent review of a diff or design; reports findings, never edits.
- researcher: repository and web fact-finding with citations; never edits.
- writer: documentation, README, and prose; edits Markdown only.

## Protocol
1. Classify the request into independent units before acting.
2. Delegate each unit through the subagent tool (or chars_delegate) using the exact agent id above. Give every child a self-contained brief: task, deliverable, scope, verification, stop condition.
3. Run independent units in parallel. Sequence units that share files or depend on earlier findings.
4. Keep integration and final verification yourself: read the actual diff, run the real checks, and compare evidence with the goal.
5. Never present a child's completion claim as proof. A unit is done only when its own run or test output demonstrates the result.

## Rules
- Smallest correct change per unit; no drive-by refactors.
- Read before writing. Never claim a file's contents from memory.
- If a child drifts outside its scope, steer it back or take the unit over.
- Report outcome, evidence, and remaining risk. Stop when the requested behavior is demonstrated.`
  },
  {
    id: "planner",
    name: "Chars Planner",
    mode: "subagent",
    color: "#67c9a8",
    steps: 30,
    permissions: DENY_EDIT,
    description: "Read-only planner. Produces a decision-complete implementation plan with file paths, order, risks, and verification.",
    when: "The task needs architectural decisions, module boundaries, or an ordered multi-file plan before anyone edits code.",
    prompt: `You are planner, a read-only planning specialist.

## Deliverable
A decision-complete plan another agent can execute without re-investigating:
1. Goal and ideal end state in one paragraph.
2. Files to create or change, with exact paths and the responsibility of each.
3. Ordered steps with dependencies and the parallel-safe groups.
4. Interfaces and data contracts between parts.
5. Verification per step: the literal command or scenario and its PASS condition.
6. Risks, unknowns, and the decision you recommend for each.

## Scope
Read anything in the repository. Do NOT create, edit, or delete files. Do NOT run commands that mutate the workspace.

## Rules
- Investigate before planning: read the existing code, tests, and build configuration.
- Name concrete files, symbols, and commands; discard vague steps.
- If the request is already unambiguous and small, say so and give the short plan instead of inflating it.
- Stop when the plan is complete enough to execute without questions.`
  },
  {
    id: "implementer",
    name: "Chars Implementer",
    mode: "subagent",
    color: "#f0b35a",
    steps: 50,
    permissions: ALLOW,
    description: "Implements one scoped change end to end, including its tests and verification.",
    when: "A well-defined unit of production code must be written or changed.",
    prompt: `You are implementer, a focused implementation specialist.

## Deliverable
The requested behavior change, minimal and complete, plus the proof that it works:
- Files changed and why.
- The exact command or scenario you ran, with its output.
- Test results for the code you touched.

## Scope
Edit only the files named in your brief plus the tests that cover them. Do not refactor unrelated code, rename public APIs, or add speculative abstractions.

## Rules
- Read the target files and their neighbors before editing.
- Follow the repository's existing patterns, naming, and test style.
- Make the smallest correct change that satisfies the brief.
- Run the real check, not a proxy: the test, build, or endpoint the brief names.
- If the brief is wrong or blocked, report the blocker and the evidence; do not silently widen scope.
- Stop when the requested behavior is demonstrated by a captured run.`
  },
  {
    id: "reviewer",
    name: "Chars Reviewer",
    mode: "subagent",
    color: "#e06c75",
    steps: 30,
    permissions: DENY_EDIT,
    description: "Independent reviewer. Reports severity-ordered defects with file:line evidence and a PASS/FAIL verdict.",
    when: "A change, plan, or design is ready for an independent correctness and regression review.",
    prompt: `You are reviewer, an independent reviewer.

## Deliverable
A review with findings in severity order:
- Each finding: severity, file:line, what is wrong, why it matters, and the smallest fix.
- Evidence: the command you ran and its relevant output.
- One final verdict: PASS or FAIL against the stated requirements.

## Scope
Read the diff, the affected files, and their tests. You may run tests, builds, and read-only commands. Do NOT edit files and do NOT fix the findings yourself.

## Rules
- Review the actual change, not the author's description of it.
- Check correctness, edge cases, regressions in adjacent behavior, and whether the tests can actually fail.
- A green suite alone is not proof that user-facing behavior works; name what was exercised.
- Do not manufacture findings. If the change is sound, say PASS and list what you checked.
- Stop when the verdict is supported by evidence.`
  },
  {
    id: "researcher",
    name: "Chars Researcher",
    mode: "subagent",
    color: "#56b6c2",
    steps: 30,
    permissions: DENY_WRITE_AND_SHELL,
    description: "Read-only fact finder for repository and web questions, returning cited findings and uncertainties.",
    when: "The team needs facts about the codebase, a library, an API, or external documentation.",
    prompt: `You are researcher, a read-only research specialist.

## Deliverable
A compact findings report:
- Direct answer to the question.
- Each fact with its source: file:line for repository facts, full URL for web facts.
- Contradictions or uncertainty, labelled explicitly.
- What you could not verify.

## Scope
Read files, search the repository, and fetch web sources. Do NOT edit files and do NOT run shell commands that mutate anything.

## Rules
- Prefer primary sources: the code itself, official documentation, the library's type definitions.
- Quote the smallest relevant excerpt; never present a guess as fact.
- Check the installed version before relying on external API documentation.
- Stop when the question is answered with citations, or when the missing access is named.`
  },
  {
    id: "debugger",
    name: "Chars Debugger",
    mode: "subagent",
    color: "#c678dd",
    steps: 40,
    permissions: ALLOW,
    description: "Reproduces a failure, isolates its root cause, and ships the minimal proven fix.",
    when: "Something is broken, failing, flaky, or behaving unexpectedly and the cause is not already proven.",
    prompt: `You are debugger, a root-cause specialist.

## Deliverable
- A reproduction of the failure with its exact command and output.
- The root cause, stated as the mechanism that produces the symptom, with file:line evidence.
- The minimal fix and the command/output that proves the symptom is gone.
- Any remaining related risk.

## Scope
Read the failing code and its callers. Edit the smallest set of files needed to fix the proven cause. Do not mix in refactors or unrelated fixes.

## Rules
- Reproduce before changing code. Capture the failing output.
- Form one hypothesis at a time; verify or discard it with evidence.
- Never shotgun-debug with unrelated edits, blind retries, or suppressed errors.
- Lock the fix with a test that would fail without it, when the repository keeps tests for that behavior.
- Stop when the reproduction passes and the cause is explained.`
  },
  {
    id: "writer",
    name: "Chars Writer",
    mode: "subagent",
    color: "#98c379",
    steps: 30,
    permissions: MARKDOWN_ONLY,
    description: "Writes and updates documentation, README files, and prose with verifiable commands and links.",
    when: "Documentation, a README, release notes, or explanatory prose must be written or corrected.",
    prompt: `You are writer, a documentation specialist.

## Deliverable
The requested prose, shipped in the named files, with:
- Every command and path checked against the repository or tool it describes.
- The files changed and a short summary of each edit.
- Any claim you could not verify, listed explicitly.

## Scope
Edit Markdown files only. Do not modify source code, configuration, or tests. Read source files freely to keep the prose accurate.

## Rules
- Match the repository's language, tone, heading style, and formatting.
- Prefer concrete examples over adjectives; no marketing filler.
- Keep instructions executable: exact commands, exact paths, expected output.
- Do not document behavior you have not verified or read in the code.
- Stop when the requested documents are complete and internally consistent.`
  }
];
var ROLE_BY_ID = new Map(ROLES.map((role) => [role.id, role]));
function getRole(id) {
  return ROLE_BY_ID.get(id);
}
function resolveModel(role, options) {
  return options.models?.[role.id];
}
function renderAgentMarkdown(role, model) {
  const lines = ["---", `description: ${JSON.stringify(role.description)}`, `mode: ${role.mode}`, `color: ${JSON.stringify(role.color)}`];
  if (model)
    lines.push(`model: ${model}`);
  if (role.steps !== undefined)
    lines.push(`steps: ${role.steps}`);
  if (role.hidden)
    lines.push("hidden: true");
  if (role.permissions?.length) {
    lines.push("permissions:");
    for (const rule of role.permissions) {
      lines.push(`  - action: ${JSON.stringify(rule.action)}`, `    resource: ${JSON.stringify(rule.resource)}`, `    effect: ${rule.effect}`);
    }
  }
  lines.push("---", "", role.prompt.trim(), "");
  return lines.join(`
`);
}
function renderRoleTable() {
  return [
    "| Agent id | Responsibility | Use when |",
    "| --- | --- | --- |",
    ...ROLES.map((role) => `| \`${role.id}\` | ${role.description} | ${role.when} |`)
  ].join(`
`);
}
function renderSkillContent() {
  return `# Chars roles

Use this skill when a task benefits from dividing work by responsibility instead of doing everything in one agent loop.

## Roles
${renderRoleTable()}

## Delegation protocol
1. Split the request into independent units. Each unit must name its deliverable, scope, verification, and stop condition.
2. Launch each unit through the \`subagent\` tool with the exact agent id from the table above, or through \`chars_delegate\` when you need the child's final answer returned as tool output.
3. Launch independent units in parallel; sequence units that share files or consume earlier findings.
4. Keep integration and final verification in the primary agent. Read the real diff and run the real checks.
5. Never treat a child's completion message as proof. Evidence is a captured command, test, or endpoint result.

## Boundaries
- \`planner\`, \`reviewer\`, and \`researcher\` are read-only.
- \`writer\` edits Markdown only.
- \`implementer\`, \`debugger\`, and \`orchestrator\` may edit code.

## Routing shortcuts
- Unclear approach, multiple files, or architecture choice: \`planner\`.
- Known change in known files: \`implementer\`.
- Failure with unknown cause: \`debugger\`.
- Second opinion before delivery: \`reviewer\`.
- Unknown library, API, or repository fact: \`researcher\`.
- README, docs, release notes: \`writer\`.
`;
}
var ROUTE_RULES = [
  { role: "reviewer", keywords: ["review", "audit", "critique", "second opinion", "检查", "评审", "审查"] },
  { role: "debugger", keywords: ["bug", "debug", "crash", "fails", "failure", "flaky", "regression", "error", "broken", "报错", "调试", "修复"] },
  { role: "planner", keywords: ["plan", "design", "architecture", "approach", "strategy", "roadmap", "方案", "设计", "规划"] },
  { role: "researcher", keywords: ["research", "find out", "look up", "documentation", "docs for", "how does", "survey", "调研", "查一下", "资料"] },
  { role: "writer", keywords: ["readme", "documentation", "docs", "prose", "release notes", "changelog", "文档", "说明"] },
  { role: "implementer", keywords: ["implement", "add", "build", "create", "feature", "refactor", "实现", "新增", "开发"] }
];
function routeTask(task) {
  const text = task.toLowerCase();
  let best = { role: ORCHESTRATOR_ID, matched: [], score: 0 };
  for (const rule of ROUTE_RULES) {
    const matched = rule.keywords.filter((keyword) => text.includes(keyword));
    if (matched.length > best.score)
      best = { role: rule.role, matched, score: matched.length };
  }
  return best;
}

// src/commands.ts
function renderRoster(roles) {
  if (roles === ROLES)
    return renderRoleTable();
  return roles.map((role) => `- \`${role.id}\` - ${role.description}`).join(`
`);
}
async function registerCommands(ctx, input = {}) {
  const roles = input.roles ?? ROLES;
  const context = ctx;
  const registration = await context.command.transform((editor) => {
    editor.add({
      name: "chars",
      description: "Start or steer a chars orchestration task",
      async execute({ sessionID, prompt, delivery }) {
        await context.session.switchAgent({ sessionID, agent: "orchestrator" });
        const text = prompt.text.trim();
        if (text) {
          await context.session.prompt({ sessionID, text, delivery });
        } else {
          await context.session.synthetic({
            sessionID,
            text: "orchestrator active. Ask for a task, or run /chars-roles to see the team.",
            resume: false
          });
        }
      }
    });
    editor.add({
      name: "chars-roles",
      description: "Show the chars role roster",
      async execute({ sessionID }) {
        const table = renderRoster(roles);
        await context.session.synthetic({
          sessionID,
          text: `## chars roles

` + table + `

Delegate with the subagent tool using one of these agent ids.`,
          description: "chars roles",
          resume: true
        });
      }
    });
  });
  return { dispose: () => registration.dispose() };
}

// src/hooks.ts
var POLICY = [
  "## chars orchestration policy",
  "",
  "1. Classify the request before acting: split it into independent units, each with a deliverable, scope, verification, and stop condition.",
  "2. Delegate each independent unit with the subagent tool using the exact agent id: planner, implementer, debugger, reviewer, researcher, or writer.",
  "3. Keep integration and final verification in orchestrator: read the real diff and run the real checks yourself.",
  "4. Never treat a child's completion claim as evidence; require the child's captured command, test, or output."
].join(`
`);
async function registerHooks(ctx, input = {}) {
  const options = input.options ?? {};
  const context = ctx;
  const session = await context.session.hook("context", (event) => {
    if (event.agent === "orchestrator" && event.system) {
      event.system.push({ type: "text", text: POLICY });
    }
  });
  const tool = await context.tool.hook("execute.before", (event) => {
    if (options.guardReadOnly === false)
      return;
    if (READ_ONLY_ROLE_IDS.includes(event.agent) && WRITE_TOOL_NAMES.includes(event.tool)) {
      throw new Error(`Role ${event.agent} is read-only; route edits to implementer.`);
    }
    if (SHELL_DENIED_ROLE_IDS.includes(event.agent) && SHELL_TOOL_NAMES.includes(event.tool)) {
      throw new Error(`Role ${event.agent} may not run shell commands; route execution to implementer.`);
    }
  });
  return {
    dispose: async () => {
      await session.dispose();
      await tool.dispose();
    }
  };
}

// src/install.ts
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
var MANIFEST_FILE = ".chars-manifest.json";
var SKILL_RELATIVE_PATH = join(".opencode", "skills", "chars-roles", "SKILL.md");
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function resolveAgentsDir(directory, options) {
  if (!options.rolesDir)
    return join(directory, ".opencode", "agents");
  return isAbsolute(options.rolesDir) ? options.rolesDir : resolve(directory, options.rolesDir);
}
async function readManifest(manifestPath) {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
    if (parsed.plugin === "chars" && parsed.files && typeof parsed.files === "object") {
      return { version: 1, plugin: "chars", files: parsed.files };
    }
  } catch {
    return { version: 1, plugin: "chars", files: {} };
  }
  return { version: 1, plugin: "chars", files: {} };
}
async function fileHash(path) {
  try {
    return sha256(await readFile(path, "utf8"));
  } catch {
    return;
  }
}
async function installRoles(directory, options = {}) {
  const agentsDir = resolveAgentsDir(directory, options);
  const roles = options.roles ?? ROLES;
  const result = { directory: agentsDir, written: [], updated: [], skipped: [], removed: [] };
  await mkdir(agentsDir, { recursive: true });
  const manifestPath = join(agentsDir, MANIFEST_FILE);
  const manifest = await readManifest(manifestPath);
  const nextFiles = {};
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
    if (roleFiles.has(fileName))
      continue;
    const target = join(agentsDir, fileName);
    if (await fileHash(target) === hash) {
      await unlink(target);
      result.removed.push(target);
    }
  }
  const manifestChanged = JSON.stringify(manifest.files) !== JSON.stringify(nextFiles);
  if (manifestChanged || !await fileHash(manifestPath)) {
    await writeFile(manifestPath, `${JSON.stringify({ version: 1, plugin: "chars", files: nextFiles }, null, 2)}
`, "utf8");
  }
  return result;
}
async function installSkillFile(directory) {
  const target = join(directory, SKILL_RELATIVE_PATH);
  const content = renderSkillContent();
  if (await fileHash(target) === sha256(content))
    return;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return target;
}

// src/skill.ts
import { join as join2 } from "node:path";
var CHARS_SKILL_ID = "chars-roles";
function skillPath(directory) {
  return join2(directory, ".opencode", "skills", CHARS_SKILL_ID, "SKILL.md");
}
function skillInfo(directory) {
  return {
    id: CHARS_SKILL_ID,
    name: "Chars Roles",
    description: "Multi-agent role division for chars: route planning, implementation, debugging, review, research, and documentation to the matching specialist agent.",
    autoinvoke: true,
    path: skillPath(directory),
    content: renderSkillContent()
  };
}

// src/tools.ts
var ROLES_INPUT = {
  type: "object",
  properties: {
    task: { type: "string" }
  },
  additionalProperties: false
};
var DELEGATE_INPUT = {
  type: "object",
  properties: {
    role: { type: "string" },
    task: { type: "string" },
    title: { type: "string" }
  },
  required: ["role", "task"],
  additionalProperties: false
};
function renderRoster2(roles) {
  return roles.map((role) => `${role.id} | ${role.mode} | ${role.when}`).join(`
`);
}
function createRolesTool(roles) {
  return {
    name: "chars_roles",
    input: ROLES_INPUT,
    description: "List the chars role roster, or recommend the best role for a task.",
    async execute(raw) {
      const input = raw ?? {};
      const task = typeof input.task === "string" ? input.task.trim() : "";
      const recommended = task ? routeTask(task) : undefined;
      const header = recommended ? `Recommended role: ${recommended.role} (matched: ${recommended.matched.join(", ")})

` : "";
      return {
        content: `${header}${renderRoster2(roles)}`,
        metadata: {
          recommended: recommended?.role ?? null,
          roles: roles.map((role) => role.id)
        }
      };
    }
  };
}
function createDelegateTool(ctx, roles) {
  return {
    name: "chars_delegate",
    input: DELEGATE_INPUT,
    description: "Delegate one self-contained task to a chars specialist subagent and return its final answer.",
    async execute(raw, context) {
      const input = raw ?? {};
      const roleId = typeof input.role === "string" ? input.role : "";
      const task = typeof input.task === "string" ? input.task : "";
      const role = roles.find((candidate) => candidate.id === roleId) ?? getRole(roleId);
      if (!role) {
        throw new Error(`Unknown chars role: ${roleId}. Known roles: ${roles.map((candidate) => candidate.id).join(", ")}`);
      }
      if (role.mode === "primary") {
        throw new Error(`Role ${role.id} is a primary role and cannot be delegated.`);
      }
      const parent = await ctx.session.get({ sessionID: context.sessionID });
      const title = typeof input.title === "string" && input.title.trim().length > 0 ? input.title : `${role.id}: ${task.slice(0, 60)}`;
      const child = await ctx.session.create({
        parentID: context.sessionID,
        title,
        agent: role.id,
        location: parent.location ? { directory: parent.location.directory } : undefined
      });
      await ctx.session.prompt({ sessionID: child.id, text: task });
      await ctx.session.wait({ sessionID: child.id });
      if (context.signal.aborted) {
        await ctx.session.interrupt({ sessionID: child.id });
        throw new Error("chars_delegate aborted");
      }
      const messages = await ctx.session.context({ sessionID: child.id });
      const assistant = [...messages].reverse().find((message) => message.type === "assistant");
      const text = assistant ? assistant.content.filter((entry) => entry.type === "text").map((entry) => entry.text).join(`

`) : "";
      return {
        content: text || "(no assistant text returned)",
        metadata: { role: role.id, sessionID: child.id }
      };
    }
  };
}
async function registerTools(ctx, input = {}) {
  const roles = input.roles ?? ROLES;
  const registration = await ctx.tool.transform((editor) => {
    editor.add(createRolesTool(roles));
    editor.add(createDelegateTool(ctx, roles));
  });
  return { dispose: () => registration.dispose() };
}

// src/index.ts
var plugin = {
  id: "chars",
  async setup(ctx) {
    const options = ctx.options ?? {};
    const cleanups = [];
    if (options.install !== false) {
      const installed = await installRoles(ctx.location.directory, options);
      if (installed.written.length > 0 || installed.updated.length > 0 || installed.removed.length > 0) {
        await ctx.agent.reload();
      }
      if (options.writeSkillFile !== false) {
        await installSkillFile(ctx.location.directory);
      }
    }
    const skill = await ctx.skill.transform((editor) => {
      editor.add(skillInfo(ctx.location.directory));
    });
    cleanups.push(() => skill.dispose());
    const tools = await registerTools(ctx, { options });
    cleanups.push(tools.dispose);
    const commands = await registerCommands(ctx);
    cleanups.push(commands.dispose);
    const hooks = await registerHooks(ctx, { options });
    cleanups.push(hooks.dispose);
    return async () => {
      for (const cleanup of cleanups.reverse())
        await cleanup();
    };
  }
};
var src_default = plugin;
export {
  src_default as default
};
