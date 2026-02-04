/**
 * Trace Manager
 *
 * Manages Langfuse traces, spans, and generations for LLM observability.
 */

import type { Langfuse, LangfuseTraceClient, LangfuseSpanClient, LangfuseGenerationClient } from "langfuse";
import { getLangfuse } from "./langfuse.js";

export type TraceMetadata = {
  sessionId?: string;
  projectKey?: string;
  userId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type TraceContext = {
  traceId: string;
  trace: LangfuseTraceClient | null;
};

export type SpanContext = {
  spanId: string;
  span: LangfuseSpanClient | null;
  traceContext: TraceContext;
};

export type GenerationParams = {
  name: string;
  model: string;
  provider?: string;
  input: unknown;
  output?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  startTime?: Date;
  endTime?: Date;
  level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";
  statusMessage?: string;
  metadata?: Record<string, unknown>;
};

/**
 * TraceManager class for managing Langfuse observability
 */
class TraceManager {
  private traces: Map<string, LangfuseTraceClient> = new Map();
  private spans: Map<string, LangfuseSpanClient> = new Map();

  /**
   * Get the Langfuse client
   */
  private getLangfuseClient(): Langfuse | null {
    return getLangfuse();
  }

  /**
   * Start a new trace (chat run level)
   */
  startTrace(runId: string, metadata: TraceMetadata): TraceContext {
    const langfuse = this.getLangfuseClient();
    
    if (!langfuse) {
      return { traceId: runId, trace: null };
    }

    const trace = langfuse.trace({
      id: runId,
      sessionId: metadata.sessionId,
      userId: metadata.userId,
      tags: metadata.tags,
      metadata: {
        projectKey: metadata.projectKey,
        ...metadata.metadata,
      },
    });

    this.traces.set(runId, trace);

    return { traceId: runId, trace };
  }

  /**
   * Get an existing trace context
   */
  getTrace(runId: string): TraceContext | null {
    const trace = this.traces.get(runId);
    if (!trace) {
      return null;
    }
    return { traceId: runId, trace };
  }

  /**
   * Start a span within a trace
   */
  startSpan(
    traceContext: TraceContext,
    name: string,
    input?: unknown,
  ): SpanContext {
    const spanId = `${traceContext.traceId}-${name}-${Date.now()}`;

    if (!traceContext.trace) {
      return { spanId, span: null, traceContext };
    }

    const span = traceContext.trace.span({
      name,
      input,
      startTime: new Date(),
    });

    this.spans.set(spanId, span);

    return { spanId, span, traceContext };
  }

  /**
   * End a span
   */
  endSpan(spanContext: SpanContext, output?: unknown, level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR"): void {
    if (!spanContext.span) {
      return;
    }

    spanContext.span.end({
      output,
      level,
    });

    this.spans.delete(spanContext.spanId);
  }

  /**
   * Log a generation (LLM call)
   */
  logGeneration(
    traceContext: TraceContext,
    params: GenerationParams,
  ): LangfuseGenerationClient | null {
    if (!traceContext.trace) {
      return null;
    }

    const generation = traceContext.trace.generation({
      name: params.name,
      model: params.model,
      input: params.input,
      output: params.output,
      usage: params.usage
        ? {
            input: params.usage.promptTokens,
            output: params.usage.completionTokens,
            total: params.usage.totalTokens,
          }
        : undefined,
      startTime: params.startTime,
      endTime: params.endTime,
      level: params.level,
      statusMessage: params.statusMessage,
      metadata: {
        provider: params.provider,
        ...params.metadata,
      },
    });

    return generation;
  }

  /**
   * Start a generation and return it for later update
   */
  startGeneration(
    traceContext: TraceContext,
    params: Omit<GenerationParams, "output" | "endTime">,
  ): LangfuseGenerationClient | null {
    if (!traceContext.trace) {
      return null;
    }

    const generation = traceContext.trace.generation({
      name: params.name,
      model: params.model,
      input: params.input,
      startTime: params.startTime || new Date(),
      metadata: {
        provider: params.provider,
        ...params.metadata,
      },
    });

    return generation;
  }

  /**
   * End a generation with output and usage
   */
  endGeneration(
    generation: LangfuseGenerationClient | null,
    output: string,
    usage?: GenerationParams["usage"],
    level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR",
    statusMessage?: string,
  ): void {
    if (!generation) {
      return;
    }

    generation.end({
      output,
      usage: usage
        ? {
            input: usage.promptTokens,
            output: usage.completionTokens,
            total: usage.totalTokens,
          }
        : undefined,
      level,
      statusMessage,
    });
  }

  /**
   * Update trace with input/output
   */
  updateTrace(
    traceContext: TraceContext,
    update: { input?: unknown; output?: unknown; metadata?: Record<string, unknown> },
  ): void {
    if (!traceContext.trace) {
      return;
    }

    traceContext.trace.update({
      input: update.input,
      output: update.output,
      metadata: update.metadata,
    });
  }

  /**
   * End a trace
   */
  endTrace(runId: string, output?: unknown): void {
    const trace = this.traces.get(runId);
    
    if (trace) {
      trace.update({
        output,
      });
    }

    this.traces.delete(runId);
  }

  /**
   * Add a score to a trace
   */
  score(
    traceContext: TraceContext,
    name: string,
    value: number,
    comment?: string,
  ): void {
    const langfuse = this.getLangfuseClient();
    if (!langfuse || !traceContext.trace) {
      return;
    }

    langfuse.score({
      traceId: traceContext.traceId,
      name,
      value,
      comment,
    });
  }

  /**
   * Flush all pending events
   */
  async flush(): Promise<void> {
    const langfuse = this.getLangfuseClient();
    if (langfuse) {
      await langfuse.flushAsync();
    }
  }
}

// Export singleton instance
export const traceManager = new TraceManager();
