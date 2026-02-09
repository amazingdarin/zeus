import type { JSONContent } from "@tiptap/core";

export type PptGuardResult = {
  passed: boolean;
  issues: string[];
  feedback: string;
};

const COVER_DISALLOWED_TYPES = new Set([
  "bulletList",
  "orderedList",
  "taskList",
  "codeBlock",
]);

function asArray(value: unknown): JSONContent[] {
  return Array.isArray(value) ? (value as JSONContent[]) : [];
}

function isHeadingLevel1(node: JSONContent): boolean {
  if (node.type !== "heading") return false;
  const level = (node.attrs as { level?: unknown } | undefined)?.level;
  return Number(level) === 1;
}

function walkNodes(root: JSONContent, visit: (node: JSONContent) => void): void {
  visit(root);
  const children = asArray(root.content);
  for (const child of children) {
    if (child && typeof child === "object") {
      walkNodes(child, visit);
    }
  }
}

function containsAnyType(blocks: JSONContent[], typeSet: Set<string>): boolean {
  for (const block of blocks) {
    let hit = false;
    walkNodes(block, (n) => {
      if (typeSet.has(String(n.type || ""))) {
        hit = true;
      }
    });
    if (hit) return true;
  }
  return false;
}

function countHeadingLevel1(blocks: JSONContent[]): number {
  let count = 0;
  for (const block of blocks) {
    walkNodes(block, (n) => {
      if (isHeadingLevel1(n)) count += 1;
    });
  }
  return count;
}

function splitSlides(blocks: JSONContent[]): JSONContent[][] {
  const slides: JSONContent[][] = [];
  let current: JSONContent[] = [];

  for (const block of blocks) {
    if (block?.type === "horizontalRule") {
      slides.push(current);
      current = [];
      continue;
    }
    current.push(block);
  }

  if (current.length > 0) {
    slides.push(current);
  }

  return slides;
}

export function validatePptSlideDeck(doc: JSONContent): PptGuardResult {
  const issues: string[] = [];

  const blocks = asArray(doc.content);
  const slides = splitSlides(blocks);

  if (slides.length === 0) {
    issues.push("未检测到任何页面内容（doc.content 为空）。");
  }

  // Empty slides indicate leading/consecutive horizontalRule.
  slides.forEach((slide, idx) => {
    if (slide.length === 0) {
      issues.push(`第 ${idx + 1} 页为空（检测到连续或多余的分割线）。`);
    }
  });

  for (let i = 0; i < slides.length; i++) {
    const slideIndex = i + 1;
    const slide = slides[i];
    if (!slide || slide.length === 0) continue;

    const first = slide[0];
    if (!first || !isHeadingLevel1(first)) {
      issues.push(`第 ${slideIndex} 页未以 Heading 1 开始（需要页首一级标题）。`);
    }

    const totalH1 = countHeadingLevel1(slide);
    if (totalH1 > 1) {
      issues.push(`第 ${slideIndex} 页出现多个 Heading 1（页内只允许页首一个一级标题）。`);
    }

    if (slideIndex === 1) {
      if (containsAnyType(slide, COVER_DISALLOWED_TYPES)) {
        issues.push("封面页包含正文要点（列表/任务列表/代码块），封面页只能包含标题与关键信息。");
      }
    }
  }

  const passed = issues.length === 0;
  const feedback = passed
    ? ""
    : `PPT 结构校验未通过，请修正输出并重新生成：
- 使用 horizontalRule 分隔每一页（每页末尾加分割线；最后一页可不加）。
- 每页必须以 Heading 1 开始，且页内仅允许一个 Heading 1（位于页首）。
- 封面页（第 1 页）只能包含标题 + 关键信息（推荐 table），不要包含列表/任务列表/代码块等正文要点。

问题：
${issues.map((msg, idx) => `${idx + 1}. ${msg}`).join("\n")}`;

  return { passed, issues, feedback };
}

