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
  slug?: string;
  title?: string;
  kind?: string;
  type?: string;
  doc_type?: string;
  parent?: string;
  parent_id?: string;
  meta?: {
    id?: string;
    title?: string;
    parent_id?: string;
    parent?: string;
    doc_type?: string;
  };
};

type DocumentHierarchyItem = {
  id?: string;
  title?: string;
  parent_id?: string;
};

type DocumentHierarchyResponse = {
  data?: DocumentHierarchyItem[];
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

  const mapDocument = useCallback(
    (item: DocumentResponse, parentId: string): KnowledgeBaseDocument => {
    const rawType = String(
      item.doc_type ?? item.meta?.doc_type ?? item.type ?? "",
    ).toLowerCase();
    let normalizedType =
      rawType === "origin" || rawType === "requirement" ? "document" : rawType;
    if (!normalizedType) {
      normalizedType = "document";
    }
    const kind = String(item.kind ?? "").toLowerCase();
    const hasChild =
      kind === "dir" || Boolean((item as { has_child?: boolean }).has_child);
    return {
      id: String(item.meta?.id ?? item.id ?? ""),
      title: String(item.meta?.title ?? item.title ?? item.slug ?? ""),
      type: normalizedType,
      parentId,
      kind,
      hasChild,
      order: 0,
      storageObjectId: "",
    };
  }, []);

  const fetchDocumentHierarchy = useCallback(
    async (projectKey: string, documentId: string) => {
      const response = await apiFetch(
        `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(
          documentId,
        )}/hierarchy`,
      );
      if (!response.ok) {
        throw new Error("Failed to load document hierarchy");
      }
      const payload = (await response.json()) as DocumentHierarchyResponse;
      return Array.isArray(payload?.data) ? payload.data : [];
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
      const normalizedParent = parentId ? parentId.trim() : "";
      return items
        .map((item: DocumentResponse) => mapDocument(item, normalizedParent))
        .filter((doc: KnowledgeBaseDocument) => doc.id);
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
    async (projectKey: string, documentId: string) => {
      const items = await fetchDocumentHierarchy(projectKey, documentId);
      const ids = items
        .map((item) => String(item.id ?? "").trim())
        .filter((id) => id);
      if (ids.length > 0 && ids[ids.length - 1] !== documentId) {
        ids.push(documentId);
      }
      return ids;
    },
    [fetchDocumentHierarchy],
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
        try {
          const hierarchyIds = await loadAncestorChain(projectKey, documentIdParam);
          const ancestors = hierarchyIds
            .slice(0, -1)
            .filter((id) => id && id !== documentIdParam && !isRootDocumentId(id));
          if (ancestors.length > 0) {
            const expanded: Record<string, boolean> = {};
            ancestors.forEach((id) => {
              expanded[id] = true;
            });
            setExpandedIds((prev) => ({ ...prev, ...expanded }));
            for (const ancestorId of ancestors) {
              await loadChildren(projectKey, ancestorId);
            }
          }
        } catch {
          return;
        }
        return;
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
    (doc: KnowledgeBaseDocument) => {
      if (!doc.id) {
        return;
      }
      setActiveDocumentId(doc.id);
      const params = new URLSearchParams(searchParams);
      params.set("document_id", doc.id);
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
