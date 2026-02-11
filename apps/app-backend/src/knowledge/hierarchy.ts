/**
 * Hierarchy Context Loading
 *
 * This module handles loading hierarchical context for documents:
 * - Ancestor chain loading with configurable content depth
 * - Document summary generation and caching
 * - Sibling document discovery
 */

import { query } from "../db/postgres.js";
import { documentStore } from "../storage/document-store.js";
import { llmGateway, configStore } from "../llm/index.js";
import { resolveProjectScope } from "../project-scope.js";
import type {
  HierarchyContext,
  AncestorLoadConfig,
  DEFAULT_ANCESTOR_CONFIG,
} from "./types.js";

// ============================================================
// Configuration
// ============================================================

const SUMMARY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_FULL_CONTENT_LENGTH = 500;
const MAX_SUMMARY_LENGTH = 200;

// Default loading configuration by depth
const DEFAULT_LOAD_CONFIG: AncestorLoadConfig[] = [
  { depth: 0, loadContent: "full", maxLength: MAX_FULL_CONTENT_LENGTH },
  { depth: 1, loadContent: "summary" },
  { depth: 2, loadContent: "summary" },
  // Deeper levels: title only
];

// ============================================================
// Main Functions
// ============================================================

/**
 * Load hierarchy context for a document
 */
export async function loadHierarchyContext(
  userId: string,
  projectKey: string,
  docId: string,
  loadConfig: AncestorLoadConfig[] = DEFAULT_LOAD_CONFIG,
): Promise<HierarchyContext> {
  const ancestors = await loadAncestorChain(userId, projectKey, docId, loadConfig);
  const siblings = await loadSiblings(userId, projectKey, docId);

  return { ancestors, siblings };
}

/**
 * Load hierarchy context for multiple documents (from search results)
 */
export async function loadHierarchyForSearchResults(
  userId: string,
  projectKey: string,
  docIds: string[],
  loadConfig: AncestorLoadConfig[] = DEFAULT_LOAD_CONFIG,
): Promise<HierarchyContext> {
  // Deduplicate doc IDs
  const uniqueDocIds = [...new Set(docIds)];

  // Load ancestor chains for all documents
  const ancestorChains = await Promise.all(
    uniqueDocIds.map((docId) =>
      loadAncestorChain(userId, projectKey, docId, loadConfig),
    ),
  );

  // Merge and deduplicate ancestors
  const seenIds = new Set<string>();
  const mergedAncestors: HierarchyContext["ancestors"] = [];

  for (const chain of ancestorChains) {
    for (const ancestor of chain) {
      if (seenIds.has(ancestor.id)) continue;
      seenIds.add(ancestor.id);
      mergedAncestors.push(ancestor);
    }
  }

  // Sort by depth (closest first)
  mergedAncestors.sort((a, b) => a.depth - b.depth);

  return { ancestors: mergedAncestors };
}

/**
 * Load ancestor chain for a single document
 */
async function loadAncestorChain(
  userId: string,
  projectKey: string,
  docId: string,
  loadConfig: AncestorLoadConfig[],
): Promise<Array<{ id: string; title: string; summary?: string; depth: number }>> {
  const ancestors: Array<{ id: string; title: string; summary?: string; depth: number }> = [];

  try {
    // Get document hierarchy from document store
    const hierarchy = await documentStore.getHierarchy(userId, projectKey, docId);

    // hierarchy returns [root, ..., parent, current], we want [parent, ..., root]
    // and skip the current document
    const parentChain = hierarchy.slice(0, -1).reverse();

    for (let depth = 0; depth < parentChain.length; depth++) {
      const item = parentChain[depth];
      const config = loadConfig.find((c) => c.depth === depth);

      let summary: string | undefined;

      if (config?.loadContent === "full") {
        // Load full content (truncated)
        try {
          const doc = await documentStore.get(userId, projectKey, item.id);
          const fullText = extractText(doc.body);
          summary = truncateText(fullText, config.maxLength || MAX_FULL_CONTENT_LENGTH);
        } catch {
          // Document might have been deleted
        }
      } else if (config?.loadContent === "summary") {
        // Load or generate summary
        summary = await getDocumentSummary(userId, projectKey, item.id);
      }
      // else: title only

      ancestors.push({
        id: item.id,
        title: item.title,
        summary,
        depth,
      });
    }
  } catch (err) {
    console.warn("[Hierarchy] Failed to load ancestor chain:", err);
  }

  return ancestors;
}

