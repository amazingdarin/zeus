/**
 * Document Skills
 *
 * Skill definitions for document operations.
 */

import type { SkillDefinition } from "./types.js";

/**
 * Read document content skill
 * No confirmation needed - read-only operation
 */
export const docReadSkill: SkillDefinition = {
  name: "doc-read",
  category: "doc",
  command: "/doc-read",
  description: "读取指定文档的内容。需要通过 @ 指定文档。",
  required: false,
  confirmation: {
    required: false,
    riskLevel: "low",
  },
  parameters: {
    type: "object",
    properties: {
      doc_id: {
        type: "string",
        description: "要读取的文档 ID（从 @ 提及中解析）",
      },
    },
    required: ["doc_id"],
  },
};

/**
 * Create new document skill
 * Low risk - creates new content without modifying existing
 */
export const docCreateSkill: SkillDefinition = {
  name: "doc-create",
  category: "doc",
  command: "/doc-create",
  description: "创建新文档。可以指定标题和内容描述，AI 将生成文档内容。",
  required: false,
  confirmation: {
    required: false,
    riskLevel: "low",
  },
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "文档标题",
      },
      description: {
        type: "string",
        description: "文档内容描述或要求",
      },
      parent_id: {
        type: "string",
        description: "父文档 ID（可选，用于创建子文档）",
        optional: true,
      },
    },
    required: ["title"],
  },
};

/**
 * Edit existing document skill
 * Medium risk - modifies existing document content
 */
export const docEditSkill: SkillDefinition = {
  name: "doc-edit",
  category: "doc",
  command: "/doc-edit",
  description: "编辑已有文档。需要通过 @ 指定文档，并描述修改要求。",
  required: false,
  confirmation: {
    required: true,
    riskLevel: "medium",
    warningMessage: "此操作将修改现有文档内容，请确认后执行。",
  },
  parameters: {
    type: "object",
    properties: {
      doc_id: {
        type: "string",
        description: "要编辑的文档 ID（从 @ 提及中解析）",
      },
      instructions: {
        type: "string",
        description: "修改指令或要求",
      },
    },
    required: ["doc_id", "instructions"],
  },
};

/**
 * Optimize document format skill
 * Medium risk - modifies document structure
 */
export const docOptimizeFormatSkill: SkillDefinition = {
  name: "doc-optimize-format",
  category: "doc",
  command: "/doc-optimize-format",
  description: "优化文档格式：规范标题层级、列表格式、代码块标记。需要通过 @ 指定文档。",
  required: false,
  confirmation: {
    required: true,
    riskLevel: "medium",
    warningMessage: "此操作将优化文档格式结构，请确认后执行。",
  },
  parameters: {
    type: "object",
    properties: {
      doc_id: {
        type: "string",
        description: "要优化的文档 ID（从 @ 提及中解析）",
      },
    },
    required: ["doc_id"],
  },
};

/**
 * Optimize document content skill
 * Medium risk - modifies document content
 */
export const docOptimizeContentSkill: SkillDefinition = {
  name: "doc-optimize-content",
  category: "doc",
  command: "/doc-optimize-content",
  description: "优化文档内容：改善语言表达、增强逻辑连贯性。需要通过 @ 指定文档。",
  required: false,
  confirmation: {
    required: true,
    riskLevel: "medium",
    warningMessage: "此操作将优化文档内容表达，请确认后执行。",
  },
  parameters: {
    type: "object",
    properties: {
      doc_id: {
        type: "string",
        description: "要优化的文档 ID（从 @ 提及中解析）",
      },
    },
    required: ["doc_id"],
  },
};

/**
 * Document summary skill
 * Medium risk - inserts summary at document top
 * 
 * Supports two modes:
 * 1. Single document mode: generates summary for a single document
 * 2. Directory mode: recursively summarizes all child documents
 */
export const docSummarySkill: SkillDefinition = {
  name: "doc-summary",
  category: "doc",
  command: "/doc-summary",
  description:
    "为文档或目录生成摘要。单文档模式：提取摘要插入顶部；目录模式：递归汇总所有子文档生成整体摘要。需要通过 @ 指定目标。",
  required: false,
  confirmation: {
    required: true,
    riskLevel: "medium",
    warningMessage: "此操作将在文档顶部插入摘要，请确认后执行。",
  },
  parameters: {
    type: "object",
    properties: {
      doc_id: {
        type: "string",
        description: "目标文档或目录的 ID（从 @ 提及中解析）",
      },
    },
    required: ["doc_id"],
  },
};

/**
 * Move document to another parent
 * High risk - changes document hierarchy
 */
