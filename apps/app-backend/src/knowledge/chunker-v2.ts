/**
 * Multi-Granularity Document Chunker
 *
 * This module implements a sophisticated chunking strategy that creates
 * index entries at multiple granularity levels:
 * - Document: Full document summary
 * - Section: Heading-based sections
 * - Block: Individual content blocks
 * - Code: Code blocks with symbol extraction
 */

import type { Document, DocumentBody } from "../storage/types.js";
import type { ChunkResult, IndexEntry, IndexGranularity } from "./types.js";
import { v4 as uuidv4 } from "uuid";

// Configuration
const MAX_DOCUMENT_SUMMARY_LENGTH = 500;
const MAX_SECTION_LENGTH = 2000;
const MAX_BLOCK_LENGTH = 800;
const HEADING_LEVELS_FOR_SECTIONS = [1, 2, 3]; // h1, h2, h3 create sections

/**
 * Chunk a document into multiple granularity levels
 */
export function chunkDocument(
  userId: string,
  projectKey: string,
  doc: Document,
  parentPath: string[] = [],
): ChunkResult {
  const docId = doc.meta.id;
  const title = doc.meta.title || "Untitled";
  const body = doc.body;
  const now = Date.now();

  const result: ChunkResult = {
    document: null!,
    sections: [],
    blocks: [],
    codes: [],
  };

  // Handle different body types
  if (body.type === "markdown") {
    // For markdown content, treat as a single block
    const content =
      typeof body.content === "string" ? body.content : String(body.content);
    result.document = createDocumentEntry(
      userId,
      projectKey,
      docId,
      title,
      content,
      parentPath,
      now,
    );
    result.blocks.push(
      createBlockEntry(
        userId,
        projectKey,
        docId,
        "root",
        content,
        parentPath,
        now,
      ),
    );
    return result;
  }

  // Tiptap JSON content
  const content = body.content as TiptapNode | TiptapNode[];
  const nodes = Array.isArray(content)
    ? content
    : (content as TiptapNode)?.content || [];

  // 1. Extract full text for document-level entry
  const fullText = extractFullText(nodes);
  result.document = createDocumentEntry(
    userId,
    projectKey,
    docId,
    title,
    fullText,
    parentPath,
    now,
  );

  // 2. Process nodes to extract sections, blocks, and code
  let currentSection: SectionBuffer | null = null;
  const sectionStack: string[] = [...parentPath, title];

  for (const node of nodes) {
    // Check if this is a heading that starts a new section
    if (isHeadingNode(node) && isSignificantHeading(node)) {
      // Flush current section
      if (currentSection) {
        result.sections.push(
          finalizeSectionEntry(
            userId,
            projectKey,
            docId,
            currentSection,
            sectionStack,
            now,
          ),
        );
      }

      // Start new section
      const headingText = extractNodeText(node);
      const headingLevel = (node.attrs?.level as number) || 1;
      currentSection = {
        title: headingText,
        level: headingLevel,
        blocks: [],
        fullText: "",
      };

      // Update section stack based on heading level
      updateSectionStack(sectionStack, headingText, headingLevel, parentPath);
    }

    // Handle code blocks specially
    if (node.type === "codeBlock") {
      const codeEntry = createCodeEntry(
        userId,
        projectKey,
        docId,
        node,
        sectionStack,
        now,
      );
      result.codes.push(codeEntry);
    }

    // Add to current section if exists
    if (currentSection) {
      currentSection.blocks.push(node);
      currentSection.fullText += extractNodeText(node) + "\n";
    }

    // Create block-level entry for significant blocks
    if (shouldIndexAsBlock(node)) {
      const blockEntry = createBlockEntry(
        userId,
        projectKey,
        docId,
        getNodeId(node),
        extractNodeText(node),
        sectionStack,
        now,
      );
      result.blocks.push(blockEntry);
    }
  }

  // Flush final section
  if (currentSection) {
    result.sections.push(
      finalizeSectionEntry(
        userId,
        projectKey,
        docId,
        currentSection,
        sectionStack,
        now,
      ),
    );
  }

  return result;
}

/**
 * Extract symbols (function/class names) from code
 */
