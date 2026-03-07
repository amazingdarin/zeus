/**
 * Document Skills
 *
 * Skill definitions for document operations.
 */

import { z } from "zod";
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
  inputSchema: z.object({
    doc_id: z.string().describe("要读取的文档 ID（从 @ 提及中解析）"),
  }),
};

/**
 * Inspect a document and return metadata / block attributes (optionally body content).
 * Read-only operation.
 */
export const docGetSkill: SkillDefinition = {
  name: "doc-get",
  category: "doc",
  command: "/doc-get",
  description:
    "获取文档元信息与 block 属性快照。可选返回正文内容，便于媒体候选解析与调试。",
  required: false,
  confirmation: {
    required: false,
    riskLevel: "low",
  },
  inputSchema: z.object({
    doc_id: z.string().describe("可选：文档 ID；若未传则尝试从 @ 提及中使用第一个文档").optional(),
    include_content: z
      .boolean()
      .describe("是否返回完整文档 body（默认 false）")
      .optional(),
    include_block_attrs: z
      .boolean()
      .describe("是否返回 block attrs 快照（默认 true）")
      .optional(),
    block_types: z
      .array(z.string().min(1))
      .max(50)
      .describe("可选：仅提取指定 block 类型（默认不过滤）")
      .optional(),
  }),
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
  inputSchema: z.object({
    title: z.string().describe("文档标题"),
    description: z.string().describe("文档内容描述或要求").optional(),
    parent_id: z.string().describe("父文档 ID（可选，用于创建子文档）").optional(),
  }),
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
  inputSchema: z.object({
    doc_id: z.string().describe("要编辑的文档 ID（从 @ 提及中解析）"),
    instructions: z.string().describe("修改指令或要求"),
  }),
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
  const baseShape = {
    doc_id: z.string().describe("要优化的文档 ID（从 @ 提及中解析）"),
    instructions: z.string().describe("可选：额外优化要求").optional(),
  };

  const inputSchema = input.includeStyle
    ? z.object({
        ...baseShape,
        style: z
          .enum(OPTIMIZE_STYLE_VALUES)
          .describe("风格类型（professional/concise/friendly/academic/technical/marketing）"),
      })
    : z.object(baseShape);

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
    inputSchema,
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

const PPT_COMMON_INPUT_SCHEMA = z.object({
  doc_id: z.string().describe("源文档 ID（从 @ 提及中解析）"),
  title: z.string().describe("演示稿标题（可选，默认使用源文档标题）").optional(),
  presenter: z.string().describe("报告人（可选，默认“待填写”）").optional(),
  report_time: z.string().describe("报告时间（可选，格式 YYYY-MM-DD；默认当天）").optional(),
  max_slides: z.number().describe("最大页数（可选，默认 12，建议 5-20）").optional(),
  include_agenda: z.boolean().describe("是否包含目录页（可选，默认 true）").optional(),
  include_qna: z.boolean().describe("是否包含 Q&A 页（可选，默认 true）").optional(),
  instructions: z.string().describe("额外要求（可选，例如面向管理层、突出风险与收益、强调时间线）").optional(),
});

/**
 * Legacy compatibility alias.
 *
 * Supervisor will expand this into:
 *   doc-optimize-ppt-outline -> doc-render-ppt-html
 */
export const docOptimizePptSkill: SkillDefinition = {
  name: "doc-optimize-ppt",
  category: "doc",
  command: "/doc-optimize-ppt",
  description:
    "兼容入口：自动执行“类 PPT 说明文档生成 + HTML 演示稿注入”。需要通过 @ 指定文档或由编排自动绑定。",
  required: false,
  confirmation: {
    required: true,
    riskLevel: "medium",
    warningMessage: "将基于原文生成新的演示稿文档草稿（不会覆盖原文），是否继续？",
  },
  inputSchema: PPT_COMMON_INPUT_SCHEMA,
};

/**
 * Step 1: Generate a structured PPT-outline document.
 */
export const docOptimizePptOutlineSkill: SkillDefinition = {
  name: "doc-optimize-ppt-outline",
  category: "doc",
  command: "/doc-optimize-ppt-outline",
  description:
    "步骤1：将文档重组为结构化类 PPT 说明文档（包含封面字段、视觉建议、讲解备注）。需要通过 @ 指定文档。",
  required: false,
  confirmation: {
    required: true,
    riskLevel: "medium",
    warningMessage: "将基于原文生成结构化类 PPT 文档草稿（不会覆盖原文），是否继续？",
  },
  inputSchema: PPT_COMMON_INPUT_SCHEMA,
};

/**
 * Step 2: Render a static HTML slide deck and inject file_block at top.
 */
export const docRenderPptHtmlSkill: SkillDefinition = {
  name: "doc-render-ppt-html",
  category: "doc",
  command: "/doc-render-ppt-html",
  description:
    "步骤2：根据结构化类 PPT 文档生成静态 HTML 演示稿，并将 file_block 注入文档顶部。",
  required: false,
  confirmation: {
    required: false,
    riskLevel: "low",
  },
  inputSchema: z.object({
    doc_id: z.string().describe("要注入 HTML 演示稿的目标文档 ID（由上游任务绑定或 @ 提及）"),
    theme: z
      .enum(["modern", "business", "minimal", "dark"])
      .describe("主题风格（可选，默认 modern）")
      .optional(),
  }),
};

/**
 * Export a PPT-style document to PPTX via async generation task.
 */
export const docExportPptSkill: SkillDefinition = {
  name: "doc-export-ppt",
  category: "doc",
  command: "/doc-export-ppt",
  description:
    "将文档导出为 PPTX（异步任务）。需要通过 @ 指定文档，或由编排任务自动绑定 doc_id。",
  required: false,
  confirmation: {
    required: false,
    riskLevel: "low",
  },
  inputSchema: z.object({
    doc_id: z.string().describe("要导出的文档 ID（从 @ 提及中解析或由上游任务绑定）"),
    style: z.object({
      description: z.string().describe("风格描述（可选）").optional(),
      templateId: z.string().describe("模板 ID（可选）").optional(),
      templateImages: z.array(z.string()).describe("模板图片 URL 列表（可选）").optional(),
    }).describe("导出样式配置（可选）").optional(),
    options: z.object({
      aspectRatio: z.enum(["16:9", "4:3"]).describe("画面比例（可选）").optional(),
      language: z.string().describe("语言（可选）").optional(),
    }).describe("导出选项（可选）").optional(),
  }),
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
  inputSchema: z.object({
    doc_id: z.string().describe("目标文档或目录的 ID（从 @ 提及中解析）"),
  }),
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
  inputSchema: z.object({
    doc_id: z.string().describe("要移动的文档 ID（从 @ 提及中解析）"),
    target_parent_id: z.string().describe("目标父文档 ID，root 表示根目录"),
    before_doc_id: z.string().describe("可选：插入到指定文档之前").optional(),
    after_doc_id: z.string().describe("可选：插入到指定文档之后").optional(),
  }),
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
  inputSchema: z.object({
    doc_id: z.string().describe("要删除的文档 ID（从 @ 提及中解析）"),
    recursive: z.boolean().describe("是否递归删除子文档").optional(),
  }),
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
  inputSchema: z.object({
    query: z.string().describe("搜索关键词"),
    limit: z.number().describe("返回结果数量（默认 5）").optional(),
  }),
};

/**
 * Web search
 */
export const webSearchSkill: SkillDefinition = {
  name: "web-search",
  category: "kb",
  command: "/web-search",
  description: "执行网络搜索并返回结果摘要（需先在系统设置中启用网络搜索）。",
  required: false,
  confirmation: {
    required: false,
    riskLevel: "low",
  },
  inputSchema: z.object({
    query: z.string().describe("网络搜索关键词"),
    limit: z.number().describe("返回结果数量（默认 5，最大 10）").optional(),
  }),
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
  inputSchema: z.object({
    url: z.string().describe("目标 URL"),
  }),
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
  inputSchema: z.object({
    repo_url: z.string().describe("Git 仓库 URL（http/https）"),
    branch: z.string().describe("分支名（默认 main）").optional(),
    parent_id: z.string().describe("父文档 ID（默认 root）").optional(),
  }),
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
  inputSchema: z.object({
    asset_id: z.string().describe("附件资产 ID（来自聊天附件上传返回的 asset_id）"),
    parent_id: z.string().describe("父文档 ID（默认 root）").optional(),
    title: z.string().describe("文档标题（可选，默认使用文件名）").optional(),
    enable_format_optimize: z.boolean().describe("是否启用格式优化（默认 false）").optional(),
  }),
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
  inputSchema: z.object({
    doc_id: z.string().describe("目标目录文档 ID（从 @ 提及中解析），留空则整理整个项目根目录").optional(),
  }),
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
  inputSchema: z.object({
    from: z.string().describe("源格式（如 txt/html/json）"),
    to: z.string().describe("目标格式（当前支持 markdown）"),
    content: z.string().describe("待转换内容"),
  }),
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
  inputSchema: z.object({
    asset_id: z.string().describe("附件资产 ID（来自聊天附件上传返回的 asset_id）"),
  }),
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
  inputSchema: z.object({
    asset_id: z.string().describe("图片资产 ID（来自聊天附件上传返回的 asset_id）"),
    question: z.string().describe("关于图片的问题（可选，默认进行 OCR 文字识别）").optional(),
  }),
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
  inputSchema: z.object({
    url: z.string().describe("目标 URL"),
  }),
};

/**
 * Transcribe speech from audio/video attachments.
 * Read-only operation — does not create a document.
 */
export const mediaTranscribeSkill: SkillDefinition = {
  name: "media-transcribe",
  category: "doc",
  command: "/media-transcribe",
  description:
    "转写音频或视频中的语音文字，返回 Markdown 文本结果。支持附件、文档 file_block、单个或批量媒体。",
  required: false,
  confirmation: {
    required: false,
    riskLevel: "low",
  },
  inputSchema: z
    .object({
      asset_id: z
        .string()
        .describe("媒体资产 ID（来自聊天附件上传返回的 asset_id；可使用 __ALL__ 代表全部候选）")
        .optional(),
      asset_ids: z
        .array(z.string().min(1))
        .max(50)
        .describe("批量转写的媒体资产 ID 列表")
        .optional(),
      candidate_key: z
        .string()
        .describe("候选媒体 key（由系统候选列表提供）")
        .optional(),
      candidate_keys: z
        .array(z.string().min(1))
        .max(50)
        .describe("候选媒体 key 列表（批量）")
        .optional(),
      target_mode: z
        .enum(["single", "all"])
        .describe("候选目标模式：single 选择单个，all 批量全部")
        .optional(),
      media_scope: z
        .enum(["all", "video", "audio"])
        .describe("候选媒体范围，默认 all（音频+视频）")
        .optional(),
      doc_id: z.string().describe("可选：文档 ID，用于从文档 block 自动解析媒体").optional(),
      block_id: z.string().describe("可选：文档中的 block ID，用于定位具体 file_block").optional(),
      language: z
        .string()
        .describe("可选：目标语言代码（如 zh、en）")
        .optional(),
      prompt: z
        .string()
        .describe("可选：转写提示词（专业术语、人名地名等）")
        .optional(),
      model: z.string().describe("可选：转写模型名称").optional(),
    })
    .superRefine((value, ctx) => {
      const hasAssetId = typeof value.asset_id === "string" && value.asset_id.trim().length > 0;
      const hasAssetIds = Array.isArray(value.asset_ids)
        && value.asset_ids.some((item) => typeof item === "string" && item.trim().length > 0);
      const hasCandidateKey = typeof value.candidate_key === "string"
        && value.candidate_key.trim().length > 0;
      const hasCandidateKeys = Array.isArray(value.candidate_keys)
        && value.candidate_keys.some((item) => typeof item === "string" && item.trim().length > 0);
      const hasDocRef = (typeof value.doc_id === "string" && value.doc_id.trim().length > 0)
        || (typeof value.block_id === "string" && value.block_id.trim().length > 0);
      if (!hasAssetId && !hasAssetIds && !hasCandidateKey && !hasCandidateKeys && !hasDocRef) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["asset_id"],
          message: "请提供 asset/candidate 参数，或 doc_id/block_id 让系统自动解析媒体",
        });
      }
    }),
};

/**
 * All document skills
 */
export const documentSkills: SkillDefinition[] = [
  docReadSkill,
  docGetSkill,
  docCreateSkill,
  docEditSkill,
  docOptimizeFormatSkill,
  docOptimizeContentSkill,
  docOptimizeStyleSkill,
  docOptimizeFullSkill,
  docOptimizePptSkill,
  docOptimizePptOutlineSkill,
  docRenderPptHtmlSkill,
  docExportPptSkill,
  docSummarySkill,
  docMoveSkill,
  docDeleteSkill,
  docOrganizeSkill,
  kbSearchSkill,
  webSearchSkill,
  docFetchUrlSkill,
  docImportGitSkill,
  docSmartImportSkill,
  docConvertSkill,
  fileParseSkill,
  imageAnalyzeSkill,
  mediaTranscribeSkill,
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
