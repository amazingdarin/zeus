/**
 * Document Organize Service
 *
 * Analyzes document tree structure using lightweight metadata and knowledge-index
 * summaries (never loading full document content), asks LLM to categorize and
 * propose a new directory structure, then applies the moves.
 */

import { v4 as uuidv4 } from "uuid";

import { documentStore } from "../storage/document-store.js";
import { knowledgeSearch } from "../knowledge/search.js";
import { indexStore } from "../knowledge/index-store.js";
import { llmGateway } from "../llm/gateway.js";
import { configStore } from "../llm/config-store.js";
import { notifyDocumentMoved } from "../knowledge/tree-sync.js";
import type { Document, TreeItem } from "../storage/types.js";
import type { OrganizeMove, OrganizePlan, OrganizeProposal } from "../llm/skills/types.js";

// ── Constants ──────────────────────────────────────────────────────────

const MAX_DOCS = 500;
const MAX_DEPTH = 10;
const BATCH_SIZE = 50;
const SUMMARY_TRUNCATE = 200;

// ── Internal types ─────────────────────────────────────────────────────

export type DocInfo = {
  id: string;
  title: string;
  parentId: string;
  kind: "file" | "dir";
  summary: string;
};

type CategoryResult = { id: string; category: string };

// ── Collect document tree (titles only, zero file I/O) ─────────────────

export async function collectDocTree(
  userId: string,
  projectKey: string,
  rootId: string,
): Promise<DocInfo[]> {
  const results: DocInfo[] = [];

  async function walk(parentId: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || results.length >= MAX_DOCS) return;

    const children: TreeItem[] = await documentStore.getChildren(userId, projectKey, parentId);
    for (const child of children) {
      if (results.length >= MAX_DOCS) break;
      results.push({
        id: child.id,
        title: child.title,
        parentId: parentId === "root" ? "root" : parentId,
        kind: child.kind,
        summary: "", // filled later
      });
      if (child.kind === "dir") {
        await walk(child.id, depth + 1);
      }
    }
  }

  await walk(rootId, 0);
  return results;
}

// ── Fetch pre-computed summaries from knowledge_index ──────────────────

export async function fetchSummaries(
  userId: string,
  projectKey: string,
  docIds: string[],
): Promise<Map<string, string>> {
  const summaries = new Map<string, string>();

  // Batch fetch to avoid hammering DB
  for (let i = 0; i < docIds.length; i += BATCH_SIZE) {
    const batch = docIds.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (docId) => {
      try {
        const entries = await indexStore.getByDocument(userId, projectKey, docId, ["document"]);
        if (entries.length > 0) {
          summaries.set(docId, entries[0].content.slice(0, SUMMARY_TRUNCATE));
        }
      } catch {
        // skip – document may not be indexed yet
      }
    });
    await Promise.all(promises);
  }

  return summaries;
}

// ── LLM: classify documents in batches ────────────────────────────────

async function classifyBatch(
  docs: DocInfo[],
): Promise<CategoryResult[]> {
  const llmConfig = await configStore.getInternalByType("llm");
  if (!llmConfig) throw new Error("LLM 未配置");

  const listing = docs
    .map((d, i) => `${i + 1}. [id: ${d.id}] 标题：${d.title} | 摘要：${d.summary || "(无摘要)"}`)
    .join("\n");

  const systemPrompt = `你是一个文档分类助手。给定一组文档（标题+摘要），请为每篇文档分配一个简短的分类标签（2-6 个字）。
分类应基于文档内容的主题领域，尽量合并相似主题，避免过于细化。
只输出 JSON 数组，不要任何其它文字。`;

  const userPrompt = `请为以下文档分配分类标签：

${listing}

输出格式（JSON 数组）：
[{"id":"文档ID","category":"分类标签"}, ...]`;

  const result = await llmGateway.chat({
    provider: llmConfig.providerId,
    model: llmConfig.defaultModel || "gpt-4o",
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
  });

  const text = typeof result === "string" ? result : (result as { content?: string }).content ?? "";
  return parseJsonFromLLM<CategoryResult[]>(text, []);
}

