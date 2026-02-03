/**
 * Deep Search Engine
 *
 * Implements multi-round search with question decomposition,
 * iterative search, and answer synthesis.
 *
 * Flow:
 * 1. Question Decomposition: LLM splits complex query into 2-5 sub-questions
 * 2. Iterative Search: Search knowledge base for each sub-question
 * 3. Result Evaluation: LLM determines if results are sufficient
 * 4. Web Search (optional): Search web if knowledge base results insufficient
 * 5. Answer Synthesis: LLM combines all results into comprehensive answer
 */

import { llmGateway, configStore, type ProviderConfigInternal } from "../llm/index.js";
import { knowledgeSearch } from "../knowledge/search.js";
import type { SearchResult } from "../storage/types.js";
import type { SourceReference } from "./chat.js";

// ============================================================================
// Types
// ============================================================================

export type DeepSearchConfig = {
  maxIterations: number;      // Maximum search rounds (default: 3)
  kbResultThreshold: number;  // Minimum KB results to skip web search (default: 3)
  enableWebSearch: boolean;   // Enable web search fallback
  maxSubQueries: number;      // Maximum sub-questions to generate (default: 5)
};

export type DeepSearchPhase =
  | "decompose"
  | "search_kb"
  | "evaluate"
  | "search_web"
  | "synthesize";

export type DeepSearchChunk = {
  type: "thinking" | "search_start" | "search_result" | "delta" | "done" | "error";
  phase?: DeepSearchPhase;
  content?: string;
  subQueries?: string[];
  searchQuery?: string;
  resultCount?: number;
  sources?: SourceReference[];
  message?: string;
  error?: string;
};

type SubQueryResult = {
  query: string;
  kbResults: SearchResult[];
  webResults: WebSearchResult[];
};

type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: DeepSearchConfig = {
  maxIterations: 3,
  kbResultThreshold: 3,
  enableWebSearch: true,
  maxSubQueries: 5,
};

// ============================================================================
// LLM Config Cache
// ============================================================================

let llmConfigCache: { config: ProviderConfigInternal | null; timestamp: number } | null = null;
const CONFIG_CACHE_TTL = 60 * 1000; // 1 minute

