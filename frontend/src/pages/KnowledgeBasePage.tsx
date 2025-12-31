import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import KnowledgeBaseHeader from "../components/KnowledgeBaseHeader";
import KnowledgeBaseLayout from "../components/KnowledgeBaseLayout";
import KnowledgeBaseSideNav, {
  type KnowledgeBaseDocument,
} from "../components/KnowledgeBaseSideNav";
import { buildApiUrl } from "../config/api";
import { useProjectContext } from "../context/ProjectContext";

type DocumentResponse = {
  id?: string;
  type?: string;
  title?: string;
  parent_id?: string;
  has_child?: boolean;
  order?: number;
};

function KnowledgeBasePage() {
  const { currentProject } = useProjectContext();
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

  const mapDocument = useCallback((item: DocumentResponse): KnowledgeBaseDocument => {
    return {
      id: String(item.id ?? ""),
      title: String(item.title ?? ""),
      type: String(item.type ?? "").toLowerCase(),
      parentId: String(item.parent_id ?? ""),
      hasChild: Boolean(item.has_child),
      order: Number(item.order ?? 0),
    };
  }, []);

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

  const loadChildren = useCallback(
    async (projectKey: string, parentId: string) => {
      if (loadingIds[parentId]) {
        return;
      }
      setLoadingIds((prev) => ({ ...prev, [parentId]: true }));
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
          setLoadingIds((prev) => ({ ...prev, [parentId]: false }));
        }
      }
    },
    [fetchDocuments, loadingIds],
  );

  const refreshChildren = loadChildren;

  useEffect(() => {
    const projectKey = currentProject?.key ?? null;
    projectKeyRef.current = projectKey;
    setRootDocuments([]);
    setChildrenByParent({});
    setExpandedIds({});
    setActiveDocumentId(null);
    setLoadingIds({});
    setRootLoading(false);
    if (!projectKey) {
      return;
    }
    loadRootDocuments(projectKey);
  }, [currentProject?.key, loadRootDocuments]);

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
    () =>
      rootDocuments.filter(
        (doc) => doc.type === "origin" || doc.type === "requirement",
      ),
    [rootDocuments],
  );
  const moduleDocs = useMemo(
    () =>
      rootDocuments.filter(
        (doc) => doc.type !== "overview" && doc.type !== "origin" && doc.type !== "requirement",
      ),
    [rootDocuments],
  );
  const documentIndex = useMemo(() => {
    const index: Record<string, KnowledgeBaseDocument> = {};
    rootDocuments.forEach((doc) => {
      index[doc.id] = doc;
    });
    Object.values(childrenByParent).forEach((docs) => {
      docs.forEach((doc) => {
        index[doc.id] = doc;
      });
    });
    return index;
  }, [rootDocuments, childrenByParent]);
  const activeDocument = activeDocumentId ? documentIndex[activeDocumentId] ?? null : null;
  const allowChildActions = activeDocument?.type !== "overview";
  const handleImportSuccess = useCallback(
    (parentId: string | null) => {
      if (!currentProject?.key) {
        return;
      }
      if (!parentId) {
        loadRootDocuments(currentProject.key);
        return;
      }
      refreshChildren(currentProject.key, parentId);
    },
    [currentProject?.key, loadRootDocuments, refreshChildren],
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
      <KnowledgeBaseHeader
        allowChildActions={allowChildActions}
        projectKey={currentProject?.key ?? null}
        parentDocumentId={activeDocumentId}
        onImportSuccess={handleImportSuccess}
      />
      <p className="content-subtitle">
        Select a document from the left navigation to view its details.
      </p>
      <div className="content-panel">
        <div>
          <div className="panel-title">Document workspace</div>
          <p>
            {activeDocumentId
              ? `Selected document id: ${activeDocumentId}`
              : "Choose a document to start reviewing content."}
          </p>
        </div>
      </div>
    </KnowledgeBaseLayout>
  );
}

export default KnowledgeBasePage;
