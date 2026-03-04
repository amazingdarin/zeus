/**
 * ChatPanel - Bottom docked chat panel
 *
 * Uses the shared useChatLogic hook for chat functionality.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent } from "react";
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
  AppstoreOutlined,
  RightOutlined,
  MessageOutlined,
  SlidersOutlined,
  PlusCircleOutlined,
  DoubleRightOutlined,
  GlobalOutlined,
  PaperClipOutlined,
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
import TaskTodoList from "./TaskTodoList";
import ThinkingTimeline from "./ThinkingTimeline";

type ChatPanelProps = {
  onOpenSettings?: () => void;
  variant?: "bottom" | "sidebar";
  defaultDocumentId?: string;
  hidden?: boolean;
  onHiddenChange?: (hidden: boolean) => void;
  showFloatingButtonWhenHidden?: boolean;
};

function ChatPanel({
  onOpenSettings,
  variant = "bottom",
  defaultDocumentId,
  hidden,
  onHiddenChange,
  showFloatingButtonWhenHidden = true,
}: ChatPanelProps) {
  const isSidebar = variant === "sidebar";
  const [isExpanded, setIsExpanded] = useState(isSidebar);
  const [internalHidden, setInternalHidden] = useState(isSidebar ? false : true);
  const [queuedQuickPrompt, setQueuedQuickPrompt] = useState<string | null>(null);
  const [panelHeight, setPanelHeight] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);
  const isHidden = typeof hidden === "boolean" ? hidden : internalHidden;
  const setHidden = (nextHidden: boolean) => {
    if (typeof hidden !== "boolean") {
      setInternalHidden(nextHidden);
    }
    onHiddenChange?.(nextHidden);
  };

  const {
    messages,
    input,
    isGenerating,
    error,
    assistantBuffer,
    thinkingSteps,
    taskTodoItems,
    deepSearchEnabled,
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
    attachmentsLoading,
    handlePaste,
    handleAddAttachmentFile,
    removeAttachment,
  } = useChatLogic({
    autoScrollEnabled: isSidebar || isExpanded,
    defaultDocumentId: isSidebar ? defaultDocumentId : undefined,
  });

  const taskTodoStorageKey = projectKey && sessionId
    ? `zeus-task-todo-expanded-${projectKey}-${sessionId}`
    : undefined;
  const hasSidebarReferences = mentions.length > 0 || attachments.length > 0 || Boolean(selectedCommand);
  const sidebarQuickActions = [
    {
      icon: <PlusCircleOutlined />,
      label: "创建自定义代理",
      badge: "新",
      prompt: "创建自定义代理",
    },
    {
      icon: <AppstoreOutlined />,
      label: "根据页面创建图表",
      badge: "新",
      prompt: "根据页面创建图表",
    },
    {
      icon: <FileTextOutlined />,
      label: "总结此页面",
      prompt: "总结此页面",
    },
    {
      icon: <MessageOutlined />,
      label: "总结页面评论",
      prompt: "总结页面评论",
    },
  ];

  const mutableInputRef = inputRef as { current: HTMLTextAreaElement | null };
  const sidebarFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSidebarQuickActionClick = useCallback((prompt: string) => {
    if (!projectKey || isGenerating) {
      return;
    }
    const normalized = prompt.trim();
    if (!normalized) {
      return;
    }
    setInput(normalized);
    setQueuedQuickPrompt(normalized);
  }, [isGenerating, projectKey, setInput]);

  useEffect(() => {
    if (!queuedQuickPrompt || isGenerating) {
      return;
    }
    if (input.trim() !== queuedQuickPrompt) {
      return;
    }
    void handleSend();
    setQueuedQuickPrompt(null);
  }, [handleSend, input, isGenerating, queuedQuickPrompt]);

  const handleSidebarFilePickClick = useCallback(() => {
    if (!projectKey || isGenerating) {
      return;
    }
    sidebarFileInputRef.current?.click();
  }, [isGenerating, projectKey]);

  const handleSidebarFileChange = useCallback((event: ReactChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }
    for (let i = 0; i < files.length; i += 1) {
      const file = files.item(i);
      if (file) {
        handleAddAttachmentFile(file);
      }
    }
    event.target.value = "";
  }, [handleAddAttachmentFile]);

  useEffect(() => {
    if (isSidebar) {
      setIsExpanded(true);
    }
  }, [isSidebar]);

  // Focus input when panel opens
  useEffect(() => {
    if (!isHidden && (isSidebar || isExpanded) && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [inputRef, isExpanded, isHidden, isSidebar]);

  // Handle resize
  useEffect(() => {
    if (isSidebar) {
      return;
    }
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
  }, [isResizing, isSidebar]);

  // Auto expand panel when sending message
  const handleSendWithExpand = async () => {
    if (!isSidebar && !isExpanded) {
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

        {showFloatingButtonWhenHidden ? (
          <button
            type="button"
            className="chat-floating-btn"
            onClick={() => setHidden(false)}
            title="打开 AI 助手"
          >
            <MessageOutlined />
            {messages.length > 0 && (
              <span className="chat-floating-badge">{messages.length}</span>
            )}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <section className={isSidebar ? "chat-dock-side" : "chat-dock-bottom"}>
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

      {/* Expanded Panel (animated open/close) */}
      <div
        className={`chat-dock-panel${isSidebar ? " chat-dock-panel-side is-expanded" : isExpanded ? " is-expanded" : " is-collapsed"}${isResizing ? " is-resizing" : ""}`}
        style={isSidebar ? undefined : { height: `${isExpanded ? panelHeight : 0}px` }}
        aria-hidden={isSidebar ? false : !isExpanded}
      >
          {!isSidebar ? (
            <div
              className="chat-dock-resize-handle"
              onMouseDown={(e) => {
                e.preventDefault();
                resizeStartRef.current = { y: e.clientY, height: panelHeight };
                setIsResizing(true);
              }}
            />
          ) : null}

          {/* Header */}
          <header className={`chat-dock-header${isSidebar ? " chat-dock-header-side" : ""}`}>
            {isSidebar ? (
              <>
                <div className="chat-dock-side-title-wrap">
                  <button type="button" className="chat-dock-side-title-btn">
                    <span className="chat-dock-side-title-text">新建 AI 对话</span>
                    <DownOutlined />
                  </button>
                </div>
                <div className="chat-dock-header-actions chat-dock-header-actions-side">
                  <button
                    type="button"
                    className="chat-dock-header-btn"
                    onClick={handleClearHistory}
                    title="新建对话"
                  >
                    <PlusCircleOutlined />
                  </button>
                  {onOpenSettings && (
                    <button
                      type="button"
                      className="chat-dock-header-btn"
                      onClick={onOpenSettings}
                      title="对话设置"
                    >
                      <SlidersOutlined />
                    </button>
                  )}
                  <button
                    type="button"
                    className="chat-dock-header-btn"
                    onClick={() => setHidden(true)}
                    title="隐藏对话栏"
                  >
                    <DoubleRightOutlined />
                  </button>
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
            {isGenerating && (
              <span className="chat-dock-status">
                <LoadingOutlined spin /> 生成中...
              </span>
            )}
          </header>

          {/* Messages */}
          <div className="chat-dock-messages" ref={messagesRef} onScroll={handleMessagesScroll}>
            {messages.length === 0 && !assistantBuffer && thinkingSteps.length === 0 ? (
              isSidebar ? (
                <div className="chat-dock-empty chat-dock-empty-side">
                  <div className="chat-dock-empty-icon">
                    <span
                      className="chat-dock-empty-icon-emoji"
                      role="img"
                      aria-label="AI 机器人"
                    >
                      🤖
                    </span>
                  </div>
                  <div className="chat-dock-empty-text">开始奇妙创作之旅</div>
                  <div className="chat-dock-side-quick-list" role="list">
                    {sidebarQuickActions.map((action) => (
                      <button
                        key={action.label}
                        className="chat-dock-side-quick-item"
                        role="listitem"
                        type="button"
                        onClick={() => handleSidebarQuickActionClick(action.prompt)}
                        disabled={!projectKey || isGenerating}
                      >
                        <span className="chat-dock-side-quick-icon">{action.icon}</span>
                        <span className="chat-dock-side-quick-label">{action.label}</span>
                        {action.badge ? (
                          <span className="chat-dock-side-quick-badge">{action.badge}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="chat-dock-empty">
                  <div className="chat-dock-empty-icon">
                    <RobotOutlined />
                  </div>
                  <div className="chat-dock-empty-text">有什么可以帮助你的？</div>
                  <div className="chat-dock-empty-hint">
                    {projectKey ? `当前项目: ${projectKey}` : "请先选择一个项目"}
                  </div>
                </div>
              )
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
                {(assistantBuffer || thinkingSteps.length > 0 || taskTodoItems.length > 0) && (
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
                        {taskTodoItems.length > 0 && (
                          <TaskTodoList
                            items={taskTodoItems}
                            loading={isGenerating}
                            storageKey={taskTodoStorageKey}
                          />
                        )}
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
                {isGenerating && !assistantBuffer && thinkingSteps.length === 0 && taskTodoItems.length === 0 && (
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
        <input
          ref={sidebarFileInputRef}
          type="file"
          multiple
          className="chat-dock-side-file-input"
          onChange={handleSidebarFileChange}
          tabIndex={-1}
          aria-hidden="true"
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
              <span>Tab/回车 确认</span>
              <span>Esc 取消</span>
            </div>
          </div>
        )}
        {isSidebar ? (
          <div className="chat-dock-side-stack">
            {hasSidebarReferences ? (
              <div className="chat-dock-side-reference-layer">
                {mentions.length > 0 && (
                  <div className="chat-mention-tags">
                    {mentions.map((m) => (
                      <span key={m.docId} className="chat-mention-tag">
                        <span className="chat-mention-tag-icon">
                          {m.kind === "plugin_template"
                            ? <AppstoreOutlined />
                            : m.includeChildren ? <FolderOutlined /> : <FileTextOutlined />}
                        </span>
                        <span className="chat-mention-tag-text" title={m.titlePath}>
                          {m.kind === "plugin_template" ? `@ppt:${m.title}` : m.title}
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
                <ChatAttachmentTags
                  attachments={attachments}
                  onRemove={removeAttachment}
                />
                {selectedCommand ? (
                  <span className="chat-dock-side-command-chip">
                    <span className="chat-command-tag-icon">{selectedCommand.icon}</span>
                    <span className="chat-command-tag-text">{selectedCommand.command}</span>
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="chat-dock-side-input-layer">
              <Input.TextArea
                ref={(instance) => {
                  mutableInputRef.current = instance?.resizableTextArea?.textArea ?? null;
                }}
                className={`chat-dock-textarea chat-dock-side-textarea-layer ${selectedCommand ? "with-command" : ""}`}
                placeholder={
                  selectedCommand
                    ? "输入参数..."
                    : projectKey
                      ? "输入消息，@ 指定文档范围，/ 选择技能..."
                      : "请先选择项目"
                }
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                disabled={!projectKey || isGenerating}
                autoSize={{ minRows: 2, maxRows: 8 }}
              />
            </div>

            <div className="chat-dock-side-function-layer">
              <button
                type="button"
                className="chat-dock-side-tool-btn"
                onClick={handleSidebarFilePickClick}
                title="添加文件"
                disabled={!projectKey || isGenerating}
              >
                <PaperClipOutlined />
              </button>
              <button
                type="button"
                className={`chat-dock-side-tool-btn chat-dock-side-web-search-btn ${deepSearchEnabled ? "active" : ""}`}
                onClick={() => setDeepSearchEnabled(!deepSearchEnabled)}
                title={deepSearchEnabled ? "关闭网络搜索" : "开启网络搜索"}
                disabled={!projectKey || isGenerating}
              >
                <GlobalOutlined />
              </button>
              <button
                type="button"
                className="chat-dock-side-model-btn"
                onClick={onOpenSettings}
                title="选择模型"
                disabled={!onOpenSettings}
              >
                <span className="chat-dock-side-model-text">
                  {llmConfig?.defaultModel || "自动"}
                </span>
                <DownOutlined />
              </button>
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
                  disabled={!canSend || attachmentsLoading}
                  title="发送消息"
                >
                  <SendOutlined />
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Mention Tags (above input) */}
            {mentions.length > 0 && (
              <div className="chat-mention-tags">
                {mentions.map((m) => (
                  <span key={m.docId} className="chat-mention-tag">
                    <span className="chat-mention-tag-icon">
                      {m.kind === "plugin_template"
                        ? <AppstoreOutlined />
                        : m.includeChildren ? <FolderOutlined /> : <FileTextOutlined />}
                    </span>
                    <span className="chat-mention-tag-text" title={m.titlePath}>
                      {m.kind === "plugin_template" ? `@ppt:${m.title}` : m.title}
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
                      ? "输入消息，@ 指定文档范围，@ppt 选择 PPT 模版..."
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
                  onClick={() => setHidden(true)}
                  title="隐藏对话框"
                >
                  <RightOutlined />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export default ChatPanel;
