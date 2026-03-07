import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import type { Extensions } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import { Image } from "@tiptap/extension-image";
import { StarterKit } from "@tiptap/starter-kit";
import {
	useLocation,
	useNavigate,
	useParams,
	useSearchParams,
} from "react-router-dom";
import {
	DeleteOutlined,
	MessageOutlined,
	MenuFoldOutlined,
	MenuUnfoldOutlined,
	RollbackOutlined,
	WarningOutlined,
} from "@ant-design/icons";
import { Checkbox, Input, Tooltip } from "antd";
import { useAppFeedback } from "../hooks/useAppFeedback";
import { i18n } from "../i18n/runtime";

import DocumentHeader from "../components/DocumentHeader";
import type {
	DocumentEditorSaveStatus,
	DocumentSyncStatus,
} from "../components/DocumentHeader";
import ChatPanel from "../components/ChatPanel";
import DocumentTabBar from "../components/DocumentTabBar";
import DocumentWorkspace from "../components/DocumentWorkspace";
import DocumentBlockCommentSidebar from "../components/DocumentBlockCommentSidebar";
import RichTextViewer from "../components/RichTextViewer";
import KnowledgeBaseLayout, {
	useToggleTree,
} from "../components/KnowledgeBaseLayout";
import KnowledgeBaseSideNav, {
	type KnowledgeBaseDocument,
	type KnowledgeBaseMoveRequest,
	type TrashSideNavNode,
} from "../components/KnowledgeBaseSideNav";
import DocumentOptimizeModal from "../components/DocumentOptimizeModal";
import {
	fetchDocument,
	isDocumentLockedError,
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
	updateDocumentContent,
	runDocumentCodeBlock,
	duplicateDocument,
	deleteDocument,
	lockDocument,
	unlockDocument,
	fetchDocumentTrash,
	fetchDocumentTrashSnapshot,
	exportDocumentDocx,
	fetchUrlHtml,
	importFileAsDocument,
	purgeDocumentTrash,
	restoreDocumentTrash,
	createImportGitTask,
	createImportFolderTask,
	fetchDocumentBlockCommentThreads,
	createDocumentBlockCommentThread,
	createDocumentBlockCommentMessage,
	updateDocumentBlockCommentThreadStatus,
	deleteDocumentBlockCommentMessage,
	type DocumentLockInfo,
	type CodeExecLanguage,
	type DocumentTrashItem,
	type DocumentDetail,
	type DocumentTreeItem,
	type FavoriteDocumentItem,
	type RecentEditedDocumentItem,
	type DocumentBlockCommentThread,
} from "../api/documents";
import { fetchMessageCenter, type MessageItem } from "../api/message-center";
import { getGeneralSettings } from "../api/general-settings";
import {
	rebuildDocumentRag,
	rebuildProjectRag,
	getRebuildStatus,
} from "../api/projects";
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
import { mapDocumentLockViewState } from "../features/document-page/lock-view-state";
import {
	createCodeExecState,
	reduceCodeExecState,
	type CodeExecState,
	type CodeExecStateEvent,
} from "../features/document-page/code-exec-state";
import {
	createBlockCommentState,
	reduceBlockCommentState,
} from "../features/document-page/block-comment-state";
import {
	buildBlockCommentCountByBlockId,
	type BlockCommentAnchorRect,
} from "../features/document-page/block-comment-floating";

type DocumentData = {
	id: string;
	title: string;
	docType: string;
	parentId: string;
	lock: DocumentLockInfo | null;
	bodyFormat: "tiptap" | "markdown" | "unknown";
	content: JSONContent | null;
	hierarchy: Array<{ id: string; name: string }>;
};

