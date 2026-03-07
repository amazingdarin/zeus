import type { JSONContent } from "@tiptap/core";
import {
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  type ParagraphChild,
} from "docx";

export const ORDERED_LIST_REFERENCE = "zeus-ordered-list";

export type DocxBlock = Paragraph | Table;

export type ResolveImageInput = {
  src: string;
  attrs: Record<string, unknown>;
};

export type ResolvedImage = {
  data: Buffer | Uint8Array | ArrayBuffer;
  type?: "jpg" | "png" | "gif" | "bmp";
  width?: number;
  height?: number;
  altText?: {
    name?: string;
    description?: string;
    title?: string;
  };
};

export type MapTiptapToDocxOptions = {
  resolveImage?: (input: ResolveImageInput) => Promise<ResolvedImage | null>;
  maxImageWidth?: number;
  onImageEmbedded?: (src: string) => void;
  onImageFallback?: (src: string) => void;
};

export type MappedDocxBlocks = {
  blocks: DocxBlock[];
  usesOrderedList: boolean;
  unsupportedNodeTypes: string[];
};

type ListKind = "bullet" | "ordered";

type MapContext = {
  resolveImage?: (input: ResolveImageInput) => Promise<ResolvedImage | null>;
  maxImageWidth: number;
  usesOrderedList: boolean;
  unsupportedNodeTypes: Set<string>;
  onImageEmbedded?: (src: string) => void;
  onImageFallback?: (src: string) => void;
};

const HEADING_BY_LEVEL: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

export async function mapTiptapToDocxBlocks(
  tiptapDoc: JSONContent,
  options: MapTiptapToDocxOptions = {},
): Promise<MappedDocxBlocks> {
  const ctx: MapContext = {
    resolveImage: options.resolveImage,
    maxImageWidth: Number.isFinite(options.maxImageWidth) && (options.maxImageWidth ?? 0) > 0
      ? Math.floor(options.maxImageWidth as number)
      : 560,
    usesOrderedList: false,
    unsupportedNodeTypes: new Set<string>(),
    onImageEmbedded: options.onImageEmbedded,
    onImageFallback: options.onImageFallback,
  };

  const root = normalizeDocNode(tiptapDoc);
  const nodes = Array.isArray(root.content) ? root.content : [];
  const blocks: DocxBlock[] = [];

  for (const node of nodes) {
    blocks.push(...(await mapBlockNode(node, ctx)));
  }

  return {
    blocks,
    usesOrderedList: ctx.usesOrderedList,
    unsupportedNodeTypes: Array.from(ctx.unsupportedNodeTypes),
  };
}

function normalizeDocNode(input: JSONContent): JSONContent {
  if (input && input.type === "doc" && Array.isArray(input.content)) {
    return input;
  }
  if (Array.isArray(input?.content)) {
    return { type: "doc", content: input.content };
  }
  return { type: "doc", content: [] };
}

async function mapBlockNode(node: JSONContent, ctx: MapContext): Promise<DocxBlock[]> {
  const type = String(node?.type || "").trim();

  switch (type) {
    case "heading":
      return [await mapHeadingNode(node, ctx)];
    case "paragraph":
      return [await mapParagraphNode(node, ctx)];
    case "bulletList":
      return await mapListNode(node, "bullet", 0, ctx);
    case "orderedList":
      ctx.usesOrderedList = true;
      return await mapListNode(node, "ordered", 0, ctx);
    case "table":
      return [await mapTableNode(node, ctx)];
    case "codeBlock":
      return [mapCodeBlockNode(node)];
    case "blockquote":
      return await mapBlockQuoteNode(node, ctx);
    case "horizontalRule":
      return [new Paragraph({ thematicBreak: true, spacing: { before: 120, after: 120 } })];
    case "image":
    case "imageUpload":
      return [await mapStandaloneImageNode(node, ctx)];
    case "text":
      return [new Paragraph({ children: await mapInlineNodes([node], ctx) })];
    default:
      if (type) {
        ctx.unsupportedNodeTypes.add(type);
      }
      return [fallbackUnsupportedNode(node)];
  }
}

