import {
  Annotation,
  END,
  START,
  StateGraph,
} from "@langchain/langgraph";
import type { IndexSearchResult } from "../../knowledge/types.js";
import { ragSearch } from "../../knowledge/rag-graph.js";
import { enrichResultsWithHierarchy } from "../../knowledge/hierarchy.js";
import { documentStore } from "../../storage/document-store.js";
import { ragTraceManager } from "../../observability/index.js";
import type { TraceContext } from "../../observability/index.js";

export type RetrievalAgentInput = {
  userQuery: string;
  userId: string;
  projectKey: string;
  docIds?: string[];
  traceContext?: TraceContext;
};

export type RetrievalAgentSourceReference = {
  type?: "kb" | "web";
  docId?: string;
  blockId?: string;
  url?: string;
  title: string;
  snippet: string;
  score: number;
};

export type RetrievalAgentOutput = {
  ragContext: string;
  ragSources: RetrievalAgentSourceReference[];
};

/** Helper: last-value reducer with a default. Required by @langchain/langgraph ^0.2 */
function lv<T>(defaultFn: () => T) {
  return { value: (_prev: T, next: T) => next, default: defaultFn };
}

const RetrievalGraphState = Annotation.Root({
  // ---- Input ----
  userQuery: Annotation<string>,
  userId: Annotation<string>,
  projectKey: Annotation<string>,
  docIds: Annotation<string[] | undefined>(lv<string[] | undefined>(() => undefined)),
  traceContext: Annotation<TraceContext | undefined>(lv<TraceContext | undefined>(() => undefined)),

  // ---- Intermediate ----
  results: Annotation<IndexSearchResult[]>(lv<IndexSearchResult[]>(() => [])),
  hierarchyPrefix: Annotation<string>(lv<string>(() => "")),

  // ---- Output ----
  ragContext: Annotation<string>(lv<string>(() => "")),
  ragSources: Annotation<RetrievalAgentSourceReference[]>(
    lv<RetrievalAgentSourceReference[]>(() => []),
  ),
});

type RetrievalState = typeof RetrievalGraphState.State;

async function retrieve(state: RetrievalState): Promise<Partial<RetrievalState>> {
  if (!state.userQuery.trim()) {
    return { results: [] };
  }

  const results = await ragSearch(
    state.userId,
    state.projectKey,
    state.userQuery,
    {
      docIds: state.docIds,
      strategy: "adaptive",
      enableSelfRAG: true,
      enableReranking: true,
      limit: 5,
      traceContext: state.traceContext,
    },
  );

  return { results };
}

async function loadHierarchy(state: RetrievalState): Promise<Partial<RetrievalState>> {
  if (state.results.length === 0) {
    return { hierarchyPrefix: "" };
  }

  const tc = state.traceContext;
  let hierarchyPrefix = "";
  const hierarchySpan = tc
    ? ragTraceManager.startHierarchySpan(tc, state.results.map((r) => r.doc_id))
    : null;

  try {
    const { contextString } = await enrichResultsWithHierarchy(
      state.userId,
      state.projectKey,
      state.results,
    );
    if (contextString) {
      hierarchyPrefix = contextString + "\n\n";
    }

    if (hierarchySpan) {
      ragTraceManager.endHierarchySpan(
        hierarchySpan,
        contextString ? contextString.split("\n").length : 0,
      );
    }
  } catch (err) {
    console.warn("[RetrievalAgent] Hierarchy context loading failed:", err);
    if (hierarchySpan) {
      ragTraceManager.endHierarchySpan(hierarchySpan, 0);
    }
  }

  return { hierarchyPrefix };
}

async function buildContext(state: RetrievalState): Promise<Partial<RetrievalState>> {
  if (state.results.length === 0) {
    return { ragContext: "", ragSources: [] };
  }

  const sources: RetrievalAgentSourceReference[] = [];
  const contextParts: string[] = [];

  for (const result of state.results) {
    let title = result.metadata?.title || "";
    if (!title) {
      try {
        const doc = await documentStore.get(state.userId, state.projectKey, result.doc_id);
        title = doc.meta.title || result.doc_id;
      } catch {
        title = result.doc_id;
      }
    }

    sources.push({
      docId: result.doc_id,
      blockId: result.block_id,
      title,
      snippet: result.content.slice(0, 200),
      score: result.score ?? 0,
    });

    contextParts.push(`【${title}】\n${result.content}`);
  }

  return {
    ragContext: state.hierarchyPrefix + contextParts.join("\n\n---\n\n"),
    ragSources: sources,
  };
}

export const retrievalAgentGraph = new StateGraph(RetrievalGraphState)
  .addNode("retrieve", retrieve)
  .addNode("hierarchy", loadHierarchy)
  .addNode("build_context", buildContext)
  .addEdge(START, "retrieve")
  .addEdge("retrieve", "hierarchy")
  .addEdge("hierarchy", "build_context")
  .addEdge("build_context", END)
  .compile({ checkpointer: false, name: "retrieval_agent" });

export async function runRetrievalAgent(input: RetrievalAgentInput): Promise<RetrievalAgentOutput> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangGraph invoke typing requires exact match
  const result = await retrievalAgentGraph.invoke({
    userQuery: input.userQuery,
    userId: input.userId,
    projectKey: input.projectKey,
    docIds: input.docIds,
    traceContext: input.traceContext,
  } as any);

  return {
    ragContext: typeof result.ragContext === "string" ? result.ragContext : "",
    ragSources: Array.isArray(result.ragSources)
      ? (result.ragSources as RetrievalAgentSourceReference[])
      : [],
  };
}

