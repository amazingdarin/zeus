import { query } from "../db/postgres.js";
import { resolveProjectScope } from "../project-scope.js";
import { indexManager } from "../storage/index-manager.js";
import { buildCacheKey, getScopedDocsRoot } from "../storage/paths.js";

type RecentEditRow = {
  doc_id: string;
  edited_at: Date;
};

export type RecentEditDocumentItem = {
  doc_id: string;
  title: string;
  edited_at: string;
};

let initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS document_recent_edits (
          user_id TEXT NOT NULL,
          owner_type TEXT NOT NULL DEFAULT 'personal',
          owner_id TEXT NOT NULL DEFAULT '',
          project_key TEXT NOT NULL,
          doc_id TEXT NOT NULL,
          edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, owner_type, owner_id, project_key, doc_id)
        )
      `);

      await query(`ALTER TABLE document_recent_edits ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'personal'`);
      await query(`ALTER TABLE document_recent_edits ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT ''`);

      await query(`
        UPDATE document_recent_edits
           SET owner_type = CASE WHEN split_part(project_key, '::', 1) = 'team' THEN 'team' ELSE 'personal' END,
               owner_id = split_part(project_key, '::', 2)
         WHERE owner_id = '' AND project_key LIKE '%::%::%'
      `);

      await query(`
        UPDATE document_recent_edits t
           SET owner_type = CASE WHEN p.owner_type = 'team' THEN 'team' ELSE 'personal' END,
               owner_id = p.owner_id
          FROM project p
         WHERE t.owner_id = '' AND t.project_key = p.key
      `);

      await query(`
        UPDATE document_recent_edits
           SET project_key = split_part(project_key, '::', 3)
         WHERE project_key LIKE '%::%::%'
      `);

      await query(`ALTER TABLE document_recent_edits DROP CONSTRAINT IF EXISTS document_recent_edits_pkey`);
      await query(`
        ALTER TABLE document_recent_edits
        ADD CONSTRAINT document_recent_edits_pkey
        PRIMARY KEY (user_id, owner_type, owner_id, project_key, doc_id)
      `);

      await query(`
        CREATE INDEX IF NOT EXISTS idx_document_recent_edits_user_owner_project_order
          ON document_recent_edits (user_id, owner_type, owner_id, project_key, edited_at DESC)
      `);
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }

  await initPromise;
}

function normalizeDocIds(docIds: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawId of docIds) {
    const docId = String(rawId ?? "").trim();
    if (!docId || seen.has(docId)) {
      continue;
    }
    seen.add(docId);
    result.push(docId);
  }

  return result;
}

export const documentRecentEditStore = {
  async list(userId: string, projectKey: string): Promise<RecentEditDocumentItem[]> {
    await ensureInitialized();

    const scope = resolveProjectScope(userId, projectKey);
    const cacheKey = buildCacheKey(userId, scope.scopedProjectKey);
    const docsRoot = getScopedDocsRoot(userId, scope.scopedProjectKey);
    await indexManager.ensure(cacheKey, docsRoot);

    const result = await query<RecentEditRow>(
      `SELECT doc_id, edited_at
       FROM document_recent_edits
       WHERE user_id = $1
         AND owner_type = $2
         AND owner_id = $3
         AND project_key = $4
       ORDER BY edited_at DESC
       LIMIT 10`,
      [userId, scope.ownerType, scope.ownerId, scope.projectKey],
    );

    const staleDocIds: string[] = [];
    const recentEdits: RecentEditDocumentItem[] = [];

    for (const row of result.rows) {
      const docId = String(row.doc_id ?? "").trim();
      if (!docId) {
        continue;
      }

      const cached = indexManager.get(cacheKey, docId);
      if (!cached) {
        staleDocIds.push(docId);
        continue;
      }

      recentEdits.push({
        doc_id: docId,
        title: cached.title || "Untitled",
        edited_at: row.edited_at.toISOString(),
      });
    }

    if (staleDocIds.length > 0) {
      await documentRecentEditStore.removeMany(userId, scope.scopedProjectKey, staleDocIds);
    }

    return recentEdits;
  },

  async touch(userId: string, projectKey: string, docId: string): Promise<void> {
    await ensureInitialized();

    const scope = resolveProjectScope(userId, projectKey);
    const normalizedDocId = String(docId ?? "").trim();
    if (!normalizedDocId) {
      return;
    }

    await query(
      `INSERT INTO document_recent_edits (user_id, owner_type, owner_id, project_key, doc_id, edited_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id, owner_type, owner_id, project_key, doc_id)
       DO UPDATE SET edited_at = NOW()`,
      [userId, scope.ownerType, scope.ownerId, scope.projectKey, normalizedDocId],
    );

    await query(
      `DELETE FROM document_recent_edits
       WHERE user_id = $1
         AND owner_type = $2
         AND owner_id = $3
         AND project_key = $4
         AND doc_id NOT IN (
           SELECT doc_id
           FROM document_recent_edits
           WHERE user_id = $1
             AND owner_type = $2
             AND owner_id = $3
             AND project_key = $4
           ORDER BY edited_at DESC
           LIMIT 10
         )`,
      [userId, scope.ownerType, scope.ownerId, scope.projectKey],
    );
  },

  async removeMany(userId: string, projectKey: string, docIds: string[]): Promise<number> {
    await ensureInitialized();

    const scope = resolveProjectScope(userId, projectKey);
    const normalizedDocIds = normalizeDocIds(docIds);
    if (normalizedDocIds.length === 0) {
      return 0;
    }

    const result = await query(
      `DELETE FROM document_recent_edits
       WHERE user_id = $1
         AND owner_type = $2
         AND owner_id = $3
         AND project_key = $4
         AND doc_id = ANY($5::text[])`,
      [userId, scope.ownerType, scope.ownerId, scope.projectKey, normalizedDocIds],
    );

    return result.rowCount ?? 0;
  },
};
