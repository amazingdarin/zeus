/**
 * Skill Configuration Store
 *
 * Manages persistence of skill enable/disable states in PostgreSQL.
 */

import { v4 as uuidv4 } from "uuid";
import { query } from "../../db/postgres.js";
import { documentSkills } from "./document-skills.js";
import type {
  SkillConfig,
  SkillDefinition,
  SkillInfo,
  SkillCategoryInfo,
  SkillCategory,
  SkillCategoryMeta,
} from "./types.js";

/**
 * Database row type for skill_config table
 */
type SkillConfigRow = {
  id: string;
  skill_name: string;
  category: string;
  enabled: boolean;
  priority: number;
  created_at: Date;
  updated_at: Date;
};

/**
 * Category metadata
 */
const CATEGORY_META: Record<SkillCategory, Omit<SkillCategoryMeta, "id">> = {
  doc: { name: "文档", description: "文档创建、编辑、读取等操作", icon: "📄" },
  kb: { name: "知识库", description: "知识库检索与问答", icon: "🔍" },
  code: { name: "代码", description: "代码生成与分析", icon: "💻" },
  img: { name: "图像", description: "图像生成与处理", icon: "🖼️" },
};

/**
 * All registered skill definitions
 */
const allSkillDefinitions: SkillDefinition[] = [
  ...documentSkills,
  // Future: add other category skills here
];

/**
 * Map database row to SkillConfig
 */
