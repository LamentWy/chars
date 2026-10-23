import { join } from "node:path";
import { renderSkillContent } from "./roles";

export const CHARS_SKILL_ID = "chars-roles";

export function skillPath(directory: string): string {
  return join(directory, ".opencode", "skills", CHARS_SKILL_ID, "SKILL.md");
}

export function skillInfo(directory: string) {
  return {
    id: CHARS_SKILL_ID,
    name: "Chars Roles",
    description:
      "Multi-agent role division for chars: route planning, implementation, debugging, review, research, and documentation to the matching specialist agent.",
    autoinvoke: true,
    path: skillPath(directory),
    content: renderSkillContent(),
  };
}
