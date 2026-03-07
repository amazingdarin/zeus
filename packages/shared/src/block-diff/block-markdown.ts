/**
 * Block to Markdown conversion for content fingerprinting.
 * 
 * This provides a canonical text representation of blocks,
 * ignoring structural differences like IDs and attribute order.
 */

import type { NormalizedBlock } from "./types";

/**
 * Simple string hash function for fingerprinting
 */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Convert a NormalizedBlock to Markdown string.
 * This provides a canonical form for content comparison,
 * ignoring structural differences like IDs and attribute order.
 */
export function blockToMarkdown(block: NormalizedBlock, depth = 0): string {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];

  // Extract inline text with marks
  const getInlineText = (node: NormalizedBlock): string => {
    if (node.text !== undefined) {
      let text = node.text;
      // Apply marks in a deterministic order
      if (node.marks && Array.isArray(node.marks)) {
        const sortedMarks = [...node.marks].sort((a, b) => {
          const typeA = (a as { type?: string }).type || "";
          const typeB = (b as { type?: string }).type || "";
          return typeA.localeCompare(typeB);
        });
        for (const mark of sortedMarks) {
          const markType = (mark as { type?: string }).type;
          switch (markType) {
            case "bold":
              text = `**${text}**`;
              break;
            case "italic":
              text = `*${text}*`;
              break;
            case "strike":
              text = `~~${text}~~`;
              break;
            case "code":
              text = `\`${text}\``;
              break;
            case "link": {
              const href = (mark as { attrs?: { href?: string } }).attrs?.href || "";
              text = `[${text}](${href})`;
              break;
            }
          }
        }
      }
      return text;
    }
    
    if (node.content && Array.isArray(node.content)) {
      return node.content
        .map((child) => getInlineText(child as NormalizedBlock))
        .join("");
    }
    
    return "";
  };

  // Get text content for block-level elements (with inline formatting)
  const getBlockText = (node: NormalizedBlock): string => {
    if (node.content && Array.isArray(node.content)) {
      return node.content
        .map((child) => getInlineText(child as NormalizedBlock))
        .join("");
    }
    return node.text || "";
  };

  // Get raw text content (no formatting, for code blocks)
  const getRawText = (node: NormalizedBlock): string => {
    if (node.text !== undefined) {
      return node.text;
    }
    if (node.content && Array.isArray(node.content)) {
      return node.content
        .map((child) => getRawText(child as NormalizedBlock))
        .join("");
    }
    return "";
  };

  switch (block.type) {
    case "heading": {
      const level = (block.attrs?.level as number) || 1;
      const hashes = "#".repeat(level);
      lines.push(`${hashes} ${getBlockText(block)}`);
      break;
    }
    
    case "paragraph":
      lines.push(getBlockText(block));
      break;
    
    case "bulletList":
      if (block.content && Array.isArray(block.content)) {
        for (const item of block.content) {
          const itemBlock = item as NormalizedBlock;
          if (itemBlock.type === "listItem") {
            const itemText = itemBlock.content
              ?.map((child) => blockToMarkdown(child as NormalizedBlock, depth + 1))
              .join("\n") || "";
            lines.push(`${indent}- ${itemText.trim()}`);
          }
        }
      }
      break;
    
    case "orderedList":
      if (block.content && Array.isArray(block.content)) {
        let num = 1;
        for (const item of block.content) {
          const itemBlock = item as NormalizedBlock;
          if (itemBlock.type === "listItem") {
            const itemText = itemBlock.content
              ?.map((child) => blockToMarkdown(child as NormalizedBlock, depth + 1))
              .join("\n") || "";
            lines.push(`${indent}${num}. ${itemText.trim()}`);
            num++;
          }
        }
      }
      break;
    
    case "taskList":
      if (block.content && Array.isArray(block.content)) {
        for (const item of block.content) {
          const itemBlock = item as NormalizedBlock;
          if (itemBlock.type === "taskItem") {
            const checked = itemBlock.attrs?.checked ? "x" : " ";
            const itemText = itemBlock.content
              ?.map((child) => blockToMarkdown(child as NormalizedBlock, depth + 1))
              .join("\n") || "";
            lines.push(`${indent}- [${checked}] ${itemText.trim()}`);
          }
        }
      }
      break;
    
    case "codeBlock": {
      // Normalize language: treat empty/undefined as no language
      const lang = (block.attrs?.language as string)?.trim() || "";
      // Get raw text content without inline formatting
      const code = getRawText(block);
      // Use a consistent format for code blocks
      lines.push(`\`\`\`${lang}`);
      // Normalize line endings to \n
      lines.push(code.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
      lines.push("```");
      break;
    }
    
    case "blockquote":
      if (block.content && Array.isArray(block.content)) {
        for (const child of block.content) {
          const childMd = blockToMarkdown(child as NormalizedBlock, depth);
          lines.push(`> ${childMd}`);
        }
      }
      break;
    
    case "horizontalRule":
      lines.push("---");
      break;
    
    case "image": {
      const src = (block.attrs?.src as string) || "";
      const alt = (block.attrs?.alt as string) || "";
      lines.push(`![${alt}](${src})`);
      break;
    }
    
    case "file_block": {
      // Use a deterministic representation for file blocks
      const fileId = (block.attrs?.fileId as string) || "";
      const fileName = (block.attrs?.file_name as string) || "";
      lines.push(`[file:${fileId}|${fileName}]`);
      break;
    }
    
    case "hardBreak":
      lines.push("  "); // Two trailing spaces for hard break
      break;
    
    case "listItem":
    case "taskItem":
      // These are handled by their parent lists
      if (block.content && Array.isArray(block.content)) {
        return block.content
          .map((child) => blockToMarkdown(child as NormalizedBlock, depth))
          .join("\n");
      }
      return "";
    
    default:
      // For unknown types, just extract text content
      lines.push(getBlockText(block));
  }

  return lines.join("\n");
}

/**
 * Normalize whitespace in markdown for consistent comparison.
 * - Normalize line endings to \n
 * - Trim trailing whitespace from lines
 * - Collapse multiple blank lines into one
 */
function normalizeMarkdownWhitespace(md: string): string {
  return md
    // Normalize line endings
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Trim trailing whitespace from each line
    .split("\n")
    .map(line => line.trimEnd())
    .join("\n")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    // Trim start and end
    .trim();
}

/**
 * Create a content fingerprint for a block using Markdown representation.
 * This ensures content-equivalent blocks match even if their JSON structure differs.
 */
export function createMarkdownFingerprint(block: NormalizedBlock): string {
  const markdown = blockToMarkdown(block);
  // Normalize whitespace before hashing for consistent comparison
  const normalized = normalizeMarkdownWhitespace(markdown);
  return `${block.type}|${simpleHash(normalized)}`;
}
