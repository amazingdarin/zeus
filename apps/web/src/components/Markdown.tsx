import { useMemo } from "react";
import MarkdownIt from "markdown-it";

type MarkdownVariant = "default" | "chat";

type MarkdownProps = {
  content: string;
  variant?: MarkdownVariant;
  className?: string;
};

const isExternalHref = (href: string) => href.startsWith("http://") || href.startsWith("https://");

const createMarkdownRenderer = (breaks: boolean) => {
  const md = new MarkdownIt("default", {
    html: false,
    linkify: true,
    breaks,
  });

  // Ensure external links are safe + open in new tab.
  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens: any[], idx: number, options: any, env: any, self: any) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    const href = token.attrGet("href") ?? "";
    if (isExternalHref(href)) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer");
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  // Wrap tables so they can scroll horizontally on narrow viewports.
  const defaultTableOpen =
    md.renderer.rules.table_open ??
    ((tokens: any[], idx: number, options: any, env: any, self: any) => self.renderToken(tokens, idx, options));
  const defaultTableClose =
    md.renderer.rules.table_close ??
    ((tokens: any[], idx: number, options: any, env: any, self: any) => self.renderToken(tokens, idx, options));
  md.renderer.rules.table_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    token.attrJoin("class", "zeus-markdown__table");
    return `<div class="zeus-markdown-table">${defaultTableOpen(tokens, idx, options, env, self)}`;
  };
  md.renderer.rules.table_close = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    return `${defaultTableClose(tokens, idx, options, env, self)}</div>`;
  };

  if (breaks) {
    // Avoid emitting `\n` after `<br>` to prevent leading whitespace artifacts.
    md.renderer.rules.softbreak = () => "<br />";
    md.renderer.rules.hardbreak = () => "<br />";
  }

  return md;
};

const mdDefault = createMarkdownRenderer(false);
const mdChat = createMarkdownRenderer(true);

export default function Markdown({ content, variant = "default", className }: MarkdownProps) {
  const isChat = variant === "chat";
  const wrapperClassName = [
    "zeus-markdown",
    isChat ? "zeus-markdown--chat" : null,
    className ?? null,
  ]
    .filter(Boolean)
    .join(" ");

  const html = useMemo(() => {
    const renderer = isChat ? mdChat : mdDefault;
    return renderer.render(content);
  }, [content, isChat]);

  return (
    <div
      className={wrapperClassName}
      // MarkdownIt is configured with `html: false`.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
