/**
 * Skill Registry
 *
 * Central registry for all skills. Provides unified access to skill definitions
 * and conversion to OpenAI Function Calling format.
 */

import type { SkillDefinition, SkillCategory } from "./types.js";
import { documentSkills } from "./document-skills.js";

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
 * Skill Registry class
 *
 * Manages registration and lookup of all skills.
 */
class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();
  private commandToSkill = new Map<string, string>();

  constructor() {
    // Register all built-in skills
    this.registerBatch(documentSkills);
  }

  /**
   * Register a single skill
   */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);
    this.commandToSkill.set(skill.command, skill.name);
  }

  /**
   * Register multiple skills
   */
  registerBatch(skills: SkillDefinition[]): void {
    skills.forEach((s) => this.register(s));
  }

  /**
   * Get skill by command (e.g., "/doc-create")
   * Used for strong determinism path
   */
  getByCommand(command: string): SkillDefinition | undefined {
    const name = this.commandToSkill.get(command);
    return name ? this.skills.get(name) : undefined;
  }

  /**
   * Get skill by name (e.g., "doc-create")
   */
  getByName(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * Get all skills in a category
   */
  getByCategory(category: SkillCategory): SkillDefinition[] {
    return this.getAll().filter((s) => s.category === category);
  }

  /**
   * Get all registered skills
   */
  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get all skill names
   */
  getAllNames(): string[] {
    return Array.from(this.skills.keys());
  }

  /**
   * Convert skills to OpenAI Function Calling format
   *
   * @param enabledSkills - Optional list of skill names to include. If not provided, includes all.
   * @returns Array of OpenAI tool definitions
   */
  toOpenAITools(enabledSkills?: string[]): OpenAITool[] {
    const tools: OpenAITool[] = [];

    for (const [name, skill] of this.skills) {
      // Filter by enabled list if provided
      if (enabledSkills && !enabledSkills.includes(name)) {
        continue;
      }

      tools.push(this.skillToOpenAITool(skill));
    }

    return tools;
  }

  /**
   * Convert a single skill definition to OpenAI tool format
   */
  private skillToOpenAITool(skill: SkillDefinition): OpenAITool {
    return {
      type: "function",
      function: {
        name: skill.name,
        description: skill.description,
        parameters: {
          type: "object",
          properties: this.convertProperties(skill.parameters.properties),
          required: skill.parameters.required,
        },
      },
    };
  }

  /**
   * Convert skill parameter properties to OpenAI format
   */
  private convertProperties(
    props: SkillDefinition["parameters"]["properties"],
  ): OpenAITool["function"]["parameters"]["properties"] {
    const result: OpenAITool["function"]["parameters"]["properties"] = {};

    for (const [key, value] of Object.entries(props)) {
      result[key] = {
        type: value.type,
        description: value.description,
        ...(value.enum ? { enum: value.enum } : {}),
      };
    }

    return result;
  }

  /**
   * Check if a command exists
   */
  hasCommand(command: string): boolean {
    return this.commandToSkill.has(command);
  }

  /**
   * Check if a skill name exists
   */
  hasSkill(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * Get all available commands
   */
  getAllCommands(): string[] {
    return Array.from(this.commandToSkill.keys());
  }
}

/**
 * Singleton instance of the skill registry
 */
export const skillRegistry = new SkillRegistry();
