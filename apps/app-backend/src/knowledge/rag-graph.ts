/**
 * RAG Graph (LangGraph) for Multi-Strategy Retrieval
 *
 * This module implements a flexible RAG pipeline using LangGraph (JS) that supports:
 * - Basic: Direct vector/fulltext search
 * - HyDE: Hypothetical Document Embeddings
 * - Multi: Parallel multi-route retrieval with RRF fusion
 * - RAPTOR: Hierarchical tree-based retrieval
 * - Adaptive: Query-type based strategy selection
 */

import { Annotation, Command, END, START, StateGraph } from "@langchain/langgraph";
import type {
  RAGState,
  QueryType,
  RAGStrategy,
  IndexSearchResult,
  IndexSearchOptions,
} from "./types.js";
import { indexStore } from "./index-store.js";
import { llmGateway, configStore } from "../llm/index.js";

// ============================================================
// Configuration
// ============================================================

const DEFAULT_LIMIT = 10;
const RERANKER_TOP_N = 10;
const MAX_SELF_RAG_ITERATIONS = 3;

export type GraphConfig = {
  maxIterations: number;
  enableSelfRAG: boolean;
  enableReranking: boolean;
};

const DEFAULT_CONFIG: GraphConfig = {
  maxIterations: MAX_SELF_RAG_ITERATIONS,
  enableSelfRAG: true,
  enableReranking: true,
};

// LangGraph-managed state. We keep this superset internal and strip `graphConfig` from results.
/** Helper: last-value reducer with a default. Required by @langchain/langgraph ^0.2 */
function lv<T>(defaultFn: () => T) {
  return { value: (_prev: T, next: T) => next, default: defaultFn };
}

const RAGGraphState = Annotation.Root({
  query: Annotation<string>,
  userId: Annotation<string>,
  projectKey: Annotation<string>,
  docIds: Annotation<string[] | undefined>(lv<string[] | undefined>(() => undefined)),
  queryType: Annotation<QueryType>(lv<QueryType>(() => "general")),
  strategy: Annotation<RAGStrategy>(lv<RAGStrategy>(() => "adaptive")),
  transformedQuery: Annotation<string | undefined>(lv<string | undefined>(() => undefined)),
  retrievedDocs: Annotation<IndexSearchResult[]>(lv<IndexSearchResult[]>(() => [])),
  rerankedDocs: Annotation<IndexSearchResult[]>(lv<IndexSearchResult[]>(() => [])),
  sufficiency: Annotation<{ sufficient: boolean; missing?: string } | undefined>(
    lv<{ sufficient: boolean; missing?: string } | undefined>(() => undefined),
  ),
  iteration: Annotation<number>({
    value: (current: number, update: number) => current + update,
    default: () => 0,
  }),
  graphConfig: Annotation<GraphConfig>(lv<GraphConfig>(() => ({ ...DEFAULT_CONFIG }))),
});

type RAGGraphRuntimeState = typeof RAGGraphState.State;

// ============================================================
// Node Functions (State Transformers)
// ============================================================

/**
 * Classify the query type to determine the best retrieval strategy
 */
async function classifyQuery(
  state: RAGGraphRuntimeState,
): Promise<Partial<RAGGraphRuntimeState>> {
  const config = await configStore.getInternalByType("llm");
  if (!config || !config.enabled) {
    // Default to general if no LLM configured
    return {
      queryType: "general",
      strategy: "basic",
    };
  }

  try {
    const response = await llmGateway.chat({
      provider: config.providerId as Parameters<typeof llmGateway.chat>[0]["provider"],
      model: config.defaultModel || "gpt-4o-mini",
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      messages: [
        {
          role: "system",
          content: `You are a query classifier. Classify the user's query into one of these types:
- overview: Requests for summaries, outlines, or high-level understanding
- howto: Step-by-step instructions, tutorials, processes
- code: Programming questions, API usage, function lookups
- factual: Specific facts, definitions, explanations
- general: Other queries

Output only the type name, nothing else.`,
        },
        {
          role: "user",
          content: state.query,
        },
      ],
      temperature: 0,
      maxTokens: 10,
    });

    const queryType = (response.content.trim().toLowerCase() as QueryType) || "general";

    // Map query type to retrieval strategy
    const strategyMap: Record<QueryType, RAGStrategy> = {
      overview: "raptor",
      howto: "hyde",
      code: "basic",
      factual: "multi",
      general: "multi",
    };

    return {
      queryType,
      strategy: strategyMap[queryType] || "multi",
    };
  } catch (err) {
    console.warn("[RAGGraph] Query classification failed:", err);
    return {
      queryType: "general",
      strategy: "basic",
    };
  }
}

