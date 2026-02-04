/**
 * Tiptap Content Validator
 *
 * Validates LLM-generated Tiptap JSON content against the document format specification.
 */

import type { JSONContent } from "@tiptap/core";
import { v4 as uuidv4 } from "uuid";

/**
 * Valid block node types
 */
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "image",
  "imageUpload",
  "link_preview",
  "file_block",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "toc",
  "chart",      // ECharts 图表
]);

/**
 * Valid inline node types
 * Note: math and music can display as block but are inline nodes by default
 */
const INLINE_TYPES = new Set([
  "text",
  "hardBreak",
  "math",       // 数学公式 (KaTeX)
  "music",      // 乐谱 (ABC Notation)
]);

/**
 * Valid mark types
 */
const MARK_TYPES = new Set([
  "bold",
  "italic",
  "strike",
  "code",
  "underline",
  "link",
  "highlight",
  "superscript",
  "subscript",
]);

/**
 * Nodes that can only contain specific child types
 */
const CHILD_CONSTRAINTS: Record<string, string[]> = {
  bulletList: ["listItem"],
  orderedList: ["listItem"],
  taskList: ["taskItem"],
  table: ["tableRow"],
  tableRow: ["tableCell", "tableHeader"],
};

/**
 * Validation result
 */
export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * Validate Tiptap content
 */
