/**
 * Tiptap to Slides Converter
 *
 * Converts Tiptap JSON documents (with horizontalRule separators)
 * into SlideContent arrays for PPT generation.
 */

import type { JSONContent } from "@tiptap/core";
import type { SlideContent } from "./types.js";

/**
 * Tiptap node types we handle
 */
type TiptapNodeType =
  | "doc"
  | "paragraph"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "listItem"
  | "taskList"
  | "taskItem"
  | "blockquote"
  | "codeBlock"
  | "horizontalRule"
  | "image"
  | "text"
  | "hardBreak";

/**
 * Extract plain text from a Tiptap node
 */
function extractText(node: JSONContent): string {
  if (node.type === "text") {
    return node.text || "";
  }

  if (node.type === "hardBreak") {
    return "\n";
  }

  if (node.content) {
    return node.content.map(extractText).join("");
  }

  return "";
}

/**
 * Extract list items from a bulletList or orderedList node
 */
function extractListItems(node: JSONContent): string[] {
  const items: string[] = [];

  if (node.content) {
    for (const item of node.content) {
      if (item.type === "listItem" || item.type === "taskItem") {
        const text = extractText(item).trim();
        if (text) {
          // For task items, add checkbox indicator
          if (item.type === "taskItem") {
            const checked = item.attrs?.checked ? "✓" : "○";
            items.push(`${checked} ${text}`);
          } else {
            items.push(text);
          }
        }
      }
    }
  }

  return items;
}

/**
 * Extract code block content
 */
function extractCodeBlock(node: JSONContent): { language: string; code: string } | null {
  if (node.type !== "codeBlock") {
    return null;
  }

  const language = (node.attrs?.language as string) || "text";
  const code = extractText(node);

  return { language, code };
}

/**
 * Extract image URL from image node
 */
function extractImage(node: JSONContent): string | null {
  if (node.type !== "image") {
    return null;
  }

  return (node.attrs?.src as string) || null;
}

/**
 * Process a group of nodes (between horizontalRules) into a SlideContent
 */
function processSlideNodes(nodes: JSONContent[], slideIndex: number): SlideContent {
  const slide: SlideContent = {
    index: slideIndex,
    bullets: [],
    paragraphs: [],
    codeBlocks: [],
    images: [],
  };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    switch (node.type as TiptapNodeType) {
      case "heading": {
        const level = (node.attrs?.level as number) || 1;
        const text = extractText(node).trim();

        if (level === 1 && !slide.title) {
          slide.title = text;
        } else if (level === 2 && !slide.subtitle && slide.title) {
          slide.subtitle = text;
        } else if (level === 2 && !slide.title) {
          slide.title = text;
        } else {
          // Treat other headings as paragraph content
          slide.paragraphs!.push(`${"#".repeat(level)} ${text}`);
        }
        break;
      }

      case "paragraph": {
        const text = extractText(node).trim();
        if (text) {
          slide.paragraphs!.push(text);
        }
        break;
      }

      case "bulletList":
      case "orderedList":
      case "taskList": {
        const items = extractListItems(node);
        slide.bullets!.push(...items);
        break;
      }

      case "blockquote": {
        const text = extractText(node).trim();
        if (text) {
          slide.paragraphs!.push(`> ${text}`);
        }
        break;
      }

      case "codeBlock": {
        const codeBlock = extractCodeBlock(node);
        if (codeBlock) {
          slide.codeBlocks!.push(codeBlock);
        }
        break;
      }

      case "image": {
        const imageUrl = extractImage(node);
        if (imageUrl) {
          slide.images!.push(imageUrl);
        }
        break;
      }

      // Skip other node types
      default:
        break;
    }
  }

  // Clean up empty arrays
  if (slide.bullets!.length === 0) delete slide.bullets;
  if (slide.paragraphs!.length === 0) delete slide.paragraphs;
  if (slide.codeBlocks!.length === 0) delete slide.codeBlocks;
  if (slide.images!.length === 0) delete slide.images;

  return slide;
}

/**
 * Convert a Tiptap document to SlideContent array
 *
 * The document should contain horizontalRule nodes as page separators.
 * Content between horizontalRules becomes individual slides.
 */
export function convertTiptapToSlides(doc: JSONContent): SlideContent[] {
  if (doc.type !== "doc" || !doc.content) {
    throw new Error("Invalid Tiptap document: expected doc type with content");
  }

  const slides: SlideContent[] = [];
  let currentSlideNodes: JSONContent[] = [];
  let slideIndex = 0;

  for (const node of doc.content) {
    if (node.type === "horizontalRule") {
      // End current slide and start a new one
      if (currentSlideNodes.length > 0) {
        slides.push(processSlideNodes(currentSlideNodes, slideIndex));
        slideIndex++;
        currentSlideNodes = [];
      }
    } else {
      currentSlideNodes.push(node);
    }
  }

  // Process the last slide (after the last horizontalRule or if no rules exist)
  if (currentSlideNodes.length > 0) {
    slides.push(processSlideNodes(currentSlideNodes, slideIndex));
  }

  return slides;
}

/**
 * Validate that a document is suitable for PPT conversion
 */
export function validatePPTDocument(doc: JSONContent): {
  valid: boolean;
  errors: string[];
  slideCount: number;
} {
  const errors: string[] = [];

  if (doc.type !== "doc") {
    errors.push("Document must have type 'doc'");
    return { valid: false, errors, slideCount: 0 };
  }

  if (!doc.content || doc.content.length === 0) {
    errors.push("Document is empty");
    return { valid: false, errors, slideCount: 0 };
  }

  // Count horizontalRules to determine slide count
  let hrCount = 0;
  for (const node of doc.content) {
    if (node.type === "horizontalRule") {
      hrCount++;
    }
  }

  // Slide count is hrCount + 1 (content before/between/after rules)
  const slideCount = hrCount + 1;

  if (slideCount < 1) {
    errors.push("Document must have at least one slide of content");
  }

  if (slideCount > 100) {
    errors.push("Document has too many slides (maximum 100)");
  }

  return {
    valid: errors.length === 0,
    errors,
    slideCount,
  };
}

/**
 * Generate a title slide from document metadata
 */
export function createTitleSlide(
  title: string,
  subtitle?: string,
  author?: string
): SlideContent {
  const slide: SlideContent = {
    index: 0,
    title,
  };

  if (subtitle) {
    slide.subtitle = subtitle;
  }

  if (author) {
    slide.paragraphs = [author];
  }

  return slide;
}

/**
 * Add slide numbers to an array of slides
 */
export function addSlideNumbers(slides: SlideContent[]): SlideContent[] {
  return slides.map((slide, index) => ({
    ...slide,
    index,
  }));
}
