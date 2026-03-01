import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import type { Extensions } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import { Image } from "@tiptap/extension-image";
import { StarterKit } from "@tiptap/starter-kit";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { Checkbox, Input, Tooltip, message } from "antd";

import DocumentHeader from "../components/DocumentHeader";
import type {
  DocumentEditorSaveStatus,
  DocumentSyncStatus,
} from "../components/DocumentHeader";
import DocumentTabBar from "../components/DocumentTabBar";
import DocumentWorkspace from "../components/DocumentWorkspace";
import KnowledgeBaseLayout, { useToggleTree } from "../components/KnowledgeBaseLayout";
import KnowledgeBaseSideNav, {
  type KnowledgeBaseDocument,
  type KnowledgeBaseMoveRequest,
} from "../components/KnowledgeBaseSideNav";
import DocumentOptimizeModal from "../components/DocumentOptimizeModal";
import {
  fetchDocument,
  isDocumentNotFoundError,
  fetchDocumentHierarchy,
  fetchDocumentTree,
  syncProjectDocuments,
  fetchFavoriteDocuments,
  fetchRecentEditedDocuments,
  favoriteDocument,
  unfavoriteDocument,
  fetchProposalDiff,
  applyProposal,
  moveDocument,
  createDocument,
  duplicateDocument,
  deleteDocument,
  exportDocumentDocx,
  fetchUrlHtml,
  importFileAsDocument,
  createImportGitTask,
  createImportFolderTask,
  type DocumentDetail,
  type DocumentTreeItem,
  type FavoriteDocumentItem,
  type RecentEditedDocumentItem,
} from "../api/documents";
import { fetchMessageCenter, type MessageItem } from "../api/message-center";
import { rebuildDocumentRag, rebuildProjectRag, getRebuildStatus } from "../api/projects";
import { uploadAsset } from "../api/assets";
import { apiFetch, encodeProjectRef } from "../config/api";
import { sanitizeFileName } from "../utils/fileName";
import { useProjectContext } from "../context/ProjectContext";
import {
  CodeBlockNode,
  ensureBlockIds,
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
import {
  DOCUMENT_TAB_MAX,
  activateTab,
  closeTab,
  createInitialSessionState,
  getLruTabId,
  hasTab,
  openTab,
  updateTabTitle,
  type TabSessionState,
} from "../features/document-tabs/session-model";
import {
  createSnapshotStore,
  removeSnapshot,
  upsertSnapshot,
  type SnapshotStore,
} from "../features/document-tabs/snapshot-store";
import type { WorkspaceBridge } from "../features/document-tabs/workspace-bridge";
import {
  EPHEMERAL_DRAFT_ID,
  EPHEMERAL_DRAFT_TITLE,
  countProjectDocuments,
  shouldEnterEphemeralDraftMode,
  shouldRedirectToEphemeralDraft,
} from "../features/document-page/ephemeral-draft-model";
import {
  mapHierarchyToBreadcrumb,
  normalizeDocumentDisplayTitle,
  updateTitleInTree,
} from "../features/document-page/title-sync";
import { insertDuplicateIntoTree } from "../features/document-page/duplicate-state";

type DocumentData = {
  id: string;
  title: string;
  docType: string;
  parentId: string;
  bodyFormat: "tiptap" | "markdown" | "unknown";
  content: JSONContent | null;
  hierarchy: Array<{ id: string; name: string }>;
};

type DocumentMetaInfo = {
  id: string;
  title: string;
  docType: string;
  parentId: string;
};

type FavoriteDocument = {
  docId: string;
  title: string;
  favoritedAt: string;
};

type RecentEditedDocument = {
  docId: string;
  title: string;
  editedAt: string;
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

type ExportFormat = "markdown" | "zeus" | "word";

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
    label: "Markdown 文档",
    extensions: ["md", "markdown"],
  },
];

