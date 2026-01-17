import type { ReactNode } from "react";
import type { ChatAction, ChatBlock } from "../types/chatMessage";

type BlockRendererProps = {
  blocks?: ChatBlock[];
  actions?: ChatAction[];
  onAction?: (action: ChatAction) => void;
};

function BlockRenderer({ blocks, actions, onAction }: BlockRendererProps) {
  if ((!blocks || blocks.length === 0) && (!actions || actions.length === 0)) {
    return null;
  }

  const handleAction = (action: ChatAction) => {
    if (onAction) {
      onAction(action);
    }
  };

  const renderBlock = (block: ChatBlock): ReactNode => {
    if (block.type === "doc_list") {
      return (
        <div className="chat-block">
          <div className="chat-block-title">Documents</div>
          <ul className="chat-block-list">
            {block.items.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => handleAction({
                  type: "open",
                  target: { kind: "doc", id: item.id },
                })}>
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    if (block.type === "repo_list") {
      return (
        <div className="chat-block">
          <div className="chat-block-title">Repositories</div>
          <ul className="chat-block-list">
            {block.items.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => handleAction({
                  type: "open",
                  target: { kind: "repo", id: item.id },
                })}>
                  {item.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    if (block.type === "diff_list") {
      return (
        <div className="chat-block">
          <div className="chat-block-title">Document Changes</div>
          <ul className="chat-block-list">
            {block.items.map((item) => (
              <li key={`${item.docId}-${item.proposalId ?? "current"}`}>
                <button
                  type="button"
                  onClick={() =>
                    handleAction({
                      type: "open",
                      target: {
                        kind: "diff",
                        id: item.docId,
                        proposalId: item.proposalId,
                      },
                    })
                  }
                >
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="chat-blocks">
      {blocks?.map((block, index) => (
        <div key={`${block.type}-${index}`}>{renderBlock(block)}</div>
      ))}
      {actions && actions.length > 0 ? (
        <div className="chat-actions">
          {actions.map((action, index) => (
            <button
              key={`${action.type}-${index}`}
              type="button"
              className="chat-action-button"
              onClick={() => handleAction(action)}
            >
              {action.label ?? action.type}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default BlockRenderer;
