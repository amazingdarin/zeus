import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import type { Extensions } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import { Image } from "@tiptap/extension-image";
import { StarterKit } from "@tiptap/starter-kit";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import DocumentHeader from "../components/DocumentHeader";
import KnowledgeBaseLayout from "../components/KnowledgeBaseLayout";
import KnowledgeBaseSideNav, {
  type KnowledgeBaseDocument,
  type KnowledgeBaseMoveRequest,
} from "../components/KnowledgeBaseSideNav";
import RichTextViewer from "../components/RichTextViewer";
import DocumentOptimizeModal from "../components/DocumentOptimizeModal";
import {
  fetchDocument,
  fetchDocumentHierarchy,
  fetchDocumentTree,
  fetchProposalDiff,
  applyProposal,
  moveDocument,
  createDocument,
  deleteDocument,
  fetchUrlHtml,
  importGit,
  type DocumentDetail,
  type DocumentTreeItem,
} from "../api/documents";
import { rebuildDocumentRag, rebuildProjectRag, getRebuildStatus } from "../api/projects";
import { uploadAsset } from "../api/assets";
import { apiFetch } from "../config/api";
import { sanitizeFileName } from "../utils/fileName";
import { useProjectContext } from "../context/ProjectContext";
import {
  CodeBlockNode,
  FileBlockNode,
  HorizontalRule,
  OpenApiNode,
  OpenApiRefNode,
} from "@zeus/doc-editor";
import {
  buildUploadEntries,
  fetchUrlHtmlWithFallback,
  getFileExtension,
  isDocxFile,
  isImageAsset,
  isLikelyTextFile,
  isMarkdownFile,
  isValidGitBranch,
  isValidHttpUrl,
  markdownToTiptapJson,
  tiptapJsonToMarkdown,
} from "@zeus/shared";
import { exportContentJson } from "../utils/exportContentJson";
import { convertDocument } from "../api/convert";
import { ocrApi } from "../api/ocr";

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

type UploadFilterPresetId = "all" | "images" | "office" | "text" | "markdown";

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

type SmartImportType = "all" | "markdown" | "word" | "pdf" | "image";

type SmartImportOption = {
  id: SmartImportType;
  label: string;
  enabled: boolean;
};

type DocumentCreateMeta = {
  title: string;
  parentId: string;
  extra?: Record<string, unknown>;
};

const UPLOAD_FILTER_PRESETS: UploadFilterPreset[] = [
  { id: "all", label: "全部", extensions: [] },
  {
    id: "images",
    label: "图片",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
  },
  {
    id: "office",
    label: "办公文档",
    extensions: ["docx", "pptx", "xlsx", "pdf"],
  },
  {
    id: "text",
    label: "文本",
    extensions: ["txt", "csv", "json", "yaml", "yml", "log"],
  },
  {
    id: "markdown",
    label: "Markdown",
    extensions: ["md", "markdown"],
  },
];

const SMART_IMPORT_OPTIONS: SmartImportOption[] = [
  { id: "all", label: "全部", enabled: true },
  { id: "markdown", label: "Markdown", enabled: true },
  { id: "word", label: "Word 文档", enabled: true },
  { id: "pdf", label: "PDF", enabled: true },
  { id: "image", label: "图片", enabled: true },
];

// All individual smart import types (excluding "all")
const ALL_SMART_IMPORT_TYPES: SmartImportType[] = ["markdown", "word", "pdf", "image"];

// All individual upload filter presets (excluding "all")
const ALL_UPLOAD_FILTER_PRESETS: UploadFilterPresetId[] = ["images", "office", "text", "markdown"];

const createDefaultUploadFilterSet = () => new Set<UploadFilterPresetId>(ALL_UPLOAD_FILTER_PRESETS);

const buildUploadFilterPreset = (
  selectedPresets: Set<UploadFilterPresetId>,
): UploadFilterPreset => {
  // If all presets are selected or none are selected, return "all" (no filtering)
  const hasAll = ALL_UPLOAD_FILTER_PRESETS.every((p) => selectedPresets.has(p));
  if (hasAll || selectedPresets.size === 0) {
    return UPLOAD_FILTER_PRESETS[0];
  }
  const extensions: string[] = [];
  const seen = new Set<string>();
  UPLOAD_FILTER_PRESETS.forEach((preset) => {
    if (preset.id === "all" || !selectedPresets.has(preset.id)) {
      return;
    }
    preset.extensions.forEach((ext) => {
      if (!seen.has(ext)) {
        seen.add(ext);
        extensions.push(ext);
      }
    });
  });
  return {
    id: "all",
    label: "Custom",
    extensions,
  };
};

