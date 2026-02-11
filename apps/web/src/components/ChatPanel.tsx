/**
 * ChatPanel - Bottom docked chat panel
 *
 * Uses the shared useChatLogic hook for chat functionality.
 */

import { useEffect, useRef, useState } from "react";
import { Input } from "antd";
import {
  DeleteOutlined,
  SendOutlined,
  StopOutlined,
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
import IntentSelectDialog from "./IntentSelectDialog";
import PreflightInputDialog from "./PreflightInputDialog";
import RequiredInputDialog from "./RequiredInputDialog";
import ToolConfirmDialog from "./ToolConfirmDialog";
import ChatAttachmentTags from "./ChatAttachmentTags";
import ThinkingTimeline from "./ThinkingTimeline";

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
    thinkingSteps,
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
    handleStop,
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
  } = useChatLogic({ autoScrollEnabled: isExpanded });

  const mutableInputRef = inputRef as { current: HTMLTextAreaElement | null };

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
          <span className={`chat-sources-arrow ${isSourceExpanded ? "expanded" : ""}`}>
            {isSourceExpanded ? <DownOutlined /> : <UpOutlined />}
          </span>
        </button>
        {isSourceExpanded && (
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

        {/* Tool Confirmation Dialog */}
        <ToolConfirmDialog
          visible={!!pendingTool}
          pendingTool={pendingTool}
          onConfirm={handleConfirmTool}
          onReject={handleRejectTool}
        />

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

      {/* Tool Confirmation Dialog */}
      <ToolConfirmDialog
        visible={!!pendingTool}
        pendingTool={pendingTool}
        onConfirm={handleConfirmTool}
        onReject={handleRejectTool}
      />

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

      <PreflightInputDialog
        visible={!!pendingPreflightInfo}
        projectKey={projectKey}
        pendingPreflight={pendingPreflightInfo}
        onSubmit={handleProvidePreflightInput}
      />

      {/* Expanded Panel (animated open/close) */}
      <div
        className={`chat-dock-panel${isExpanded ? " is-expanded" : " is-collapsed"}${isResizing ? " is-resizing" : ""}`}
        style={{ height: `${isExpanded ? panelHeight : 0}px` }}
        aria-hidden={!isExpanded}
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
            {messages.length === 0 && !assistantBuffer && thinkingSteps.length === 0 ? (
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
                {(assistantBuffer || thinkingSteps.length > 0) && (
                  <div className="chat-msg chat-msg-assistant">
                    <div className="chat-msg-avatar">
                      <RobotOutlined />
                    </div>
                    <div className="chat-msg-content">
                      <div className="chat-msg-header">
                        <span className="chat-msg-role">AI</span>
                        <span className="chat-msg-time">
                          {isGenerating ? <><LoadingOutlined spin /> 思考中...</> : "已完成"}
                        </span>
                      </div>
                      <div className="chat-msg-text chat-stream-content">
                        {thinkingSteps.length > 0 && (
                          <ThinkingTimeline steps={thinkingSteps} loading={isGenerating} />
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

                {/* Generating indicator */}
                {isGenerating && !assistantBuffer && thinkingSteps.length === 0 && (
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

        {/* Attachment Tags (above input) */}
        <ChatAttachmentTags
          attachments={attachments}
          onRemove={removeAttachment}
        />

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
          <Input.TextArea
            ref={(instance) => {
              mutableInputRef.current = instance?.resizableTextArea?.textArea ?? null;
            }}
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
            onPaste={handlePaste}
            disabled={!projectKey || isGenerating}
            autoSize={{ minRows: 1, maxRows: 8 }}
          />
          <div className="chat-dock-bar-actions">
            {isGenerating ? (
              <button
                type="button"
                className="chat-dock-send-btn chat-dock-stop-btn"
                onClick={handleStop}
                title="停止生成"
              >
                <StopOutlined />
              </button>
            ) : (
              <button
                type="button"
                className="chat-dock-send-btn"
                onClick={handleSendWithExpand}
                disabled={!canSend}
              >
                <SendOutlined />
              </button>
            )}
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