export async function classifyDocs(
  docs: DocInfo[],
): Promise<Map<string, string>> {
  const categories = new Map<string, string>();

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const results = await classifyBatch(batch);
    for (const r of results) {
      if (r.id && r.category) {
        categories.set(r.id, r.category);
      }
    }
  }

  return categories;
}

// ── LLM: propose new directory structure ──────────────────────────────

export async function proposeStructure(
  docs: DocInfo[],
  categories: Map<string, string>,
  existingDirs: DocInfo[],
): Promise<OrganizeProposal> {
  const llmConfig = await configStore.getInternalByType("llm");
  if (!llmConfig) throw new Error("LLM 未配置");

  const docList = docs
    .filter((d) => d.kind !== "dir")
    .map((d) => `- ${d.title} [id:${d.id}] → ${categories.get(d.id) || "未分类"}`)
    .join("\n");

  const dirList =
    existingDirs.length > 0
      ? existingDirs.map((d) => `- ${d.title} [id:${d.id}]`).join("\n")
      : "(无)";

  const systemPrompt = `你是一个文档结构规划助手。根据文档分类结果规划一个清晰的两层目录结构。
要求：
1. 输出 JSON 对象，格式为 { "categories": [...] }
2. 每个 category 有 name, docIds（直接放在该分类下的文档 id 数组）
3. category 可以有 children 子分类，每个子分类同样有 name + docIds
4. 如果已有的目录文档标题与分类名匹配，设置 existingDocId
5. 每个分类至少包含 2 篇文档，否则合并到其它分类或放在根层级
6. 分类层级不超过 2 层
只输出 JSON，不要任何其它文字。`;

  const userPrompt = `当前文档列表和分类：
${docList}

已有的目录文档（可复用）：
${dirList}

请设计新的目录结构。`;

  const result = await llmGateway.chat({
    provider: llmConfig.providerId,
    model: llmConfig.defaultModel || "gpt-4o",
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
  });

  const text = typeof result === "string" ? result : (result as { content?: string }).content ?? "";
  const raw = parseJsonFromLLM<OrganizeProposal>(text, { categories: [] });
  return sanitizeProposal(raw);
}

// ── Compute move operations ───────────────────────────────────────────

export function computeMoves(
  proposal: OrganizeProposal,
  currentParents: Map<string, string>,
  folderIdMap: Map<string, string>,
  rootId: string,
): OrganizeMove[] {
  const moves: OrganizeMove[] = [];
  const docTitles = new Map<string, string>();

  // Build a map of doc titles from currentParents context
  // (We already have DocInfo[] at the call site; titles are passed through folderIdMap keys)

  function addMoves(docIds: string[], targetParentId: string): void {
    for (const docId of docIds) {
      const currentParent = currentParents.get(docId) || "root";
      if (currentParent !== targetParentId) {
        moves.push({
          docId,
          title: docTitles.get(docId) || docId,
          targetParentId,
        });
      }
    }
  }

  for (const cat of proposal.categories || []) {
    const catParentId = cat.existingDocId || folderIdMap.get(cat.name) || rootId;
    addMoves(cat.docIds || [], catParentId);

    for (const sub of cat.children || []) {
      const subParentId = sub.existingDocId || folderIdMap.get(`${cat.name}/${sub.name}`) || catParentId;
      addMoves(sub.docIds || [], subParentId);
    }
  }

  return moves;
}

// ── Build the full organize plan ──────────────────────────────────────

