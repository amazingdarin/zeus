/**
 * Skills API Client
 *
 * API client for managing AI skill configurations.
 */

import { apiFetch, encodeProjectRef } from "../config/api";

/**
 * Legacy skill configuration (global)
 */
export type SkillConfig = {
  id: string;
  skillName: string;
  category: string;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Legacy skill definition
 */
export type SkillDefinition = {
  name: string;
  category: string;
  command: string;
  description: string;
  required: boolean;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
};

/**
 * Legacy skill info
 */
export type SkillInfo = SkillDefinition & {
  config: SkillConfig;
  isConfigurable: boolean;
};

export type SkillCategoryInfo = {
  id: string;
  name: string;
  description: string;
  icon: string;
  skills: SkillInfo[];
};

/**
 * Project-scoped skill models (System Agent)
 */
export type ProjectSkillItem = {
  id: string;
  toolName: string;
  name: string;
  description: string;
  source: "native" | "anthropic" | "mcp" | "plugin";
  enabled: boolean;
  priority: number;
  riskLevel: "low" | "medium" | "high";
  requireConfirmation: boolean;
  isConfigurable: boolean;
  command?: string;
  requiresDocScope?: boolean;
};

export type ProjectSkillCategoryInfo = {
  id: string;
  name: string;
  description: string;
  icon: string;
  skills: ProjectSkillItem[];
};

export type ProjectEnabledCommand = {
  skillId: string;
  command: string;
  name: string;
  description: string;
  category: string;
  source: "native" | "anthropic" | "mcp" | "plugin";
  requiresDocScope: boolean;
};

/**
 * Legacy API (kept for compatibility)
 */
export async function listSkills(): Promise<{ categories: SkillCategoryInfo[] }> {
  const response = await apiFetch("/api/skills");
  if (!response.ok) {
    throw new Error("Failed to fetch skills");
  }
  const result = await response.json();
  return result.data;
}

/**
 * Legacy API (kept for compatibility)
 */
export async function getEnabledCommands(): Promise<{ commands: string[] }> {
  const response = await apiFetch("/api/skills/enabled-commands");
  if (!response.ok) {
    throw new Error("Failed to fetch enabled commands");
  }
  const result = await response.json();
  return result.data;
}

/**
 * Legacy API (kept for compatibility)
 */
export async function updateSkillEnabled(
  skillName: string,
  enabled: boolean,
): Promise<SkillConfig> {
  const response = await apiFetch(`/api/skills/${encodeURIComponent(skillName)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error("Failed to update skill");
  }
  const result = await response.json();
  return result.data;
}

/**
 * Legacy API (kept for compatibility)
 */
export async function batchUpdateSkillEnabled(
  updates: Array<{ skillName: string; enabled: boolean }>,
): Promise<void> {
  const response = await apiFetch("/api/skills", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });
  if (!response.ok) {
    throw new Error("Failed to batch update skills");
  }
}

/**
 * Project-scoped skills list
 */
export async function listProjectSkills(
  projectKey: string,
): Promise<{ categories: ProjectSkillCategoryInfo[] }> {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/skills`,
  );
  if (!response.ok) {
    throw new Error("Failed to fetch project skills");
  }
  const result = await response.json();
  return result.data;
}

/**
 * Update one project skill enabled status
 */
export async function updateProjectSkillEnabled(
  projectKey: string,
  skillId: string,
  enabled: boolean,
): Promise<void> {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/skills/${encodeURIComponent(skillId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
  if (!response.ok) {
    throw new Error("Failed to update project skill");
  }
}

/**
 * Batch update project skills enabled status
 */
export async function batchUpdateProjectSkillEnabled(
  projectKey: string,
  updates: Array<{ skillId: string; enabled: boolean }>,
): Promise<void> {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/skills`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    },
  );
  if (!response.ok) {
    throw new Error("Failed to batch update project skills");
  }
}

/**
 * Get enabled slash commands for a project.
 * Falls back to legacy enabled-commands API when project endpoint is unavailable.
 */
export async function getProjectEnabledCommands(
  projectKey: string,
): Promise<{ commands: ProjectEnabledCommand[] }> {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/skills/enabled-commands`,
  );
  if (!response.ok) {
    throw new Error("Failed to fetch project enabled commands");
  }

  const result = await response.json();
  const commands = Array.isArray(result?.data?.commands)
    ? result.data.commands.map((item: Record<string, unknown>) => ({
      skillId: String(item.skill_id || ""),
      command: String(item.command || ""),
      name: String(item.name || item.command || ""),
      description: String(item.description || ""),
      category: String(item.category || "system"),
      source: (item.source as "native" | "anthropic" | "mcp" | "plugin") || "native",
      requiresDocScope: Boolean(item.requires_doc_scope),
    }))
    : [];
  return { commands };
}