/**
 * Load sibling document IDs
 */
async function loadSiblings(
  userId: string,
  projectKey: string,
  docId: string,
): Promise<string[]> {
  try {
    // Get current document to find its parent
    const doc = await documentStore.get(userId, projectKey, docId);
    const parentId = doc.meta.parent_id;

    // Get all children of the parent
    const siblings = await documentStore.getChildren(userId, projectKey, parentId);

    // Filter out the current document
    return siblings.filter((s) => s.id !== docId).map((s) => s.id);
  } catch {
    return [];
  }
}

// ============================================================
// Summary Management
// ============================================================

/**
 * Get or generate a document summary
 */
export async function getDocumentSummary(
  userId: string,
  projectKey: string,
  docId: string,
): Promise<string | undefined> {
  // Check cache first
  const cached = await getSummaryFromCache(userId, projectKey, docId);
  if (cached) return cached;

  // Try to get from document metadata
  try {
    const doc = await documentStore.get(userId, projectKey, docId);
    if (doc.meta.extra?.summary) {
      return doc.meta.extra.summary as string;
    }

    // Generate summary using LLM
    const summary = await generateSummary(doc.meta.title, doc.body);
    if (summary) {
      // Cache the generated summary
      await cacheSummary(docId, userId, projectKey, summary);
    }
    return summary;
  } catch {
    return undefined;
  }
}

/**
 * Generate a summary for a document using LLM
 */
async function generateSummary(
  title: string,
  body: unknown,
): Promise<string | undefined> {
  const config = await configStore.getInternalByType("llm");
  if (!config || !config.enabled) {
    return undefined;
  }

  const fullText = extractText(body);
  if (!fullText || fullText.length < 50) {
    return fullText;
  }

  try {
    const response = await llmGateway.chat({
      provider: config.providerId as Parameters<typeof llmGateway.chat>[0]["provider"],
      model: config.defaultModel || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Generate a one-sentence summary (max 100 characters) for this document. Output only the summary, no preamble.",
        },
        {
          role: "user",
          content: `Title: ${title}\n\nContent:\n${fullText.slice(0, 2000)}`,
        },
      ],
      temperature: 0,
      maxTokens: 100,
    });

    return truncateText(response.content.trim(), MAX_SUMMARY_LENGTH);
  } catch (err) {
    console.warn("[Hierarchy] Summary generation failed:", err);
    return undefined;
  }
}

/**
 * Get summary from cache
 */
async function getSummaryFromCache(
  userId: string,
  projectKey: string,
  docId: string,
): Promise<string | undefined> {
  try {
    const scope = resolveProjectScope(userId, projectKey);

    const result = await query<{ summary: string; expires_at: Date | null }>(
      `SELECT summary, expires_at
       FROM document_summary_cache
       WHERE user_id = $1
         AND owner_type = $2
         AND owner_id = $3
         AND project_key = $4
         AND doc_id = $5`,
      [userId, scope.ownerType, scope.ownerId, scope.projectKey, docId],
    );

    if (result.rows.length === 0) return undefined;

    const row = result.rows[0];

    // Check if expired
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      // Delete expired cache entry
      await query(
        `DELETE FROM document_summary_cache
         WHERE user_id = $1
           AND owner_type = $2
           AND owner_id = $3
           AND project_key = $4
           AND doc_id = $5`,
        [userId, scope.ownerType, scope.ownerId, scope.projectKey, docId],
      );
      return undefined;
    }

    return row.summary;
  } catch {
    return undefined;
  }
}

/**
 * Cache a document summary
 */
