import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { JSONContent } from "@tiptap/react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import DocumentHeader from "../components/DocumentHeader";
import KnowledgeBaseLayout from "../components/KnowledgeBaseLayout";
import KnowledgeBaseSideNav, {
  type KnowledgeBaseDocument,
  type KnowledgeBaseMoveRequest,
} from "../components/KnowledgeBaseSideNav";
import RichTextViewer from "../components/RichTextViewer";
import {
  fetchDocument,
  fetchDocumentHierarchy,
  fetchDocumentList,
  fetchProposalDiff,
  applyProposal,
  moveDocument,
  importDocument,
  createDocument,
  type DocumentListItem,
  type DocumentDetail,
} from "../api/documents";
import { rebuildDocumentRag } from "../api/projects";
import { uploadAsset } from "../api/assets";
import { sanitizeFileName } from "../utils/fileName";
import { useProjectContext } from "../context/ProjectContext";
import { tiptapJsonToMarkdown } from "@zeus/doc-editor";
import { exportContentJson } from "../utils/exportContentJson";

type DocumentData = {
  id: string;
  title: string;
  docType: string;
  parentId: string;
  content: JSONContent | null;
  hierarchy: Array<{ id: string; name: string }>;
};

type DocumentMetaInfo = {
  id: string;
  title: string;
  docType: string;
  parentId: string;
};



const documentCache = new Map<string, DocumentData>();
const documentPromiseCache = new Map<string, Promise<DocumentData>>();
const documentHierarchyCache = new Map<string, Array<{ id: string; name: string }>>();
const documentHierarchyPromiseCache = new Map<
  string,
  Promise<Array<{ id: string; name: string }>>
>();


type UploadedAsset = {
  asset_id: string;
  filename: string;
  mime: string;
  size: number;
};

type UploadFilterPresetId = "all" | "images" | "office" | "text";

type UploadFilterPreset = {
  id: UploadFilterPresetId;
  label: string;
  extensions: string[];
};

type UploadSummary = {
  directories: number;
  files: number;
  skipped: number;
  converted: number;
  fallback: number;
};

type SmartImportType = "markdown" | "word" | "pdf";

type SmartImportOption = {
  id: SmartImportType;
  label: string;
  enabled: boolean;
};

type DirectoryEntry = {
  path: string;
  name: string;
  parentPath: string | null;
  depth: number;
};

type FileEntry = {
  file: File;
  path: string;
  name: string;
  parentPath: string | null;
};

type DocumentCreateMeta = {
  title: string;
  parentId: string;
};

const UPLOAD_FILTER_PRESETS: UploadFilterPreset[] = [
  { id: "all", label: "All", extensions: [] },
  {
    id: "images",
    label: "Images",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
  },
  {
    id: "office",
    label: "Office/PDF",
    extensions: ["docx", "pptx", "xlsx", "pdf"],
  },
  {
    id: "text",
    label: "Text",
    extensions: ["md", "txt", "csv", "json", "yaml", "yml", "log"],
  },
];

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const TEXT_EXTENSIONS = new Set(["md", "txt", "csv", "json", "yaml", "yml", "log"]);
const TEXT_MIME_PREFIX = "text/";
const TEXT_MIME_VALUES = new Set([
  "application/json",
  "application/x-yaml",
  "application/yaml",
  "application/xml",
  "application/x-www-form-urlencoded",
]);
const TEXT_SNIFF_BYTES = 16 * 1024;
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const MARKDOWN_MIME_VALUES = new Set(["text/markdown", "text/x-markdown"]);
const SMART_IMPORT_OPTIONS: SmartImportOption[] = [
  { id: "markdown", label: "Markdown", enabled: true },
  { id: "word", label: "Word", enabled: false },
  { id: "pdf", label: "PDF", enabled: false },
];

