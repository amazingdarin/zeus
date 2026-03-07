/**
 * RAG-Specific Tracing
 *
 * Provides specialized tracing for RAG operations including:
 * - Query classification
 * - Retrieval operations
 * - Reranking
 * - Context building
 * - Answer generation
 */

import { traceManager, type TraceContext, type SpanContext } from "./trace-manager.js";
import { getLangfuse } from "./langfuse.js";
import type { RAGStrategy, QueryType, IndexSearchResult } from "../knowledge/types.js";

// ============================================================
// Types
// ============================================================

export interface RAGTraceMetadata {
  userId: string;
  projectKey: string;
  sessionId?: string;
  docIds?: string[];
  strategy?: RAGStrategy;
}

export interface RetrievalSpanData {
  strategy: RAGStrategy;
  queryType?: QueryType;
  granularities?: string[];
  resultCount: number;
  topScore?: number;
  durationMs: number;
}

export interface RerankSpanData {
  inputCount: number;
  outputCount: number;
  model?: string;
  durationMs: number;
}

export interface EvaluationData {
  contextPrecision?: number;
  contextRecall?: number;
  faithfulness?: number;
  answerRelevancy?: number;
  sufficient?: boolean;
  missing?: string;
}

// ============================================================
// RAG Trace Manager
// ============================================================