/**
 * HyDE: Generate a hypothetical document that would answer the query
 */
async function hydeTransform(
  state: RAGGraphRuntimeState,
): Promise<Partial<RAGGraphRuntimeState>> {
  const config = await configStore.getInternalByType("llm");
  if (!config || !config.enabled) {
    return { transformedQuery: state.query };
  }

  try {
    const response = await llmGateway.chat({
      provider: config.providerId as Parameters<typeof llmGateway.chat>[0]["provider"],
      model: config.defaultModel || "gpt-4o-mini",
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      messages: [
        {
          role: "system",
          content: `Generate a hypothetical document passage that would directly answer the following question. Write as if you are documenting the answer. Output only the hypothetical document content, no preamble.`,
        },
        {
          role: "user",
          content: state.query,
        },
      ],
      temperature: 0.3,
      maxTokens: 300,
    });

    return { transformedQuery: response.content.trim() };
  } catch (err) {
    console.warn("[RAGGraph] HyDE transform failed:", err);
    return { transformedQuery: state.query };
  }
}

/**
 * Basic vector retrieval
 */
async function basicRetrieve(
  state: RAGGraphRuntimeState,
): Promise<Partial<RAGGraphRuntimeState>> {
  const searchQuery = state.transformedQuery || state.query;
  const options: IndexSearchOptions = {
    limit: DEFAULT_LIMIT * 2,
    docIds: state.docIds,
  };

  // Select granularities based on query type
  switch (state.queryType) {
    case "overview":
      options.granularities = ["document", "section"];
      break;
    case "code":
      options.granularities = ["code", "block"];
      break;
    default:
      options.granularities = ["section", "block"];
  }

  const results = await indexStore.searchByVector(
    state.userId,
    state.projectKey,
    searchQuery,
    options,
  );

  return { retrievedDocs: results };
}

/**
 * Multi-route retrieval with RRF fusion
 */
async function multiRetrieve(
  state: RAGGraphRuntimeState,
): Promise<Partial<RAGGraphRuntimeState>> {
  const options: IndexSearchOptions = {
    limit: DEFAULT_LIMIT * 2,
    docIds: state.docIds,
  };

  // Run multiple retrieval strategies in parallel
  const [basicResults, hydeResults, fulltextResults] = await Promise.all([
    // Basic vector search
    indexStore.searchByVector(state.userId, state.projectKey, state.query, options),

    // HyDE search (generate hypothesis first)
    (async () => {
      const hydeState = await hydeTransform(state);
      return indexStore.searchByVector(
        state.userId,
        state.projectKey,
        hydeState.transformedQuery || state.query,
        options,
      );
    })(),

    // Full-text search
    indexStore.searchByFulltext(state.userId, state.projectKey, state.query, options),
  ]);

  // Fuse results using RRF
  const fused = indexStore.reciprocalRankFusion(
    [basicResults, hydeResults, fulltextResults],
    DEFAULT_LIMIT * 2,
  );

  return { retrievedDocs: fused };
}

/**
 * RAPTOR tree-based retrieval
 * TODO: Implement actual RAPTOR tree search
 */
async function raptorRetrieve(
  state: RAGGraphRuntimeState,
): Promise<Partial<RAGGraphRuntimeState>> {
  // For now, use document + section level search as a simplified version
  const results = await indexStore.searchByVector(
    state.userId,
    state.projectKey,
    state.query,
    {
      granularities: ["document", "section"],
      docIds: state.docIds,
      limit: DEFAULT_LIMIT * 2,
    },
  );

  return { retrievedDocs: results };
}

/**
 * Rerank results using Cohere or LLM-based reranking
 */