const buildMarkdownExtensions = (projectKey: string): Extensions => [
  StarterKit.configure({
    horizontalRule: false,
    codeBlock: false,
  }),
  HorizontalRule,
  CodeBlockNode,
  Image,
  FileBlockNode.configure({
    projectKey,
    fetcher: apiFetch,
  }),
  OpenApiNode.configure({
    projectKey,
    fetcher: apiFetch,
  }),
  OpenApiRefNode.configure({
    projectKey,
    fetcher: apiFetch,
  }),
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
  const [deleting, setDeleting] = useState(false);
  const [diffData, setDiffData] = useState<{ metaDiff: string; contentDiff: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [breadcrumbItems, setBreadcrumbItems] = useState<
    Array<{ label: string; to?: string }>
  >([]);
  const [rebuildModalOpen, setRebuildModalOpen] = useState(false);
  const [optimizeModalOpen, setOptimizeModalOpen] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<"file" | "folder" | "url" | "git">("file");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [importUrl, setImportUrl] = useState("");
  const [importUrlTitle, setImportUrlTitle] = useState("");
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [gitSubdir, setGitSubdir] = useState("");
  const [gitLogEntries, setGitLogEntries] = useState<{ id: string; text: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadCompleted, setUploadCompleted] = useState(0);
  const [importStatus, setImportStatus] = useState<{
    type: "idle" | "success" | "error";
    message?: string;
  }>({ type: "idle" });
  const [uploadFilterPresets, setUploadFilterPresets] = useState<Set<UploadFilterPresetId>>(
    () => createDefaultUploadFilterSet(),
  );
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [smartImportEnabled, setSmartImportEnabled] = useState(true);
  const [smartImportTypes, setSmartImportTypes] = useState<Set<SmartImportType>>(
    () => new Set(ALL_SMART_IMPORT_TYPES),
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
  const childrenByParentRef = useRef<Record<string, KnowledgeBaseDocument[]>>({});
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});
  const [rootLoading, setRootLoading] = useState(false);
  const [rebuildingIndex, setRebuildingIndex] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState<{
    total: number;
    processed: number;
    status: string;
  } | null>(null);
  const rebuildPollingRef = useRef<number | null>(null);
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

  const activeUploadPreset = useMemo(
    () => buildUploadFilterPreset(uploadFilterPresets),
    [uploadFilterPresets],
  );

  const uploadAccept = useMemo(() => {
    if (!activeUploadPreset.extensions.length) {
      return undefined;
    }
    return activeUploadPreset.extensions.map((ext) => `.${ext}`).join(",");
  }, [activeUploadPreset]);

  const isUploadFilterSelected = useCallback(
    (id: UploadFilterPresetId) => {
      if (id === "all") {
        return ALL_UPLOAD_FILTER_PRESETS.every((p) => uploadFilterPresets.has(p));
      }
      return uploadFilterPresets.has(id);
    },
    [uploadFilterPresets],
  );

  const toggleUploadFilterPreset = useCallback((id: UploadFilterPresetId) => {
    setUploadFilterPresets((prev) => {
      const next = new Set(prev);
      const hasAll = ALL_UPLOAD_FILTER_PRESETS.every((p) => next.has(p));

      if (id === "all") {
        if (hasAll) {
          return new Set<UploadFilterPresetId>(); // Deselect all
        }
        return new Set<UploadFilterPresetId>(ALL_UPLOAD_FILTER_PRESETS); // Select all
      }

      // Toggle individual preset
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const markdownExtensions = useMemo(
    () => buildMarkdownExtensions(resolvedProjectKey),
    [resolvedProjectKey],
  );

  const toggleSmartImportType = useCallback((type: SmartImportType) => {
    setSmartImportTypes((prev) => {
      if (type === "all") {
        // If "all" is clicked, toggle between all selected and none selected
        const hasAll = ALL_SMART_IMPORT_TYPES.every((t) => prev.has(t));
        if (hasAll) {
          // Deselect all
          return new Set<SmartImportType>();
        }
        // Select all
        return new Set<SmartImportType>(ALL_SMART_IMPORT_TYPES);
      }
      
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const isSmartImportTypeSelected = (type: SmartImportType) => {
    if (type === "all") {
      // "All" is selected if all individual types are selected
      return ALL_SMART_IMPORT_TYPES.every((t) => smartImportTypes.has(t));
    }
    return smartImportTypes.has(type);
  };

  /**
   * Convert a tree item to KnowledgeBaseDocument format
   */
  const treeItemToDocument = useCallback(
    (item: DocumentTreeItem, parentId: string): KnowledgeBaseDocument => {
      return {
        id: item.id,
        title: item.title || "Untitled",
        type: "document",
        parentId,
        kind: item.kind,
        hasChild: !!(item.children && item.children.length > 0),
        order: 0,
        storageObjectId: "",
      };
    },
    [],
  );

  /**
   * Flatten a nested tree into rootDocuments and childrenByParent
   */
  const flattenTree = useCallback(
    (tree: DocumentTreeItem[], parentId: string = ""): {
      rootDocs: KnowledgeBaseDocument[];
      childrenMap: Record<string, KnowledgeBaseDocument[]>;
    } => {
      const rootDocs: KnowledgeBaseDocument[] = [];
      const childrenMap: Record<string, KnowledgeBaseDocument[]> = {};

      const processItems = (items: DocumentTreeItem[], parent: string) => {
        const docs = items.map((item) => treeItemToDocument(item, parent));
        
        if (parent === "") {
          rootDocs.push(...docs);
        } else {
          childrenMap[parent] = docs;
        }

        // Process children recursively
        for (const item of items) {
          if (item.children && item.children.length > 0) {
            processItems(item.children, item.id);
          }
        }
      };

      processItems(tree, parentId);
      return { rootDocs, childrenMap };
    },
    [treeItemToDocument],
  );

  /**
   * Load the full document tree at once
   */
  const loadFullTree = useCallback(
    async (projectKey: string) => {
      rootLoadAttemptRef.current = projectKey;
      setRootLoading(true);
      try {
        const tree = await fetchDocumentTree(projectKey);
        if (projectKeyRef.current !== projectKey) {
          return;
        }
        const { rootDocs, childrenMap } = flattenTree(tree);
        setRootDocuments(rootDocs);
        childrenByParentRef.current = childrenMap;
        setChildrenByParent(childrenMap);
      } catch {
        if (projectKeyRef.current === projectKey) {
          setRootDocuments([]);
          childrenByParentRef.current = {};
          setChildrenByParent({});
        }
      } finally {
        if (projectKeyRef.current === projectKey) {
          setRootLoading(false);
        }
      }
    },
    [flattenTree],
  );

  // Keep loadRootDocuments as alias for backward compatibility
  const loadRootDocuments = loadFullTree;

  // Use ref to store latest loadFullTree to avoid effect dependency issues
  const loadFullTreeRef = useRef(loadFullTree);
  useEffect(() => {
    loadFullTreeRef.current = loadFullTree;
  }, [loadFullTree]);

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

  // Track previous project key to detect project switch
  const prevProjectKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const projectKey = resolvedProjectKey || null;
    const prevProjectKey = prevProjectKeyRef.current;
    
    // Detect project switch (not initial load)
    const isProjectSwitch = prevProjectKey !== null && prevProjectKey !== projectKey;
    
    prevProjectKeyRef.current = projectKey;
    projectKeyRef.current = projectKey;
    
    // Only reset state when project actually changes
    if (isProjectSwitch) {
      // Reset tree state
      setRootDocuments([]);
      setChildrenByParent({});
      childrenByParentRef.current = {};
      setExpandedIds({});
      setLoadingIds({});
      loadingIdsRef.current = {};
      rootLoadAttemptRef.current = null;  // Reset so tree will reload
      setRootLoading(false);
      initialRedirectRef.current = false;
      
      // Clear current document state
      setDocument(null);
      setError(null);
      setLoading(false);
      
      // Navigate to blank page when switching projects
      navigate("/documents", { replace: true });
    }
    // Tree loading is handled by the separate effect below
  }, [navigate, resolvedProjectKey]);

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

  // Load tree once when entering the page or switching projects
  useEffect(() => {
    const projectKey = resolvedProjectKey || null;
    if (!projectKey) {
      return;
    }
    // Only load if we haven't loaded for this project yet
    if (rootLoadAttemptRef.current !== projectKey) {
      void loadFullTreeRef.current(projectKey);
    }
    // Only depend on resolvedProjectKey - use ref for the function
  }, [resolvedProjectKey]);

  // Expand to the selected document (runs after tree is loaded)
  useEffect(() => {
    const projectKey = resolvedProjectKey || null;
    if (!projectKey || !resolvedDocumentId) {
      return;
    }
    // Wait until tree is loaded for this project
    if (rootLoadAttemptRef.current !== projectKey || rootLoading) {
      return;
    }
    // Use ref to access latest docParentMap without dependency
    const currentDocParentMap = docParentMap;
    if (currentDocParentMap.has(resolvedDocumentId)) {
      const ancestors = buildAncestorsFromMap(resolvedDocumentId, currentDocParentMap);
      if (ancestors.length > 0) {
        const expanded: Record<string, boolean> = {};
        ancestors.forEach((id) => {
          expanded[id] = true;
        });
        setExpandedIds((prev) => ({ ...prev, ...expanded }));
      }
      return;
    }
    // If document not in tree, fetch its hierarchy to expand ancestors
    const expandViaHierarchy = async () => {
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
        }
      } catch {
        // Ignore errors
      }
    };
    void expandViaHierarchy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedProjectKey, resolvedDocumentId, rootLoading]);

  const handleToggle = useCallback(
    (doc: KnowledgeBaseDocument) => {
      if (!doc.hasChild) {
        return;
      }
      // Just toggle expanded state - children are already loaded
      setExpandedIds((prev) => ({ ...prev, [doc.id]: !prev[doc.id] }));
    },
    [],
  );

  const handleRefresh = useCallback(() => {
    if (!resolvedProjectKey || rootLoading) {
      return;
    }
    // Force reload by resetting the attempt ref
    rootLoadAttemptRef.current = "";
    void loadFullTreeRef.current(resolvedProjectKey);
  }, [resolvedProjectKey, rootLoading]);

  // Stop polling for rebuild status
  const stopRebuildPolling = useCallback(() => {
    if (rebuildPollingRef.current) {
      window.clearInterval(rebuildPollingRef.current);
      rebuildPollingRef.current = null;
    }
  }, []);

  // Poll for rebuild status
  const pollRebuildStatus = useCallback(async (projectKey: string) => {
    try {
      const status = await getRebuildStatus(projectKey);
      
      if (status.status === "running" || status.status === "pending") {
        setRebuildProgress({
          total: status.total || 0,
          processed: status.processed || 0,
          status: status.status,
        });
      } else if (status.status === "completed") {
        stopRebuildPolling();
        setRebuildingIndex(false);
        setRebuildProgress(null);
        const message = status.failed && status.failed > 0
          ? `索引重建完成：成功 ${status.succeeded}，失败 ${status.failed}`
          : `索引重建完成：共处理 ${status.total} 个文档`;
        alert(message);
      } else if (status.status === "failed") {
        stopRebuildPolling();
        setRebuildingIndex(false);
        setRebuildProgress(null);
        alert(`索引重建失败：${status.error || "未知错误"}`);
      } else {
        // idle or unknown status
        stopRebuildPolling();
        setRebuildingIndex(false);
        setRebuildProgress(null);
      }
    } catch (err) {
      console.error("Poll rebuild status failed:", err);
    }
  }, [stopRebuildPolling]);

  const handleRebuildIndex = useCallback(async () => {
    if (!resolvedProjectKey || rebuildingIndex) {
      return;
    }
    setRebuildingIndex(true);
    setRebuildProgress({ total: 0, processed: 0, status: "pending" });
    
    try {
      const result = await rebuildProjectRag(resolvedProjectKey);
      
      if (result.status === "completed") {
        // Synchronous completion (no documents or already done)
        setRebuildingIndex(false);
        setRebuildProgress(null);
        const message = result.total === 0
          ? "没有文档需要索引"
          : `索引重建完成：共处理 ${result.total} 个文档`;
        alert(message);
        return;
      }

      // Start polling for progress
      setRebuildProgress({
        total: result.total || 0,
        processed: 0,
        status: result.status,
      });
      
      // Poll every 1 second
      rebuildPollingRef.current = window.setInterval(() => {
        void pollRebuildStatus(resolvedProjectKey);
      }, 1000);
      
    } catch (err) {
      console.error("Rebuild index failed:", err);
      setRebuildingIndex(false);
      setRebuildProgress(null);
      alert("索引重建失败，请稍后重试");
    }
  }, [resolvedProjectKey, rebuildingIndex, pollRebuildStatus]);

  // Cleanup polling on unmount or project change
  useEffect(() => {
    return () => {
      stopRebuildPolling();
    };
  }, [stopRebuildPolling]);

  const handleDocumentsChanged = useCallback(
    async (parentId: string) => {
      if (!resolvedProjectKey) {
        return;
      }
      // Reload the full tree when documents change
      await loadFullTree(resolvedProjectKey);
      // Keep the parent expanded
      const normalizedParent = parentId.trim();
      if (normalizedParent && !isRootDocumentId(normalizedParent)) {
        setExpandedIds((prev) => ({ ...prev, [normalizedParent]: true }));
      }
    },
    [loadFullTree, resolvedProjectKey],
  );

  const refreshParent = useCallback(
    async (parentId: string) => {
      if (!resolvedProjectKey) {
        return;
      }
      // Reload the full tree
      await loadFullTree(resolvedProjectKey);
      // Keep the parent expanded
      const normalized = parentId.trim();
      if (normalized && !isRootDocumentId(normalized)) {
        setExpandedIds((prev) => ({ ...prev, [normalized]: true }));
      }
    },
    [loadFullTree, resolvedProjectKey],
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

  const handleOpenOptimize = useCallback(() => {
    if (!activeDocument) {
      return;
    }
    setOptimizeModalOpen(true);
  }, [activeDocument]);

  const handleOptimizeApply = useCallback(
    async (optimizedContent: JSONContent) => {
      if (!resolvedProjectKey || !activeDocument) {
        return;
      }
      try {
        // Update the document with the optimized content
        const response = await apiFetch(
          `/api/projects/${encodeURIComponent(resolvedProjectKey)}/documents/${encodeURIComponent(activeDocument.id)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              meta: { title: activeDocument.title },
              body: { type: "tiptap", content: optimizedContent },
            }),
          },
        );
        if (!response.ok) {
          throw new Error("Failed to save optimized document");
        }
        // Refresh the document
        const payload = await response.json();
        const data = payload?.data ?? payload;
        const updatedContent = data?.body?.content ?? optimizedContent;
        setDocument((prev) =>
          prev
            ? { ...prev, content: updatedContent }
            : null,
        );
        // Trigger index rebuild for the updated document
        try {
          await rebuildDocumentRag(resolvedProjectKey, activeDocument.id);
        } catch {
          // Index rebuild failure is not critical
        }
      } catch (err) {
        console.error("Failed to apply optimization:", err);
        alert("保存优化后的文档失败");
      }
    },
    [resolvedProjectKey, activeDocument],
  );

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

  const handleDelete = useCallback(async () => {
    if (!resolvedProjectKey || !activeDocument) {
      return;
    }
    if (deleting) {
      return;
    }
    // Show confirmation dialog
    const hasChildren = activeDocument.docType === "dir";
    const confirmMessage = hasChildren
      ? `Are you sure you want to delete "${activeDocument.title}" and all its sub-documents? This action cannot be undone.`
      : `Are you sure you want to delete "${activeDocument.title}"? This action cannot be undone.`;
    if (!window.confirm(confirmMessage)) {
      return;
    }
    setDeleting(true);
    const parentId = activeDocument.parentId;
    try {
      const result = await deleteDocument(resolvedProjectKey, activeDocument.id, true);
      console.log("Document deleted:", result);
      // Clear caches for deleted documents
      for (const deletedId of result.deleted_ids) {
        const cacheKey = `${resolvedProjectKey}:${deletedId}`;
        documentCache.delete(cacheKey);
        documentPromiseCache.delete(cacheKey);
        documentHierarchyCache.delete(cacheKey);
        documentHierarchyPromiseCache.delete(cacheKey);
      }
      // Clear children cache and expanded state for deleted documents
      setChildrenByParent((prev) => {
        const next = { ...prev };
        for (const deletedId of result.deleted_ids) {
          delete next[deletedId];
        }
        childrenByParentRef.current = next;
        return next;
      });
      setExpandedIds((prev) => {
        const next = { ...prev };
        for (const deletedId of result.deleted_ids) {
          delete next[deletedId];
        }
        return next;
      });
      // Navigate to /documents (blank page)
      navigate("/documents");
      // Refresh the full document tree
      await loadFullTree(resolvedProjectKey);
      // Keep the parent expanded if it still has children
      if (parentId && parentId !== "root" && childrenByParentRef.current[parentId]?.length > 0) {
        setExpandedIds((prev) => ({ ...prev, [parentId]: true }));
      }
    } catch (err) {
      console.error("Delete failed:", err);
      alert(err instanceof Error ? err.message : "Failed to delete document");
    } finally {
      setDeleting(false);
    }
  }, [resolvedProjectKey, activeDocument, deleting, navigate, loadFullTree]);

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

  const handleOpenImportWithMode = (mode: "file" | "folder" | "url" | "git") => {
    if (!allowChildActions) {
      return;
    }
    setImportMode(mode);
    setSelectedFiles([]);
    setImportUrl("");
    setImportUrlTitle("");
    setGitRepoUrl("");
    setGitBranch("main");
    setGitSubdir("");
    setGitLogEntries([]);
    setUploading(false);
    setUploadTotal(0);
    setUploadCompleted(0);
    setImportStatus({ type: "idle" });
    setUploadSummary(null);
    setImportModalOpen(true);
  };

  const handleCloseImport = () => {
    setImportModalOpen(false);
    setSelectedFiles([]);
    setUploading(false);
    setUploadTotal(0);
    setUploadCompleted(0);
    setImportStatus({ type: "idle" });
    setUploadSummary(null);
    setImportUrl("");
    setImportUrlTitle("");
    setGitRepoUrl("");
    setGitBranch("main");
    setGitSubdir("");
    setGitLogEntries([]);
    // Reset file inputs
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
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
    // Reset input value so the same file can be selected again
    event.target.value = "";
  };

  const handleModeChange = (nextMode: "file" | "folder" | "url" | "git") => {
    setImportMode(nextMode);
    setSelectedFiles([]);
    setImportUrl("");
    setImportUrlTitle("");
    setGitRepoUrl("");
    setGitBranch("main");
    setGitSubdir("");
    setGitLogEntries([]);
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
    if (importMode === "url") {
      const urlValue = importUrl.trim();
      if (!urlValue) {
        setImportStatus({ type: "error", message: "请输入网址" });
        return;
      }
      if (!isValidHttpUrl(urlValue)) {
        setImportStatus({ type: "error", message: "请输入有效的 http(s) 网址" });
        return;
      }
      setUploading(true);
      setUploadTotal(1);
      setUploadCompleted(0);
      setImportStatus({ type: "idle" });
      setUploadSummary(null);
      try {
        const { html, url } = await fetchUrlHtmlWithFallback(
          resolvedProjectKey,
          urlValue,
          (projectKey, targetUrl) => fetchUrlHtml(projectKey, targetUrl),
        );
        if (!html) {
          throw new Error("Empty HTML response");
        }
        const parsedDoc = new DOMParser().parseFromString(html, "text/html");
        const article = new Readability(parsedDoc).parse();
        const extractedTitle = article?.title?.trim() ?? "";
        const content = article?.content ?? "";
        if (!content.trim()) {
          throw new Error("No readable content found");
        }
        const turndownService = new TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced",
        });
        const markdown = turndownService.turndown(content);
        const parsed = markdownToTiptapJson(markdown, { extensions: markdownExtensions });
        const finalTitle = importUrlTitle.trim() || extractedTitle || url;
        await createDocumentRecord(
          resolvedProjectKey,
          {
            title: finalTitle,
            parentId: activeDocument?.id ?? "",
            extra: {
              source_url: url,
              fetched_at: new Date().toISOString(),
            },
          },
          parsed,
        );
        setUploadCompleted(1);
        setUploadSummary({
          directories: 0,
          files: 1,
          skipped: 0,
          converted: 1,
          fallback: 0,
        });
        setImportStatus({ type: "success", message: "导入完成" });
        setImportModalOpen(false);
        setImportUrl("");
        setImportUrlTitle("");
        setSelectedFiles([]);
        await handleDocumentsChanged(activeDocument?.id ?? "");
      } catch (err) {
        console.log("import_url_error", err);
        const message = err instanceof Error && err.message ? err.message : "导入失败";
        setImportStatus({ type: "error", message });
      } finally {
        setUploading(false);
        setUploadTotal(0);
        setUploadCompleted(0);
      }
      return;
    }
    if (importMode === "git") {
      const repoUrl = gitRepoUrl.trim();
      const branchValue = gitBranch.trim();
      if (!repoUrl) {
        setImportStatus({ type: "error", message: "请输入仓库地址" });
        return;
      }
      if (!isValidHttpUrl(repoUrl)) {
        setImportStatus({ type: "error", message: "请输入有效的仓库地址" });
        return;
      }
      if (branchValue && !isValidGitBranch(branchValue)) {
        setImportStatus({ type: "error", message: "分支名包含无效字符" });
        return;
      }
      setUploading(true);
      setUploadTotal(1);
      setUploadCompleted(0);
      setImportStatus({ type: "idle" });
      setUploadSummary(null);
      // Build file type filters from selected presets
      const fileTypeFilters = uploadFilterPresets.has("all")
        ? ["all" as const]
        : Array.from(uploadFilterPresets) as ("all" | "images" | "office" | "text" | "markdown")[];

      setGitLogEntries([
        { id: crypto.randomUUID(), text: `Cloning ${repoUrl}` },
        {
          id: crypto.randomUUID(),
          text: branchValue ? `Using branch ${branchValue}` : "Using default branch",
        },
        {
          id: crypto.randomUUID(),
          text: gitSubdir.trim() ? `正在导入子目录 ${gitSubdir.trim()}` : "正在导入整个仓库",
        },
        {
          id: crypto.randomUUID(),
          text: smartImportEnabled ? `智能导入: ${Array.from(smartImportTypes).join(", ")}` : "智能导入: 关闭",
        },
      ]);
      try {
        const result = await importGit(resolvedProjectKey, {
          repo_url: repoUrl,
          branch: branchValue || undefined,
          subdir: gitSubdir.trim() || undefined,
          parent_id: activeDocument?.id ?? "root",
          smart_import: smartImportEnabled,
          smart_import_types: Array.from(smartImportTypes) as ("markdown" | "word" | "pdf")[],
          file_types: fileTypeFilters,
        });
        setUploadCompleted(1);
        setGitLogEntries((prev) => [
          ...prev,
          { id: crypto.randomUUID(), text: `Created folders ${result.directories}` },
          { id: crypto.randomUUID(), text: `Created documents ${result.files}` },
          {
            id: crypto.randomUUID(),
            text: result.converted ? `Smart converted ${result.converted}` : "No smart conversions",
          },
          {
            id: crypto.randomUUID(),
            text: result.fallback ? `Fallback uploads ${result.fallback}` : "No fallback uploads",
          },
          {
            id: crypto.randomUUID(),
            text: result.skipped ? `Skipped ${result.skipped}` : "No skipped files",
          },
        ]);
        setUploadSummary({
          directories: result.directories,
          files: result.files,
          skipped: result.skipped,
          converted: result.converted,
          fallback: result.fallback,
        });
        setImportStatus({ type: "success", message: "导入完成" });
        setImportModalOpen(false);
        setGitRepoUrl("");
        setGitBranch("main");
        setGitSubdir("");
        setGitLogEntries([]);
        await handleDocumentsChanged(activeDocument?.id ?? "");
      } catch (err) {
        console.log("import_git_error", err);
        const message = err instanceof Error && err.message ? err.message : "导入失败";
        setGitLogEntries((prev) => [
          ...prev,
          { id: crypto.randomUUID(), text: `Failed: ${message}` },
        ]);
        setImportStatus({ type: "error", message });
      } finally {
        setUploading(false);
        setUploadTotal(0);
        setUploadCompleted(0);
      }
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
      setImportStatus({ type: "error", message: "没有符合筛选条件的文件" });
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
        const canDocxImport =
          smartImportEnabled &&
          smartImportTypes.has("word") &&
          isDocxFile(entry.file);
        const canImageImport =
          smartImportEnabled &&
          smartImportTypes.has("image") &&
          isImageAsset(entry.file.type, entry.file.name);
        const canPdfImport =
          smartImportEnabled &&
          smartImportTypes.has("pdf") &&
          entry.file.type === "application/pdf";
        
        // PDF import: upload as file block
        if (canPdfImport) {
          try {
            const uploaded = await uploadSingleFile(resolvedProjectKey, entry.file);
            const fileBlock = buildAssetBlock(resolvedProjectKey, uploaded, docTitle, true);
            await createDocumentRecord(
              resolvedProjectKey,
              {
                title: docTitle,
                parentId,
              },
              fileBlock ? { type: "doc", content: [fileBlock] } : { type: "doc", content: [] },
            );
            converted += 1;
          } catch (err) {
            console.error("PDF import failed:", err);
            fallback += 1;
          }
          markCompleted();
          continue;
        }
        
        // Image smart import: upload as image block + OCR for text content
        if (canImageImport) {
          try {
            const uploaded = await uploadSingleFile(resolvedProjectKey, entry.file);
            const imageBlock = buildAssetBlock(resolvedProjectKey, uploaded, docTitle, false);
            
            // Try OCR to extract text content
            let contentItems: JSONContent[] = [];
            try {
              const ocrResult = await ocrApi.ocrFile(entry.file, { outputFormat: "tiptap" });
              contentItems = Array.isArray(ocrResult.content.content) ? ocrResult.content.content : [];
            } catch (ocrErr) {
              console.warn("OCR failed, using image only:", ocrErr);
            }
            
            await createDocumentRecord(
              resolvedProjectKey,
              {
                title: docTitle,
                parentId,
              },
              { type: "doc", content: [imageBlock, ...contentItems] },
            );
            converted += 1;
          } catch (err) {
            console.error("Image import failed:", err);
            fallback += 1;
          }
          markCompleted();
          continue;
        }
        if (canSmartImport || canDocxImport) {
          try {
            const markdown = canDocxImport
              ? (await convertDocument(resolvedProjectKey, entry.file, "docx", "md")).content
              : await entry.file.text();
            const parsed = markdownToTiptapJson(markdown, { extensions: markdownExtensions });
            const uploaded = await uploadSingleFile(resolvedProjectKey, entry.file);
            const fileBlock = buildAssetBlock(resolvedProjectKey, uploaded, docTitle, true);
            const contentItems = Array.isArray(parsed.content) ? parsed.content : [];
            const mergedContent: JSONContent = {
              ...parsed,
              type: "doc",
              content: [fileBlock, ...contentItems],
            };
            await createDocumentRecord(
              resolvedProjectKey,
              {
                title: docTitle,
                parentId,
              },
              mergedContent,
            );
            converted += 1;
          } catch (err) {
            const uploaded = await uploadSingleFile(resolvedProjectKey, entry.file);
            const fileBlock = buildAssetBlock(resolvedProjectKey, uploaded, docTitle, true);
            await createDocumentRecord(
              resolvedProjectKey,
              {
                title: docTitle,
                parentId,
              },
              fileBlock ? { type: "doc", content: [fileBlock] } : { type: "doc", content: [] },
            );
            fallback += 1;
          }
        } else {
          const uploaded = await uploadSingleFile(resolvedProjectKey, entry.file);
  const isText = await isLikelyTextFile(entry.file, {
    filename: uploaded.filename,
    mime: uploaded.mime,
  });
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
      setImportStatus({ type: "success", message: "上传完成" });
      setImportModalOpen(false);
      setSelectedFiles([]);
      await handleDocumentsChanged(baseParentId);
    } catch (err) {
      console.log("import_upload_error", err);
      setImportStatus({ type: "error", message: "上传失败" });
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
    // Show error only if not loading and we have an error
    if (error && !loading) {
      return <div className="doc-viewer-error">{error}</div>;
    }
    // Show loading only if we don't have any document to show yet
    if (loading && !activeDocument) {
      return <div className="doc-viewer-state">Loading document...</div>;
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
          rebuildingIndex={rebuildingIndex}
          rebuildProgress={rebuildProgress}
          onSelect={handleSelectDocument}
          onToggle={handleToggle}
          onMove={handleMove}
          onRefresh={handleRefresh}
          onRebuildIndex={handleRebuildIndex}
          onEmptyAreaClick={() => navigate("/documents")}
        />
      }
    >
      <>
        <DocumentHeader
          breadcrumbItems={breadcrumbItems}
          mode="view"
          allowChildActions={allowChildActions}
          allowEdit={Boolean(activeDocument)}
          allowDelete={Boolean(activeDocument)}
          allowRebuild={Boolean(activeDocument)}
          allowOptimize={Boolean(activeDocument)}
          rebuilding={rebuilding}
          deleting={deleting}
          onEdit={handleEdit}
          onSave={() => { }}
          onCancel={() => { }}
          onNew={handleOpenNew}
          onImport={() => handleOpenImportWithMode("file")}
          onDelete={handleDelete}
          onRebuild={handleRebuild}
          onExport={activeDocument ? handleExport : undefined}
          onOptimize={activeDocument ? handleOpenOptimize : undefined}
        />
        <div className="doc-viewer-page">{bodyContent()}</div>
        {importModalOpen ? (
          <div className="modal-overlay" role="presentation">
            <button
              className="modal-overlay-button"
              type="button"
              aria-label="Close import dialog"
              onClick={handleCloseImport}
            />
            <div
              className="modal-card"
              role="dialog"
              aria-modal="true"
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <div className="modal-header">
                <h2>导入文档</h2>
                <button className="modal-close" type="button" onClick={handleCloseImport}>
                  关闭
                </button>
              </div>
              <div className="modal-body">
                <div className="kb-import-tabs" role="tablist">
                  <button
                    className={`kb-import-tab${importMode === "file" ? " active" : ""}`}
                    type="button"
                    onClick={() => handleModeChange("file")}
                  >
                    文件
                  </button>
                  <button
                    className={`kb-import-tab${importMode === "folder" ? " active" : ""}`}
                    type="button"
                    onClick={() => handleModeChange("folder")}
                  >
                    文件夹
                  </button>
                  <button
                    className={`kb-import-tab${importMode === "url" ? " active" : ""}`}
                    type="button"
                    onClick={() => handleModeChange("url")}
                  >
                    网址
                  </button>
                  <button
                    className={`kb-import-tab${importMode === "git" ? " active" : ""}`}
                    type="button"
                    onClick={() => handleModeChange("git")}
                  >
                    Git 仓库
                  </button>
                </div>
                {importMode !== "url" ? (
                  <>
                    <fieldset className="kb-import-smart">
                      <div className="kb-import-smart-header">
                        <div className="kb-import-smart-title">智能导入</div>
                        <button
                          className={`kb-import-toggle${smartImportEnabled ? " active" : ""}`}
                          type="button"
                          aria-pressed={smartImportEnabled}
                          onClick={() => setSmartImportEnabled((prev) => !prev)}
                        >
                          {smartImportEnabled ? "开启" : "关闭"}
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
                    </fieldset>
                    <fieldset className="kb-import-smart" aria-label="Filter presets">
                      <div className="kb-import-smart-header">
                        <div className="kb-import-smart-title">文件类型筛选</div>
                      </div>
                      <div className="kb-import-smart-options">
                        {UPLOAD_FILTER_PRESETS.map((preset) => {
                          const active = isUploadFilterSelected(preset.id);
                          const chipClass = `kb-import-chip${active ? " active" : ""}`;
                          return (
                            <button
                              key={preset.id}
                              className={chipClass}
                              type="button"
                              aria-pressed={active}
                              onClick={() => toggleUploadFilterPreset(preset.id)}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  </>
                ) : null}
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
                    <div className="kb-import-title">选择要导入的文件</div>
                    <div className="kb-import-note">上传后将创建对应文档</div>
                    <button className="btn ghost" type="button" onClick={handleFilePick}>
                      选择文件
                    </button>
                    <div className="kb-import-selection">
                      {selectedFiles[0]?.name ?? "未选择文件"}
                    </div>
                  </div>
                ) : importMode === "folder" ? (
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
                    <div className="kb-import-title">选择要导入的文件夹</div>
                    <div className="kb-import-note">上传后将创建对应文档</div>
                    <button className="btn ghost" type="button" onClick={handleFolderPick}>
                      选择文件夹
                    </button>
                    <div className="kb-import-selection">
                      {selectedFiles.length > 0
                        ? `已选择 ${selectedFiles.length} 个文件`
                        : "未选择文件夹"}
                    </div>
                  </div>
                ) : importMode === "url" ? (
                  <div className="kb-import-panel">
                    <div className="kb-import-visual" aria-hidden="true">
                      <svg
                        className="kb-import-icon"
                        viewBox="0 0 48 48"
                        role="presentation"
                      >
                        <path
                          d="M24 6c6.627 0 12 5.373 12 12 0 4.418-2.39 8.277-5.94 10.354"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M24 6c-6.627 0-12 5.373-12 12 0 4.418 2.39 8.277 5.94 10.354"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <circle cx="24" cy="24" r="4" fill="currentColor" />
                      </svg>
                    </div>
                    <div className="kb-import-title">从网址导入</div>
                    <div className="kb-import-note">
                      粘贴网址，自动抓取并转换页面内容
                    </div>
                    <div className="kb-import-url-fields">
                      <input
                        className="kb-import-url-input"
                        type="url"
                        placeholder="https://example.com/article"
                        value={importUrl}
                        onChange={(event) => setImportUrl(event.target.value)}
                        disabled={uploading}
                      />
                      <input
                        className="kb-import-url-input"
                        type="text"
                        placeholder="标题（可选）"
                        value={importUrlTitle}
                        onChange={(event) => setImportUrlTitle(event.target.value)}
                        disabled={uploading}
                      />
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
                          d="M12 12h24v24H12z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M16 18h16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M16 24h16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M16 30h10"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                      </svg>
                    </div>
                    <div className="kb-import-title">从 Git 仓库导入</div>
                    <div className="kb-import-note">
                      克隆公开仓库，按目录结构创建文档
                    </div>
                    <div className="kb-import-url-fields">
                      <input
                        className="kb-import-url-input"
                        type="url"
                        placeholder="https://github.com/org/repo.git"
                        value={gitRepoUrl}
                        onChange={(event) => setGitRepoUrl(event.target.value)}
                        disabled={uploading}
                      />
                      <input
                        className="kb-import-url-input"
                        type="text"
                        placeholder="分支（默认: main）"
                        value={gitBranch}
                        onChange={(event) => setGitBranch(event.target.value)}
                        disabled={uploading}
                      />
                      <input
                        className="kb-import-url-input"
                        type="text"
                        placeholder="子目录（可选）"
                        value={gitSubdir}
                        onChange={(event) => setGitSubdir(event.target.value)}
                        disabled={uploading}
                      />
                    </div>
                    {gitLogEntries.length > 0 ? (
                      <div className="kb-import-git-log">
                        {gitLogEntries.map((entry) => (
                          <div key={entry.id} className="kb-import-git-log-line">
                            {entry.text}
                          </div>
                        ))}
                      </div>
                    ) : null}
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
                  取消
                </button>
                <button
                  className="btn primary"
                  type="button"
                  onClick={handleImportSubmit}
                  disabled={
                    uploading ||
                    (importMode === "url" && !importUrl.trim()) ||
                    (importMode === "git" && !gitRepoUrl.trim())
                  }
                >
                  {uploading ? <span className="kb-import-spinner" aria-hidden="true" /> : null}
                  {importMode === "url"
                    ? "导入网址"
                    : importMode === "git"
                      ? "导入仓库"
                      : importMode === "folder" && uploading
                        ? `上传中 ${uploadProgress}%`
                        : "上传"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {rebuildModalOpen ? (
          <div className="modal-overlay" role="presentation">
            <button
              className="modal-overlay-button"
              type="button"
              aria-label="Close rebuild dialog"
              onClick={() => setRebuildModalOpen(false)}
            />
            <div
              className="modal-card"
              role="dialog"
              aria-modal="true"
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
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
        <DocumentOptimizeModal
          isOpen={optimizeModalOpen}
          projectKey={resolvedProjectKey}
          docId={activeDocument?.id || ""}
          docTitle={activeDocument?.title || ""}
          onClose={() => setOptimizeModalOpen(false)}
          onApply={handleOptimizeApply}
        />
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
  const extra = metaInput.extra ?? {};
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
        ...extra,
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




function resolveParentId(parentId: string): string {
  const normalized = parentId.trim();
  return normalized || "root";
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
