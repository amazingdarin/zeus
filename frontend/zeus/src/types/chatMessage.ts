export type ChatBlockDocItem = {
  id: string;
  title: string;
};

export type ChatBlockRepoItem = {
  id: string;
  name: string;
};

export type ChatBlockDiffItem = {
  docId: string;
  title: string;
  proposalId?: string;
};

export type ChatBlock =
  | { type: "doc_list"; items: ChatBlockDocItem[] }
  | { type: "repo_list"; items: ChatBlockRepoItem[] }
  | { type: "diff_list"; items: ChatBlockDiffItem[] };

export type ChatAction = {
  type: "open" | "apply" | "reject";
  target: {
    kind: "doc" | "repo" | "diff";
    id: string;
    proposalId?: string;
  };
  label?: string;
};

export type ChatMessageV2 = {
  id: string;
  role: "user" | "assistant" | "system";
  text?: string;
  zeusText?: string;
  blocks?: ChatBlock[];
  actions?: ChatAction[];
};

export const exampleMessage: ChatMessageV2 = {
  id: "msg-example",
  role: "assistant",
  text: "我修改了以下文档：",
  blocks: [
    {
      type: "diff_list",
      items: [
        {
          docId: "doc-123",
          title: "后端架构说明",
          proposalId: "proposal-001",
        },
      ],
    },
  ],
  actions: [
    {
      type: "open",
      target: { kind: "diff", id: "doc-123", proposalId: "proposal-001" },
      label: "查看变更",
    },
  ],
};
