/**
 * ChatPanel - Bottom docked chat panel
 *
 * Uses the shared useChatLogic hook for chat functionality.
 */

import { useEffect, useRef, useState } from "react";
import {
  DeleteOutlined,
  SendOutlined,
  RobotOutlined,
  UserOutlined,
  LoadingOutlined,
  SettingOutlined,
  UpOutlined,
  DownOutlined,
  CloseCircleOutlined,
  FolderOutlined,
  FileTextOutlined,
  RightOutlined,
  MessageOutlined,
} from "@ant-design/icons";

import {
  useChatLogic,
  renderMarkdown,
  formatTime,
  type ChatArtifact,
  type SourceReference,
} from "../hooks/useChatLogic";
import MentionDropdown from "./MentionDropdown";
import DraftPreviewModal from "./DraftPreviewModal";

type ChatPanelProps = {
  onOpenSettings?: () => void;
};

function ChatPanel({ onOpenSettings }: ChatPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHidden, setIsHidden] = useState(true);
  const [panelHeight, setPanelHeight] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);

  const {
    messages,
    input,
    isGenerating,
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
    setError,
    setSlashSelectedIndex,
    handleSend,
    handleClearHistory,
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
    toggleSourcesExpanded,
  } = useChatLogic({ autoScrollEnabled: isExpanded });

  // Focus input when panel opens
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isExpanded, inputRef]);

  // Handle resize
  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (event: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const delta = start.y - event.clientY;
      const nextHeight = Math.min(600, Math.max(200, start.height + delta));
      setPanelHeight(nextHeight);
    };
    const handleUp = () => {
      setIsResizing(false);
      resizeStartRef.current = null;
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isResizing]);

  // Auto expand panel when sending message
  const handleSendWithExpand = async () => {
    if (!isExpanded) {
      setIsExpanded(true);
    }
    await handleSend();
  };

  const renderArtifacts = (artifacts?: ChatArtifact[]) => {
    if (!artifacts || artifacts.length === 0) return null;

    return (
      <div className="chat-dock-artifacts">
        {artifacts.map((artifact, index) => {
          if (artifact.type === "document.list") {
            const items = Array.isArray(artifact.data?.items)
              ? (artifact.data?.items as Array<{ id?: string; title?: string }>)
              : [];
            return (
              <div key={`${artifact.type}-${index}`} className="chat-dock-artifact">
                <div className="chat-dock-artifact-title">
                  📄 {artifact.title || "相关文档"}
                </div>
                <div className="chat-dock-artifact-list">
                  {items.map((item, i) => (
                    <button
                      key={`${item.id || i}`}
                      type="button"
                      className="chat-dock-artifact-link"
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
              <div key={`${artifact.type}-${index}`} className="chat-dock-artifact">
                <div className="chat-dock-artifact-title">
                  📝 {artifact.title || "修改建议"}
                </div>
                <button
                  type="button"
                  className="chat-dock-artifact-link"
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
              <div key={`${artifact.type}-${index}`} className="chat-dock-artifact">
                <div className="chat-dock-artifact-title">
                  📝 {artifact.title || "修改建议"}
                </div>
                <div className="chat-dock-artifact-list">
                  {items.map((item, i) => (
                    <div key={`${item.doc_id || i}`} className="chat-dock-artifact-row">
                      <button
                        type="button"
                        className="chat-dock-artifact-link"
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
                      <div className="chat-dock-artifact-actions">
                        {actions.map((action, j) => (
                          <button
                            key={`${action.type || j}`}
                            type="button"
                            className="chat-dock-artifact-action"
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
            <div key={`${artifact.type}-${index}`} className="chat-dock-artifact">
              <div className="chat-dock-artifact-title">
                📎 {artifact.title || artifact.type}
              </div>
              <pre className="chat-dock-artifact-json">
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

    const isSourceExpanded = expandedSources.has(messageId);

    return (
      <div className="chat-sources">
        <button
          type="button"
          className="chat-sources-toggle"
          onClick={() => toggleSourcesExpanded(messageId)}
        >
          <span className="chat-sources-icon">📚</span>
          <span className="chat-sources-label">
            引用了 {sources.length} 个文档
          </span>
          <span className={`chat-sources-arrow ${isSourceExpanded ? "expanded" : ""}`}>
            {isSourceExpanded ? <DownOutlined /> : <UpOutlined />}
          </span>
        </button>
        {isSourceExpanded && (
          <div className="chat-sources-list">
            {sources.map((source, index) => (
              <div
                key={`${source.docId}-${source.blockId || ""}-${index}`}
                className="chat-source-item"
                onClick={() => handleDocumentNavigate(source.docId, { blockId: source.blockId })}
              >
                <div className="chat-source-title">
                  {source.title}
                  {source.blockId && (
                    <span className="chat-source-block-hint">
                      #{source.blockId.slice(0, 8)}
                    </span>
                  )}
                </div>
                <div className="chat-source-snippet">{source.snippet}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // When hidden, show floating button
  if (isHidden) {
    return (
      <>
        {/* Draft Preview Modal (still accessible when hidden) */}
        {pendingDraft && (
          <DraftPreviewModal
            draft={pendingDraft}
            projectKey={projectKey}
            onClose={handleDraftClose}
            onApplied={handleDraftApplied}
          />
        )}
        <button
          type="button"
          className="chat-floating-btn"
          onClick={() => setIsHidden(false)}
          title="打开 AI 助手"
        >
          <MessageOutlined />
          {messages.length > 0 && (
            <span className="chat-floating-badge">{messages.length}</span>
          )}
        </button>
      </>
    );
  }

  return (
    <section className="chat-dock-bottom">
      {/* Draft Preview Modal */}
      {pendingDraft && (
        <DraftPreviewModal
          draft={pendingDraft}
          projectKey={projectKey}
          onClose={handleDraftClose}
          onApplied={handleDraftApplied}
        />
      )}

      {/* Expanded Panel */}
      {isExpanded && (
        <div
          className="chat-dock-panel"
          style={{ height: `${panelHeight}px` }}
        >
          {/* Resize Handle */}
          <div
            className="chat-dock-resize-handle"
            onMouseDown={(e) => {
              e.preventDefault();
              resizeStartRef.current = { y: e.clientY, height: panelHeight };
              setIsResizing(true);
            }}
          />

          {/* Header */}
          <header className="chat-dock-header">
            <div className="chat-dock-header-left">
              <div className="chat-dock-avatar">
                <RobotOutlined />
              </div>
              <div className="chat-dock-title-group">
                <span className="chat-dock-title">AI 助手</span>
                {llmConfig ? (
                  <span className="chat-dock-model">
                    {llmConfig.displayName} · {llmConfig.defaultModel}
                  </span>
                ) : (
                  <span className="chat-dock-model chat-dock-model-warning">
                    未配置模型
                  </span>
                )}
              </div>
            </div>
            <div className="chat-dock-header-actions">
              {onOpenSettings && (
                <button
                  type="button"
                  className="chat-dock-header-btn"
                  onClick={onOpenSettings}
                  title="设置"
                >
                  <SettingOutlined />
                </button>
              )}
              <button
                type="button"
                className="chat-dock-header-btn"
                onClick={handleClearHistory}
                title="清空对话"
              >
                <DeleteOutlined />
              </button>
            </div>
            {isGenerating && (
              <span className="chat-dock-status">
                <LoadingOutlined spin /> 生成中...
              </span>
            )}
          </header>

          {/* Messages */}
          <div className="chat-dock-messages" ref={messagesRef}>
            {messages.length === 0 && !assistantBuffer ? (
              <div className="chat-dock-empty">
                <div className="chat-dock-empty-icon">
                  <RobotOutlined />
                </div>
                <div className="chat-dock-empty-text">有什么可以帮助你的？</div>
                <div className="chat-dock-empty-hint">
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
            <div className="chat-dock-error">
              {error}
              <button type="button" onClick={() => setError(null)}>
                ×
              </button>
            </div>
          )}
        </div>
      )}

      {/* Input Bar (Always visible) */}
      <div className="chat-dock-bar">
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

        {/* Mention Dropdown - positioned relative to chat-dock-bar */}
        <MentionDropdown
          projectKey={projectKey}
          query={mentionState.query}
          visible={mentionState.active && projectKey !== ""}
          onSelect={handleMentionSelect}
          onClose={handleMentionClose}
        />

        {/* Slash Command Dropdown */}
        {slashActive && filteredSlashCommands.length > 0 && (
          <div className="slash-command-dropdown">
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

        <div className="chat-dock-input-wrapper">
          {/* Command Tag (inline, left of input) */}
          {selectedCommand && (
            <span className="chat-command-tag-inline">
              <span className="chat-command-tag-icon">{selectedCommand.icon}</span>
              <span className="chat-command-tag-text">{selectedCommand.command}</span>
            </span>
          )}
          <textarea
            ref={inputRef}
            className={`chat-dock-textarea ${selectedCommand ? "with-command" : ""}`}
            placeholder={
              selectedCommand
                ? "输入参数..."
                : projectKey
                  ? "输入消息，@ 指定文档范围..."
                  : "请先选择项目"
            }
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={!projectKey || isGenerating}
            rows={1}
          />
          <div className="chat-dock-bar-actions">
            <button
              type="button"
              className="chat-dock-send-btn"
              onClick={handleSendWithExpand}
              disabled={!canSend}
            >
              {isGenerating ? <LoadingOutlined spin /> : <SendOutlined />}
            </button>
            <button
              type="button"
              className="chat-dock-toggle-btn"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? "收起" : "展开"}
            >
              {isExpanded ? <DownOutlined /> : <UpOutlined />}
            </button>
            <button
              type="button"
              className="chat-dock-hide-btn"
              onClick={() => setIsHidden(true)}
              title="隐藏对话框"
            >
              <RightOutlined />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ChatPanel;