async function rerank(
  state: RAGGraphRuntimeState,
): Promise<Partial<RAGGraphRuntimeState>> {
  const docs = state.retrievedDocs;

  if (docs.length <= 3) {
    // Too few docs to rerank
    return { rerankedDocs: docs };
  }

  // Try Cohere reranking if API key is available
  const cohereApiKey = process.env.COHERE_API_KEY;
  if (cohereApiKey) {
    try {
      const response = await fetch("https://api.cohere.ai/v1/rerank", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cohereApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "rerank-multilingual-v3.0",
          query: state.query,
          documents: docs.map((d: IndexSearchResult) => d.content),
          top_n: RERANKER_TOP_N,
        }),
      });

      if (response.ok) {
        const result = await response.json() as {
          results: Array<{ index: number; relevance_score: number }>;
        };

        const reranked = result.results.map((r) => ({
          ...docs[r.index],
          rerank_score: r.relevance_score,
        }));

        return { rerankedDocs: reranked };
      }
    } catch (err) {
      console.warn("[RAGGraph] Cohere reranking failed:", err);
    }
  }

  // Fallback: Use original order with score-based filtering
  return {
    rerankedDocs: docs.slice(0, RERANKER_TOP_N),
  };
}

/**
 * Self-RAG: Evaluate if retrieved content is sufficient
 */
async function evaluateSufficiency(
  state: RAGGraphRuntimeState,
): Promise<Partial<RAGGraphRuntimeState>> {
  const config = await configStore.getInternalByType("llm");
  if (!config || !config.enabled) {
    return { sufficiency: { sufficient: true } };
  }

  const context = state.rerankedDocs
    .slice(0, 5)
    .map((d: IndexSearchResult) => d.content)
    .join("\n---\n");

  try {
    const response = await llmGateway.chat({
      provider: config.providerId as Parameters<typeof llmGateway.chat>[0]["provider"],
      model: config.defaultModel || "gpt-4o-mini",
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      messages: [
        {
          role: "system",
          content: `Evaluate if the retrieved content is sufficient to answer the question.
Output JSON: {"sufficient": true/false, "missing": "description of missing info if any"}`,
        },
        {
          role: "user",
          content: `Question: ${state.query}\n\nRetrieved Content:\n${context}`,
        },
      ],
      temperature: 0,
      maxTokens: 100,
    });

    const evaluation = JSON.parse(response.content.trim()) as {
      sufficient: boolean;
      missing?: string;
    };

    return { sufficiency: evaluation };
  } catch (err) {
    console.warn("[RAGGraph] Sufficiency evaluation failed:", err);
    return { sufficiency: { sufficient: true } };
  }
}

/**
 * Expand retrieval with additional queries
 */
async function expandRetrieve(
  state: RAGGraphRuntimeState,
): Promise<Partial<RAGGraphRuntimeState>> {
  const missing = state.sufficiency?.missing || "";
  const expandedQuery = `${state.query} ${missing}`.trim();

  const additionalResults = await indexStore.searchHybrid(
    state.userId,
    state.projectKey,
    expandedQuery,
    {
      docIds: state.docIds,
      limit: DEFAULT_LIMIT,
    },
  );

  // Merge with existing results
  const existingIds = new Set(state.retrievedDocs.map((d: IndexSearchResult) => d.id));
  const newResults = additionalResults.filter((r) => !existingIds.has(r.id));

  return {
    retrievedDocs: [...state.retrievedDocs, ...newResults],
  };
}

function strategyToEntryNode(strategy: RAGStrategy): string {
  switch (strategy) {
    case "hyde":
      return "hyde_transform";
    case "multi":
      return "retrieve_multi";
    case "raptor":
      return "retrieve_raptor";
    case "basic":
    default:
      return "retrieve_basic";
  }
}

async function routeStrategy(
  state: RAGGraphRuntimeState,
): Promise<Command> {
  // If caller explicitly selected a strategy, route directly.
  if (state.strategy !== "adaptive") {
    return new Command({
      goto: strategyToEntryNode(state.strategy),
    });
  }

  const classified = await classifyQuery(state);
  const nextStrategy = (classified.strategy || "basic") as RAGStrategy;

  return new Command({
    goto: strategyToEntryNode(nextStrategy),
    update: classified,
  });
}

async function maybeRerank(
  state: RAGGraphRuntimeState,
): Promise<Partial<RAGGraphRuntimeState>> {
  if (!state.graphConfig?.enableReranking || state.retrievedDocs.length === 0) {
    return { rerankedDocs: state.retrievedDocs };
  }
  return rerank(state);
}

async function maybeEvaluateSufficiency(
  state: RAGGraphRuntimeState,
): Promise<Partial<RAGGraphRuntimeState>> {
  if (!state.graphConfig?.enableSelfRAG) {
    return { sufficiency: { sufficient: true } };
  }
  return evaluateSufficiency(state);
}