async function mapHeadingNode(node: JSONContent, ctx: MapContext): Promise<Paragraph> {
  const attrs = toRecord(node.attrs);
  const levelRaw = Number(attrs.level ?? 1);
  const level = Number.isFinite(levelRaw) ? Math.min(6, Math.max(1, Math.floor(levelRaw))) : 1;
  const children = await mapInlineNodes(node.content, ctx);

  return new Paragraph({
    heading: HEADING_BY_LEVEL[level] || HeadingLevel.HEADING_1,
    children: children.length > 0 ? children : [new TextRun("")],
  });
}

async function mapParagraphNode(
  node: JSONContent,
  ctx: MapContext,
  list?: { kind: ListKind; level: number },
): Promise<Paragraph> {
  const children = await mapInlineNodes(node.content, ctx);
  const level = Math.min(8, Math.max(0, list?.level ?? 0));

  return new Paragraph({
    children: children.length > 0 ? children : [new TextRun("")],
    bullet: list?.kind === "bullet" ? { level } : undefined,
    numbering: list?.kind === "ordered"
      ? { reference: ORDERED_LIST_REFERENCE, level }
      : undefined,
  });
}

async function mapListNode(
  node: JSONContent,
  kind: ListKind,
  level: number,
  ctx: MapContext,
): Promise<Paragraph[]> {
  const items = Array.isArray(node.content) ? node.content : [];
  const result: Paragraph[] = [];

  for (const item of items) {
    if (item?.type !== "listItem") {
      continue;
    }

    const children = Array.isArray(item.content) ? item.content : [];
    let hasParagraphContent = false;

    for (const child of children) {
      if (child?.type === "paragraph") {
        hasParagraphContent = true;
        result.push(await mapParagraphNode(child, ctx, { kind, level }));
        continue;
      }
      if (child?.type === "bulletList") {
        result.push(...(await mapListNode(child, "bullet", level + 1, ctx)));
        continue;
      }
      if (child?.type === "orderedList") {
        ctx.usesOrderedList = true;
        result.push(...(await mapListNode(child, "ordered", level + 1, ctx)));
        continue;
      }
      if (child?.type === "text") {
        hasParagraphContent = true;
        result.push(await mapParagraphNode({ type: "paragraph", content: [child] }, ctx, { kind, level }));
        continue;
      }

      const mapped = await mapBlockNode(child, ctx);
      for (const block of mapped) {
        if (block instanceof Paragraph) {
          result.push(block);
        }
      }
    }

    if (!hasParagraphContent) {
      result.push(
        new Paragraph({
          children: [new TextRun(extractNodeText(item) || "列表项")],
          bullet: kind === "bullet" ? { level } : undefined,
          numbering: kind === "ordered" ? { reference: ORDERED_LIST_REFERENCE, level } : undefined,
        }),
      );
    }
  }

  return result;
}

async function mapTableNode(node: JSONContent, ctx: MapContext): Promise<Table> {
  const rows = Array.isArray(node.content) ? node.content : [];
  const mappedRows: TableRow[] = [];

  for (const rowNode of rows) {
    if (rowNode?.type !== "tableRow") {
      continue;
    }
    const cells = Array.isArray(rowNode.content) ? rowNode.content : [];
    const mappedCells: TableCell[] = [];

    for (const cellNode of cells) {
      if (cellNode?.type !== "tableCell" && cellNode?.type !== "tableHeader") {
        continue;
      }
      mappedCells.push(await mapTableCellNode(cellNode, ctx));
    }

    if (mappedCells.length === 0) {
      mappedCells.push(new TableCell({ children: [new Paragraph("")] }));
    }

    mappedRows.push(new TableRow({ children: mappedCells }));
  }

  if (mappedRows.length === 0) {
    mappedRows.push(
      new TableRow({
        children: [new TableCell({ children: [new Paragraph("")] })],
      }),
    );
  }

  return new Table({
    rows: mappedRows,
    width: { size: 100, type: "pct" },
  });
}

async function mapTableCellNode(node: JSONContent, ctx: MapContext): Promise<TableCell> {
  const children = Array.isArray(node.content) ? node.content : [];
  const mappedChildren: Array<Paragraph | Table> = [];

  for (const child of children) {
    const blocks = await mapBlockNode(child, ctx);
    for (const block of blocks) {
      mappedChildren.push(block);
    }
  }

  if (mappedChildren.length === 0) {
    mappedChildren.push(new Paragraph(""));
  }

  return new TableCell({
    children: mappedChildren,
    shading: node.type === "tableHeader" ? { fill: "F2F2F2", color: "auto" } : undefined,
  });
}

