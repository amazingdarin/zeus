import type { ReactNode } from "react";

export type ZeusTextNode =
  | { type: "text"; value: string }
  | { type: "ref"; kind: "doc" | "repo"; id: string; meta?: Record<string, unknown> };

export type ZeusText = {
  nodes: ZeusTextNode[];
};

const tokenRegex = /{{(doc|repo):([^}]+)}}/g;

const parseDocToken = (body: string) => {
  const titleIndex = body.indexOf("|title:");
  if (titleIndex < 0) {
    return { id: body.trim(), title: "" };
  }
  const id = body.slice(0, titleIndex).trim();
  const title = body.slice(titleIndex + 7).trim();
  return { id, title };
};

export const parseZeusText = (raw: string): ZeusText => {
  const nodes: ZeusTextNode[] = [];
  if (!raw) {
    return { nodes: [{ type: "text", value: "" }] };
  }
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(raw)) !== null) {
    const [full, kind, body] = match;
    const start = match.index;
    if (start > lastIndex) {
      nodes.push({ type: "text", value: raw.slice(lastIndex, start) });
    }
    if (kind === "doc") {
      const { id, title } = parseDocToken(body);
      if (id) {
        nodes.push({
          type: "ref",
          kind: "doc",
          id,
          meta: { raw: full, title: title || undefined },
        });
      }
      lastIndex = start + full.length;
      continue;
    }
    nodes.push({
      type: "ref",
      kind: kind === "repo" ? "repo" : "doc",
      id: body,
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
      if (node.kind === "doc") {
        const title = typeof node.meta?.title === "string" ? node.meta.title : "";
        if (title) {
          return `{{${node.kind}:${node.id}|title:${title}}}`;
        }
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
      const title = typeof node.meta?.title === "string" ? node.meta.title : "";
      const href = `#/documents?document_id=${encodeURIComponent(node.id)}`;
      return (
        <a key={`doc-${node.id}-${index}`} className="zeus-text-link" href={href}>
          {title || node.id}
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
