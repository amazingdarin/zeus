import type { JSONContent } from "@tiptap/core";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { v4 as uuidv4 } from "uuid";

import { traceManager, type TraceContext } from "../observability/index.js";
import { ensureBlockIds } from "../utils/block-id.js";
import { markdownToTiptapJson } from "../utils/markdown.js";
import { runDocGuard } from "../llm/skills/doc-guard.js";
import { optimizeFormatSync } from "./optimize.js";
import { ocrService } from "./ocr.js";
import type { SmartImportMode, SmartImportType } from "./smart-import-types.js";
import {
  buildFileBlockNode,
  buildImageNode,
  convertBufferToMarkdown,
  dataUrlFromBuffer,
  guessMime,
  isImageFile,
  normalizeTypes,
  smartTypeForFile,
} from "./smart-import-shared.js";

export type SmartImportGraphInput = {
  userId: string;
  projectKey: string;
  title: string;
  parentId: string;
  file: {
    buffer: Buffer;
    originalname: string;
    mimetype?: string;
    size?: number;
  };
  assetMeta: {
    id: string;
    filename: string;
    mime: string;
    size: number;
  };
  smartImport: boolean;
  smartImportTypes?: SmartImportType[];
  enableFormatOptimize: boolean;
  traceContext?: TraceContext;
  traceMetadata?: Record<string, unknown>;
  maxValidateAttempts?: number;
};

export type SmartImportGraphOutput = {
  assembledDoc: JSONContent;
  mode: SmartImportMode;
  smartType: SmartImportType | null;
  validation: {
    passed: boolean;
    issueCount: number;
    errorCount: number;
    firstError?: string;
    attempt: number;
  };
};

type FilePayload = SmartImportGraphInput["file"];

// Avoid putting Buffers in LangGraph state (serialization/caching risks).
const filePayloadStore = new Map<string, FilePayload>();

function putFilePayload(file: FilePayload): string {
  const key = uuidv4();
  filePayloadStore.set(key, file);
  return key;
}

function takeFilePayload(key: string): FilePayload | null {
  const value = filePayloadStore.get(key) ?? null;
  filePayloadStore.delete(key);
  return value;
}

function lv<T>(defaultFn: () => T) {
  return { value: (_prev: T, next: T) => next, default: defaultFn };
}

const SmartImportGraphState = Annotation.Root({
  // ---- Input (set at invocation) ----
  userId: Annotation<string>,
  projectKey: Annotation<string>,
  title: Annotation<string>,
  parentId: Annotation<string>,
  assetMeta: Annotation<SmartImportGraphInput["assetMeta"]>,
  fileKey: Annotation<string>,
  smartImport: Annotation<boolean>(lv(() => false)),
  smartImportTypes: Annotation<SmartImportType[]>(lv<SmartImportType[]>(() => [])),
  enableFormatOptimize: Annotation<boolean>(lv(() => false)),
  traceContext: Annotation<TraceContext | undefined>(lv<TraceContext | undefined>(() => undefined)),
  traceMetadata: Annotation<Record<string, unknown>>(lv<Record<string, unknown>>(() => ({}))),
  maxValidateAttempts: Annotation<number>(lv(() => 2)),

  // ---- Intermediate ----
  smartType: Annotation<SmartImportType | null>(lv<SmartImportType | null>(() => null)),
  topNode: Annotation<JSONContent | null>(lv<JSONContent | null>(() => null)),
  markdown: Annotation<string>(lv(() => "")),
  assembledDoc: Annotation<JSONContent>(lv<JSONContent>(() => ({ type: "doc", content: [] } as unknown as JSONContent))),
  mode: Annotation<SmartImportMode>(lv<SmartImportMode>(() => "fallback")),
  attempt: Annotation<number>(lv(() => 0)),
  validateFeedback: Annotation<string>(lv(() => "")),
  validation: Annotation<SmartImportGraphOutput["validation"]>(
    lv<SmartImportGraphOutput["validation"]>(() => ({
      passed: true,
      issueCount: 0,
      errorCount: 0,
      attempt: 0,
    })),
  ),
});

type GraphState = typeof SmartImportGraphState.State;

function buildAssetOnlyDoc(topNode: JSONContent): JSONContent {
  return ensureBlockIds({ type: "doc", content: [topNode] } as unknown as JSONContent) as JSONContent;
}

// =====================================================================
// Node: parse
// =====================================================================

