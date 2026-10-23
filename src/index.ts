import type { Plugin as PluginModule } from "@opencode/plugin";
import { registerCommands } from "./commands";
import { registerHooks } from "./hooks";
import { installRoles, installSkillFile } from "./install";
import { skillInfo } from "./skill";
import { registerTools } from "./tools";
import type { CharsOptions } from "./types";

const plugin: PluginModule.Plugin = {
  id: "chars",
  async setup(ctx) {
    const options = (ctx.options ?? {}) as CharsOptions;
    const cleanups: Array<() => Promise<void> | void> = [];

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
      editor.add(skillInfo(ctx.location.directory) as Parameters<typeof editor.add>[0]);
    });
    cleanups.push(() => skill.dispose());

    const tools = await registerTools(ctx, { options });
    cleanups.push(tools.dispose);

    const commands = await registerCommands(ctx);
    cleanups.push(commands.dispose);

    const hooks = await registerHooks(ctx, { options });
    cleanups.push(hooks.dispose);

    return async () => {
      for (const cleanup of cleanups.reverse()) await cleanup();
    };
  },
};

export default plugin;
