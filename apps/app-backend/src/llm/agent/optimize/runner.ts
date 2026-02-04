import type { JSONContent } from "@tiptap/core";
import { configStore, llmGateway } from "../../index.js";
import { documentStore } from "../../../storage/document-store.js";
import { markdownToTiptapJson, tiptapJsonToMarkdown } from "../../../utils/markdown.js";
import { ensureBlockIds } from "../../../utils/block-id.js";
import { getOptimizeCapability } from "./capabilities.js";
import { buildOptimizePrompt } from "./prompt-builder.js";
import type { DocOptimizeRunChunk, DocOptimizeRunInput } from "./types.js";

function extractDocContent(rawBody: unknown): JSONContent {
  if (!rawBody || typeof rawBody !== "object") {
    return { type: "doc", content: [] };
  }

  const body = rawBody as { type?: string; content?: unknown };

  if (body.type === "doc" && Array.isArray(body.content)) {
    return body as JSONContent;
  }

  if (body.type === "tiptap" && body.content && typeof body.content === "object") {
    const inner = body.content as JSONContent;
    if (inner.type === "doc" && Array.isArray(inner.content)) {
      return inner;
    }
    if (Array.isArray(inner as unknown as unknown[])) {
      return { type: "doc", content: inner as unknown as JSONContent[] };
    }
    if (inner.type) {
      return { type: "doc", content: [inner] };
    }
  }

  if (body.type === "markdown" && typeof body.content === "string") {
    return markdownToTiptapJson(body.content);
  }

  if (Array.isArray(body.content)) {
    return {
      type: "doc",
      content: body.content as JSONContent[],
    };
  }

  return { type: "doc", content: [] };
}

function cleanMarkdownOutput(markdown: string): string {
  const trimmed = markdown.trim();
  const wrapped = trimmed.match(/^```(?:markdown)?\s*\n([\s\S]*?)\n```$/);
  return wrapped ? wrapped[1].trim() : trimmed;
}

export async function* runDocOptimize(
  input: DocOptimizeRunInput,
): AsyncGenerator<DocOptimizeRunChunk> {
  const { projectKey, capabilityId, args, traceContext } = input;
  const capability = getOptimizeCapability(capabilityId);
  const doc = await documentStore.get(projectKey, args.docId);
  const originalContent = extractDocContent(doc.body);
  const originalMarkdown = tiptapJsonToMarkdown(originalContent);

  const llmConfig = await configStore.getInternalByType("llm");
  if (!llmConfig?.defaultModel) {
    throw new Error("LLM 未配置，请先在设置中配置对话模型");
  }

  yield { type: "thinking", content: capability.thinkingText };

  const prompt = buildOptimizePrompt({
    capabilityId,
    markdown: originalMarkdown,
    instructions: args.instructions,
    style: args.style,
  });

  const stream = await llmGateway.chatStream({
    provider: llmConfig.providerId,
    model: llmConfig.defaultModel,
    apiKey: llmConfig.apiKey,
    baseUrl: llmConfig.baseUrl,
    messages: [
      { role: "system", content: prompt.systemPrompt },
      { role: "user", content: prompt.userPrompt },
    ],
    temperature: prompt.temperature,
    traceContext,
  });

  let fullContent = "";
  for await (const chunk of stream.textStream) {
    fullContent += chunk;
    yield { type: "delta", content: chunk };
  }

  const cleanedMarkdown = cleanMarkdownOutput(fullContent);
  const proposedContent = ensureBlockIds(markdownToTiptapJson(cleanedMarkdown)) as JSONContent;

  yield {
    type: "result",
    result: {
      docId: args.docId,
      title: doc.meta.title,
      parentId: doc.meta.parent_id || null,
      originalContent,
      proposedContent,
    },
  };
}
