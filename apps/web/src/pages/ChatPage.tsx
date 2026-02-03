/**
 * ChatPage - Independent AI Chat Page
 *
 * Full-screen chat interface using the shared useChatLogic hook.
 */

import { useEffect, useState } from "react";
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
import ToolConfirmDialog from "../components/ToolConfirmDialog";

function ChatPage() {
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    pendingTool,
    toggleSourcesExpanded,
  } = useChatLogic({ autoScrollEnabled: true });

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

    const totalLabel = [];
    if (kbSources.length > 0) totalLabel.push(`${kbSources.length} 个文档`);
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
            {/* KB Sources */}
            {kbSources.map((source, index) => (
              <div
                key={`kb-${source.docId}-${source.blockId || ""}-${index}`}
                className="chat-source-item chat-source-kb"
                onClick={() => source.docId && handleDocumentNavigate(source.docId, { blockId: source.blockId })}
              >
                <div className="chat-source-title">
                  <span className="chat-source-type-icon">📄</span>
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
    <div className="chat-page">
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

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* Header */}
      <header className="chat-page-header">
        <div className="chat-page-header-left">
          <div className="chat-page-avatar">
            <RobotOutlined />
          </div>
          <div className="chat-page-title-group">
            <span className="chat-page-title">AI 助手</span>
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
        </div>
        <div className="chat-page-header-actions">
          <button
            type="button"
            className="chat-page-header-btn"
            onClick={() => setSettingsOpen(true)}
            title="设置"
          >
            <SettingOutlined />
          </button>
          <button
            type="button"
            className="chat-page-header-btn"
            onClick={handleClearHistory}
            title="清空对话"
          >
            <DeleteOutlined />
          </button>
        </div>
        {isGenerating && (
          <span className="chat-page-status">
            <LoadingOutlined spin /> 生成中...
          </span>
        )}
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
    </div>
  );
}

export default ChatPage;