function decideAfterEvaluation(state: RAGGraphRuntimeState): "expand" | "end" {
  if (!state.graphConfig?.enableSelfRAG) {
    return "end";
  }

  if (state.sufficiency?.sufficient) {
    return "end";
  }

  if (state.iteration >= state.graphConfig.maxIterations) {
    return "end";
  }

  return "expand";
}

async function expandAndIncrement(
  state: RAGGraphRuntimeState,
): Promise<Partial<RAGGraphRuntimeState>> {
  const update = await expandRetrieve(state);
  return { ...update, iteration: 1 };
}

const ragGraph = new StateGraph(RAGGraphState)
  // Routing / transform
  // route_strategy returns Command({ goto }), so we must declare reachable targets via `ends`
  .addNode("route_strategy", routeStrategy, {
    ends: ["hyde_transform", "retrieve_basic", "retrieve_multi", "retrieve_raptor"],
  })
  .addNode("hyde_transform", hydeTransform)

  // Retrieval
  .addNode("retrieve_basic", basicRetrieve)
  .addNode("retrieve_multi", multiRetrieve)
  .addNode("retrieve_raptor", raptorRetrieve)

  // Post-processing + Self-RAG loop
  .addNode("maybe_rerank", maybeRerank)
  .addNode("maybe_evaluate", maybeEvaluateSufficiency)
  .addNode("expand_retrieve", expandAndIncrement)

  // Graph wiring
  .addEdge(START, "route_strategy")
  // route_strategy uses Command.goto, so no static edges out of it.

  .addEdge("hyde_transform", "retrieve_basic")

  .addEdge("retrieve_basic", "maybe_rerank")
  .addEdge("retrieve_multi", "maybe_rerank")
  .addEdge("retrieve_raptor", "maybe_rerank")

  .addEdge("maybe_rerank", "maybe_evaluate")
  .addConditionalEdges("maybe_evaluate", decideAfterEvaluation, {
    expand: "expand_retrieve",
    end: END,
  })
  .addEdge("expand_retrieve", "maybe_rerank")
  .compile();

export async function executeRAGGraph(
  initialState: Omit<RAGState, "queryType" | "retrievedDocs" | "rerankedDocs">,
  config: Partial<GraphConfig> = {},
): Promise<RAGState> {
  const mergedConfig: GraphConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const graphInput: RAGGraphRuntimeState = {
    query: initialState.query,
    userId: initialState.userId,
    projectKey: initialState.projectKey,
    docIds: initialState.docIds,
    strategy: initialState.strategy,
    queryType: "general",
    transformedQuery: undefined,
    retrievedDocs: [],
    rerankedDocs: [],
    sufficiency: undefined,
    iteration: 0,
    graphConfig: mergedConfig,
  };

  const final = await ragGraph.invoke(graphInput);
  // Strip internal config field so callers keep the original RAGState shape.
  const { graphConfig: _graphConfig, ...rest } = final as RAGGraphRuntimeState & {
    graphConfig?: GraphConfig;
  };
  return rest as unknown as RAGState;
}

// ============================================================
// Convenience Exports
// ============================================================

/**
 * Simple search interface that uses the RAG graph
 */
export async function ragSearch(
  userId: string,
  projectKey: string,
  query: string,
  options: {
    docIds?: string[];
    strategy?: RAGStrategy;
    enableSelfRAG?: boolean;
    enableReranking?: boolean;
    limit?: number;
  } = {},
): Promise<IndexSearchResult[]> {
  const { strategy = "adaptive", limit = DEFAULT_LIMIT, ...graphConfig } = options;

  const result = await executeRAGGraph(
    {
      query,
      userId,
      projectKey,
      docIds: options.docIds,
      strategy,
    },
    graphConfig,
  );

  return result.rerankedDocs.slice(0, limit);
}

/**
 * Get the full RAG state for debugging/analysis
 */
export async function ragSearchWithState(
  userId: string,
  projectKey: string,
  query: string,
  options: {
    docIds?: string[];
    strategy?: RAGStrategy;
    enableSelfRAG?: boolean;
    enableReranking?: boolean;
  } = {},
): Promise<RAGState> {
  const { strategy = "adaptive", ...graphConfig } = options;

  return executeRAGGraph(
    {
      query,
      userId,
      projectKey,
      docIds: options.docIds,
      strategy,
    },
    graphConfig,
  );
}
