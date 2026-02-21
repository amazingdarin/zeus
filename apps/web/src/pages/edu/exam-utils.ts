import type { JSONContent } from "@tiptap/react";
import {
  normalizeEduQuestionSetAttrs,
  type EduBlankQuestionItem,
  type EduBlankSlot,
  type EduChoiceQuestionItem,
  type EduQuestionItem,
  type EduQuestionSetAttrs,
} from "@zeus/doc-editor";

import type { DocumentDetail } from "../../api/documents";

const BLANK_TOKEN_REGEX = /{{blank:([^}]+)}}/g;
const DEFAULT_QUESTION_POINTS = 1;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as UnknownRecord;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function walkNodes(node: JSONContent, visit: (node: JSONContent) => void): void {
  visit(node);
  const content = Array.isArray(node.content) ? node.content : [];
  for (const child of content) {
    walkNodes(child, visit);
  }
}

function extractDocJsonContent(raw: unknown, depth = 0): JSONContent | null {
  if (!raw || typeof raw !== "object" || depth > 8) {
    return null;
  }

  const row = raw as { type?: unknown; content?: unknown; body?: unknown };

  if (row.type === "doc" && Array.isArray(row.content)) {
    return row as JSONContent;
  }

  if (row.type === "tiptap") {
    const nested = extractDocJsonContent(row.content, depth + 1);
    if (nested) {
      return nested;
    }
  }

  if (Array.isArray(row.content)) {
    return {
      type: "doc",
      content: row.content as JSONContent[],
    };
  }

  if (row.content && typeof row.content === "object") {
    const nested = extractDocJsonContent(row.content, depth + 1);
    if (nested) {
      return nested;
    }
  }

  if (row.body && typeof row.body === "object") {
    return extractDocJsonContent(row.body, depth + 1);
  }

  return null;
}

function normalizeQuestionPoints(question: EduQuestionItem): number {
  const rawPoints = asRecord(question).points;
  const points = typeof rawPoints === "number" && Number.isFinite(rawPoints)
    ? rawPoints
    : DEFAULT_QUESTION_POINTS;
  return points > 0 ? points : 0;
}