function mapCodeBlockNode(node: JSONContent): Paragraph {
  const code = extractNodeText(node);
  const lines = code.split(/\r?\n/);
  const children: ParagraphChild[] = [];

  lines.forEach((line, idx) => {
    children.push(new TextRun({ text: line, font: "Consolas" }));
    if (idx < lines.length - 1) {
      children.push(new TextRun({ text: "", break: 1 }));
    }
  });

  return new Paragraph({
    children: children.length > 0 ? children : [new TextRun("")],
    spacing: { before: 120, after: 120 },
    shading: { fill: "F5F5F5", color: "auto" },
    border: {
      top: { style: BorderStyle.SINGLE, color: "D9D9D9", size: 4 },
      right: { style: BorderStyle.SINGLE, color: "D9D9D9", size: 4 },
      bottom: { style: BorderStyle.SINGLE, color: "D9D9D9", size: 4 },
      left: { style: BorderStyle.SINGLE, color: "D9D9D9", size: 4 },
    },
  });
}

async function mapBlockQuoteNode(node: JSONContent, ctx: MapContext): Promise<Paragraph[]> {
  const children = Array.isArray(node.content) ? node.content : [];
  const paragraphs: Paragraph[] = [];

  for (const child of children) {
    if (child?.type !== "paragraph") {
      continue;
    }
    const runs = await mapInlineNodes(child.content, ctx);
    paragraphs.push(
      new Paragraph({
        children: runs.length > 0 ? runs : [new TextRun("")],
        indent: { left: 320 },
        spacing: { before: 80, after: 80 },
        border: {
          left: { style: BorderStyle.SINGLE, color: "A0A0A0", size: 6, space: 4 },
        },
      }),
    );
  }

  if (paragraphs.length === 0) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun(extractNodeText(node) || "引用")],
        indent: { left: 320 },
        border: {
          left: { style: BorderStyle.SINGLE, color: "A0A0A0", size: 6, space: 4 },
        },
      }),
    );
  }

  return paragraphs;
}

async function mapStandaloneImageNode(node: JSONContent, ctx: MapContext): Promise<Paragraph> {
  const attrs = toRecord(node.attrs);
  const src = String(attrs.src ?? "").trim();
  const run = await mapImageRun(attrs, src, ctx);

  if (!run) {
    if (src) {
      ctx.onImageFallback?.(src);
    }
    return new Paragraph({
      children: [new TextRun(src ? `[image] ${src}` : "[image]")],
    });
  }

  return new Paragraph({
    children: [run],
    alignment: AlignmentType.CENTER,
  });
}

async function mapInlineNodes(content: JSONContent[] | undefined, ctx: MapContext): Promise<ParagraphChild[]> {
  if (!Array.isArray(content) || content.length === 0) {
    return [];
  }

  const out: ParagraphChild[] = [];
  for (const node of content) {
    out.push(...(await mapInlineNode(node, ctx)));
  }
  return out;
}

async function mapInlineNode(node: JSONContent, ctx: MapContext): Promise<ParagraphChild[]> {
  const type = String(node?.type || "").trim();

  if (type === "text") {
    const text = String(node.text ?? "");
    if (!text) {
      return [];
    }

    const marks = Array.isArray(node.marks) ? node.marks : [];
    const runOptions: Record<string, unknown> = { text };
    let linkHref = "";

    for (const mark of marks) {
      const markType = String(mark?.type || "").trim();
      const markAttrs = toRecord(mark?.attrs);
      switch (markType) {
        case "bold":
          runOptions.bold = true;
          break;
        case "italic":
          runOptions.italics = true;
          break;
        case "underline":
          runOptions.underline = { type: UnderlineType.SINGLE };
          break;
        case "strike":
          runOptions.strike = true;
          break;
        case "code":
          runOptions.font = "Consolas";
          runOptions.shading = { fill: "F1F1F1", color: "auto" };
          break;
        case "textStyle": {
          const hex = normalizeHexColor(markAttrs.color);
          if (hex) {
            runOptions.color = hex;
          }
          break;
        }
        case "link": {
          const href = String(markAttrs.href ?? "").trim();
          if (href) {
            linkHref = href;
          }
          break;
        }
        default:
          break;
      }
    }

    const run = new TextRun(runOptions);
    if (linkHref) {
      return [new ExternalHyperlink({ link: linkHref, children: [run] })];
    }
    return [run];
  }

  if (type === "hardBreak") {
    return [new TextRun({ text: "", break: 1 })];
  }

  if (type === "image" || type === "imageUpload") {
    const attrs = toRecord(node.attrs);
    const src = String(attrs.src ?? "").trim();
    const image = await mapImageRun(attrs, src, ctx);
    if (!image) {
      if (src) {
        ctx.onImageFallback?.(src);
      }
      return src ? [new TextRun(`[image] ${src}`)] : [];
    }
    return [image];
  }

  if (Array.isArray(node.content) && node.content.length > 0) {
    return await mapInlineNodes(node.content, ctx);
  }

  return [];
}