export async function buildOrganizePlan(
  userId: string,
  projectKey: string,
  rootId: string,
  docs: DocInfo[],
  categories: Map<string, string>,
  proposal: OrganizeProposal,
): Promise<OrganizePlan> {
  // Current parent map
  const currentParents = new Map<string, string>();
  for (const doc of docs) {
    currentParents.set(doc.id, doc.parentId);
  }

  // Existing dir docs
  const existingDirIds = new Map<string, string>();
  for (const doc of docs) {
    if (doc.kind === "dir") {
      existingDirIds.set(doc.title, doc.id);
    }
  }

  // Collect new folder names needed
  const newFolders: string[] = [];
  const folderIdMap = new Map<string, string>();

  for (const cat of proposal.categories || []) {
    if (cat.existingDocId) {
      folderIdMap.set(cat.name, cat.existingDocId);
    } else if (existingDirIds.has(cat.name)) {
      cat.existingDocId = existingDirIds.get(cat.name);
      folderIdMap.set(cat.name, cat.existingDocId!);
    } else {
      newFolders.push(cat.name);
    }

    for (const sub of cat.children || []) {
      const subKey = `${cat.name}/${sub.name}`;
      if (sub.existingDocId) {
        folderIdMap.set(subKey, sub.existingDocId);
      } else {
        newFolders.push(subKey);
      }
    }
  }

  // Doc title map for move descriptions
  const docTitleMap = new Map<string, string>();
  for (const d of docs) {
    docTitleMap.set(d.id, d.title);
  }

  const moves = computeMoves(proposal, currentParents, folderIdMap, rootId);
  // Enrich titles
  for (const m of moves) {
    m.title = docTitleMap.get(m.docId) || m.title;
  }

  return {
    id: uuidv4(),
    userId,
    projectKey,
    rootDocId: rootId,
    proposal,
    moves,
    newFolders,
    createdAt: Date.now(),
  };
}

// ── Apply the plan: create folders then move docs ─────────────────────