async function getLLMConfig(): Promise<ProviderConfigInternal | null> {
  if (llmConfigCache && Date.now() - llmConfigCache.timestamp < CONFIG_CACHE_TTL) {
    return llmConfigCache.config;
  }
  const config = await configStore.getInternalByType("llm");
  llmConfigCache = { config, timestamp: Date.now() };
  return config;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Execute deep search with multi-round search and synthesis
 */
export async function* executeDeepSearch(
  projectKey: string,
  query: string,
  docIds?: string[],
  config?: Partial<DeepSearchConfig>,
  abortSignal?: AbortSignal,
): AsyncGenerator<DeepSearchChunk> {
  const cfg: DeepSearchConfig = { ...DEFAULT_CONFIG, ...config };

  // Check LLM availability
  const llmConfig = await getLLMConfig();
  if (!llmConfig?.enabled || !llmConfig.defaultModel) {
    yield { type: "error", error: "深度搜索需要配置 LLM 服务" };
    return;
  }

  // Phase 1: Question Decomposition
  yield { type: "thinking", phase: "decompose", content: "正在分析问题..." };

  let subQueries: string[];
  try {
    subQueries = await decomposeQuery(llmConfig, query, cfg.maxSubQueries);
    yield {
      type: "thinking",
      phase: "decompose",
      content: `已将问题分解为 ${subQueries.length} 个子问题`,
      subQueries,
    };
  } catch (err) {
    // Fallback: use original query
    console.warn("[deep-search] Decomposition failed, using original query:", err);
    subQueries = [query];
  }

  if (abortSignal?.aborted) return;

  // Phase 2: Iterative Search
  const allResults: SubQueryResult[] = [];
  const allSources: SourceReference[] = [];

  for (let i = 0; i < subQueries.length; i++) {
    const subQuery = subQueries[i];

    if (abortSignal?.aborted) return;

    yield {
      type: "search_start",
      phase: "search_kb",
      content: `正在搜索: ${subQuery}`,
      searchQuery: subQuery,
    };

    // Search knowledge base
    let kbResults: SearchResult[] = [];
    try {
      kbResults = await knowledgeSearch.search(projectKey, projectKey, {
        text: subQuery,
        mode: "hybrid",
        limit: 5,
        doc_ids: docIds,
      });
    } catch (err) {
      console.warn("[deep-search] KB search failed for:", subQuery, err);
    }

    yield {
      type: "search_result",
      phase: "search_kb",
      content: `知识库找到 ${kbResults.length} 条结果`,
      searchQuery: subQuery,
      resultCount: kbResults.length,
    };

    // Collect KB sources
    for (const r of kbResults) {
      allSources.push({
        type: "kb",
        docId: r.doc_id,
        blockId: r.block_id,
        title: r.metadata?.title || r.doc_id,
        snippet: r.snippet,
        score: r.score,
      });
    }

    // Phase 3: Evaluate and optionally search web
    let webResults: WebSearchResult[] = [];

    if (cfg.enableWebSearch) {
      if (abortSignal?.aborted) return;

      // Determine if we need web search
      let needWebSearch = false;
      let reason = "";

      if (kbResults.length < cfg.kbResultThreshold) {
        // Not enough KB results
        needWebSearch = true;
        reason = `知识库结果不足 (${kbResults.length} < ${cfg.kbResultThreshold})`;
      } else {
        // Check relevance of KB results
        yield {
          type: "thinking",
          phase: "evaluate",
          content: `正在评估知识库结果的相关性...`,
        };

        const relevance = await evaluateResultRelevance(
          llmConfig,
          subQuery,
          kbResults,
        );

        if (!relevance.isRelevant) {
          needWebSearch = true;
          reason = relevance.reason || "知识库结果与问题不相关";
        }
      }

      if (needWebSearch) {
        yield {
          type: "thinking",
          phase: "evaluate",
          content: reason + "，尝试网络搜索...",
        };

        // Import web search dynamically to avoid circular dependency
        try {
          const { webSearch } = await import("./web-search.js");
          yield {
            type: "search_start",
            phase: "search_web",
            content: `网络搜索: ${subQuery}`,
            searchQuery: subQuery,
          };

          webResults = await webSearch(subQuery, { limit: 3 });

          // Collect web sources
          for (const wr of webResults) {
            allSources.push({
              type: "web",
              url: wr.url,
              title: wr.title,
              snippet: wr.snippet,
              score: 0.5,  // Default score for web results
            });
          }

          yield {
            type: "search_result",
            phase: "search_web",
            content: `网络找到 ${webResults.length} 条结果`,
            searchQuery: subQuery,
            resultCount: webResults.length,
          };
        } catch (err) {
          console.warn("[deep-search] Web search failed:", err);
          yield {
            type: "thinking",
            phase: "search_web",
            content: "网络搜索未配置或失败，跳过",
          };
        }
      }
    }

    allResults.push({
      query: subQuery,
      kbResults,
      webResults,
    });
  }

  if (abortSignal?.aborted) return;

  // Deduplicate sources
  const uniqueSources = deduplicateSources(allSources);

  // Phase 4: Answer Synthesis
  yield { type: "thinking", phase: "synthesize", content: "正在整合答案..." };

  try {
    const answerStream = synthesizeAnswer(llmConfig, query, allResults);

    let fullAnswer = "";
    for await (const chunk of answerStream) {
      if (abortSignal?.aborted) return;

      fullAnswer += chunk;
      yield { type: "delta", phase: "synthesize", content: chunk };
    }

    yield {
      type: "done",
      phase: "synthesize",
      message: fullAnswer,
      sources: uniqueSources,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "答案整合失败";
    yield { type: "error", error: errorMessage };
  }
}

// ============================================================================
// Question Decomposition
// ============================================================================

const DECOMPOSE_PROMPT = `你是一个搜索助手。请将以下复杂问题分解为 2-5 个独立的子问题，每个子问题应该可以单独搜索。

注意:
1. 如果问题已经足够简单，可以只返回原问题
2. 子问题应该覆盖原问题的所有方面
3. 子问题应该互相独立，避免重复

用户问题: {query}

请严格按照以下 JSON 格式输出，不要添加任何其他内容:
{"subQueries": ["子问题1", "子问题2", ...]}`;

async function decomposeQuery(
  config: ProviderConfigInternal,
  query: string,
  maxSubQueries: number,
): Promise<string[]> {
  const prompt = DECOMPOSE_PROMPT.replace("{query}", query);

  const response = await llmGateway.chat({
    provider: config.providerId,
    model: config.defaultModel!,
    messages: [
      { role: "system", content: "You are a helpful assistant that outputs valid JSON only." },
      { role: "user", content: prompt },
    ],
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    temperature: 0.3,
  });

  // Parse JSON response
  const text = response.content.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Invalid JSON response from LLM");
  }

  const parsed = JSON.parse(jsonMatch[0]) as { subQueries: string[] };
  if (!Array.isArray(parsed.subQueries)) {
    throw new Error("Invalid subQueries format");
  }

  // Limit number of sub-queries
  return parsed.subQueries.slice(0, maxSubQueries);
}

// ============================================================================
// Result Relevance Evaluation
// ============================================================================

const RELEVANCE_PROMPT = `你是一个搜索结果评估助手。请判断以下知识库搜索结果是否与用户问题相关。

用户问题: {query}

知识库搜索结果摘要:
{snippets}

请评估这些结果是否能够回答用户的问题。注意：
1. 如果问题涉及实时信息（如"今天"、"最新"、"当前"等），而结果是静态文档，则视为不相关
2. 如果问题领域与结果完全不匹配，则视为不相关
3. 如果结果只是偶然包含相同关键词但内容不相关，则视为不相关

请严格按照以下 JSON 格式输出:
{"isRelevant": true/false, "reason": "简短说明原因"}`;

async function evaluateResultRelevance(
  config: ProviderConfigInternal,
  query: string,
  results: SearchResult[],
): Promise<{ isRelevant: boolean; reason?: string }> {
  // Build snippets summary
  const snippets = results
    .slice(0, 5)  // Only evaluate top 5 results
    .map((r, i) => `${i + 1}. ${r.metadata?.title || "无标题"}: ${r.snippet?.slice(0, 200) || ""}`)
    .join("\n");

  const prompt = RELEVANCE_PROMPT
    .replace("{query}", query)
    .replace("{snippets}", snippets);

  try {
    const response = await llmGateway.chat({
      provider: config.providerId,
      model: config.defaultModel!,
      messages: [
        { role: "system", content: "You are a helpful assistant that outputs valid JSON only." },
        { role: "user", content: prompt },
      ],
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      temperature: 0.1,
    });

    // Parse JSON response
    const text = response.content.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[deep-search] Failed to parse relevance evaluation:", text);
      return { isRelevant: true }; // Default to relevant if parsing fails
    }

    const parsed = JSON.parse(jsonMatch[0]) as { isRelevant: boolean; reason?: string };
    console.log("[deep-search] Relevance evaluation:", parsed);
    return parsed;
  } catch (err) {
    console.warn("[deep-search] Relevance evaluation failed:", err);
    return { isRelevant: true }; // Default to relevant if evaluation fails
  }
}

