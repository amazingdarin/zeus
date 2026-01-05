import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import KnowledgeBaseLayout from "../components/KnowledgeBaseLayout";
import KnowledgeBaseSideNav, {
  type KnowledgeBaseDocument,
} from "../components/KnowledgeBaseSideNav";
import DocumentPage from "./DocumentPage";
import { buildApiUrl } from "../config/api";
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
  storage_object_id?: string;
  meta?: {
    id?: string;
    title?: string;
    parent?: string;
    doc_type?: string;
  };
};

type DocumentDetailResponse = {
  data?: DocumentResponse;
};

function KnowledgeBasePage() {
  const { currentProject } = useProjectContext();
  const [searchParams] = useSearchParams();
  const [rootDocuments, setRootDocuments] = useState<KnowledgeBaseDocument[]>(
    [],
  );
  const [childrenByParent, setChildrenByParent] = useState<
    Record<string, KnowledgeBaseDocument[]>
  >({});
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});
  const [rootLoading, setRootLoading] = useState(false);
  const projectKeyRef = useRef<string | null>(null);
  const loadingIdsRef = useRef<Record<string, boolean>>({});
  const documentIdParam = useMemo(() => {
    const value = searchParams.get("document_id");
    return value ? value.trim() : null;
  }, [searchParams]);
  const parentIdParam = useMemo(() => {
    const value = searchParams.get("parent_id");
    return value ? value.trim() : null;
  }, [searchParams]);

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
      parentId: String(item.meta?.parent ?? item.parent ?? item.parent_id ?? ""),
      hasChild: Boolean(item.has_child),
      order: Number(item.order ?? 0),
      storageObjectId: String(item.storage_object_id ?? ""),
    };
  }, []);

  const fetchDocumentDetail = useCallback(
    async (projectKey: string, documentId: string) => {
      const url = buildApiUrl(
        `/api/projects/${encodeURIComponent(projectKey)}/documents/${encodeURIComponent(documentId)}`,
      );
      const response = await fetch(url);
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
      const url = buildApiUrl(
        `/api/projects/${encodeURIComponent(projectKey)}/documents?${params.toString()}`,
      );
      const response = await fetch(url);
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
      const ancestors: string[] = [];
      const visited = new Set<string>();
      let currentId = documentId;
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const detail = await fetchDocumentDetail(projectKey, currentId);
        if (!detail) {
          break;
        }
        const parentId = String(detail.meta?.parent ?? detail.parent ?? detail.parent_id ?? "").trim();
        if (!parentId) {
          break;
        }
        ancestors.push(parentId);
        currentId = parentId;
      }
      return ancestors.reverse();
    },
    [fetchDocumentDetail],
  );

  useEffect(() => {
    const projectKey = currentProject?.key ?? null;
    projectKeyRef.current = projectKey;
    setRootDocuments([]);
    setChildrenByParent({});
    setExpandedIds({});
    setActiveDocumentId(documentIdParam);
    setLoadingIds({});
    loadingIdsRef.current = {};
    setRootLoading(false);
    if (!projectKey) {
      return;
    }
    loadRootDocuments(projectKey);
    const expandToDocument = async () => {
      if (documentIdParam) {
        try {
          const ancestors = await loadAncestorChain(projectKey, documentIdParam);
          if (projectKeyRef.current !== projectKey) {
            return;
          }
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
        } catch {
          // ignore and fallback
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
    loadAncestorChain,
    loadChildren,
    loadRootDocuments,
    parentIdParam,
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

  const overviewDocs = useMemo(
    () => rootDocuments.filter((doc) => doc.type === "overview"),
    [rootDocuments],
  );
  const documentDocs = useMemo(
    () => rootDocuments.filter((doc) => doc.type === "document"),
    [rootDocuments],
  );
  const moduleDocs = useMemo(
    () =>
      rootDocuments.filter((doc) => doc.type !== "overview" && doc.type !== "document"),
    [rootDocuments],
  );
  return (
    <KnowledgeBaseLayout
      sideNav={
        <KnowledgeBaseSideNav
          overviewDocs={overviewDocs}
          moduleDocs={moduleDocs}
          documentDocs={documentDocs}
          childrenByParent={childrenByParent}
          expandedIds={expandedIds}
          activeId={activeDocumentId}
          loadingIds={loadingIds}
          rootLoading={rootLoading}
          onSelect={setActiveDocumentId}
          onToggle={handleToggle}
        />
      }
    >
      <DocumentPage
        projectKey={currentProject?.key ?? ""}
        documentId={activeDocumentId}
      />
    </KnowledgeBaseLayout>
  );
}

export default KnowledgeBasePage;
