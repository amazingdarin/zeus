/**
 * Slash Commands
 *
 * Defines available slash commands for the chat panel.
 */

export type SlashCommand = {
  command: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  requiresDocScope?: boolean; // Whether the command requires @ document reference
};

/**
 * Document-related built-in commands
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
  {
    command: "/doc-optimize-format",
    name: "格式优化",
    description: "优化文档格式。可附加额外要求，需先用 @ 指定文档",
    category: "doc",
    icon: "📐",
    requiresDocScope: true,
  },
  {
    command: "/doc-optimize-content",
    name: "内容优化",
    description: "优化文档内容。可附加额外要求，需先用 @ 指定文档",
    category: "doc",
    icon: "✨",
    requiresDocScope: true,
  },
  {
    command: "/doc-optimize-style",
    name: "风格优化",
    description:
      "按风格优化文档（professional/concise/friendly/academic/technical/marketing），需先用 @ 指定文档",
    category: "doc",
    icon: "🎨",
    requiresDocScope: true,
  },
  {
    command: "/doc-optimize-full",
    name: "综合优化",
    description: "同时优化文档格式和内容，可附加额外要求，需先用 @ 指定文档",
    category: "doc",
    icon: "🧠",
    requiresDocScope: true,
  },
  {
    command: "/doc-summary",
    name: "生成摘要",
    description: "为文档或目录生成摘要。需要先用 @ 指定文档",
    category: "doc",
    icon: "📋",
    requiresDocScope: true,
  },
];

/**
 * All built-in commands
 */
export const allCommands: SlashCommand[] = [...documentCommands];

function iconForCategory(category: string): string {
  switch (category) {
    case "doc":
      return "📄";
    case "kb":
      return "🔍";
    case "mcp":
      return "🧩";
    default:
      return "⚙️";
  }
}

function normalizeCommand(command: SlashCommand): SlashCommand {
  return {
    command: command.command,
    name: command.name || command.command.replace(/^\//, ""),
    description: command.description || command.command,
    category: command.category || "system",
    icon: command.icon || iconForCategory(command.category || "system"),
    requiresDocScope: command.requiresDocScope ?? false,
  };
}

function buildCatalog(commands?: SlashCommand[]): Map<string, SlashCommand> {
  const map = new Map<string, SlashCommand>();
  for (const cmd of allCommands) {
    map.set(cmd.command, normalizeCommand(cmd));
  }
  for (const cmd of commands || []) {
    map.set(cmd.command, normalizeCommand(cmd));
  }
  return map;
}

let commandCatalog = buildCatalog();
let enabledCommandsSet: Set<string> = new Set(Array.from(commandCatalog.keys()));

/**
 * Merge server command metadata into local catalog.
 * Passing null/undefined resets catalog to built-ins.
 */
export function setCommandCatalog(commands?: SlashCommand[] | null): void {
  commandCatalog = buildCatalog(commands || undefined);
}

/**
 * Set enabled commands (called from useChatLogic on init/project change)
 */
export function setEnabledCommands(commands: string[]): void {
  enabledCommandsSet = new Set(commands);
}

/**
 * Get currently enabled commands
 */
export function getEnabledCommands(): string[] {
  return Array.from(enabledCommandsSet);
}

/**
 * Check if a command is enabled
 */
export function isCommandEnabled(command: string): boolean {
  return enabledCommandsSet.has(command);
}

/**
 * Get command by name
 */
export function getCommand(command: string): SlashCommand | undefined {
  return commandCatalog.get(command);
}

/**
 * Filter commands by query (only returns enabled commands)
 */
export function filterCommands(query: string): SlashCommand[] {
  const lowerQuery = query.toLowerCase();
  return Array.from(commandCatalog.values()).filter(
    (c) =>
      enabledCommandsSet.has(c.command) &&
      (c.command.toLowerCase().includes(lowerQuery) ||
        c.name.toLowerCase().includes(lowerQuery)),
  );
}

/**
 * Filter all commands by query (ignores enabled status)
 */
export function filterAllCommands(query: string): SlashCommand[] {
  const lowerQuery = query.toLowerCase();
  return Array.from(commandCatalog.values()).filter(
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
