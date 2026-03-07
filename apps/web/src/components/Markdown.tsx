import { useMemo, type MouseEvent as ReactMouseEvent } from "react";
import MarkdownIt from "markdown-it";

type MarkdownVariant = "default" | "chat";

type MarkdownProps = {
  content: string;
  variant?: MarkdownVariant;
  className?: string;
  resolveHref?: (href: string) => string;
  resolveSrc?: (src: string) => string;
  onLinkClick?: (href: string, event: MouseEvent) => boolean;
};

const isExternalHref = (href: string) => href.startsWith("http://") || href.startsWith("https://");

type RendererOptions = {
  breaks: boolean;
  resolveHref?: (href: string) => string;
  resolveSrc?: (src: string) => string;
};

const createMarkdownRenderer = ({
  breaks,
  resolveHref,
  resolveSrc,
}: RendererOptions) => {
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
    const rawHref = token.attrGet("href") ?? "";
    const resolvedHref = resolveHref ? resolveHref(rawHref) : rawHref;
    token.attrSet("href", resolvedHref);
    if (isExternalHref(resolvedHref)) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer");
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  // Resolve image sources if caller provides a resolver.
  const defaultImage =
    md.renderer.rules.image ??
    ((tokens: any[], idx: number, options: any, env: any, self: any) => self.renderToken(tokens, idx, options));
  md.renderer.rules.image = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    const rawSrc = token.attrGet("src") ?? "";
    const resolvedSrc = resolveSrc ? resolveSrc(rawSrc) : rawSrc;
    token.attrSet("src", resolvedSrc);
    return defaultImage(tokens, idx, options, env, self);
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

export default function Markdown({
  content,
  variant = "default",
  className,
  resolveHref,
  resolveSrc,
  onLinkClick,
}: MarkdownProps) {
  const isChat = variant === "chat";
  const wrapperClassName = [
    "zeus-markdown",
    isChat ? "zeus-markdown--chat" : null,
    className ?? null,
  ]
    .filter(Boolean)
    .join(" ");

  const renderer = useMemo(
    () => createMarkdownRenderer({ breaks: isChat, resolveHref, resolveSrc }),
    [isChat, resolveHref, resolveSrc],
  );

  const html = useMemo(() => {
    return renderer.render(content);
  }, [content, renderer]);

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onLinkClick) {
      return;
    }

    const element = event.target as HTMLElement | null;
    const anchor = element?.closest("a");
    if (!anchor) {
      return;
    }

    const href = anchor.getAttribute("href") ?? "";
    if (!href) {
      return;
    }

    const handled = onLinkClick(href, event.nativeEvent);
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <div
      className={wrapperClassName}
      onClick={handleClick}
      // MarkdownIt is configured with `html: false`.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