// ============================================================================
// Answer Synthesis
// ============================================================================

const SYNTHESIZE_PROMPT = `基于以下搜索结果，回答用户问题。请综合所有来源信息，给出完整、准确的回答。

用户问题: {query}

{context}

## 回答要求
1. 优先使用知识库信息
2. 网络搜索结果作为补充
3. 如果信息不足，诚实说明
4. 使用中文回答
5. 结构清晰，条理分明`;

async function* synthesizeAnswer(
  config: ProviderConfigInternal,
  originalQuery: string,
  results: SubQueryResult[],
): AsyncGenerator<string> {
  // Build context from results
  const contextParts: string[] = [];

  contextParts.push("## 知识库搜索结果");
  for (const r of results) {
    if (r.kbResults.length > 0) {
      contextParts.push(`\n### 子问题: ${r.query}`);
      for (const kr of r.kbResults) {
        const title = kr.metadata?.title || kr.doc_id;
        contextParts.push(`- [${title}]: ${kr.snippet}`);
      }
    }
  }

  const hasWebResults = results.some((r) => r.webResults.length > 0);
  if (hasWebResults) {
    contextParts.push("\n## 网络搜索结果");
    for (const r of results) {
      if (r.webResults.length > 0) {
        contextParts.push(`\n### 子问题: ${r.query}`);
        for (const wr of r.webResults) {
          contextParts.push(`- [${wr.title}](${wr.url}): ${wr.snippet}`);
        }
      }
    }
  }

  const context = contextParts.join("\n");
  const prompt = SYNTHESIZE_PROMPT
    .replace("{query}", originalQuery)
    .replace("{context}", context);

  const stream = await llmGateway.chatStream({
    provider: config.providerId,
    model: config.defaultModel!,
    messages: [
      { role: "user", content: prompt },
    ],
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  });

  for await (const chunk of stream.textStream) {
    yield chunk;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function deduplicateSources(sources: SourceReference[]): SourceReference[] {
  const seen = new Set<string>();
  const unique: SourceReference[] = [];

  for (const source of sources) {
    let key: string;
    if (source.type === "web") {
      key = `web:${source.url}`;
    } else {
      key = source.blockId
        ? `kb:${source.docId}:${source.blockId}`
        : `kb:${source.docId}`;
    }

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(source);
    }
  }

  // Sort by score descending and limit to top 15 (allow more with web results)
  return unique.sort((a, b) => b.score - a.score).slice(0, 15);
}
