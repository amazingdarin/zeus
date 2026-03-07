/**
 * SKILL.md Parser
 *
 * 解析 Anthropic Agent Skills 格式的 Markdown 文件
 * 参考: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
 *
 * 格式:
 * ---
 * name: skill-name
 * description: Skill description
 * ---
 * # Instructions...
 */

import { parse as parseYaml } from "yaml";
import type {
  AnthropicSkill,
  AnthropicSkillMetadata,
  SkillResource,
  SkillResourceType,
  ParseResult,
} from "./types.js";

/**
 * YAML Frontmatter 正则表达式
 * 匹配: ---\n{yaml}\n---\n{body}
 */
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * 保留字 (不允许在 name 中使用)
 */
const RESERVED_WORDS = ["anthropic", "claude"];

/**
 * 解析 SKILL.md 文件内容
 *
 * @param content - SKILL.md 文件内容
 * @param basePath - 技能目录路径
 * @returns 解析结果
 */
export function parseSkillMd(content: string, basePath: string): ParseResult {
  const errors: string[] = [];

  // 1. 分离 frontmatter 和 body
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return {
      success: false,
      errors: [
        "Invalid SKILL.md format: missing or malformed YAML frontmatter. " +
          "Expected format: ---\\nname: ...\\ndescription: ...\\n---\\n# Instructions",
      ],
    };
  }

  const [, frontmatterStr, body] = match;

  // 2. 解析 YAML frontmatter
  let metadata: AnthropicSkillMetadata;
  try {
    const parsed = parseYaml(frontmatterStr);
    if (!parsed || typeof parsed !== "object") {
      return {
        success: false,
        errors: ["Invalid YAML frontmatter: must be a valid YAML object"],
      };
    }
    metadata = parsed as AnthropicSkillMetadata;
  } catch (e) {
    return {
      success: false,
      errors: [`Invalid YAML frontmatter: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  // 3. 验证必需字段
  const validationErrors = validateMetadata(metadata);
  if (validationErrors.length > 0) {
    return { success: false, errors: validationErrors };
  }

  // 4. 提取资源引用
  const resources = extractResourceReferences(body.trim());

  return {
    success: true,
    skill: {
      metadata,
      instructions: body.trim(),
      resources,
      basePath,
    },
    errors: [],
  };
}

/**
 * 验证 metadata 字段
 *
 * 验证规则 (来自 Anthropic 文档):
 * - name: 必需，最大64字符，小写字母+数字+连字符，不能包含保留字
 * - description: 必需，最大1024字符
 */
function validateMetadata(metadata: AnthropicSkillMetadata): string[] {
  const errors: string[] = [];

  // name 验证
  if (!metadata.name || typeof metadata.name !== "string") {
    errors.push("Missing required field: name");
  } else {
    const name = metadata.name;

    if (name.length > 64) {
      errors.push(`name must be 64 characters or less (got ${name.length})`);
    }

    if (!/^[a-z0-9-]+$/.test(name)) {
      errors.push(
        "name must contain only lowercase letters, numbers, and hyphens",
      );
    }

    if (name.startsWith("-") || name.endsWith("-")) {
      errors.push("name cannot start or end with a hyphen");
    }

    for (const reserved of RESERVED_WORDS) {
      if (name.toLowerCase().includes(reserved)) {
        errors.push(`name cannot contain reserved word: ${reserved}`);
      }
    }

    if (/<[^>]+>/.test(name)) {
      errors.push("name cannot contain XML tags");
    }
  }

  // description 验证
  if (!metadata.description || typeof metadata.description !== "string") {
    errors.push("Missing required field: description");
  } else {
    const desc = metadata.description;

    if (desc.trim().length === 0) {
      errors.push("description cannot be empty");
    }

    if (desc.length > 1024) {
      errors.push(
        `description must be 1024 characters or less (got ${desc.length})`,
      );
    }

    if (/<[^>]+>/.test(desc)) {
      errors.push("description cannot contain XML tags");
    }
  }

  return errors;
}

/**
 * 从 Markdown 内容中提取资源引用
 *
 * 识别模式:
 * - Markdown 链接: [text](path/to/file.md)
 * - 代码块中的脚本: ```bash\npython scripts/run.py\n```
 * - 内联代码引用: `scripts/helper.py`
 */
function extractResourceReferences(markdown: string): SkillResource[] {
  const resources: SkillResource[] = [];
  const seen = new Set<string>();

  // 1. Markdown 链接 [text](path)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(markdown)) !== null) {
    const [, , path] = match;
    // 排除外部链接和锚点
    if (!path.startsWith("http") && !path.startsWith("#") && !seen.has(path)) {
      seen.add(path);
      resources.push(classifyResource(path));
    }
  }

  // 2. 代码块中的脚本引用
  const codeBlockRegex = /```(?:bash|python|sh|shell)\n([\s\S]*?)```/g;
  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    const code = match[1];
    // 提取脚本路径 (如 python scripts/run.py, bash ./script.sh)
    const scriptMatches = code.matchAll(
      /(?:python3?|bash|sh|node)\s+([^\s]+\.(?:py|sh|bash|js|ts))/g,
    );
    for (const scriptMatch of scriptMatches) {
      const scriptPath = scriptMatch[1].replace(/^\.\//, "");
      if (!seen.has(scriptPath)) {
        seen.add(scriptPath);
        resources.push(classifyResource(scriptPath));
      }
    }
  }

  // 3. 内联代码引用 (明确的文件路径)
  const inlineCodeRegex = /`([^`]+\.(?:py|sh|bash|js|ts|md|json|yaml|yml))`/g;
  while ((match = inlineCodeRegex.exec(markdown)) !== null) {
    const path = match[1].replace(/^\.\//, "");
    // 排除看起来像代码片段的内容
    if (!path.includes(" ") && !path.includes("(") && !seen.has(path)) {
      seen.add(path);
      resources.push(classifyResource(path));
    }
  }

  return resources;
}

/**
 * 根据文件扩展名分类资源类型
 */
function classifyResource(filePath: string): SkillResource {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const name = filePath.split("/").pop() || filePath;

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
  else if (["html", "txt", "json", "yaml", "yml", "csv", "xml"].includes(ext)) {
    type = "template";
  }

  return {
    type,
    path: filePath,
    name,
    loaded: false,
  };
}

/**
 * 从 description 中提取触发模式
 *
 * Anthropic Skills 的 description 通常包含触发条件
 * 例如: "Use when working with PDF files or when the user mentions PDFs"
 *
 * @param description - 技能描述
 * @returns 提取的触发模式数组
 */
export function extractTriggerPatterns(description: string): string[] {
  const patterns: string[] = [];
  const lowerDesc = description.toLowerCase();

  // 1. 提取 "Use when..." 模式
  const useWhenMatches = description.matchAll(
    /use (?:this )?(?:skill )?when ([^.]+?)(?:\.|,|$)/gi,
  );
  for (const match of useWhenMatches) {
    const pattern = match[1].trim();
    if (pattern.length > 3 && pattern.length < 100) {
      patterns.push(pattern);
    }
  }

  // 2. 提取 "when the user mentions/asks/requests..." 模式
  const mentionsMatches = description.matchAll(
    /when (?:the )?user (?:mentions?|asks?|requests?|wants? to) ([^.]+?)(?:\.|,|$)/gi,
  );
  for (const match of mentionsMatches) {
    const pattern = match[1].trim();
    if (pattern.length > 3 && pattern.length < 100) {
      patterns.push(pattern);
    }
  }

  // 3. 提取关键动词短语
  const actionVerbs = [
    "create",
    "edit",
    "extract",
    "analyze",
    "convert",
    "generate",
    "process",
    "parse",
    "transform",
    "export",
    "import",
  ];

  for (const verb of actionVerbs) {
    if (lowerDesc.includes(verb)) {
      const verbRegex = new RegExp(
        `${verb}(?:s|ing|ed)?\\s+([\\w\\s]+?)(?:[,.]|\\s+and\\s|\\s+or\\s|$)`,
        "gi",
      );
      const verbMatches = description.matchAll(verbRegex);
      for (const match of verbMatches) {
        const phrase = `${verb} ${match[1].trim()}`;
        if (phrase.length > 5 && phrase.length < 50) {
          patterns.push(phrase);
        }
      }
    }
  }

  // 去重
  return [...new Set(patterns)];
}

/**
 * 从 name 和 description 提取关键词
 *
 * @param name - 技能名称
 * @param description - 技能描述
 * @returns 关键词数组
 */
export function extractKeywords(name: string, description: string): string[] {
  const text = `${name} ${description}`.toLowerCase();
  const keywords = new Set<string>();

  // 常见技能关键词
  const knownKeywords = [
    // 文档类型
    "pdf",
    "excel",
    "word",
    "powerpoint",
    "pptx",
    "xlsx",
    "docx",
    "csv",
    "markdown",
    // 媒体类型
    "image",
    "photo",
    "picture",
    "video",
    "audio",
    // 数据类型
    "data",
    "json",
    "xml",
    "yaml",
    "database",
    "sql",
    // 操作类型
    "analysis",
    "report",
    "chart",
    "graph",
    "table",
    // 技术类型
    "code",
    "script",
    "programming",
    "api",
    // 通用
    "document",
    "file",
    "text",
    "content",
    // 动作
    "extract",
    "convert",
    "generate",
    "create",
    "edit",
    "analyze",
    "process",
    "parse",
    "transform",
  ];

  for (const kw of knownKeywords) {
    if (text.includes(kw)) {
      keywords.add(kw);
    }
  }

  // 从 name 提取 (如 "pdf-processing" -> "pdf", "processing")
  name.split("-").forEach((part) => {
    if (part.length > 2) {
      keywords.add(part.toLowerCase());
    }
  });

  return Array.from(keywords);
}

/**
 * 推断技能分类
 *
 * @param name - 技能名称
 * @param description - 技能描述
 * @returns 分类标识
 */
export function inferCategory(name: string, description: string): string {
  const text = `${name} ${description}`.toLowerCase();

  if (/pdf|word|excel|powerpoint|document|docx|xlsx|pptx/.test(text)) {
    return "doc";
  }
  if (/image|photo|picture|vision|ocr/.test(text)) {
    return "img";
  }
  if (/code|script|programming|developer|api/.test(text)) {
    return "code";
  }
  if (/data|analysis|knowledge|search|database/.test(text)) {
    return "kb";
  }

  return "general";
}
