/**
 * Slash Commands
 *
 * Defines available slash commands for the chat panel.
 */

import type { ReactNode } from "react";

export type SlashCommand = {
  command: string;
  name: string;
  description: string;
  category: "doc" | "kb" | "system";
  icon?: string;
  requiresDocScope?: boolean; // Whether the command requires @ document reference
};

/**
 * Document-related commands
 */
export const documentCommands: SlashCommand[] = [
  {
    command: "/doc-create",
    name: "创建文档",
    description: "创建新文档。使用方法：/doc-create [文档标题]",
    category: "doc",
    icon: "📄",
    requiresDocScope: false,
  },
  {
    command: "/doc-edit",
    name: "编辑文档",
    description: "编辑已有文档。需要先用 @ 指定文档",
    category: "doc",
    icon: "✏️",
    requiresDocScope: true,
  },
  {
    command: "/doc-read",
    name: "读取文档",
    description: "读取文档内容。需要先用 @ 指定文档",
    category: "doc",
    icon: "👁️",
    requiresDocScope: true,
  },
];

/**
 * All available commands
 */
export const allCommands: SlashCommand[] = [
  ...documentCommands,
];

/**
 * Get command by name
 */
export function getCommand(command: string): SlashCommand | undefined {
  return allCommands.find((c) => c.command === command);
}

/**
 * Filter commands by query
 */
export function filterCommands(query: string): SlashCommand[] {
  const lowerQuery = query.toLowerCase();
  return allCommands.filter(
    (c) =>
      c.command.toLowerCase().includes(lowerQuery) ||
      c.name.toLowerCase().includes(lowerQuery),
  );
}

/**
 * Check if a command requires document scope
 */
export function commandRequiresDocScope(command: string): boolean {
  const cmd = getCommand(command);
  return cmd?.requiresDocScope ?? false;
}