async function mapImageRun(
  attrs: Record<string, unknown>,
  src: string,
  ctx: MapContext,
): Promise<ImageRun | null> {
  if (!ctx.resolveImage || !src) {
    return null;
  }

  const resolved = await ctx.resolveImage({ src, attrs });
  if (!resolved || !resolved.data) {
    return null;
  }

  const width = toPositiveInt(attrs.width) ?? toPositiveInt(resolved.width) ?? 480;
  const height = toPositiveInt(attrs.height) ?? toPositiveInt(resolved.height) ?? 320;
  const final = fitImageSize(width, height, ctx.maxImageWidth);
  const imageType = normalizeImageType(resolved.type) ?? inferImageTypeFromSource(src) ?? "png";
  const altText = {
    name: String(resolved.altText?.name ?? attrs.title ?? attrs.alt ?? "image"),
    description: String(resolved.altText?.description ?? attrs.alt ?? ""),
    title: String(resolved.altText?.title ?? attrs.title ?? ""),
  };
  const image = new ImageRun({
    type: imageType,
    data: resolved.data,
    transformation: {
      width: final.width,
      height: final.height,
    },
    altText,
  });
  ctx.onImageEmbedded?.(src);
  return image;
}

function fitImageSize(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: Math.max(1, maxWidth), height: Math.max(1, Math.floor(maxWidth * 0.65)) };
  }

  if (width <= maxWidth) {
    return { width, height };
  }

  const ratio = maxWidth / width;
  return {
    width: Math.max(1, Math.floor(width * ratio)),
    height: Math.max(1, Math.floor(height * ratio)),
  };
}

function fallbackUnsupportedNode(node: JSONContent): Paragraph {
  const type = String(node?.type || "unknown");
  const text = extractNodeText(node);
  const label = text ? `[unsupported:${type}] ${text}` : `[unsupported:${type}]`;
  return new Paragraph({ children: [new TextRun(label)] });
}

function extractNodeText(node: JSONContent | undefined): string {
  if (!node || typeof node !== "object") {
    return "";
  }
  const own = typeof node.text === "string" ? node.text : "";
  const children = Array.isArray(node.content)
    ? node.content.map((child) => extractNodeText(child)).filter(Boolean)
    : [];
  return [own, ...children].filter(Boolean).join("").trim();
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.floor(n);
}

function normalizeHexColor(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }
  return normalized.toUpperCase();
}

function normalizeImageType(value: unknown): "jpg" | "png" | "gif" | "bmp" | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "jpg" || raw === "jpeg") {
    return "jpg";
  }
  if (raw === "png" || raw === "gif" || raw === "bmp") {
    return raw;
  }
  return null;
}

function inferImageTypeFromSource(src: string): "jpg" | "png" | "gif" | "bmp" | null {
  const lower = src.trim().toLowerCase();
  if (!lower) {
    return null;
  }
  if (lower.startsWith("data:image/")) {
    if (lower.startsWith("data:image/jpeg") || lower.startsWith("data:image/jpg")) {
      return "jpg";
    }
    if (lower.startsWith("data:image/png")) {
      return "png";
    }
    if (lower.startsWith("data:image/gif")) {
      return "gif";
    }
    if (lower.startsWith("data:image/bmp")) {
      return "bmp";
    }
  }
  if (lower.endsWith(".jpeg") || lower.endsWith(".jpg")) {
    return "jpg";
  }
  if (lower.endsWith(".png")) {
    return "png";
  }
  if (lower.endsWith(".gif")) {
    return "gif";
  }
  if (lower.endsWith(".bmp")) {
    return "bmp";
  }
  return null;
}
