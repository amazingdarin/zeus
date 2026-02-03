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
 * All document skills
 */
export const documentSkills: SkillDefinition[] = [
  docReadSkill,
  docCreateSkill,
  docEditSkill,
  docOptimizeFormatSkill,
  docOptimizeContentSkill,
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