export const docMoveSkill: SkillDefinition = {
  name: "doc-move",
  category: "doc",
  command: "/doc-move",
  description: "移动文档到新的父目录。需要通过 @ 指定要移动的文档，可附带目标父节点 ID。",
  required: false,
  confirmation: {
    required: true,
    riskLevel: "high",
    warningMessage: "此操作将修改文档层级结构，请确认后执行。",
  },
  parameters: {
    type: "object",
    properties: {
      doc_id: {
        type: "string",
        description: "要移动的文档 ID（从 @ 提及中解析）",
      },
      target_parent_id: {
        type: "string",
        description: "目标父文档 ID，root 表示根目录",
      },
      before_doc_id: {
        type: "string",
        description: "可选：插入到指定文档之前",
        optional: true,
      },
      after_doc_id: {
        type: "string",
        description: "可选：插入到指定文档之后",
        optional: true,
      },
    },
    required: ["doc_id", "target_parent_id"],
  },
};

/**
 * Delete document
 * High risk - destructive operation
 */
export const docDeleteSkill: SkillDefinition = {
  name: "doc-delete",
  category: "doc",
  command: "/doc-delete",
  description: "删除文档（可选递归删除子文档）。需要通过 @ 指定文档。",
  required: false,
  confirmation: {
    required: true,
    riskLevel: "high",
    warningMessage: "此操作会删除文档内容，可能无法恢复，请确认后执行。",
  },
  parameters: {
    type: "object",
    properties: {
      doc_id: {
        type: "string",
        description: "要删除的文档 ID（从 @ 提及中解析）",
      },
      recursive: {
        type: "boolean",
        description: "是否递归删除子文档",
        optional: true,
      },
    },
    required: ["doc_id"],
  },
};

/**
 * Knowledge base search
 */
export const kbSearchSkill: SkillDefinition = {
  name: "kb-search",
  category: "kb",
  command: "/kb-search",
  description: "在知识库中检索相关内容并返回结果摘要。",
  required: false,
  confirmation: {
    required: false,
    riskLevel: "low",
  },
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词",
      },
      limit: {
        type: "number",
        description: "返回结果数量（默认 5）",
        optional: true,
      },
    },
    required: ["query"],
  },
};

/**
 * Fetch URL content
 */
export const docFetchUrlSkill: SkillDefinition = {
  name: "doc-fetch-url",
  category: "doc",
  command: "/doc-fetch-url",
  description: "抓取 URL 内容并提取网页源码。",
  required: false,
  confirmation: {
    required: false,
    riskLevel: "low",
  },
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "目标 URL",
      },
    },
    required: ["url"],
  },
};

/**
 * Import Git repository as documents
 */
export const docImportGitSkill: SkillDefinition = {
  name: "doc-import-git",
  category: "doc",
  command: "/doc-import-git",
  description: "导入 Git 仓库并转换为文档目录结构。",
  required: false,
  confirmation: {
    required: true,
    riskLevel: "medium",
    warningMessage: "该操作会访问远程仓库并写入文档，请确认后执行。",
  },
  parameters: {
    type: "object",
    properties: {
      repo_url: {
        type: "string",
        description: "Git 仓库 URL（http/https）",
      },
      branch: {
        type: "string",
        description: "分支名（默认 main）",
        optional: true,
      },
      parent_id: {
        type: "string",
        description: "父文档 ID（默认 root）",
        optional: true,
      },
    },
    required: ["repo_url"],
  },
};

/**
 * Convert text content to markdown-like output
 */
export const docConvertSkill: SkillDefinition = {
  name: "doc-convert",
  category: "doc",
  command: "/doc-convert",
  description: "将输入内容按指定格式转换为 markdown。",
  required: false,
  confirmation: {
    required: false,
    riskLevel: "low",
  },
  parameters: {
    type: "object",
    properties: {
      from: {
        type: "string",
        description: "源格式（如 txt/html/json）",
      },
      to: {
        type: "string",
        description: "目标格式（当前支持 markdown）",
      },
      content: {
        type: "string",
        description: "待转换内容",
      },
    },
    required: ["from", "to", "content"],
  },
};

/**
 * All document skills
 */
export const documentSkills: SkillDefinition[] = [
  docReadSkill,
  docCreateSkill,
  docEditSkill,
  docOptimizeFormatSkill,
  docOptimizeContentSkill,
  docSummarySkill,
  docMoveSkill,
  docDeleteSkill,
  kbSearchSkill,
  docFetchUrlSkill,
  docImportGitSkill,
  docConvertSkill,
];

/**
 * Skill registry for document operations
 */
export const documentSkillMap = new Map<string, SkillDefinition>(
  documentSkills.map((skill) => [skill.name, skill]),
);

/**
 * Get skill by name
 */
export function getDocumentSkill(name: string): SkillDefinition | undefined {
  return documentSkillMap.get(name);
}

/**
 * Get skill by command
 */
export function getDocumentSkillByCommand(
  command: string,
): SkillDefinition | undefined {
  return documentSkills.find((skill) => skill.command === command);
}
