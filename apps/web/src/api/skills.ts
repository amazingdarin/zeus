/**
 * Skills API Client
 *
 * API client for managing AI skill configurations.
 */

import { apiFetch } from "../config/api";

/**
 * Skill configuration (from database)
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
 * Skill definition
 */
export type SkillDefinition = {
  name: string;
  category: string;
  command: string;
  description: string;
  required: boolean; // Whether this skill is required (cannot be disabled)
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
};

/**
 * Complete skill info (definition + config)
 */
export type SkillInfo = SkillDefinition & {
  config: SkillConfig;
  isConfigurable: boolean; // Whether the skill can be enabled/disabled (!required)
};

/**
 * Skill category info with skills
 */
export type SkillCategoryInfo = {
  id: string;
  name: string;
  description: string;
  icon: string;
  skills: SkillInfo[];
};

/**
 * List all skills grouped by category
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
 * Get enabled skill commands
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
 * Update skill enabled status
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
 * Batch update skill enabled status
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
