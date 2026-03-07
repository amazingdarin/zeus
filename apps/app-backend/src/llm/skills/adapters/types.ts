/**
 * Anthropic Agent Skills Adapter Types
 *
 * 统一类型定义，支持多种技能格式的适配
 * 参考: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
 */

import type { AnyZodObject } from "../../zod.js";

/**
 * Anthropic Agent Skills YAML Frontmatter
 * 
 * 必需字段:
 * - name: 最大64字符，小写字母+数字+连字符
 * - description: 最大1024字符，描述功能和触发条件
 */
export type AnthropicSkillMetadata = {
  name: string;
  description: string;
  version?: string;
  author?: string;
};

/**
 * Anthropic Skill 完整结构
 */
export type AnthropicSkill = {
  metadata: AnthropicSkillMetadata;
  instructions: string;   // SKILL.md body (Markdown)
  resources: SkillResource[];
  basePath: string;       // 技能目录路径
};

/**
 * 技能资源文件类型
 */
export type SkillResourceType = "instruction" | "script" | "template" | "data";

/**
 * 技能资源文件
 */
export type SkillResource = {
  type: SkillResourceType;
  path: string;           // 相对于技能目录的路径
  name: string;           // 文件名
  loaded?: boolean;       // 是否已加载到上下文
  content?: string;       // 加载后的内容
};

/**
 * 技能来源类型
 */
export type SkillSource = "native" | "anthropic" | "openai";

/**
 * 技能执行类型
 */
export type SkillExecutionType = "native" | "llm-guided" | "script";

/**
 * 统一技能定义 (内部格式)
 * 
 * 将不同来源的技能转换为统一格式进行管理
 */
export type UnifiedSkillDefinition = {
  // === 基础信息 ===
  id: string;                           // 唯一标识
  name: string;                         // 显示名称
  description: string;                  // 描述
  
  // === 来源信息 ===
  source: SkillSource;
  sourcePath?: string;                  // 文件路径 (anthropic)
  
  // === 触发方式 ===
  triggers: SkillTriggers;
  
  // === 入参定义 ===
  // Anthropic skills usually have a small contract ("request", optional "context").
  // We keep this as Zod so it can be converted to tool schemas consistently.
  inputSchema?: AnyZodObject;
  
  // === 执行配置 ===
  execution: SkillExecution;
  
  // === 资源 ===
  resources?: SkillResource[];
  
  // === 元数据 ===
  category?: string;
  enabled: boolean;
  priority: number;
  loadedAt?: number;
  version?: string;
  author?: string;
};

/**
 * 技能触发配置
 */
export type SkillTriggers = {
  command?: string;                   // 斜杠命令 (native)
  patterns?: string[];                // 触发模式 (从 description 提取)
  keywords?: string[];                // 关键词
};

/**
 * 技能执行配置
 */
export type SkillExecution = {
  type: SkillExecutionType;
  handler?: string;                   // native: 函数名
  instructions?: string;              // llm-guided: Markdown 指令
  script?: string;                    // script: 脚本路径
  scriptInterpreter?: string;         // script: 解释器 (python3, bash, node)
};

/**
 * 验证结果
 */
export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * SKILL.md 解析结果
 */
export type ParseResult = {
  success: boolean;
  skill?: AnthropicSkill;
  errors: string[];
};

/**
 * 技能适配器接口
 */
export interface SkillAdapter {
  readonly sourceType: SkillSource;
  
  /**
   * 加载技能定义
   * @param source - 技能来源 (路径或对象)
   */
  load(source: string | object): Promise<UnifiedSkillDefinition>;
  
  /**
   * 验证技能定义
   */
  validate(skill: unknown): ValidationResult;
  
  /**
   * 转换为统一格式
   */
  normalize(skill: unknown): UnifiedSkillDefinition;
}

/**
 * 技能发现配置
 */
export type DiscoveryConfig = {
  /** 技能目录列表 */
  skillDirs: string[];
  /** 是否启用热重载 */
  watchEnabled: boolean;
  /** 扫描间隔 (毫秒) */
  scanInterval: number;
};

/**
 * 脚本执行结果
 */
export type ScriptResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
};

/**
 * 脚本执行配置
 */
export type ScriptConfig = {
  timeout: number;        // 超时时间 (毫秒)
  maxOutputSize: number;  // 最大输出大小 (字节)
  env?: Record<string, string>;
};

/**
 * 资源加载结果
 */
export type LoadedResource = SkillResource & {
  content: string;
  loaded: true;
};