export function extractCodeSymbols(
  code: string,
  language: string,
): string[] {
  const symbols: string[] = [];
  const lang = language.toLowerCase();

  // TypeScript/JavaScript patterns
  if (["typescript", "javascript", "ts", "js", "tsx", "jsx"].includes(lang)) {
    // Function declarations
    const funcDecl = /function\s+(\w+)/g;
    let match;
    while ((match = funcDecl.exec(code)) !== null) {
      symbols.push(match[1]);
    }

    // Arrow functions and const/let/var assignments
    const varFunc = /(?:const|let|var)\s+(\w+)\s*=/g;
    while ((match = varFunc.exec(code)) !== null) {
      symbols.push(match[1]);
    }

    // Class declarations
    const classDecl = /class\s+(\w+)/g;
    while ((match = classDecl.exec(code)) !== null) {
      symbols.push(match[1]);
    }

    // Interface/type declarations
    const typeDecl = /(?:interface|type)\s+(\w+)/g;
    while ((match = typeDecl.exec(code)) !== null) {
      symbols.push(match[1]);
    }

    // Export declarations
    const exportDecl = /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type)\s+(\w+)/g;
    while ((match = exportDecl.exec(code)) !== null) {
      symbols.push(match[1]);
    }
  }

  // Python patterns
  if (["python", "py"].includes(lang)) {
    // Function definitions
    const defFunc = /def\s+(\w+)/g;
    let match;
    while ((match = defFunc.exec(code)) !== null) {
      symbols.push(match[1]);
    }

    // Class definitions
    const defClass = /class\s+(\w+)/g;
    while ((match = defClass.exec(code)) !== null) {
      symbols.push(match[1]);
    }
  }

  // Go patterns
  if (["go", "golang"].includes(lang)) {
    // Function definitions
    const goFunc = /func\s+(?:\([^)]+\)\s+)?(\w+)/g;
    let match;
    while ((match = goFunc.exec(code)) !== null) {
      symbols.push(match[1]);
    }

    // Type definitions
    const goType = /type\s+(\w+)/g;
    while ((match = goType.exec(code)) !== null) {
      symbols.push(match[1]);
    }
  }

  // Rust patterns
  if (["rust", "rs"].includes(lang)) {
    // Function definitions
    const rustFn = /fn\s+(\w+)/g;
    let match;
    while ((match = rustFn.exec(code)) !== null) {
      symbols.push(match[1]);
    }

    // Struct/enum definitions
    const rustStruct = /(?:struct|enum|trait|impl)\s+(\w+)/g;
    while ((match = rustStruct.exec(code)) !== null) {
      symbols.push(match[1]);
    }
  }

  // Java/Kotlin patterns
  if (["java", "kotlin", "kt"].includes(lang)) {
    // Class/interface definitions
    const javaClass = /(?:class|interface|enum)\s+(\w+)/g;
    let match;
    while ((match = javaClass.exec(code)) !== null) {
      symbols.push(match[1]);
    }

    // Method definitions
    const javaMethod = /(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\(/g;
    while ((match = javaMethod.exec(code)) !== null) {
      symbols.push(match[1]);
    }
  }

  // Remove duplicates
  return [...new Set(symbols)];
}

// ============ Internal Types ============

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

interface SectionBuffer {
  title: string;
  level: number;
  blocks: TiptapNode[];
  fullText: string;
}

// ============ Internal Helper Functions ============

function createDocumentEntry(
  userId: string,
  projectKey: string,
  docId: string,
  title: string,
  fullText: string,
  parentPath: string[],
  timestamp: number,
): IndexEntry {
  const summary =
    fullText.length > MAX_DOCUMENT_SUMMARY_LENGTH
      ? fullText.slice(0, MAX_DOCUMENT_SUMMARY_LENGTH) + "..."
      : fullText;

  return {
    id: `${docId}:document`,
    doc_id: docId,
    user_id: userId,
    project_key: projectKey,
    granularity: "document",
    content: summary,
    metadata: {
      title,
      path: parentPath,
    },
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function createBlockEntry(
  userId: string,
  projectKey: string,
  docId: string,
  blockId: string,
  content: string,
  path: string[],
  timestamp: number,
): IndexEntry {
  const trimmedContent =
    content.length > MAX_BLOCK_LENGTH
      ? content.slice(0, MAX_BLOCK_LENGTH) + "..."
      : content;

  return {
    id: `${docId}:block:${blockId || uuidv4().slice(0, 8)}`,
    doc_id: docId,
    user_id: userId,
    project_key: projectKey,
    granularity: "block",
    content: trimmedContent,
    metadata: {
      block_id: blockId || undefined,
      path,
    },
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function createCodeEntry(
  userId: string,
  projectKey: string,
  docId: string,
  node: TiptapNode,
  path: string[],
  timestamp: number,
): IndexEntry {
  const code = extractNodeText(node);
  const language = (node.attrs?.language as string) || "text";
  const blockId = getNodeId(node);
  const symbols = extractCodeSymbols(code, language);

  return {
    id: `${docId}:code:${blockId || uuidv4().slice(0, 8)}`,
    doc_id: docId,
    user_id: userId,
    project_key: projectKey,
    granularity: "code",
    content: code,
    metadata: {
      block_id: blockId || undefined,
      language,
      symbols,
      path,
    },
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function finalizeSectionEntry(
  userId: string,
  projectKey: string,
  docId: string,
  section: SectionBuffer,
  path: string[],
  timestamp: number,
): IndexEntry {
  const content =
    section.fullText.length > MAX_SECTION_LENGTH
      ? section.fullText.slice(0, MAX_SECTION_LENGTH) + "..."
      : section.fullText;

  return {
    id: `${docId}:section:${slugify(section.title)}`,
    doc_id: docId,
    user_id: userId,
    project_key: projectKey,
    granularity: "section",
    content: content.trim(),
    metadata: {
      title: section.title,
      level: section.level,
      path,
    },
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function extractFullText(nodes: TiptapNode[]): string {
  const parts: string[] = [];

  for (const node of nodes) {
    parts.push(extractNodeText(node));
  }

  return parts.join("\n").trim();
}

function extractNodeText(node: TiptapNode): string {
  if (!node) return "";

  // Text node
  if (node.type === "text") {
    return node.text || "";
  }

  // Hard break
  if (node.type === "hardBreak") {
    return "\n";
  }

  // Horizontal rule (page divider)
  if (node.type === "horizontalRule") {
    return "\n---\n";
  }

  // Recursively extract from children
  if (node.content && Array.isArray(node.content)) {
    const childTexts = node.content.map((child) => extractNodeText(child));
    return childTexts.join("");
  }

  return "";
}

function isHeadingNode(node: TiptapNode): boolean {
  return node.type === "heading";
}

function isSignificantHeading(node: TiptapNode): boolean {
  const level = node.attrs?.level as number;
  return HEADING_LEVELS_FOR_SECTIONS.includes(level);
}

function shouldIndexAsBlock(node: TiptapNode): boolean {
  // Index paragraphs, blockquotes, list items
  const indexableTypes = [
    "paragraph",
    "blockquote",
    "listItem",
    "taskItem",
  ];

  if (!indexableTypes.includes(node.type)) {
    return false;
  }

  // Only index if it has meaningful content
  const text = extractNodeText(node).trim();
  return text.length > 20; // Minimum content threshold
}

function getNodeId(node: TiptapNode): string {
  return (node.attrs?.id as string) || "";
}

function updateSectionStack(
  stack: string[],
  newTitle: string,
  level: number,
  basePath: string[],
): void {
  // Keep base path + adjust based on heading level
  const keepCount = basePath.length + level;
  while (stack.length > keepCount) {
    stack.pop();
  }
  stack.push(newTitle);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);
}

/**
 * Get statistics about chunk results
 */
export function getChunkStats(result: ChunkResult): {
  documentChunks: number;
  sectionChunks: number;
  blockChunks: number;
  codeChunks: number;
  totalChunks: number;
} {
  return {
    documentChunks: 1,
    sectionChunks: result.sections.length,
    blockChunks: result.blocks.length,
    codeChunks: result.codes.length,
    totalChunks:
      1 + result.sections.length + result.blocks.length + result.codes.length,
  };
}

/**
 * Flatten chunk result into a single array of entries
 */
export function flattenChunkResult(result: ChunkResult): IndexEntry[] {
  return [
    result.document,
    ...result.sections,
    ...result.blocks,
    ...result.codes,
  ].filter(Boolean);
}
