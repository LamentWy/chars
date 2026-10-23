# chars

chars 是 characters 的缩写。

这是一个 OpenCode V2 插件，同样面向 Desktop V2。它把 [omo](https://github.com/code-yeongyu/oh-my-openagent) 4.x 时期的多 agent 职责分工带回来：一个 primary 编排者 `chars`，外加六个边界清楚的 subagent。插件在启动时把角色定义写进项目，注册派活工具和命令，让主 agent 按任务类型分工，最后自己收口做集成和验证。

## 安装（本地开发）

环境要求：OpenCode V2（含 Desktop V2）、Bun，以及作为 peer dependency 的 `@opencode/plugin >= 2.1.0`。

```bash
cd /path/to/chars-plugin
bun install
bun run build
```

构建产物是 `dist/index.js`，包的 `exports` 指向它。

在项目的 `opencode.json` 里，把插件目录的绝对路径加进 `plugins` 数组：

```json
{
  "plugins": ["/absolute/path/to/chars-plugin"]
}
```

也可以把插件目录放到项目的 `.opencode/plugins/` 下，让 OpenCode 从这里加载。改完配置重启 opencode，插件会在 `setup` 阶段执行安装。

Desktop V2 使用同一套配置目录和项目配置，配置方式不变。桌面端 sidecar 启动的就是同一个 V2 server（`Server.listen`），只额外注入 server 用户名/密码和 `XDG_STATE_HOME`；`~/.config/opencode/plugins/`、项目 `.opencode/plugins/` 以及 `opencode.json` 的 `plugins` 条目在桌面端同样生效。

`install` 开启时，每次 `setup` 都会调用 `installRoles`，把 7 个 agent 定义写到 `.opencode/agents/chars*.md`，并在同目录的 `.chars-manifest.json` 里记录文件哈希。规则很直接：你手工改过的角色文件不会被覆盖，只要它和清单里的哈希对不上，安装就会跳过它。角色目录里如果还有旧插件文件且内容未被改动，这些文件会被清理掉。

`writeSkillFile` 开启时，插件还会写一份路由 skill 到 `.opencode/skills/chars-roles/SKILL.md`。

## 七个角色

角色定义在 `src/roles.ts`。`/chars-roles` 和自动写入的技能文件，表格内容都来自 `renderRoleTable()`。

| Agent id | 职责 | 什么时候用 | 读写边界 |
| --- | --- | --- | --- |
| `chars` | 编排者，把工作拆给各个专家 subagent，再集成结果 | 任何多步骤软件任务：规划、实现、调试、评审、调研、文档 | 可读写 |
| `chars-planner` | 只读规划者，产出可以直接执行的方案，含文件路径、顺序、风险和验证方式 | 需要架构决策、模块边界，或动手前要一份有序的多文件计划 | 只读，拒绝 `edit` |
| `chars-implementer` | 端到端完成一个限定范围的改动，连同测试和验证 | 有一块明确的业务代码要写或要改 | 可读写 |
| `chars-reviewer` | 独立评审，按严重程度报告缺陷，给出 `file:line` 证据和 PASS/FAIL 结论 | 改动、方案或设计需要一次独立的正确性与回归检查 | 只读，拒绝 `edit` |
| `chars-researcher` | 只读事实核查，回答仓库与外部资料问题，返回带引用的结论和不确定项 | 需要查代码库事实、库、API 或官方文档 | 只读，拒绝 `edit` 和 `shell` |
| `chars-debugger` | 复现故障，定位根因，提交最小且可证明的修复 | 东西坏了、失败、偶发或行为异常，而原因还没被证实 | 可读写 |
| `chars-writer` | 写文档、README 和说明文字，命令与链接都要可验证 | 需要写或修文档、README、发布说明、解释性文字 | 只能编辑 `**/*.md` 和 `**/*.mdx` |

只读边界写在生成的 agent frontmatter 里，`chars-planner`、`chars-reviewer`、`chars-researcher` 带 `action: edit, effect: deny`；`chars-researcher` 额外拒绝 `shell`。`chars-writer` 先拒绝所有 `edit`，再单独放行 Markdown 后缀。

## 选项

插件选项通过 `setup` 的 `ctx.options` 传入，类型定义在 `src/types.ts` 的 `CharsOptions`：

```ts
type CharsOptions = {
  install?: boolean;
  rolesDir?: string;
  models?: Record<string, string>;
  writeSkillFile?: boolean;
  guardReadOnly?: boolean;
};
```

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `install` | `true` | 启动时写入角色文件。设为 `false` 则不落盘 agent，也不写 skill 文件 |
| `rolesDir` | `.opencode/agents` | 角色文件目录。可传绝对路径，或相对项目根目录的路径 |
| `models` | 无 | 按角色 id 覆盖模型，例如 `{ "chars-reviewer": "anthropic/claude-sonnet-4-5#high" }`，值会写进该 agent frontmatter 的 `model` |
| `writeSkillFile` | `true` | 同时写入 `.opencode/skills/chars-roles/SKILL.md`。仅在 `install` 开启时生效 |
| `guardReadOnly` | `true` | 为只读角色拦截写工具 |

## 使用

主 agent 通过 `subagent` 工具派活，agent id 用上表里那一个。`chars` 的 system prompt 要求每份 brief 自带任务、交付物、范围、验证方式和停止条件，独立单元并行，共享文件的单元串行。

| 入口 | 作用 |
| --- | --- |
| `/chars` | 把当前会话切到 `chars` agent。后面跟了文字就作为 prompt 发出去；没跟文字则注入一条提示，告诉你 orchestrator 已就绪 |
| `/chars-roles` | 在当前会话里输出角色表，并提示用 `subagent` 工具按 id 派活 |
| `chars_roles` | 列出角色。可选参数 `task`：带上任务文本时，先用 `routeTask` 做关键词路由，在开头给一个推荐角色和命中的关键词；返回里每行依次是角色 id、mode 和适用时机，metadata 带 `recommended` 和 `roles` |
| `chars_delegate` | 把一个自包含任务交给专家 subagent 并拿回最终答复。必填 `role` 和 `task`，可选 `title`。`role` 必须是已知的非 primary 角色，primary 角色会被拒绝；插件会创建以当前会话为父的子会话，在父会话同目录下运行，等它结束后返回最后一条 assistant 文本 |

`chars` 会话还会自动注入一段编排策略：先拆分独立单元，用准确的 agent id 派活，集成和最终验证留在自己手里，子 agent 的完成声明不算证据。`guardReadOnly` 开启时，只读角色调用 `edit`、`write`、`patch`、`multiedit`、`apply_patch`、`applypatch` 会被直接拒绝，报错提示改走 `chars-implementer`；`chars-researcher` 额外被禁止调用 `shell`、`bash`。

## 验证

```bash
bun test
bun run typecheck
bun run build
bun run verify
```

`bun test` 跑 `test/` 下的单元测试，覆盖角色目录、只读权限、frontmatter 渲染、路由、安装幂等性，以及工具与命令的注册。

`bun run typecheck` 跑 `tsc --noEmit`，做全量类型检查。

`bun run build` 用 bun 打包 `src/index.ts` 到 `dist`，再用 `tsc -p tsconfig.build.json` 生成类型声明。

`bun run verify` 是真实环境验证，先跑过 `bun run build`，再执行 `scripts/verify-v2.ts`。它需要一个可用的 opencode 可执行文件，默认 `/usr/local/bin/opencode`，可用环境变量 `OPENCODE_BIN` 覆盖。

脚本会在临时目录里建一个项目，写一份 `opencode.json`（`plugins` 指向本仓库），配上临时 `HOME` 和 `XDG_CONFIG_HOME`，然后启动 `opencode serve`，通过 HTTP API 检查这些事：

- 7 个 agent 都能查到，id 和 mode 都对（`chars` 是 primary，其余是 subagent）
- `/api/command` 里注册了 `chars` 和 `chars-roles`
- `/api/skill` 里能查到 `chars-roles`，且内容提到 `chars-planner`（插件注册时设置为 autoinvoke；部分运行时版本不会在 API 响应里回显该字段）
- 在新会话执行 `/chars-roles`，能收到一条包含全部 7 个角色 id 的 synthetic 消息
- 重启 opencode 后，`.opencode/agents` 下的文件哈希不变，也没有残留的 `.tmp` 文件

结果以 PASS/FAIL 表和 JSON 输出，全部通过才退出 0。加 `--keep` 可以保留临时目录，方便排查。

## 文件结构

```
index.js        本地插件目录入口，转发到 dist/index.js
src/
  index.ts      插件入口，串联安装、skill、工具、命令和 hooks
  roles.ts      角色目录、frontmatter 与 skill 渲染、关键词路由
  install.ts    写入角色文件、清单去重与 skill 文件
  tools.ts      注册 chars_roles 与 chars_delegate 工具
  commands.ts   注册 /chars 与 /chars-roles 命令
  hooks.ts      执行期守卫，按只读边界拦截写工具
  skill.ts      chars-roles skill 的元信息与路径
  types.ts      角色、权限和插件选项类型
scripts/
  verify-v2.ts  启动真实 opencode serve 做端到端验证
```
