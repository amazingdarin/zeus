/**
 * Anthropic Agent Skills Adapter
 *
 * 负责:
 * 1. 从文件系统加载 SKILL.md 格式的技能
 * 2. 验证技能定义符合 Anthropic 规范
 * 3. 转换为统一内部格式
 *
 * 参考: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
 */

import { readFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  SkillAdapter,
  UnifiedSkillDefinition,
  ValidationResult,
  AnthropicSkill,
  SkillResource,
  SkillResourceType,
} from "./types.js";
import {
  parseSkillMd,
  extractTriggerPatterns,
  extractKeywords,
  inferCategory,
} from "./skill-md-parser.js";

/**
 * Anthropic Agent Skills 适配器
 */
export class AnthropicSkillAdapter implements SkillAdapter {
  readonly sourceType = "anthropic" as const;

  /**
   * 从目录加载技能
   *
   * @param skillDir - 技能目录路径
   * @returns 统一格式的技能定义
   */
  async load(skillDir: string): Promise<UnifiedSkillDefinition> {
    const skillMdPath = path.join(skillDir, "SKILL.md");

    // 1. 检查 SKILL.md 是否存在
    try {
      await access(skillMdPath);
    } catch {
      throw new Error(`SKILL.md not found in ${skillDir}`);
    }

    // 2. 读取 SKILL.md
    const content = await readFile(skillMdPath, "utf-8");

    // 3. 解析文件
    const parseResult = parseSkillMd(content, skillDir);
    if (!parseResult.success || !parseResult.skill) {
      throw new Error(
        `Failed to parse SKILL.md: ${parseResult.errors.join(", ")}`,
      );
    }

    // 4. 扫描目录中的其他资源
    const resources = await this.scanResources(
      skillDir,
      parseResult.skill.resources,
    );
    parseResult.skill.resources = resources;

    // 5. 转换为统一格式
    return this.normalize(parseResult.skill);
  }

  /**
   * 验证技能定义
   */
  validate(skill: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!skill || typeof skill !== "object") {
      return { valid: false, errors: ["Invalid skill object"], warnings: [] };
    }

    const s = skill as Partial<AnthropicSkill>;

    // 验证 metadata
    if (!s.metadata) {
      errors.push("Missing metadata");
    } else {
      if (!s.metadata.name) {
        errors.push("Missing name");
      } else {
        if (typeof s.metadata.name !== "string") {
          errors.push("name must be a string");
        } else if (s.metadata.name.length > 64) {
          errors.push("name exceeds 64 characters");
        } else if (!/^[a-z0-9-]+$/.test(s.metadata.name)) {
          errors.push(
            "name must contain only lowercase letters, numbers, and hyphens",
          );
        }
      }

      if (!s.metadata.description) {
        errors.push("Missing description");
      } else {
        if (typeof s.metadata.description !== "string") {
          errors.push("description must be a string");
        } else if (s.metadata.description.length > 1024) {
          errors.push("description exceeds 1024 characters");
        }
      }
    }

    // 验证 instructions
    if (!s.instructions || typeof s.instructions !== "string") {
      errors.push("Missing instructions");
    } else if (s.instructions.trim().length === 0) {
      warnings.push("Empty instructions body");
    } else if (s.instructions.length < 10) {
      warnings.push("Instructions are very short, consider adding more detail");
    }

    // 验证 basePath
    if (!s.basePath || typeof s.basePath !== "string") {
      errors.push("Missing basePath");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 转换为统一格式
   */
  normalize(skill: AnthropicSkill): UnifiedSkillDefinition {
    const { metadata, instructions, resources, basePath } = skill;

    // 从 description 提取触发模式
    const triggerPatterns = extractTriggerPatterns(metadata.description);

    // 提取关键词 (从 name 和 description)
    const keywords = extractKeywords(metadata.name, metadata.description);

    // 推断分类
    const category = inferCategory(metadata.name, metadata.description);

    return {
      // 基础信息
      id: `anthropic:${metadata.name}`,
      name: metadata.name,
      description: metadata.description,

      // 来源信息
      source: "anthropic",
      sourcePath: basePath,

      // 触发方式 (Anthropic Skills 基于自然语言触发)
      triggers: {
        patterns: triggerPatterns,
        keywords,
        // 不提供 command，因为 Anthropic Skills 不使用斜杠命令
      },

      // 入参定义 (tool-call 合约；真实解析仍由 LLM + skill instructions 决定)
      inputSchema: z.object({
        request: z.string().describe("The user's request to process with this skill"),
        context: z.string().describe("Additional context or data for the skill").optional(),
      }),

      // 执行配置
      execution: {
        type: "llm-guided",
        instructions,
      },

      // 资源
      resources,

      // 元数据
      category,
      enabled: true,
      priority: 50, // 默认优先级
      loadedAt: Date.now(),
      version: metadata.version,
      author: metadata.author,
    };
  }

  /**
   * 扫描目录中的资源文件
   *
   * 递归扫描技能目录，发现所有资源文件
   */
  private async scanResources(
    skillDir: string,
    referencedResources: SkillResource[],
  ): Promise<SkillResource[]> {
    const resources = [...referencedResources];
    const seen = new Set(referencedResources.map((r) => r.path));

    // 递归扫描目录
    const scan = async (dir: string, relativePath: string = "") => {
      try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = relativePath
            ? `${relativePath}/${entry.name}`
            : entry.name;

          // 跳过隐藏文件和目录
          if (entry.name.startsWith(".")) {
            continue;
          }

          if (entry.isDirectory()) {
            await scan(fullPath, relPath);
          } else if (entry.isFile()) {
            // 跳过 SKILL.md 和已经发现的资源
            if (entry.name !== "SKILL.md" && !seen.has(relPath)) {
              seen.add(relPath);
              resources.push(this.classifyResource(relPath));
            }
          }
        }
      } catch {
        // 目录不存在或无法访问，忽略
      }
    };

    await scan(skillDir);

    return resources;
  }

  /**
   * 分类资源文件
   */
  private classifyResource(filePath: string): SkillResource {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const name = path.basename(filePath);

    let type: SkillResourceType = "data";

    // 指令文件
    if (ext === "md") {
      type = "instruction";
    }
    // 脚本文件
    else if (["py", "sh", "bash", "js", "ts"].includes(ext)) {
      type = "script";
    }
    // 模板文件
    else if (
      ["html", "txt", "json", "yaml", "yml", "csv", "xml", "tmpl"].includes(ext)
    ) {
      type = "template";
    }

    return { type, path: filePath, name, loaded: false };
  }
}

/**
 * 导出单例实例
 */
export const anthropicAdapter = new AnthropicSkillAdapter();
