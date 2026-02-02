/**
 * Skill System Types
 *
 * Defines the core types for the skill execution system.
 */

import type { JSONContent } from "@tiptap/core";

/**
 * Skill category for organizing skills
 */
export type SkillCategory = "doc" | "kb" | "code" | "img";

/**
 * Skill definition for registration
 */
export type SkillDefinition = {
  name: string; // e.g., "doc-create"
  category: SkillCategory;
  command: string; // e.g., "/doc-create"
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description: string;
        enum?: string[];
        optional?: boolean;
      }
    >;
    required: string[];
  };
};

/**
 * Parsed skill intent from user message
 */
export type SkillIntent = {
  skill: string; // Skill name, e.g., "doc-create"
  command: string; // Original command, e.g., "/doc-create"
  args: Record<string, unknown>; // Parsed arguments
  rawMessage: string; // Original user message
  docIds?: string[]; // Referenced document IDs from @ mentions
};

/**
 * Skill execution result
 */
export type SkillResult =
  | { type: "text"; content: string }
  | { type: "draft"; draft: DocumentDraft }
  | { type: "error"; message: string };

/**
 * Document draft for pending changes
 */
export type DocumentDraft = {
  id: string;
  projectKey: string;
  docId: string | null; // null = new document
  parentId: string | null; // Parent document ID for new docs
  title: string;
  originalContent: JSONContent | null; // null for new documents
  proposedContent: JSONContent;
  status: "pending" | "applied" | "rejected";
  createdAt: number;
  expiresAt: number;
};

/**
 * Input for creating a draft
 */
export type CreateDraftInput = {
  projectKey: string;
  docId?: string | null;
  parentId?: string | null;
  title: string;
  originalContent?: JSONContent | null;
  proposedContent: JSONContent;
};

/**
 * Chat stream chunk types extended for skills
 */
export type SkillStreamChunk =
  | { type: "delta"; content: string }
  | { type: "thinking"; content: string }
  | { type: "draft"; draft: DocumentDraft }
  | { type: "done"; message?: string }
  | { type: "error"; error: string };

/**
 * Skill configuration (database storage)
 */
export type SkillConfig = {
  id: string;
  skillName: string;
  category: SkillCategory;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Complete skill info (definition + config)
 */
export type SkillInfo = SkillDefinition & {
  config: SkillConfig;
};

/**
 * Skill category metadata
 */
export type SkillCategoryMeta = {
  id: SkillCategory;
  name: string;
  description: string;
  icon: string;
};

/**
 * Skill category info with skills
 */
export type SkillCategoryInfo = SkillCategoryMeta & {
  skills: SkillInfo[];
};