export function validateTiptapContent(content: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!content || typeof content !== "object") {
    errors.push("Content must be an object");
    return { valid: false, errors, warnings };
  }

  const doc = content as JSONContent;

  // Check root type
  if (doc.type !== "doc") {
    errors.push(`Root type must be "doc", got "${doc.type}"`);
  }

  // Check content array
  if (!Array.isArray(doc.content)) {
    errors.push("doc.content must be an array");
    return { valid: false, errors, warnings };
  }

  // Validate each block
  for (let i = 0; i < doc.content.length; i++) {
    const block = doc.content[i];
    validateBlock(block, `content[${i}]`, errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a single block
 */
function validateBlock(
  block: unknown,
  path: string,
  errors: string[],
  warnings: string[],
): void {
  if (!block || typeof block !== "object") {
    errors.push(`${path}: Block must be an object`);
    return;
  }

  const node = block as JSONContent;

  // Check type
  if (!node.type) {
    errors.push(`${path}: Block must have a type`);
    return;
  }

  // Check if type is valid
  if (!BLOCK_TYPES.has(node.type) && !INLINE_TYPES.has(node.type)) {
    warnings.push(`${path}: Unknown node type "${node.type}"`);
  }

  // Check block ID
  if (BLOCK_TYPES.has(node.type)) {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (!attrs?.id) {
      warnings.push(`${path}: Block "${node.type}" should have an id attribute`);
    }
  }

  // Check child constraints
  if (CHILD_CONSTRAINTS[node.type] && Array.isArray(node.content)) {
    const allowedChildren = CHILD_CONSTRAINTS[node.type];
    for (let i = 0; i < node.content.length; i++) {
      const child = node.content[i] as JSONContent;
      if (child && child.type && !allowedChildren.includes(child.type)) {
        errors.push(
          `${path}.content[${i}]: "${node.type}" can only contain ${allowedChildren.join(", ")}, got "${child.type}"`,
        );
      }
    }
  }

  // Validate marks on text nodes
  if (node.type === "text" && node.marks) {
    if (!Array.isArray(node.marks)) {
      errors.push(`${path}: marks must be an array`);
    } else {
      for (let i = 0; i < node.marks.length; i++) {
        const mark = node.marks[i] as { type?: string };
        if (!mark.type) {
          errors.push(`${path}.marks[${i}]: Mark must have a type`);
        } else if (!MARK_TYPES.has(mark.type)) {
          warnings.push(`${path}.marks[${i}]: Unknown mark type "${mark.type}"`);
        }
      }
    }
  }

  // Validate heading level
  if (node.type === "heading") {
    const attrs = node.attrs as { level?: number } | undefined;
    if (attrs?.level && (attrs.level < 1 || attrs.level > 6)) {
      errors.push(`${path}: Heading level must be 1-6, got ${attrs.level}`);
    }
  }

  // Validate math node
  if (node.type === "math") {
    const attrs = node.attrs as { latex?: string; display?: boolean } | undefined;
    if (typeof attrs?.latex !== "string") {
      warnings.push(`${path}: math node should have a "latex" attribute`);
    }
  }

  // Validate music node
  if (node.type === "music") {
    const attrs = node.attrs as { abc?: string; display?: boolean } | undefined;
    if (typeof attrs?.abc !== "string") {
      warnings.push(`${path}: music node should have an "abc" attribute`);
    }
  }

  // Validate chart node
  if (node.type === "chart") {
    const attrs = node.attrs as { 
      chartType?: string; 
      mode?: string;
      simpleData?: string;
      options?: string;
    } | undefined;
    const validChartTypes = ["bar", "line", "pie", "scatter", "radar", "funnel"];
    if (attrs?.chartType && !validChartTypes.includes(attrs.chartType)) {
      warnings.push(`${path}: chart node has invalid chartType "${attrs.chartType}", expected one of: ${validChartTypes.join(", ")}`);
    }
    const validModes = ["simple", "advanced"];
    if (attrs?.mode && !validModes.includes(attrs.mode)) {
      warnings.push(`${path}: chart node has invalid mode "${attrs.mode}", expected "simple" or "advanced"`);
    }
  }

  // Recursively validate children
  if (Array.isArray(node.content)) {
    for (let i = 0; i < node.content.length; i++) {
      validateBlock(node.content[i], `${path}.content[${i}]`, errors, warnings);
    }
  }
}

/**
 * Fix common issues in LLM-generated content
 */
export function fixCommonIssues(content: JSONContent): JSONContent {
  const fixed = JSON.parse(JSON.stringify(content)) as JSONContent;

  // Ensure root is doc type
  if (fixed.type !== "doc") {
    return {
      type: "doc",
      content: [fixed],
    };
  }

  // Fix content array
  if (!Array.isArray(fixed.content)) {
    fixed.content = [];
  }

  // Fix each block
  fixed.content = fixed.content.map((block) => fixBlock(block));

  return fixed;
}

/**
 * Fix a single block
 */
function fixBlock(block: JSONContent): JSONContent {
  const fixed = { ...block };

  // Ensure block has attrs with id
  if (BLOCK_TYPES.has(fixed.type || "")) {
    fixed.attrs = {
      ...(fixed.attrs as Record<string, unknown> || {}),
    };
    if (!(fixed.attrs as Record<string, unknown>).id) {
      (fixed.attrs as Record<string, unknown>).id = generateShortId();
    }
  }

  // Fix list items - ensure they contain paragraph
  if ((fixed.type === "listItem" || fixed.type === "taskItem") && Array.isArray(fixed.content)) {
    fixed.content = fixed.content.map((child) => {
      if (child.type === "text") {
        // Wrap text in paragraph
        return {
          type: "paragraph",
          content: [child],
        };
      }
      return fixBlock(child);
    });

    // If content is empty, add empty paragraph
    if (fixed.content.length === 0) {
      fixed.content = [{ type: "paragraph", content: [] }];
    }
  }

  // Remove invalid marks
  if (fixed.type === "text" && fixed.marks) {
    fixed.marks = (fixed.marks as Array<{ type: string }>).filter((mark) =>
      MARK_TYPES.has(mark.type),
    );
    if (fixed.marks.length === 0) {
      delete fixed.marks;
    }
  }

  // Fix heading level
  if (fixed.type === "heading") {
    const attrs = fixed.attrs as { level?: number } | undefined;
    if (!attrs?.level || attrs.level < 1 || attrs.level > 6) {
      fixed.attrs = { ...attrs, level: 2 };
    }
  }

  // Recursively fix children
  if (Array.isArray(fixed.content)) {
    fixed.content = fixed.content.map((child) => fixBlock(child));
  }

  return fixed;
}

/**
 * Generate a short ID for blocks
 */
function generateShortId(): string {
  return uuidv4().split("-")[0];
}

/**
 * Ensure all blocks have IDs
 */
export function ensureBlockIds(content: JSONContent[]): JSONContent[] {
  return content.map((block) => {
    const fixed = { ...block };

    if (BLOCK_TYPES.has(fixed.type || "")) {
      fixed.attrs = {
        ...(fixed.attrs as Record<string, unknown> || {}),
      };
      if (!(fixed.attrs as Record<string, unknown>).id) {
        (fixed.attrs as Record<string, unknown>).id = generateShortId();
      }
    }

    if (Array.isArray(fixed.content)) {
      fixed.content = ensureBlockIds(fixed.content);
    }

    return fixed;
  });
}
