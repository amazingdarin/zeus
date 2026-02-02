/**
 * Skills Module
 *
 * Exports all skill-related types and utilities.
 */

// Types
export type {
  SkillCategory,
  SkillDefinition,
  SkillIntent,
  SkillResult,
  DocumentDraft,
  CreateDraftInput,
  SkillStreamChunk,
} from "./types.js";

// Document skills
export {
  documentSkills,
  documentSkillMap,
  getDocumentSkill,
  getDocumentSkillByCommand,
  docReadSkill,
  docCreateSkill,
  docEditSkill,
} from "./document-skills.js";

// Spec loader
export {
  loadDocumentSpec,
  clearSpecCache,
  buildCreateDocumentPrompt,
  buildEditDocumentPrompt,
} from "./spec-loader.js";

// Skill executor
export {
  detectSkillIntent,
  executeSkillWithStream,
  hasSkillTrigger,
  getAvailableSkillCommands,
} from "./executor.js";

// Validator
export {
  validateTiptapContent,
  fixCommonIssues,
  ensureBlockIds,
  type ValidationResult,
} from "./validator.js";

// Skill registry (Tool-Augmented LLM)
export { skillRegistry, type OpenAITool } from "./registry.js";

// Hybrid trigger (Tool-Augmented LLM)
export {
  analyzeTrigger,
  extractDocIdsFromArgs,
  type TriggerMode,
  type TriggerResult,
} from "./trigger.js";
