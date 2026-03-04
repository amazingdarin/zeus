import type { JSONContent } from "@tiptap/core";

import type { Document } from "../../storage/types.js";
import { assertDocumentUnlocked } from "../document-lock.js";
import type { CodeExecLanguage } from "./types.js";

const ALLOWED_LANGUAGES = new Set<CodeExecLanguage>([
  "python",
  "javascript",
  "bash",
]);

export class CodeExecGuardError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "CodeExecGuardError";
    this.code = code;
    this.status = status;
  }
}

export type AssertExecutableCodeBlockInput = {
  doc: Document;
  blockId: string;
  language: string;
  code: string;
};

export type ExecutableCodeBlockPayload = {
  blockId: string;
  language: CodeExecLanguage;
  code: string;
};

function toGuardError(code: string, message: string, status: number): CodeExecGuardError {
  return new CodeExecGuardError(code, message, status);
}

function findBlockById(content: unknown, blockId: string): JSONContent | null {
  if (!content || typeof content !== "object") {
    return null;
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      const found = findBlockById(item, blockId);
      if (found) {
        return found;
      }
    }
    return null;
  }

  const node = content as JSONContent;
  const attrs = node.attrs as Record<string, unknown> | undefined;
  if (String(attrs?.id ?? "") === blockId) {
    return node;
  }

  if (Array.isArray(node.content)) {
    return findBlockById(node.content, blockId);
  }
  return null;
}

function extractCode(node: JSONContent): string {
  if (!Array.isArray(node.content)) {
    return "";
  }
  let output = "";
  for (const child of node.content) {
    if (!child || typeof child !== "object") {
      continue;
    }
    if (child.type === "text") {
      output += String((child as { text?: unknown }).text ?? "");
      continue;
    }
    if (child.type === "hardBreak") {
      output += "\n";
      continue;
    }
  }
  return output;
}

export function assertExecutableCodeBlock(
  input: AssertExecutableCodeBlockInput,
): ExecutableCodeBlockPayload {
  assertDocumentUnlocked(input.doc.meta);

  const normalizedBlockId = String(input.blockId ?? "").trim();
  if (!normalizedBlockId) {
    throw toGuardError("BLOCK_NOT_FOUND", "block id is required", 404);
  }

  const normalizedLanguage = String(input.language ?? "").trim() as CodeExecLanguage;
  if (!ALLOWED_LANGUAGES.has(normalizedLanguage)) {
    throw toGuardError("LANG_NOT_ALLOWED", "language is not executable", 400);
  }

  const block = findBlockById(input.doc.body.content, normalizedBlockId);
  if (!block) {
    throw toGuardError("BLOCK_NOT_FOUND", "block not found", 404);
  }
  if (block.type !== "codeBlock") {
    throw toGuardError("BLOCK_NOT_EXECUTABLE", "target block is not codeBlock", 400);
  }

  const blockCode = extractCode(block);
  if (blockCode !== input.code) {
    throw toGuardError("CODE_MISMATCH", "request code does not match document block", 409);
  }

  return {
    blockId: normalizedBlockId,
    language: normalizedLanguage,
    code: blockCode,
  };
}

