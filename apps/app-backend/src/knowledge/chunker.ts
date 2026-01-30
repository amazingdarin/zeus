import type { Document, BlockChunk } from "../storage/types.js";

const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_OVERLAP = 100;

/**
 * Build chunks from a document for embedding
 */
export function buildChunks(doc: Document): BlockChunk[] {
  if (!doc) return [];

  const blocks = extractBlocks(doc.body.content);

  if (blocks.length === 0) {
    const text = extractDocumentText(doc).trim();
    if (!text) return [];
    return [
      {
        doc_id: doc.meta.id,
        block_id: "",
        chunk_index: 0,
        content: text,
      },
    ];
  }

  const chunks: BlockChunk[] = [];

  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) continue;

    if ([...text].length <= DEFAULT_CHUNK_SIZE) {
      chunks.push({
        doc_id: doc.meta.id,
        block_id: block.id,
        chunk_index: 0,
        content: text,
      });
      continue;
    }

    const parts = splitWithOverlap(text, DEFAULT_CHUNK_SIZE, DEFAULT_OVERLAP);
    for (let idx = 0; idx < parts.length; idx++) {
      chunks.push({
        doc_id: doc.meta.id,
        block_id: block.id,
        chunk_index: idx,
        content: parts[idx],
      });
    }
  }

  return chunks;
}

interface BlockText {
  id: string;
  text: string;
}

/**
 * Extract blocks from Tiptap content
 */
function extractBlocks(content: unknown): BlockText[] {
  const blocks: BlockText[] = [];
  collectBlocks(content, blocks);
  return blocks;
}

/**
 * Recursively collect block nodes
 */
function collectBlocks(node: unknown, blocks: BlockText[]): void {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const child of node) {
      collectBlocks(child, blocks);
    }
    return;
  }

  const nodeObj = node as Record<string, unknown>;

  if (isBlockNode(nodeObj)) {
    const text = collectText(nodeObj).trim();
    if (text) {
      blocks.push({
        id: getNodeAttrId(nodeObj),
        text,
      });
    }
    return;
  }

  if (nodeObj.content) {
    collectBlocks(nodeObj.content, blocks);
  }
}

/**
 * Check if a node is a block-level node
 */
function isBlockNode(node: Record<string, unknown>): boolean {
  if (!node || !node.type) return false;
  const nodeType = node.type as string;
  return ["paragraph", "heading", "codeBlock", "blockquote", "listItem", "taskItem"].includes(
    nodeType,
  );
}

/**
 * Get the id attribute from a node
 */
function getNodeAttrId(node: Record<string, unknown>): string {
  const attrs = node.attrs as Record<string, unknown> | undefined;
  if (!attrs) return "";
  const id = attrs.id;
  if (typeof id === "string") return id.trim();
  return "";
}

/**
 * Collect text content from a node
 */
function collectText(node: Record<string, unknown>): string {
  let result = "";
  collectTextInto(node, (s) => {
    result += s;
  });
  return result;
}

/**
 * Recursively collect text into a builder
 */
function collectTextInto(
  node: Record<string, unknown>,
  append: (s: string) => void,
): void {
  if (!node) return;

  if (node.type === "text") {
    const text = node.text;
    if (typeof text === "string") {
      append(text);
    }
  }

  if (node.type === "hardBreak") {
    append("\n");
  }

  const content = node.content;
  if (Array.isArray(content)) {
    for (const child of content) {
      if (child && typeof child === "object") {
        collectTextInto(child as Record<string, unknown>, append);
      }
    }
  }
}

/**
 * Split text into overlapping chunks
 */
function splitWithOverlap(text: string, size: number, overlap: number): string[] {
  const runes = [...text];
  if (runes.length === 0) return [];
  if (size <= 0) return [text];
  if (overlap < 0) overlap = 0;

  const step = size - overlap;
  const effectiveStep = step <= 0 ? size : step;

  const chunks: string[] = [];
  for (let start = 0; start < runes.length; start += effectiveStep) {
    const end = Math.min(start + size, runes.length);
    chunks.push(runes.slice(start, end).join(""));
    if (end === runes.length) break;
  }

  return chunks;
}

/**
 * Extract plain text from a document
 */
export function extractDocumentText(doc: Document): string {
  if (!doc?.body?.content) return "";

  if (doc.body.type === "markdown") {
    return typeof doc.body.content === "string" ? doc.body.content : "";
  }

  // Tiptap content
  return collectText(doc.body.content as Record<string, unknown>);
}
