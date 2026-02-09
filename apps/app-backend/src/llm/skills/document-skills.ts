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

const OPTIMIZE_STYLE_VALUES = [
  "professional",
  "concise",
  "friendly",
  "academic",
  "technical",
  "marketing",
] as const;

function createDocOptimizeSkill(input: {
  name: "doc-optimize-format" | "doc-optimize-content" | "doc-optimize-style" | "doc-optimize-full";
  command: string;
  description: string;
  warningMessage: string;
  includeStyle?: boolean;
}): SkillDefinition {
  const properties: SkillDefinition["parameters"]["properties"] = {
    doc_id: {
      type: "string",
      description: "要优化的文档 ID（从 @ 提及中解析）",
    },
    instructions: {
      type: "string",
      description: "可选：额外优化要求",
      optional: true,
    },
  };

  if (input.includeStyle) {
    properties.style = {
      type: "string",
      description: "风格类型（professional/concise/friendly/academic/technical/marketing）",
      enum: [...OPTIMIZE_STYLE_VALUES],
    };
  }

  return {
    name: input.name,
    category: "doc",
    command: input.command,
    description: input.description,
    required: false,
    confirmation: {
      required: true,
      riskLevel: "medium",
      warningMessage: input.warningMessage,
    },
    parameters: {
      type: "object",
      properties,
      required: input.includeStyle ? ["doc_id", "style"] : ["doc_id"],
    },
  };
}

/**
 * Optimize document format skill
 * Medium risk - modifies document structure
 */
export const docOptimizeFormatSkill = createDocOptimizeSkill({
  name: "doc-optimize-format",
  command: "/doc-optimize-format",
  description: "优化文档格式：规范标题层级、列表格式、代码块标记。需要通过 @ 指定文档。",
  warningMessage: "此操作将优化文档格式结构，请确认后执行。",
});

/**
 * Optimize document content skill
 * Medium risk - modifies document content
 */
export const docOptimizeContentSkill = createDocOptimizeSkill({
  name: "doc-optimize-content",
  command: "/doc-optimize-content",
  description: "优化文档内容：改善语言表达、增强逻辑连贯性。需要通过 @ 指定文档。",
  warningMessage: "此操作将优化文档内容表达，请确认后执行。",
});

/**
 * Optimize document style skill
 * Medium risk - rewrites content in target style
 */
export const docOptimizeStyleSkill = createDocOptimizeSkill({
  name: "doc-optimize-style",
  command: "/doc-optimize-style",
  description:
    "按目标风格优化文档内容（professional/concise/friendly/academic/technical/marketing）。需要通过 @ 指定文档。",
  warningMessage: "此操作将按指定风格改写文档内容，请确认后执行。",
  includeStyle: true,
});

/**
 * Optimize document full skill
 * Medium risk - modifies both structure and content
 */
export const docOptimizeFullSkill = createDocOptimizeSkill({
  name: "doc-optimize-full",
  command: "/doc-optimize-full",
  description: "综合优化文档格式与内容。需要通过 @ 指定文档。",
  warningMessage: "此操作将同时优化文档格式与内容，请确认后执行。",
});

/**
 * Optimize document into a slide-like (PPT-style) deck.
 *
 * Output format rules are enforced by prompt + ppt-guard in the refinement loop:
 * - Each slide starts with Heading 1
 * - Slides separated by horizontalRule
 * - Cover slide contains title + metadata only
 */
