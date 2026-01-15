import type { ReactNode } from "react";

export type ZeusTextNode =
  | { type: "text"; value: string }
  | { type: "ref"; kind: "doc" | "repo"; id: string; meta?: Record<string, unknown> };

export type ZeusText = {
  nodes: ZeusTextNode[];
};

const tokenRegex = /{{(doc|repo):([^}]+)}}/g;

export const parseZeusText = (raw: string): ZeusText => {
  const nodes: ZeusTextNode[] = [];
  if (!raw) {
    return { nodes: [{ type: "text", value: "" }] };
  }
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(raw)) !== null) {
    const [full, kind, id] = match;
    const start = match.index;
    if (start > lastIndex) {
      nodes.push({ type: "text", value: raw.slice(lastIndex, start) });
    }
    nodes.push({
      type: "ref",
      kind: kind === "repo" ? "repo" : "doc",
      id,
      meta: { raw: full },
    });
    lastIndex = start + full.length;
  }
  if (lastIndex < raw.length) {
    nodes.push({ type: "text", value: raw.slice(lastIndex) });
  }
  if (nodes.length === 0) {
    nodes.push({ type: "text", value: raw });
  }
  return { nodes };
};

export const stringifyZeusText = (ast: ZeusText): string => {
  return ast.nodes
    .map((node) => {
      if (node.type === "text") {
        return node.value;
      }
      return `{{${node.kind}:${node.id}}}`;
    })
    .join("");
};

export const renderZeusText = (ast: ZeusText): ReactNode => {
  return ast.nodes.map((node, index) => {
    if (node.type === "text") {
      return node.value;
    }
    if (node.kind === "doc") {
      const href = `#/knowledge?document_id=${encodeURIComponent(node.id)}`;
      return (
        <a key={`doc-${node.id}-${index}`} className="zeus-text-link" href={href}>
          {node.id}
        </a>
      );
    }
    return (
      <span key={`repo-${node.id}-${index}`} className="zeus-text-ref">
        {node.id}
      </span>
    );
  });
};