function normalizeIdArray(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function isSameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function normalizeAnswer(value: string, caseSensitive: boolean): string {
  const trimmed = value.trim();
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

export type EduQuestionSetSnapshot = {
  blockId: string;
  index: number;
  attrs: EduQuestionSetAttrs;
};

export type FlattenedExamQuestion = {
  questionKey: string;
  setBlockId: string;
  setIndex: number;
  questionIndex: number;
  displayIndex: number;
  stem: string;
  question: EduQuestionItem;
  points: number;
};

export type ExamAttemptAnswer =
  | {
    type: "choice";
    selectedOptionIds: string[];
  }
  | {
    type: "blank";
    slotValues: Record<string, string>;
  }
  | {
    type: "essay";
    text: string;
  };

export type ExamAttemptState = Record<string, ExamAttemptAnswer>;

export type GradeQuestionResult = {
  questionKey: string;
  displayIndex: number;
  type: EduQuestionItem["type"];
  points: number;
  earnedPoints: number;
  pendingManual: boolean;
  autoGraded: boolean;
  correct?: boolean;
  reason: string;
};

export type ExamGradeSummary = {
  autoScore: number;
  autoTotal: number;
  pendingManualCount: number;
  pendingManualPoints: number;
  questionResults: GradeQuestionResult[];
};

export type BlankPromptPart =
  | {
    kind: "text";
    text: string;
  }
  | {
    kind: "blank";
    blankId: string;
    hasSlot: boolean;
    slot?: EduBlankSlot;
  };

export type BlankPromptAnalysis = {
  parts: BlankPromptPart[];
  referencedSlotIds: string[];
  unresolvedTokenIds: string[];
  orphanSlots: EduBlankSlot[];
};

export function extractEduQuestionSetsFromDocument(
  detail: DocumentDetail | null | undefined,
): EduQuestionSetSnapshot[] {
  const doc = extractDocJsonContent(detail?.body || detail?.content || null);
  if (!doc) {
    return [];
  }

  const snapshots: EduQuestionSetSnapshot[] = [];
  walkNodes(doc, (node) => {
    if (node.type !== "edu_question_set") {
      return;
    }

    const attrsRaw = asRecord(node.attrs);
    const attrs = normalizeEduQuestionSetAttrs(attrsRaw);
    const rawBlockId = normalizeString(attrsRaw.id);
    const blockId = rawBlockId || `edu-question-set-${snapshots.length + 1}`;

    snapshots.push({
      blockId,
      index: snapshots.length,
      attrs,
    });
  });

  return snapshots;
}

export function flattenExamQuestions(questionSets: EduQuestionSetSnapshot[]): FlattenedExamQuestion[] {
  const result: FlattenedExamQuestion[] = [];

  for (const questionSet of questionSets) {
    for (let questionIndex = 0; questionIndex < questionSet.attrs.questions.length; questionIndex += 1) {
      const question = questionSet.attrs.questions[questionIndex];
      const questionId = normalizeString(question.id) || `q-${questionIndex + 1}`;
      result.push({
        questionKey: `${questionSet.blockId}::${questionId}::${questionIndex}`,
        setBlockId: questionSet.blockId,
        setIndex: questionSet.index,
        questionIndex,
        displayIndex: result.length + 1,
        stem: questionSet.attrs.stem,
        question,
        points: normalizeQuestionPoints(question),
      });
    }
  }

  return result;
}

export function analyzeBlankPrompt(question: EduBlankQuestionItem): BlankPromptAnalysis {
  const prompt = question.prompt || "";
  const slotMap = new Map(question.blank.blanks.map((slot) => [slot.id, slot] as const));
  const referencedSlotIds: string[] = [];
  const unresolvedTokenIds: string[] = [];
  const parts: BlankPromptPart[] = [];

  BLANK_TOKEN_REGEX.lastIndex = 0;
  let cursor = 0;
  let match = BLANK_TOKEN_REGEX.exec(prompt);
  while (match) {
    const tokenStart = match.index;
    const tokenEnd = BLANK_TOKEN_REGEX.lastIndex;
    const blankId = normalizeString(match[1]);

    if (tokenStart > cursor) {
      parts.push({
        kind: "text",
        text: prompt.slice(cursor, tokenStart),
      });
    }

    const slot = blankId ? slotMap.get(blankId) : undefined;
    if (blankId && slot) {
      referencedSlotIds.push(blankId);
    } else if (blankId) {
      unresolvedTokenIds.push(blankId);
    }

    parts.push({
      kind: "blank",
      blankId,
      hasSlot: !!slot,
      ...(slot ? { slot } : {}),
    });

    cursor = tokenEnd;
    match = BLANK_TOKEN_REGEX.exec(prompt);
  }

  if (cursor < prompt.length) {
    parts.push({
      kind: "text",
      text: prompt.slice(cursor),
    });
  }

  const referencedSet = new Set(referencedSlotIds);
  const orphanSlots = question.blank.blanks.filter((slot) => !referencedSet.has(slot.id));

  return {
    parts,
    referencedSlotIds,
    unresolvedTokenIds,
    orphanSlots,
  };
}

export function gradeAttempt(
  questions: FlattenedExamQuestion[],
  attemptState: ExamAttemptState,
): ExamGradeSummary {
  let autoScore = 0;
  let autoTotal = 0;
  let pendingManualCount = 0;
  let pendingManualPoints = 0;
  const questionResults: GradeQuestionResult[] = [];

  for (const item of questions) {
    const answer = attemptState[item.questionKey];
    const points = item.points;

    if (item.question.type === "choice") {
      const question = item.question as EduChoiceQuestionItem;
      const validOptionIds = new Set(question.choice.options.map((option) => option.id));
      const answerKey = normalizeIdArray(
        question.choice.correctOptionIds.filter((optionId) => validOptionIds.has(optionId)),
      );

      if (answerKey.length === 0) {
        pendingManualCount += 1;
        pendingManualPoints += points;
        questionResults.push({
          questionKey: item.questionKey,
          displayIndex: item.displayIndex,
          type: item.question.type,
          points,
          earnedPoints: 0,
          pendingManual: true,
          autoGraded: false,
          reason: "缺少标准答案，已标记待人工判分",
        });
        continue;
      }

      autoTotal += points;
      const selected = answer && answer.type === "choice"
        ? normalizeIdArray(answer.selectedOptionIds.filter((optionId) => validOptionIds.has(optionId)))
        : [];
      const correct = isSameSet(selected, answerKey);
      const earnedPoints = correct ? points : 0;
      autoScore += earnedPoints;
      questionResults.push({
        questionKey: item.questionKey,
        displayIndex: item.displayIndex,
        type: item.question.type,
        points,
        earnedPoints,
        pendingManual: false,
        autoGraded: true,
        correct,
        reason: correct ? "答案正确" : "答案错误",
      });
      continue;
    }

    if (item.question.type === "blank") {
      const question = item.question as EduBlankQuestionItem;
      const slots = question.blank.blanks;
      const hasAnswerKey = slots.length > 0 && slots.every((slot) =>
        slot.acceptedAnswers.map((value) => value.trim()).filter(Boolean).length > 0,
      );

      if (!hasAnswerKey) {
        pendingManualCount += 1;
        pendingManualPoints += points;
        questionResults.push({
          questionKey: item.questionKey,
          displayIndex: item.displayIndex,
          type: item.question.type,
          points,
          earnedPoints: 0,
          pendingManual: true,
          autoGraded: false,
          reason: "填空题标准答案不完整，已标记待人工判分",
        });
        continue;
      }

      autoTotal += points;
      const slotValues = answer && answer.type === "blank" ? answer.slotValues : {};
      let correct = true;
      for (const slot of slots) {
        const caseSensitive = !!slot.caseSensitive;
        const expected = new Set(
          slot.acceptedAnswers
            .map((value) => normalizeAnswer(value, caseSensitive))
            .filter(Boolean),
        );
        const actual = normalizeAnswer(slotValues[slot.id] || "", caseSensitive);
        if (!actual || !expected.has(actual)) {
          correct = false;
          break;
        }
      }

      const earnedPoints = correct ? points : 0;
      autoScore += earnedPoints;
      questionResults.push({
        questionKey: item.questionKey,
        displayIndex: item.displayIndex,
        type: item.question.type,
        points,
        earnedPoints,
        pendingManual: false,
        autoGraded: true,
        correct,
        reason: correct ? "答案正确" : "至少一个填空答案不匹配",
      });
      continue;
    }

    pendingManualCount += 1;
    pendingManualPoints += points;
    questionResults.push({
      questionKey: item.questionKey,
      displayIndex: item.displayIndex,
      type: item.question.type,
      points,
      earnedPoints: 0,
      pendingManual: true,
      autoGraded: false,
      reason: item.question.type === "essay"
        ? "问答题需人工判分"
        : "暂不支持自动评分，需人工判分",
    });
  }

  return {
    autoScore,
    autoTotal,
    pendingManualCount,
    pendingManualPoints,
    questionResults,
  };
}
