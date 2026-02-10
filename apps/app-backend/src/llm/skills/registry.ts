/**
 * Skill Registry
 *
 * Central registry for all skills. Provides unified access to skill definitions
 * and conversion to OpenAI Function Calling format.
 *
 * Supports two types of skills:
 * 1. Native skills (SkillDefinition) - Zeus 内置技能
 * 2. Anthropic skills (UnifiedSkillDefinition) - Anthropic Agent Skills 格式
 */

import type { SkillDefinition, SkillCategory } from "./types.js";
import type { UnifiedSkillDefinition } from "./adapters/types.js";
import { documentSkills } from "./document-skills.js";
import { skillScanner } from "./discovery/filesystem-scanner.js";
import { resourceLoader } from "./resources/resource-loader.js";
import { z } from "zod";
import { zodObjectToOpenAIParameters } from "../zod.js";

/**
 * OpenAI Function Calling tool format
 */
export type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<
        string,
        {
          type: string;
          description: string;
          enum?: string[];
        }
      >;
      required: string[];
    };
  };
};

/**
 * 技能匹配信息 (用于 LLM 触发匹配)
 */
export type SkillMatchInfo = {
  id: string;
  name: string;
  description: string;
  source: "native" | "anthropic";
  triggers: {
    command?: string;
    patterns?: string[];
    keywords?: string[];
  };
};

/**
 * 任意技能类型
 */
export type AnySkill = SkillDefinition | UnifiedSkillDefinition;

/**
 * Skill Registry class
 *
 * Manages registration and lookup of all skills.
 * Supports both native and Anthropic skills.
 */
class SkillRegistry {
  private nativeSkills = new Map<string, SkillDefinition>();
  private anthropicSkills = new Map<string, UnifiedSkillDefinition>();
  private commandToSkill = new Map<string, string>();
  private initialized = false;

  constructor() {
    // Register all built-in native skills
    this.registerNativeBatch(documentSkills);
  }

  /**
   * Initialize the registry (start skill discovery)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 监听技能变更事件
    skillScanner.on("added", (skills: UnifiedSkillDefinition[]) => {
      skills.forEach((s) => this.registerAnthropicSkill(s));
      console.log(`[SkillRegistry] Added ${skills.length} Anthropic skills`);
    });

    skillScanner.on("removed", (ids: string[]) => {
      ids.forEach((id) => {
        const removed = this.anthropicSkills.get(id);
        if (removed?.triggers.command) {
          this.commandToSkill.delete(removed.triggers.command);
        }
        this.anthropicSkills.delete(id);
        resourceLoader.invalidateSkillCache(id);
      });
      console.log(`[SkillRegistry] Removed ${ids.length} Anthropic skills`);
    });

    skillScanner.on("updated", (skills: UnifiedSkillDefinition[]) => {
      skills.forEach((s) => {
        resourceLoader.invalidateSkillCache(s.id);
        this.registerAnthropicSkill(s);
      });
      console.log(`[SkillRegistry] Updated ${skills.length} Anthropic skills`);
    });

    // 启动扫描器
    await skillScanner.start();
    this.initialized = true;

    console.log(
      `[SkillRegistry] Initialized with ${this.nativeSkills.size} native skills and ${this.anthropicSkills.size} Anthropic skills`,
    );
  }

  // ============================================================================
  // Native Skills (Zeus 内置)
  // ============================================================================

  /**
   * Register a single native skill
   */
  registerNative(skill: SkillDefinition): void {
    this.nativeSkills.set(skill.name, skill);
    this.commandToSkill.set(skill.command, skill.name);
  }

  /**
   * Register multiple native skills
   */
  registerNativeBatch(skills: SkillDefinition[]): void {
    skills.forEach((s) => this.registerNative(s));
  }

  /**
   * Get native skill by command (e.g., "/doc-create")
   */
  getNativeByCommand(command: string): SkillDefinition | undefined {
    const name = this.commandToSkill.get(command);
    return name ? this.nativeSkills.get(name) : undefined;
  }

  /**
   * Get native skill by name
   */
  getNativeByName(name: string): SkillDefinition | undefined {
    return this.nativeSkills.get(name);
  }

  /**
   * Get all native skills
   */
  getAllNative(): SkillDefinition[] {
    return Array.from(this.nativeSkills.values());
  }

  // ============================================================================
  // Anthropic Skills (SKILL.md 格式)
  // ============================================================================

  /**
   * Register an Anthropic skill
   */
  registerAnthropicSkill(skill: UnifiedSkillDefinition): void {
    const existing = this.anthropicSkills.get(skill.id);
    if (existing?.triggers.command && existing.triggers.command !== skill.triggers.command) {
      this.commandToSkill.delete(existing.triggers.command);
    }

    this.anthropicSkills.set(skill.id, skill);

    // 如果有 command 触发器，也注册到命令映射
    if (skill.triggers.command) {
      this.commandToSkill.set(skill.triggers.command, skill.id);
    }
  }

  /**
   * Get Anthropic skill by ID
   */
  getAnthropicById(id: string): UnifiedSkillDefinition | undefined {
    return this.anthropicSkills.get(id);
  }

  /**
   * Get all Anthropic skills
   */
  getAllAnthropic(): UnifiedSkillDefinition[] {
    return Array.from(this.anthropicSkills.values());
  }

  // ============================================================================
  // Unified Access (两种格式统一访问)
  // ============================================================================

  /**
   * Get skill by command (searches both native and Anthropic)
   * @deprecated Use getNativeByCommand or getByCommand for clarity
   */
  getByCommand(command: string): AnySkill | undefined {
    return this.getAnyByCommand(command);
  }