async function cacheSummary(
  docId: string,
  userId: string,
  projectKey: string,
  summary: string,
  model?: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + SUMMARY_CACHE_TTL_MS);

  try {
    const scope = resolveProjectScope(userId, projectKey);

    await query(
      `INSERT INTO document_summary_cache
        (doc_id, user_id, owner_type, owner_id, project_key, summary, model, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, owner_type, owner_id, project_key, doc_id) DO UPDATE SET
         summary = EXCLUDED.summary,
         model = EXCLUDED.model,
         expires_at = EXCLUDED.expires_at,
         created_at = NOW()`,
      [docId, userId, scope.ownerType, scope.ownerId, scope.projectKey, summary, model || null, expiresAt],
    );
  } catch (err) {
    console.warn("[Hierarchy] Failed to cache summary:", err);
  }
}

/**
 * Clear summary cache for a document
 */
export async function clearSummaryCache(
  userId: string,
  projectKey: string,
  docId: string,
): Promise<void> {
  try {
    const scope = resolveProjectScope(userId, projectKey);
    await query(
      `DELETE FROM document_summary_cache
       WHERE user_id = $1
         AND owner_type = $2
         AND owner_id = $3
         AND project_key = $4
         AND doc_id = $5`,
      [userId, scope.ownerType, scope.ownerId, scope.projectKey, docId],
    );
  } catch {
    // Ignore errors
  }
}

/**
 * Clear all summary caches for a project
 */
export async function clearProjectSummaryCache(
  userId: string,
  projectKey: string,
): Promise<void> {
  try {
    const scope = resolveProjectScope(userId, projectKey);
    await query(
      `DELETE FROM document_summary_cache
       WHERE user_id = $1 AND owner_type = $2 AND owner_id = $3 AND project_key = $4`,
      [userId, scope.ownerType, scope.ownerId, scope.projectKey],
    );
  } catch {
    // Ignore errors
  }
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Extract plain text from document body
 */
function extractText(body: unknown): string {
  if (!body) return "";

  // Handle different body formats
  if (typeof body === "string") return body;

  const bodyObj = body as { type?: string; content?: unknown };

  if (bodyObj.type === "markdown" && typeof bodyObj.content === "string") {
    return bodyObj.content;
  }

  // Tiptap content
  if (bodyObj.content) {
    return extractTiptapText(bodyObj.content);
  }

  return "";
}

/**
 * Recursively extract text from Tiptap content
 */
function extractTiptapText(node: unknown): string {
  if (!node) return "";

  if (Array.isArray(node)) {
    return node.map(extractTiptapText).join(" ");
  }

  const nodeObj = node as { type?: string; text?: string; content?: unknown };

  if (nodeObj.type === "text" && typeof nodeObj.text === "string") {
    return nodeObj.text;
  }

  if (nodeObj.type === "hardBreak") {
    return "\n";
  }

  if (nodeObj.content) {
    return extractTiptapText(nodeObj.content);
  }

  return "";
}

/**
 * Truncate text to a maximum length
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

// ============================================================
// Context Building for RAG
// ============================================================

/**
 * Build context string from hierarchy for LLM prompt
 */
export function buildHierarchyContextString(hierarchy: HierarchyContext): string {
  if (!hierarchy.ancestors || hierarchy.ancestors.length === 0) {
    return "";
  }

  const parts: string[] = ["### Background Context"];

  for (const ancestor of hierarchy.ancestors) {
    if (ancestor.summary) {
      parts.push(`**${ancestor.title}**: ${ancestor.summary}`);
    } else {
      parts.push(`**${ancestor.title}**`);
    }
  }

  return parts.join("\n");
}

/**
 * Enrich search results with hierarchy context
 */
export async function enrichResultsWithHierarchy<
  T extends { doc_id: string; content: string }
>(
  userId: string,
  projectKey: string,
  results: T[],
  loadConfig: AncestorLoadConfig[] = DEFAULT_LOAD_CONFIG,
): Promise<{
  results: T[];
  hierarchyContext: HierarchyContext;
  contextString: string;
}> {
  const docIds = results.map((r) => r.doc_id);
  const hierarchyContext = await loadHierarchyForSearchResults(
    userId,
    projectKey,
    docIds,
    loadConfig,
  );
  const contextString = buildHierarchyContextString(hierarchyContext);

  return { results, hierarchyContext, contextString };
}
