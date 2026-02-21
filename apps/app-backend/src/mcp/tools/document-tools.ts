import { z } from "zod";

import { knowledgeSearch } from "../../knowledge/search.js";
import {
  DocumentNotFoundError,
  BlockNotFoundError,
  documentStore,
} from "../../storage/document-store.js";
import type { TreeItem } from "../../storage/types.js";
import {
  ProjectScopeResolverError,
  resolveProjectScopeAccess,
  type ResolvedProjectScope,
} from "../../middleware/project-scope-resolver.js";
import {
  McpToolExecutionError,
  type McpToolContext,
  type McpToolDefinition,
} from "../types.js";

type DocumentStoreLike = Pick<
  typeof documentStore,
  "getChildren" | "getFullTree" | "get" | "getHierarchy" | "suggest" | "getBlockById"
>;

type KnowledgeSearchLike = Pick<typeof knowledgeSearch, "search">;

type ResolveScopeLike = typeof resolveProjectScopeAccess;

export type DocumentToolDeps = {
  documentStore: DocumentStoreLike;
  knowledgeSearch: KnowledgeSearchLike;
  resolveScope: ResolveScopeLike;
  maxLimit: number;
  maxTreeNodes: number;
  readToolsEnabled: boolean;
  writeToolsEnabled: boolean;
};

const baseScopeArgsSchema = z.object({
  owner_type: z.enum(["personal", "team"]),
  owner_key: z.string().trim().min(1),
  project_key: z.string().trim().min(1),
});

const baseScopeInputSchema = {
  owner_type: {
    type: "string",
    enum: ["personal", "team"],
    description: "Project owner type",
  },
  owner_key: {
    type: "string",
    description: "Owner key. personal accepts me or current userId. team accepts team slug/id.",
  },
  project_key: {
    type: "string",
    description: "Unscoped project key under the owner scope.",
  },
} as const;

function buildInputSchema(
  extraProperties: Record<string, unknown>,
  requiredExtra: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ...baseScopeInputSchema,
      ...extraProperties,
    },
    required: ["owner_type", "owner_key", "project_key", ...requiredExtra],
  };
}

function normalizeLimit(raw: unknown, fallback: number, maxLimit: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), maxLimit);
}

function normalizeOffset(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function toProjectRef(scope: ResolvedProjectScope): string {
  return scope.scopedProjectKey;
}

function toToolError(err: unknown): McpToolExecutionError {
  if (err instanceof McpToolExecutionError) {
    return err;
  }
  if (err instanceof ProjectScopeResolverError) {
    return new McpToolExecutionError(err.code, err.message, err.status);
  }
  if (err instanceof DocumentNotFoundError || err instanceof BlockNotFoundError) {
    return new McpToolExecutionError("NOT_FOUND", err.message, 404);
  }
  if (err instanceof z.ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return new McpToolExecutionError("INVALID_ARGUMENT", "Invalid tool arguments", 400, details);
  }
  const message = err instanceof Error ? err.message : "Tool execution failed";
  return new McpToolExecutionError("INTERNAL_ERROR", message, 500);
}

function isDependencyUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = String((err as { code?: unknown }).code || "");
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "57P03" ||
    code === "53300"
  );
}

async function resolveScopeFromArgs(
  deps: DocumentToolDeps,
  args: Record<string, unknown>,
  userId: string,
): Promise<ResolvedProjectScope> {
  const base = baseScopeArgsSchema.parse(args);
  return deps.resolveScope({
    userId,
    ownerType: base.owner_type,
    ownerKey: base.owner_key,
    projectKey: base.project_key,
    method: "GET",
  });
}

type TreeLimitState = {
  count: number;
  maxNodes: number;
  maxDepth: number;
  truncated: boolean;
};

