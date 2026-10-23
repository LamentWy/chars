# chars

chars 是 characters 的缩写，是一个 **OpenCode V2 插件**（同样适用于 Desktop V2）。

它把 [omo](https://github.com/code-yeongyu/oh-my-openagent) 4.x 时期的多 agent 职责分工带了回来：一个 primary 编排者 `orchestrator`，外加六个边界清晰的 subagent。插件在加载时把角色定义写进项目，并注册路由技能、派活工具和命令，让主 agent 按任务类型分工，最后自己收口做集成与验证。

- **按职责分活**：规划、实现、调试、评审、调研、写作各有专职 agent，不再让一个 agent 什么都做。
- **权限即边界**：只读角色拒绝 `edit`，`researcher` 拒绝 `shell`，`writer` 只能改 Markdown；执行期还有一层守卫。
- **开箱即用**：`/chars` 切到编排者，`/chars-roles` 查看团队，`chars_roles` 做路由推荐，`chars_delegate` 同步取回子 agent 的最终答复。

## 快速开始

```bash
git clone https://github.com/LamentWy/chars.git
cd chars
bun install
bun run build
```

然后在**你的项目**根目录的 `opencode.json` 里指向这个目录（绝对路径，指向仓库根目录）：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/chars"]
}
```

重启 OpenCode，新建会话，执行 `/chars-roles`。能看到七个角色就说明安装成功。

## 安装

### 前置条件

- OpenCode V2 或 Desktop V2
- Bun（仅用于构建和开发；插件运行在 OpenCode 自带的运行时里）
- 项目目录可写：插件默认会把角色文件写到 `<项目>/.opencode/agents/`

### 第 1 步：构建

```bash
cd /path/to/chars
bun install
bun run build
```

构建完成后应同时存在：

```text
index.js      # 本地插件目录入口，转发到 dist/index.js
dist/index.js # 实际插件代码
```

> 目录形式的插件入口只认 `<目录>/index.js`（或 `index.ts`），不读取 `package.json` 的 `main`/`exports`。因此 `index.js` 和 `dist/` 缺一不可。改动源码后需要重新 `bun run build`。

### 第 2 步：让 OpenCode 加载

下面三种方式任选一种。

#### 方式 A：项目配置指向插件目录（推荐）

在项目根目录的 `opencode.json` / `opencode.jsonc` 中加入绝对路径：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/chars"]
}
```

路径必须指向**仓库根目录**（也就是包含 `index.js` 的那一层），不要指向 `dist/` 或 `src/`。

#### 方式 B：放进项目的 `.opencode/plugins/`

OpenCode 会自动加载 `.opencode/plugins/` 下直接的插件目录。推荐用符号链接，后续 `git pull` 后不需要重新拷贝：

```bash
cd /path/to/your-project
mkdir -p .opencode/plugins
ln -s /absolute/path/to/chars .opencode/plugins/chars
```

也可以直接复制整个仓库到 `.opencode/plugins/chars`；复制后确认该目录里的 `index.js` 和 `dist/index.js` 都在。

#### 方式 C：全局安装（所有项目）

同样的目录约定放到 OpenCode 配置目录下：

```bash
mkdir -p ~/.config/opencode/plugins
ln -s /absolute/path/to/chars ~/.config/opencode/plugins/chars
```

或者在全局配置 `~/.config/opencode/opencode.jsonc` 的 `plugins` 数组里加上绝对路径。全局安装后，每个项目在首次加载时都会生成自己的角色文件。

#### 带选项的写法