function mapRowToConfig(row: SkillConfigRow): SkillConfig {
  return {
    id: row.id,
    skillName: row.skill_name,
    category: row.category as SkillCategory,
    enabled: row.enabled,
    priority: row.priority,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Create a default config for a skill definition
 */
function createDefaultConfig(def: SkillDefinition): SkillConfig {
  return {
    id: "",
    skillName: def.name,
    category: def.category,
    enabled: true,
    priority: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Get category for a skill name
 */
function getCategoryForSkill(skillName: string): SkillCategory {
  const def = allSkillDefinitions.find((d) => d.name === skillName);
  return def?.category || "doc";
}

/** Track if database is available */
let dbAvailable = true;

export const skillConfigStore = {
  /**
   * Check if database is available
   */
  isDbAvailable(): boolean {
    return dbAvailable;
  },

  /**
   * Get all skill configurations
   */
  async list(): Promise<SkillConfig[]> {
    try {
      const result = await query<SkillConfigRow>(
        `SELECT * FROM skill_config ORDER BY category, priority ASC`,
      );
      dbAvailable = true;
      return result.rows.map(mapRowToConfig);
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err.code === "ECONNREFUSED" || err.code === "42P01")
      ) {
        // ECONNREFUSED = connection refused, 42P01 = relation does not exist
        if (err.code === "42P01") {
          console.warn("skill_config table does not exist, returning empty list (all skills enabled by default)");
        } else {
          dbAvailable = false;
          console.warn("Database not available, returning empty skill config list");
        }
        return [];
      }
      throw err;
    }
  },

  /**
   * Get enabled skill configurations
   */
  async listEnabled(): Promise<SkillConfig[]> {
    try {
      const result = await query<SkillConfigRow>(
        `SELECT * FROM skill_config WHERE enabled = true ORDER BY category, priority ASC`,
      );
      dbAvailable = true;
      return result.rows.map(mapRowToConfig);
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err.code === "ECONNREFUSED" || err.code === "42P01")
      ) {
        if (err.code !== "42P01") {
          dbAvailable = false;
        }
        return [];
      }
      throw err;
    }
  },

  /**
   * Get names of enabled skills
   * Returns all skill names if database is not available (default to all enabled)
   */
  async getEnabledSkillNames(): Promise<string[]> {
    try {
      // Get all skill info which includes both definitions and configs
      const skillInfos = await this.listSkillInfo();
      // Filter to enabled skills and return their names
      return skillInfos.filter((s) => s.config.enabled).map((s) => s.name);
    } catch {
      // If error, return all skill names (default to all enabled)
      return allSkillDefinitions.map((d) => d.name);
    }
  },

  /**
   * Get complete skill info (definition + config)
   */
  async listSkillInfo(): Promise<SkillInfo[]> {
    const configs = await this.list();
    const configMap = new Map(configs.map((c) => [c.skillName, c]));

    return allSkillDefinitions.map((def) => {
      const config = configMap.get(def.name) || createDefaultConfig(def);
      // Required skills are always enabled
      if (def.required) {
        config.enabled = true;
      }
      return {
        ...def,
        config,
        isConfigurable: !def.required,
      };
    });
  },

  /**
   * Get skills grouped by category
   */
  async listByCategory(): Promise<SkillCategoryInfo[]> {
    const skills = await this.listSkillInfo();
    const categories: SkillCategoryInfo[] = [];

    for (const [categoryId, meta] of Object.entries(CATEGORY_META)) {
      const categorySkills = skills.filter((s) => s.category === categoryId);
      // Only include categories that have skills defined
      if (categorySkills.length > 0) {
        categories.push({
          id: categoryId as SkillCategory,
          ...meta,
          skills: categorySkills,
        });
      }
    }

    return categories;
  },

  /**
   * Update skill enabled status
   */
  async updateEnabled(skillName: string, enabled: boolean): Promise<SkillConfig> {
    // Check if skill is required (cannot be disabled)
    const def = allSkillDefinitions.find((d) => d.name === skillName);
    if (def?.required) {
      throw new Error(`Cannot modify required skill: ${skillName}`);
    }

    const category = getCategoryForSkill(skillName);
    const id = uuidv4();

    try {
      await query(
        `INSERT INTO skill_config (id, skill_name, category, enabled, priority, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (skill_name) DO UPDATE SET enabled = $4, updated_at = NOW()`,
        [id, skillName, category, enabled, 0],
      );
      dbAvailable = true;

      const result = await query<SkillConfigRow>(
        `SELECT * FROM skill_config WHERE skill_name = $1`,
        [skillName],
      );

      if (result.rows.length === 0) {
        throw new Error(`Failed to update skill config for: ${skillName}`);
      }

      return mapRowToConfig(result.rows[0]);
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err.code === "ECONNREFUSED" || err.code === "42P01")
      ) {
        if (err.code === "42P01") {
          throw new Error("skill_config table does not exist. Please run database migrations.");
        }
        dbAvailable = false;
        throw new Error("Database not available. Please ensure PostgreSQL is running.");
      }
      throw err;
    }
  },

  /**
   * Batch update enabled status
   * Note: Required skills are silently skipped (not updated)
   */
  async batchUpdateEnabled(
    updates: { skillName: string; enabled: boolean }[],
  ): Promise<void> {
    for (const update of updates) {
      // Skip required skills
      const def = allSkillDefinitions.find((d) => d.name === update.skillName);
      if (def?.required) {
        continue;
      }
      await this.updateEnabled(update.skillName, update.enabled);
    }
  },

  /**
   * Get enabled skill definitions (for LLM context)
   */
  async getEnabledSkillDefinitions(): Promise<SkillDefinition[]> {
    const configs = await this.list();
    const configMap = new Map(configs.map((c) => [c.skillName, c]));

    // If no configs in database, all skills are enabled by default
    if (configs.length === 0) {
      return allSkillDefinitions;
    }

    return allSkillDefinitions.filter((def) => {
      // Required skills are always enabled
      if (def.required) {
        return true;
      }
      const config = configMap.get(def.name);
      // If no config exists, default to enabled
      return config ? config.enabled : true;
    });
  },

  /**
   * Get enabled skill commands (for frontend filtering)
   */
  async getEnabledCommands(): Promise<string[]> {
    const enabledSkills = await this.getEnabledSkillDefinitions();
    return enabledSkills.map((s) => s.command);
  },

  /**
   * Check if a skill is enabled
   */
  async isEnabled(skillName: string): Promise<boolean> {
    // Required skills are always enabled
    const def = allSkillDefinitions.find((d) => d.name === skillName);
    if (def?.required) {
      return true;
    }

    try {
      const result = await query<SkillConfigRow>(
        `SELECT enabled FROM skill_config WHERE skill_name = $1`,
        [skillName],
      );
      dbAvailable = true;

      // If no config exists, default to enabled
      if (result.rows.length === 0) {
        return true;
      }

      return result.rows[0].enabled;
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err.code === "ECONNREFUSED" || err.code === "42P01")
      ) {
        if (err.code !== "42P01") {
          dbAvailable = false;
        }
        // Default to enabled when database is unavailable or table doesn't exist
        return true;
      }
      throw err;
    }
  },

  /**
   * Get all skill definitions (for registration)
   */
  getAllSkillDefinitions(): SkillDefinition[] {
    return allSkillDefinitions;
  },

  /**
   * Get category metadata
   */
  getCategoryMeta(): Record<SkillCategory, Omit<SkillCategoryMeta, "id">> {
    return CATEGORY_META;
  },
};