function trimTree(
  nodes: TreeItem[],
  depth: number,
  state: TreeLimitState,
): TreeItem[] {
  const output: TreeItem[] = [];
  for (const node of nodes) {
    if (state.count >= state.maxNodes) {
      state.truncated = true;
      break;
    }
    state.count += 1;
    const next: TreeItem = {
      id: node.id,
      slug: node.slug,
      title: node.title,
      kind: node.kind,
    };
    if (Array.isArray(node.children) && node.children.length > 0) {
      if (depth >= state.maxDepth) {
        state.truncated = true;
      } else {
        const children = trimTree(node.children, depth + 1, state);
        if (children.length > 0) {
          next.children = children;
        }
      }
    }
    output.push(next);
  }
  return output;
}

async function executeWithErrorMapping<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw toToolError(err);
  }
}

export function createDocumentTools(partial?: Partial<DocumentToolDeps>): McpToolDefinition[] {
  const deps: DocumentToolDeps = {
    documentStore: partial?.documentStore ?? documentStore,
    knowledgeSearch: partial?.knowledgeSearch ?? knowledgeSearch,
    resolveScope: partial?.resolveScope ?? resolveProjectScopeAccess,
    maxLimit: Math.max(1, partial?.maxLimit ?? 50),
    maxTreeNodes: Math.max(10, partial?.maxTreeNodes ?? 1000),
    readToolsEnabled: partial?.readToolsEnabled !== false,
    writeToolsEnabled: partial?.writeToolsEnabled === true,
  };

  if (!deps.readToolsEnabled) {
    return [];
  }

  // NOTE: write tools are intentionally not registered in phase 1.
  void deps.writeToolsEnabled;

  const listArgsSchema = baseScopeArgsSchema.extend({
    parent_id: z.string().trim().optional(),
    limit: z.union([z.string(), z.number()]).optional(),
    offset: z.union([z.string(), z.number()]).optional(),
  });

  const treeArgsSchema = baseScopeArgsSchema.extend({
    max_depth: z.union([z.string(), z.number()]).optional(),
    max_nodes: z.union([z.string(), z.number()]).optional(),
  });

  const getArgsSchema = baseScopeArgsSchema.extend({
    doc_id: z.string().trim().min(1),
    include_body: z.boolean().optional(),
  });

  const hierarchyArgsSchema = baseScopeArgsSchema.extend({
    doc_id: z.string().trim().min(1),
  });

  const suggestArgsSchema = baseScopeArgsSchema.extend({
    q: z.string().optional().default(""),
    parent_id: z.string().trim().optional(),
    limit: z.union([z.string(), z.number()]).optional(),
  });

  const getBlockArgsSchema = baseScopeArgsSchema.extend({
    doc_id: z.string().trim().min(1),
    block_id: z.string().trim().min(1),
  });

  const searchArgsSchema = baseScopeArgsSchema.extend({
    text: z.string().trim().min(1),
    mode: z.enum(["fulltext", "embedding", "hybrid"]).optional(),
    limit: z.union([z.string(), z.number()]).optional(),
    offset: z.union([z.string(), z.number()]).optional(),
    doc_ids: z.array(z.string().trim().min(1)).optional(),
  });

  return [
    {
      name: "zeus.docs.list",
      description: "List direct child documents under a parent node.",
      readOnly: true,
      enabled: true,
      inputSchema: buildInputSchema(
        {
          parent_id: { type: "string", description: "Parent document id. Use root for top level." },
          limit: { type: "integer", minimum: 1, maximum: deps.maxLimit, default: 20 },
          offset: { type: "integer", minimum: 0, default: 0 },
        },
      ),
      execute: async (args, context: McpToolContext) =>
        executeWithErrorMapping(async () => {
          const parsed = listArgsSchema.parse(args);
          const scope = await resolveScopeFromArgs(deps, parsed, context.user.id);
          const limit = normalizeLimit(parsed.limit, 20, deps.maxLimit);
          const offset = normalizeOffset(parsed.offset);
          const parentId = String(parsed.parent_id ?? "root").trim() || "root";

          const allItems = await deps.documentStore.getChildren(
            context.user.id,
            scope.scopedProjectKey,
            parentId,
          );
          const items = allItems.slice(offset, offset + limit);
          return {
            structuredContent: {
              project_ref: toProjectRef(scope),
              parent_id: parentId,
              total: allItems.length,
              limit,
              offset,
              items,
            },
            text: `Listed ${items.length} documents (total ${allItems.length}).`,
          };
        }),
    },
    {
      name: "zeus.docs.tree",
      description: "Get full document tree with optional depth/node caps.",
      readOnly: true,
      enabled: true,
      inputSchema: buildInputSchema(
        {
          max_depth: { type: "integer", minimum: 1, maximum: 64, default: 8 },
          max_nodes: { type: "integer", minimum: 10, maximum: deps.maxTreeNodes, default: deps.maxTreeNodes },
        },
      ),
      execute: async (args, context: McpToolContext) =>
        executeWithErrorMapping(async () => {
          const parsed = treeArgsSchema.parse(args);
          const scope = await resolveScopeFromArgs(deps, parsed, context.user.id);
          const maxDepth = Math.min(
            64,
            Math.max(1, Number(parsed.max_depth ?? 8) || 8),
          );
          const maxNodes = Math.min(
            deps.maxTreeNodes,
            Math.max(10, Number(parsed.max_nodes ?? deps.maxTreeNodes) || deps.maxTreeNodes),
          );

          const fullTree = await deps.documentStore.getFullTree(
            context.user.id,
            scope.scopedProjectKey,
          );
          const state: TreeLimitState = {
            count: 0,
            maxNodes,
            maxDepth,
            truncated: false,
          };
          const tree = trimTree(fullTree, 1, state);

          return {
            structuredContent: {
              project_ref: toProjectRef(scope),
              max_depth: maxDepth,
              max_nodes: maxNodes,
              returned_nodes: state.count,
              truncated: state.truncated,
              tree,
            },
            text: `Returned ${state.count} tree nodes${state.truncated ? " (truncated)." : "."}`,
          };
        }),
    },
    {
      name: "zeus.docs.get",
      description: "Get document metadata and optionally full body content.",
      readOnly: true,
      enabled: true,
      inputSchema: buildInputSchema(
        {
          doc_id: { type: "string", description: "Document ID" },
          include_body: {
            type: "boolean",
            description: "Set true to include full document body.",
            default: false,
          },
        },
        ["doc_id"],
      ),
      execute: async (args, context: McpToolContext) =>
        executeWithErrorMapping(async () => {
          const parsed = getArgsSchema.parse(args);
          const includeBody = parsed.include_body === true;
          const scope = await resolveScopeFromArgs(deps, parsed, context.user.id);
          const doc = await deps.documentStore.get(
            context.user.id,
            scope.scopedProjectKey,
            parsed.doc_id,
          );
          return {
            structuredContent: {
              project_ref: toProjectRef(scope),
              meta: doc.meta,
              body: includeBody ? doc.body : undefined,
            },
            text: includeBody
              ? `Loaded document "${doc.meta.title}" with body.`
              : `Loaded document "${doc.meta.title}" metadata.`,
          };
        }),
    },
    {
      name: "zeus.docs.hierarchy",
      description: "Get ancestor chain from root to a target document.",
      readOnly: true,
      enabled: true,
      inputSchema: buildInputSchema(
        {
          doc_id: { type: "string", description: "Document ID" },
        },
        ["doc_id"],
      ),
      execute: async (args, context: McpToolContext) =>
        executeWithErrorMapping(async () => {
          const parsed = hierarchyArgsSchema.parse(args);
          const scope = await resolveScopeFromArgs(deps, parsed, context.user.id);
          const chain = await deps.documentStore.getHierarchy(
            context.user.id,
            scope.scopedProjectKey,
            parsed.doc_id,
          );
          return {
            structuredContent: {
              project_ref: toProjectRef(scope),
              doc_id: parsed.doc_id,
              chain,
            },
            text: `Hierarchy depth: ${chain.length}.`,
          };
        }),
    },
    {
      name: "zeus.docs.suggest",
      description: "Suggest documents by query for mention/autocomplete flows.",
      readOnly: true,
      enabled: true,
      inputSchema: buildInputSchema({
        q: { type: "string", description: "Query text", default: "" },
        parent_id: { type: "string", description: "Optional parent scope (root or doc id)." },
        limit: { type: "integer", minimum: 1, maximum: deps.maxLimit, default: 10 },
      }),
      execute: async (args, context: McpToolContext) =>
        executeWithErrorMapping(async () => {
          const parsed = suggestArgsSchema.parse(args);
          const scope = await resolveScopeFromArgs(deps, parsed, context.user.id);
          const limit = normalizeLimit(parsed.limit, 10, deps.maxLimit);
          const parentId = parsed.parent_id === undefined ? undefined : String(parsed.parent_id);
          const suggestions = await deps.documentStore.suggest(
            context.user.id,
            scope.scopedProjectKey,
            parsed.q ?? "",
            limit,
            parentId,
          );
          return {
            structuredContent: {
              project_ref: toProjectRef(scope),
              query: parsed.q ?? "",
              parent_id: parentId,
              limit,
              suggestions,
            },
            text: `Found ${suggestions.length} suggestions.`,
          };
        }),
    },
    {
      name: "zeus.docs.get_block",
      description: "Get a single block from a document by block id.",
      readOnly: true,
      enabled: true,
      inputSchema: buildInputSchema(
        {
          doc_id: { type: "string", description: "Document ID" },
          block_id: { type: "string", description: "Block ID" },
        },
        ["doc_id", "block_id"],
      ),
      execute: async (args, context: McpToolContext) =>
        executeWithErrorMapping(async () => {
          const parsed = getBlockArgsSchema.parse(args);
          const scope = await resolveScopeFromArgs(deps, parsed, context.user.id);
          const doc = await deps.documentStore.getBlockById(
            context.user.id,
            scope.scopedProjectKey,
            parsed.doc_id,
            parsed.block_id,
          );
          return {
            structuredContent: {
              project_ref: toProjectRef(scope),
              doc_id: parsed.doc_id,
              block_id: parsed.block_id,
              meta: doc.meta,
              body: doc.body,
            },
            text: `Loaded block ${parsed.block_id}.`,
          };
        }),
    },
    {
      name: "zeus.docs.search",
      description: "Search project knowledge index by text query.",
      readOnly: true,
      enabled: true,
      inputSchema: buildInputSchema(
        {
          text: { type: "string", description: "Search text" },
          mode: {
            type: "string",
            enum: ["fulltext", "embedding", "hybrid"],
            default: "hybrid",
            description: "Search strategy",
          },
          limit: { type: "integer", minimum: 1, maximum: deps.maxLimit, default: 20 },
          offset: { type: "integer", minimum: 0, default: 0 },
          doc_ids: {
            type: "array",
            items: { type: "string" },
            description: "Optional document id scope.",
          },
        },
        ["text"],
      ),
      execute: async (args, context: McpToolContext) =>
        executeWithErrorMapping(async () => {
          const parsed = searchArgsSchema.parse(args);
          const scope = await resolveScopeFromArgs(deps, parsed, context.user.id);
          const limit = normalizeLimit(parsed.limit, 20, deps.maxLimit);
          const offset = normalizeOffset(parsed.offset);
          try {
            const results = await deps.knowledgeSearch.search(
              context.user.id,
              scope.scopedProjectKey,
              {
                text: parsed.text,
                mode: parsed.mode ?? "hybrid",
                limit,
                offset,
                doc_ids: parsed.doc_ids,
              },
            );
            return {
              structuredContent: {
                project_ref: toProjectRef(scope),
                mode: parsed.mode ?? "hybrid",
                text: parsed.text,
                limit,
                offset,
                total: results.length,
                results,
              },
              text: `Search returned ${results.length} results.`,
            };
          } catch (err) {
            if (isDependencyUnavailable(err)) {
              throw new McpToolExecutionError(
                "DEPENDENCY_UNAVAILABLE",
                "Knowledge search dependency is unavailable",
                503,
              );
            }
            throw err;
          }
        }),
    },
  ];
}