class RAGTraceManager {
  /**
   * Start a RAG query trace
   */
  startRAGTrace(
    query: string,
    metadata: RAGTraceMetadata,
  ): TraceContext {
    const traceId = `rag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const traceContext = traceManager.startTrace(traceId, {
      name: "rag-search",
      sessionId: metadata.sessionId,
      userId: metadata.userId,
      projectKey: metadata.projectKey,
      tags: ["rag", metadata.strategy || "adaptive"],
      metadata: {
        docIds: metadata.docIds,
        strategy: metadata.strategy,
      },
    });

    // Log the query as input
    traceManager.updateTrace(traceContext, {
      input: { query },
    });

    return traceContext;
  }

  /**
   * Start a query classification span
   */
  startClassifySpan(traceContext: TraceContext, query: string): SpanContext {
    return traceManager.startSpan(traceContext, "classify-query", { query });
  }

  /**
   * End a query classification span
   */
  endClassifySpan(
    spanContext: SpanContext,
    queryType: QueryType,
    strategy: RAGStrategy,
  ): void {
    traceManager.endSpan(spanContext, { queryType, strategy });
  }

  /**
   * Start a retrieval span
   */
  startRetrievalSpan(
    traceContext: TraceContext,
    strategy: RAGStrategy,
    query: string,
  ): SpanContext {
    return traceManager.startSpan(traceContext, `retrieval-${strategy}`, {
      strategy,
      query,
    });
  }

  /**
   * End a retrieval span with results
   */
  endRetrievalSpan(
    spanContext: SpanContext,
    data: RetrievalSpanData,
    results: IndexSearchResult[],
  ): void {
    traceManager.endSpan(spanContext, {
      ...data,
      resultIds: results.slice(0, 5).map((r) => r.doc_id),
    });
  }

  /**
   * Start a reranking span
   */
  startRerankSpan(traceContext: TraceContext, inputCount: number): SpanContext {
    return traceManager.startSpan(traceContext, "rerank", { inputCount });
  }

  /**
   * End a reranking span
   */
  endRerankSpan(spanContext: SpanContext, data: RerankSpanData): void {
    traceManager.endSpan(spanContext, data);
  }

  /**
   * Start a HyDE transform span
   */
  startHydeSpan(traceContext: TraceContext, query: string): SpanContext {
    return traceManager.startSpan(traceContext, "hyde-transform", { query });
  }

  /**
   * End a HyDE transform span
   */
  endHydeSpan(spanContext: SpanContext, transformedQuery: string): void {
    traceManager.endSpan(spanContext, { transformedQuery });
  }

  /**
   * Start a hierarchy loading span
   */
  startHierarchySpan(traceContext: TraceContext, docIds: string[]): SpanContext {
    return traceManager.startSpan(traceContext, "load-hierarchy", {
      docIds,
      count: docIds.length,
    });
  }

  /**
   * End a hierarchy loading span
   */
  endHierarchySpan(spanContext: SpanContext, ancestorCount: number): void {
    traceManager.endSpan(spanContext, { ancestorCount });
  }

  /**
   * Start a sufficiency evaluation span (Self-RAG)
   */
  startEvaluationSpan(traceContext: TraceContext): SpanContext {
    return traceManager.startSpan(traceContext, "evaluate-sufficiency", {});
  }

  /**
   * End a sufficiency evaluation span
   */
  endEvaluationSpan(
    spanContext: SpanContext,
    sufficient: boolean,
    missing?: string,
  ): void {
    traceManager.endSpan(spanContext, { sufficient, missing });
  }

  /**
   * Log RAG generation (final answer)
   */
  logRAGGeneration(
    traceContext: TraceContext,
    params: {
      model: string;
      provider: string;
      query: string;
      context: string;
      answer: string;
      promptTokens?: number;
      completionTokens?: number;
      durationMs: number;
    },
  ): void {
    const startTime = new Date(Date.now() - params.durationMs);
    const endTime = new Date();

    traceManager.logGeneration(traceContext, {
      name: "rag-answer",
      model: params.model,
      provider: params.provider,
      input: {
        query: params.query,
        context: params.context.slice(0, 1000) + (params.context.length > 1000 ? "..." : ""),
      },
      output: params.answer,
      usage: {
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        totalTokens: (params.promptTokens || 0) + (params.completionTokens || 0),
      },
      startTime,
      endTime,
    });
  }

  /**
   * End the RAG trace with final output
   */
  endRAGTrace(
    traceContext: TraceContext,
    answer: string,
    sources: Array<{ docId: string; blockId?: string }>,
  ): void {
    traceManager.updateTrace(traceContext, {
      output: {
        answer,
        sources,
        sourceCount: sources.length,
      },
    });

    traceManager.endTrace(traceContext.traceId, {
      answer,
      sources,
    });
  }

  /**
   * Record evaluation scores for the RAG trace
   */
  scoreRAGTrace(traceContext: TraceContext, evaluation: EvaluationData): void {
    if (evaluation.contextPrecision !== undefined) {
      traceManager.score(
        traceContext,
        "context_precision",
        evaluation.contextPrecision,
        "Relevance of retrieved context",
      );
    }

    if (evaluation.contextRecall !== undefined) {
      traceManager.score(
        traceContext,
        "context_recall",
        evaluation.contextRecall,
        "Coverage of needed information",
      );
    }

    if (evaluation.faithfulness !== undefined) {
      traceManager.score(
        traceContext,
        "faithfulness",
        evaluation.faithfulness,
        "Answer grounded in context",
      );
    }

    if (evaluation.answerRelevancy !== undefined) {
      traceManager.score(
        traceContext,
        "answer_relevancy",
        evaluation.answerRelevancy,
        "Answer addresses the question",
      );
    }
  }
}

// ============================================================
// Singleton Export
// ============================================================

export const ragTraceManager = new RAGTraceManager();

// ============================================================
// Utility Functions
// ============================================================

/**
 * Create a traced RAG execution wrapper
 */
export async function withRAGTrace<T>(
  query: string,
  metadata: RAGTraceMetadata,
  fn: (traceContext: TraceContext) => Promise<T>,
): Promise<T> {
  const traceContext = ragTraceManager.startRAGTrace(query, metadata);

  try {
    const result = await fn(traceContext);
    return result;
  } catch (err) {
    // Log error to trace
    if (traceContext.trace) {
      traceContext.trace.update({
        output: { error: err instanceof Error ? err.message : String(err) },
        metadata: { status: "error" },
      });
    }
    throw err;
  }
}

/**
 * Measure and trace a function execution
 */
export async function traceSpan<T>(
  traceContext: TraceContext,
  name: string,
  input: unknown,
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const spanContext = traceManager.startSpan(traceContext, name, input);
  const startTime = Date.now();

  try {
    const result = await fn();
    const durationMs = Date.now() - startTime;

    traceManager.endSpan(spanContext, { result, durationMs });

    return { result, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    traceManager.endSpan(spanContext, {
      error: err instanceof Error ? err.message : String(err),
      durationMs,
    }, "ERROR");
    throw err;
  }
}
