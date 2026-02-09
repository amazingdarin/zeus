/**
 * Skills Module
 *
 * Exports all skill-related types and utilities.
 * 
 * Supports two types of skills:
 * 1. Native skills (SkillDefinition) - Zeus 内置技能
 * 2. Anthropic skills (UnifiedSkillDefinition) - Anthropic Agent Skills 格式
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
  RiskLevel,
  SkillConfirmation,
  PendingToolCall,
  OrganizePlan,
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
  docOptimizePptSkill,
  docMoveSkill,
  docDeleteSkill,
  kbSearchSkill,
  docFetchUrlSkill,
  docImportGitSkill,
  docConvertSkill,
  docOrganizeSkill,
} from "./document-skills.js";

// Spec loader
export {
  loadDocumentSpec,
  clearSpecCache,
  buildCreateDocumentPrompt,
  buildEditDocumentPrompt,
  buildPptOptimizeDocumentPrompt,
} from "./spec-loader.js";

// Skill executor
export {
  detectSkillIntent,
  executeSkillWithStream,
  executeAnthropicSkillWithStream,
  hasSkillTrigger,
  getAvailableSkillCommands,
} from "./executor.js";

// Skill config store
export { syncAnthropicSkillConfigs } from "./skill-config-store.js";

// Validator
export {
  validateTiptapContent,
  fixCommonIssues,
  ensureBlockIds,
  type ValidationResult,
} from "./validator.js";

// Skill registry (Tool-Augmented LLM)
export {
  skillRegistry,
  type OpenAITool,
  type SkillMatchInfo,
  type AnySkill,
} from "./registry.js";

// Hybrid trigger (Tool-Augmented LLM)
export {
  analyzeTrigger,
  extractDocIdsFromArgs,
  type TriggerMode,
  type TriggerResult,
} from "./trigger.js";

// ============================================================================
// Anthropic Agent Skills Support
// ============================================================================

// Adapters
export type {
  AnthropicSkillMetadata,
  AnthropicSkill,
  SkillResource,
  SkillResourceType,
  UnifiedSkillDefinition,
  SkillTriggers,
  SkillParameters,
  SkillExecution,
  SkillAdapter,
  DiscoveryConfig,
  ScriptResult,
  ScriptConfig,
  LoadedResource,
} from "./adapters/types.js";

export {
  parseSkillMd,
  extractTriggerPatterns,
  extractKeywords,
  inferCategory,
} from "./adapters/skill-md-parser.js";

export { anthropicAdapter } from "./adapters/anthropic-adapter.js";

// Discovery
export { skillScanner, FilesystemSkillScanner } from "./discovery/filesystem-scanner.js";

// Resources
export { resourceLoader, ResourceLoader } from "./resources/resource-loader.js";
export { scriptExecutor, ScriptExecutor } from "./resources/script-executor.js";