async function parseNode(state: GraphState): Promise<Partial<GraphState>> {
  const traceContext = state.traceContext;
  const traceMetadata = state.traceMetadata ?? {};
  const assetMeta = state.assetMeta;
  const file = takeFilePayload(state.fileKey);

  const filenameRaw = String(assetMeta.filename ?? state.title ?? "Untitled").trim() || "Untitled";
  const mime = guessMime(filenameRaw, assetMeta.mime || file?.mimetype);
  const size = Number(assetMeta.size ?? file?.size ?? file?.buffer.length ?? 0);
  const smartType = smartTypeForFile(filenameRaw, mime);
  const wantsSmart = state.smartImport === true;
  const types = normalizeTypes(state.smartImportTypes);
  const isImage = isImageFile(filenameRaw, mime);
  const topNode = isImage
    ? buildImageNode(state.projectKey, assetMeta.id, state.title)
    : buildFileBlockNode({
        id: assetMeta.id,
        filename: filenameRaw,
        mime,
        size,
      });

  const span = traceContext
    ? traceManager.startSpan(traceContext, "smart-import.parse", {
        filename: filenameRaw,
        mime,
        size,
        smartImport: wantsSmart,
        smartType,
        enableFormatOptimize: state.enableFormatOptimize === true,
        ...traceMetadata,
      })
    : null;
  const startedAt = Date.now();
  let endLevel: "DEFAULT" | "ERROR" = "DEFAULT";
  let endOutput: Record<string, unknown> = {};

  try {
    if (!file) {
      // Should not happen; fail safe to asset-only.
      const assembledDoc = buildAssetOnlyDoc(topNode);
      return {
        smartType,
        topNode,
        markdown: "",
        assembledDoc,
        mode: "fallback",
      };
    }

    if (!wantsSmart || !smartType || !types.has(smartType)) {
      const assembledDoc = buildAssetOnlyDoc(topNode);
      return {
        smartType,
        topNode,
        markdown: "",
        assembledDoc,
        mode: "fallback",
      };
    }

    if (smartType === "image") {
      const imageUrl = dataUrlFromBuffer(mime, file.buffer);
      const ocr = await ocrService.parseImage(
        { image: imageUrl, outputFormat: "tiptap" },
        {
          traceContext,
          metadata: {
            operation: "smart-import",
            filename: filenameRaw,
            mime,
            imageBytes: file.buffer.length,
            ...traceMetadata,
          },
        },
      );
      const ocrNodes = Array.isArray(ocr.content?.content) ? ocr.content.content : [];
      const assembledDoc = ensureBlockIds({
        type: "doc",
        content: [topNode, ...ocrNodes],
      } as unknown as JSONContent) as JSONContent;
      return {
        smartType,
        topNode,
        markdown: "",
        assembledDoc,
        mode: "smart",
      };
    }

    let markdown = "";
    if (smartType === "markdown") {
      markdown = file.buffer.toString("utf-8");
    } else if (smartType === "word") {
      markdown = await convertBufferToMarkdown(
        state.userId,
        state.projectKey,
        file.buffer,
        filenameRaw,
        mime,
        "docx",
      );
    } else if (smartType === "pdf") {
      markdown = await convertBufferToMarkdown(
        state.userId,
        state.projectKey,
        file.buffer,
        filenameRaw,
        mime,
        "pdf",
      );
    }

    return {
      smartType,
      topNode,
      markdown,
      mode: "smart",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    endLevel = "ERROR";
    endOutput = { error: msg, fallback: true };
    const assembledDoc = buildAssetOnlyDoc(topNode);
    return {
      smartType,
      topNode,
      markdown: "",
      assembledDoc,
      mode: "fallback",
    };
  } finally {
    if (span) {
      traceManager.endSpan(
        span,
        {
          durationMs: Date.now() - startedAt,
          ...endOutput,
        },
        endLevel,
      );
    }
  }
}

// =====================================================================
// Node: optimize_format
// =====================================================================

async function optimizeFormatNode(state: GraphState): Promise<Partial<GraphState>> {
  const traceContext = state.traceContext;
  const traceMetadata = state.traceMetadata ?? {};

  const markdown = state.markdown ?? "";
  const topNode = state.topNode;
  if (!topNode) {
    return {};
  }
  if (!markdown.trim()) {
    return { assembledDoc: buildAssetOnlyDoc(topNode) };
  }

  const attempt = Number(state.attempt ?? 0);
  const validateFeedback = String(state.validateFeedback ?? "").trim();
  const shouldOptimize = state.enableFormatOptimize === true || attempt > 0;

  const span = traceContext
    ? traceManager.startSpan(traceContext, "smart-import.optimize_format", {
        attempt,
        enabled: state.enableFormatOptimize === true,
        forced: attempt > 0,
        markdownChars: markdown.length,
        hasFeedback: Boolean(validateFeedback),
        feedbackChars: validateFeedback.length,
        ...traceMetadata,
      })
    : null;
  const startedAt = Date.now();
  let endLevel: "DEFAULT" | "ERROR" = "DEFAULT";
  let endOutput: Record<string, unknown> = {};

  try {
    const finalMarkdown = shouldOptimize
      ? await optimizeFormatSync(markdown, {
          traceContext,
          traceMetadata: {
            operation: "smart-import",
            attempt,
            hasFeedback: Boolean(validateFeedback),
            feedbackChars: validateFeedback.length,
            ...traceMetadata,
          },
          promptExtra: validateFeedback || undefined,
        })
      : markdown;

    const tiptap = markdownToTiptapJson(finalMarkdown);
    const nodes = Array.isArray(tiptap.content) ? tiptap.content : [];
    const assembledDoc = ensureBlockIds({
      type: "doc",
      content: [topNode, ...nodes],
    } as unknown as JSONContent) as JSONContent;

    return {
      assembledDoc,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    endLevel = "ERROR";
    endOutput = { error: msg };

    // Fail-safe: best-effort assemble from original markdown.
    const tiptap = markdownToTiptapJson(markdown);
    const nodes = Array.isArray(tiptap.content) ? tiptap.content : [];
    const assembledDoc = ensureBlockIds({
      type: "doc",
      content: [topNode, ...nodes],
    } as unknown as JSONContent) as JSONContent;
    return { assembledDoc };
  } finally {
    if (span) {
      traceManager.endSpan(
        span,
        {
          durationMs: Date.now() - startedAt,
          ...endOutput,
        },
        endLevel,
      );
    }
  }
}

// =====================================================================
// Node: validate
// =====================================================================

async function validateNode(state: GraphState): Promise<Partial<GraphState>> {
  const traceContext = state.traceContext;
  const traceMetadata = state.traceMetadata ?? {};
  const attempt = Number(state.attempt ?? 0);

  const span = traceContext
    ? traceManager.startSpan(traceContext, "smart-import.validate", {
        attempt,
        maxValidateAttempts: state.maxValidateAttempts,
        ...traceMetadata,
      })
    : null;
  const startedAt = Date.now();

  try {
    const guard = runDocGuard({
      policy: "protocol_only",
      proposedDoc: state.assembledDoc,
    });

    const fixed = ensureBlockIds(guard.fixedProposed as unknown as JSONContent) as JSONContent;
    const errorCount = guard.issues.filter((i) => i.severity === "error").length;
    const firstError = guard.issues.find((i) => i.severity === "error")?.message;

    const validation = {
      passed: guard.passed,
      issueCount: guard.issues.length,
      errorCount,
      firstError,
      attempt,
    };

    if (span) {
      traceManager.endSpan(
        span,
        {
          durationMs: Date.now() - startedAt,
          ...validation,
        },
        guard.passed ? "DEFAULT" : "WARNING",
      );
    }

    if (guard.passed) {
      return {
        assembledDoc: fixed,
        validation,
        validateFeedback: "",
      };
    }

    const maxAttempts = Math.max(0, Math.floor(state.maxValidateAttempts ?? 2));
    const hasMarkdown = Boolean(state.markdown && state.markdown.trim());

    if (attempt < maxAttempts && hasMarkdown) {
      const feedback = String(guard.feedback || firstError || "文档协议校验未通过").trim();
      return {
        assembledDoc: fixed,
        validation,
        attempt: attempt + 1,
        validateFeedback: feedback,
      };
    }

    // Final fallback: asset-only.
    const topNode = state.topNode;
    const fallbackDoc = topNode ? buildAssetOnlyDoc(topNode) : (fixed as JSONContent);
    return {
      assembledDoc: fallbackDoc,
      mode: "fallback",
      validation,
      validateFeedback: "",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (span) {
      traceManager.endSpan(span, { durationMs: Date.now() - startedAt, error: msg }, "ERROR");
    }
    // Fail-safe: do not block import; keep current assembledDoc.
    return {
      validation: {
        passed: true,
        issueCount: 0,
        errorCount: 0,
        attempt,
      },
    };
  }
}

function routeAfterValidate(state: GraphState): string {
  if (state.validation?.passed) return "__end__";
  const shouldRetry = Boolean(state.validateFeedback && state.validateFeedback.trim());
  if (shouldRetry) return "optimize_format";
  return "__end__";
}

const smartImportGraph = new StateGraph(SmartImportGraphState)
  .addNode("parse", parseNode)
  .addNode("optimize_format", optimizeFormatNode)
  .addNode("validate", validateNode)
  .addEdge(START, "parse")
  .addEdge("parse", "optimize_format")
  .addEdge("optimize_format", "validate")
  .addConditionalEdges("validate", routeAfterValidate, {
    optimize_format: "optimize_format",
    __end__: END,
  })
  .compile();

export async function runSmartImportGraph(input: SmartImportGraphInput): Promise<SmartImportGraphOutput> {
  const fileKey = putFilePayload(input.file);
  try {
    const maxValidateAttempts = Math.max(0, Math.floor(input.maxValidateAttempts ?? 2));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangGraph invoke typing requires exact match
    const result = await smartImportGraph.invoke(
      {
        userId: input.userId,
        projectKey: input.projectKey,
        title: input.title,
        parentId: input.parentId,
        assetMeta: input.assetMeta,
        fileKey,
        smartImport: input.smartImport === true,
        smartImportTypes: input.smartImportTypes ?? [],
        enableFormatOptimize: input.enableFormatOptimize === true,
        traceContext: input.traceContext,
        traceMetadata: input.traceMetadata ?? {},
        maxValidateAttempts,
      } as any,
    );

    return {
      assembledDoc: result.assembledDoc as JSONContent,
      mode: result.mode as SmartImportMode,
      smartType: result.smartType as SmartImportType | null,
      validation: result.validation as SmartImportGraphOutput["validation"],
    };
  } finally {
    filePayloadStore.delete(fileKey);
  }
}