export async function applyOrganizePlan(
  plan: OrganizePlan,
): Promise<{ moved: number; created: number; errors: string[] }> {
  const { userId, projectKey, rootDocId, proposal, moves } = plan;
  const errors: string[] = [];
  let created = 0;
  let moved = 0;

  // 1. Create new folder documents as needed
  const folderIdMap = new Map<string, string>();

  for (const cat of proposal.categories || []) {
    if (!cat.existingDocId) {
      try {
        const folderId = await createFolderDoc(userId, projectKey, cat.name, rootDocId);
        cat.existingDocId = folderId;
        folderIdMap.set(cat.name, folderId);
        created++;
      } catch (err) {
        errors.push(`创建目录「${cat.name}」失败: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    } else {
      folderIdMap.set(cat.name, cat.existingDocId);
    }

    for (const sub of cat.children || []) {
      if (!sub.existingDocId) {
        const parentId = cat.existingDocId || folderIdMap.get(cat.name) || rootDocId;
        try {
          const subId = await createFolderDoc(userId, projectKey, sub.name, parentId);
          sub.existingDocId = subId;
          folderIdMap.set(`${cat.name}/${sub.name}`, subId);
          created++;
        } catch (err) {
          errors.push(`创建子目录「${sub.name}」失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        folderIdMap.set(`${cat.name}/${sub.name}`, sub.existingDocId);
      }
    }
  }

  // 2. Recalculate moves with actual folder IDs
  const actualMoves = recalcMoves(proposal, folderIdMap, rootDocId);

  // 3. Execute moves
  for (const move of actualMoves) {
    try {
      const before = await documentStore.get(userId, projectKey, move.docId);
      const oldParentId = normalizeParentId(before.meta.parent_id);
      const newParentId = normalizeParentId(move.targetParentId);

      await documentStore.move(userId, projectKey, move.docId, move.targetParentId);

      if (oldParentId !== newParentId) {
        notifyDocumentMoved(userId, projectKey, move.docId, oldParentId, newParentId).catch(() => {});
      }
      moved++;
    } catch (err) {
      errors.push(`移动「${move.title}」失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { moved, created, errors };
}

// ── Format plan as readable markdown ──────────────────────────────────

export function formatPlanAsMarkdown(plan: OrganizePlan): string {
  const lines: string[] = [];
  lines.push("## 文档整理方案\n");

  if (plan.newFolders.length > 0) {
    lines.push(`**将创建 ${plan.newFolders.length} 个新目录：**`);
    for (const f of plan.newFolders) {
      lines.push(`- 📁 ${f}`);
    }
    lines.push("");
  }

  if (plan.moves.length > 0) {
    lines.push(`**将移动 ${plan.moves.length} 篇文档：**`);
    for (const m of plan.moves) {
      const target = m.targetParentId === "root" ? "根目录" : m.targetParentId;
      lines.push(`- 📄 ${m.title} → ${target}`);
    }
    lines.push("");
  }

  if (plan.moves.length === 0 && plan.newFolders.length === 0) {
    lines.push("文档已经组织良好，无需调整。\n");
  }

  lines.push("---\n");
  lines.push("**提议的目录结构：**\n");

  for (const cat of plan.proposal.categories || []) {
    lines.push(`- 📁 **${cat.name}**${cat.existingDocId ? " (已有)" : " (新建)"}`);
    for (const docId of cat.docIds || []) {
      lines.push(`  - 📄 ${docId}`);
    }
    for (const sub of cat.children || []) {
      lines.push(`  - 📁 **${sub.name}**${sub.existingDocId ? " (已有)" : " (新建)"}`);
      for (const docId of sub.docIds || []) {
        lines.push(`    - 📄 ${docId}`);
      }
    }
  }

  return lines.join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────────

function normalizeParentId(id: string | null | undefined): string | null {
  const value = (id ?? "").trim();
  if (!value || value === "root") return null;
  return value;
}

async function createFolderDoc(
  userId: string,
  projectKey: string,
  title: string,
  parentId: string,
): Promise<string> {
  const doc: Document = {
    meta: {
      id: uuidv4(),
      schema_version: "v1",
      title,
      slug: "",
      path: "",
      parent_id: parentId,
      created_at: "",
      updated_at: "",
      extra: {
        status: "draft",
        tags: [],
        doc_type: "folder",
      },
    },
    body: {
      type: "tiptap",
      content: { type: "doc", content: [] },
    },
  };

  const saved = await documentStore.save(userId, projectKey, doc);

  knowledgeSearch.indexDocument(userId, projectKey, saved).catch((err) => {
    console.error("Index error:", err);
  });

  return saved.meta.id;
}

function recalcMoves(
  proposal: OrganizeProposal,
  folderIdMap: Map<string, string>,
  rootId: string,
): OrganizeMove[] {
  const moves: OrganizeMove[] = [];

  for (const cat of proposal.categories || []) {
    const catParentId = cat.existingDocId || folderIdMap.get(cat.name) || rootId;
    for (const docId of cat.docIds || []) {
      moves.push({ docId, title: docId, targetParentId: catParentId });
    }
    for (const sub of cat.children || []) {
      const subKey = `${cat.name}/${sub.name}`;
      const subParentId = sub.existingDocId || folderIdMap.get(subKey) || catParentId;
      for (const docId of sub.docIds || []) {
        moves.push({ docId, title: docId, targetParentId: subParentId });
      }
    }
  }

  return moves;
}

function parseJsonFromLLM<T>(text: string, fallback: T): T {
  // Try to extract JSON from markdown code fences or raw text
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!jsonMatch) return fallback;

  try {
    return JSON.parse(jsonMatch[1].trim()) as T;
  } catch {
    return fallback;
  }
}

/**
 * Sanitize LLM-generated proposal to ensure all arrays are present and valid.
 * The LLM may return undefined/null/non-array for docIds or children fields.
 */
function sanitizeProposal(raw: OrganizeProposal): OrganizeProposal {
  const categories = Array.isArray(raw?.categories) ? raw.categories : [];
  return {
    categories: categories.map((cat) => ({
      name: String(cat.name || ""),
      existingDocId: cat.existingDocId || undefined,
      docIds: Array.isArray(cat.docIds) ? cat.docIds.map(String) : [],
      children: (Array.isArray(cat.children) ? cat.children : []).map((sub) => ({
        name: String(sub.name || ""),
        existingDocId: sub.existingDocId || undefined,
        docIds: Array.isArray(sub.docIds) ? sub.docIds.map(String) : [],
      })),
    })),
  };
}