function DocumentPage() {
  const { currentProject } = useProjectContext();
  const params = useParams<{ documentId?: string }>();
  const resolvedProjectKey = (currentProject?.key ?? "").trim();
  const resolvedDocumentId = (params.documentId || "").trim();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const proposalId = (searchParams.get("proposal_id") || "").trim();
  const refreshKey = (() => {
    const state = location.state as { refreshToken?: number | string } | null;
    if (!state?.refreshToken) {
      return "";
    }
    return String(state.refreshToken);
  })();

  const [document, setDocument] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [diffData, setDiffData] = useState<{ metaDiff: string; contentDiff: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [breadcrumbItems, setBreadcrumbItems] = useState<
    Array<{ label: string; to?: string }>
  >([]);
  const [rebuildModalOpen, setRebuildModalOpen] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<"file" | "folder">("file");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadCompleted, setUploadCompleted] = useState(0);
  const [importStatus, setImportStatus] = useState<{
    type: "idle" | "success" | "error";
    message?: string;
  }>({ type: "idle" });
  const [uploadFilterPreset, setUploadFilterPreset] = useState<UploadFilterPresetId>("all");
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [smartImportEnabled, setSmartImportEnabled] = useState(true);
  const [smartImportTypes, setSmartImportTypes] = useState<Set<SmartImportType>>(
    () => new Set(["markdown"]),
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const inFlightRef = useRef<Map<string, Promise<DocumentData>>>(new Map());
  const currentRequestRef = useRef<string | null>(null);
  const refreshKeyRef = useRef<string>("");

  const [rootDocuments, setRootDocuments] = useState<KnowledgeBaseDocument[]>([]);
  const [childrenByParent, setChildrenByParent] = useState<
    Record<string, KnowledgeBaseDocument[]>
  >({});
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});
  const [rootLoading, setRootLoading] = useState(false);
  const projectKeyRef = useRef<string | null>(null);
  const loadingIdsRef = useRef<Record<string, boolean>>({});
  const rootLoadAttemptRef = useRef<string | null>(null);
  const initialRedirectRef = useRef(false);

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

  const activeUploadPreset = useMemo(() => {
    return (
      UPLOAD_FILTER_PRESETS.find((preset) => preset.id === uploadFilterPreset) ??
      UPLOAD_FILTER_PRESETS[0]
    );
  }, [uploadFilterPreset]);

  const uploadAccept = useMemo(() => {
    if (!activeUploadPreset.extensions.length) {
      return undefined;
    }
    return activeUploadPreset.extensions.map((ext) => `.${ext}`).join(",");
  }, [activeUploadPreset]);

  const toggleSmartImportType = useCallback((type: SmartImportType) => {
    setSmartImportTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const isSmartImportTypeSelected = useCallback(
    (type: SmartImportType) => smartImportTypes.has(type),
    [smartImportTypes],
  );

  const mapDocument = useCallback(
    (item: DocumentListItem, parentId: string): KnowledgeBaseDocument => {
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
    },
    [],
  );

  const fetchDocuments = useCallback(
    async (projectKey: string, parentId: string) => {
      const items = await fetchDocumentList(projectKey, parentId);
      const normalizedParent = parentId ? parentId.trim() : "";
      return items
        .map((item) => mapDocument(item, normalizedParent))
        .filter((doc) => doc.id);
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
    async (projectKey: string, parentId: string, options?: { force?: boolean }) => {
      const hasLoaded = Object.prototype.hasOwnProperty.call(childrenByParent, parentId);
      if (!options?.force && hasLoaded) {
        return;
      }
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
    [childrenByParent, fetchDocuments, updateLoadingIds],
  );

  const getDocumentHierarchy = useCallback(async (projectKey: string, documentId: string) => {
    const requestKey = `${projectKey}:${documentId}`;
    const cached = documentHierarchyCache.get(requestKey);
    if (cached) {
      return cached;
    }
    let promise = documentHierarchyPromiseCache.get(requestKey);
    if (!promise) {
      promise = (async () => {
        const items = await fetchDocumentHierarchy(projectKey, documentId);
        return items
          .map((item) => ({
            id: String(item.id ?? "").trim(),
            name: String(item.title ?? "").trim(),
          }))
          .filter((item) => item.id);
      })();
      documentHierarchyPromiseCache.set(requestKey, promise);
      promise.finally(() => {
        if (documentHierarchyPromiseCache.get(requestKey) === promise) {
          documentHierarchyPromiseCache.delete(requestKey);
        }
      });
    }
    const hierarchy = await promise;
    documentHierarchyCache.set(requestKey, hierarchy);
    return hierarchy;
  }, []);

  const loadAncestorChain = useCallback(
    async (projectKey: string, documentId: string) => {
      const items = await getDocumentHierarchy(projectKey, documentId);
      const ids = items
        .map((item) => String(item.id ?? "").trim())
        .filter((id) => id);
      if (ids.length > 0 && ids[ids.length - 1] !== documentId) {
        ids.push(documentId);
      }
      return ids;
    },
    [getDocumentHierarchy],
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
    const projectKey = resolvedProjectKey || null;
    projectKeyRef.current = projectKey;
    setRootDocuments([]);
    setChildrenByParent({});
    setExpandedIds({});
    setLoadingIds({});
    loadingIdsRef.current = {};
    rootLoadAttemptRef.current = null;
    setRootLoading(false);
    initialRedirectRef.current = false;
    if (!projectKey) {
      return;
    }
    loadRootDocuments(projectKey);
  }, [loadRootDocuments, resolvedProjectKey]);

  useEffect(() => {
    if (!resolvedProjectKey || !rootDocuments.length || resolvedDocumentId) {
      return;
    }
    if (rootLoading || initialRedirectRef.current) {
      return;
    }
    const firstDoc = rootDocuments[0];
    if (!firstDoc?.id) {
      return;
    }
    initialRedirectRef.current = true;
    navigate(`/documents/${encodeURIComponent(firstDoc.id)}`, { replace: true });
  }, [navigate, resolvedDocumentId, resolvedProjectKey, rootDocuments, rootLoading]);

  useEffect(() => {
    const projectKey = resolvedProjectKey || null;
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
      if (!resolvedDocumentId) {
        return;
      }
      if (docParentMap.has(resolvedDocumentId)) {
        const ancestors = buildAncestorsFromMap(resolvedDocumentId, docParentMap);
        if (ancestors.length > 0) {
          const expanded: Record<string, boolean> = {};
          ancestors.forEach((id) => {
            expanded[id] = true;
          });
          setExpandedIds((prev) => ({ ...prev, ...expanded }));
        }
        return;
      }
      try {
        const hierarchyIds = await loadAncestorChain(projectKey, resolvedDocumentId);
        const ancestors = hierarchyIds
          .slice(0, -1)
          .filter((id) => id && id !== resolvedDocumentId && !isRootDocumentId(id));
        const seenAncestors = new Set<string>();
        const uniqueAncestors = ancestors.filter((id) => {
          if (seenAncestors.has(id)) {
            return false;
          }
          seenAncestors.add(id);
          return true;
        });
        if (uniqueAncestors.length > 0) {
          const expanded: Record<string, boolean> = {};
          uniqueAncestors.forEach((id) => {
            expanded[id] = true;
          });
          setExpandedIds((prev) => ({ ...prev, ...expanded }));
          for (const ancestorId of uniqueAncestors) {
            await loadChildren(projectKey, ancestorId);
          }
        }
      } catch {
        return;
      }
    };
    void expandToDocument();
  }, [
    buildAncestorsFromMap,
    docParentMap,
    loadAncestorChain,
    loadChildren,
    loadRootDocuments,
    resolvedDocumentId,
    resolvedProjectKey,
  ]);

  const handleToggle = useCallback(
    async (doc: KnowledgeBaseDocument) => {
      if (!resolvedProjectKey || !doc.hasChild) {
        return;
      }
      const nextExpanded = !expandedIds[doc.id];
      if (nextExpanded) {
        await loadChildren(resolvedProjectKey, doc.id);
      }
      setExpandedIds((prev) => ({ ...prev, [doc.id]: nextExpanded }));
    },
    [expandedIds, loadChildren, resolvedProjectKey],
  );

  const handleDocumentsChanged = useCallback(
    async (parentId: string) => {
      if (!resolvedProjectKey) {
        return;
      }
      const normalizedParent = parentId.trim();
      if (!normalizedParent || isRootDocumentId(normalizedParent)) {
        await loadRootDocuments(resolvedProjectKey);
        return;
      }
      setExpandedIds((prev) => ({ ...prev, [normalizedParent]: true }));
      await loadChildren(resolvedProjectKey, normalizedParent, { force: true });
    },
    [loadChildren, loadRootDocuments, resolvedProjectKey],
  );

  const refreshParent = useCallback(
    async (parentId: string) => {
      if (!resolvedProjectKey) {
        return;
      }
      const normalized = parentId.trim();
      if (!normalized || isRootDocumentId(normalized)) {
        await loadRootDocuments(resolvedProjectKey);
        return;
      }
      setExpandedIds((prev) => ({ ...prev, [normalized]: true }));
      await loadChildren(resolvedProjectKey, normalized, { force: true });
    },
    [loadChildren, loadRootDocuments, resolvedProjectKey],
  );

  const handleMove = useCallback(
    async (request: KnowledgeBaseMoveRequest) => {
      if (!resolvedProjectKey) {
        return;
      }
      const movePayload = {
        target_parent_id: request.newParentId,
        before_doc_id: request.beforeId,
        after_doc_id: request.afterId,
      };
      await moveDocument(resolvedProjectKey, request.docId, movePayload);
      await refreshParent(request.sourceParentId);
      if (request.targetParentId !== request.sourceParentId) {
        await refreshParent(request.targetParentId);
      }
    },
    [refreshParent, resolvedProjectKey],
  );

  const handleSelectDocument = useCallback(
    (doc: KnowledgeBaseDocument) => {
      if (!doc.id) {
        return;
      }
      navigate(`/documents/${encodeURIComponent(doc.id)}`);
    },
    [navigate],
  );

  const activeDocument = document;
  const allowChildActions = activeDocument ? activeDocument.docType !== "overview" : true;
  const hasProposal = Boolean(proposalId);

  useEffect(() => {
    if (!resolvedProjectKey || !resolvedDocumentId) {
      setDocument(null);
      setLoading(false);
      setError(null);
      currentRequestRef.current = null;
      return;
    }

    const requestKey = `${resolvedProjectKey}:${resolvedDocumentId}`;
    const shouldBypassCache =
      Boolean(refreshKey) && refreshKeyRef.current !== refreshKey;
    if (refreshKey) {
      refreshKeyRef.current = refreshKey;
    } else {
      refreshKeyRef.current = "";
    }
    if (shouldBypassCache) {
      documentCache.delete(requestKey);
      documentPromiseCache.delete(requestKey);
      inFlightRef.current.delete(requestKey);
      documentHierarchyCache.delete(requestKey);
      documentHierarchyPromiseCache.delete(requestKey);
    }
    const cached = shouldBypassCache ? null : documentCache.get(requestKey);
    if (cached) {
      setDocument(cached);
      setLoading(false);
      setError(null);
      currentRequestRef.current = requestKey;
      return;
    }
    currentRequestRef.current = requestKey;
    let isActive = true;
    setLoading(true);
    setError(null);

    let promise = shouldBypassCache
      ? undefined
      : inFlightRef.current.get(requestKey) ?? documentPromiseCache.get(requestKey);
    if (!promise) {
      promise = (async () => {
        const detail = await fetchDocument(resolvedProjectKey, resolvedDocumentId);
        const mapped = mapDocumentDetail(detail, resolvedDocumentId);
        const cachedHierarchy = documentHierarchyCache.get(requestKey);
        if (cachedHierarchy) {
          mapped.hierarchy = cachedHierarchy;
        }
        return mapped;
      })();
      inFlightRef.current.set(requestKey, promise);
      documentPromiseCache.set(requestKey, promise);
      promise.finally(() => {
        if (inFlightRef.current.get(requestKey) === promise) {
          inFlightRef.current.delete(requestKey);
        }
        if (documentPromiseCache.get(requestKey) === promise) {
          documentPromiseCache.delete(requestKey);
        }
      });
    }

    promise
      .then((mapped) => {
        if (!isActive || currentRequestRef.current !== requestKey) {
          return;
        }
        documentCache.set(requestKey, mapped);
        setDocument(mapped);
      })
      .catch((err) => {
        if (!isActive || currentRequestRef.current !== requestKey) {
          return;
        }
        setError((err as Error).message || "failed to load document");
        setDocument(null);
      })
      .finally(() => {
        if (!isActive || currentRequestRef.current !== requestKey) {
          return;
        }
        setLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [refreshKey, resolvedDocumentId, resolvedProjectKey]);

  useEffect(() => {
    if (!resolvedProjectKey || !resolvedDocumentId) {
      return;
    }
    const applyHierarchy = (hierarchy: Array<{ id: string; name: string }>) => {
      setDocument((prev) => {
        if (!prev || prev.id !== resolvedDocumentId) {
          return prev;
        }
        const updated = { ...prev, hierarchy };
        documentCache.set(`${resolvedProjectKey}:${resolvedDocumentId}`, updated);
        return updated;
      });
    };
    let isActive = true;
    getDocumentHierarchy(resolvedProjectKey, resolvedDocumentId)
      .then((hierarchy) => {
        if (!isActive) {
          return;
        }
        applyHierarchy(hierarchy);
      })
      .catch(() => {
        // ignore hierarchy failures, fallback to document-only breadcrumb
      });

    return () => {
      isActive = false;
    };
  }, [getDocumentHierarchy, resolvedDocumentId, resolvedProjectKey]);

  useEffect(() => {
    if (!proposalId || !resolvedProjectKey || !resolvedDocumentId) {
      setDiffData(null);
      setDiffError(null);
      setDiffLoading(false);
      return;
    }
    let isActive = true;
    setDiffLoading(true);
    setDiffError(null);
    fetchProposalDiff(resolvedProjectKey, resolvedDocumentId, proposalId)
      .then((data) => {
        return {
          metaDiff: data.metaDiff,
          contentDiff: data.contentDiff,
        };
      })
      .then((diff) => {
        if (!isActive) {
          return;
        }
        setDiffData(diff);
      })
      .catch((err) => {
        if (!isActive) {
          return;
        }
        setDiffError((err as Error).message || "failed to load diff");
        setDiffData(null);
      })
      .finally(() => {
        if (!isActive) {
          return;
        }
        setDiffLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [proposalId, resolvedDocumentId, resolvedProjectKey]);

  useEffect(() => {
    if (!resolvedDocumentId) {
      setBreadcrumbItems([]);
      return;
    }
    if (!document || document.id !== resolvedDocumentId) {
      return;
    }
    const items = mapHierarchyToBreadcrumb(document.hierarchy, document.id, document.title);
    setBreadcrumbItems(trimBreadcrumbItems(items));
  }, [document, resolvedDocumentId]);

  const handleEdit = () => {
    if (!activeDocument) {
      return;
    }
    navigate(`/documents/new?document_id=${encodeURIComponent(activeDocument.id)}`);
  };

  const handleExport = useCallback(() => {
    if (!activeDocument) {
      return;
    }
    const content = activeDocument.content ?? { type: "doc", content: [] };
    const markdown = tiptapJsonToMarkdown(content);
    const safeTitle = sanitizeFileName(activeDocument.title || "document");
    const filename = `${safeTitle || "document"}.md`;
    downloadTextFile(markdown, filename, "text/markdown;charset=utf-8");
  }, [activeDocument]);

  const clearProposalParam = () => {
    if (!proposalId) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("proposal_id");
    setSearchParams(next);
  };

  const handleDismissProposal = () => {
    clearProposalParam();
    setDiffData(null);
    setDiffError(null);
  };

  const handleApplyProposal = async () => {
    if (!resolvedProjectKey || !resolvedDocumentId || !proposalId) {
      return;
    }
    if (applyLoading) {
      return;
    }
    setApplyLoading(true);
    setDiffError(null);
    try {
      const data = await applyProposal(resolvedProjectKey, resolvedDocumentId, proposalId);
      const updated = mapDocumentDetail(data, resolvedDocumentId);
      setDocument(updated);
      await handleDocumentsChanged(updated.parentId || "");
      clearProposalParam();
      setDiffData(null);
    } catch (err) {
      setDiffError((err as Error).message || "failed to apply proposal");
    } finally {
      setApplyLoading(false);
    }
  };

  const requestRebuild = async (withSummary: boolean) => {
    if (!resolvedProjectKey || !activeDocument) {
      return;
    }
    if (rebuilding) {
      return;
    }
    setRebuilding(true);
    try {
      await rebuildDocumentRag(resolvedProjectKey, activeDocument.id, { with_summary: withSummary });
      console.log("rag_rebuild_done", {
        docId: activeDocument.id,
        withSummary,
      });
    } catch (err) {
      console.log("rag_rebuild_error", err);
    } finally {
      setRebuilding(false);
    }
  };

  const handleRebuild = () => {
    if (!resolvedProjectKey || !activeDocument || rebuilding) {
      return;
    }
    setRebuildModalOpen(true);
  };

  const handleRebuildChoice = (withSummary: boolean) => {
    setRebuildModalOpen(false);
    requestRebuild(withSummary);
  };

  const handleOpenNew = () => {
    if (!allowChildActions) {
      return;
    }
    const parentID = activeDocument?.id ?? "";
    const target = parentID
      ? `/documents/new?parent_id=${encodeURIComponent(parentID)}`
      : "/documents/new";
    navigate(target);
  };

  const handleOpenImportWithMode = (mode: "file" | "folder") => {
    if (!allowChildActions) {
      return;
    }
    setImportMode(mode);
    setSelectedFiles([]);
    setUploading(false);
    setUploadTotal(0);
    setUploadCompleted(0);
    setImportStatus({ type: "idle" });
    setUploadSummary(null);
    setImportModalOpen(true);
  };

  const handleCloseImport = () => {
    setImportModalOpen(false);
    setUploading(false);
    setUploadTotal(0);
    setUploadCompleted(0);
    setImportStatus({ type: "idle" });
    setUploadSummary(null);
  };

  const handleFilePick = () => {
    fileInputRef.current?.click();
  };

  const handleFolderPick = () => {
    folderInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    setSelectedFiles(files);
    setImportStatus({ type: "idle" });
    setUploadSummary(null);
  };

  const handleModeChange = (nextMode: "file" | "folder") => {
    setImportMode(nextMode);
    setSelectedFiles([]);
    setUploading(false);
    setUploadTotal(0);
    setUploadCompleted(0);
    setImportStatus({ type: "idle" });
    setUploadSummary(null);
  };

  const handleImportSubmit = async () => {
    if (!resolvedProjectKey) {
      console.log("import_missing_project");
      return;
    }
    if (selectedFiles.length === 0) {
      console.log(importMode === "file" ? "import_file_empty" : "import_folder_empty");
      return;
    }

    const { files: filteredFiles, skipped } = filterFilesByPreset(
      selectedFiles,
      activeUploadPreset,
    );
    if (filteredFiles.length === 0) {
      setImportStatus({ type: "error", message: "No files match the selected filter." });
      return;
    }

    const { directories, files } = buildUploadEntries(filteredFiles);
    const totalItems = directories.length + files.length;
    setUploading(true);
    setUploadTotal(totalItems);
    setUploadCompleted(0);
    setImportStatus({ type: "idle" });
    setUploadSummary(null);

    try {
      const baseParentId = activeDocument?.id ?? "";
      const directoryIds = new Map<string, string>();
      let completed = 0;
      let converted = 0;
      let fallback = 0;
      const markCompleted = () => {
        completed += 1;
        setUploadCompleted(completed);
      };

      for (const directory of directories) {
        const parentId = directory.parentPath
          ? directoryIds.get(directory.parentPath) ?? baseParentId
          : baseParentId;
        const created = await createDocumentRecord(
          resolvedProjectKey,
          {
            title: directory.name,
            parentId,
          },
          { type: "doc", content: [] },
        );
        if (created.id) {
          directoryIds.set(directory.path, created.id);
        }
        markCompleted();
      }

      for (const entry of files) {
        const docTitle = stripExtension(entry.name) || entry.name;
        const parentId = entry.parentPath
          ? directoryIds.get(entry.parentPath) ?? baseParentId
          : baseParentId;
        const canSmartImport =
          smartImportEnabled &&
          smartImportTypes.has("markdown") &&
          isMarkdownFile(entry.file);
        if (canSmartImport) {
          await importMarkdownDocument(resolvedProjectKey, entry.file, parentId, docTitle);
          converted += 1;
        } else {
          const uploaded = await uploadSingleFile(resolvedProjectKey, entry.file);
          const isText = await isLikelyTextFile(entry.file, uploaded);
          const block = buildAssetBlock(resolvedProjectKey, uploaded, docTitle, isText);
          await createDocumentRecord(
            resolvedProjectKey,
            {
              title: docTitle,
              parentId,
            },
            block ? { type: "doc", content: [block] } : { type: "doc", content: [] },
          );
          fallback += 1;
        }
        markCompleted();
      }

      setUploadSummary({
        directories: directories.length,
        files: files.length,
        skipped,
        converted,
        fallback,
      });
      setImportStatus({ type: "success", message: "Upload completed." });
      setImportModalOpen(false);
      setSelectedFiles([]);
      await handleDocumentsChanged(baseParentId);
    } catch (err) {
      console.log("import_upload_error", err);
      setImportStatus({ type: "error", message: "Upload failed." });
    } finally {
      setUploading(false);
      setUploadTotal(0);
      setUploadCompleted(0);
    }
  };

  useEffect(() => {
    const folderInput = folderInputRef.current;
    if (!folderInput) {
      return;
    }
    folderInput.setAttribute("webkitdirectory", "true");
    folderInput.setAttribute("directory", "true");
  }, []);

  useEffect(() => {
    if (!allowChildActions) {
      setImportModalOpen(false);
      setUploading(false);
      setUploadTotal(0);
      setUploadCompleted(0);
    }
  }, [allowChildActions]);

  const uploadProgress =
    uploadTotal > 0 ? Math.round((uploadCompleted / uploadTotal) * 100) : 0;

  const bodyContent = () => {
    if (!resolvedDocumentId) {
      return (
        <div className="doc-viewer-state">
          Select a document from the left navigation to view its details.
        </div>
      );
    }
    if (loading) {
      return <div className="doc-viewer-state">Loading document...</div>;
    }
    if (error) {
      return <div className="doc-viewer-error">{error}</div>;
    }
    if (!activeDocument) {
      return <div className="doc-viewer-state">No document available</div>;
    }
    return (
      <div className="doc-page-body">
        <div className="doc-page-title">{activeDocument.title}</div>
        {hasProposal ? (
          <div className="doc-diff-panel">
            <div className="doc-diff-header">
              <span>Proposed Changes</span>
              <div className="doc-diff-actions">
                <button
                  className="doc-diff-action"
                  type="button"
                  onClick={handleApplyProposal}
                  disabled={applyLoading || diffLoading}
                >
                  {applyLoading ? "Applying..." : "Apply"}
                </button>
                <button
                  className="doc-diff-action secondary"
                  type="button"
                  onClick={handleDismissProposal}
                  disabled={applyLoading}
                >
                  Cancel
                </button>
              </div>
            </div>
            {diffLoading ? (
              <div className="doc-diff-state">Loading diff...</div>
            ) : diffError ? (
              <div className="doc-diff-error">{diffError}</div>
            ) : diffData ? (
              <div className="doc-diff-body">
                {diffData.metaDiff ? (
                  <div className="doc-diff-section">
                    <div className="doc-diff-label">Meta</div>
                    <pre className="doc-diff-code">{diffData.metaDiff}</pre>
                  </div>
                ) : null}
                {diffData.contentDiff ? (
                  <div className="doc-diff-section">
                    <div className="doc-diff-label">Content</div>
                    <pre className="doc-diff-code">{diffData.contentDiff}</pre>
                  </div>
                ) : null}
                {!diffData.metaDiff && !diffData.contentDiff ? (
                  <div className="doc-diff-state">No changes detected.</div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {activeDocument.content ? (
          <RichTextViewer
            content={activeDocument.content}
            projectKey={resolvedProjectKey}
          />
        ) : (
          <div className="doc-viewer-state">No document content</div>
        )}
      </div>
    );
  };

  return (
    <KnowledgeBaseLayout
      sideNav={
        <KnowledgeBaseSideNav
          documents={rootDocuments}
          childrenByParent={childrenByParent}
          expandedIds={expandedIds}
          activeId={resolvedDocumentId || null}
          loadingIds={loadingIds}
          rootLoading={rootLoading}
          onSelect={handleSelectDocument}
          onToggle={handleToggle}
          onMove={handleMove}
        />
      }
    >
      <>
        <DocumentHeader
          breadcrumbItems={breadcrumbItems}
          mode="view"
          allowChildActions={allowChildActions}
          allowEdit={Boolean(activeDocument)}
          allowRebuild={Boolean(activeDocument)}
          rebuilding={rebuilding}
          onEdit={handleEdit}
          onSave={() => { }}
          onCancel={() => { }}
          onNew={handleOpenNew}
          onImport={() => handleOpenImportWithMode("file")}
          onRebuild={handleRebuild}
          onExport={activeDocument ? handleExport : undefined}
        />
        <div className="doc-viewer-page">{bodyContent()}</div>
        {importModalOpen ? (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            onClick={handleCloseImport}
          >
            <div className="modal-card" onClick={(event) => event.stopPropagation()}>
              <div className="modal-header">
                <h2>Upload Assets</h2>
                <button className="modal-close" type="button" onClick={handleCloseImport}>
                  Close
                </button>
              </div>
              <div className="modal-body">
                <div className="kb-import-tabs" role="tablist">
                  <button
                    className={`kb-import-tab${importMode === "file" ? " active" : ""}`}
                    type="button"
                    onClick={() => handleModeChange("file")}
                  >
                    File
                  </button>
                  <button
                    className={`kb-import-tab${importMode === "folder" ? " active" : ""}`}
                    type="button"
                    onClick={() => handleModeChange("folder")}
                  >
                    Folder
                  </button>
                </div>
                <div className="kb-import-smart">
                  <div className="kb-import-smart-header">
                    <div className="kb-import-smart-title">Smart Import</div>
                    <button
                      className={`kb-import-toggle${smartImportEnabled ? " active" : ""}`}
                      type="button"
                      aria-pressed={smartImportEnabled}
                      onClick={() => setSmartImportEnabled((prev) => !prev)}
                    >
                      {smartImportEnabled ? "On" : "Off"}
                    </button>
                  </div>
                  <fieldset className="kb-import-smart-options" aria-label="Smart import types">
                    {SMART_IMPORT_OPTIONS.map((option) => {
                      const disabled = !option.enabled || !smartImportEnabled;
                      const active = isSmartImportTypeSelected(option.id);
                      const chipClass = `kb-import-chip${active ? " active" : ""}${disabled ? " disabled" : ""
                        }`;
                      return (
                        <button
                          key={option.id}
                          className={chipClass}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            if (!disabled) {
                              toggleSmartImportType(option.id);
                            }
                          }}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </fieldset>
                </div>
                <div className="kb-import-tabs" role="tablist" aria-label="Filter presets">
                  {UPLOAD_FILTER_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      className={`kb-import-tab${uploadFilterPreset === preset.id ? " active" : ""
                        }`}
                      type="button"
                      onClick={() => setUploadFilterPreset(preset.id)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                {importMode === "file" ? (
                  <div className="kb-import-panel">
                    <div className="kb-import-visual" aria-hidden="true">
                      <svg
                        className="kb-import-icon"
                        viewBox="0 0 48 48"
                        role="presentation"
                      >
                        <path
                          d="M12 6h16l8 8v28H12z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M28 6v10h10"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                      </svg>
                    </div>
                    <div className="kb-import-title">Select a file to import</div>
                    <div className="kb-import-note">Uploads create documents.</div>
                    <button className="btn ghost" type="button" onClick={handleFilePick}>
                      Choose file
                    </button>
                    <div className="kb-import-selection">
                      {selectedFiles[0]?.name ?? "No file selected"}
                    </div>
                  </div>
                ) : (
                  <div className="kb-import-panel">
                    <div className="kb-import-visual" aria-hidden="true">
                      <svg
                        className="kb-import-icon"
                        viewBox="0 0 48 48"
                        role="presentation"
                      >
                        <path
                          d="M6 16h14l4 4h18v20H6z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M6 16v-6h12l4 4h20v6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                      </svg>
                    </div>
                    <div className="kb-import-title">Select a folder to import</div>
                    <div className="kb-import-note">Uploads create documents.</div>
                    <button className="btn ghost" type="button" onClick={handleFolderPick}>
                      Choose folder
                    </button>
                    <div className="kb-import-selection">
                      {selectedFiles.length > 0
                        ? `${selectedFiles.length} files selected`
                        : "No folder selected"}
                    </div>
                  </div>
                )}
                {importStatus.type !== "idle" ? (
                  <div
                    className={`kb-import-status ${importStatus.type === "error" ? "error" : "success"
                      }`}
                  >
                    {importStatus.message}
                  </div>
                ) : null}
                {uploadSummary ? (
                  <div className="kb-import-summary">
                    <div className="kb-import-summary-item">
                      Created folders: {uploadSummary.directories}
                    </div>
                    <div className="kb-import-summary-item">
                      Created documents: {uploadSummary.files}
                    </div>
                    {uploadSummary.converted > 0 ? (
                      <div className="kb-import-summary-item">
                        Smart import: {uploadSummary.converted}
                      </div>
                    ) : null}
                    {uploadSummary.fallback > 0 ? (
                      <div className="kb-import-summary-item">
                        Fallback uploads: {uploadSummary.fallback}
                      </div>
                    ) : null}
                    {uploadSummary.skipped > 0 ? (
                      <div className="kb-import-summary-item">
                        Skipped by filter: {uploadSummary.skipped}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="modal-actions">
                <button className="btn ghost" type="button" onClick={handleCloseImport}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  type="button"
                  onClick={handleImportSubmit}
                  disabled={uploading}
                >
                  {uploading ? <span className="kb-import-spinner" aria-hidden="true" /> : null}
                  {importMode === "folder" && uploading ? `Upload ${uploadProgress}%` : "Upload"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {rebuildModalOpen ? (
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            onClick={() => setRebuildModalOpen(false)}
          >
            <div className="modal-card" onClick={(event) => event.stopPropagation()}>
              <div className="modal-header">
                <h2>Rebuild knowledge</h2>
                <button
                  className="modal-close"
                  type="button"
                  onClick={() => setRebuildModalOpen(false)}
                >
                  Close
                </button>
              </div>
              <div className="modal-body">
                Generate a document summary as well?
              </div>
              <div className="modal-actions">
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => setRebuildModalOpen(false)}
                  disabled={rebuilding}
                >
                  Cancel
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => handleRebuildChoice(false)}
                  disabled={rebuilding}
                >
                  Rebuild only
                </button>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => handleRebuildChoice(true)}
                  disabled={rebuilding}
                >
                  Rebuild + Summary
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <input
          ref={fileInputRef}
          className="kb-file-input"
          type="file"
          accept={uploadAccept}
          onChange={handleFileChange}
        />
        <input
          ref={folderInputRef}
          className="kb-file-input"
          type="file"
          multiple
          accept={uploadAccept}
          onChange={handleFileChange}
        />
      </>
    </KnowledgeBaseLayout>
  );
}

export default DocumentPage;

const mapHierarchyToBreadcrumb = (
  hierarchy: Array<{ id: string; name: string }>,
  fallbackId: string,
  fallbackTitle: string,
) => {
  if (!hierarchy || hierarchy.length === 0) {
    return [
      {
        label: fallbackTitle || "Document",
        to: `/documents/${encodeURIComponent(fallbackId)}`,
      },
    ];
  }
  return hierarchy.map((item) => ({
    label: item.name || "Document",
    to: `/documents/${encodeURIComponent(item.id)}`,
  }));
};

const trimBreadcrumbItems = (items: Array<{ label: string; to?: string }>) => {
  if (items.length <= 4) {
    return items;
  }
  const head = items.slice(0, 2);
  const tail = items.slice(-2);
  return [...head, { label: "..." }, ...tail];
};

function mapDocumentMeta(data: DocumentDetail | undefined | null, fallbackId: string): DocumentMetaInfo {
  const meta = data?.meta ?? {};
  const extra =
    meta.extra && typeof meta.extra === "object"
      ? (meta.extra as Record<string, unknown>)
      : {};
  const extraDocType =
    typeof extra.doc_type === "string"
      ? extra.doc_type
      : typeof extra.type === "string"
        ? extra.type
        : "";
  const bodyType = typeof data?.body?.type === "string" ? data?.body?.type : "";
  const id = String(meta.id ?? data?.id ?? fallbackId ?? "").trim();
  const title = String(meta.title ?? data?.title ?? "").trim();
  const docType =
    String(extraDocType || bodyType || meta.doc_type || data?.doc_type || "").trim() ||
    "document";
  const parentId = String(
    meta.parent_id ?? (meta as { parent?: string }).parent ?? data?.parent_id ?? "",
  ).trim();
  return {
    id,
    title,
    docType,
    parentId,
  };
}

function mapDocumentDetail(data: DocumentDetail | undefined | null, fallbackId: string): DocumentData {
  const meta = mapDocumentMeta(data, fallbackId);
  const body = data?.body;
  const contentPayload = body?.content ?? data?.content;
  let content: JSONContent | null = null;
  if (contentPayload && typeof contentPayload === "object") {
    if ("content" in contentPayload && Array.isArray(contentPayload.content)) {
      content = contentPayload as JSONContent;
    } else if ("content" in contentPayload && typeof contentPayload.content === "object") {
      content = contentPayload.content as JSONContent;
    }
  }
  const hierarchyData = data?.hierarchy ?? [];
  const hierarchy = hierarchyData
    .map((item) => ({
      id: String(item.id ?? "").trim(),
      name: String(item.title ?? "").trim(),
    }))
    .filter((item) => item.id);

  return {
    ...meta,
    content,
    hierarchy,
  };
}

function isRootDocumentId(value: string): boolean {
  return value.trim().toLowerCase() === "root";
}

async function uploadSingleFile(
  projectKey: string,
  file: File,
): Promise<UploadedAsset> {
  const data = await uploadAsset(projectKey, file);
  return {
    asset_id: data.asset_id,
    filename: data.filename,
    mime: data.mime,
    size: data.size,
  };
}

async function createDocumentRecord(
  projectKey: string,
  metaInput: DocumentCreateMeta,
  content: JSONContent,
): Promise<{ id: string; title: string }> {
  const title = metaInput.title.trim() || "Untitled Document";
  const parentId = resolveParentId(metaInput.parentId);
  const slug = sanitizeFileName(title);
  const payload = exportContentJson(content, null);

  const data = await createDocument(
    projectKey,
    {
      title,
      slug: slug || undefined,
      parent_id: parentId,
      extra: {
        status: "draft",
        tags: [],
      },
    },
    {
      type: "tiptap",
      content: payload,
    },
  );

  const meta = data?.meta ?? {};
  return {
    id: String(meta.id ?? data?.id ?? ""),
    title: String(meta.title ?? title),
  };
}

function filterFilesByPreset(
  files: File[],
  preset: UploadFilterPreset,
): { files: File[]; skipped: number } {
  if (!preset.extensions.length) {
    return { files, skipped: 0 };
  }
  const allowed = new Set(preset.extensions.map((ext) => ext.toLowerCase()));
  const filtered: File[] = [];
  let skipped = 0;
  for (const file of files) {
    const extension = getFileExtension(file.name);
    if (extension && allowed.has(extension)) {
      filtered.push(file);
    } else {
      skipped += 1;
    }
  }
  return { files: filtered, skipped };
}

function buildUploadEntries(files: File[]): { directories: DirectoryEntry[]; files: FileEntry[] } {
  const directoryMap = new Map<string, DirectoryEntry>();
  const fileEntries: FileEntry[] = [];

  for (const file of files) {
    const relativePath = normalizeRelativePath(
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name,
    );
    const segments = relativePath.split("/").filter(Boolean);
    if (segments.length === 0) {
      continue;
    }
    const fileName = segments[segments.length - 1];
    let parentPath: string | null = null;

    if (segments.length > 1) {
      const dirSegments = segments.slice(0, -1);
      for (let i = 0; i < dirSegments.length; i += 1) {
        const dirPath = dirSegments.slice(0, i + 1).join("/");
        if (!directoryMap.has(dirPath)) {
          directoryMap.set(dirPath, {
            path: dirPath,
            name: dirSegments[i],
            parentPath: i > 0 ? dirSegments.slice(0, i).join("/") : null,
            depth: i,
          });
        }
      }
      parentPath = dirSegments.join("/");
    }

    fileEntries.push({
      file,
      path: relativePath,
      name: fileName,
      parentPath,
    });
  }

  const directories = Array.from(directoryMap.values()).sort((a, b) => {
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    return a.path.localeCompare(b.path);
  });
  const sortedFiles = fileEntries.sort((a, b) => a.path.localeCompare(b.path));
  return { directories, files: sortedFiles };
}

function buildAssetBlock(
  projectKey: string,
  asset: UploadedAsset,
  title: string,
  isText: boolean,
): JSONContent {
  if (isImageAsset(asset.mime, asset.filename)) {
    const src = buildAssetContentUrl(projectKey, asset.asset_id);
    return {
      type: "image",
      attrs: {
        src,
        alt: title,
        title,
      },
    };
  }
  return {
    type: "file_block",
    attrs: {
      asset_id: asset.asset_id,
      file_name: asset.filename,
      mime: asset.mime,
      size: asset.size,
      file_type: isText ? "text" : "",
    },
  };
}

function buildAssetContentUrl(projectKey: string, assetId: string): string {
  const normalized = assetId.trim();
  if (!normalized) {
    return "";
  }
  if (!projectKey) {
    return normalized;
  }
  return `/api/projects/${encodeURIComponent(projectKey)}/assets/${encodeURIComponent(
    normalized,
  )}/content`;
}

function isImageAsset(mime: string, filename: string): boolean {
  const normalizedMime = mime.toLowerCase();
  if (normalizedMime.startsWith("image/")) {
    return true;
  }
  const extension = getFileExtension(filename);
  return extension ? IMAGE_EXTENSIONS.has(extension) : false;
}

function getFileExtension(filename: string): string {
  const trimmed = filename.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return "";
  }
  return trimmed.slice(lastDot + 1);
}

function isMarkdownFile(file: File): boolean {
  const mime = file.type.trim().toLowerCase();
  if (MARKDOWN_MIME_VALUES.has(mime)) {
    return true;
  }
  const extension = getFileExtension(file.name);
  return extension ? MARKDOWN_EXTENSIONS.has(extension) : false;
}

async function importMarkdownDocument(
  projectKey: string,
  file: File,
  parentId: string,
  title: string,
): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  form.append("parent_id", parentId);
  form.append("title", title);
  form.append("source_type", "markdown");

  await importDocument(projectKey, form);
}

async function isLikelyTextFile(file: File, asset: UploadedAsset): Promise<boolean> {
  const normalizedMime = asset.mime.toLowerCase();
  if (normalizedMime.startsWith(TEXT_MIME_PREFIX) || TEXT_MIME_VALUES.has(normalizedMime)) {
    return true;
  }
  const extension = getFileExtension(asset.filename);
  if (extension && TEXT_EXTENSIONS.has(extension)) {
    return true;
  }
  if (normalizedMime && normalizedMime !== "application/octet-stream") {
    return false;
  }
  return sniffTextContent(file);
}

async function sniffTextContent(file: File): Promise<boolean> {
  try {
    const slice = file.slice(0, TEXT_SNIFF_BYTES);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length === 0) {
      return false;
    }
    let suspicious = 0;
    let printable = 0;
    for (let i = 0; i < bytes.length; i += 1) {
      const value = bytes[i];
      if (value === 0) {
        return false;
      }
      if (value === 9 || value === 10 || value === 13) {
        printable += 1;
        continue;
      }
      if (value >= 32 && value <= 126) {
        printable += 1;
        continue;
      }
      suspicious += 1;
    }
    const printableRatio = printable / bytes.length;
    if (printableRatio >= 0.9) {
      return true;
    }
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const decoded = decoder.decode(bytes);
    if (!decoded) {
      return false;
    }
    let control = 0;
    for (let i = 0; i < decoded.length; i += 1) {
      const code = decoded.charCodeAt(i);
      if (code === 9 || code === 10 || code === 13) {
        continue;
      }
      if (code < 32 || code === 65533) {
        control += 1;
      }
    }
    return control / decoded.length < 0.1;
  } catch {
    return false;
  }
}



function resolveParentId(parentId: string): string {
  const normalized = parentId.trim();
  return normalized || "root";
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function stripExtension(filename: string): string {
  const trimmed = filename.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return trimmed;
  }
  return trimmed.slice(0, lastDot);
}

function downloadTextFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
