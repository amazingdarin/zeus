/**
 * Observability Module
 *
 * Exports observability utilities for LLM tracing and monitoring.
 */

export { getLangfuse, shutdownLangfuse, isLangfuseEnabled } from "./langfuse.js";
export {
  traceManager,
  type TraceContext,
  type SpanContext,
  type GenerationParams,
  type TraceMetadata,
} from "./trace-manager.js";
export {
  ragTraceManager,
  withRAGTrace,
  traceSpan,
  type RAGTraceMetadata,
  type RetrievalSpanData,
  type RerankSpanData,
  type EvaluationData,
} from "./rag-trace.js";