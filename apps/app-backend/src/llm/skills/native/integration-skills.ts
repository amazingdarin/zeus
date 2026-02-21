import type { SkillIntent, SkillStreamChunk } from "../types.js";
import type { TraceContext } from "../../../observability/index.js";
import { knowledgeSearch } from "../../../knowledge/search.js";
import { fetchUrl } from "../../../services/fetch-url.js";
import { createImportGitTask } from "../../../services/import-git-task.js";
import { convertDocument } from "../../../services/convert.js";
import { importAssetAsDocument } from "../../../services/smart-import.js";
import {
  collectDocTree,
  fetchSummaries,
  classifyDocs,
  proposeStructure,
  buildOrganizePlan,
  formatPlanAsMarkdown,
} from "../../../services/organize.js";

// Document Organize Skill
// ============================================================================

const ORGANIZE_MAX_DOCS = 500;

/**
 * Execute doc-organize skill
 *
 * Analyses document tree using titles + knowledge-index summaries (no full
 * content loading), asks LLM to categorize & propose a new directory
 * structure, then yields an organize_plan chunk so chat.ts can handle
 * the confirmation / auto-apply logic.
 */
export async function* executeDocOrganize(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  const rootId = (intent.docIds?.[0] || (intent.args.doc_id as string) || "root").trim() || "root";

  yield { type: "thinking", content: "正在扫描文档结构..." };

  try {
    // 1. Collect document tree (titles only – zero file I/O)
    const docs = await collectDocTree(userId, projectKey, rootId);

    if (docs.length === 0) {
      yield { type: "done", message: "该目录下没有文档，无需整理。" };
      return;
    }

    if (docs.length > ORGANIZE_MAX_DOCS) {
      yield {
        type: "error",
        error: `文档数量 (${docs.length}) 超过上限 (${ORGANIZE_MAX_DOCS})，请指定一个更小的目录范围。`,
      };
      return;
    }

    yield { type: "thinking", content: `共扫描到 ${docs.length} 篇文档，正在获取摘要...` };

    // 2. Fetch pre-computed summaries from knowledge_index
    const leafDocs = docs.filter((d) => d.kind !== "dir");
    const summaryMap = await fetchSummaries(userId, projectKey, leafDocs.map((d) => d.id));
    for (const doc of docs) {
      doc.summary = summaryMap.get(doc.id) || "";
    }

    yield { type: "thinking", content: `正在分析 ${leafDocs.length} 篇文档的类别...` };

    // 3. Classify documents via LLM (batched)
    const categories = await classifyDocs(leafDocs);

    yield { type: "thinking", content: "正在规划新目录结构..." };

    // 4. Propose new directory structure via LLM
    const existingDirs = docs.filter((d) => d.kind === "dir");
    const proposal = await proposeStructure(leafDocs, categories, existingDirs);

    // 5. Build the plan (computes moves & new folders)
    const plan = await buildOrganizePlan(userId, projectKey, rootId, docs, categories, proposal);

    // 6. Stream the formatted plan
    const markdown = formatPlanAsMarkdown(plan);
    yield { type: "delta", content: markdown };

    // 7. Yield organize_plan for chat.ts to handle confirmation/auto-apply
    if (plan.moves.length > 0 || plan.newFolders.length > 0) {
      yield { type: "organize_plan", plan };
    }

    yield { type: "done", message: "文档整理方案已生成" };
  } catch (err) {
    yield {
      type: "error",
      error: `文档整理失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute kb-search skill
 */
export async function* executeKbSearch(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
): AsyncGenerator<SkillStreamChunk> {
  const queryText = String(intent.args.query || intent.rawMessage || "").trim();
  const limitInput = Number(intent.args.limit || 5);
  const limit = Number.isFinite(limitInput)
    ? Math.max(1, Math.min(20, Math.floor(limitInput)))
    : 5;

  if (!queryText) {
    yield { type: "error", error: "请输入搜索关键词（query）" };
    return;
  }

  try {
    const results = await knowledgeSearch.search(userId, projectKey, {
      text: queryText,
      mode: "hybrid",
      limit,
      doc_ids: intent.docIds,
    });

    if (results.length === 0) {
      yield { type: "done", message: "未检索到相关内容" };
      return;
    }

    const lines = results.map((r, index) => {
      const title = r.metadata?.title || r.doc_id;
      return `${index + 1}. ${title}\n${r.snippet}`;
    });

    yield {
      type: "delta",
      content: `检索到 ${results.length} 条结果：\n\n${lines.join("\n\n---\n\n")}`,
    };
    yield { type: "done", message: "知识库检索完成" };
  } catch (err) {
    yield {
      type: "error",
      error: `知识库检索失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute doc-fetch-url skill
 */
export async function* executeDocFetchUrl(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
): AsyncGenerator<SkillStreamChunk> {
  const targetUrl = String(intent.args.url || "").trim();
  if (!targetUrl) {
    yield { type: "error", error: "url 参数不能为空" };
    return;
  }

  try {
    const result = await fetchUrl(userId, projectKey, targetUrl);
    const snippet = result.html.slice(0, 2000);
    yield {
      type: "delta",
      content: `已抓取 ${result.url}\n\nHTML 片段（前 2000 字符）：\n\`\`\`html\n${snippet}\n\`\`\``,
    };
    yield { type: "done", message: "URL 抓取完成" };
  } catch (err) {
    yield {
      type: "error",
      error: `URL 抓取失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute doc-import-git skill
 */
export async function* executeDocImportGit(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  const repoUrl = String(intent.args.repo_url || "").trim();
  const branch = String(intent.args.branch || "main").trim() || "main";
  const parentId = String(intent.args.parent_id || intent.docIds?.[0] || "root");

  if (!repoUrl) {
    yield { type: "error", error: "repo_url 参数不能为空" };
    return;
  }

  yield { type: "thinking", content: "正在创建 Git 导入任务..." };
  try {
    const { taskId } = await createImportGitTask(userId, projectKey, {
      repo_url: repoUrl,
      branch,
      parent_id: parentId,
    }, {
      traceContext,
    });
    yield {
      type: "done",
      message: `Git 导入任务已创建（task_id=${taskId}），可在消息中心查看进度。`,
    };
  } catch (err) {
    yield {
      type: "error",
      error: `Git 导入失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute doc-smart-import skill
 */
export async function* executeDocSmartImport(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
  traceContext?: TraceContext,
): AsyncGenerator<SkillStreamChunk> {
  const assetId = String(intent.args.asset_id || "").trim();
  const parentId = String(intent.args.parent_id || "root").trim() || "root";
  const title =
    typeof intent.args.title === "string" && intent.args.title.trim()
      ? intent.args.title.trim()
      : undefined;
  const enableFormatOptimize = intent.args.enable_format_optimize === true;

  if (!assetId) {
    yield { type: "error", error: "asset_id 参数不能为空" };
    return;
  }

  yield { type: "thinking", content: "正在解析附件并导入为文档..." };
  try {
    const result = await importAssetAsDocument(userId, projectKey, {
      assetId,
      parentId,
      title,
      smartImport: true,
      smartImportTypes: ["markdown", "word", "pdf", "image"],
      enableFormatOptimize,
      traceContext,
      traceMetadata: {
        source: "chat-skill",
        skill: "doc-smart-import",
      },
    });

    yield {
      type: "done",
      message: `附件已导入为文档「${result.title}」（id: ${result.docId}，mode: ${result.mode}）`,
    };
  } catch (err) {
    yield {
      type: "error",
      error: `附件导入失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Execute doc-convert skill
 */
export async function* executeDocConvert(
  userId: string,
  projectKey: string,
  intent: SkillIntent,
): AsyncGenerator<SkillStreamChunk> {
  const from = String(intent.args.from || "").trim().toLowerCase();
  const to = String(intent.args.to || "markdown").trim().toLowerCase();
  const content = String(intent.args.content || "").trim();

  if (!from || !content) {
    yield { type: "error", error: "from 与 content 参数不能为空" };
    return;
  }

  try {
    const fakeFile = {
      fieldname: "file",
      originalname: `input.${from}`,
      encoding: "7bit",
      mimetype: "text/plain",
      size: Buffer.byteLength(content),
      destination: "",
      filename: "",
      path: "",
      buffer: Buffer.from(content, "utf-8"),
      stream: undefined as unknown as NodeJS.ReadableStream,
    } as Express.Multer.File;

    const converted = await convertDocument(userId, projectKey, fakeFile, from, to);
    yield { type: "delta", content: converted.content };
    yield { type: "done", message: `内容已转换为 ${to}` };
  } catch (err) {
    yield {
      type: "error",
      error: `内容转换失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
