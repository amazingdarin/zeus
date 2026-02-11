import { v4 as uuidv4 } from "uuid";
import { query } from "../../db/postgres.js";
import { resolveProjectScope } from "../../project-scope.js";
import { zodObjectHasRequiredKey } from "../zod.js";
import type {
  AgentRiskLevel,
  AgentSkillDefinition,
  AgentSkillSource,
  ProjectSkillCategory,
  ProjectSkillConfig,
} from "./types.js";

type ProjectSkillConfigRow = {
  id: string;
  owner_type: string;
  owner_id: string;
  project_key: string;
  skill_id: string;
  source: AgentSkillSource;
  enabled: boolean;
  priority: number;
  risk_override: AgentRiskLevel | null;
  created_at: Date;
  updated_at: Date;
};

type LegacySkillConfigRow = {
  skill_name: string;
  enabled: boolean;
  priority: number;
};

type CategoryMeta = {
  name: string;
  description: string;
  icon: string;
};

const CATEGORY_META: Record<string, CategoryMeta> = {
  doc: { name: "文档", description: "文档创建、编辑、移动与导入", icon: "📄" },
  kb: { name: "知识库", description: "知识检索与问答", icon: "🔍" },
  code: { name: "代码", description: "代码分析与处理", icon: "💻" },
  img: { name: "图像", description: "图像相关处理", icon: "🖼️" },
  mcp: { name: "MCP", description: "第三方 MCP 工具技能", icon: "🧩" },
  plugin: { name: "插件", description: "插件扩展操作", icon: "🔌" },
  general: { name: "通用", description: "通用扩展技能", icon: "🔧" },
};

function mapRow(row: ProjectSkillConfigRow): ProjectSkillConfig {
  return {
    id: row.id,
    projectKey: row.project_key,
    skillId: row.skill_id,
    source: row.source,
    enabled: row.enabled,
    priority: row.priority,
    riskOverride: row.risk_override,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function isDbUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code || "") : "";
  return code === "ECONNREFUSED";
}

function isTableMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code || "") : "";
  return code === "42P01";
}

function getLegacySkillKey(skill: AgentSkillDefinition): string | null {
  const metadata = skill.metadata || {};
  if (typeof metadata.legacySkillName === "string" && metadata.legacySkillName.trim()) {
    return metadata.legacySkillName.trim();
  }
  if (skill.source === "anthropic") {
    return skill.id;
  }
  return null;
}

async function loadLegacyConfigMap(): Promise<Map<string, LegacySkillConfigRow>> {
  try {
    const result = await query<LegacySkillConfigRow>(
      "SELECT skill_name, enabled, priority FROM skill_config",
    );
    return new Map(result.rows.map((r) => [r.skill_name, r]));
  } catch {
    return new Map();
  }
}

function defaultConfigForSkill(
  ownerType: string,
  ownerId: string,
  projectKey: string,
  skill: AgentSkillDefinition,
  legacyMap: Map<string, LegacySkillConfigRow>,
): Omit<ProjectSkillConfigRow, "created_at" | "updated_at"> {
  const legacyKey = getLegacySkillKey(skill);
  const legacy = legacyKey ? legacyMap.get(legacyKey) : undefined;
  return {
    id: uuidv4(),
    owner_type: ownerType,
    owner_id: ownerId,
    project_key: projectKey,
    skill_id: skill.id,
    source: skill.source,
    enabled: legacy ? legacy.enabled : skill.enabledByDefault,
    priority: legacy ? legacy.priority : skill.priority,
    risk_override: null,
  };
}