export const docOptimizePptSkill: SkillDefinition = {
  name: "doc-optimize-ppt",
  category: "doc",
  command: "/doc-optimize-ppt",
  description:
    "将文档总结并重组为类 PPT 演示稿格式（每页以 Heading 1 开始，使用分割线分页）。需要通过 @ 指定文档。",
  required: false,
  confirmation: {
    required: true,
    riskLevel: "medium",
    warningMessage: "将基于原文生成新的演示稿文档草稿（不会覆盖原文），是否继续？",
  },
  parameters: {
    type: "object",
    properties: {
      doc_id: {
        type: "string",
        description: "源文档 ID（从 @ 提及中解析）",
      },
      title: {
        type: "string",
        description: "演示稿标题（可选，默认使用源文档标题）",
        optional: true,
      },
      presenter: {
        type: "string",
        description: "报告人（可选，默认“待填写”）",
        optional: true,
      },
      report_time: {
        type: "string",
        description: "报告时间（可选，格式 YYYY-MM-DD；默认当天）",
        optional: true,
      },
      max_slides: {
        type: "number",
        description: "最大页数（可选，默认 12，建议 5-20）",
        optional: true,
      },
      include_agenda: {
        type: "boolean",
        description: "是否包含目录页（可选，默认 true）",
        optional: true,
      },
      include_qna: {
        type: "boolean",
        description: "是否包含 Q&A 页（可选，默认 true）",
        optional: true,
      },
      instructions: {
        type: "string",
        description: "额外要求（可选，例如面向管理层、突出风险与收益、强调时间线）",
        optional: true,
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
 * Smart import an uploaded asset into a document
 */
export const docSmartImportSkill: SkillDefinition = {
  name: "doc-smart-import",
  category: "doc",
  command: "/doc-smart-import",
  description: "将附件（asset_id）智能解析并导入为文档。",
  required: false,
  confirmation: {
    required: true,
    riskLevel: "medium",
    warningMessage: "该操作会解析附件并创建文档，请确认后执行。",
  },
  parameters: {
    type: "object",
    properties: {
      asset_id: {
        type: "string",
        description: "附件资产 ID（来自聊天附件上传返回的 asset_id）",
      },
      parent_id: {
        type: "string",
        description: "父文档 ID（默认 root）",
        optional: true,
      },
      title: {
        type: "string",
        description: "文档标题（可选，默认使用文件名）",
        optional: true,
      },
      enable_format_optimize: {
        type: "boolean",
        description: "是否启用格式优化（默认 false）",
        optional: true,
      },
    },
    required: ["asset_id"],
  },
};

/**
 * Organize document directory structure
 * High risk - rearranges document hierarchy
 *
 * Uses knowledge-index summaries (not full content) + LLM to classify
 * documents and propose a new tree structure. Confirmation is handled
 * at the chat layer (organize_plan chunk) so the analysis phase can
 * always run first.
 */
export const docOrganizeSkill: SkillDefinition = {
  name: "doc-organize",
  category: "doc",
  command: "/doc-organize",
  description:
    "整理文档目录结构。自动分析所有子文档类别，提议新的目录结构并批量移动。可通过 @ 指定目录文档，不指定则整理整个项目。",
  required: false,
  confirmation: {
    required: false, // analysis is safe; confirmation handled by chat.ts on organize_plan chunk
    riskLevel: "high",
  },
  parameters: {
    type: "object",
    properties: {
      doc_id: {
        type: "string",
        description: "目标目录文档 ID（从 @ 提及中解析），留空则整理整个项目根目录",
        optional: true,
      },
    },
    required: [],
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
 * Parse uploaded file (PDF/Word/HTML/text/code) and return extracted content.
 * Read-only operation — does not create a document.
 */
export const fileParseSkill: SkillDefinition = {
  name: "file-parse",
  category: "doc",
  command: "/file-parse",
  description:
    "解析上传的文件（PDF/Word/HTML/文本等），提取内容为 Markdown 文本返回到对话中。通过聊天附件上传文件。",
  required: false,
  confirmation: {
    required: false,
    riskLevel: "low",
  },
  parameters: {
    type: "object",
    properties: {
      asset_id: {
        type: "string",
        description: "附件资产 ID（来自聊天附件上传返回的 asset_id）",
      },
    },
    required: ["asset_id"],
  },
};

/**
 * Analyze image content via OCR or LLM vision Q&A.
 * Read-only operation — does not create a document.
 */
export const imageAnalyzeSkill: SkillDefinition = {
  name: "image-analyze",
  category: "img",
  command: "/image-analyze",
  description:
    "分析图片内容：OCR 文字识别，或基于图片回答问题。通过聊天附件上传图片。",
  required: false,
  confirmation: {
    required: false,
    riskLevel: "low",
  },
  parameters: {
    type: "object",
    properties: {
      asset_id: {
        type: "string",
        description: "图片资产 ID（来自聊天附件上传返回的 asset_id）",
      },
      question: {
        type: "string",
        description: "关于图片的问题（可选，默认进行 OCR 文字识别）",
        optional: true,
      },
    },
    required: ["asset_id"],
  },
};

/**
 * Fetch URL page and extract main article content as clean Markdown.
 * Read-only operation — does not create a document.
 */
export const urlExtractSkill: SkillDefinition = {
  name: "url-extract",
  category: "doc",
  command: "/url-extract",
  description:
    "抓取 URL 页面并提取正文内容为 Markdown 格式返回到对话中。",
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
 * All document skills
 */
export const documentSkills: SkillDefinition[] = [
  docReadSkill,
  docCreateSkill,
  docEditSkill,
  docOptimizeFormatSkill,
  docOptimizeContentSkill,
  docOptimizeStyleSkill,
  docOptimizeFullSkill,
  docOptimizePptSkill,
  docSummarySkill,
  docMoveSkill,
  docDeleteSkill,
  docOrganizeSkill,
  kbSearchSkill,
  docFetchUrlSkill,
  docImportGitSkill,
  docSmartImportSkill,
  docConvertSkill,
  fileParseSkill,
  imageAnalyzeSkill,
  urlExtractSkill,
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
