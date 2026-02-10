/**
 * ChatPage - Independent AI Chat Page
 *
 * Full-screen chat interface using the shared useChatLogic hook.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { message, Tooltip } from "antd";
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
  SearchOutlined,
} from "@ant-design/icons";

import {
  useChatLogic,
  renderMarkdown,
  formatTime,
  type ChatArtifact,
  type SourceReference,
} from "../hooks/useChatLogic";
import MentionDropdown from "../components/MentionDropdown";
import DraftPreviewModal from "../components/DraftPreviewModal";
import SettingsModal from "../components/SettingsModal";
import IntentSelectDialog from "../components/IntentSelectDialog";
import RequiredInputDialog from "../components/RequiredInputDialog";
import ToolConfirmDialog from "../components/ToolConfirmDialog";
import SessionSidebar from "../components/SessionSidebar";
import ChatAttachmentTags from "../components/ChatAttachmentTags";
import { useProjectContext } from "../context/ProjectContext";
import {
  listSessions,
  createSession,
  deleteSession as apiDeleteSession,
  renameSession as apiRenameSession,
  type ChatSessionInfo,
} from "../api/chat-sessions";

function ChatPage() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const prevIsGeneratingRef = useRef(false);

  const { currentProject } = useProjectContext();
  const chatProjectKey = currentProject?.key ?? "";

  // Load sessions on mount / project change
  const loadSessions = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!chatProjectKey) { setSessions([]); setSessionsLoading(false); return; }
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
      // Auto-select the most recent session, or create one
      if (sorted.length > 0) {
        if (!activeSessionId || !sorted.find((s) => s.id === activeSessionId)) {
          setActiveSessionId(sorted[0].id);
        }
      } else {
        const session = await createSession(chatProjectKey);
        setSessions([session]);
        setActiveSessionId(session.id);
      }
    } catch {
      setSessions([]);
    } finally {
      if (!silent) setSessionsLoading(false);
    }
  }, [chatProjectKey, activeSessionId]);

  useEffect(() => { loadSessions(); }, [chatProjectKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const handleNewSessionFromDrawer = useCallback(async () => {
    if (!chatProjectKey) return;
    try {
      const session = await createSession(chatProjectKey);
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    } catch {
      message.error("创建对话失败");
    }
  }, [chatProjectKey]);

  const handleDeleteSession = useCallback(async (id: string) => {
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
      message.error("删除对话失败");
    }
  }, [chatProjectKey, activeSessionId]);

  const handleRenameSession = useCallback(async (id: string, title: string) => {
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
      message.error("重命名失败");
    }
  }, [chatProjectKey]);

  const {
    messages,
    input,
    isGenerating,
    deepSearchEnabled,
    error,
    assistantBuffer,
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
    handleSend,
    handleStop,
    handleClearHistory,
    handleNewSession,
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
    handleProvideRequiredInput,
    pendingTool,
    pendingIntentInfo,
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

  // After a response finishes generating, refresh the session list so ordering/title stay in sync.
  useEffect(() => {
    const prev = prevIsGeneratingRef.current;
    prevIsGeneratingRef.current = isGenerating;
    if (prev && !isGenerating) {
      loadSessions({ silent: true });
    }
  }, [isGenerating, loadSessions]);

  // Focus input on mount
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
              <div key={`${artifact.type}-${index}`} className="chat-page-artifact">
                <div className="chat-page-artifact-title">
                  📄 {artifact.title || "相关文档"}
                </div>
                <div className="chat-page-artifact-list">
                  {items.map((item, i) => (
                    <button
                      key={`${item.id || i}`}
                      type="button"
                      className="chat-page-artifact-link"
                      onClick={() => handleDocumentNavigate(String(item.id ?? ""), {})}
                    >
                      {String(item.title ?? item.id ?? "文档")}
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
              <div key={`${artifact.type}-${index}`} className="chat-page-artifact">
                <div className="chat-page-artifact-title">
                  📝 {artifact.title || "修改建议"}
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
              ? (artifact.data?.actions as Array<{ type?: string; label?: string }>)
              : [];
            return (
              <div key={`${artifact.type}-${index}`} className="chat-page-artifact">
                <div className="chat-page-artifact-title">
                  📝 {artifact.title || "修改建议"}
                </div>
                <div className="chat-page-artifact-list">
                  {items.map((item, i) => (
                    <div key={`${item.doc_id || i}`} className="chat-page-artifact-row">
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
                        {String(item.title ?? item.doc_id ?? "文档")}
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
                            {action.label ?? action.type ?? "操作"}
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
            <div key={`${artifact.type}-${index}`} className="chat-page-artifact">
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
    const kbDocGroups = new Map<string, { title: string; blocks: typeof kbSources }>();
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
          <span className="chat-sources-icon">{webSources.length > 0 ? "🔍" : "📚"}</span>
          <span className="chat-sources-label">
            引用了 {totalLabel.join("、")}
          </span>
          <span className={`chat-sources-arrow ${isExpanded ? "expanded" : ""}`}>
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
                  onClick={() => docId !== "unknown" && handleDocumentNavigate(docId, {})}
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
                        docId !== "unknown" && handleDocumentNavigate(docId, { blockId: block.blockId });
                      }}
                    >
                      {block.blockId && (
                        <span className="chat-source-block-hint">
                          #{block.blockId.slice(0, 8)}
                        </span>
                      )}
                      <span className="chat-source-block-snippet">{block.snippet}</span>
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

      {/* Required Input Dialog */}
      <RequiredInputDialog
        visible={!!pendingRequiredInput}
        projectKey={projectKey}
        pendingInput={pendingRequiredInput}
        onSubmit={handleProvideRequiredInput}
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

          <div className="chat-page-sidebar-collapsed" aria-hidden={sidebarOpen}>
            <div className="session-sidebar-collapsed">
              <Tooltip title="显示对话记录" placement="right">
                <button
                  type="button"
                  className="session-sidebar-toggle-btn"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="显示对话记录"
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
                    <span className="chat-page-session-title" title={activeSessionTitle}>
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
      <div className="chat-page-messages" ref={messagesRef}>
        {messages.length === 0 && !assistantBuffer ? (
          <div className="chat-page-empty">
            <div className="chat-page-empty-icon">
              <RobotOutlined />
            </div>
            <div className="chat-page-empty-text">有什么可以帮助你的？</div>
            <div className="chat-page-empty-hint">
              {projectKey ? `当前项目: ${projectKey}` : "请先选择一个项目"}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`chat-msg chat-msg-${msg.role}`}
              >
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
                        ? "你"
                        : msg.role === "assistant"
                          ? "AI"
                          : "系统"}
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
                  {msg.role === "assistant" && renderSources(msg.id, msg.sources)}
                </div>
              </div>
            ))}

            {/* Streaming message */}
            {assistantBuffer && (
              <div className="chat-msg chat-msg-assistant">
                <div className="chat-msg-avatar">
                  <RobotOutlined />
                </div>
                <div className="chat-msg-content">
                  <div className="chat-msg-header">
                    <span className="chat-msg-role">AI</span>
                    <span className="chat-msg-time">
                      <LoadingOutlined spin /> 思考中...
                    </span>
                  </div>
                  <div className="chat-msg-text">
                    {renderMarkdown(assistantBuffer)}
                  </div>
                </div>
              </div>
            )}

            {/* Generating indicator */}
            {isGenerating && !assistantBuffer && (
              <div className="chat-msg chat-msg-assistant">
                <div className="chat-msg-avatar">
                  <RobotOutlined />
                </div>
                <div className="chat-msg-content">
                  <div className="chat-msg-header">
                    <span className="chat-msg-role">AI</span>
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
                  {m.includeChildren ? <FolderOutlined /> : <FileTextOutlined />}
                </span>
                <span className="chat-mention-tag-text" title={m.titlePath}>
                  {m.title}
                  {m.includeChildren && "/"}
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
                  <span className="slash-command-desc">{cmd.description}</span>
                </li>
              ))}
            </ul>
            <div className="slash-command-hint">
              <span>↑↓ 选择</span>
              <span>Tab/Enter 确认</span>
              <span>Esc 取消</span>
            </div>
          </div>
        )}

        <div className="chat-page-input-wrapper">
          {/* Command Tag (inline, left of input) */}
          {selectedCommand && (
            <span className="chat-command-tag-inline">
              <span className="chat-command-tag-icon">{selectedCommand.icon}</span>
              <span className="chat-command-tag-text">{selectedCommand.command}</span>
            </span>
          )}
          <textarea
            ref={inputRef}
            className={`chat-page-textarea ${selectedCommand ? "with-command" : ""}`}
            placeholder={
              selectedCommand
                ? "输入参数..."
                : projectKey
                  ? "输入消息，@ 指定文档范围，/ 使用命令..."
                  : "请先选择项目"
            }
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={!projectKey || isGenerating}
            rows={1}
          />
          <button
            type="button"
            className={`chat-page-deep-search-btn ${deepSearchEnabled ? "active" : ""}`}
            onClick={() => setDeepSearchEnabled(!deepSearchEnabled)}
            title={deepSearchEnabled ? "关闭深度搜索" : "开启深度搜索"}
            disabled={isGenerating}
          >
            <SearchOutlined />
          </button>
          {isGenerating ? (
            <button
              type="button"
              className="chat-page-send-btn chat-page-stop-btn"
              onClick={handleStop}
              title="停止生成"
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
        </div>{/* /chat-page-main */}
      </div>{/* /chat-page-body */}
    </div>
  );
}

export default ChatPage;
