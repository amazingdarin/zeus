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
 * Risk level for skill confirmation
 */
export type RiskLevel = "low" | "medium" | "high";

/**
 * Confirmation configuration for skills
 */
export type SkillConfirmation = {
  required: boolean; // Whether confirmation is needed before execution
  riskLevel?: RiskLevel; // Risk level for UI display
  warningMessage?: string; // Custom warning message to show
};

/**
 * Skill definition for registration
 */
export type SkillDefinition = {
  name: string; // e.g., "doc-create"
  category: SkillCategory;
  command: string; // e.g., "/doc-create"
  description: string;
  required: boolean; // Whether this skill is required (cannot be disabled)
  confirmation?: SkillConfirmation; // Confirmation settings for dangerous operations
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
 * Pending tool call awaiting user confirmation
 */
export type PendingToolCall = {
  id: string; // Unique ID for this pending call
  skillName: string; // Name of the skill to execute
  skillDescription: string; // Human-readable description
  args: Record<string, unknown>; // Arguments for the skill
  riskLevel: RiskLevel; // Risk level for UI display
  warningMessage?: string; // Optional warning message
  createdAt: number; // Timestamp when created
  expiresAt: number; // Expiration timestamp (for cleanup)
};

/**
 * Skill execution result
 */
export type SkillResult =
  | { type: "text"; content: string }
  | { type: "draft"; draft: DocumentDraft }
  | { type: "error"; message: string };

export type DraftValidationPolicy = "protocol_only" | "additive_strict";

export type DraftValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type DraftValidation = {
  passed: boolean;
  attempt: number;
  policy: DraftValidationPolicy;
  issues: DraftValidationIssue[];
  feedback?: string;
};

/**
 * Document draft for pending changes
 */
export type DocumentDraft = {
  id: string;
  userId: string;
  projectKey: string;
  docId: string | null; // null = new document
  parentId: string | null; // Parent document ID for new docs
  title: string;
  originalContent: JSONContent | null; // null for new documents
  proposedContent: JSONContent;
  validation?: DraftValidation;
  status: "pending" | "applied" | "rejected";
  createdAt: number;
  expiresAt: number;
};

/**
 * Input for creating a draft
 */
export type CreateDraftInput = {
  userId: string;
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
  isConfigurable: boolean; // Whether the skill can be enabled/disabled (!required)
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