const SMART_IMPORT_OPTIONS: SmartImportOption[] = [
  { id: "all", label: "全部", enabled: true },
  { id: "markdown", label: "Markdown 文档", enabled: true },
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
    label: "自定义",
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

function DocumentTreeToggleButton() {
  const { treeCollapsed, toggleTree } = useToggleTree();
  return (
    <Tooltip title={treeCollapsed ? "显示文档树" : "隐藏文档树"}>
      <button
        className="kb-sidebar-toolbar-btn doc-page-right-topbar-btn"
        type="button"
        onClick={toggleTree}
        aria-label={treeCollapsed ? "显示文档树" : "隐藏文档树"}
      >
        {treeCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
      </button>
    </Tooltip>
  );
}

function DocumentPage() {
  const { currentProject } = useProjectContext();
  const params = useParams<{ documentId?: string }>();
  const resolvedProjectKey = (currentProject?.projectRef ?? "").trim();
  const resolvedDocumentId = (params.documentId || "").trim();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const proposalId = (searchParams.get("proposal_id") || "").trim();
  const blockIdParam = (searchParams.get("block") || "").trim() || null;
  const showBreadcrumb = parseDisplayBoolean(searchParams.get("show_breadcrumb"), true);
  const showHeaderActions = parseDisplayBoolean(searchParams.get("show_header_actions"), true);
  const showDocumentTitle = parseDisplayBoolean(searchParams.get("show_title"), true);
  const refreshKey = (() => {
    const state = location.state as { refreshToken?: number | string } | null;
    if (!state?.refreshToken) {
      return "";
    }
    return String(state.refreshToken);
  })();

  const [document, setDocument] = useState<DocumentData | null>(null);
  const [ephemeralDraftDoc, setEphemeralDraftDoc] = useState<DocumentData | null>(null);
  const [documentsById, setDocumentsById] = useState<Record<string, DocumentData>>({});
  const [tabSessionState, setTabSessionState] = useState<TabSessionState>(() =>
    createInitialSessionState(),
  );
  const [snapshotStore, setSnapshotStore] = useState<SnapshotStore>(() =>
    createSnapshotStore(),
  );
  const [workspaceSaveStateByDoc, setWorkspaceSaveStateByDoc] = useState<
    Record<string, { status: DocumentEditorSaveStatus; error: string | null }>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatingChildDoc, setCreatingChildDoc] = useState(false);
  const [diffData, setDiffData] = useState<{ metaDiff: string; contentDiff: string } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [breadcrumbItems, setBreadcrumbItems] = useState<
    Array<{ label: string; to?: string }>
  >([]);
  const [rebuildModalOpen, setRebuildModalOpen] = useState(false);
  const [optimizeModalOpen, setOptimizeModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("markdown");
  const [exporting, setExporting] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<"file" | "folder" | "url" | "git">("file");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [importUrl, setImportUrl] = useState("");
  const [importUrlTitle, setImportUrlTitle] = useState("");
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [gitSubdir, setGitSubdir] = useState("");
  const [gitAutoImportSubmodules, setGitAutoImportSubmodules] = useState(false);
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
  const [formatOptimizeEnabled, setFormatOptimizeEnabled] = useState(false);
  const [syncStatus, setSyncStatus] = useState<DocumentSyncStatus>("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncLogModalOpen, setSyncLogModalOpen] = useState(false);
  const [syncLogs, setSyncLogs] = useState<MessageItem[]>([]);
  const [syncLogsLoading, setSyncLogsLoading] = useState(false);
  const [syncLogsError, setSyncLogsError] = useState<string | null>(null);
  const [editorSaveStatus, setEditorSaveStatus] = useState<DocumentEditorSaveStatus>("idle");
  const [editorSaveError, setEditorSaveError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const inFlightRef = useRef<Map<string, Promise<DocumentData>>>(new Map());
  const currentRequestRef = useRef<string | null>(null);
  const refreshKeyRef = useRef<string>("");
  const syncRequestIdRef = useRef(0);
  const tabSessionRef = useRef<TabSessionState>(createInitialSessionState());
  const snapshotStoreRef = useRef<SnapshotStore>(createSnapshotStore());
  const workspaceBridgeMapRef = useRef<Map<string, WorkspaceBridge>>(new Map());
  const workspaceRetryMapRef = useRef<Map<string, () => void>>(new Map());
  const workspaceFocusMapRef = useRef<Map<string, () => void>>(new Map());
  const previousActiveDocIdRef = useRef<string | null>(null);
  const materializingDraftRef = useRef(false);

  const [rootDocuments, setRootDocuments] = useState<KnowledgeBaseDocument[]>([]);
  const [childrenByParent, setChildrenByParent] = useState<
    Record<string, KnowledgeBaseDocument[]>
  >({});
  const [favorites, setFavorites] = useState<FavoriteDocument[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoritePendingIds, setFavoritePendingIds] = useState<Record<string, boolean>>({});
  const [recentEdits, setRecentEdits] = useState<RecentEditedDocument[]>([]);
  const [recentEditsLoading, setRecentEditsLoading] = useState(false);
  const childrenByParentRef = useRef<Record<string, KnowledgeBaseDocument[]>>({});
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});
  const [rootLoading, setRootLoading] = useState(false);
  const [outlineMode, setOutlineMode] = useState(false);

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
  const recentEditsRefreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    tabSessionRef.current = tabSessionState;
  }, [tabSessionState]);

  useEffect(() => {
    snapshotStoreRef.current = snapshotStore;
  }, [snapshotStore]);

  const applyTabSessionState = useCallback((nextState: TabSessionState) => {
    tabSessionRef.current = nextState;
    setTabSessionState(nextState);
  }, []);

  const applySnapshotStore = useCallback((nextStore: SnapshotStore) => {
    snapshotStoreRef.current = nextStore;
    setSnapshotStore(nextStore);
  }, []);

  const removeWorkspaceStateForDoc = useCallback((docId: string) => {
    const normalizedDocId = docId.trim();
    if (!normalizedDocId) {
      return;
    }
    workspaceBridgeMapRef.current.delete(normalizedDocId);
    workspaceRetryMapRef.current.delete(normalizedDocId);
    workspaceFocusMapRef.current.delete(normalizedDocId);
    setDocumentsById((prev) => {
      if (!(normalizedDocId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[normalizedDocId];
      return next;
    });
    setWorkspaceSaveStateByDoc((prev) => {
      if (!(normalizedDocId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[normalizedDocId];
      return next;
    });
    const nextSnapshotStore = removeSnapshot(snapshotStoreRef.current, normalizedDocId);
    applySnapshotStore(nextSnapshotStore);
  }, [applySnapshotStore]);

  const captureWorkspaceSnapshot = useCallback((docId: string) => {
    const normalizedDocId = docId.trim();
    if (!normalizedDocId) {
      return;
    }
    const bridge = workspaceBridgeMapRef.current.get(normalizedDocId);
    if (!bridge) {
      return;
    }
    const snapshot = bridge.captureSnapshot();
    const nextSnapshotStore = upsertSnapshot(
      snapshotStoreRef.current,
      normalizedDocId,
      snapshot,
    );
    applySnapshotStore(nextSnapshotStore);
  }, [applySnapshotStore]);

  const restoreWorkspaceSnapshot = useCallback((docId: string) => {
    const normalizedDocId = docId.trim();
    if (!normalizedDocId) {
      return;
    }
    const bridge = workspaceBridgeMapRef.current.get(normalizedDocId);
    const snapshot = snapshotStoreRef.current[normalizedDocId];
    if (!bridge || !snapshot) {
      return;
    }
    bridge.restoreSnapshot(snapshot);
  }, []);

  const flushWorkspaceBeforeClose = useCallback(
    async (docId: string): Promise<boolean> => {
      const normalizedDocId = docId.trim();
      if (!normalizedDocId) {
        return true;
      }
      const bridge = workspaceBridgeMapRef.current.get(normalizedDocId);
      if (!bridge) {
        return true;
      }
      try {
        await bridge.flush();
        return true;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "保存失败";
        message.error(`文档保存失败，无法关闭：${errorMessage}`);
        return false;
      }
    },
    [],
  );

  const resolveTabTitle = useCallback(
    (docId: string, fallback?: string): string => {
      const normalizedDocId = docId.trim();
      if (!normalizedDocId) {
        return fallback?.trim() || "无标题文档";
      }
      if (normalizedDocId === EPHEMERAL_DRAFT_ID) {
        return ephemeralDraftDoc?.title?.trim() || EPHEMERAL_DRAFT_TITLE;
      }
      const fromRoots = rootDocuments.find((item) => item.id === normalizedDocId)?.title?.trim();
      if (fromRoots) {
        return fromRoots;
      }
      const fromChildren = Object.values(childrenByParent)
        .flat()
        .find((item) => item.id === normalizedDocId)?.title?.trim();
      if (fromChildren) {
        return fromChildren;
      }
      const fromSession = documentsById[normalizedDocId]?.title?.trim();
      if (fromSession) {
        return fromSession;
      }
      const fromFavorites = favorites.find((item) => item.docId === normalizedDocId)?.title?.trim();
      if (fromFavorites) {
        return fromFavorites;
      }
      const fromRecent = recentEdits.find((item) => item.docId === normalizedDocId)?.title?.trim();
      if (fromRecent) {
        return fromRecent;
      }
      const fallbackTitle = fallback?.trim();
      return fallbackTitle || "无标题文档";
    },
    [childrenByParent, documentsById, ephemeralDraftDoc, favorites, recentEdits, rootDocuments],
  );

  const ensureTabOpenedForDoc = useCallback(
    async (docId: string, titleHint?: string): Promise<boolean> => {
      const normalizedDocId = docId.trim();
      if (!normalizedDocId) {
        return false;
      }
      const now = Date.now();
      let currentState = tabSessionRef.current;
      const title = resolveTabTitle(normalizedDocId, titleHint);

      if (hasTab(currentState, normalizedDocId)) {
        currentState = activateTab(
          updateTabTitle(currentState, { docId: normalizedDocId, title }),
          { docId: normalizedDocId, now },
        );
        applyTabSessionState(currentState);
        return true;
      }

      if (currentState.tabs.length >= DOCUMENT_TAB_MAX) {
        const victimId = getLruTabId(currentState);
        if (victimId) {
          const canCloseVictim = await flushWorkspaceBeforeClose(victimId);
          if (!canCloseVictim) {
            return false;
          }
          captureWorkspaceSnapshot(victimId);
          currentState = closeTab(currentState, { docId: victimId });
          applyTabSessionState(currentState);
          removeWorkspaceStateForDoc(victimId);
        }
      }

      const nextState = openTab(currentState, {
        docId: normalizedDocId,
        title,
        now,
        maxTabs: DOCUMENT_TAB_MAX,
      });
      applyTabSessionState(nextState);
      return true;
    },
    [
      applyTabSessionState,
      captureWorkspaceSnapshot,
      flushWorkspaceBeforeClose,
      removeWorkspaceStateForDoc,
      resolveTabTitle,
    ],
  );

  const syncTabTitleFromDocument = useCallback(
    (docId: string, title: string) => {
      const normalizedDocId = docId.trim();
      if (!normalizedDocId) {
        return;
      }
      const currentState = tabSessionRef.current;
      if (!hasTab(currentState, normalizedDocId)) {
        return;
      }
      const nextState = updateTabTitle(currentState, {
        docId: normalizedDocId,
        title: title.trim() || "无标题文档",
      });
      applyTabSessionState(nextState);
    },
    [applyTabSessionState],
  );

  const totalDocumentCount = useMemo(
    () =>
      countProjectDocuments({
        rootDocuments,
        childrenByParent,
      }),
    [childrenByParent, rootDocuments],
  );

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

  const allExpandableDocumentIds = useMemo(() => {
    const ids = new Set<string>();
    const markDocs = (docs: KnowledgeBaseDocument[]) => {
      docs.forEach((doc) => {
        if (doc.hasChild) {
          ids.add(doc.id);
        }
      });
    };

    markDocs(rootDocuments);
    Object.entries(childrenByParent).forEach(([parentId, children]) => {
      if (children.length > 0) {
        ids.add(parentId);
      }
      markDocs(children);
    });

    return Array.from(ids);
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

  const loadFavorites = useCallback(async (projectKey: string) => {
    setFavoritesLoading(true);
    try {
      const items = await fetchFavoriteDocuments(projectKey);
      if (projectKeyRef.current !== projectKey) {
        return;
      }
      setFavorites(mapFavoriteDocuments(items));
    } catch (err) {
      if (projectKeyRef.current !== projectKey) {
        return;
      }
      console.error("Load favorites failed:", err);
      setFavorites([]);
    } finally {
      if (projectKeyRef.current === projectKey) {
        setFavoritesLoading(false);
      }
    }
  }, []);

  const loadRecentEdits = useCallback(async (projectKey: string) => {
    setRecentEditsLoading(true);
    try {
      const items = await fetchRecentEditedDocuments(projectKey);
      if (projectKeyRef.current !== projectKey) {
        return;
      }
      setRecentEdits(mapRecentEditedDocuments(items));
    } catch (err) {
      if (projectKeyRef.current !== projectKey) {
        return;
      }
      console.error("Load recent edits failed:", err);
      setRecentEdits([]);
    } finally {
      if (projectKeyRef.current === projectKey) {
        setRecentEditsLoading(false);
      }
    }
  }, []);

  const touchRecentEditInState = useCallback((docId: string, title: string) => {
    const normalizedDocId = docId.trim();
    if (!normalizedDocId) {
      return;
    }

    setRecentEdits((prev) => {
      const existing = prev.find((item) => item.docId === normalizedDocId);
      const normalizedTitle = title.trim() || existing?.title || "Untitled";
      const next: RecentEditedDocument[] = [
        {
          docId: normalizedDocId,
          title: normalizedTitle,
          editedAt: new Date().toISOString(),
        },
        ...prev.filter((item) => item.docId !== normalizedDocId),
      ];
      return next.slice(0, 10);
    });
  }, []);

  const removeRecentEditsInState = useCallback((docIds: string[]) => {
    const normalizedIds = new Set(
      docIds
        .map((docId) => String(docId ?? "").trim())
        .filter(Boolean),
    );

    if (normalizedIds.size === 0) {
      return;
    }

    setRecentEdits((prev) => prev.filter((item) => !normalizedIds.has(item.docId)));
  }, []);

  const scheduleRecentEditsRefresh = useCallback(
    (projectKey: string, delayMs = 350) => {
      if (!projectKey) {
        return;
      }

      if (recentEditsRefreshTimerRef.current !== null) {
        window.clearTimeout(recentEditsRefreshTimerRef.current);
      }

      recentEditsRefreshTimerRef.current = window.setTimeout(() => {
        recentEditsRefreshTimerRef.current = null;
        if (projectKeyRef.current !== projectKey) {
          return;
        }
        void loadRecentEdits(projectKey);
      }, delayMs);
    },
    [loadRecentEdits],
  );

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
      setFavorites([]);
      setFavoritesLoading(false);
      setFavoritePendingIds({});
      setRecentEdits([]);
      setRecentEditsLoading(false);
      childrenByParentRef.current = {};
      setExpandedIds({});
      setLoadingIds({});
      loadingIdsRef.current = {};
      rootLoadAttemptRef.current = null;  // Reset so tree will reload
      setRootLoading(false);
      if (recentEditsRefreshTimerRef.current !== null) {
        window.clearTimeout(recentEditsRefreshTimerRef.current);
        recentEditsRefreshTimerRef.current = null;
      }
      
      // Clear current document state
      setDocument(null);
      setEphemeralDraftDoc(null);
      setDocumentsById({});
      setError(null);
      setLoading(false);
      const emptyTabState = createInitialSessionState();
      applyTabSessionState(emptyTabState);
      const emptySnapshotStore = createSnapshotStore();
      applySnapshotStore(emptySnapshotStore);
      workspaceBridgeMapRef.current.clear();
      workspaceRetryMapRef.current.clear();
      workspaceFocusMapRef.current.clear();
      setWorkspaceSaveStateByDoc({});
      previousActiveDocIdRef.current = null;
      syncRequestIdRef.current += 1;
      setSyncStatus("idle");
      setSyncError(null);
      setSyncLogModalOpen(false);
      setSyncLogs([]);
      setSyncLogsLoading(false);
      setSyncLogsError(null);
      materializingDraftRef.current = false;
      
      // Navigate to blank page when switching projects
      navigate("/documents", { replace: true });
    }
    // Tree loading is handled by the separate effect below
  }, [navigate, resolvedProjectKey]);

  // Auto-redirect to first document removed - main page will be displayed at /documents

  // Load tree once when entering the page or switching projects
  useEffect(() => {
    const projectKey = resolvedProjectKey || null;
    if (!projectKey) {
      setFavorites([]);
      setFavoritesLoading(false);
      setRecentEdits([]);
      setRecentEditsLoading(false);
      return;
    }
    void loadFavorites(projectKey);
    void loadRecentEdits(projectKey);
  }, [loadFavorites, loadRecentEdits, resolvedProjectKey]);

  const runProjectSync = useCallback(
    async (projectKey: string, options?: { silent?: boolean }) => {
      const requestId = syncRequestIdRef.current + 1;
      syncRequestIdRef.current = requestId;
      setSyncStatus("syncing");
      setSyncError(null);
      try {
        await syncProjectDocuments(projectKey);
        if (syncRequestIdRef.current !== requestId) {
          return;
        }
        setSyncStatus("synced");
        setSyncError(null);
        if (!options?.silent) {
          message.success("文档已同步");
        }
      } catch (err) {
        if (syncRequestIdRef.current !== requestId) {
          return;
        }
        setSyncStatus("failed");
        const syncErrorMessage = err instanceof Error ? err.message : "文档同步失败";
        setSyncError(syncErrorMessage);
        if (options?.silent) {
          console.warn("Failed to sync project documents:", err);
        } else {
          message.error(syncErrorMessage);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const projectKey = resolvedProjectKey || null;
    if (!projectKey) {
      setSyncStatus("idle");
      setSyncError(null);
      setSyncLogModalOpen(false);
      setSyncLogs([]);
      setSyncLogsError(null);
      setSyncLogsLoading(false);
      return;
    }
    void runProjectSync(projectKey, { silent: true });
  }, [resolvedProjectKey, runProjectSync]);

  const handleSyncNow = useCallback(() => {
    if (!resolvedProjectKey) {
      return;
    }
    void runProjectSync(resolvedProjectKey, { silent: false });
  }, [resolvedProjectKey, runProjectSync]);

  const loadRecentSyncLogs = useCallback(async () => {
    if (!resolvedProjectKey) {
      setSyncLogs([]);
      setSyncLogsError(null);
      setSyncLogsLoading(false);
      return;
    }
    setSyncLogsLoading(true);
    setSyncLogsError(null);
    try {
      const data = await fetchMessageCenter(resolvedProjectKey, {
        limit: 20,
        type: "document-sync",
      });
      const merged = [...data.active, ...data.history].sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt).getTime()
          - new Date(a.updatedAt || a.createdAt).getTime(),
      );
      setSyncLogs(merged.slice(0, 20));
    } catch (err) {
      setSyncLogs([]);
      setSyncLogsError(err instanceof Error ? err.message : "加载同步日志失败");
    } finally {
      setSyncLogsLoading(false);
    }
  }, [resolvedProjectKey]);

  const handleOpenSyncLogs = useCallback(() => {
    if (!resolvedProjectKey) {
      return;
    }
    setSyncLogModalOpen(true);
    void loadRecentSyncLogs();
  }, [loadRecentSyncLogs, resolvedProjectKey]);

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

  useEffect(() => {
    const projectKey = resolvedProjectKey || null;
    if (!projectKey) {
      return;
    }
    if (rootLoadAttemptRef.current !== projectKey || rootLoading) {
      return;
    }

    const emptyProject = shouldEnterEphemeralDraftMode(totalDocumentCount);
    if (!emptyProject) {
      if (ephemeralDraftDoc || resolvedDocumentId === EPHEMERAL_DRAFT_ID) {
        setEphemeralDraftDoc(null);
      }
      workspaceBridgeMapRef.current.delete(EPHEMERAL_DRAFT_ID);
      workspaceRetryMapRef.current.delete(EPHEMERAL_DRAFT_ID);
      workspaceFocusMapRef.current.delete(EPHEMERAL_DRAFT_ID);
      setDocument((prev) => (prev?.id === EPHEMERAL_DRAFT_ID ? null : prev));
      setDocumentsById((prev) => {
        if (!(EPHEMERAL_DRAFT_ID in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[EPHEMERAL_DRAFT_ID];
        return next;
      });
      setWorkspaceSaveStateByDoc((prev) => {
        if (!(EPHEMERAL_DRAFT_ID in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[EPHEMERAL_DRAFT_ID];
        return next;
      });
      const nextSnapshots = removeSnapshot(snapshotStoreRef.current, EPHEMERAL_DRAFT_ID);
      if (nextSnapshots !== snapshotStoreRef.current) {
        applySnapshotStore(nextSnapshots);
      }
      if (hasTab(tabSessionRef.current, EPHEMERAL_DRAFT_ID)) {
        const nextTabs = closeTab(tabSessionRef.current, { docId: EPHEMERAL_DRAFT_ID });
        applyTabSessionState(nextTabs);
      }
      if (resolvedDocumentId === EPHEMERAL_DRAFT_ID) {
        const fallbackDocId = tabSessionRef.current.activeDocId;
        if (fallbackDocId && fallbackDocId !== EPHEMERAL_DRAFT_ID) {
          navigate(`/documents/${encodeURIComponent(fallbackDocId)}`, { replace: true });
        } else {
          navigate("/documents", { replace: true });
        }
      }
      return;
    }

    const draftDoc = ephemeralDraftDoc ?? createEphemeralDraftDocument();
    if (!ephemeralDraftDoc) {
      setEphemeralDraftDoc(draftDoc);
    }
    setDocumentsById((prev) => {
      const current = prev[EPHEMERAL_DRAFT_ID];
      if (current && current.title === draftDoc.title) {
        return prev;
      }
      return {
        ...prev,
        [EPHEMERAL_DRAFT_ID]: current ?? draftDoc,
      };
    });
    if (!resolvedDocumentId || resolvedDocumentId === EPHEMERAL_DRAFT_ID) {
      setDocument(draftDoc);
    }

    void ensureTabOpenedForDoc(EPHEMERAL_DRAFT_ID, draftDoc.title);

    const shouldRedirect =
      shouldRedirectToEphemeralDraft({
        totalDocumentCount,
        routeDocId: resolvedDocumentId,
      }) || !resolvedDocumentId;
    if (shouldRedirect) {
      navigate(`/documents/${encodeURIComponent(EPHEMERAL_DRAFT_ID)}`, { replace: true });
    }
  }, [
    applySnapshotStore,
    applyTabSessionState,
    ensureTabOpenedForDoc,
    ephemeralDraftDoc,
    navigate,
    resolvedDocumentId,
    resolvedProjectKey,
    rootLoading,
    totalDocumentCount,
  ]);

  // Expand to the selected document (runs after tree is loaded)
  useEffect(() => {
    const projectKey = resolvedProjectKey || null;
    if (!projectKey || !resolvedDocumentId || resolvedDocumentId === EPHEMERAL_DRAFT_ID) {
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

  const handleExpandAllTree = useCallback(() => {
    if (rootLoading || allExpandableDocumentIds.length === 0) {
      return;
    }
    const expanded: Record<string, boolean> = {};
    allExpandableDocumentIds.forEach((id) => {
      expanded[id] = true;
    });
    setExpandedIds(expanded);
  }, [allExpandableDocumentIds, rootLoading]);

  const handleCollapseTreeToRoot = useCallback(() => {
    setExpandedIds({});
  }, []);

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

  // Cleanup polling and scheduled refresh on unmount or project change
  useEffect(() => {
    return () => {
      stopRebuildPolling();
      if (recentEditsRefreshTimerRef.current !== null) {
        window.clearTimeout(recentEditsRefreshTimerRef.current);
        recentEditsRefreshTimerRef.current = null;
      }
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
      scheduleRecentEditsRefresh(resolvedProjectKey, 0);
    },
    [loadFullTree, resolvedProjectKey, scheduleRecentEditsRefresh],
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

  const openDocumentById = useCallback(
    async (docId: string, titleHint?: string, options?: { replace?: boolean }) => {
      const normalizedDocId = docId.trim();
      if (!normalizedDocId) {
        return;
      }
      const canOpen = await ensureTabOpenedForDoc(normalizedDocId, titleHint);
      if (!canOpen) {
        return;
      }
      navigate(`/documents/${encodeURIComponent(normalizedDocId)}`, {
        replace: Boolean(options?.replace),
      });
    },
    [ensureTabOpenedForDoc, navigate],
  );

  const handleActivateTab = useCallback(
    (docId: string) => {
      void openDocumentById(docId);
    },
    [openDocumentById],
  );

  const handleCloseTab = useCallback(
    async (docId: string) => {
      const normalizedDocId = docId.trim();
      if (!normalizedDocId) {
        return;
      }
      const canClose = await flushWorkspaceBeforeClose(normalizedDocId);
      if (!canClose) {
        return;
      }
      captureWorkspaceSnapshot(normalizedDocId);
      const nextState = closeTab(tabSessionRef.current, { docId: normalizedDocId });
      applyTabSessionState(nextState);
      removeWorkspaceStateForDoc(normalizedDocId);

      if (resolvedDocumentId === normalizedDocId) {
        if (nextState.activeDocId) {
          navigate(`/documents/${encodeURIComponent(nextState.activeDocId)}`, { replace: true });
          window.requestAnimationFrame(() => {
            restoreWorkspaceSnapshot(nextState.activeDocId as string);
          });
        } else {
          navigate("/documents", { replace: true });
        }
      }
    },
    [
      applyTabSessionState,
      captureWorkspaceSnapshot,
      flushWorkspaceBeforeClose,
      navigate,
      removeWorkspaceStateForDoc,
      resolvedDocumentId,
      restoreWorkspaceSnapshot,
    ],
  );

  const handleSelectDocument = useCallback(
    (doc: KnowledgeBaseDocument) => {
      if (!doc.id) {
        return;
      }
      void openDocumentById(doc.id, doc.title);
    },
    [openDocumentById],
  );

  const activeDocument =
    (resolvedDocumentId ? documentsById[resolvedDocumentId] : null) ?? document;
  const isEphemeralActive = activeDocument?.id === EPHEMERAL_DRAFT_ID;

  const handleFavoriteMutation = useCallback(
    async (docId: string, action: "favorite" | "unfavorite") => {
      if (!resolvedProjectKey || !docId || favoritePendingIds[docId]) {
        return;
      }

      setFavoritePendingIds((prev) => ({ ...prev, [docId]: true }));

      try {
        const result = action === "favorite"
          ? await favoriteDocument(resolvedProjectKey, docId)
          : await unfavoriteDocument(resolvedProjectKey, docId);
        setFavorites(mapFavoriteDocuments(result));
      } catch (err) {
        console.error(`${action} document failed:`, err);
        alert(err instanceof Error ? err.message : "收藏操作失败");
      } finally {
        setFavoritePendingIds((prev) => {
          const next = { ...prev };
          delete next[docId];
          return next;
        });
      }
    },
    [favoritePendingIds, resolvedProjectKey],
  );

  const handleUnfavoriteDocument = useCallback(
    (docId: string) => {
      if (!docId) {
        return;
      }
      void handleFavoriteMutation(docId, "unfavorite");
    },
    [handleFavoriteMutation],
  );

  const allowChildActions =
    activeDocument && !isEphemeralActive ? activeDocument.docType !== "overview" : true;
  const hasProposal = Boolean(proposalId);

  useEffect(() => {
    const nextActiveId = resolvedDocumentId || null;
    const prevActiveId = previousActiveDocIdRef.current;
    if (prevActiveId && prevActiveId !== nextActiveId) {
      captureWorkspaceSnapshot(prevActiveId);
    }
    previousActiveDocIdRef.current = nextActiveId;
  }, [captureWorkspaceSnapshot, resolvedDocumentId]);

  useEffect(() => {
    if (!resolvedDocumentId) {
      return;
    }
    let cancelled = false;
    const syncRouteTab = async () => {
      const opened = await ensureTabOpenedForDoc(resolvedDocumentId);
      if (cancelled) {
        return;
      }
      if (!opened) {
        const fallbackDocId = tabSessionRef.current.activeDocId;
        if (fallbackDocId && fallbackDocId !== resolvedDocumentId) {
          navigate(`/documents/${encodeURIComponent(fallbackDocId)}`, { replace: true });
        } else {
          navigate("/documents", { replace: true });
        }
        return;
      }
      window.requestAnimationFrame(() => {
        restoreWorkspaceSnapshot(resolvedDocumentId);
      });
    };
    void syncRouteTab();
    return () => {
      cancelled = true;
    };
  }, [ensureTabOpenedForDoc, navigate, resolvedDocumentId, restoreWorkspaceSnapshot]);

  useEffect(() => {
    if (!resolvedProjectKey || !resolvedDocumentId) {
      setDocument(null);
      setLoading(false);
      setError(null);
      currentRequestRef.current = null;
      return;
    }
    if (resolvedDocumentId === EPHEMERAL_DRAFT_ID) {
      setDocument(ephemeralDraftDoc);
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
      setDocumentsById((prev) => ({
        ...prev,
        [cached.id]: cached,
      }));
      syncTabTitleFromDocument(cached.id, cached.title);
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
        const mapped = mapDocumentDetail(detail, resolvedDocumentId, {
          markdownExtensions,
        });
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
        setDocumentsById((prev) => ({
          ...prev,
          [mapped.id]: mapped,
        }));
        syncTabTitleFromDocument(mapped.id, mapped.title);
      })
      .catch((err) => {
        if (!isActive || currentRequestRef.current !== requestKey) {
          return;
        }
        if (isDocumentNotFoundError(err)) {
          const emptyProject = shouldEnterEphemeralDraftMode(totalDocumentCount);
          setError(null);
          setDocument(null);
          if (emptyProject) {
            navigate(`/documents/${encodeURIComponent(EPHEMERAL_DRAFT_ID)}`, { replace: true });
            return;
          }
          const fallbackDocId =
            tabSessionRef.current.tabs.find(
              (tab) => tab.docId !== resolvedDocumentId && tab.docId !== EPHEMERAL_DRAFT_ID,
            )?.docId
            ?? rootDocuments[0]?.id
            ?? null;
          if (fallbackDocId) {
            navigate(`/documents/${encodeURIComponent(fallbackDocId)}`, { replace: true });
          } else {
            navigate("/documents", { replace: true });
          }
          return;
        }
        setError((err as Error).message || "加载文档失败");
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
  }, [
    ephemeralDraftDoc,
    navigate,
    refreshKey,
    resolvedDocumentId,
    resolvedProjectKey,
    rootDocuments,
    syncTabTitleFromDocument,
    totalDocumentCount,
  ]);

  useEffect(() => {
    if (!resolvedProjectKey || !resolvedDocumentId || resolvedDocumentId === EPHEMERAL_DRAFT_ID) {
      return;
    }
    const applyHierarchy = (hierarchy: Array<{ id: string; name: string }>) => {
      setDocument((prev) => {
        if (!prev || prev.id !== resolvedDocumentId) {
          return prev;
        }
        const updated = { ...prev, hierarchy };
        documentCache.set(`${resolvedProjectKey}:${resolvedDocumentId}`, updated);
        setDocumentsById((prevDocs) => ({
          ...prevDocs,
          [resolvedDocumentId]: updated,
        }));
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
    if (
      !proposalId
      || !resolvedProjectKey
      || !resolvedDocumentId
      || resolvedDocumentId === EPHEMERAL_DRAFT_ID
    ) {
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
        setDiffError((err as Error).message || "加载差异失败");
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
    const hierarchy =
      activeDocument && activeDocument.id === resolvedDocumentId
        ? activeDocument.hierarchy
        : [];
    const currentTitle = resolveTabTitle(resolvedDocumentId, activeDocument?.title);
    const items = mapHierarchyToBreadcrumb(
      hierarchy,
      resolvedDocumentId,
      currentTitle,
    );
    setBreadcrumbItems(trimBreadcrumbItems(items));
  }, [activeDocument, resolveTabTitle, resolvedDocumentId]);

  useEffect(() => {
    if (!resolvedDocumentId) {
      setEditorSaveStatus("idle");
      setEditorSaveError(null);
      return;
    }
    if (resolvedDocumentId === EPHEMERAL_DRAFT_ID) {
      const draftState = workspaceSaveStateByDoc[EPHEMERAL_DRAFT_ID];
      setEditorSaveStatus(draftState?.status ?? "draft");
      setEditorSaveError(draftState?.error ?? null);
      return;
    }
    const saveState = workspaceSaveStateByDoc[resolvedDocumentId];
    setEditorSaveStatus(saveState?.status ?? "idle");
    setEditorSaveError(saveState?.error ?? null);
  }, [resolvedDocumentId, resolvedProjectKey, workspaceSaveStateByDoc]);

  useEffect(() => {
    if (activeDocument) {
      return;
    }
    setEditorSaveStatus("idle");
    setEditorSaveError(null);
  }, [activeDocument]);

  const handleWorkspaceSaveStateChange = useCallback(
    (docId: string, state: { status: DocumentEditorSaveStatus; error: string }) => {
      const normalizedDocId = docId.trim();
      if (!normalizedDocId) {
        return;
      }
      const nextError = state.error || null;
      setWorkspaceSaveStateByDoc((prev) => {
        const previous = prev[normalizedDocId];
        if (previous && previous.status === state.status && previous.error === nextError) {
          return prev;
        }
        return {
          ...prev,
          [normalizedDocId]: {
            status: state.status,
            error: nextError,
          },
        };
      });
      if (normalizedDocId === resolvedDocumentId) {
        setEditorSaveStatus((prev) => (prev === state.status ? prev : state.status));
        setEditorSaveError((prev) => (prev === nextError ? prev : nextError));
      }
    },
    [resolvedDocumentId],
  );

  const handleWorkspaceRetryBind = useCallback((docId: string, handler: (() => void) | null) => {
    const normalizedDocId = docId.trim();
    if (!normalizedDocId) {
      return;
    }
    if (handler) {
      workspaceRetryMapRef.current.set(normalizedDocId, handler);
    } else {
      workspaceRetryMapRef.current.delete(normalizedDocId);
    }
  }, []);

  const handleWorkspaceFocusBind = useCallback((docId: string, handler: (() => void) | null) => {
    const normalizedDocId = docId.trim();
    if (!normalizedDocId) {
      return;
    }
    if (handler) {
      workspaceFocusMapRef.current.set(normalizedDocId, handler);
    } else {
      workspaceFocusMapRef.current.delete(normalizedDocId);
    }
  }, []);

  const handleWorkspaceTitleChange = useCallback(
    (docId: string, nextTitle: string) => {
      const normalizedDocId = docId.trim();
      if (!normalizedDocId) {
        return;
      }
      const displayTitle = normalizeDocumentDisplayTitle(nextTitle);
      if (normalizedDocId === EPHEMERAL_DRAFT_ID) {
        setEphemeralDraftDoc((prev) =>
          prev
            ? {
                ...prev,
                title: displayTitle,
              }
            : prev,
        );
      }

      setDocument((prev) =>
        prev && prev.id === normalizedDocId
          ? {
              ...prev,
              title: displayTitle,
            }
          : prev,
      );
      setDocumentsById((prevDocs) => {
        const current =
          prevDocs[normalizedDocId]
          ?? (activeDocument && activeDocument.id === normalizedDocId ? activeDocument : null);
        if (!current) {
          return prevDocs;
        }
        if (current.title === displayTitle && prevDocs[normalizedDocId]) {
          return prevDocs;
        }
        return {
          ...prevDocs,
          [normalizedDocId]: {
            ...current,
            title: displayTitle,
          },
        };
      });

      setRootDocuments((prevRoot) => {
        const treeUpdate = updateTitleInTree(
          prevRoot,
          {},
          normalizedDocId,
          displayTitle,
        );
        return treeUpdate.rootDocuments;
      });
      setChildrenByParent((prevChildren) => {
        const treeUpdate = updateTitleInTree(
          [] as KnowledgeBaseDocument[],
          prevChildren,
          normalizedDocId,
          displayTitle,
        );
        childrenByParentRef.current = treeUpdate.childrenByParent;
        return treeUpdate.childrenByParent;
      });

      setBreadcrumbItems((prev) => {
        if (resolvedDocumentId !== normalizedDocId) {
          return prev;
        }
        if (prev.length === 0) {
          const hierarchy =
            activeDocument && activeDocument.id === normalizedDocId
              ? activeDocument.hierarchy
              : [];
          const items = mapHierarchyToBreadcrumb(hierarchy, normalizedDocId, displayTitle);
          return trimBreadcrumbItems(items);
        }
        const next = prev.slice();
        const lastIndex = next.length - 1;
        const current = next[lastIndex];
        if (current?.label === displayTitle) {
          return prev;
        }
        next[lastIndex] = {
          ...current,
          label: displayTitle,
        };
        return next;
      });

      syncTabTitleFromDocument(normalizedDocId, displayTitle);

      if (resolvedProjectKey) {
        const requestKey = `${resolvedProjectKey}:${normalizedDocId}`;
        const cached = documentCache.get(requestKey);
        if (cached && cached.title !== displayTitle) {
          documentCache.set(requestKey, {
            ...cached,
            title: displayTitle,
          });
        }
      }
    },
    [activeDocument, resolvedDocumentId, resolvedProjectKey, syncTabTitleFromDocument],
  );

  const handleWorkspaceBridgeBind = useCallback((docId: string, bridge: WorkspaceBridge | null) => {
    const normalizedDocId = docId.trim();
    if (!normalizedDocId) {
      return;
    }
    if (bridge) {
      workspaceBridgeMapRef.current.set(normalizedDocId, bridge);
      if (resolvedDocumentId === normalizedDocId) {
        window.requestAnimationFrame(() => {
          restoreWorkspaceSnapshot(normalizedDocId);
        });
      }
      return;
    }
    workspaceBridgeMapRef.current.delete(normalizedDocId);
  }, [resolvedDocumentId, restoreWorkspaceSnapshot]);

  const handleRetryEditorSave = useCallback(() => {
    const currentDocId = (resolvedDocumentId || "").trim();
    if (!currentDocId) {
      return;
    }
    workspaceRetryMapRef.current.get(currentDocId)?.();
  }, [resolvedDocumentId]);

  const handleMaterializeEphemeralDraft = useCallback(
    async (payload: { title: string; content: JSONContent }) => {
      if (!resolvedProjectKey) {
        throw new Error("项目未就绪，无法创建文档");
      }
      if (materializingDraftRef.current) {
        return;
      }
      materializingDraftRef.current = true;
      try {
        const normalizedTitle = normalizeDocumentDisplayTitle(payload.title);
        const data = await createDocument(
          resolvedProjectKey,
          {
            title: normalizedTitle,
            parent_id: "root",
            extra: {
              status: "draft",
              tags: [],
            },
          },
          {
            type: "tiptap",
            content: exportContentJson(payload.content, null),
          },
        );
        const mapped = mapDocumentDetail(data, "");
        const createdDocId = mapped.id.trim();
        if (!createdDocId) {
          throw new Error("创建文档失败：未返回文档 ID");
        }
        const createdTitle = normalizeDocumentDisplayTitle(mapped.title || normalizedTitle);
        const createdDocument: DocumentData = {
          ...mapped,
          id: createdDocId,
          title: createdTitle,
          parentId: mapped.parentId || "root",
          content: payload.content,
        };

        setEphemeralDraftDoc(null);
        setDocument((prev) => {
          if (!prev) {
            return prev;
          }
          if (prev.id === EPHEMERAL_DRAFT_ID || prev.id === createdDocId) {
            return createdDocument;
          }
          return prev;
        });
        setDocumentsById((prev) => {
          const next = { ...prev };
          delete next[EPHEMERAL_DRAFT_ID];
          next[createdDocId] = createdDocument;
          return next;
        });
        setWorkspaceSaveStateByDoc((prev) => {
          const draftState = prev[EPHEMERAL_DRAFT_ID];
          const next = { ...prev };
          delete next[EPHEMERAL_DRAFT_ID];
          if (draftState) {
            next[createdDocId] = draftState;
          }
          return next;
        });

        const draftSnapshot = snapshotStoreRef.current[EPHEMERAL_DRAFT_ID];
        let nextSnapshots = removeSnapshot(snapshotStoreRef.current, EPHEMERAL_DRAFT_ID);
        if (draftSnapshot) {
          nextSnapshots = upsertSnapshot(nextSnapshots, createdDocId, draftSnapshot);
        }
        applySnapshotStore(nextSnapshots);

        const now = Date.now();
        const currentState = tabSessionRef.current;
        const replaced = currentState.tabs.map((tab) =>
          tab.docId === EPHEMERAL_DRAFT_ID
            ? {
                ...tab,
                docId: createdDocId,
                title: createdTitle,
                lastAccessAt: now,
              }
            : tab,
        );
        const dedupedTabs = replaced.filter(
          (tab, index, list) => list.findIndex((item) => item.docId === tab.docId) === index,
        );
        const nextState = {
          tabs: dedupedTabs,
          activeDocId:
            currentState.activeDocId === EPHEMERAL_DRAFT_ID
              ? createdDocId
              : currentState.activeDocId,
        };
        applyTabSessionState(nextState);
        syncTabTitleFromDocument(createdDocId, createdTitle);

        const oldRequestKey = `${resolvedProjectKey}:${EPHEMERAL_DRAFT_ID}`;
        const newRequestKey = `${resolvedProjectKey}:${createdDocId}`;
        documentCache.delete(oldRequestKey);
        documentPromiseCache.delete(oldRequestKey);
        inFlightRef.current.delete(oldRequestKey);
        documentHierarchyCache.delete(oldRequestKey);
        documentHierarchyPromiseCache.delete(oldRequestKey);
        documentCache.set(newRequestKey, createdDocument);

        touchRecentEditInState(createdDocId, createdTitle);
        scheduleRecentEditsRefresh(resolvedProjectKey, 0);
        void loadFullTree(resolvedProjectKey);

        navigate(`/documents/${encodeURIComponent(createdDocId)}`, { replace: true });
      } finally {
        materializingDraftRef.current = false;
      }
    },
    [
      applySnapshotStore,
      applyTabSessionState,
      loadFullTree,
      navigate,
      resolvedProjectKey,
      scheduleRecentEditsRefresh,
      syncTabTitleFromDocument,
      touchRecentEditInState,
    ],
  );

  const handleWorkspaceSaved = useCallback(
    (docId: string, payload: { title: string; content: JSONContent }) => {
      const normalizedDocId = docId.trim();
      if (!normalizedDocId || !resolvedProjectKey || normalizedDocId === EPHEMERAL_DRAFT_ID) {
        return;
      }
      setDocument((prev) =>
        prev && prev.id === normalizedDocId
          ? {
              ...prev,
              title: payload.title,
              content: payload.content,
            }
          : prev,
      );
      setDocumentsById((prev) => {
        const previous = prev[normalizedDocId];
        if (!previous) {
          return prev;
        }
        return {
          ...prev,
          [normalizedDocId]: {
            ...previous,
            title: payload.title,
            content: payload.content,
          },
        };
      });
      syncTabTitleFromDocument(normalizedDocId, payload.title);

      const requestKey = `${resolvedProjectKey}:${normalizedDocId}`;
      const cached = documentCache.get(requestKey);
      if (cached) {
        documentCache.set(requestKey, {
          ...cached,
          title: payload.title,
          content: payload.content,
        });
      }
      const currentTitle = documentsById[normalizedDocId]?.title || payload.title;
      touchRecentEditInState(normalizedDocId, payload.title || currentTitle);
      scheduleRecentEditsRefresh(resolvedProjectKey);
    },
    [
      documentsById,
      resolvedProjectKey,
      scheduleRecentEditsRefresh,
      syncTabTitleFromDocument,
      touchRecentEditInState,
    ],
  );

  const handleDuplicate = useCallback(async () => {
    if (!resolvedProjectKey || !activeDocument) {
      return;
    }
    try {
      const data = await duplicateDocument(resolvedProjectKey, activeDocument.id);
      const mapped = mapDocumentDetail(data, "", { markdownExtensions });
      const duplicatedId = mapped.id.trim();
      if (!duplicatedId) {
        throw new Error("创建副本失败：未返回文档 ID");
      }

      const duplicatedTitle = normalizeDocumentDisplayTitle(mapped.title);
      const duplicatedParentId = String(mapped.parentId || activeDocument.parentId || "root").trim() || "root";
      const duplicatedDocument: DocumentData = {
        ...mapped,
        id: duplicatedId,
        title: duplicatedTitle,
        parentId: duplicatedParentId,
      };
      const duplicatedTreeNode: KnowledgeBaseDocument = {
        id: duplicatedId,
        title: duplicatedTitle,
        type: duplicatedDocument.docType || "document",
        parentId: isRootDocumentId(duplicatedParentId) ? "" : duplicatedParentId,
        kind: "file",
        hasChild: false,
        order: 0,
        storageObjectId: "",
      };

      setDocumentsById((prev) => ({
        ...prev,
        [duplicatedId]: duplicatedDocument,
      }));

      setRootDocuments((prevRoot) => {
        const treeUpdate = insertDuplicateIntoTree(
          prevRoot,
          childrenByParentRef.current,
          activeDocument.id,
          duplicatedTreeNode,
        );
        if (treeUpdate.childrenByParent !== childrenByParentRef.current) {
          childrenByParentRef.current = treeUpdate.childrenByParent;
          setChildrenByParent(treeUpdate.childrenByParent);
        }
        return treeUpdate.rootDocuments;
      });

      if (!isRootDocumentId(duplicatedParentId)) {
        setExpandedIds((prev) => ({
          ...prev,
          [duplicatedParentId]: true,
        }));
      }

      documentCache.set(`${resolvedProjectKey}:${duplicatedId}`, duplicatedDocument);
      syncTabTitleFromDocument(duplicatedId, duplicatedTitle);
      touchRecentEditInState(duplicatedId, duplicatedTitle);
      scheduleRecentEditsRefresh(resolvedProjectKey);
      message.success("已创建副本");
    } catch (err) {
      console.error("Duplicate failed:", err);
      message.error(err instanceof Error ? err.message : "创建副本失败");
    }
  }, [
    activeDocument,
    markdownExtensions,
    resolvedProjectKey,
    scheduleRecentEditsRefresh,
    syncTabTitleFromDocument,
    touchRecentEditInState,
  ]);

  const handleOpenExport = useCallback(() => {
    if (!activeDocument) {
      return;
    }
    setExportFormat("markdown");
    setExportModalOpen(true);
  }, [activeDocument]);

  const handleExportSubmit = useCallback(async () => {
    if (!activeDocument || exporting) {
      return;
    }

    const content = activeDocument.content ?? { type: "doc", content: [] };
    const safeTitle = sanitizeFileName(activeDocument.title || "document");

    try {
      setExporting(true);

      if (exportFormat === "word") {
        if (!resolvedProjectKey) {
          throw new Error("项目未就绪，无法导出 Word");
        }
        const blob = await exportDocumentDocx(resolvedProjectKey, activeDocument.id);
        const filename = `${safeTitle || "document"}.docx`;
        downloadBlobFile(blob, filename);
        setExportModalOpen(false);
        return;
      }

      if (exportFormat === "markdown") {
        const markdown = tiptapJsonToMarkdown(content);
        const filename = `${safeTitle || "document"}.md`;
        downloadTextFile(markdown, filename, "text/markdown;charset=utf-8");
      } else {
        const payload = exportContentJson(content, null);
        const filename = `${safeTitle || "document"}.zeus.json`;
        downloadTextFile(
          JSON.stringify(payload, null, 2),
          filename,
          "application/json;charset=utf-8",
        );
      }
      setExportModalOpen(false);
    } catch (err) {
      console.error("Failed to export document:", err);
      message.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }, [activeDocument, exportFormat, exporting, resolvedProjectKey]);

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
          `/api/projects/${encodeProjectRef(resolvedProjectKey)}/documents/${encodeURIComponent(activeDocument.id)}`,
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
          throw new Error("保存优化文档失败");
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
        setDocumentsById((prev) => {
          const current = prev[activeDocument.id];
          if (!current) {
            return prev;
          }
          return {
            ...prev,
            [activeDocument.id]: {
              ...current,
              content: updatedContent,
            },
          };
        });
        touchRecentEditInState(activeDocument.id, activeDocument.title);
        scheduleRecentEditsRefresh(resolvedProjectKey);
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
    [
      resolvedProjectKey,
      activeDocument,
      scheduleRecentEditsRefresh,
      touchRecentEditInState,
    ],
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
      const updated = mapDocumentDetail(data, resolvedDocumentId, {
        markdownExtensions,
      });
      setDocument(updated);
      setDocumentsById((prev) => ({
        ...prev,
        [updated.id]: updated,
      }));
      syncTabTitleFromDocument(updated.id, updated.title);
      touchRecentEditInState(updated.id, updated.title);
      scheduleRecentEditsRefresh(resolvedProjectKey);
      await handleDocumentsChanged(updated.parentId || "");
      clearProposalParam();
      setDiffData(null);
    } catch (err) {
      setDiffError((err as Error).message || "应用提案失败");
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
      setFavorites((prev) => {
        const removed = new Set(result.deleted_ids);
        return prev.filter((item) => !removed.has(item.docId));
      });
      removeRecentEditsInState(result.deleted_ids);
      void loadFavorites(resolvedProjectKey);
      scheduleRecentEditsRefresh(resolvedProjectKey, 0);
      setFavoritePendingIds((prev) => {
        const next = { ...prev };
        for (const deletedId of result.deleted_ids) {
          delete next[deletedId];
        }
        return next;
      });
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
      const deletedSet = new Set(result.deleted_ids.map((id) => String(id).trim()).filter(Boolean));
      setDocumentsById((prev) => {
        const next = { ...prev };
        deletedSet.forEach((docId) => {
          delete next[docId];
        });
        return next;
      });
      setWorkspaceSaveStateByDoc((prev) => {
        const next = { ...prev };
        deletedSet.forEach((docId) => {
          delete next[docId];
        });
        return next;
      });
      deletedSet.forEach((docId) => {
        workspaceBridgeMapRef.current.delete(docId);
        workspaceRetryMapRef.current.delete(docId);
        workspaceFocusMapRef.current.delete(docId);
      });

      let nextSnapshotStore = snapshotStoreRef.current;
      deletedSet.forEach((docId) => {
        nextSnapshotStore = removeSnapshot(nextSnapshotStore, docId);
      });
      applySnapshotStore(nextSnapshotStore);

      let nextTabState = tabSessionRef.current;
      deletedSet.forEach((docId) => {
        if (hasTab(nextTabState, docId)) {
          nextTabState = closeTab(nextTabState, { docId });
        }
      });
      applyTabSessionState(nextTabState);

      const currentDocDeleted = Boolean(resolvedDocumentId) && deletedSet.has(resolvedDocumentId);
      if (currentDocDeleted) {
        if (nextTabState.activeDocId) {
          navigate(`/documents/${encodeURIComponent(nextTabState.activeDocId)}`, { replace: true });
        } else {
          navigate("/documents", { replace: true });
        }
      }

      // Refresh the full document tree
      await loadFullTree(resolvedProjectKey);
      // Keep the parent expanded if it still has children
      if (parentId && parentId !== "root" && childrenByParentRef.current[parentId]?.length > 0) {
        setExpandedIds((prev) => ({ ...prev, [parentId]: true }));
      }
    } catch (err) {
      console.error("Delete failed:", err);
      alert(err instanceof Error ? err.message : "删除文档失败");
    } finally {
      setDeleting(false);
    }
  }, [
    resolvedProjectKey,
    activeDocument,
    applySnapshotStore,
    applyTabSessionState,
    deleting,
    navigate,
    resolvedDocumentId,
    loadFavorites,
    loadFullTree,
    removeRecentEditsInState,
    scheduleRecentEditsRefresh,
  ]);

  const handleOpenNew = useCallback(async () => {
    if (!allowChildActions || !resolvedProjectKey || creatingChildDoc) {
      return;
    }
    setCreatingChildDoc(true);
    try {
      const parentId =
        activeDocument && activeDocument.id !== EPHEMERAL_DRAFT_ID
          ? activeDocument.id
          : "root";
      const created = await createDocumentRecord(
        resolvedProjectKey,
        {
          title: "无标题文档",
          parentId,
        },
        { type: "doc", content: [] },
      );
      const createdDocId = String(created.id || "").trim();
      if (!createdDocId) {
        throw new Error("创建文档失败：未返回文档 ID");
      }
      await handleDocumentsChanged(parentId);
      await openDocumentById(createdDocId, created.title, { replace: false });
    } catch (err) {
      console.error("Create child document failed:", err);
      alert(err instanceof Error ? err.message : "创建文档失败");
    } finally {
      setCreatingChildDoc(false);
    }
  }, [
    activeDocument,
    allowChildActions,
    creatingChildDoc,
    handleDocumentsChanged,
    openDocumentById,
    resolvedProjectKey,
  ]);

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
    setGitAutoImportSubmodules(false);
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
    setGitAutoImportSubmodules(false);
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
    setGitAutoImportSubmodules(false);
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
          throw new Error("返回的 HTML 为空");
        }
        const parsedDoc = new DOMParser().parseFromString(html, "text/html");
        const article = new Readability(parsedDoc).parse();
        const extractedTitle = article?.title?.trim() ?? "";
        const content = article?.content ?? "";
        if (!content.trim()) {
          throw new Error("未找到可读取的内容");
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

      try {
        const { taskId } = await createImportGitTask(resolvedProjectKey, {
          repo_url: repoUrl,
          branch: branchValue || undefined,
          subdir: gitSubdir.trim() || undefined,
          parent_id: activeDocument?.id ?? "root",
          auto_import_submodules: gitAutoImportSubmodules,
          smart_import: smartImportEnabled,
          smart_import_types: Array.from(smartImportTypes).filter((t) => t !== "all") as Array<
            "markdown" | "word" | "pdf" | "image"
          >,
          file_types: fileTypeFilters,
          enable_format_optimize: smartImportEnabled && formatOptimizeEnabled,
        });
        if (!taskId) {
          throw new Error("任务创建失败");
        }
        setUploadCompleted(1);
        setImportStatus({ type: "success", message: "任务已创建，查看消息中心" });
        message.success("任务已创建，查看消息中心");
        setImportModalOpen(false);
        setGitRepoUrl("");
        setGitBranch("main");
        setGitSubdir("");
        setGitAutoImportSubmodules(false);
      } catch (err) {
        console.log("import_git_error", err);
        const errorMessage = err instanceof Error && err.message ? err.message : "导入失败";
        message.error(errorMessage);
        setImportStatus({ type: "error", message: errorMessage });
      } finally {
        setUploading(false);
        setUploadTotal(0);
        setUploadCompleted(0);
      }
      return;
    }
    if (importMode === "folder") {
      if (selectedFiles.length === 0) {
        setImportStatus({ type: "error", message: "请选择文件夹" });
        return;
      }
      const { files: filteredFiles } = filterFilesByPreset(
        selectedFiles,
        activeUploadPreset,
      );
      if (filteredFiles.length === 0) {
        setImportStatus({ type: "error", message: "没有符合筛选条件的文件" });
        return;
      }
      setUploading(true);
      setUploadTotal(1);
      setUploadCompleted(0);
      setImportStatus({ type: "idle" });
      setUploadSummary(null);

      try {
        const selectedSmartImportTypes = Array.from(smartImportTypes).filter((t) => t !== "all") as Array<
          "markdown" | "word" | "pdf" | "image"
        >;
        const { taskId } = await createImportFolderTask(resolvedProjectKey, filteredFiles, {
          parent_id: activeDocument?.id ?? "root",
          smart_import: smartImportEnabled,
          smart_import_types: selectedSmartImportTypes,
          enable_format_optimize: smartImportEnabled && formatOptimizeEnabled,
        });
        if (!taskId) {
          throw new Error("任务创建失败");
        }
        setUploadCompleted(1);
        setImportStatus({ type: "success", message: "任务已创建，查看消息中心" });
        message.success("任务已创建，查看消息中心");
        setImportModalOpen(false);
        setSelectedFiles([]);
      } catch (err) {
        console.log("import_folder_error", err);
        const errorMessage = err instanceof Error && err.message ? err.message : "导入失败";
        message.error(errorMessage);
        setImportStatus({ type: "error", message: errorMessage });
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

      const selectedSmartImportTypes = Array.from(smartImportTypes).filter((t) => t !== "all") as Array<
        "markdown" | "word" | "pdf" | "image"
      >;

      for (const entry of files) {
        const docTitle = stripExtension(entry.name) || entry.name;
        const parentId = entry.parentPath
          ? directoryIds.get(entry.parentPath) ?? baseParentId
          : baseParentId;

        try {
          const imported = await importFileAsDocument(resolvedProjectKey, entry.file, {
            parent_id: parentId,
            title: docTitle,
            smart_import: smartImportEnabled,
            smart_import_types: selectedSmartImportTypes,
            enable_format_optimize: smartImportEnabled && formatOptimizeEnabled,
          });
          if (imported.mode === "smart") {
            converted += 1;
          } else {
            fallback += 1;
          }
        } catch (err) {
          console.error("Import failed:", err);
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

  const activeTabDocId = (resolvedDocumentId || tabSessionState.activeDocId || "").trim() || null;

  const tabItems = useMemo(
    () =>
      tabSessionState.tabs.map((tab) => {
        const doc = documentsById[tab.docId];
        const saveState = workspaceSaveStateByDoc[tab.docId];
        return {
          docId: tab.docId,
          title: doc?.title ?? tab.title,
          dirty: saveState?.status === "dirty" || saveState?.status === "error",
        };
      }),
    [documentsById, tabSessionState.tabs, workspaceSaveStateByDoc],
  );

  const renderWorkspaceStack = () => {
    if (tabSessionState.tabs.length === 0) {
      return null;
    }
    return (
      <div className="doc-page-workspace-stack">
        {tabSessionState.tabs.map((tab) => {
          const tabDocument =
            documentsById[tab.docId] ??
            (activeDocument && activeDocument.id === tab.docId ? activeDocument : null);
          const isActive = tab.docId === activeTabDocId;
          const isEphemeralTab = tabDocument?.id === EPHEMERAL_DRAFT_ID;
          return (
            <div
              key={`${resolvedProjectKey}:${tab.docId}`}
              className={`doc-page-workspace-pane${isActive ? " active" : ""}`}
              style={{ display: isActive ? "flex" : "none" }}
            >
              {tabDocument ? (
                <DocumentWorkspace
                  projectKey={resolvedProjectKey}
                  documentId={tabDocument.id}
                  title={tabDocument.title}
                  content={tabDocument.content}
                  blockId={isActive ? blockIdParam : null}
                  showTitle={showDocumentTitle}
                  persistMode={isEphemeralTab ? "ephemeral" : "persisted"}
                  onFirstMeaningfulChange={
                    isEphemeralTab ? handleMaterializeEphemeralDraft : undefined
                  }
                  onSaved={(payload) => handleWorkspaceSaved(tabDocument.id, payload)}
                  onSaveStateChange={(state) =>
                    handleWorkspaceSaveStateChange(tabDocument.id, {
                      status: state.status as DocumentEditorSaveStatus,
                      error: state.error,
                    })
                  }
                  onTitleChange={(nextTitle) =>
                    handleWorkspaceTitleChange(tabDocument.id, nextTitle)
                  }
                  onRetryBind={(handler) => handleWorkspaceRetryBind(tabDocument.id, handler)}
                  onFocusBind={(handler) => handleWorkspaceFocusBind(tabDocument.id, handler)}
                  onBridgeBind={(bridge) => handleWorkspaceBridgeBind(tabDocument.id, bridge)}
                />
              ) : (
                <div className="doc-viewer-state">加载文档中...</div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

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
      return <div className="doc-viewer-state">加载文档中...</div>;
    }
    if (!activeDocument) {
      return <div className="doc-viewer-state">No document available</div>;
    }
    return (
      <div className="doc-page-body">
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
                  {applyLoading ? "应用中..." : "应用"}
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
              <div className="doc-diff-state">加载差异中...</div>
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
        {renderWorkspaceStack()}
      </div>
    );
  };

  return (
    <KnowledgeBaseLayout
      contentClassName="content-inner--flat"
      sideNav={
        <KnowledgeBaseSideNav
          documents={rootDocuments}
          childrenByParent={childrenByParent}
          favorites={favorites}
          favoritesLoading={favoritesLoading}
          favoritePendingIds={favoritePendingIds}
          recentEdits={recentEdits}
          recentEditsLoading={recentEditsLoading}
          expandedIds={expandedIds}
          activeId={resolvedDocumentId === EPHEMERAL_DRAFT_ID ? null : (resolvedDocumentId || null)}
          loadingIds={loadingIds}
          rootLoading={rootLoading}
          rebuildingIndex={rebuildingIndex}
          rebuildProgress={rebuildProgress}
          onSelect={handleSelectDocument}
          onToggle={handleToggle}
          onMove={handleMove}
          onRefresh={handleRefresh}
          onRebuildIndex={handleRebuildIndex}
          onExpandAll={handleExpandAllTree}
          onCollapseToRoot={handleCollapseTreeToRoot}
          onUnfavorite={handleUnfavoriteDocument}
          onEmptyAreaClick={() => navigate("/documents")}
          onAddDocument={() => {
            void handleOpenNew();
          }}
          outlineMode={outlineMode}
          onToggleOutline={() => setOutlineMode((v) => !v)}
          documentContent={activeDocument?.content ?? null}
        />
      }
    >
      <>
        <div className="doc-page-right-head">
          <div className="doc-page-right-topbar">
            <div className="doc-page-right-topbar-actions">
              <DocumentTreeToggleButton />
            </div>
            <DocumentTabBar
              tabs={tabItems}
              activeDocId={activeTabDocId}
              onActivate={handleActivateTab}
              onClose={(docId) => {
                void handleCloseTab(docId);
              }}
            />
          </div>
          {showBreadcrumb || showHeaderActions ? (
            <DocumentHeader
              breadcrumbItems={breadcrumbItems}
              mode="view"
              showBreadcrumb={showBreadcrumb}
              showActions={showHeaderActions}
              allowChildActions={allowChildActions}
              allowDelete={Boolean(activeDocument) && !isEphemeralActive}
              allowOptimize={Boolean(activeDocument) && !isEphemeralActive}
              deleting={deleting}
              onSave={() => { }}
              onCancel={() => { }}
              onNew={handleOpenNew}
              onImport={() => handleOpenImportWithMode("file")}
              onDelete={handleDelete}
              onDuplicate={activeDocument && !isEphemeralActive ? handleDuplicate : undefined}
              onExport={activeDocument && !isEphemeralActive ? handleOpenExport : undefined}
              onOptimize={activeDocument && !isEphemeralActive ? handleOpenOptimize : undefined}
              syncStatus={syncStatus}
              syncError={syncError}
              syncDisabled={!resolvedProjectKey || syncStatus === "syncing"}
              editorSaveStatus={editorSaveStatus}
              editorSaveError={editorSaveError}
              onRetryEditorSave={activeDocument ? handleRetryEditorSave : undefined}
              onSync={resolvedProjectKey ? handleSyncNow : undefined}
              onViewSyncLogs={resolvedProjectKey ? handleOpenSyncLogs : undefined}
            />
          ) : null}
        </div>
        <div className="doc-viewer-page">{bodyContent()}</div>
        {importModalOpen ? (
          <div className="modal-overlay" role="presentation">
            <button
              className="modal-overlay-button"
              type="button"
              aria-label="关闭导入对话框"
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
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <button
                            className={`kb-import-toggle${formatOptimizeEnabled && smartImportEnabled ? " active" : ""}`}
                            type="button"
                            aria-pressed={formatOptimizeEnabled && smartImportEnabled}
                            onClick={() => setFormatOptimizeEnabled((prev) => !prev)}
                            disabled={!smartImportEnabled}
                            title="使用 AI 优化导入文档的格式（标题层级、列表规范等），不修改内容"
                          >
                            格式优化
                          </button>
                          <button
                            className={`kb-import-toggle${smartImportEnabled ? " active" : ""}`}
                            type="button"
                            aria-pressed={smartImportEnabled}
                            onClick={() => setSmartImportEnabled((prev) => !prev)}
                          >
                            {smartImportEnabled ? "开启" : "关闭"}
                          </button>
                        </div>
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
                      <Input
                        className="kb-import-url-input"
                        type="url"
                        placeholder="https://example.com/article"
                        value={importUrl}
                        onChange={(event) => setImportUrl(event.target.value)}
                        disabled={uploading}
                      />
                      <Input
                        className="kb-import-url-input"
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
                      <Input
                        className="kb-import-url-input"
                        type="url"
                        placeholder="https://github.com/org/repo.git"
                        value={gitRepoUrl}
                        onChange={(event) => setGitRepoUrl(event.target.value)}
                        disabled={uploading}
                      />
                      <Input
                        className="kb-import-url-input"
                        placeholder="分支（默认: main）"
                        value={gitBranch}
                        onChange={(event) => setGitBranch(event.target.value)}
                        disabled={uploading}
                      />
                      <Input
                        className="kb-import-url-input"
                        placeholder="子目录（可选）"
                        value={gitSubdir}
                        onChange={(event) => setGitSubdir(event.target.value)}
                        disabled={uploading}
                      />
                      <div className="kb-import-git-options">
                        <Checkbox
                          checked={gitAutoImportSubmodules}
                          onChange={(event) => setGitAutoImportSubmodules(event.target.checked)}
                          disabled={uploading}
                        >
                          自动导入子模块
                        </Checkbox>
                      </div>
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
                  取消
                </button>
                <button
                  className={`btn primary${uploading ? " loading" : ""}`}
                  type="button"
                  onClick={handleImportSubmit}
                  disabled={
                    uploading ||
                    (importMode === "url" && !importUrl.trim()) ||
                    (importMode === "git" && !gitRepoUrl.trim())
                  }
                >
                  {uploading ? (
                    <>
                      <span className="kb-import-spinner" aria-hidden="true" />
                      {/* Only show progress for folder (multiple files) or git imports */}
                      {(importMode === "folder" || importMode === "git") && uploadTotal > 1
                        ? `${uploadProgress}%`
                        : null}
                    </>
                  ) : importMode === "url" ? (
                    "导入网址"
                  ) : importMode === "git" ? (
                    "导入仓库"
                  ) : (
                    "上传"
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {syncLogModalOpen ? (
          <div className="modal-overlay" role="presentation">
            <button
              className="modal-overlay-button"
              type="button"
              aria-label="关闭同步日志对话框"
              onClick={() => setSyncLogModalOpen(false)}
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
                <h2>最近同步日志</h2>
                <button
                  className="modal-close"
                  type="button"
                  onClick={() => setSyncLogModalOpen(false)}
                >
                  关闭
                </button>
              </div>
              <div className="modal-body">
                {syncLogsLoading ? (
                  <div className="doc-viewer-state">加载中...</div>
                ) : syncLogsError ? (
                  <div className="modal-error">{syncLogsError}</div>
                ) : syncLogs.length === 0 ? (
                  <div className="doc-viewer-state">暂无同步日志</div>
                ) : (
                  <div className="kb-sync-log-list">
                    {syncLogs.map((item) => {
                      const detail = item.detail && typeof item.detail === "object"
                        ? item.detail as Record<string, unknown>
                        : {};
                      const errorText = typeof detail.error === "string" ? detail.error.trim() : "";
                      const syncMode = typeof detail.syncMode === "string" ? detail.syncMode.trim() : "";
                      const trigger = typeof detail.trigger === "string" ? detail.trigger.trim() : "";
                      const event = typeof detail.event === "string" ? detail.event.trim() : "";
                      const docId = typeof detail.docId === "string" ? detail.docId.trim() : "";
                      const metaParts: string[] = [];
                      if (syncMode) {
                        metaParts.push(`模式：${formatSyncModeLabel(syncMode)}`);
                      }
                      if (trigger) {
                        metaParts.push(`触发：${formatSyncTriggerLabel(trigger)}`);
                      }
                      if (event) {
                        metaParts.push(`事件：${event}`);
                      }
                      if (docId) {
                        metaParts.push(`文档：${docId}`);
                      }

                      return (
                        <div key={item.id} className="kb-sync-log-item">
                          <div className="kb-sync-log-item-header">
                            <span className={`kb-sync-log-status status-${item.status}`}>
                              {formatMessageStatusLabel(item.status)}
                            </span>
                            <span className="kb-sync-log-time">
                              {formatSyncLogTime(item.updatedAt || item.createdAt)}
                            </span>
                          </div>
                          {errorText ? (
                            <div className="kb-sync-log-error">{errorText}</div>
                          ) : null}
                          {metaParts.length > 0 ? (
                            <div className="kb-sync-log-meta">{metaParts.join(" · ")}</div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => setSyncLogModalOpen(false)}
                >
                  关闭
                </button>
                <button
                  className={`btn primary${syncLogsLoading ? " loading" : ""}`}
                  type="button"
                  onClick={() => {
                    void loadRecentSyncLogs();
                  }}
                  disabled={syncLogsLoading}
                >
                  {syncLogsLoading ? "刷新中..." : "刷新"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {exportModalOpen ? (
          <div className="modal-overlay" role="presentation">
            <button
              className="modal-overlay-button"
              type="button"
              aria-label="关闭导出对话框"
              onClick={() => setExportModalOpen(false)}
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
                <h2>导出文档</h2>
                <button
                  className="modal-close"
                  type="button"
                  onClick={() => setExportModalOpen(false)}
                >
                  关闭
                </button>
              </div>
              <div className="modal-body">
                <div className="kb-export-options" role="radiogroup" aria-label="导出格式">
                  <label className="kb-export-option">
                    <input
                      type="radio"
                      name="export-format"
                      value="markdown"
                      checked={exportFormat === "markdown"}
                      onChange={() => setExportFormat("markdown")}
                    />
                    <span>Markdown (.md)</span>
                  </label>
                  <label className="kb-export-option">
                    <input
                      type="radio"
                      name="export-format"
                      value="zeus"
                      checked={exportFormat === "zeus"}
                      onChange={() => setExportFormat("zeus")}
                    />
                    <span>Zeus 原生文档 (.zeus.json)</span>
                  </label>
                  <label className="kb-export-option">
                    <input
                      type="radio"
                      name="export-format"
                      value="word"
                      checked={exportFormat === "word"}
                      onChange={() => setExportFormat("word")}
                    />
                    <span className="kb-export-option-content">
                      <span>Word (.docx)</span>
                      <small className="kb-export-option-hint">有损导出（部分格式会降级）</small>
                    </span>
                  </label>
                </div>
                {exportFormat === "word" ? (
                  <p className="kb-export-warning">
                    提示：Word 导出为有损导出，复杂样式、插件块和部分嵌套结构可能无法完全保留。
                  </p>
                ) : null}
              </div>
              <div className="modal-actions">
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => setExportModalOpen(false)}
                  disabled={exporting}
                >
                  取消
                </button>
                <button
                  className={`btn primary${exporting ? " loading" : ""}`}
                  type="button"
                  onClick={handleExportSubmit}
                  disabled={exporting}
                >
                  {exporting ? "导出中..." : "导出"}
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
              aria-label="关闭重建对话框"
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

function createEphemeralDraftDocument(): DocumentData {
  return {
    id: EPHEMERAL_DRAFT_ID,
    title: EPHEMERAL_DRAFT_TITLE,
    docType: "document",
    parentId: "root",
    bodyFormat: "tiptap",
    content: {
      type: "doc",
      content: [],
    },
    hierarchy: [],
  };
}

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

function mapDocumentDetail(
  data: DocumentDetail | undefined | null,
  fallbackId: string,
  options?: { markdownExtensions?: Extensions },
): DocumentData {
  const meta = mapDocumentMeta(data, fallbackId);
  const body = (data?.body ?? null) as { type?: unknown; content?: unknown } | null;
  let content: JSONContent | null = null;
  let bodyFormat: "tiptap" | "markdown" | "unknown" = "unknown";
  const markdownExtensions = options?.markdownExtensions;

  const parseMarkdown = (raw: unknown): JSONContent | null => {
    const markdown = extractMarkdownString(raw);
    if (markdown == null) {
      return null;
    }
    try {
      return ensureBlockIds(
        markdownToTiptapJson(
          markdown,
          markdownExtensions ? { extensions: markdownExtensions } : undefined,
        ),
      );
    } catch (err) {
      console.error("[DocumentPage] failed to parse markdown content:", err);
      return null;
    }
  };

  if (typeof body?.type === "string" && body.type === "markdown") {
    content = parseMarkdown(body.content);
    if (content) {
      bodyFormat = "markdown";
    }
  }

  if (!content) {
    content = extractDocJsonContent(body);
    if (content) {
      bodyFormat = "tiptap";
    }
  }

  // Backward-compatible fallback: markdown may be stored without explicit type.
  if (!content) {
    content = parseMarkdown(body?.content);
    if (content) {
      bodyFormat = "markdown";
    }
  }

  if (!content) {
    content = extractDocJsonContent(data?.content);
    if (content) {
      bodyFormat = "tiptap";
    }
  }

  if (!content) {
    content = parseMarkdown(data?.content);
    if (content) {
      bodyFormat = "markdown";
    }
  }

  if (content && bodyFormat === "unknown") {
    bodyFormat = "tiptap";
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
    bodyFormat,
    content,
    hierarchy,
  };
}

function extractDocJsonContent(raw: unknown, depth = 0): JSONContent | null {
  if (!raw || typeof raw !== "object" || depth > 4) {
    return null;
  }

  if (
    "type" in raw
    && (raw as { type?: string }).type === "doc"
    && "content" in raw
    && Array.isArray((raw as { content?: unknown }).content)
  ) {
    return raw as JSONContent;
  }

  if ("content" in raw) {
    const nested = (raw as { content?: unknown }).content;
    if (nested && typeof nested === "object") {
      const direct = extractDocJsonContent(nested, depth + 1);
      if (direct) {
        return direct;
      }
    }
  }

  return null;
}

function extractMarkdownString(raw: unknown): string | null {
  if (typeof raw === "string") {
    return raw;
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  if (typeof record.markdown === "string") {
    return record.markdown;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if (typeof record.text === "string") {
    return record.text;
  }

  return null;
}

function parseDisplayBoolean(value: string | null, defaultValue: boolean): boolean {
  if (value == null) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return defaultValue;
}

function isRootDocumentId(value: string): boolean {
  return value.trim().toLowerCase() === "root";
}

function mapFavoriteDocuments(items: FavoriteDocumentItem[]): FavoriteDocument[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      docId: String(item.doc_id ?? "").trim(),
      title: String(item.title ?? "").trim() || "Untitled",
      favoritedAt: String(item.favorited_at ?? "").trim(),
    }))
    .filter((item) => item.docId);
}

function mapRecentEditedDocuments(items: RecentEditedDocumentItem[]): RecentEditedDocument[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      docId: String(item.doc_id ?? "").trim(),
      title: String(item.title ?? "").trim() || "Untitled",
      editedAt: String(item.edited_at ?? "").trim(),
    }))
    .filter((item) => item.docId);
}

function formatMessageStatusLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "pending") {
    return "等待中";
  }
  if (normalized === "running") {
    return "进行中";
  }
  if (normalized === "completed") {
    return "已完成";
  }
  if (normalized === "failed") {
    return "失败";
  }
  return status || "未知";
}

function formatSyncModeLabel(syncMode: string): string {
  const normalized = syncMode.trim().toLowerCase();
  if (normalized === "remote_enabled") {
    return "远程优先";
  }
  if (normalized === "local_only") {
    return "本地优先";
  }
  return syncMode || "未知";
}

function formatSyncTriggerLabel(trigger: string): string {
  const normalized = trigger.trim().toLowerCase();
  if (normalized === "sync-on-open") {
    return "打开文档";
  }
  if (normalized === "record-version") {
    return "文档变更";
  }
  return trigger || "未知";
}

function formatSyncLogTime(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
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
  return `/api/projects/${encodeProjectRef(projectKey)}/assets/${encodeURIComponent(
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
  downloadBlobFile(blob, filename);
}

function downloadBlobFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