type DocumentMetaInfo = {
	id: string;
	title: string;
	docType: string;
	parentId: string;
	lock: DocumentLockInfo | null;
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

type TrashDocumentPreview = {
	key: string;
	trashId: string;
	docId: string;
	deletedAt: string;
	deletedBy: string;
	document: DocumentData;
};

const documentCache = new Map<string, DocumentData>();
const documentPromiseCache = new Map<string, Promise<DocumentData>>();
const documentHierarchyCache = new Map<
	string,
	Array<{ id: string; name: string }>
>();
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

function getUploadFilterPresetLabel(id: UploadFilterPresetId | "all" | "custom"): string {
	switch (id) {
		case "all":
			return i18n.t("document.upload.filter.all", { ns: "document", defaultValue: "全部" });
		case "images":
			return i18n.t("document.upload.filter.images", { ns: "document", defaultValue: "图片" });
		case "office":
			return i18n.t("document.upload.filter.office", { ns: "document", defaultValue: "办公文档" });
		case "text":
			return i18n.t("document.upload.filter.text", { ns: "document", defaultValue: "文本" });
		case "markdown":
			return i18n.t("document.upload.filter.markdown", { ns: "document", defaultValue: "Markdown 文档" });
		case "custom":
			return i18n.t("document.upload.filter.custom", { ns: "document", defaultValue: "自定义" });
	}
}

function getSmartImportOptionLabel(id: SmartImportType | "all"): string {
	switch (id) {
		case "all":
			return i18n.t("document.smartImport.all", { ns: "document", defaultValue: "全部" });
		case "markdown":
			return i18n.t("document.smartImport.markdown", { ns: "document", defaultValue: "Markdown 文档" });
		case "word":
			return i18n.t("document.smartImport.word", { ns: "document", defaultValue: "Word 文档" });
		case "pdf":
			return "PDF";
		case "image":
			return i18n.t("document.smartImport.image", { ns: "document", defaultValue: "图片" });
	}
}

type ExportFormat = "markdown" | "zeus" | "word";

const EMPTY_TIPTAP_DOC: JSONContent = {
	type: "doc",
	content: [],
};

const UPLOAD_FILTER_PRESETS: UploadFilterPreset[] = [
	{ id: "all", label: getUploadFilterPresetLabel("all"), extensions: [] },
	{
		id: "images",
		label: getUploadFilterPresetLabel("images"),
		extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
	},
	{
		id: "office",
		label: getUploadFilterPresetLabel("office"),
		extensions: ["docx", "pptx", "xlsx", "pdf"],
	},
	{
		id: "text",
		label: getUploadFilterPresetLabel("text"),
		extensions: ["txt", "csv", "json", "yaml", "yml", "log"],
	},
	{
		id: "markdown",
		label: getUploadFilterPresetLabel("markdown"),
		extensions: ["md", "markdown"],
	},
];

const SMART_IMPORT_OPTIONS: SmartImportOption[] = [
	{ id: "all", label: getSmartImportOptionLabel("all"), enabled: true },
	{ id: "markdown", label: getSmartImportOptionLabel("markdown"), enabled: true },
	{ id: "word", label: getSmartImportOptionLabel("word"), enabled: true },
	{ id: "pdf", label: "PDF", enabled: true },
	{ id: "image", label: getSmartImportOptionLabel("image"), enabled: true },
];

// All individual smart import types (excluding "all")
const ALL_SMART_IMPORT_TYPES: SmartImportType[] = [
	"markdown",
	"word",
	"pdf",
	"image",
];

// All individual upload filter presets (excluding "all")
const ALL_UPLOAD_FILTER_PRESETS: UploadFilterPresetId[] = [
	"images",
	"office",
	"text",
	"markdown",
];

const createDefaultUploadFilterSet = () =>
	new Set<UploadFilterPresetId>(ALL_UPLOAD_FILTER_PRESETS);

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
		label: getUploadFilterPresetLabel("custom"),
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

const CODE_EXEC_LANGUAGES = new Set<CodeExecLanguage>([
	"python",
	"javascript",
	"typescript",
	"bash",
]);

function normalizeCodeExecLanguage(language: string): CodeExecLanguage | null {
	const normalized = String(language ?? "")
		.trim()
		.toLowerCase();
	if (CODE_EXEC_LANGUAGES.has(normalized as CodeExecLanguage)) {
		return normalized as CodeExecLanguage;
	}
	return null;
}

function buildBlockCommentKey(docId: string, blockId: string): string {
	return `${String(docId ?? "").trim()}::${String(blockId ?? "").trim()}`;
}

function getUntitledDocumentTitle(): string {
	return i18n.t("document.title.untitled", { ns: "document", defaultValue: "无标题文档" });
}

function DocumentTreeToggleButton() {
	const { t } = useTranslation("document");
	const { treeCollapsed, toggleTree } = useToggleTree();
	return (
		<Tooltip title={treeCollapsed ? t("document.tree.show") : t("document.tree.hide")}>
			<button
				className="kb-sidebar-toolbar-btn doc-page-right-topbar-btn"
				type="button"
				onClick={toggleTree}
				aria-label={treeCollapsed ? t("document.tree.show") : t("document.tree.hide")}
			>
				{treeCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
			</button>
		</Tooltip>
	);
}

function DocumentPage() {
	const { t } = useTranslation("document");
	const { messageApi } = useAppFeedback();
	const { currentProject } = useProjectContext();
	const params = useParams<{ documentId?: string }>();
	const resolvedProjectKey = (currentProject?.projectRef ?? "").trim();
	const resolvedDocumentId = (params.documentId || "").trim();
	const navigate = useNavigate();
	const location = useLocation();
	const [searchParams, setSearchParams] = useSearchParams();
	const proposalId = (searchParams.get("proposal_id") || "").trim();
	const blockIdParam = (searchParams.get("block") || "").trim() || null;
	const showBreadcrumb = parseDisplayBoolean(
		searchParams.get("show_breadcrumb"),
		true,
	);
	const showHeaderActions = parseDisplayBoolean(
		searchParams.get("show_header_actions"),
		true,
	);
	const showDocumentTitle = parseDisplayBoolean(
		searchParams.get("show_title"),
		true,
	);
	const refreshKey = (() => {
		const state = location.state as { refreshToken?: number | string } | null;
		if (!state?.refreshToken) {
			return "";
		}
		return String(state.refreshToken);
	})();

	const [document, setDocument] = useState<DocumentData | null>(null);
	const [ephemeralDraftDoc, setEphemeralDraftDoc] =
		useState<DocumentData | null>(null);
	const [documentsById, setDocumentsById] = useState<
		Record<string, DocumentData>
	>({});
	const [tabSessionState, setTabSessionState] = useState<TabSessionState>(() =>
		createInitialSessionState(),
	);
	const [snapshotStore, setSnapshotStore] = useState<SnapshotStore>(() =>
		createSnapshotStore(),
	);
	const [workspaceSaveStateByDoc, setWorkspaceSaveStateByDoc] = useState<
		Record<string, { status: DocumentEditorSaveStatus; error: string | null }>
	>({});
	const [workspaceCodeExecStateByDoc, setWorkspaceCodeExecStateByDoc] =
		useState<Record<string, CodeExecState>>({});
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [rebuilding, setRebuilding] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [creatingChildDoc, setCreatingChildDoc] = useState(false);
	const [diffData, setDiffData] = useState<{
		metaDiff: string;
		contentDiff: string;
	} | null>(null);
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
	const [importMode, setImportMode] = useState<
		"file" | "folder" | "url" | "git"
	>("file");
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
	const [uploadFilterPresets, setUploadFilterPresets] = useState<
		Set<UploadFilterPresetId>
	>(() => createDefaultUploadFilterSet());
	const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(
		null,
	);
	const [smartImportEnabled, setSmartImportEnabled] = useState(true);
	const [smartImportTypes, setSmartImportTypes] = useState<
		Set<SmartImportType>
	>(() => new Set(ALL_SMART_IMPORT_TYPES));
	const [formatOptimizeEnabled, setFormatOptimizeEnabled] = useState(false);
	const [syncStatus, setSyncStatus] = useState<DocumentSyncStatus>("idle");
	const [syncError, setSyncError] = useState<string | null>(null);
	const [syncLogModalOpen, setSyncLogModalOpen] = useState(false);
	const [syncLogs, setSyncLogs] = useState<MessageItem[]>([]);
	const [syncLogsLoading, setSyncLogsLoading] = useState(false);
	const [syncLogsError, setSyncLogsError] = useState<string | null>(null);
	const [editorSaveStatus, setEditorSaveStatus] =
		useState<DocumentEditorSaveStatus>("idle");
	const [editorSaveError, setEditorSaveError] = useState<string | null>(null);
	const [lockBusy, setLockBusy] = useState(false);
	const [llmSidebarVisible, setLlmSidebarVisible] = useState(true);
	const [blockCommentState, setBlockCommentState] = useState(() =>
		createBlockCommentState(),
	);
	const [blockCommentThreadsByKey, setBlockCommentThreadsByKey] = useState<
		Record<string, DocumentBlockCommentThread[]>
	>({});
	const [blockCommentLoadingByKey, setBlockCommentLoadingByKey] = useState<
		Record<string, boolean>
	>({});
	const [blockCommentAnchorByDocId, setBlockCommentAnchorByDocId] = useState<
		Record<string, BlockCommentAnchorRect | null>
	>({});
	const [blockCommentBusy, setBlockCommentBusy] = useState(false);

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

	const [rootDocuments, setRootDocuments] = useState<KnowledgeBaseDocument[]>(
		[],
	);
	const [childrenByParent, setChildrenByParent] = useState<
		Record<string, KnowledgeBaseDocument[]>
	>({});
	const [favorites, setFavorites] = useState<FavoriteDocument[]>([]);
	const [favoritesLoading, setFavoritesLoading] = useState(false);
	const [favoritePendingIds, setFavoritePendingIds] = useState<
		Record<string, boolean>
	>({});
	const [recentEdits, setRecentEdits] = useState<RecentEditedDocument[]>([]);
	const [recentEditsLoading, setRecentEditsLoading] = useState(false);
	const childrenByParentRef = useRef<Record<string, KnowledgeBaseDocument[]>>(
		{},
	);
	const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
	const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});
	const [rootLoading, setRootLoading] = useState(false);
	const [outlineMode, setOutlineMode] = useState(false);
	const [trashPanelOpen, setTrashPanelOpen] = useState(false);
	const [trashLoading, setTrashLoading] = useState(false);
	const [trashEntries, setTrashEntries] = useState<DocumentTrashItem[]>([]);
	const [trashTreeNodes, setTrashTreeNodes] = useState<TrashSideNavNode[]>([]);
	const [trashPreviewByKey, setTrashPreviewByKey] = useState<
		Record<string, TrashDocumentPreview>
	>({});
	const [activeTrashNodeKey, setActiveTrashNodeKey] = useState<string | null>(
		null,
	);
	const [trashAutoCleanupEnabled, setTrashAutoCleanupEnabled] = useState(false);
	const [trashAutoCleanupDays, setTrashAutoCleanupDays] = useState(30);

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

	useEffect(() => {
		let cancelled = false;
		void getGeneralSettings()
			.then((settings) => {
				if (cancelled) {
					return;
				}
				setTrashAutoCleanupEnabled(Boolean(settings.trashAutoCleanupEnabled));
				setTrashAutoCleanupDays(
					normalizeTrashAutoCleanupDaysForBanner(settings.trashAutoCleanupDays),
				);
			})
			.catch(() => {
				// keep banner defaults when settings are unavailable
			});

		const handleSettingsUpdated = (event: Event) => {
			const detail = (event as CustomEvent).detail as
				| { trashAutoCleanupEnabled?: boolean; trashAutoCleanupDays?: number }
				| undefined;
			if (!detail) {
				return;
			}
			if (typeof detail.trashAutoCleanupEnabled === "boolean") {
				setTrashAutoCleanupEnabled(detail.trashAutoCleanupEnabled);
			}
			if (
				typeof detail.trashAutoCleanupDays === "number" &&
				Number.isFinite(detail.trashAutoCleanupDays)
			) {
				setTrashAutoCleanupDays(
					normalizeTrashAutoCleanupDaysForBanner(detail.trashAutoCleanupDays),
				);
			}
		};

		window.addEventListener(
			"zeus:general-settings-updated",
			handleSettingsUpdated,
		);
		return () => {
			cancelled = true;
			window.removeEventListener(
				"zeus:general-settings-updated",
				handleSettingsUpdated,
			);
		};
	}, []);

	const applyTabSessionState = useCallback((nextState: TabSessionState) => {
		if (nextState === tabSessionRef.current) {
			return;
		}
		tabSessionRef.current = nextState;
		setTabSessionState(nextState);
	}, []);

	const applySnapshotStore = useCallback((nextStore: SnapshotStore) => {
		snapshotStoreRef.current = nextStore;
		setSnapshotStore(nextStore);
	}, []);

	const updateWorkspaceCodeExecState = useCallback(
		(docId: string, event: CodeExecStateEvent) => {
			const normalizedDocId = docId.trim();
			if (!normalizedDocId) {
				return;
			}
			setWorkspaceCodeExecStateByDoc((prev) => {
				const current = prev[normalizedDocId] ?? createCodeExecState();
				const nextForDoc = reduceCodeExecState(current, event);
				if (nextForDoc === current) {
					return prev;
				}
				return {
					...prev,
					[normalizedDocId]: nextForDoc,
				};
			});
		},
		[],
	);

	const removeWorkspaceStateForDoc = useCallback(
		(docId: string) => {
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
			setWorkspaceCodeExecStateByDoc((prev) => {
				if (!(normalizedDocId in prev)) {
					return prev;
				}
				const next = { ...prev };
				delete next[normalizedDocId];
				return next;
			});
			const nextSnapshotStore = removeSnapshot(
				snapshotStoreRef.current,
				normalizedDocId,
			);
			applySnapshotStore(nextSnapshotStore);
		},
		[applySnapshotStore],
	);

	const captureWorkspaceSnapshot = useCallback(
		(docId: string) => {
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
		},
		[applySnapshotStore],
	);

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
				const errorMessage = err instanceof Error ? err.message : t("document.save.failed");
				messageApi.error(t("document.page.saveCloseFailed", { message: errorMessage }));
				return false;
			}
		},
		[],
	);

	const resolveTabTitle = useCallback(
		(docId: string, fallback?: string): string => {
			const normalizedDocId = docId.trim();
			if (!normalizedDocId) {
				return fallback?.trim() || getUntitledDocumentTitle();
			}
			if (normalizedDocId === EPHEMERAL_DRAFT_ID) {
				return ephemeralDraftDoc?.title?.trim() || EPHEMERAL_DRAFT_TITLE;
			}
			const fromRoots = rootDocuments
				.find((item) => item.id === normalizedDocId)
				?.title?.trim();
			if (fromRoots) {
				return fromRoots;
			}
			const fromChildren = Object.values(childrenByParent)
				.flat()
				.find((item) => item.id === normalizedDocId)
				?.title?.trim();
			if (fromChildren) {
				return fromChildren;
			}
			const fromSession = documentsById[normalizedDocId]?.title?.trim();
			if (fromSession) {
				return fromSession;
			}
			const fromFavorites = favorites
				.find((item) => item.docId === normalizedDocId)
				?.title?.trim();
			if (fromFavorites) {
				return fromFavorites;
			}
			const fromRecent = recentEdits
				.find((item) => item.docId === normalizedDocId)
				?.title?.trim();
			if (fromRecent) {
				return fromRecent;
			}
			const fallbackTitle = fallback?.trim();
			return fallbackTitle || getUntitledDocumentTitle();
		},
		[
			childrenByParent,
			documentsById,
			ephemeralDraftDoc,
			favorites,
			recentEdits,
			rootDocuments,
		],
	);

	const ensureTabOpenedForDoc = useCallback(
		async (docId: string, titleHint?: string): Promise<boolean> => {
			const normalizedDocId = docId.trim();
			if (!normalizedDocId) {
				return false;
			}
			const now = Date.now();
			let currentState = tabSessionRef.current;
			const title =
				resolveTabTitle(normalizedDocId, titleHint).trim() || getUntitledDocumentTitle();

			if (hasTab(currentState, normalizedDocId)) {
				const existingTab =
					currentState.tabs.find((tab) => tab.docId === normalizedDocId) ??
					null;
				const titleChanged = existingTab?.title !== title;
				const needActivate = currentState.activeDocId !== normalizedDocId;
				if (!titleChanged && !needActivate) {
					return true;
				}
				let nextState = currentState;
				if (titleChanged) {
					nextState = updateTabTitle(nextState, {
						docId: normalizedDocId,
						title,
					});
				}
				if (needActivate) {
					nextState = activateTab(nextState, { docId: normalizedDocId, now });
				}
				applyTabSessionState(nextState);
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
			const tab = currentState.tabs.find(
				(item) => item.docId === normalizedDocId,
			);
			if (!tab) {
				return;
			}
			const normalizedTitle = title.trim() || getUntitledDocumentTitle();
			if (tab.title === normalizedTitle) {
				return;
			}
			const nextState = updateTabTitle(currentState, {
				docId: normalizedDocId,
				title: normalizedTitle,
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
				return ALL_UPLOAD_FILTER_PRESETS.every((p) =>
					uploadFilterPresets.has(p),
				);
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
				title: item.title || getUntitledDocumentTitle(),
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
		(
			tree: DocumentTreeItem[],
			parentId: string = "",
		): {
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

	const loadTrash = useCallback(
		async (projectKey: string) => {
			setTrashLoading(true);
			try {
				const entries = await fetchDocumentTrash(projectKey);
				if (projectKeyRef.current !== projectKey) {
					return;
				}
				setTrashEntries(entries);

				if (entries.length === 0) {
					setTrashTreeNodes([]);
					setTrashPreviewByKey({});
					setActiveTrashNodeKey(null);
					return;
				}

				const snapshots = await Promise.all(
					entries.map(async (entry) => {
						try {
							const snapshot = await fetchDocumentTrashSnapshot(
								projectKey,
								entry.trashId,
							);
							return {
								entry,
								docs: snapshot.docs,
								rootDocId: snapshot.rootDocId || entry.rootDocId,
							};
						} catch {
							return {
								entry,
								docs: [] as DocumentDetail[],
								rootDocId: entry.rootDocId,
							};
						}
					}),
				);
				if (projectKeyRef.current !== projectKey) {
					return;
				}

				const nextTreeNodes: TrashSideNavNode[] = [];
				const nextPreviewByKey: Record<string, TrashDocumentPreview> = {};
				snapshots.forEach(({ entry, docs, rootDocId }) => {
					const built = buildTrashTreeFromSnapshot(entry, docs, rootDocId, {
						markdownExtensions,
					});
					nextTreeNodes.push(...built.nodes);
					Object.assign(nextPreviewByKey, built.previewByKey);
				});
				setTrashTreeNodes(nextTreeNodes);
				setTrashPreviewByKey(nextPreviewByKey);
				setActiveTrashNodeKey((prev) => {
					if (prev && nextPreviewByKey[prev]) {
						return prev;
					}
					return nextTreeNodes[0]?.key ?? null;
				});
			} catch (err) {
				if (projectKeyRef.current !== projectKey) {
					return;
				}
				console.error("Load trash failed:", err);
				setTrashEntries([]);
				setTrashTreeNodes([]);
				setTrashPreviewByKey({});
				setActiveTrashNodeKey(null);
				messageApi.error(err instanceof Error ? err.message : t("document.trash.loadFailed"));
			} finally {
				if (projectKeyRef.current === projectKey) {
					setTrashLoading(false);
				}
			}
		},
		[markdownExtensions],
	);

	const touchRecentEditInState = useCallback((docId: string, title: string) => {
		const normalizedDocId = docId.trim();
		if (!normalizedDocId) {
			return;
		}

		setRecentEdits((prev) => {
			const existing = prev.find((item) => item.docId === normalizedDocId);
			const normalizedTitle = title.trim() || existing?.title || getUntitledDocumentTitle();
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
			docIds.map((docId) => String(docId ?? "").trim()).filter(Boolean),
		);

		if (normalizedIds.size === 0) {
			return;
		}

		setRecentEdits((prev) =>
			prev.filter((item) => !normalizedIds.has(item.docId)),
		);
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

	const getDocumentHierarchy = useCallback(
		async (projectKey: string, documentId: string) => {
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
		},
		[],
	);

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
		const isProjectSwitch =
			prevProjectKey !== null && prevProjectKey !== projectKey;

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
			setTrashPanelOpen(false);
			setTrashEntries([]);
			setTrashLoading(false);
			setTrashTreeNodes([]);
			setTrashPreviewByKey({});
			setActiveTrashNodeKey(null);
			childrenByParentRef.current = {};
			setExpandedIds({});
			setLoadingIds({});
			loadingIdsRef.current = {};
			rootLoadAttemptRef.current = null; // Reset so tree will reload
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
			setWorkspaceCodeExecStateByDoc({});
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
		void loadTrash(projectKey);
	}, [loadFavorites, loadRecentEdits, loadTrash, resolvedProjectKey]);

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
					messageApi.success(t("document.sync.success"));
				}
			} catch (err) {
				if (syncRequestIdRef.current !== requestId) {
					return;
				}
				setSyncStatus("failed");
				const syncErrorMessage =
					err instanceof Error ? err.message : t("document.sync.failed");
				setSyncError(syncErrorMessage);
				if (options?.silent) {
					console.warn("Failed to sync project documents:", err);
				} else {
					messageApi.error(syncErrorMessage);
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
					new Date(b.updatedAt || b.createdAt).getTime() -
					new Date(a.updatedAt || a.createdAt).getTime(),
			);
			setSyncLogs(merged.slice(0, 20));
		} catch (err) {
			setSyncLogs([]);
			setSyncLogsError(err instanceof Error ? err.message : t("document.syncLogs.loadFailed"));
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
			setWorkspaceCodeExecStateByDoc((prev) => {
				if (!(EPHEMERAL_DRAFT_ID in prev)) {
					return prev;
				}
				const next = { ...prev };
				delete next[EPHEMERAL_DRAFT_ID];
				return next;
			});
			const nextSnapshots = removeSnapshot(
				snapshotStoreRef.current,
				EPHEMERAL_DRAFT_ID,
			);
			if (nextSnapshots !== snapshotStoreRef.current) {
				applySnapshotStore(nextSnapshots);
			}
			if (hasTab(tabSessionRef.current, EPHEMERAL_DRAFT_ID)) {
				const nextTabs = closeTab(tabSessionRef.current, {
					docId: EPHEMERAL_DRAFT_ID,
				});
				applyTabSessionState(nextTabs);
			}
			if (resolvedDocumentId === EPHEMERAL_DRAFT_ID) {
				const fallbackDocId = tabSessionRef.current.activeDocId;
				if (fallbackDocId && fallbackDocId !== EPHEMERAL_DRAFT_ID) {
					navigate(`/documents/${encodeURIComponent(fallbackDocId)}`, {
						replace: true,
					});
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
			navigate(`/documents/${encodeURIComponent(EPHEMERAL_DRAFT_ID)}`, {
				replace: true,
			});
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
		if (
			!projectKey ||
			!resolvedDocumentId ||
			resolvedDocumentId === EPHEMERAL_DRAFT_ID
		) {
			return;
		}
		// Wait until tree is loaded for this project
		if (rootLoadAttemptRef.current !== projectKey || rootLoading) {
			return;
		}
		// Use ref to access latest docParentMap without dependency
		const currentDocParentMap = docParentMap;
		if (currentDocParentMap.has(resolvedDocumentId)) {
			const ancestors = buildAncestorsFromMap(
				resolvedDocumentId,
				currentDocParentMap,
			);
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
				const hierarchyIds = await loadAncestorChain(
					projectKey,
					resolvedDocumentId,
				);
				const ancestors = hierarchyIds
					.slice(0, -1)
					.filter(
						(id) => id && id !== resolvedDocumentId && !isRootDocumentId(id),
					);
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

	const handleToggle = useCallback((doc: KnowledgeBaseDocument) => {
		if (!doc.hasChild) {
			return;
		}
		// Just toggle expanded state - children are already loaded
		setExpandedIds((prev) => ({ ...prev, [doc.id]: !prev[doc.id] }));
	}, []);

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
	const pollRebuildStatus = useCallback(
		async (projectKey: string) => {
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
					const message =
						status.failed && status.failed > 0
							? `索引重建完成：成功 ${status.succeeded}，失败 ${status.failed}`
							: `索引重建完成：共处理 ${status.total} 个文档`;
					alert(message);
				} else if (status.status === "failed") {
					stopRebuildPolling();
					setRebuildingIndex(false);
					setRebuildProgress(null);
					alert(t("document.index.failedWithError", { message: status.error || t("document.unknown") }));
				} else {
					// idle or unknown status
					stopRebuildPolling();
					setRebuildingIndex(false);
					setRebuildProgress(null);
				}
			} catch (err) {
				console.error("Poll rebuild status failed:", err);
			}
		},
		[stopRebuildPolling],
	);

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
				const message =
					result.total === 0
						? t("document.index.noneNeeded")
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
			alert(t("document.index.failedRetry"));
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

	const handleOpenTrash = useCallback(() => {
		if (!resolvedProjectKey) {
			return;
		}
		setTrashPanelOpen(true);
		setActiveTrashNodeKey((prev) => prev || trashTreeNodes[0]?.key || null);
		if (trashEntries.length === 0) {
			void loadTrash(resolvedProjectKey);
		}
	}, [loadTrash, resolvedProjectKey, trashEntries.length, trashTreeNodes]);

	const handleSelectTrashNode = useCallback((node: TrashSideNavNode) => {
		setTrashPanelOpen(true);
		setActiveTrashNodeKey(node.key);
	}, []);

	const handleRestoreTrash = useCallback(
		async (trashId: string) => {
			if (!resolvedProjectKey) {
				return;
			}
			try {
				const restored = await restoreDocumentTrash(
					resolvedProjectKey,
					trashId,
				);
				messageApi.success(
					restored.fallback_to_root ? t("document.trash.restoredRoot") : t("document.trash.restored"),
				);
				await Promise.all([
					loadTrash(resolvedProjectKey),
					loadFullTree(resolvedProjectKey),
				]);
			} catch (err) {
				messageApi.error(err instanceof Error ? err.message : t("document.trash.restoreFailed"));
			}
		},
		[loadFullTree, loadTrash, resolvedProjectKey],
	);

	const handlePurgeTrash = useCallback(
		async (trashId: string) => {
			if (!resolvedProjectKey) {
				return;
			}
			try {
				await purgeDocumentTrash(resolvedProjectKey, trashId);
				messageApi.success(t("document.trash.purged"));
				await loadTrash(resolvedProjectKey);
			} catch (err) {
				messageApi.error(err instanceof Error ? err.message : t("document.trash.purgeFailed"));
			}
		},
		[loadTrash, resolvedProjectKey],
	);

	const applyDocumentLockState = useCallback(
		(docId: string, lock: DocumentLockInfo | null) => {
			const normalizedDocId = docId.trim();
			if (!normalizedDocId) {
				return;
			}
			const nextLocked = Boolean(lock?.locked);
			setDocument((prev) =>
				prev && prev.id === normalizedDocId
					? {
							...prev,
							lock: lock ?? null,
						}
					: prev,
			);
			setDocumentsById((prevDocs) => {
				const current = prevDocs[normalizedDocId];
				if (!current) {
					return prevDocs;
				}
				if (Boolean(current.lock?.locked) === nextLocked) {
					return prevDocs;
				}
				return {
					...prevDocs,
					[normalizedDocId]: {
						...current,
						lock: lock ?? null,
					},
				};
			});

			const snapshot = snapshotStoreRef.current[normalizedDocId];
			if (snapshot && snapshot.locked !== nextLocked) {
				const nextSnapshots = upsertSnapshot(
					snapshotStoreRef.current,
					normalizedDocId,
					{
						...snapshot,
						locked: nextLocked,
					},
				);
				applySnapshotStore(nextSnapshots);
			}

			if (resolvedProjectKey) {
				const requestKey = `${resolvedProjectKey}:${normalizedDocId}`;
				const cached = documentCache.get(requestKey);
				if (cached) {
					documentCache.set(requestKey, {
						...cached,
						lock: lock ?? null,
					});
				}
			}
		},
		[applySnapshotStore, resolvedProjectKey],
	);

	const handleMove = useCallback(
		async (request: KnowledgeBaseMoveRequest) => {
			if (!resolvedProjectKey) {
				return;
			}
			try {
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
			} catch (err) {
				if (isDocumentLockedError(err)) {
					applyDocumentLockState(request.docId, {
						locked: true,
						lockedBy: "",
						lockedAt: new Date().toISOString(),
					});
					messageApi.warning(t("document.locked.move"));
					return;
				}
				throw err;
			}
		},
		[applyDocumentLockState, refreshParent, resolvedProjectKey],
	);

	const openDocumentById = useCallback(
		async (
			docId: string,
			titleHint?: string,
			options?: { replace?: boolean },
		) => {
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
			const nextState = closeTab(tabSessionRef.current, {
				docId: normalizedDocId,
			});
			applyTabSessionState(nextState);
			removeWorkspaceStateForDoc(normalizedDocId);

			if (resolvedDocumentId === normalizedDocId) {
				if (nextState.activeDocId) {
					navigate(`/documents/${encodeURIComponent(nextState.activeDocId)}`, {
						replace: true,
					});
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
			setTrashPanelOpen(false);
			void openDocumentById(doc.id, doc.title);
		},
		[openDocumentById],
	);

	const activeDocument =
		(resolvedDocumentId ? documentsById[resolvedDocumentId] : null) ?? document;
	const isEphemeralActive = activeDocument?.id === EPHEMERAL_DRAFT_ID;
	const activeLock = !isEphemeralActive ? (activeDocument?.lock ?? null) : null;
	const activeLockViewState = mapDocumentLockViewState(activeLock);
	const isActiveDocumentLocked = activeLockViewState.readonly;
	const activeTrashPreview = activeTrashNodeKey
		? (trashPreviewByKey[activeTrashNodeKey] ?? null)
		: null;
	const activeCommentPanel = useMemo(() => {
		const docId = String(activeDocument?.id ?? "").trim();
		if (!docId) {
			return { visible: false, blockId: null, threadId: null };
		}
		return (
			blockCommentState.panelByDocId[docId] ?? {
				visible: false,
				blockId: null,
				threadId: null,
			}
		);
	}, [activeDocument?.id, blockCommentState.panelByDocId]);
	const activeCommentBlockId =
		String(activeCommentPanel.blockId ?? "").trim() || null;
	const activeCommentKey = useMemo(() => {
		if (!activeDocument?.id || !activeCommentBlockId) {
			return "";
		}
		return buildBlockCommentKey(activeDocument.id, activeCommentBlockId);
	}, [activeCommentBlockId, activeDocument?.id]);
	const activeCommentThreads = activeCommentKey
		? (blockCommentThreadsByKey[activeCommentKey] ?? [])
		: [];
	const activeCommentAnchor = String(activeDocument?.id ?? "").trim()
		? (blockCommentAnchorByDocId[String(activeDocument?.id ?? "").trim()] ??
			null)
		: null;
	const activeCommentLoading = activeCommentKey
		? Boolean(blockCommentLoadingByKey[activeCommentKey])
		: false;
	const activeCommentVisible = Boolean(
		activeCommentPanel.visible &&
			activeDocument?.id &&
			activeCommentBlockId &&
			!trashPanelOpen &&
			!isEphemeralActive,
	);

	const loadBlockComments = useCallback(
		async (docId: string, blockId: string) => {
			const normalizedDocId = String(docId ?? "").trim();
			const normalizedBlockId = String(blockId ?? "").trim();
			if (!resolvedProjectKey || !normalizedDocId || !normalizedBlockId) {
				return;
			}
			const key = buildBlockCommentKey(normalizedDocId, normalizedBlockId);
			setBlockCommentLoadingByKey((prev) => ({ ...prev, [key]: true }));
			try {
				const result = await fetchDocumentBlockCommentThreads(
					resolvedProjectKey,
					normalizedDocId,
					{ blockId: normalizedBlockId, limit: 100 },
				);
				setBlockCommentThreadsByKey((prev) => ({
					...prev,
					[key]: result.items,
				}));
				setBlockCommentState((prev) =>
					reduceBlockCommentState(prev, {
						type: "replace-block-threads",
						docId: normalizedDocId,
						blockId: normalizedBlockId,
						threadIds: result.items.map((item) => item.id),
					}),
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : t("document.comments.loadFailed");
				messageApi.error(msg);
			} finally {
				setBlockCommentLoadingByKey((prev) => {
					const next = { ...prev };
					next[key] = false;
					return next;
				});
			}
		},
		[resolvedProjectKey],
	);

	const loadDocumentBlockCommentCounts = useCallback(
		async (docId: string) => {
			const normalizedDocId = String(docId ?? "").trim();
			if (!resolvedProjectKey || !normalizedDocId) {
				return;
			}
			try {
				const allThreads: DocumentBlockCommentThread[] = [];
				let cursor: string | undefined;
				for (let page = 0; page < 6; page += 1) {
					const result = await fetchDocumentBlockCommentThreads(
						resolvedProjectKey,
						normalizedDocId,
						{
							cursor,
							limit: 200,
						},
					);
					allThreads.push(...result.items);
					if (!result.nextCursor) {
						break;
					}
					cursor = result.nextCursor;
				}
				const counts = buildBlockCommentCountByBlockId(allThreads);
				setBlockCommentState((prev) =>
					reduceBlockCommentState(prev, {
						type: "hydrate-counts",
						docId: normalizedDocId,
						counts,
					}),
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : t("document.comments.countFailed");
				messageApi.error(msg);
			}
		},
		[resolvedProjectKey],
	);

	const handleWorkspaceOpenBlockComment = useCallback(
		(docId: string, blockId: string, anchor: BlockCommentAnchorRect | null) => {
			const normalizedDocId = String(docId ?? "").trim();
			const normalizedBlockId = String(blockId ?? "").trim();
			if (!normalizedDocId || !normalizedBlockId) {
				return;
			}
			setBlockCommentAnchorByDocId((prev) => ({
				...prev,
				[normalizedDocId]: anchor,
			}));
			setBlockCommentState((prev) =>
				reduceBlockCommentState(prev, {
					type: "open-panel",
					docId: normalizedDocId,
					blockId: normalizedBlockId,
				}),
			);
			void loadBlockComments(normalizedDocId, normalizedBlockId);
		},
		[loadBlockComments],
	);

	const handleCloseBlockCommentPanel = useCallback(() => {
		const docId = String(activeDocument?.id ?? "").trim();
		if (!docId) {
			return;
		}
		setBlockCommentAnchorByDocId((prev) => ({
			...prev,
			[docId]: null,
		}));
		setBlockCommentState((prev) =>
			reduceBlockCommentState(prev, {
				type: "close-panel",
				docId,
			}),
		);
	}, [activeDocument?.id]);

	const refreshActiveBlockComments = useCallback(async () => {
		const docId = String(activeDocument?.id ?? "").trim();
		const blockId = String(activeCommentBlockId ?? "").trim();
		if (!docId || !blockId) {
			return;
		}
		await loadBlockComments(docId, blockId);
	}, [activeCommentBlockId, activeDocument?.id, loadBlockComments]);

	const handleCreateBlockCommentThread = useCallback(
		async (content: string) => {
			const docId = String(activeDocument?.id ?? "").trim();
			const blockId = String(activeCommentBlockId ?? "").trim();
			if (!resolvedProjectKey || !docId || !blockId) {
				return;
			}
			setBlockCommentBusy(true);
			try {
				await createDocumentBlockCommentThread(resolvedProjectKey, docId, {
					blockId,
					content,
				});
				await loadBlockComments(docId, blockId);
			} catch (err) {
				const msg = err instanceof Error ? err.message : t("document.comments.threadCreateFailed");
				messageApi.error(msg);
			} finally {
				setBlockCommentBusy(false);
			}
		},
		[
			activeCommentBlockId,
			activeDocument?.id,
			loadBlockComments,
			resolvedProjectKey,
		],
	);

	const handleReplyBlockCommentThread = useCallback(
		async (threadId: string, content: string) => {
			const docId = String(activeDocument?.id ?? "").trim();
			const blockId = String(activeCommentBlockId ?? "").trim();
			if (!resolvedProjectKey || !docId || !blockId) {
				return;
			}
			setBlockCommentBusy(true);
			try {
				await createDocumentBlockCommentMessage(
					resolvedProjectKey,
					docId,
					threadId,
					{ content },
				);
				await loadBlockComments(docId, blockId);
			} catch (err) {
				const msg = err instanceof Error ? err.message : t("document.comments.replyFailed");
				messageApi.error(msg);
			} finally {
				setBlockCommentBusy(false);
			}
		},
		[
			activeCommentBlockId,
			activeDocument?.id,
			loadBlockComments,
			resolvedProjectKey,
		],
	);

	const handleToggleBlockCommentThreadStatus = useCallback(
		async (threadId: string, status: "open" | "resolved") => {
			const docId = String(activeDocument?.id ?? "").trim();
			const blockId = String(activeCommentBlockId ?? "").trim();
			if (!resolvedProjectKey || !docId || !blockId) {
				return;
			}
			setBlockCommentBusy(true);
			try {
				await updateDocumentBlockCommentThreadStatus(
					resolvedProjectKey,
					docId,
					threadId,
					status,
				);
				await loadBlockComments(docId, blockId);
			} catch (err) {
				const msg = err instanceof Error ? err.message : t("document.comments.statusFailed");
				messageApi.error(msg);
			} finally {
				setBlockCommentBusy(false);
			}
		},
		[
			activeCommentBlockId,
			activeDocument?.id,
			loadBlockComments,
			resolvedProjectKey,
		],
	);

	const handleDeleteBlockCommentMessage = useCallback(
		async (messageId: string) => {
			const docId = String(activeDocument?.id ?? "").trim();
			const blockId = String(activeCommentBlockId ?? "").trim();
			if (!resolvedProjectKey || !docId || !blockId) {
				return;
			}
			setBlockCommentBusy(true);
			try {
				await deleteDocumentBlockCommentMessage(
					resolvedProjectKey,
					docId,
					messageId,
				);
				await loadBlockComments(docId, blockId);
			} catch (err) {
				const msg = err instanceof Error ? err.message : t("document.comments.deleteFailed");
				messageApi.error(msg);
			} finally {
				setBlockCommentBusy(false);
			}
		},
		[
			activeCommentBlockId,
			activeDocument?.id,
			loadBlockComments,
			resolvedProjectKey,
		],
	);

	useEffect(() => {
		const docId = String(activeDocument?.id ?? "").trim();
		const blockId = String(activeCommentBlockId ?? "").trim();
		if (!docId || !blockId || !activeCommentVisible) {
			return;
		}
		const key = buildBlockCommentKey(docId, blockId);
		if (
			Object.prototype.hasOwnProperty.call(blockCommentThreadsByKey, key) ||
			blockCommentLoadingByKey[key]
		) {
			return;
		}
		void loadBlockComments(docId, blockId);
	}, [
		activeCommentBlockId,
		activeCommentVisible,
		activeDocument?.id,
		blockCommentLoadingByKey,
		blockCommentThreadsByKey,
		loadBlockComments,
	]);

	useEffect(() => {
		const docId = String(activeDocument?.id ?? "").trim();
		if (!docId || !resolvedProjectKey || trashPanelOpen || isEphemeralActive) {
			return;
		}
		void loadDocumentBlockCommentCounts(docId);
	}, [
		activeDocument?.id,
		isEphemeralActive,
		loadDocumentBlockCommentCounts,
		resolvedProjectKey,
		trashPanelOpen,
	]);

	const handleFavoriteMutation = useCallback(
		async (docId: string, action: "favorite" | "unfavorite") => {
			if (!resolvedProjectKey || !docId || favoritePendingIds[docId]) {
				return;
			}

			setFavoritePendingIds((prev) => ({ ...prev, [docId]: true }));

			try {
				const result =
					action === "favorite"
						? await favoriteDocument(resolvedProjectKey, docId)
						: await unfavoriteDocument(resolvedProjectKey, docId);
				setFavorites(mapFavoriteDocuments(result));
			} catch (err) {
				console.error(`${action} document failed:`, err);
				alert(err instanceof Error ? err.message : t("document.favorites.failed"));
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
		activeDocument && !isEphemeralActive
			? activeDocument.docType !== "overview"
			: true;
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
					navigate(`/documents/${encodeURIComponent(fallbackDocId)}`, {
						replace: true,
					});
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
	}, [
		ensureTabOpenedForDoc,
		navigate,
		resolvedDocumentId,
		restoreWorkspaceSnapshot,
	]);

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
			: (inFlightRef.current.get(requestKey) ??
				documentPromiseCache.get(requestKey));
		if (!promise) {
			promise = (async () => {
				const detail = await fetchDocument(
					resolvedProjectKey,
					resolvedDocumentId,
				);
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
					const emptyProject =
						shouldEnterEphemeralDraftMode(totalDocumentCount);
					setError(null);
					setDocument(null);
					if (emptyProject) {
						navigate(`/documents/${encodeURIComponent(EPHEMERAL_DRAFT_ID)}`, {
							replace: true,
						});
						return;
					}
					const fallbackDocId =
						tabSessionRef.current.tabs.find(
							(tab) =>
								tab.docId !== resolvedDocumentId &&
								tab.docId !== EPHEMERAL_DRAFT_ID,
						)?.docId ??
						rootDocuments[0]?.id ??
						null;
					if (fallbackDocId) {
						navigate(`/documents/${encodeURIComponent(fallbackDocId)}`, {
							replace: true,
						});
					} else {
						navigate("/documents", { replace: true });
					}
					return;
				}
				setError((err as Error).message || t("document.page.loadFailed"));
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
		if (
			!resolvedProjectKey ||
			!resolvedDocumentId ||
			resolvedDocumentId === EPHEMERAL_DRAFT_ID
		) {
			return;
		}
		const applyHierarchy = (hierarchy: Array<{ id: string; name: string }>) => {
			setDocument((prev) => {
				if (!prev || prev.id !== resolvedDocumentId) {
					return prev;
				}
				const updated = { ...prev, hierarchy };
				documentCache.set(
					`${resolvedProjectKey}:${resolvedDocumentId}`,
					updated,
				);
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
			!proposalId ||
			!resolvedProjectKey ||
			!resolvedDocumentId ||
			resolvedDocumentId === EPHEMERAL_DRAFT_ID
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
				setDiffError((err as Error).message || t("document.diff.loadFailed"));
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
		const currentTitle = resolveTabTitle(
			resolvedDocumentId,
			activeDocument?.title,
		);
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
		(
			docId: string,
			state: { status: DocumentEditorSaveStatus; error: string },
		) => {
			const normalizedDocId = docId.trim();
			if (!normalizedDocId) {
				return;
			}
			const nextError = state.error || null;
			setWorkspaceSaveStateByDoc((prev) => {
				const previous = prev[normalizedDocId];
				if (
					previous &&
					previous.status === state.status &&
					previous.error === nextError
				) {
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
				setEditorSaveStatus((prev) =>
					prev === state.status ? prev : state.status,
				);
				setEditorSaveError((prev) => (prev === nextError ? prev : nextError));
			}
		},
		[resolvedDocumentId],
	);

	const handleWorkspaceRetryBind = useCallback(
		(docId: string, handler: (() => void) | null) => {
			const normalizedDocId = docId.trim();
			if (!normalizedDocId) {
				return;
			}
			if (handler) {
				workspaceRetryMapRef.current.set(normalizedDocId, handler);
			} else {
				workspaceRetryMapRef.current.delete(normalizedDocId);
			}
		},
		[],
	);

	const handleWorkspaceFocusBind = useCallback(
		(docId: string, handler: (() => void) | null) => {
			const normalizedDocId = docId.trim();
			if (!normalizedDocId) {
				return;
			}
			if (handler) {
				workspaceFocusMapRef.current.set(normalizedDocId, handler);
			} else {
				workspaceFocusMapRef.current.delete(normalizedDocId);
			}
		},
		[],
	);

	const handleWorkspaceCodeExecRun = useCallback(
		async (
			docId: string,
			input: { blockId: string; language: string; code: string },
		) => {
			const normalizedDocId = docId.trim();
			if (!normalizedDocId) {
				return;
			}
			if (!resolvedProjectKey || normalizedDocId === EPHEMERAL_DRAFT_ID) {
				messageApi.warning(t("document.codeExec.saveFirst"));
				return;
			}

			const blockId = String(input.blockId ?? "").trim();
			if (!blockId) {
				messageApi.error(t("document.codeExec.missingBlockId"));
				return;
			}
			const language = normalizeCodeExecLanguage(input.language);
			if (!language) {
				messageApi.warning(t("document.codeExec.langUnsupported"));
				return;
			}

			updateWorkspaceCodeExecState(normalizedDocId, {
				type: "run-start",
				blockId,
			});
			try {
				const run = await runDocumentCodeBlock(
					resolvedProjectKey,
					normalizedDocId,
					{
						blockId,
						language,
						code: String(input.code ?? ""),
					},
				);
				updateWorkspaceCodeExecState(normalizedDocId, {
					type: "run-success",
					blockId,
					runId: run.runId,
					status: run.status,
				});
				if (run.status === "completed") {
					messageApi.success(t("document.codeExec.completed"));
					return;
				}
				if (run.status === "timeout") {
					messageApi.warning(t("document.codeExec.timeout"));
					return;
				}
				messageApi.error(t("document.codeExec.failed"));
			} catch (err) {
				if (isDocumentLockedError(err)) {
					messageApi.warning(t("document.codeExec.locked"));
					updateWorkspaceCodeExecState(normalizedDocId, {
						type: "run-error",
						blockId,
						status: "failed",
					});
					return;
				}
				const errorMessage =
					err instanceof Error ? err.message : t("document.codeExec.failed");
				messageApi.error(errorMessage);
				updateWorkspaceCodeExecState(normalizedDocId, {
					type: "run-error",
					blockId,
					status: "failed",
				});
			}
		},
		[resolvedProjectKey, updateWorkspaceCodeExecState],
	);

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
					prevDocs[normalizedDocId] ??
					(activeDocument && activeDocument.id === normalizedDocId
						? activeDocument
						: null);
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
					const items = mapHierarchyToBreadcrumb(
						hierarchy,
						normalizedDocId,
						displayTitle,
					);
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
		[
			activeDocument,
			resolvedDocumentId,
			resolvedProjectKey,
			syncTabTitleFromDocument,
		],
	);

	const handleWorkspaceBridgeBind = useCallback(
		(docId: string, bridge: WorkspaceBridge | null) => {
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
		},
		[resolvedDocumentId, restoreWorkspaceSnapshot],
	);

	const handleRetryEditorSave = useCallback(() => {
		const currentDocId = (resolvedDocumentId || "").trim();
		if (!currentDocId) {
			return;
		}
		workspaceRetryMapRef.current.get(currentDocId)?.();
	}, [resolvedDocumentId]);

	const handleWorkspaceLockFallback = useCallback(
		(docId: string) => {
			const normalizedDocId = docId.trim();
			if (!normalizedDocId) {
				return;
			}
			applyDocumentLockState(normalizedDocId, {
				locked: true,
				lockedBy: "",
				lockedAt: new Date().toISOString(),
			});
			if (resolvedProjectKey) {
				void fetchDocument(resolvedProjectKey, normalizedDocId)
					.then((data) => {
						const mapped = mapDocumentDetail(data, normalizedDocId, {
							markdownExtensions,
						});
						applyDocumentLockState(normalizedDocId, mapped.lock);
					})
					.catch(() => {
						// keep optimistic locked state when refresh fails
					});
			}
			if (resolvedDocumentId === normalizedDocId) {
				messageApi.warning(t("document.lock.readonlySwitched"));
			}
		},
		[
			applyDocumentLockState,
			markdownExtensions,
			resolvedDocumentId,
			resolvedProjectKey,
		],
	);

	const handleToggleDocumentLock = useCallback(async () => {
		if (
			!resolvedProjectKey ||
			!activeDocument ||
			isEphemeralActive ||
			lockBusy
		) {
			return;
		}
		setLockBusy(true);
		try {
			if (isActiveDocumentLocked) {
				await unlockDocument(resolvedProjectKey, activeDocument.id);
				applyDocumentLockState(activeDocument.id, null);
				messageApi.success(t("document.lock.unlocked"));
			} else {
				const lock = await lockDocument(resolvedProjectKey, activeDocument.id);
				applyDocumentLockState(activeDocument.id, lock);
				messageApi.success(t("document.lock.locked"));
			}
		} catch (err) {
			if (isDocumentLockedError(err)) {
				applyDocumentLockState(activeDocument.id, {
					locked: true,
					lockedBy: "",
					lockedAt: new Date().toISOString(),
				});
				messageApi.warning(t("document.lock.alreadyLocked"));
			} else {
				messageApi.error(err instanceof Error ? err.message : t("document.lock.updateFailed"));
			}
		} finally {
			setLockBusy(false);
		}
	}, [
		activeDocument,
		applyDocumentLockState,
		isActiveDocumentLocked,
		isEphemeralActive,
		lockBusy,
		resolvedProjectKey,
	]);

	const handleMaterializeEphemeralDraft = useCallback(
		async (payload: { title: string; content: JSONContent }) => {
			if (!resolvedProjectKey) {
				throw new Error(t("document.create.projectNotReady"));
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
					throw new Error(t("document.create.failedMissingId"));
				}
				const createdTitle = normalizeDocumentDisplayTitle(
					mapped.title || normalizedTitle,
				);
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
				setWorkspaceCodeExecStateByDoc((prev) => {
					const draftState = prev[EPHEMERAL_DRAFT_ID];
					const next = { ...prev };
					delete next[EPHEMERAL_DRAFT_ID];
					if (draftState) {
						next[createdDocId] = draftState;
					}
					return next;
				});

				const draftSnapshot = snapshotStoreRef.current[EPHEMERAL_DRAFT_ID];
				let nextSnapshots = removeSnapshot(
					snapshotStoreRef.current,
					EPHEMERAL_DRAFT_ID,
				);
				if (draftSnapshot) {
					nextSnapshots = upsertSnapshot(
						nextSnapshots,
						createdDocId,
						draftSnapshot,
					);
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
					(tab, index, list) =>
						list.findIndex((item) => item.docId === tab.docId) === index,
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

				navigate(`/documents/${encodeURIComponent(createdDocId)}`, {
					replace: true,
				});
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
			if (
				!normalizedDocId ||
				!resolvedProjectKey ||
				normalizedDocId === EPHEMERAL_DRAFT_ID
			) {
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
			const currentTitle =
				documentsById[normalizedDocId]?.title || payload.title;
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
			const data = await duplicateDocument(
				resolvedProjectKey,
				activeDocument.id,
			);
			const mapped = mapDocumentDetail(data, "", { markdownExtensions });
			const duplicatedId = mapped.id.trim();
			if (!duplicatedId) {
				throw new Error(t("document.duplicate.failedMissingId"));
			}

			const duplicatedTitle = normalizeDocumentDisplayTitle(mapped.title);
			const duplicatedParentId =
				String(mapped.parentId || activeDocument.parentId || "root").trim() ||
				"root";
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
				parentId: isRootDocumentId(duplicatedParentId)
					? ""
					: duplicatedParentId,
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

			documentCache.set(
				`${resolvedProjectKey}:${duplicatedId}`,
				duplicatedDocument,
			);
			syncTabTitleFromDocument(duplicatedId, duplicatedTitle);
			touchRecentEditInState(duplicatedId, duplicatedTitle);
			scheduleRecentEditsRefresh(resolvedProjectKey);
			messageApi.success(t("document.duplicate.created"));
		} catch (err) {
			console.error("Duplicate failed:", err);
			messageApi.error(err instanceof Error ? err.message : t("document.duplicate.failed"));
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
		const safeTitle = sanitizeFileName(activeDocument.title || t("document.export.defaultFilename"));

		try {
			setExporting(true);

			if (exportFormat === "word") {
				if (!resolvedProjectKey) {
					throw new Error(t("document.export.projectNotReadyWord"));
				}
				const blob = await exportDocumentDocx(
					resolvedProjectKey,
					activeDocument.id,
				);
				const filename = `${safeTitle || t("document.export.defaultFilename")}.docx`;
				downloadBlobFile(blob, filename);
				setExportModalOpen(false);
				return;
			}

			if (exportFormat === "markdown") {
				const markdown = tiptapJsonToMarkdown(content);
				const filename = `${safeTitle || t("document.export.defaultFilename")}.md`;
				downloadTextFile(markdown, filename, "text/markdown;charset=utf-8");
			} else {
				const payload = exportContentJson(content, null);
				const filename = `${safeTitle || t("document.export.defaultFilename")}.zeus.json`;
				downloadTextFile(
					JSON.stringify(payload, null, 2),
					filename,
					"application/json;charset=utf-8",
				);
			}
			setExportModalOpen(false);
		} catch (err) {
			console.error("Failed to export document:", err);
			messageApi.error(err instanceof Error ? err.message : t("document.export.failed"));
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
				const saved = await updateDocumentContent(
					resolvedProjectKey,
					activeDocument.id,
					{
						title: activeDocument.title,
						content: optimizedContent,
					},
				);
				const updatedContent =
					extractDocJsonContent(saved?.body?.content) ?? optimizedContent;
				setDocument((prev) =>
					prev ? { ...prev, content: updatedContent } : null,
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
				if (isDocumentLockedError(err)) {
					applyDocumentLockState(activeDocument.id, {
						locked: true,
						lockedBy: "",
						lockedAt: new Date().toISOString(),
					});
					messageApi.warning(t("document.lock.readonlySwitched"));
					return;
				}
				console.error("Failed to apply optimization:", err);
				messageApi.error(
					err instanceof Error ? err.message : t("document.optimize.saveFailed"),
				);
			}
		},
		[
			applyDocumentLockState,
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
			const data = await applyProposal(
				resolvedProjectKey,
				resolvedDocumentId,
				proposalId,
			);
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
			if (isDocumentLockedError(err)) {
				applyDocumentLockState(resolvedDocumentId, {
					locked: true,
					lockedBy: "",
					lockedAt: new Date().toISOString(),
				});
				setDiffError(t("document.diff.applyLocked"));
				messageApi.warning(t("document.lock.readonlySwitched"));
				return;
			}
			setDiffError((err as Error).message || t("document.diff.applyFailed"));
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
			await rebuildDocumentRag(resolvedProjectKey, activeDocument.id, {
				with_summary: withSummary,
			});
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
		if (isActiveDocumentLocked) {
			messageApi.warning(t("document.delete.locked"));
			return;
		}
		// Show confirmation dialog
		const hasChildren = activeDocument.docType === "dir";
		const confirmMessage = hasChildren
			? t("document.delete.confirmWithChildren", { title: activeDocument.title })
			: t("document.delete.confirmSingle", { title: activeDocument.title });
		if (!window.confirm(confirmMessage)) {
			return;
		}
		setDeleting(true);
		const parentId = activeDocument.parentId;
		try {
			const result = await deleteDocument(
				resolvedProjectKey,
				activeDocument.id,
				true,
			);
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
			const deletedSet = new Set(
				result.deleted_ids.map((id) => String(id).trim()).filter(Boolean),
			);
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
			setWorkspaceCodeExecStateByDoc((prev) => {
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

			const currentDocDeleted =
				Boolean(resolvedDocumentId) && deletedSet.has(resolvedDocumentId);
			if (currentDocDeleted) {
				if (nextTabState.activeDocId) {
					navigate(
						`/documents/${encodeURIComponent(nextTabState.activeDocId)}`,
						{ replace: true },
					);
				} else {
					navigate("/documents", { replace: true });
				}
			}

			// Refresh the full document tree
			await loadFullTree(resolvedProjectKey);
			// Keep the parent expanded if it still has children
			if (
				parentId &&
				parentId !== "root" &&
				childrenByParentRef.current[parentId]?.length > 0
			) {
				setExpandedIds((prev) => ({ ...prev, [parentId]: true }));
			}
		} catch (err) {
			if (isDocumentLockedError(err)) {
				applyDocumentLockState(activeDocument.id, {
					locked: true,
					lockedBy: "",
					lockedAt: new Date().toISOString(),
				});
				messageApi.warning(t("document.delete.locked"));
				return;
			}
			console.error("Delete failed:", err);
			messageApi.error(err instanceof Error ? err.message : t("document.delete.failed"));
		} finally {
			setDeleting(false);
		}
	}, [
		resolvedProjectKey,
		activeDocument,
		applyDocumentLockState,
		applySnapshotStore,
		applyTabSessionState,
		deleting,
		isActiveDocumentLocked,
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
					title: getUntitledDocumentTitle(),
					parentId,
				},
				{ type: "doc", content: [] },
			);
			const createdDocId = String(created.id || "").trim();
			if (!createdDocId) {
				throw new Error(t("document.create.failedMissingId"));
			}
			await handleDocumentsChanged(parentId);
			await openDocumentById(createdDocId, created.title, { replace: false });
		} catch (err) {
			console.error("Create child document failed:", err);
			alert(err instanceof Error ? err.message : t("document.create.failed"));
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

	const handleOpenImportWithMode = (
		mode: "file" | "folder" | "url" | "git",
	) => {
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
				setImportStatus({ type: "error", message: t("document.import.urlRequired") });
				return;
			}
			if (!isValidHttpUrl(urlValue)) {
				setImportStatus({
					type: "error",
					message: t("document.import.urlInvalid"),
				});
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
					throw new Error(t("document.import.emptyHtml"));
				}
				const parsedDoc = new DOMParser().parseFromString(html, "text/html");
				const article = new Readability(parsedDoc).parse();
				const extractedTitle = article?.title?.trim() ?? "";
				const content = article?.content ?? "";
				if (!content.trim()) {
					throw new Error(t("document.import.noReadable"));
				}
				const turndownService = new TurndownService({
					headingStyle: "atx",
					codeBlockStyle: "fenced",
				});
				const markdown = turndownService.turndown(content);
				const parsed = markdownToTiptapJson(markdown, {
					extensions: markdownExtensions,
				});
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
				setImportStatus({ type: "success", message: t("document.import.complete") });
				setImportModalOpen(false);
				setImportUrl("");
				setImportUrlTitle("");
				setSelectedFiles([]);
				await handleDocumentsChanged(activeDocument?.id ?? "");
			} catch (err) {
				console.log("import_url_error", err);
				const message =
					err instanceof Error && err.message ? err.message : t("document.import.failed");
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
				setImportStatus({ type: "error", message: t("document.import.repoRequired") });
				return;
			}
			if (!isValidHttpUrl(repoUrl)) {
				setImportStatus({ type: "error", message: t("document.import.repoInvalid") });
				return;
			}
			if (branchValue && !isValidGitBranch(branchValue)) {
				setImportStatus({ type: "error", message: t("document.import.branchInvalid") });
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
				: (Array.from(uploadFilterPresets) as (
						| "all"
						| "images"
						| "office"
						| "text"
						| "markdown"
					)[]);

			try {
				const { taskId } = await createImportGitTask(resolvedProjectKey, {
					repo_url: repoUrl,
					branch: branchValue || undefined,
					subdir: gitSubdir.trim() || undefined,
					parent_id: activeDocument?.id ?? "root",
					auto_import_submodules: gitAutoImportSubmodules,
					smart_import: smartImportEnabled,
					smart_import_types: Array.from(smartImportTypes).filter(
						(t) => t !== "all",
					) as Array<"markdown" | "word" | "pdf" | "image">,
					file_types: fileTypeFilters,
					enable_format_optimize: smartImportEnabled && formatOptimizeEnabled,
				});
				if (!taskId) {
					throw new Error(t("document.import.taskCreateFailed"));
				}
				setUploadCompleted(1);
				setImportStatus({
					type: "success",
					message: t("document.import.taskCreated"),
				});
				messageApi.success(t("document.import.taskCreated"));
				setImportModalOpen(false);
				setGitRepoUrl("");
				setGitBranch("main");
				setGitSubdir("");
				setGitAutoImportSubmodules(false);
			} catch (err) {
				console.log("import_git_error", err);
				const errorMessage =
					err instanceof Error && err.message ? err.message : t("document.import.failed");
				messageApi.error(errorMessage);
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
				setImportStatus({ type: "error", message: t("document.import.folderRequired") });
				return;
			}
			const { files: filteredFiles } = filterFilesByPreset(
				selectedFiles,
				activeUploadPreset,
			);
			if (filteredFiles.length === 0) {
				setImportStatus({ type: "error", message: t("document.import.noMatchingFiles") });
				return;
			}
			setUploading(true);
			setUploadTotal(1);
			setUploadCompleted(0);
			setImportStatus({ type: "idle" });
			setUploadSummary(null);

			try {
				const selectedSmartImportTypes = Array.from(smartImportTypes).filter(
					(t) => t !== "all",
				) as Array<"markdown" | "word" | "pdf" | "image">;
				const { taskId } = await createImportFolderTask(
					resolvedProjectKey,
					filteredFiles,
					{
						parent_id: activeDocument?.id ?? "root",
						smart_import: smartImportEnabled,
						smart_import_types: selectedSmartImportTypes,
						enable_format_optimize: smartImportEnabled && formatOptimizeEnabled,
					},
				);
				if (!taskId) {
					throw new Error(t("document.import.taskCreateFailed"));
				}
				setUploadCompleted(1);
				setImportStatus({
					type: "success",
					message: t("document.import.taskCreated"),
				});
				messageApi.success(t("document.import.taskCreated"));
				setImportModalOpen(false);
				setSelectedFiles([]);
			} catch (err) {
				console.log("import_folder_error", err);
				const errorMessage =
					err instanceof Error && err.message ? err.message : t("document.import.failed");
				messageApi.error(errorMessage);
				setImportStatus({ type: "error", message: errorMessage });
			} finally {
				setUploading(false);
				setUploadTotal(0);
				setUploadCompleted(0);
			}
			return;
		}
		if (selectedFiles.length === 0) {
			console.log(
				importMode === "file" ? "import_file_empty" : "import_folder_empty",
			);
			return;
		}

		const { files: filteredFiles, skipped } = filterFilesByPreset(
			selectedFiles,
			activeUploadPreset,
		);
		if (filteredFiles.length === 0) {
			setImportStatus({ type: "error", message: t("document.import.noMatchingFiles") });
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
					? (directoryIds.get(directory.parentPath) ?? baseParentId)
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

			const selectedSmartImportTypes = Array.from(smartImportTypes).filter(
				(t) => t !== "all",
			) as Array<"markdown" | "word" | "pdf" | "image">;

			for (const entry of files) {
				const docTitle = stripExtension(entry.name) || entry.name;
				const parentId = entry.parentPath
					? (directoryIds.get(entry.parentPath) ?? baseParentId)
					: baseParentId;

				try {
					const imported = await importFileAsDocument(
						resolvedProjectKey,
						entry.file,
						{
							parent_id: parentId,
							title: docTitle,
							smart_import: smartImportEnabled,
							smart_import_types: selectedSmartImportTypes,
							enable_format_optimize:
								smartImportEnabled && formatOptimizeEnabled,
						},
					);
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
			setImportStatus({ type: "success", message: t("document.import.uploadComplete") });
			setImportModalOpen(false);
			setSelectedFiles([]);
			await handleDocumentsChanged(baseParentId);
		} catch (err) {
			console.log("import_upload_error", err);
			setImportStatus({ type: "error", message: t("document.import.uploadFailed") });
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

	const activeTabDocId =
		(resolvedDocumentId || tabSessionState.activeDocId || "").trim() || null;

	const tabItems = useMemo(
		() =>
			tabSessionState.tabs.map((tab) => {
				const doc = documentsById[tab.docId];
				const saveState = workspaceSaveStateByDoc[tab.docId];
				const snapshotLocked = Boolean(snapshotStore[tab.docId]?.locked);
				const isEphemeralTab =
					tab.docId === EPHEMERAL_DRAFT_ID || doc?.id === EPHEMERAL_DRAFT_ID;
				return {
					docId: tab.docId,
					title: doc?.title ?? tab.title,
					dirty: saveState?.status === "dirty" || saveState?.status === "error",
					locked:
						!isEphemeralTab && (Boolean(doc?.lock?.locked) || snapshotLocked),
				};
			}),
		[
			documentsById,
			snapshotStore,
			tabSessionState.tabs,
			workspaceSaveStateByDoc,
		],
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
						(activeDocument && activeDocument.id === tab.docId
							? activeDocument
							: null);
					const isActive = tab.docId === activeTabDocId;
					const isEphemeralTab = tabDocument?.id === EPHEMERAL_DRAFT_ID;
					const snapshotLocked = Boolean(snapshotStore[tab.docId]?.locked);
					const tabLocked =
						!isEphemeralTab &&
						(Boolean(tabDocument?.lock?.locked) || snapshotLocked);
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
									locked={tabLocked}
									persistMode={isEphemeralTab ? "ephemeral" : "persisted"}
									onFirstMeaningfulChange={
										isEphemeralTab ? handleMaterializeEphemeralDraft : undefined
									}
									onLockFallback={() =>
										handleWorkspaceLockFallback(tabDocument.id)
									}
									onSaved={(payload) =>
										handleWorkspaceSaved(tabDocument.id, payload)
									}
									onSaveStateChange={(state) =>
										handleWorkspaceSaveStateChange(tabDocument.id, {
											status: state.status as DocumentEditorSaveStatus,
											error: state.error,
										})
									}
									onTitleChange={(nextTitle) =>
										handleWorkspaceTitleChange(tabDocument.id, nextTitle)
									}
									onRetryBind={(handler) =>
										handleWorkspaceRetryBind(tabDocument.id, handler)
									}
									onFocusBind={(handler) =>
										handleWorkspaceFocusBind(tabDocument.id, handler)
									}
									onBridgeBind={(bridge) =>
										handleWorkspaceBridgeBind(tabDocument.id, bridge)
									}
									onCodeExecRun={(input) =>
										handleWorkspaceCodeExecRun(tabDocument.id, input)
									}
									codeExecStateByBlockId={
										workspaceCodeExecStateByDoc[tabDocument.id] ?? {}
									}
									commentCountByBlockId={
										blockCommentState.countByDocId[tabDocument.id] ?? {}
									}
									onBlockCommentOpen={({ blockId, anchor }) =>
										handleWorkspaceOpenBlockComment(
											tabDocument.id,
											blockId,
											anchor,
										)
									}
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
		if (trashPanelOpen) {
			if (trashLoading && !activeTrashPreview) {
				return <div className="doc-viewer-state">{t("document.trash.loading")}</div>;
			}
			if (!activeTrashPreview) {
				return <div className="doc-viewer-state">{t("document.trash.empty")}</div>;
			}
			return (
				<div className="doc-page-body">
					<div
						className="document-trash-banner"
						role="status"
						aria-live="polite"
					>
						<div className="document-trash-banner-message">
							<WarningOutlined className="document-trash-banner-message-icon" />
							<span
								className="document-trash-banner-message-text"
								title={t("document.trash.deletedAtTitle", { time: formatTrashDeletedAt(activeTrashPreview.deletedAt) })}
							>
								{buildTrashBannerMessage(
									activeTrashPreview.deletedBy,
									activeTrashPreview.deletedAt,
									trashAutoCleanupEnabled,
									trashAutoCleanupDays,
								)}
							</span>
						</div>
						<div className="document-trash-banner-actions">
							<button
								className="document-trash-banner-btn"
								type="button"
								onClick={() => {
									void handleRestoreTrash(activeTrashPreview.trashId);
								}}
								disabled={trashLoading}
							>
								<RollbackOutlined />
								<span>{t("document.trash.restore")}</span>
							</button>
							<button
								className="document-trash-banner-btn document-trash-banner-btn-danger"
								type="button"
								onClick={() => {
									if (!window.confirm(t("document.trash.confirmDeleteForever"))) {
										return;
									}
									void handlePurgeTrash(activeTrashPreview.trashId);
								}}
								disabled={trashLoading}
							>
								<DeleteOutlined />
								<span>{t("document.trash.deleteForever")}</span>
							</button>
						</div>
					</div>
					<div className="document-workspace document-workspace-readonly">
						{showDocumentTitle ? (
							<input
								className="document-workspace-title-input"
								value={activeTrashPreview.document.title}
								readOnly
							/>
						) : null}
						<RichTextViewer
							content={activeTrashPreview.document.content ?? EMPTY_TIPTAP_DOC}
							projectKey={resolvedProjectKey}
						/>
					</div>
				</div>
			);
		}
		if (!resolvedDocumentId) {
			return (
				<div className="doc-viewer-state">
					{t("document.page.selectFromTree")}
				</div>
			);
		}
		// Show error only if not loading and we have an error
		if (error && !loading) {
			return <div className="doc-viewer-error">{error}</div>;
		}
		// Show loading only if we don't have any document to show yet
		if (loading && !activeDocument) {
			return <div className="doc-viewer-state">{t("document.page.loading")}</div>;
		}
		if (!activeDocument) {
			return <div className="doc-viewer-state">{t("document.page.empty")}</div>;
		}
		return (
			<div className="doc-page-body">
				{hasProposal ? (
					<div className="doc-diff-panel">
						<div className="doc-diff-header">
							<span>{t("document.diff.title")}</span>
							<div className="doc-diff-actions">
								<button
									className="doc-diff-action"
									type="button"
									onClick={handleApplyProposal}
									disabled={applyLoading || diffLoading}
								>
									{applyLoading ? t("document.diff.applying") : t("document.diff.apply")}
								</button>
								<button
									className="doc-diff-action secondary"
									type="button"
									onClick={handleDismissProposal}
									disabled={applyLoading}
								>
									{t("document.diff.cancel")}
								</button>
							</div>
						</div>
						{diffLoading ? (
							<div className="doc-diff-state">{t("document.diff.loading")}</div>
						) : diffError ? (
							<div className="doc-diff-error">{diffError}</div>
						) : diffData ? (
							<div className="doc-diff-body">
								{diffData.metaDiff ? (
									<div className="doc-diff-section">
										<div className="doc-diff-label">{t("document.diff.metadata")}</div>
										<pre className="doc-diff-code">{diffData.metaDiff}</pre>
									</div>
								) : null}
								{diffData.contentDiff ? (
									<div className="doc-diff-section">
										<div className="doc-diff-label">{t("document.diff.content")}</div>
										<pre className="doc-diff-code">{diffData.contentDiff}</pre>
									</div>
								) : null}
								{!diffData.metaDiff && !diffData.contentDiff ? (
									<div className="doc-diff-state">{t("document.diff.noChanges")}</div>
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
					trashNodes={trashTreeNodes}
					trashLoading={trashLoading}
					activeTrashKey={activeTrashNodeKey}
					expandedIds={expandedIds}
					activeId={
						trashPanelOpen
							? null
							: resolvedDocumentId === EPHEMERAL_DRAFT_ID
								? null
								: resolvedDocumentId || null
					}
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
					onOpenTrash={handleOpenTrash}
					onSelectTrash={handleSelectTrashNode}
					onEmptyAreaClick={() => {
						setTrashPanelOpen(false);
						navigate("/documents");
					}}
					onAddDocument={() => {
						setTrashPanelOpen(false);
						void handleOpenNew();
					}}
					outlineMode={outlineMode}
					onToggleOutline={() => setOutlineMode((v) => !v)}
					documentContent={activeDocument?.content ?? null}
				/>
			}
		>
			<>
				<div className="doc-viewer-page">
					<div
						className={`doc-page-workarea${llmSidebarVisible ? " has-llm-sidebar" : ""}`}
					>
						<div className="doc-page-workarea-main">
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
									<div className="doc-page-right-topbar-actions doc-page-right-topbar-actions-end">
										<button
											className="kb-sidebar-toolbar-btn doc-page-right-topbar-btn"
											type="button"
											onClick={() => setLlmSidebarVisible((prev) => !prev)}
											aria-label={
												llmSidebarVisible ? t("document.aiSidebar.hide") : t("document.aiSidebar.show")
											}
											title={
												llmSidebarVisible ? t("document.aiSidebar.hide") : t("document.aiSidebar.show")
											}
										>
											<MessageOutlined />
										</button>
									</div>
								</div>
								{showBreadcrumb || showHeaderActions ? (
									<DocumentHeader
										breadcrumbItems={
											trashPanelOpen ? [{ label: t("document.trash.breadcrumb") }] : breadcrumbItems
										}
										mode="view"
										showBreadcrumb={showBreadcrumb}
										showActions={showHeaderActions && !trashPanelOpen}
										allowChildActions={allowChildActions}
										allowDelete={
											Boolean(activeDocument) &&
											!isEphemeralActive &&
											!isActiveDocumentLocked
										}
										allowOptimize={
											Boolean(activeDocument) &&
											!isEphemeralActive &&
											!isActiveDocumentLocked
										}
										deleting={deleting}
										onSave={() => {}}
										onCancel={() => {}}
										onNew={handleOpenNew}
										onImport={() => handleOpenImportWithMode("file")}
										onDelete={handleDelete}
										onDuplicate={
											activeDocument && !isEphemeralActive
												? handleDuplicate
												: undefined
										}
										onExport={
											activeDocument && !isEphemeralActive
												? handleOpenExport
												: undefined
										}
										onOptimize={
											activeDocument && !isEphemeralActive
												? handleOpenOptimize
												: undefined
										}
										syncStatus={syncStatus}
										syncError={syncError}
										syncDisabled={
											!resolvedProjectKey || syncStatus === "syncing"
										}
										locked={isActiveDocumentLocked}
										lockBusy={lockBusy}
										onLockToggle={
											activeDocument && !isEphemeralActive
												? handleToggleDocumentLock
												: undefined
										}
										editorSaveStatus={editorSaveStatus}
										editorSaveError={editorSaveError}
										onRetryEditorSave={
											activeDocument ? handleRetryEditorSave : undefined
										}
										onSync={resolvedProjectKey ? handleSyncNow : undefined}
										onViewSyncLogs={
											resolvedProjectKey ? handleOpenSyncLogs : undefined
										}
									/>
								) : null}
							</div>
							<div className="doc-page-main-body">{bodyContent()}</div>
						</div>
						{activeCommentVisible ? (
							<DocumentBlockCommentSidebar
								visible={activeCommentVisible}
								blockId={activeCommentBlockId}
								anchor={activeCommentAnchor}
								threads={activeCommentThreads}
								loading={activeCommentLoading}
								busy={blockCommentBusy}
								onClose={handleCloseBlockCommentPanel}
								onRefresh={() => {
									void refreshActiveBlockComments();
								}}
								onCreateThread={async (content) => {
									await handleCreateBlockCommentThread(content);
								}}
								onReplyThread={async (threadId, content) => {
									await handleReplyBlockCommentThread(threadId, content);
								}}
								onToggleThreadStatus={async (threadId, status) => {
									await handleToggleBlockCommentThreadStatus(threadId, status);
								}}
								onDeleteMessage={async (messageId) => {
									await handleDeleteBlockCommentMessage(messageId);
								}}
							/>
						) : null}
						<aside
							className={`doc-page-llm-sidebar${llmSidebarVisible ? " is-open" : " is-closed"}`}
							aria-hidden={!llmSidebarVisible}
						>
							<ChatPanel
								variant="sidebar"
								defaultDocumentId={
									!isEphemeralActive ? activeDocument?.id : undefined
								}
								hidden={!llmSidebarVisible}
								showFloatingButtonWhenHidden={false}
								onHiddenChange={(nextHidden) =>
									setLlmSidebarVisible(!nextHidden)
								}
							/>
						</aside>
					</div>
				</div>
				{importModalOpen ? (
					<div className="modal-overlay" role="presentation">
						<button
							className="modal-overlay-button"
							type="button"
							aria-label={t("document.import.closeDialog")}
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
								<h2>{t("document.import.title")}</h2>
								<button
									className="modal-close"
									type="button"
									onClick={handleCloseImport}
								>
									{t("document.modal.close")}
								</button>
							</div>
							<div className="modal-body">
								<div className="kb-import-tabs" role="tablist">
									<button
										className={`kb-import-tab${importMode === "file" ? " active" : ""}`}
										type="button"
										onClick={() => handleModeChange("file")}
									>
										{t("document.import.tab.file")}
									</button>
									<button
										className={`kb-import-tab${importMode === "folder" ? " active" : ""}`}
										type="button"
										onClick={() => handleModeChange("folder")}
									>
										{t("document.import.tab.folder")}
									</button>
									<button
										className={`kb-import-tab${importMode === "url" ? " active" : ""}`}
										type="button"
										onClick={() => handleModeChange("url")}
									>
										{t("document.import.tab.url")}
									</button>
									<button
										className={`kb-import-tab${importMode === "git" ? " active" : ""}`}
										type="button"
										onClick={() => handleModeChange("git")}
									>
										{t("document.import.tab.git")}
									</button>
								</div>
								{importMode !== "url" ? (
									<>
										<fieldset className="kb-import-smart">
											<div className="kb-import-smart-header">
												<div className="kb-import-smart-title">{t("document.import.smartImport")}</div>
												<div
													style={{
														display: "flex",
														gap: "8px",
														alignItems: "center",
													}}
												>
													<button
														className={`kb-import-toggle${formatOptimizeEnabled && smartImportEnabled ? " active" : ""}`}
														type="button"
														aria-pressed={
															formatOptimizeEnabled && smartImportEnabled
														}
														onClick={() =>
															setFormatOptimizeEnabled((prev) => !prev)
														}
														disabled={!smartImportEnabled}
														title={t("document.import.formatOptimize")}
													>
														{t("document.import.formatOptimizeLabel")}
													</button>
													<button
														className={`kb-import-toggle${smartImportEnabled ? " active" : ""}`}
														type="button"
														aria-pressed={smartImportEnabled}
														onClick={() =>
															setSmartImportEnabled((prev) => !prev)
														}
													>
														{smartImportEnabled ? t("document.toggle.on") : t("document.toggle.off")}
													</button>
												</div>
											</div>
											<fieldset
												className="kb-import-smart-options"
												aria-label={t("document.import.smartTypesAria")}
											>
												{SMART_IMPORT_OPTIONS.map((option) => {
													const disabled =
														!option.enabled || !smartImportEnabled;
													const active = isSmartImportTypeSelected(option.id);
													const chipClass = `kb-import-chip${active ? " active" : ""}${
														disabled ? " disabled" : ""
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
										<fieldset
											className="kb-import-smart"
											aria-label={t("document.import.fileFiltersAria")}
										>
											<div className="kb-import-smart-header">
												<div className="kb-import-smart-title">
													{t("document.import.fileTypeFilter")}
												</div>
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
															onClick={() =>
																toggleUploadFilterPreset(preset.id)
															}
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
										<div className="kb-import-title">{t("document.import.selectFileTitle")}</div>
										<div className="kb-import-note">{t("document.import.uploadCreatesDoc")}</div>
										<button
											className="btn ghost"
											type="button"
											onClick={handleFilePick}
										>
											{t("document.import.pickFile")}
										</button>
										<div className="kb-import-selection">
											{selectedFiles[0]?.name ?? t("document.import.noFileSelected")}
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
										<div className="kb-import-title">{t("document.import.selectFolderTitle")}</div>
										<div className="kb-import-note">{t("document.import.uploadCreatesDoc")}</div>
										<button
											className="btn ghost"
											type="button"
											onClick={handleFolderPick}
										>
											{t("document.import.pickFile")}夹
										</button>
										<div className="kb-import-selection">
											{selectedFiles.length > 0
												? t("document.import.folderSelectedCount", { count: selectedFiles.length })
												: t("document.import.noFolderSelected")}
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
										<div className="kb-import-title">{t("document.import.fromUrl")}</div>
										<div className="kb-import-note">
											{t("document.import.urlNote")}
										</div>
										<div className="kb-import-url-fields">
											<Input
												className="kb-import-url-input"
												type="url"
												placeholder={t("document.import.urlPlaceholder")}
												value={importUrl}
												onChange={(event) => setImportUrl(event.target.value)}
												disabled={uploading}
											/>
											<Input
												className="kb-import-url-input"
												placeholder={t("document.import.titleOptional")}
												value={importUrlTitle}
												onChange={(event) =>
													setImportUrlTitle(event.target.value)
												}
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
										<div className="kb-import-title">{t("document.import.fromGit")}</div>
										<div className="kb-import-note">
											{t("document.import.gitNote")}
										</div>
										<div className="kb-import-url-fields">
											<Input
												className="kb-import-url-input"
												type="url"
												placeholder={t("document.import.gitPlaceholder")}
												value={gitRepoUrl}
												onChange={(event) => setGitRepoUrl(event.target.value)}
												disabled={uploading}
											/>
											<Input
												className="kb-import-url-input"
												placeholder={t("document.import.branchPlaceholder")}
												value={gitBranch}
												onChange={(event) => setGitBranch(event.target.value)}
												disabled={uploading}
											/>
											<Input
												className="kb-import-url-input"
												placeholder={t("document.import.subdirPlaceholder")}
												value={gitSubdir}
												onChange={(event) => setGitSubdir(event.target.value)}
												disabled={uploading}
											/>
											<div className="kb-import-git-options">
												<Checkbox
													checked={gitAutoImportSubmodules}
													onChange={(event) =>
														setGitAutoImportSubmodules(event.target.checked)
													}
													disabled={uploading}
												>
													{t("document.import.autoSubmodules")}
												</Checkbox>
											</div>
										</div>
									</div>
								)}
								{importStatus.type !== "idle" ? (
									<div
										className={`kb-import-status ${
											importStatus.type === "error" ? "error" : "success"
										}`}
									>
										{importStatus.message}
									</div>
								) : null}
								{uploadSummary ? (
									<div className="kb-import-summary">
										<div className="kb-import-summary-item">
											{t("document.import.summary.folders", { count: uploadSummary.directories })}
										</div>
										<div className="kb-import-summary-item">
											{t("document.import.summary.documents", { count: uploadSummary.files })}
										</div>
										{uploadSummary.converted > 0 ? (
											<div className="kb-import-summary-item">
												{t("document.import.summary.smart", { count: uploadSummary.converted })}
											</div>
										) : null}
										{uploadSummary.fallback > 0 ? (
											<div className="kb-import-summary-item">
												{t("document.import.summary.fallback", { count: uploadSummary.fallback })}
											</div>
										) : null}
										{uploadSummary.skipped > 0 ? (
											<div className="kb-import-summary-item">
												{t("document.import.summary.skipped", { count: uploadSummary.skipped })}
											</div>
										) : null}
									</div>
								) : null}
							</div>
							<div className="modal-actions">
								<button
									className="btn ghost"
									type="button"
									onClick={handleCloseImport}
								>
									{t("document.diff.cancel")}
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
											{(importMode === "folder" || importMode === "git") &&
											uploadTotal > 1
												? `${uploadProgress}%`
												: null}
										</>
									) : importMode === "url" ? (
										t("document.import.submitUrl")
									) : importMode === "git" ? (
										t("document.import.submitRepo")
									) : (
										t("document.import.submitUpload")
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
							aria-label={t("document.syncLogs.closeDialog")}
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
								<h2>{t("document.syncLogs.title")}</h2>
								<button
									className="modal-close"
									type="button"
									onClick={() => setSyncLogModalOpen(false)}
								>
									{t("document.modal.close")}
								</button>
							</div>
							<div className="modal-body">
								{syncLogsLoading ? (
									<div className="doc-viewer-state">{t("document.syncLogs.loading")}</div>
								) : syncLogsError ? (
									<div className="modal-error">{syncLogsError}</div>
								) : syncLogs.length === 0 ? (
									<div className="doc-viewer-state">{t("document.syncLogs.empty")}</div>
								) : (
									<div className="kb-sync-log-list">
										{syncLogs.map((item) => {
											const detail =
												item.detail && typeof item.detail === "object"
													? (item.detail as Record<string, unknown>)
													: {};
											const errorText =
												typeof detail.error === "string"
													? detail.error.trim()
													: "";
											const syncMode =
												typeof detail.syncMode === "string"
													? detail.syncMode.trim()
													: "";
											const trigger =
												typeof detail.trigger === "string"
													? detail.trigger.trim()
													: "";
											const event =
												typeof detail.event === "string"
													? detail.event.trim()
													: "";
											const docId =
												typeof detail.docId === "string"
													? detail.docId.trim()
													: "";
											const metaParts: string[] = [];
											if (syncMode) {
												metaParts.push(
													t("document.syncLogs.meta.mode", { value: formatSyncModeLabel(syncMode) }),
												);
											}
											if (trigger) {
												metaParts.push(
													t("document.syncLogs.meta.trigger", { value: formatSyncTriggerLabel(trigger) }),
												);
											}
											if (event) {
												metaParts.push(t("document.syncLogs.meta.event", { value: event }));
											}
											if (docId) {
												metaParts.push(t("document.syncLogs.meta.doc", { value: docId }));
											}

											return (
												<div key={item.id} className="kb-sync-log-item">
													<div className="kb-sync-log-item-header">
														<span
															className={`kb-sync-log-status status-${item.status}`}
														>
															{formatMessageStatusLabel(item.status)}
														</span>
														<span className="kb-sync-log-time">
															{formatSyncLogTime(
																item.updatedAt || item.createdAt,
															)}
														</span>
													</div>
													{errorText ? (
														<div className="kb-sync-log-error">{errorText}</div>
													) : null}
													{metaParts.length > 0 ? (
														<div className="kb-sync-log-meta">
															{metaParts.join(" · ")}
														</div>
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
									{t("document.modal.close")}
								</button>
								<button
									className={`btn primary${syncLogsLoading ? " loading" : ""}`}
									type="button"
									onClick={() => {
										void loadRecentSyncLogs();
									}}
									disabled={syncLogsLoading}
								>
									{syncLogsLoading ? t("document.syncLogs.refreshing") : t("document.syncLogs.refresh")}
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
							aria-label={t("document.export.closeDialog")}
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
								<h2>{t("document.export.title")}</h2>
								<button
									className="modal-close"
									type="button"
									onClick={() => setExportModalOpen(false)}
								>
									{t("document.modal.close")}
								</button>
							</div>
							<div className="modal-body">
								<div
									className="kb-export-options"
									role="radiogroup"
									aria-label={t("document.export.formatAria")}
								>
									<label className="kb-export-option">
										<input
											type="radio"
											name="export-format"
											value="markdown"
											checked={exportFormat === "markdown"}
											onChange={() => setExportFormat("markdown")}
										/>
										<span>{t("document.export.format.markdown")}</span>
									</label>
									<label className="kb-export-option">
										<input
											type="radio"
											name="export-format"
											value="zeus"
											checked={exportFormat === "zeus"}
											onChange={() => setExportFormat("zeus")}
										/>
										<span>{t("document.export.format.zeus")}</span>
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
											<span>{t("document.export.format.word")}</span>
											<small className="kb-export-option-hint">
												{t("document.export.format.wordHint")}
											</small>
										</span>
									</label>
								</div>
								{exportFormat === "word" ? (
									<p className="kb-export-warning">
										提示：Word
										导出为有损导出，复杂样式、插件块和部分嵌套结构可能无法完全保留。
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
									{t("document.diff.cancel")}
								</button>
								<button
									className={`btn primary${exporting ? " loading" : ""}`}
									type="button"
									onClick={handleExportSubmit}
									disabled={exporting}
								>
									{exporting ? t("document.export.exporting") : t("document.export.submit")}
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
							aria-label={t("document.rebuild.closeDialog")}
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
								<h2>{t("document.rebuild.title")}</h2>
								<button
									className="modal-close"
									type="button"
									onClick={() => setRebuildModalOpen(false)}
								>
									{t("document.modal.close")}
								</button>
							</div>
							<div className="modal-body">是否同时生成文档摘要？</div>
							<div className="modal-actions">
								<button
									className="btn ghost"
									type="button"
									onClick={() => setRebuildModalOpen(false)}
									disabled={rebuilding}
								>
									{t("document.diff.cancel")}
								</button>
								<button
									className="btn ghost"
									type="button"
									onClick={() => handleRebuildChoice(false)}
									disabled={rebuilding}
								>
									仅重建索引
								</button>
								<button
									className="btn primary"
									type="button"
									onClick={() => handleRebuildChoice(true)}
									disabled={rebuilding}
								>
									重建并生成摘要
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
		lock: null,
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

function formatTrashDeletedAt(value: string): string {
	if (!value) {
		return "-";
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	return date.toLocaleString();
}

const TRASH_AUTO_CLEANUP_DAYS_FALLBACK = 30;

function formatTrashDeletedRelative(value: string): string {
	if (!value) {
		return i18n.t("document.time.justNow", { ns: "document", defaultValue: "刚刚" });
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return formatTrashDeletedAt(value);
	}
	const diffMs = Date.now() - date.getTime();
	if (diffMs <= 60_000) {
		return i18n.t("document.time.justNow", { ns: "document", defaultValue: "刚刚" });
	}
	const minutes = Math.floor(diffMs / 60_000);
	if (minutes < 60) {
		return i18n.t("document.time.minutesAgo", { ns: "document", count: minutes, defaultValue: `${minutes} 分钟前` });
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return i18n.t("document.time.hoursAgo", { ns: "document", count: hours, defaultValue: `${hours} 小时前` });
	}
	const days = Math.floor(hours / 24);
	if (days < 30) {
		return i18n.t("document.time.daysAgo", { ns: "document", count: days, defaultValue: `${days} 天前` });
	}
	return formatTrashDeletedAt(value);
}

function normalizeTrashAutoCleanupDaysForBanner(value: number): number {
	if (!Number.isFinite(value)) {
		return TRASH_AUTO_CLEANUP_DAYS_FALLBACK;
	}
	return Math.min(3650, Math.max(1, Math.floor(value)));
}

function buildTrashAutoCleanupCopy(enabled: boolean, days: number): string {
	if (!enabled) {
		return i18n.t("document.trash.autoCleanupDisabled", { ns: "document", defaultValue: "当前未开启自动清理。" });
	}
	const normalizedDays = normalizeTrashAutoCleanupDaysForBanner(days);
	return i18n.t("document.trash.autoCleanupAfterDays", { ns: "document", days: normalizedDays, defaultValue: `此文档将在 ${normalizedDays} 天后自动删除。` });
}

function buildTrashBannerMessage(
	deletedBy: string,
	deletedAt: string,
	autoCleanupEnabled: boolean,
	autoCleanupDays: number,
): string {
	const actor = normalizeTrashActor(deletedBy);
	const deletedRelative = formatTrashDeletedRelative(deletedAt);
	const cleanupCopy = buildTrashAutoCleanupCopy(
		autoCleanupEnabled,
		autoCleanupDays,
	);
	return i18n.t("document.trash.banner", { ns: "document", actor, deletedRelative, cleanupCopy, defaultValue: `${actor} 于 ${deletedRelative} 将此文档移至垃圾箱。${cleanupCopy}` });
}

function normalizeTrashActor(deletedBy: string): string {
	const trimmed = deletedBy.trim();
	if (!trimmed) {
		return i18n.t("document.trash.member", { ns: "document", defaultValue: "某位成员" });
	}
	const isUuid =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			trimmed,
		);
	return isUuid ? i18n.t("document.trash.member", { ns: "document", defaultValue: "某位成员" }) : trimmed;
}

function getTrashDocId(doc: DocumentDetail): string {
	return String(doc.meta?.id ?? doc.id ?? "").trim();
}

function getTrashDocParentId(doc: DocumentDetail): string {
	return (
		String(doc.meta?.parent_id ?? doc.parent_id ?? "root").trim() || "root"
	);
}

function buildTrashTreeFromSnapshot(
	entry: DocumentTrashItem,
	docs: DocumentDetail[],
	rootDocId: string,
	options?: { markdownExtensions?: Extensions },
): {
	nodes: TrashSideNavNode[];
	previewByKey: Record<string, TrashDocumentPreview>;
} {
	const previewByKey: Record<string, TrashDocumentPreview> = {};

	if (docs.length === 0) {
		const fallbackNode: TrashSideNavNode = {
			key: `${entry.trashId}:${entry.rootDocId || "root"}`,
			trashId: entry.trashId,
			docId: entry.rootDocId || "",
			title: entry.title || getUntitledDocumentTitle(),
			deletedAt: entry.deletedAt,
			children: [],
		};
		return {
			nodes: [fallbackNode],
			previewByKey,
		};
	}

	const docById = new Map<string, DocumentDetail>();
	docs.forEach((doc) => {
		const id = getTrashDocId(doc);
		if (id) {
			docById.set(id, doc);
		}
	});

	if (docById.size === 0) {
		const fallbackNode: TrashSideNavNode = {
			key: `${entry.trashId}:${entry.rootDocId || "root"}`,
			trashId: entry.trashId,
			docId: entry.rootDocId || "",
			title: entry.title || getUntitledDocumentTitle(),
			deletedAt: entry.deletedAt,
			children: [],
		};
		return {
			nodes: [fallbackNode],
			previewByKey,
		};
	}

	const childrenByParent = new Map<string, string[]>();
	docById.forEach((doc, docId) => {
		const rawParentId = getTrashDocParentId(doc);
		const parentId =
			rawParentId !== "root" && docById.has(rawParentId)
				? rawParentId
				: "__root__";
		const next = childrenByParent.get(parentId) ?? [];
		next.push(docId);
		childrenByParent.set(parentId, next);
	});

	const buildNode = (docId: string): TrashSideNavNode => {
		const doc = docById.get(docId);
		const mapped = mapDocumentDetail(doc ?? null, docId, options);
		const key = `${entry.trashId}:${docId}`;
		previewByKey[key] = {
			key,
			trashId: entry.trashId,
			docId,
			deletedAt: entry.deletedAt,
			deletedBy: entry.deletedBy,
			document: mapped,
		};
		const childIds = childrenByParent.get(docId) ?? [];
		return {
			key,
			trashId: entry.trashId,
			docId,
			title: mapped.title || getUntitledDocumentTitle(),
			deletedAt: entry.deletedAt,
			children: childIds.map((childId) => buildNode(childId)),
		};
	};

	const preferredRootId =
		(rootDocId && docById.has(rootDocId) ? rootDocId : "") ||
		(entry.rootDocId && docById.has(entry.rootDocId) ? entry.rootDocId : "") ||
		Array.from(docById.keys())[0];

	const rootIds = [
		preferredRootId,
		...(childrenByParent.get("__root__") ?? []),
	].filter((id, index, arr) => Boolean(id) && arr.indexOf(id) === index);

	return {
		nodes: rootIds.map((id) => buildNode(id)),
		previewByKey,
	};
}

function readDocumentLock(raw: unknown): DocumentLockInfo | null {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const record = raw as Record<string, unknown>;
	if (record.locked !== true) {
		return null;
	}
	const lockedBy = typeof record.lockedBy === "string" ? record.lockedBy : "";
	const lockedAt = typeof record.lockedAt === "string" ? record.lockedAt : "";
	return {
		locked: true,
		lockedBy,
		lockedAt,
	};
}

function mapDocumentMeta(
	data: DocumentDetail | undefined | null,
	fallbackId: string,
): DocumentMetaInfo {
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
		String(
			extraDocType || bodyType || meta.doc_type || data?.doc_type || "",
		).trim() || "document";
	const parentId = String(
		meta.parent_id ??
			(meta as { parent?: string }).parent ??
			data?.parent_id ??
			"",
	).trim();
	const lock = readDocumentLock(extra.lock);
	return {
		id,
		title,
		docType,
		parentId,
		lock,
	};
}

function mapDocumentDetail(
	data: DocumentDetail | undefined | null,
	fallbackId: string,
	options?: { markdownExtensions?: Extensions },
): DocumentData {
	const meta = mapDocumentMeta(data, fallbackId);
	const body = (data?.body ?? null) as {
		type?: unknown;
		content?: unknown;
	} | null;
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
		"type" in raw &&
		(raw as { type?: string }).type === "doc" &&
		"content" in raw &&
		Array.isArray((raw as { content?: unknown }).content)
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

function parseDisplayBoolean(
	value: string | null,
	defaultValue: boolean,
): boolean {
	if (value == null) {
		return defaultValue;
	}
	const normalized = value.trim().toLowerCase();
	if (!normalized) {
		return defaultValue;
	}
	if (
		normalized === "1" ||
		normalized === "true" ||
		normalized === "yes" ||
		normalized === "on"
	) {
		return true;
	}
	if (
		normalized === "0" ||
		normalized === "false" ||
		normalized === "no" ||
		normalized === "off"
	) {
		return false;
	}
	return defaultValue;
}

function isRootDocumentId(value: string): boolean {
	return value.trim().toLowerCase() === "root";
}

function mapFavoriteDocuments(
	items: FavoriteDocumentItem[],
): FavoriteDocument[] {
	if (!Array.isArray(items)) {
		return [];
	}

	return items
		.map((item) => ({
			docId: String(item.doc_id ?? "").trim(),
			title: String(item.title ?? "").trim() || getUntitledDocumentTitle(),
			favoritedAt: String(item.favorited_at ?? "").trim(),
		}))
		.filter((item) => item.docId);
}

function mapRecentEditedDocuments(
	items: RecentEditedDocumentItem[],
): RecentEditedDocument[] {
	if (!Array.isArray(items)) {
		return [];
	}

	return items
		.map((item) => ({
			docId: String(item.doc_id ?? "").trim(),
			title: String(item.title ?? "").trim() || getUntitledDocumentTitle(),
			editedAt: String(item.edited_at ?? "").trim(),
		}))
		.filter((item) => item.docId);
}

function formatMessageStatusLabel(status: string): string {
	const normalized = status.trim().toLowerCase();
	if (normalized === "pending") {
		return i18n.t("document.message.status.pending", { ns: "document", defaultValue: "等待中" });
	}
	if (normalized === "running") {
		return i18n.t("document.message.status.running", { ns: "document", defaultValue: "进行中" });
	}
	if (normalized === "completed") {
		return i18n.t("document.message.status.completed", { ns: "document", defaultValue: "已完成" });
	}
	if (normalized === "failed") {
		return i18n.t("document.message.status.failed", { ns: "document", defaultValue: "失败" });
	}
	return status || i18n.t("document.unknown", { ns: "document", defaultValue: "未知" });
}

function formatSyncModeLabel(syncMode: string): string {
	const normalized = syncMode.trim().toLowerCase();
	if (normalized === "remote_enabled") {
		return i18n.t("document.sync.mode.remote", { ns: "document", defaultValue: "远程优先" });
	}
	if (normalized === "local_only") {
		return i18n.t("document.sync.mode.local", { ns: "document", defaultValue: "本地优先" });
	}
	return syncMode || i18n.t("document.unknown", { ns: "document", defaultValue: "未知" });
}

function formatSyncTriggerLabel(trigger: string): string {
	const normalized = trigger.trim().toLowerCase();
	if (normalized === "sync-on-open") {
		return i18n.t("document.sync.trigger.open", { ns: "document", defaultValue: "打开文档" });
	}
	if (normalized === "record-version") {
		return i18n.t("document.sync.trigger.change", { ns: "document", defaultValue: "文档变更" });
	}
	return trigger || i18n.t("document.unknown", { ns: "document", defaultValue: "未知" });
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
	const title = metaInput.title.trim() || getUntitledDocumentTitle();
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
