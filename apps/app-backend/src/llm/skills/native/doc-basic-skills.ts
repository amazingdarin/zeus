import type { SkillIntent, SkillStreamChunk } from "../types.js";
import { documentStore } from "../../../storage/document-store.js";
import { knowledgeSearch } from "../../../knowledge/search.js";
import { notifyDocumentMoved } from "../../../knowledge/tree-sync.js";
import { tiptapJsonToMarkdown } from "../../../utils/markdown.js";
import { extractTiptapDoc } from "../../../utils/tiptap-content.js";

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