  /**
   * Get skill by name (searches both native and Anthropic)
   * @deprecated Use getNativeByName or getAnthropicById for clarity
   */
  getByName(name: string): SkillDefinition | undefined {
    return this.nativeSkills.get(name);
  }

  /**
   * Get any skill by ID (searches both native and Anthropic)
   */
  getAnyById(id: string): AnySkill | undefined {
    // 先查原生技能
    const native = this.nativeSkills.get(id);
    if (native) return native;

    // 再查 Anthropic 技能
    return this.anthropicSkills.get(id);
  }

  /**
   * Get any skill by command (searches both)
   */
  getAnyByCommand(command: string): AnySkill | undefined {
    const id = this.commandToSkill.get(command);
    if (!id) return undefined;

    return this.nativeSkills.get(id) || this.anthropicSkills.get(id);
  }

  /**
   * Get all native skills in a category
   */
  getByCategory(category: SkillCategory): SkillDefinition[] {
    return this.getAllNative().filter((s) => s.category === category);
  }

  /**
   * Get all registered skills (native only for backward compatibility)
   */
  getAll(): SkillDefinition[] {
    return this.getAllNative();
  }

  /**
   * Get all skill names (native only for backward compatibility)
   */
  getAllNames(): string[] {
    return Array.from(this.nativeSkills.keys());
  }

  /**
   * Get all skills for matching (both native and Anthropic)
   */
  getAllForMatching(): SkillMatchInfo[] {
    const result: SkillMatchInfo[] = [];

    // Native skills
    for (const [name, skill] of this.nativeSkills) {
      result.push({
        id: name,
        name: skill.name,
        description: skill.description,
        source: "native",
        triggers: {
          command: skill.command,
          keywords: this.extractKeywordsFromDescription(skill.description),
        },
      });
    }

    // Anthropic skills
    for (const [id, skill] of this.anthropicSkills) {
      if (!skill.enabled) continue;

      result.push({
        id,
        name: skill.name,
        description: skill.description,
        source: "anthropic",
        triggers: skill.triggers,
      });
    }

    return result;
  }

  /**
   * Match skill by user message
   */
  matchByMessage(message: string): AnySkill | undefined {
    const lowerMessage = message.toLowerCase();

    // 1. 精确命令匹配 (最高优先级)
    const commandMatch = message.match(/^\/([a-z]+-[a-z]+)/);
    if (commandMatch) {
      const command = `/${commandMatch[1]}`;
      return this.getAnyByCommand(command);
    }

    // 2. Anthropic Skills 关键词匹配
    let bestMatch: UnifiedSkillDefinition | undefined;
    let bestScore = 0;

    for (const [, skill] of this.anthropicSkills) {
      if (!skill.enabled) continue;

      const keywords = skill.triggers.keywords || [];
      const matchCount = keywords.filter((kw) =>
        lowerMessage.includes(kw.toLowerCase()),
      ).length;

      if (matchCount > bestScore && matchCount >= 2) {
        bestScore = matchCount;
        bestMatch = skill;
      }
    }

    return bestMatch;
  }

  // ============================================================================
  // OpenAI Tools Conversion
  // ============================================================================

  /**
   * Convert skills to OpenAI Function Calling format
   *
   * @param enabledSkills - Optional list of skill names/IDs to include
   * @param includeAnthropic - Whether to include Anthropic skills (default: true)
   */
  toOpenAITools(
    enabledSkills?: string[],
    includeAnthropic = true,
  ): OpenAITool[] {
    const tools: OpenAITool[] = [];

    // Native skills
    for (const [name, skill] of this.nativeSkills) {
      if (enabledSkills && !enabledSkills.includes(name)) {
        continue;
      }
      tools.push(this.nativeSkillToOpenAITool(skill));
    }

    // Anthropic skills
    if (includeAnthropic) {
      for (const [id, skill] of this.anthropicSkills) {
        const hasExplicitEnabledFilter = Array.isArray(enabledSkills);
        if (hasExplicitEnabledFilter) {
          if (!enabledSkills.includes(id)) continue;
        } else if (!skill.enabled) {
          continue;
        }
        tools.push(this.anthropicSkillToOpenAITool(skill));
      }
    }

    return tools;
  }

  private nativeSkillToOpenAITool(skill: SkillDefinition): OpenAITool {
    return {
      type: "function",
      function: {
        name: skill.name,
        description: skill.description,
        parameters: zodObjectToOpenAIParameters(skill.inputSchema),
      },
    };
  }

  private anthropicSkillToOpenAITool(skill: UnifiedSkillDefinition): OpenAITool {
    return {
      type: "function",
      function: {
        name: skill.name,
        description: skill.description,
        parameters: zodObjectToOpenAIParameters(
          skill.inputSchema || z.object({
            request: z.string().describe("The user's request to process with this skill"),
            context: z.string().describe("Additional context or data for the skill").optional(),
          }),
        ),
      },
    };
  }

  private extractKeywordsFromDescription(description: string): string[] {
    return description
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 10);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Check if a command exists
   */
  hasCommand(command: string): boolean {
    return this.commandToSkill.has(command);
  }

  /**
   * Check if a skill name/ID exists
   */
  hasSkill(nameOrId: string): boolean {
    return this.nativeSkills.has(nameOrId) || this.anthropicSkills.has(nameOrId);
  }

  /**
   * Get all available commands
   */
  getAllCommands(): string[] {
    return Array.from(this.commandToSkill.keys());
  }

  /**
   * Get skill counts
   */
  getCounts(): { native: number; anthropic: number; total: number } {
    return {
      native: this.nativeSkills.size,
      anthropic: this.anthropicSkills.size,
      total: this.nativeSkills.size + this.anthropicSkills.size,
    };
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Singleton instance of the skill registry
 */
export const skillRegistry = new SkillRegistry();