export const projectSkillConfigStore = {
  async list(projectKey: string): Promise<ProjectSkillConfig[]> {
    const scope = resolveProjectScope("", projectKey);
    try {
      const result = await query<ProjectSkillConfigRow>(
        `SELECT * FROM project_skill_config
         WHERE owner_type = $1 AND owner_id = $2 AND project_key = $3
         ORDER BY priority ASC, skill_id ASC`,
        [scope.ownerType, scope.ownerId, scope.projectKey],
      );
      return result.rows.map(mapRow);
    } catch (err) {
      if (isTableMissing(err) || isDbUnavailable(err)) {
        return [];
      }
      throw err;
    }
  },

  async ensureSkillConfigs(projectKey: string, skills: AgentSkillDefinition[]): Promise<void> {
    if (skills.length === 0) return;

    const existing = await this.list(projectKey);
    const existingIds = new Set(existing.map((c) => c.skillId));
    const legacyMap = await loadLegacyConfigMap();

    for (const skill of skills) {
      if (existingIds.has(skill.id)) continue;
      const scope = resolveProjectScope("", projectKey);
      const seed = defaultConfigForSkill(scope.ownerType, scope.ownerId, scope.projectKey, skill, legacyMap);
      try {
        await query(
          `INSERT INTO project_skill_config
            (id, owner_type, owner_id, project_key, skill_id, source, enabled, priority, risk_override, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (owner_type, owner_id, project_key, skill_id) DO UPDATE
             SET source = EXCLUDED.source`,
          [
            seed.id,
            seed.owner_type,
            seed.owner_id,
            seed.project_key,
            seed.skill_id,
            seed.source,
            seed.enabled,
            seed.priority,
            seed.risk_override,
          ],
        );
      } catch (err) {
        if (isTableMissing(err) || isDbUnavailable(err)) {
          return;
        }
        throw err;
      }
    }
  },

  async getEnabledSkillIds(projectKey: string, skills: AgentSkillDefinition[]): Promise<string[]> {
    await this.ensureSkillConfigs(projectKey, skills);
    const configs = await this.list(projectKey);
    if (configs.length === 0) {
      return skills.filter((s) => s.enabledByDefault).map((s) => s.id);
    }

    const map = new Map<string, ProjectSkillConfig>(
      configs.map((c): [string, ProjectSkillConfig] => [c.skillId, c]),
    );
    return skills
      .filter((skill) => {
        const cfg = map.get(skill.id);
        return cfg ? cfg.enabled : skill.enabledByDefault;
      })
      .map((s) => s.id);
  },

  async getEnabledToolNames(projectKey: string, skills: AgentSkillDefinition[]): Promise<string[]> {
    const enabledIds = new Set(await this.getEnabledSkillIds(projectKey, skills));
    return skills.filter((s) => enabledIds.has(s.id)).map((s) => s.toolName);
  },

  async isEnabled(
    projectKey: string,
    skillId: string,
    defaultEnabled = true,
  ): Promise<boolean> {
    try {
      const scope = resolveProjectScope("", projectKey);
      const result = await query<{ enabled: boolean }>(
        `SELECT enabled FROM project_skill_config
         WHERE owner_type = $1 AND owner_id = $2 AND project_key = $3 AND skill_id = $4`,
        [scope.ownerType, scope.ownerId, scope.projectKey, skillId],
      );
      if (result.rows.length === 0) {
        return defaultEnabled;
      }
      return result.rows[0].enabled;
    } catch (err) {
      if (isTableMissing(err) || isDbUnavailable(err)) {
        return defaultEnabled;
      }
      throw err;
    }
  },

  async updateEnabled(
    projectKey: string,
    skill: AgentSkillDefinition,
    enabled: boolean,
  ): Promise<ProjectSkillConfig> {
    try {
      const scope = resolveProjectScope("", projectKey);
      await query(
        `INSERT INTO project_skill_config
          (id, owner_type, owner_id, project_key, skill_id, source, enabled, priority, risk_override, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (owner_type, owner_id, project_key, skill_id) DO UPDATE
           SET enabled = EXCLUDED.enabled, source = EXCLUDED.source, priority = EXCLUDED.priority, updated_at = NOW()`,
        [
          uuidv4(),
          scope.ownerType,
          scope.ownerId,
          scope.projectKey,
          skill.id,
          skill.source,
          enabled,
          skill.priority,
          null,
        ],
      );
      const result = await query<ProjectSkillConfigRow>(
        `SELECT * FROM project_skill_config
         WHERE owner_type = $1 AND owner_id = $2 AND project_key = $3 AND skill_id = $4`,
        [scope.ownerType, scope.ownerId, scope.projectKey, skill.id],
      );
      if (result.rows.length === 0) {
        throw new Error(`Failed to update skill config for ${skill.id}`);
      }
      return mapRow(result.rows[0]);
    } catch (err) {
      if (isTableMissing(err)) {
        throw new Error("project_skill_config table does not exist. Please run database migrations.");
      }
      if (isDbUnavailable(err)) {
        throw new Error("Database is not available.");
      }
      throw err;
    }
  },

  async batchUpdateEnabled(
    projectKey: string,
    skills: AgentSkillDefinition[],
    updates: Array<{ skillId: string; enabled: boolean }>,
  ): Promise<void> {
    const skillMap = new Map(skills.map((s) => [s.id, s]));
    for (const item of updates) {
      const skill = skillMap.get(item.skillId);
      if (!skill) continue;
      await this.updateEnabled(projectKey, skill, item.enabled);
    }
  },

  async listByCategory(
    projectKey: string,
    skills: AgentSkillDefinition[],
  ): Promise<ProjectSkillCategory[]> {
    await this.ensureSkillConfigs(projectKey, skills);
    const configs = await this.list(projectKey);
    const configMap = new Map<string, ProjectSkillConfig>(
      configs.map((c): [string, ProjectSkillConfig] => [c.skillId, c]),
    );
    const categories = new Map<string, ProjectSkillCategory>();

    for (const skill of skills) {
      const cfg = configMap.get(skill.id);
      const categoryId = skill.category || "general";
      if (!categories.has(categoryId)) {
        const meta = CATEGORY_META[categoryId] || CATEGORY_META.general;
        categories.set(categoryId, {
          id: categoryId,
          name: meta.name,
          description: meta.description,
          icon: meta.icon,
          skills: [],
        });
      }
      categories.get(categoryId)!.skills.push({
        id: skill.id,
        toolName: skill.toolName,
        name: skill.displayName,
        description: skill.description,
        source: skill.source,
        enabled: cfg ? cfg.enabled : skill.enabledByDefault,
        priority: cfg ? cfg.priority : skill.priority,
        riskLevel: (cfg?.riskOverride || skill.risk.level) as AgentRiskLevel,
        requireConfirmation: skill.risk.requireConfirmation,
        isConfigurable: true,
        command: skill.command,
        requiresDocScope:
          (skill.metadata && skill.metadata.requiresDocScope === true) ||
          zodObjectHasRequiredKey(skill.inputSchema, "doc_id"),
      });
    }

    return Array.from(categories.values()).map((cat) => ({
      ...cat,
      skills: cat.skills.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)),
    }));
  },

  async listSources(
    projectKey: string,
    skills: AgentSkillDefinition[],
  ): Promise<Array<{ source: AgentSkillSource; total: number; enabled: number }>> {
    const enabledIds = new Set(await this.getEnabledSkillIds(projectKey, skills));
    const stats = new Map<AgentSkillSource, { total: number; enabled: number }>();

    for (const skill of skills) {
      const current = stats.get(skill.source) || { total: 0, enabled: 0 };
      current.total += 1;
      if (enabledIds.has(skill.id)) current.enabled += 1;
      stats.set(skill.source, current);
    }

    return Array.from(stats.entries()).map(([source, value]) => ({
      source,
      total: value.total,
      enabled: value.enabled,
    }));
  },
};
