export declare const CHARS_SKILL_ID = "chars-roles";
export declare function skillPath(directory: string): string;
export declare function skillInfo(directory: string): {
    id: string;
    name: string;
    description: string;
    autoinvoke: boolean;
    path: string;
    content: string;
};
