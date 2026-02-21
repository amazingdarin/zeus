import type { SkillIntent, SkillStreamChunk } from "../types.js";
import { documentStore } from "../../../storage/document-store.js";
import { knowledgeSearch } from "../../../knowledge/search.js";
import { notifyDocumentMoved } from "../../../knowledge/tree-sync.js";
import { tiptapJsonToMarkdown } from "../../../utils/markdown.js";
import { extractTiptapDoc } from "../../../utils/tiptap-content.js";
import { inspectDocumentSnapshot } from "../../../services/document-inspect.js";

/**
 * Basic document skills (read / move / delete)
 *
 * These operations are either read-only or deterministic storage mutations.
 * They do not invoke the LLM.
 */

/**
 * Execute doc-read skill
 */
export async function* executeDocRead(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
): AsyncGenerator<SkillStreamChunk> {
  const docId =
    (intent.docIds && intent.docIds.length > 0)
      ? intent.docIds[0]
      : (typeof intent.args.doc_id === "string" ? intent.args.doc_id : "");

  if (!docId) {
    yield { type: "error", error: "请使用 @ 指定要读取的文档" };
    return;
  }

  try {
    const doc = await documentStore.get(userId, projectKey, docId);

    // Convert to markdown for display
    const markdown =
      doc.body.type === "markdown" && typeof doc.body.content === "string"
        ? doc.body.content
        : tiptapJsonToMarkdown(extractTiptapDoc(doc.body));

    yield {
      type: "delta",
      content: `## ${doc.meta.title}\n\n${markdown}`,
    };
    yield { type: "done", message: "文档内容已读取" };
  } catch (err) {
    yield {
      type: "error",
      error: `读取文档失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/**
 * Execute doc-get skill
 */
export async function* executeDocGet(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
): AsyncGenerator<SkillStreamChunk> {
  const docId =
    typeof intent.args.doc_id === "string" && intent.args.doc_id.trim().length > 0
      ? intent.args.doc_id.trim()
      : intent.docIds?.[0];

  if (!docId) {
    yield { type: "error", error: "请通过 @ 指定文档，或传入 doc_id 参数" };
    return;
  }

  const includeContent = intent.args.include_content === true;
  const includeBlockAttrs = intent.args.include_block_attrs !== false;
  const blockTypes = normalizeStringList(intent.args.block_types);

  try {
    const snapshot = await inspectDocumentSnapshot({
      userId,
      projectKey,
      docId,
      includeContent,
      includeBlockAttrs,
      blockTypes: blockTypes.length > 0 ? blockTypes : undefined,
    });

    const lines: string[] = [
      `## ${snapshot.title}`,
      "",
      `- doc_id: \`${snapshot.docId}\``,
      `- include_content: ${includeContent ? "true" : "false"}`,
      `- include_block_attrs: ${includeBlockAttrs ? "true" : "false"}`,
      `- blocks: ${snapshot.blocks.length}`,
    ];

    if (includeBlockAttrs) {
      const previewBlocks = snapshot.blocks.slice(0, 20).map((block, index) => {
        const idPart = block.id ? ` id=${block.id}` : "";
        const attrs = JSON.stringify(block.attrs || {});
        const previewAttrs = attrs.length > 200 ? `${attrs.slice(0, 200)}...` : attrs;
        return `${index + 1}. ${block.type}${idPart}\n   attrs=${previewAttrs}`;
      });
      if (previewBlocks.length > 0) {
        lines.push("", "### Block Attrs Preview", ...previewBlocks);
      }
      if (snapshot.blocks.length > previewBlocks.length) {
        lines.push(`... 其余 ${snapshot.blocks.length - previewBlocks.length} 个 block 未展开`);
      }
    }

    if (includeContent && snapshot.body) {
      const markdown = snapshot.body.type === "markdown" && typeof snapshot.body.content === "string"
        ? snapshot.body.content
        : tiptapJsonToMarkdown(extractTiptapDoc(snapshot.body));
      lines.push("", "### Body", "", markdown);
    }

    yield {
      type: "delta",
      content: lines.join("\n"),
    };
    yield {
      type: "done",
      message: includeContent ? "文档快照已返回（含正文）" : "文档快照已返回（meta-only）",
    };
  } catch (err) {
    yield {
      type: "error",
      error: `doc-get 失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute doc-move skill
 */
export async function* executeDocMove(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
): AsyncGenerator<SkillStreamChunk> {
  const docId =
    typeof intent.args.doc_id === "string" ? intent.args.doc_id : intent.docIds?.[0];
  const targetParentId = String(intent.args.target_parent_id || "").trim() || "root";
  const beforeDocId =
    typeof intent.args.before_doc_id === "string" ? intent.args.before_doc_id : undefined;
  const afterDocId =
    typeof intent.args.after_doc_id === "string" ? intent.args.after_doc_id : undefined;

  if (!docId) {
    yield { type: "error", error: "请通过 @ 指定要移动的文档，或提供 doc_id 参数" };
    return;
  }

  try {
    const normalizeParentId = (id: string | null | undefined): string | null => {
      const value = (id ?? "").trim();
      if (!value || value === "root") return null;
      return value;
    };

    const before = await documentStore.get(userId, projectKey, docId);
    const oldParentId = normalizeParentId(before.meta.parent_id);
    const newParentId = normalizeParentId(targetParentId);

    await documentStore.move(userId, projectKey, docId, targetParentId, beforeDocId, afterDocId);

    if (oldParentId !== newParentId) {
      notifyDocumentMoved(userId, projectKey, docId, oldParentId, newParentId).catch(() => {
        // Ignore hierarchy sync errors; the move itself succeeded.
      });
    }

    yield {
      type: "done",
      message: `文档已移动到 ${targetParentId === "root" ? "根目录" : targetParentId}`,
    };
  } catch (err) {
    yield {
      type: "error",
      error: `移动文档失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute doc-delete skill
 */
export async function* executeDocDelete(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
): AsyncGenerator<SkillStreamChunk> {
  const docId =
    typeof intent.args.doc_id === "string" ? intent.args.doc_id : intent.docIds?.[0];
  const recursive = intent.args.recursive === true;

  if (!docId) {
    yield { type: "error", error: "请通过 @ 指定要删除的文档，或提供 doc_id 参数" };
    return;
  }

  try {
    const deletedIds = await documentStore.delete(userId, projectKey, docId, recursive);

    // Cleanup knowledge index; ignore per-doc cleanup failures.
    await Promise.all(
      deletedIds.map((id) =>
        knowledgeSearch.removeDocument(userId, projectKey, id).catch(() => {}),
      ),
    );

    yield {
      type: "done",
      message: `已删除 ${deletedIds.length} 个文档`,
    };
  } catch (err) {
    yield {
      type: "error",
      error: `删除文档失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