需要传选项时，把字符串换成对象：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/to/chars",
      "options": {
        "models": {
          "reviewer": "anthropic/claude-sonnet-4-5#high",
          "implementer": "anthropic/claude-sonnet-4-5"
        }
      }
    }
  ]
}
```

`package` 的路径规则与上面的字符串写法一致。选项含义见[选项](#选项)。

### 第 3 步：确认安装

重启 OpenCode（CLI 或桌面端），新建会话后执行：

```text
/chars-roles
```

预期会看到七个角色的表格，并提示用 `subagent` 工具按 id 派活。同时项目里应生成：

```text
.opencode/agents/orchestrator.md
.opencode/agents/planner.md
.opencode/agents/implementer.md
.opencode/agents/reviewer.md
.opencode/agents/researcher.md
.opencode/agents/debugger.md
.opencode/agents/writer.md
.opencode/agents/.chars-manifest.json
.opencode/skills/chars-roles/SKILL.md
```

常见问题：

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 没有 `/chars`、`/chars-roles` 命令 | 路径不是仓库根目录、缺少 `index.js` / `dist/index.js`，或改配置后没重启 | 确认目录内容，执行 `bun run build`，重启 OpenCode |
| 命令在，但 `subagent` 里找不到角色 | 角色文件没写成功，或 `rolesDir` 指向了 OpenCode 不会扫描的目录 | 保持默认 `.opencode/agents`；确认项目可写 |
| 改了角色 prompt 但不生效 | 插件不会覆盖手工修改过的角色文件 | 删除对应 `.md` 后重启，或恢复成插件生成的内容再重启 |
| 目录里残留旧的 `chars-*.md` | 旧版本角色文件名 | 插件拥有且未被修改的旧文件会自动清理；手工改过的需自行删除 |

### Desktop V2

Desktop V2 与 CLI 使用同一套配置发现规则：项目 `opencode.json`、项目 `.opencode/plugins/`、`~/.config/opencode/` 都会生效。桌面端的 sidecar 启动的就是同一个 V2 server，只额外注入 server 用户名/密码和 `XDG_STATE_HOME`。改完配置后重启桌面应用即可，安装与验证步骤相同。

### 升级与卸载

升级：

```bash
cd /path/to/chars
git pull
bun run build
```

重启 OpenCode。插件会更新自己生成且未被你修改过的角色文件；你手工改过的文件会保留。角色数量或 id 变化时，旧的插件文件会被清理。

卸载：

1. 从 `opencode.json` 的 `plugins` 中移除该条目，或删除 `.opencode/plugins/chars`（全局安装则删除 `~/.config/opencode/plugins/chars`）。
2. 删除项目里的 `.opencode/agents/{orchestrator,planner,implementer,reviewer,researcher,debugger,writer}.md`、`.opencode/agents/.chars-manifest.json` 和 `.opencode/skills/chars-roles/`。
3. 重启 OpenCode。

## 七个角色

角色定义在 `src/roles.ts`。`/chars-roles` 和自动写入的技能文件，表格内容都来自 `renderRoleTable()`。

| Agent id | 职责 | 什么时候用 | 读写边界 |
| --- | --- | --- | --- |
| `orchestrator` | 编排者，把工作拆给各个专家 subagent，再集成结果 | 任何多步骤软件任务：规划、实现、调试、评审、调研、文档 | 可读写 |
| `planner` | 只读规划者，产出可以直接执行的方案，含文件路径、顺序、风险和验证方式 | 需要架构决策、模块边界，或动手前要一份有序的多文件计划 | 只读，拒绝 `edit` |
| `implementer` | 端到端完成一个限定范围的改动，连同测试和验证 | 有一块明确的业务代码要写或要改 | 可读写 |
| `reviewer` | 独立评审，按严重程度报告缺陷，给出 `file:line` 证据和 PASS/FAIL 结论 | 改动、方案或设计需要一次独立的正确性与回归检查 | 只读，拒绝 `edit` |
| `researcher` | 只读事实核查，回答仓库与外部资料问题，返回带引用的结论和不确定项 | 需要查代码库事实、库、API 或官方文档 | 只读，拒绝 `edit` 和 `shell` |
| `debugger` | 复现故障，定位根因，提交最小且可证明的修复 | 东西坏了、失败、偶发或行为异常，而原因还没被证实 | 可读写 |
| `writer` | 写文档、README 和说明文字，命令与链接都要可验证 | 需要写或修文档、README、发布说明、解释性文字 | 只能编辑 `**/*.md` 和 `**/*.mdx` |

只读边界写在生成的 agent frontmatter 里：`planner`、`reviewer`、`researcher` 带 `action: edit, effect: deny`；`researcher` 额外拒绝 `shell`；`writer` 先拒绝所有 `edit`，再单独放行 Markdown 后缀。

## 选项

选项通过 `setup` 的 `ctx.options` 传入，类型定义在 `src/types.ts` 的 `CharsOptions`。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `install` | `true` | 启动时写入角色文件。设为 `false` 则不落盘 agent，也不写 skill 文件 |
| `rolesDir` | `.opencode/agents` | 角色文件目录。可以是绝对路径或相对项目根目录的路径；**必须位于 OpenCode 会扫描的位置**，否则文件写了但 agent 不会被加载 |
| `models` | 无 | 按角色 id 覆盖模型，例如 `{ "reviewer": "anthropic/claude-sonnet-4-5#high" }`。值原样写进该 agent frontmatter 的 `model` |
| `writeSkillFile` | `true` | 同时写入 `.opencode/skills/chars-roles/SKILL.md`。仅在 `install` 开启时生效 |
| `guardReadOnly` | `true` | 拦截只读角色的写操作：`edit`/`write`/`patch` 系工具，以及 `researcher` 的 `shell`/`bash` |

## 使用

主 agent 通过 `subagent` 工具派活，agent id 用上表里的那一个。`orchestrator` 的 system prompt 要求每份 brief 自带任务、交付物、范围、验证方式和停止条件；独立单元并行，共享文件的单元串行。

| 入口 | 作用 |
| --- | --- |
| `/chars` | 把当前会话切到 `orchestrator`。后面跟文字就作为 prompt 发出；没跟文字则提示 orchestrator 已就绪 |
| `/chars-roles` | 在当前会话输出角色表，并提示用 `subagent` 工具按 id 派活 |
| `chars_roles` | 列出角色。可选参数 `task`：带上任务文本时先做关键词路由，在开头给出推荐角色和命中的关键词；返回每行依次是角色 id、mode 和适用时机，metadata 带 `recommended` 和 `roles` |
| `chars_delegate` | 把一个自包含任务交给专家 subagent 并取回最终答复。必填 `role` 和 `task`，可选 `title`。`role` 必须是已知的非 primary 角色；插件会创建以当前会话为父的子会话，在父会话同目录运行，结束后返回最后一条 assistant 文本 |

`orchestrator` 会话还会自动注入一段编排策略：先拆分独立单元，用准确的 agent id 派活，集成和最终验证留在自己手里，子 agent 的完成声明不算证据。

## 开发与验证

```bash
bun test          # 单元测试
bun run typecheck # tsc --noEmit
bun run build     # 打包 dist + 生成类型声明
bun run verify    # 真实 OpenCode V2 端到端验收
```

`bun test` 覆盖角色目录、只读权限、frontmatter 渲染、路由、安装幂等与旧角色迁移、工具和命令注册。

`bun run verify` 会先要求 `dist/index.js` 存在，然后在临时目录创建项目、写入临时 `HOME`，启动真实的 `opencode serve`，通过 HTTP API 检查：

- 7 个 agent 的 id 和 mode 正确（`orchestrator` 为 primary，其余为 subagent）
- `/chars` 与 `/chars-roles` 命令已注册，插件状态为 active
- `chars-roles` skill 存在且内容包含角色信息
- 新会话执行 `/chars-roles` 后，synthetic 消息包含全部 7 个角色 id
- 重启服务器后角色文件哈希不变，没有 `.tmp` 残留

默认使用 `/usr/local/bin/opencode`，可用 `OPENCODE_BIN` 覆盖；加 `--keep` 可保留临时目录。

## 文件结构

```text
index.js          本地插件目录入口，转发到 dist/index.js
src/
  index.ts        插件入口，串联安装、skill、工具、命令和 hooks
  roles.ts        角色目录、frontmatter 与 skill 渲染、关键词路由
  install.ts      写入角色文件、清单去重与 skill 文件
  tools.ts        注册 chars_roles 与 chars_delegate
  commands.ts     注册 /chars 与 /chars-roles
  hooks.ts        编排策略注入与只读守卫
  skill.ts        chars-roles skill 的元信息与路径
  types.ts        角色、权限和插件选项类型
scripts/
  verify-v2.ts    启动真实 opencode serve 做端到端验收
```

## License

MIT
