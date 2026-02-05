/**
 * RAG State Machine for Multi-Strategy Retrieval
 *
 * This module implements a flexible RAG pipeline using a state machine pattern
 * that supports multiple retrieval strategies:
 * - Basic: Direct vector/fulltext search
 * - HyDE: Hypothetical Document Embeddings
 * - Multi: Parallel multi-route retrieval with RRF fusion
 * - RAPTOR: Hierarchical tree-based retrieval
 * - Adaptive: Query-type based strategy selection
 *
 * The implementation follows LangGraph patterns but uses a lightweight
 * custom state machine to avoid heavy dependencies.
 */

import type {
  RAGState,
  QueryType,
  RAGStrategy,
  IndexSearchResult,
  IndexSearchOptions,
  HierarchyContext,
} from "./types.js";
import { indexStore } from "./index-store.js";
import { llmGateway, configStore } from "../llm/index.js";

// ============================================================
// Configuration
// ============================================================

const DEFAULT_LIMIT = 10;
const RERANKER_TOP_N = 10;
const MAX_SELF_RAG_ITERATIONS = 3;

// ============================================================
// Node Functions (State Transformers)
// ============================================================

/**
 * Classify the query type to determine the best retrieval strategy
 */
async function classifyQuery(state: RAGState): Promise<Partial<RAGState>> {
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
async function hydeTransform(state: RAGState): Promise<Partial<RAGState>> {
  const config = await configStore.getInternalByType("llm");
  if (!config || !config.enabled) {
    return { transformedQuery: state.query };
  }

  try {
    const response = await llmGateway.chat({
      provider: config.providerId as Parameters<typeof llmGateway.chat>[0]["provider"],
      model: config.defaultModel || "gpt-4o-mini",
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
async function basicRetrieve(state: RAGState): Promise<Partial<RAGState>> {
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
async function multiRetrieve(state: RAGState): Promise<Partial<RAGState>> {
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
async function raptorRetrieve(state: RAGState): Promise<Partial<RAGState>> {
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
async function rerank(state: RAGState): Promise<Partial<RAGState>> {
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
          documents: docs.map((d) => d.content),
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
async function evaluateSufficiency(state: RAGState): Promise<Partial<RAGState>> {
  const config = await configStore.getInternalByType("llm");
  if (!config || !config.enabled) {
    return { sufficiency: { sufficient: true } };
  }

  const context = state.rerankedDocs
    .slice(0, 5)
    .map((d) => d.content)
    .join("\n---\n");

  try {
    const response = await llmGateway.chat({
      provider: config.providerId as Parameters<typeof llmGateway.chat>[0]["provider"],
      model: config.defaultModel || "gpt-4o-mini",
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
async function expandRetrieve(state: RAGState): Promise<Partial<RAGState>> {
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
  const existingIds = new Set(state.retrievedDocs.map((d) => d.id));
  const newResults = additionalResults.filter((r) => !existingIds.has(r.id));

  return {
    retrievedDocs: [...state.retrievedDocs, ...newResults],
  };
}

// ============================================================
// Graph Execution Engine
// ============================================================

type NodeFunction = (state: RAGState) => Promise<Partial<RAGState>>;

interface GraphConfig {
  maxIterations: number;
  enableSelfRAG: boolean;
  enableReranking: boolean;
}

const DEFAULT_CONFIG: GraphConfig = {
  maxIterations: MAX_SELF_RAG_ITERATIONS,
  enableSelfRAG: true,
  enableReranking: true,
};

/**
 * Execute the RAG graph with the given initial state
 */
export async function executeRAGGraph(
  initialState: Omit<RAGState, "queryType" | "retrievedDocs" | "rerankedDocs">,
  config: Partial<GraphConfig> = {},
): Promise<RAGState> {
  const { maxIterations, enableSelfRAG, enableReranking } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  let state: RAGState = {
    ...initialState,
    queryType: "general",
    retrievedDocs: [],
    rerankedDocs: [],
    iteration: 0,
  };

  // Step 1: Classify query and select strategy (if adaptive)
  if (state.strategy === "adaptive") {
    state = { ...state, ...(await classifyQuery(state)) };
  }

  // Step 2: Execute retrieval based on strategy
  const retrievalNode = selectRetrievalNode(state.strategy);
  state = { ...state, ...(await retrievalNode(state)) };

  // Step 3: Reranking (optional)
  if (enableReranking && state.retrievedDocs.length > 0) {
    state = { ...state, ...(await rerank(state)) };
  } else {
    state.rerankedDocs = state.retrievedDocs;
  }

  // Step 4: Self-RAG loop (optional)
  if (enableSelfRAG) {
    while (state.iteration! < maxIterations) {
      state = { ...state, ...(await evaluateSufficiency(state)) };

      if (state.sufficiency?.sufficient) {
        break;
      }

      // Expand retrieval
      state = { ...state, ...(await expandRetrieve(state)) };
      state = { ...state, ...(await rerank(state)) };
      state.iteration = (state.iteration || 0) + 1;
    }
  }

  return state;
}

function selectRetrievalNode(strategy: RAGStrategy): NodeFunction {
  switch (strategy) {
    case "hyde":
      return async (state) => {
        const hydeState = await hydeTransform(state);
        return basicRetrieve({ ...state, ...hydeState });
      };
    case "multi":
      return multiRetrieve;
    case "raptor":
      return raptorRetrieve;
    case "basic":
    default:
      return basicRetrieve;
  }
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
