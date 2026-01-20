import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import KnowledgeBaseLayout from "../components/KnowledgeBaseLayout";
import KnowledgeBaseSideNav, {
  type KnowledgeBaseDocument,
  type KnowledgeBaseMoveRequest,
} from "../components/KnowledgeBaseSideNav";
import DocumentPage from "./DocumentPage";
import { apiFetch } from "../config/api";
import { useProjectContext } from "../context/ProjectContext";

type DocumentResponse = {
  id?: string;
  type?: string;
  doc_type?: string;
  title?: string;
  parent?: string;
  parent_id?: string;
  has_child?: boolean;
  order?: number;
  index?: number;
  storage_object_id?: string;
  meta?: {
    id?: string;
    title?: string;
    parent_id?: string;
    parent?: string;
    doc_type?: string;
  };
};

type DocumentDetailResponse = {
  data?: DocumentResponse;
};

function KnowledgeBasePage() {
  const { currentProject } = useProjectContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rootDocuments, setRootDocuments] = useState<KnowledgeBaseDocument[]>(
    [],
  );
  const [childrenByParent, setChildrenByParent] = useState<
    Record<string, KnowledgeBaseDocument[]>
  >({});
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [activeDocumentMeta, setActiveDocumentMeta] = useState<{
    id: string;
    parentId: string;
    hierarchy: string[];
  } | null>(null);
  const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});
  const [rootLoading, setRootLoading] = useState(false);
  const projectKeyRef = useRef<string | null>(null);
  const loadingIdsRef = useRef<Record<string, boolean>>({});
  const rootLoadAttemptRef = useRef<string | null>(null);
  const documentIdParam = useMemo(() => {
    const value = searchParams.get("document_id");
    return value ? value.trim() : null;
  }, [searchParams]);
  const parentIdParam = useMemo(() => {
    const value = searchParams.get("parent_id");
    return value ? value.trim() : null;
  }, [searchParams]);
  const docParentMap = useMemo(() => {
    const map = new Map<string, string>();
    rootDocuments.forEach((doc) => {
      map.set(doc.id, doc.parentId);
    });
    Object.values(childrenByParent).forEach((children) => {
      children.forEach((doc) => {
        map.set(doc.id, doc.parentId);
      });
    });
    return map;
  }, [childrenByParent, rootDocuments]);

  const mapDocument = useCallback((item: DocumentResponse): KnowledgeBaseDocument => {
    const rawType = String(
      item.doc_type ?? item.meta?.doc_type ?? item.type ?? "",
    ).toLowerCase();
    let normalizedType =
      rawType === "origin" || rawType === "requirement" ? "document" : rawType;
    if (!normalizedType) {
      normalizedType = "document";
    }
    return {
      id: String(item.meta?.id ?? item.id ?? ""),
      title: String(item.meta?.title ?? item.title ?? ""),
      type: normalizedType,
      parentId: String(
        item.meta?.parent_id ?? item.meta?.parent ?? item.parent ?? item.parent_id ?? "",
      ),
      hasChild: Boolean(item.has_child),
      order: Number(item.index ?? item.order ?? 0),
      storageObjectId: String(item.storage_object_id ?? ""),
    };
  }, []);

  const fetchDocumentDetail = useCallback(
    async (projectKey: string, documentId: string) => {
      const response = await apiFetch(
        `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(documentId)}`,
      );
      if (!response.ok) {
        throw new Error("Failed to load document detail");
      }
      const payload = (await response.json()) as DocumentDetailResponse;
      return payload?.data ?? null;
    },
    [],
  );

  const fetchDocuments = useCallback(
    async (projectKey: string, parentId: string) => {
      const params = new URLSearchParams({ parent_id: parentId });
      const response = await apiFetch(
        `/api/projects/${encodeURIComponent(projectKey)}/documents?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error("Failed to load documents");
      }
      const payload = await response.json();
      const items = Array.isArray(payload?.data) ? payload.data : [];
      return items.map(mapDocument).filter((doc: KnowledgeBaseDocument) => doc.id);
    },
    [mapDocument],
  );

  const loadRootDocuments = useCallback(
    async (projectKey: string) => {
      rootLoadAttemptRef.current = projectKey;
      setRootLoading(true);
      try {
        const docs = await fetchDocuments(projectKey, "");
        if (projectKeyRef.current !== projectKey) {
          return;
        }
        setRootDocuments(docs);
      } catch {
        if (projectKeyRef.current === projectKey) {
          setRootDocuments([]);
        }
      } finally {
        if (projectKeyRef.current === projectKey) {
          setRootLoading(false);
        }
      }
    },
    [fetchDocuments],
  );

  const updateLoadingIds = useCallback((parentId: string, value: boolean) => {
    setLoadingIds((prev) => {
      const next = { ...prev, [parentId]: value };
      loadingIdsRef.current = next;
      return next;
    });
  }, []);

  const loadChildren = useCallback(
    async (projectKey: string, parentId: string) => {
      if (loadingIdsRef.current[parentId]) {
        return;
      }
      updateLoadingIds(parentId, true);
      try {
        const docs = await fetchDocuments(projectKey, parentId);
        if (projectKeyRef.current !== projectKey) {
          return;
        }
        setChildrenByParent((prev) => ({ ...prev, [parentId]: docs }));
      } catch {
        if (projectKeyRef.current === projectKey) {
          setChildrenByParent((prev) => ({ ...prev, [parentId]: [] }));
        }
      } finally {
        if (projectKeyRef.current === projectKey) {
          updateLoadingIds(parentId, false);
        }
      }
    },
    [fetchDocuments, updateLoadingIds],
  );

  const refreshChildren = loadChildren;

  const loadAncestorChain = useCallback(
    async (projectKey: string, documentId: string, initialParentId?: string) => {
      const ancestors: string[] = [];
      const visited = new Set<string>();
      const initialParent = initialParentId?.trim();
      if (initialParent !== undefined) {
        if (!initialParent || isRootDocumentId(initialParent)) {
          return [];
        }
        ancestors.push(initialParent);
        let currentId = initialParent;
        while (currentId && !visited.has(currentId)) {
          if (isRootDocumentId(currentId)) {
            break;
          }
          visited.add(currentId);
          const detail = await fetchDocumentDetail(projectKey, currentId);
          if (!detail) {
            break;
          }
          const parentId = String(
            detail.meta?.parent_id ??
              detail.meta?.parent ??
              detail.parent ??
              detail.parent_id ??
              "",
          ).trim();
          if (!parentId || isRootDocumentId(parentId)) {
            break;
          }
          ancestors.push(parentId);
          currentId = parentId;
        }
        return ancestors.reverse();
      }
      let currentId = documentId;
      while (currentId && !visited.has(currentId)) {
        if (isRootDocumentId(currentId)) {
          break;
        }
        visited.add(currentId);
        const detail = await fetchDocumentDetail(projectKey, currentId);
        if (!detail) {
          break;
        }
        const parentId = String(
          detail.meta?.parent_id ??
            detail.meta?.parent ??
            detail.parent ??
            detail.parent_id ??
            "",
        ).trim();
        if (!parentId || isRootDocumentId(parentId)) {
          break;
        }
        ancestors.push(parentId);
        currentId = parentId;
      }
      return ancestors.reverse();
    },
    [fetchDocumentDetail],
  );

  const buildAncestorsFromMap = useCallback(
    (documentId: string, map: Map<string, string>) => {
      const ancestors: string[] = [];
      const visited = new Set<string>();
      let currentId = map.get(documentId);
      while (currentId && !visited.has(currentId)) {
        if (isRootDocumentId(currentId)) {
          break;
        }
        ancestors.push(currentId);
        visited.add(currentId);
        currentId = map.get(currentId);
      }
      return ancestors.reverse();
    },
    [],
  );

  useEffect(() => {
    const projectKey = currentProject?.key ?? null;
    projectKeyRef.current = projectKey;
    setRootDocuments([]);
    setChildrenByParent({});
    setExpandedIds({});
    setLoadingIds({});
    loadingIdsRef.current = {};
    rootLoadAttemptRef.current = null;
    setRootLoading(false);
    setActiveDocumentMeta(null);
    if (!projectKey) {
      return;
    }
    loadRootDocuments(projectKey);
  }, [currentProject?.key, loadRootDocuments]);

  useEffect(() => {
    const projectKey = currentProject?.key ?? null;
    setActiveDocumentId(documentIdParam);
    if (!projectKey) {
      return;
    }
    const ensureRootLoaded = async () => {
      if (rootLoadAttemptRef.current !== projectKey) {
        await loadRootDocuments(projectKey);
      }
    };
    const expandToDocument = async () => {
      await ensureRootLoaded();
      if (projectKeyRef.current !== projectKey) {
        return;
      }
      if (documentIdParam) {
        if (docParentMap.has(documentIdParam)) {
          const ancestors = buildAncestorsFromMap(documentIdParam, docParentMap);
          if (ancestors.length > 0) {
            const expanded: Record<string, boolean> = {};
            ancestors.forEach((id) => {
              expanded[id] = true;
            });
            setExpandedIds((prev) => ({ ...prev, ...expanded }));
          }
          return;
        }
        if (activeDocumentMeta && activeDocumentMeta.id === documentIdParam) {
          const ancestors = activeDocumentMeta.hierarchy.filter(
            (id) => id && id !== documentIdParam && !isRootDocumentId(id),
          );
          if (ancestors.length > 0) {
            const expanded: Record<string, boolean> = {};
            ancestors.forEach((id) => {
              expanded[id] = true;
            });
            setExpandedIds((prev) => ({ ...prev, ...expanded }));
            for (const ancestorId of ancestors) {
              await loadChildren(projectKey, ancestorId);
            }
            return;
          }
        }
        if (!activeDocumentMeta || activeDocumentMeta.id !== documentIdParam) {
          return;
        }
      }
      if (parentIdParam) {
        setExpandedIds((prev) => ({ ...prev, [parentIdParam]: true }));
        loadChildren(projectKey, parentIdParam);
      }
    };
    void expandToDocument();
  }, [
    currentProject?.key,
    documentIdParam,
    docParentMap,
    buildAncestorsFromMap,
    loadAncestorChain,
    loadChildren,
    parentIdParam,
    activeDocumentMeta,
    loadRootDocuments,
  ]);

  const handleToggle = useCallback(
    async (doc: KnowledgeBaseDocument) => {
      if (!currentProject?.key || !doc.hasChild) {
        return;
      }
      const nextExpanded = !expandedIds[doc.id];
      if (nextExpanded) {
        await loadChildren(currentProject.key, doc.id);
      }
      setExpandedIds((prev) => ({ ...prev, [doc.id]: nextExpanded }));
    },
    [currentProject, expandedIds, loadChildren],
  );

  const handleDocumentsChanged = useCallback(
    async (parentId: string) => {
      const projectKey = currentProject?.key;
      if (!projectKey) {
        return;
      }
      const normalizedParent = parentId.trim();
      if (!normalizedParent || isRootDocumentId(normalizedParent)) {
        await loadRootDocuments(projectKey);
        return;
      }
      setExpandedIds((prev) => ({ ...prev, [normalizedParent]: true }));
      await loadChildren(projectKey, normalizedParent);
    },
    [currentProject, loadChildren, loadRootDocuments],
  );

  const handleSelectDocument = useCallback(
    (id: string) => {
      setActiveDocumentId(id);
      const params = new URLSearchParams(searchParams);
      if (id) {
        params.set("document_id", id);
      } else {
        params.delete("document_id");
      }
      params.delete("parent_id");
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const refreshParent = useCallback(
    async (parentId: string) => {
      const projectKey = currentProject?.key;
      if (!projectKey) {
        return;
      }
      const normalized = parentId.trim();
      if (!normalized || isRootDocumentId(normalized)) {
        await loadRootDocuments(projectKey);
        return;
      }
      setExpandedIds((prev) => ({ ...prev, [normalized]: true }));
      await loadChildren(projectKey, normalized);
    },
    [currentProject?.key, loadChildren, loadRootDocuments],
  );

  const handleMove = useCallback(
    async (request: KnowledgeBaseMoveRequest) => {
      const projectKey = currentProject?.key;
      if (!projectKey) {
        return;
      }
      const payload = {
        new_parent_id: request.newParentId,
        before_id: request.beforeId,
        after_id: request.afterId,
      };
      const response = await apiFetch(
        `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(request.docId)}/move`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        return;
      }
      await refreshParent(request.sourceParentId);
      if (request.targetParentId !== request.sourceParentId) {
        await refreshParent(request.targetParentId);
      }
    },
    [currentProject?.key, refreshParent],
  );

  return (
    <KnowledgeBaseLayout
      sideNav={
        <KnowledgeBaseSideNav
          documents={rootDocuments}
          childrenByParent={childrenByParent}
          expandedIds={expandedIds}
          activeId={activeDocumentId}
          loadingIds={loadingIds}
          rootLoading={rootLoading}
          onSelect={handleSelectDocument}
          onToggle={handleToggle}
          onMove={handleMove}
        />
      }
    >
      <DocumentPage
        projectKey={currentProject?.key ?? ""}
        documentId={activeDocumentId}
        onDocumentsChanged={handleDocumentsChanged}
        onDocumentMetaLoaded={setActiveDocumentMeta}
      />
    </KnowledgeBaseLayout>
  );
}

export default KnowledgeBasePage;

function isRootDocumentId(value: string): boolean {
  return value.trim().toLowerCase() === "root";
}
