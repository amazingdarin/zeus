/**
 * ChatPage - Independent AI Chat Page
 *
 * Full-screen chat interface using the shared useChatLogic hook.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Input, Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import { useAppFeedback } from "../hooks/useAppFeedback";
import {
	MenuUnfoldOutlined,
	SendOutlined,
	StopOutlined,
	RobotOutlined,
	UserOutlined,
	LoadingOutlined,
	UpOutlined,
	DownOutlined,
	CloseCircleOutlined,
	FolderOutlined,
	FileTextOutlined,
	AppstoreOutlined,
	SearchOutlined,
} from "@ant-design/icons";

import {
	useChatLogic,
	createId,
	renderMarkdown,
	formatTime,
	type ChatArtifact,
	type SourceReference,
} from "../hooks/useChatLogic";
import MentionDropdown from "../components/MentionDropdown";
import DraftPreviewModal from "../components/DraftPreviewModal";
import SettingsModal from "../components/SettingsModal";
import IntentSelectDialog from "../components/IntentSelectDialog";
import PreflightInputDialog from "../components/PreflightInputDialog";
import RequiredInputDialog from "../components/RequiredInputDialog";
import ToolConfirmDialog from "../components/ToolConfirmDialog";
import SessionSidebar from "../components/SessionSidebar";
import ChatAttachmentTags from "../components/ChatAttachmentTags";
import TaskTodoList from "../components/TaskTodoList";
import ThinkingTimeline from "../components/ThinkingTimeline";
import { useProjectContext } from "../context/ProjectContext";
import {
	listSessions,
	deleteSession as apiDeleteSession,
	renameSession as apiRenameSession,
	type ChatSessionInfo,
} from "../api/chat-sessions";

function ChatPage() {
	const { t } = useTranslation("chat");
	const { messageApi } = useAppFeedback();
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
	const [sessionsLoading, setSessionsLoading] = useState(true);
	const prevIsGeneratingRef = useRef(false);

	const { currentProject } = useProjectContext();
	const chatProjectKey = currentProject?.projectRef ?? "";

	// Load sessions on mount / project change
	const loadSessions = useCallback(
		async (options?: { silent?: boolean }) => {
			const silent = options?.silent ?? false;
			if (!chatProjectKey) {
				setSessions([]);
				setSessionsLoading(false);
				return;
			}
			try {
				if (!silent) setSessionsLoading(true);
				const list = await listSessions(chatProjectKey);
				// Ensure stable ordering even if the API contract changes
				const sorted = [...list].sort((a, b) => {
					const at = Date.parse(a.updatedAt);
					const bt = Date.parse(b.updatedAt);
					const aTime = Number.isFinite(at) ? at : 0;
					const bTime = Number.isFinite(bt) ? bt : 0;
					return bTime - aTime;
				});
				setSessions(sorted);
				// Auto-select the most recent session; if none exists, keep a local-only session ID.
				if (sorted.length > 0) {
					if (
						!activeSessionId ||
						!sorted.find((s) => s.id === activeSessionId)
					) {
						setActiveSessionId(sorted[0].id);
					}
				} else {
					if (!activeSessionId) {
						setActiveSessionId(`session-${createId()}`);
					}
				}
			} catch {
				setSessions([]);
			} finally {
				if (!silent) setSessionsLoading(false);
			}
		},
		[chatProjectKey, activeSessionId],
	);

	useEffect(() => {
		loadSessions();
	}, [chatProjectKey]); // eslint-disable-line react-hooks/exhaustive-deps

	const handleSelectSession = useCallback((id: string) => {
		setActiveSessionId(id);
	}, []);

	const handleNewSessionFromDrawer = useCallback(async () => {
		if (!chatProjectKey) return;
		setActiveSessionId(`session-${createId()}`);
	}, [chatProjectKey]);

	const handleDeleteSession = useCallback(
		async (id: string) => {
			if (!chatProjectKey) return;
			try {
				await apiDeleteSession(chatProjectKey, id);
				setSessions((prev) => prev.filter((s) => s.id !== id));
				if (activeSessionId === id) {
					// Switch to next available or create new
					setSessions((prev) => {
						const remaining = prev.filter((s) => s.id !== id);
						if (remaining.length > 0) {
							setActiveSessionId(remaining[0].id);
						} else {
							// Will be handled by creating a new one
							setActiveSessionId(null);
						}
						return remaining;
					});
				}
			} catch {
				messageApi.error(t("chat.session.deleteFailed"));
			}
		},
		[chatProjectKey, activeSessionId],
	);

	const handleRenameSession = useCallback(
		async (id: string, title: string) => {
			if (!chatProjectKey) return;
			try {
				const updated = await apiRenameSession(chatProjectKey, id, title);
				setSessions((prev) => {
					const next = prev.map((s) => (s.id === id ? updated : s));
					return next.sort((a, b) => {
						const at = Date.parse(a.updatedAt);
						const bt = Date.parse(b.updatedAt);
						const aTime = Number.isFinite(at) ? at : 0;
						const bTime = Number.isFinite(bt) ? bt : 0;
						return bTime - aTime;
					});
				});
			} catch {
				messageApi.error(t("chat.session.renameFailed"));
			}
		},
		[chatProjectKey],
	);

	const {
		messages,
		input,
		isGenerating,
		deepSearchEnabled,
		error,
		assistantBuffer,
		thinkingSteps,
		taskTodoItems,
		llmConfig,
		mentions,
		mentionState,
		pendingDraft,
		slashActive,
		slashSelectedIndex,
		selectedCommand,
		filteredSlashCommands,
		expandedSources,
		canSend,
		projectKey,
		messagesRef,
		inputRef,
		setInput,
		setError,
		setSlashSelectedIndex,
		setDeepSearchEnabled,
		handleMessagesScroll,
		handleSend,
		handleStop,
		handleClearHistory,
		handleNewSession,
		sessionId,
		handleInputChange,
		handleKeyDown,
		handleMentionSelect,
		handleMentionClose,
		handleRemoveMention,
		handleSlashSelect,
		handleDraftApplied,
		handleDraftClose,
		handleDocumentNavigate,
		handleProposalAction,
		handleConfirmTool,
		handleRejectTool,
		handleSelectIntent,
		handleProvidePreflightInput,
		handleProvideRequiredInput,
		pendingTool,
		pendingIntentInfo,
		pendingPreflightInfo,
		pendingRequiredInput,
		toggleSourcesExpanded,
		// Attachments
		attachments,
		handlePaste,
		removeAttachment,
	} = useChatLogic({
		autoScrollEnabled: true,
		sessionId: activeSessionId || undefined,
		onSessionChange: (id) => {
			setActiveSessionId(id);
			loadSessions({ silent: true });
		},
	});

	const activeSessionTitle =
		sessions.find((s) => s.id === activeSessionId)?.title ?? "";
	const taskTodoStorageKey =
		projectKey && sessionId
			? `zeus-task-todo-expanded-${projectKey}-${sessionId}`
			: undefined;

	// After a response finishes generating, refresh the session list so ordering/title stay in sync.
	useEffect(() => {
		const prev = prevIsGeneratingRef.current;
		prevIsGeneratingRef.current = isGenerating;
		if (prev && !isGenerating) {
			loadSessions({ silent: true });
		}
	}, [isGenerating, loadSessions]);

	// Focus input on mount
	const mutableInputRef = inputRef as { current: HTMLTextAreaElement | null };

	useEffect(() => {
		if (inputRef.current) {
			setTimeout(() => inputRef.current?.focus(), 100);
		}
	}, [inputRef]);

	const renderArtifacts = (artifacts?: ChatArtifact[]) => {
		if (!artifacts || artifacts.length === 0) return null;

		return (
			<div className="chat-page-artifacts">
				{artifacts.map((artifact, index) => {
					if (artifact.type === "document.list") {
						const items = Array.isArray(artifact.data?.items)
							? (artifact.data?.items as Array<{ id?: string; title?: string }>)
							: [];
						return (
							<div
								key={`${artifact.type}-${index}`}
								className="chat-page-artifact"
							>
								<div className="chat-page-artifact-title">
									📄 {artifact.title || t("chat.artifact.relatedDocs")}
								</div>
								<div className="chat-page-artifact-list">
									{items.map((item, i) => (
										<button
											key={`${item.id || i}`}
											type="button"
											className="chat-page-artifact-link"
											onClick={() =>
												handleDocumentNavigate(String(item.id ?? ""), {})
											}
										>
											{String(item.title ?? item.id ?? t("chat.artifact.document"))}
										</button>
									))}
								</div>
							</div>
						);
					}

					if (artifact.type === "document.diff") {
						const docId = String(artifact.data?.doc_id ?? "");
						const proposalId = String(artifact.data?.proposal_id ?? "");
						return (
							<div
								key={`${artifact.type}-${index}`}
								className="chat-page-artifact"
							>
								<div className="chat-page-artifact-title">
									📝 {artifact.title || t("chat.artifact.changeSuggestion")}
								</div>
								<button
									type="button"
									className="chat-page-artifact-link"
									onClick={() => handleDocumentNavigate(docId, { proposalId })}
								>
									查看修改
								</button>
							</div>
						);
					}

					if (artifact.type === "diff_list") {
						const items = Array.isArray(artifact.data?.items)
							? (artifact.data?.items as Array<{
									doc_id?: string;
									title?: string;
									proposal_id?: string;
								}>)
							: [];
						const actions = Array.isArray(artifact.data?.actions)
							? (artifact.data?.actions as Array<{
									type?: string;
									label?: string;
								}>)
							: [];
						return (
							<div
								key={`${artifact.type}-${index}`}
								className="chat-page-artifact"
							>
								<div className="chat-page-artifact-title">
									📝 {artifact.title || t("chat.artifact.changeSuggestion")}
								</div>
								<div className="chat-page-artifact-list">
									{items.map((item, i) => (
										<div
											key={`${item.doc_id || i}`}
											className="chat-page-artifact-row"
										>
											<button
												type="button"
												className="chat-page-artifact-link"
												onClick={() =>
													handleProposalAction(
														"open",
														String(item.doc_id ?? ""),
														String(item.proposal_id ?? ""),
													)
												}
											>
												{String(item.title ?? item.doc_id ?? t("chat.artifact.document"))}
											</button>
											<div className="chat-page-artifact-actions">
												{actions.map((action, j) => (
													<button
														key={`${action.type || j}`}
														type="button"
														className="chat-page-artifact-action"
														onClick={() =>
															handleProposalAction(
																String(action.type ?? "open"),
																String(item.doc_id ?? ""),
																String(item.proposal_id ?? ""),
															)
														}
													>
														{action.label ?? action.type ?? t("chat.artifact.action")}
													</button>
												))}
											</div>
										</div>
									))}
								</div>
							</div>
						);
					}

					return (
						<div
							key={`${artifact.type}-${index}`}
							className="chat-page-artifact"
						>
							<div className="chat-page-artifact-title">
								📎 {artifact.title || artifact.type}
							</div>
							<pre className="chat-page-artifact-json">
								{JSON.stringify(artifact.data ?? {}, null, 2)}
							</pre>
						</div>
					);
				})}
			</div>
		);
	};

	const renderSources = (messageId: string, sources?: SourceReference[]) => {
		if (!sources || sources.length === 0) return null;

		const isExpanded = expandedSources.has(messageId);
		const kbSources = sources.filter((s) => s.type !== "web");
		const webSources = sources.filter((s) => s.type === "web");

		// Group KB sources by document
		const kbDocGroups = new Map<
			string,
			{ title: string; blocks: typeof kbSources }
		>();
		for (const source of kbSources) {
			const key = source.docId || "unknown";
			if (!kbDocGroups.has(key)) {
				kbDocGroups.set(key, { title: source.title, blocks: [] });
			}
			kbDocGroups.get(key)!.blocks.push(source);
		}

		const totalLabel = [];
		if (kbDocGroups.size > 0) totalLabel.push(`${kbDocGroups.size} 个文档`);
		if (webSources.length > 0) totalLabel.push(`${webSources.length} 个网页`);

		return (
			<div className="chat-sources">
				<button
					type="button"
					className="chat-sources-toggle"
					onClick={() => toggleSourcesExpanded(messageId)}
				>
					<span className="chat-sources-icon">
						{webSources.length > 0 ? "🔍" : "📚"}
					</span>
					<span className="chat-sources-label">
						引用了 {totalLabel.join("、")}
					</span>
					<span
						className={`chat-sources-arrow ${isExpanded ? "expanded" : ""}`}
					>
						{isExpanded ? <DownOutlined /> : <UpOutlined />}
					</span>
				</button>
				{isExpanded && (
					<div className="chat-sources-list">
						{/* KB Sources - grouped by document */}
						{Array.from(kbDocGroups).map(([docId, group]) => (
							<div key={`kb-doc-${docId}`} className="chat-source-doc-group">
								<div
									className="chat-source-doc-header"
									onClick={() =>
										docId !== "unknown" && handleDocumentNavigate(docId, {})
									}
								>
									<span className="chat-source-type-icon">📄</span>
									<span className="chat-source-doc-title">{group.title}</span>
									<span className="chat-source-block-count">
										{group.blocks.length} 处引用
									</span>
								</div>
								<div className="chat-source-blocks">
									{group.blocks.map((block, index) => (
										<div
											key={`kb-block-${docId}-${block.blockId || index}`}
											className="chat-source-block-item"
											onClick={(e) => {
												e.stopPropagation();
												docId !== "unknown" &&
													handleDocumentNavigate(docId, {
														blockId: block.blockId,
													});
											}}
										>
											{block.blockId && (
												<span className="chat-source-block-hint">
													#{block.blockId.slice(0, 8)}
												</span>
											)}
											<span className="chat-source-block-snippet">
												{block.snippet}
											</span>
										</div>
									))}
								</div>
							</div>
						))}
						{/* Web Sources */}
						{webSources.map((source, index) => (
							<a
								key={`web-${source.url}-${index}`}
								className="chat-source-item chat-source-web"
								href={source.url}
								target="_blank"
								rel="noopener noreferrer"
								onClick={(e) => e.stopPropagation()}
							>
								<div className="chat-source-title">
									<span className="chat-source-type-icon">🌐</span>
									{source.title}
								</div>
								<div className="chat-source-snippet">{source.snippet}</div>
								<div className="chat-source-url">{source.url}</div>
							</a>
						))}
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="content-inner chat-page">
			{/* Draft Preview Modal */}
			{pendingDraft && (
				<DraftPreviewModal
					draft={pendingDraft}
					projectKey={projectKey}
					onClose={handleDraftClose}
					onApplied={handleDraftApplied}
				/>
			)}

			{/* Intent Selection Dialog */}
			<IntentSelectDialog
				visible={!!pendingIntentInfo}
				pendingIntent={pendingIntentInfo}
				onSelect={handleSelectIntent}
			/>

			{/* Tool Confirmation Dialog */}
			<ToolConfirmDialog
				visible={!!pendingTool}
				pendingTool={pendingTool}
				onConfirm={handleConfirmTool}
				onReject={handleRejectTool}
			/>

			{/* Settings Modal */}
			<SettingsModal
				isOpen={settingsOpen}
				onClose={() => setSettingsOpen(false)}
			/>

			{/* Body: Sidebar + Main */}
			<div className="chat-page-body">
				{/* Session Sidebar */}
				<div
					className={`chat-page-sidebar${sidebarOpen ? " is-open" : " is-closed"}`}
				>
					<div className="chat-page-sidebar-open" aria-hidden={!sidebarOpen}>
						<SessionSidebar
							sessions={sessions}
							activeId={activeSessionId}
							loading={sessionsLoading}
							open={sidebarOpen}
							onToggleOpen={() => setSidebarOpen((v) => !v)}
							onSelect={handleSelectSession}
							onNew={handleNewSessionFromDrawer}
							onDelete={handleDeleteSession}
							onRename={handleRenameSession}
						/>
					</div>

					<div
						className="chat-page-sidebar-collapsed"
						aria-hidden={sidebarOpen}
					>
						<div className="session-sidebar-collapsed">
							<Tooltip title={t("chat.sidebar.showHistory")} placement="right">
								<button
									type="button"
									className="session-sidebar-toggle-btn"
									onClick={() => setSidebarOpen(true)}
									aria-label={t("chat.sidebar.showHistory")}
								>
									<MenuUnfoldOutlined />
								</button>
							</Tooltip>
						</div>
					</div>
				</div>

				{/* Main Chat Area */}
				<div className="chat-page-main">
					{/* Header (match document page style) */}
					<header className="chat-page-header kb-main-header">
						<div className="chat-page-header-left">
							<div className="chat-page-title">
								<span className="chat-page-title-text">AI 助手</span>
								{activeSessionTitle ? (
									<>
										<span className="chat-page-title-sep" aria-hidden="true">
											·
										</span>
										<span
											className="chat-page-session-title"
											title={activeSessionTitle}
										>
											{activeSessionTitle}
										</span>
									</>
								) : null}
							</div>
							{llmConfig ? (
								<span className="chat-page-model">
									{llmConfig.displayName} · {llmConfig.defaultModel}
								</span>
							) : (
								<span className="chat-page-model chat-page-model-warning">
									未配置模型
								</span>
							)}
						</div>

						<div className="kb-header-menu chat-page-header-actions">
							{isGenerating ? (
								<span className="chat-page-status">
									<LoadingOutlined spin /> 生成中...
								</span>
							) : null}
						</div>
					</header>

					{/* Messages */}
					<div
						className="chat-page-messages"
						ref={messagesRef}
						onScroll={handleMessagesScroll}
					>
						{messages.length === 0 &&
						!assistantBuffer &&
						thinkingSteps.length === 0 ? (
							<div className="chat-page-empty">
								<div className="chat-page-empty-icon">
									<RobotOutlined />
								</div>
								<div className="chat-page-empty-text">{t("chat.empty.title")}</div>
								<div className="chat-page-empty-hint">
									{currentProject?.name
										? t("chat.empty.currentProject", { name: currentProject.name })
										: t("chat.empty.selectProject")}
								</div>
							</div>
						) : (
							<>
								{messages.map((msg) => (
									<div key={msg.id} className={`chat-msg chat-msg-${msg.role}`}>
										<div className="chat-msg-avatar">
											{msg.role === "user" ? (
												<UserOutlined />
											) : msg.role === "assistant" ? (
												<RobotOutlined />
											) : (
												"⚠️"
											)}
										</div>
										<div className="chat-msg-content">
											<div className="chat-msg-header">
												<span className="chat-msg-role">
													{msg.role === "user"
														? t("chat.role.you")
														: msg.role === "assistant"
															? "AI"
															: t("chat.role.system")}
												</span>
												<span className="chat-msg-time">
													{formatTime(msg.timestamp)}
												</span>
											</div>
											<div className="chat-msg-text">
												{msg.role === "assistant"
													? renderMarkdown(msg.content)
													: msg.content}
											</div>
											{renderArtifacts(msg.artifacts)}
											{msg.role === "assistant" &&
												renderSources(msg.id, msg.sources)}
										</div>
									</div>
								))}

								{/* Streaming message */}
								{(assistantBuffer ||
									thinkingSteps.length > 0 ||
									taskTodoItems.length > 0) && (
									<div className="chat-msg chat-msg-assistant">
										<div className="chat-msg-avatar">
											<RobotOutlined />
										</div>
										<div className="chat-msg-content">
											<div className="chat-msg-header">
												<span className="chat-msg-role">{t("chat.role.ai")}</span>
												<span className="chat-msg-time">
													{isGenerating ? (
														<>
															<><LoadingOutlined spin /> {t("chat.stream.thinking")}</>
														</>
													) : (
														t("chat.stream.completed")
													)}
												</span>
											</div>
											<div className="chat-msg-text chat-stream-content">
												{taskTodoItems.length > 0 && (
													<TaskTodoList
														items={taskTodoItems}
														loading={isGenerating}
														storageKey={taskTodoStorageKey}
													/>
												)}
												{thinkingSteps.length > 0 && (
													<ThinkingTimeline
														steps={thinkingSteps}
														loading={isGenerating}
													/>
												)}
												{assistantBuffer ? (
													<div className="chat-stream-answer">
														{renderMarkdown(assistantBuffer)}
													</div>
												) : null}
											</div>
										</div>
									</div>
								)}

								{pendingRequiredInput && (
									<div className="chat-msg chat-msg-assistant chat-msg-inline-input">
										<div className="chat-msg-avatar">
											<RobotOutlined />
										</div>
										<div className="chat-msg-content">
											<RequiredInputDialog
												visible={true}
												inline
												projectKey={projectKey}
												pendingInput={pendingRequiredInput}
												onSubmit={handleProvideRequiredInput}
											/>
										</div>
									</div>
								)}

								{pendingPreflightInfo && (
									<div className="chat-msg chat-msg-assistant chat-msg-inline-input">
										<div className="chat-msg-avatar">
											<RobotOutlined />
										</div>
										<div className="chat-msg-content">
											<PreflightInputDialog
												visible={true}
												inline
												projectKey={projectKey}
												pendingPreflight={pendingPreflightInfo}
												onSubmit={handleProvidePreflightInput}
											/>
										</div>
									</div>
								)}

								{/* Generating indicator */}
								{isGenerating &&
									!assistantBuffer &&
									thinkingSteps.length === 0 &&
									taskTodoItems.length === 0 && (
										<div className="chat-msg chat-msg-assistant">
											<div className="chat-msg-avatar">
												<RobotOutlined />
											</div>
											<div className="chat-msg-content">
												<div className="chat-msg-header">
													<span className="chat-msg-role">{t("chat.role.ai")}</span>
												</div>
												<div className="chat-msg-text chat-msg-typing">
													<span className="typing-dot" />
													<span className="typing-dot" />
													<span className="typing-dot" />
												</div>
											</div>
										</div>
									)}
							</>
						)}
					</div>

					{/* Error */}
					{error && (
						<div className="chat-page-error">
							{error}
							<button type="button" onClick={() => setError(null)}>
								×
							</button>
						</div>
					)}

					{/* Input Area */}
					<div className="chat-page-input-area">
						{/* Mention Tags (above input) */}
						{mentions.length > 0 && (
							<div className="chat-mention-tags">
								{mentions.map((m) => (
									<span key={m.docId} className="chat-mention-tag">
										<span className="chat-mention-tag-icon">
											{m.kind === "plugin_template" ? (
												<AppstoreOutlined />
											) : m.includeChildren ? (
												<FolderOutlined />
											) : (
												<FileTextOutlined />
											)}
										</span>
										<span className="chat-mention-tag-text" title={m.titlePath}>
											{m.kind === "plugin_template"
												? `@ppt:${m.title}`
												: m.title}
											{m.kind !== "plugin_template" && m.includeChildren && "/"}
										</span>
										<button
											type="button"
											className="chat-mention-tag-remove"
											onClick={() => handleRemoveMention(m.docId)}
										>
											<CloseCircleOutlined />
										</button>
									</span>
								))}
							</div>
						)}

						{/* Attachment Tags (above input) */}
						<ChatAttachmentTags
							attachments={attachments}
							onRemove={removeAttachment}
						/>

						{/* Mention Dropdown */}
						<MentionDropdown
							projectKey={projectKey}
							query={mentionState.query}
							visible={mentionState.active && projectKey !== ""}
							onSelect={handleMentionSelect}
							onClose={handleMentionClose}
						/>

						{/* Slash Command Dropdown */}
						{slashActive && filteredSlashCommands.length > 0 && (
							<div className="slash-command-dropdown chat-page-slash-dropdown">
								<ul className="slash-command-list">
									{filteredSlashCommands.map((cmd, index) => (
										<li
											key={cmd.command}
											className={`slash-command-item ${index === slashSelectedIndex ? "selected" : ""}`}
											onClick={() => handleSlashSelect(cmd)}
											onMouseEnter={() => setSlashSelectedIndex(index)}
										>
											<span className="slash-command-icon">{cmd.icon}</span>
											<span className="slash-command-name">{cmd.command}</span>
											<span className="slash-command-desc">
												{cmd.description}
											</span>
										</li>
									))}
								</ul>
								<div className="slash-command-hint">
									<span>↑↓ 选择</span>
									<span>Tab/回车 确认</span>
									<span>Esc 取消</span>
								</div>
							</div>
						)}

						<div className="chat-page-input-wrapper">
							{/* Command Tag (inline, left of input) */}
							{selectedCommand && (
								<span className="chat-command-tag-inline">
									<span className="chat-command-tag-icon">
										{selectedCommand.icon}
									</span>
									<span className="chat-command-tag-text">
										{selectedCommand.command}
									</span>
								</span>
							)}
							<Input.TextArea
								ref={(instance) => {
									mutableInputRef.current =
										instance?.resizableTextArea?.textArea ?? null;
								}}
								className={`chat-page-textarea ${selectedCommand ? "with-command" : ""}`}
								placeholder={
									selectedCommand
										? t("chat.input.argsPlaceholder")
										: projectKey
											? t("chat.input.messagePlaceholder")
											: t("chat.input.selectProjectPlaceholder")
								}
								value={input}
								onChange={handleInputChange}
								onKeyDown={handleKeyDown}
								onPaste={handlePaste}
								disabled={!projectKey || isGenerating}
								autoSize={{ minRows: 1, maxRows: 8 }}
							/>
							<button
								type="button"
								className={`chat-page-deep-search-btn ${deepSearchEnabled ? "active" : ""}`}
								onClick={() => setDeepSearchEnabled(!deepSearchEnabled)}
								title={deepSearchEnabled ? t("chat.deepSearch.disable") : t("chat.deepSearch.enable")}
								disabled={isGenerating}
							>
								<SearchOutlined />
							</button>
							{isGenerating ? (
								<button
									type="button"
									className="chat-page-send-btn chat-page-stop-btn"
									onClick={handleStop}
									title={t("chat.stopGenerate")}
								>
									<StopOutlined />
								</button>
							) : (
								<button
									type="button"
									className="chat-page-send-btn"
									onClick={handleSend}
									disabled={!canSend}
								>
									<SendOutlined />
								</button>
							)}
						</div>
					</div>
				</div>
				{/* /chat-page-main */}
			</div>
			{/* /chat-page-body */}
		</div>
	);
}

export default ChatPage;
