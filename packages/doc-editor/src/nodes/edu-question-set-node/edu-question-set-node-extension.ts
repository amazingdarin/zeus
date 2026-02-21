import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { EduQuestionSetNodeView } from "./edu-question-set-node"

export type EduDifficulty = "easy" | "medium" | "hard"
export type EduQuestionType = "choice" | "blank" | "essay"
export type EduChoiceSelectionMode = "single" | "multiple"

export type EduQuestionMeta = {
  title?: string
  tags?: string[]
  difficulty?: EduDifficulty
}

export type EduChoiceOption = {
  id: string
  text: string
}

export type EduChoiceQuestionItem = {
  id: string
  type: "choice"
  prompt: string
  required?: boolean
  points?: number
  explanation?: string
  choice: {
    selectionMode: EduChoiceSelectionMode
    options: EduChoiceOption[]
    correctOptionIds: string[]
  }
}

export type EduBlankSlot = {
  id: string
  acceptedAnswers: string[]
  caseSensitive?: boolean
}

export type EduBlankQuestionItem = {
  id: string
  type: "blank"
  prompt: string
  required?: boolean
  points?: number
  explanation?: string
  blank: {
    blanks: EduBlankSlot[]
  }
}

export type EduEssayQuestionItem = {
  id: string
  type: "essay"
  prompt: string
  required?: boolean
  points?: number
  explanation?: string
  essay: {
    referenceAnswer: string
    keywords?: string[]
  }
}

export type EduUnknownQuestionItem = {
  id: string
  type: "unknown"
  originalType: string
  prompt: string
  raw: Record<string, unknown>
}

export type EduQuestionItem =
  | EduChoiceQuestionItem
  | EduBlankQuestionItem
  | EduEssayQuestionItem
  | EduUnknownQuestionItem

export type EduQuestionSetAttrs = {
  schemaVersion: 1
  stem: string
  questions: EduQuestionItem[]
  meta?: EduQuestionMeta
}

export interface EduQuestionSetNodeOptions {
  HTMLAttributes: Record<string, unknown>
}

const SCHEMA_VERSION = 1 as const
export const EDU_QUESTION_SET_NODE_TYPE = "edu_question_set"
export const EDU_MAX_QUESTION_COUNT = 20
export const EDU_MIN_CHOICE_OPTIONS = 2
export const EDU_MAX_CHOICE_OPTIONS = 8
export const EDU_MIN_BLANK_SLOTS = 0
export const EDU_MAX_BLANK_SLOTS = 10
export const EDU_BLANK_TOKEN_PREFIX = "{{blank:"

function createEntityId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
}

export function formatEduBlankToken(blankId: string): string {
  return `${EDU_BLANK_TOKEN_PREFIX}${blankId}}}`
}

function promptHasEduBlankToken(prompt: string, blankId: string): boolean {
  return prompt.includes(formatEduBlankToken(blankId))
}

function appendEduBlankToken(prompt: string, blankId: string): string {
  const token = formatEduBlankToken(blankId)
  if (promptHasEduBlankToken(prompt, blankId)) {
    return prompt
  }
  if (!prompt) {
    return token
  }
  const separator = /[\s\n]$/.test(prompt) ? "" : " "
  return `${prompt}${separator}${token}`
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

function normalizeString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback
  }
  return value
}

function normalizeTrimmedString(value: unknown, fallback = ""): string {
  return normalizeString(value, fallback).trim()
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["true", "1", "yes", "on"].includes(normalized)) return true
    if (["false", "0", "no", "off"].includes(normalized)) return false
  }
  return fallback
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) {
      return n
    }
  }
  return undefined
}

function normalizeStringArray(
  value: unknown,
  options?: { trim?: boolean; compact?: boolean; unique?: boolean; limit?: number },
): string[] {
  const trim = options?.trim !== false
  const compact = options?.compact !== false
  const unique = options?.unique !== false
  const limit = options?.limit

  if (!Array.isArray(value)) {
    return []
  }

  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    let next = typeof item === "string" ? item : String(item ?? "")
    if (trim) {
      next = next.trim()
    }
    if (compact && !next) {
      continue
    }
    if (unique) {
      if (seen.has(next)) {
        continue
      }
      seen.add(next)
    }
    result.push(next)
    if (typeof limit === "number" && limit > 0 && result.length >= limit) {
      break
    }
  }
  return result
}

function normalizeDifficulty(value: unknown): EduDifficulty | undefined {
  const normalized = normalizeTrimmedString(value)
  if (normalized === "easy" || normalized === "medium" || normalized === "hard") {
    return normalized
  }
  return undefined
}

function normalizeMeta(value: unknown): EduQuestionMeta | undefined {
  const row = asRecord(value)
  const title = normalizeTrimmedString(row.title)
  const tags = normalizeStringArray(row.tags, { trim: true, compact: true, unique: true, limit: 20 })
  const difficulty = normalizeDifficulty(row.difficulty)

  const next: EduQuestionMeta = {}
  if (title) next.title = title
  if (tags.length > 0) next.tags = tags
  if (difficulty) next.difficulty = difficulty

  return Object.keys(next).length > 0 ? next : undefined
}

function normalizePointValue(value: unknown): number | undefined {
  const parsed = normalizeNumber(value)
  if (parsed === undefined) {
    return undefined
  }
  if (parsed < 0) {
    return 0
  }
  return parsed
}

function normalizeQuestionCommon(row: Record<string, unknown>): {
  id: string
  prompt: string
  required?: boolean
  points?: number
  explanation?: string
} {
  const id = normalizeTrimmedString(row.id) || createEntityId("q")
  const prompt = normalizeString(row.prompt)
  const required = normalizeBoolean(row.required, false)
  const points = normalizePointValue(row.points)
  const explanationRaw = normalizeString(row.explanation)

  const common: {
    id: string
    prompt: string
    required?: boolean
    points?: number
    explanation?: string
  } = {
    id,
    prompt,
  }

  if (required) {
    common.required = true
  }
  if (points !== undefined) {
    common.points = points
  }
  if (explanationRaw.trim()) {
    common.explanation = explanationRaw
  }

  return common
}

function ensureChoiceOptions(raw: unknown): EduChoiceOption[] {
  const src = Array.isArray(raw) ? raw : []
  const result: EduChoiceOption[] = []
  const idSet = new Set<string>()

  for (const item of src) {
    if (result.length >= EDU_MAX_CHOICE_OPTIONS) {
      break
    }
    const row = asRecord(item)
    const idCandidate = normalizeTrimmedString(row.id)
    let id = idCandidate || createEntityId("opt")
    while (idSet.has(id)) {
      id = createEntityId("opt")
    }
    idSet.add(id)
    result.push({
      id,
      text: normalizeString(row.text),
    })
  }

  while (result.length < EDU_MIN_CHOICE_OPTIONS) {
    result.push({
      id: createEntityId("opt"),
      text: `选项 ${result.length + 1}`,
    })
  }

  return result
}

function normalizeChoiceQuestion(row: Record<string, unknown>): EduChoiceQuestionItem {
  const common = normalizeQuestionCommon(row)
  const choiceRaw = asRecord(row.choice)
  const selectionMode = normalizeTrimmedString(choiceRaw.selectionMode) === "multiple"
    ? "multiple"
    : "single"
  const options = ensureChoiceOptions(choiceRaw.options)
  const optionIdSet = new Set(options.map((item) => item.id))
  const correctOptionIds = normalizeStringArray(choiceRaw.correctOptionIds, {
    trim: true,
    compact: true,
    unique: true,
  }).filter((id) => optionIdSet.has(id))

  return {
    ...common,
    type: "choice",
    choice: {
      selectionMode,
      options,
      correctOptionIds: selectionMode === "single" ? correctOptionIds.slice(0, 1) : correctOptionIds,
    },
  }
}

function ensureBlankSlots(raw: unknown): EduBlankSlot[] {
  const src = Array.isArray(raw) ? raw : []
  const result: EduBlankSlot[] = []

  for (const item of src) {
    if (result.length >= EDU_MAX_BLANK_SLOTS) {
      break
    }
    const row = asRecord(item)
    const id = normalizeTrimmedString(row.id) || createEntityId("blank")
    const acceptedAnswers = normalizeStringArray(row.acceptedAnswers, {
      trim: true,
      compact: false,
      unique: true,
      limit: 20,
    })
    const caseSensitive = normalizeBoolean(row.caseSensitive, false)

    result.push({
      id,
      acceptedAnswers,
      ...(caseSensitive ? { caseSensitive: true } : {}),
    })
  }

  while (result.length < EDU_MIN_BLANK_SLOTS) {
    result.push({
      id: createEntityId("blank"),
      acceptedAnswers: [],
    })
  }

  return result
}

function normalizeBlankQuestion(row: Record<string, unknown>): EduBlankQuestionItem {
  const common = normalizeQuestionCommon(row)
  const blankRaw = asRecord(row.blank)
  const blanks = ensureBlankSlots(blankRaw.blanks)
  return {
    ...common,
    type: "blank",
    blank: {
      blanks,
    },
  }
}

function normalizeEssayQuestion(row: Record<string, unknown>): EduEssayQuestionItem {
  const common = normalizeQuestionCommon(row)
  const essayRaw = asRecord(row.essay)
  const referenceAnswer = normalizeString(essayRaw.referenceAnswer)
  const keywords = normalizeStringArray(essayRaw.keywords, {
    trim: true,
    compact: true,
    unique: true,
    limit: 20,
  })

  return {
    ...common,
    type: "essay",
    essay: {
      referenceAnswer,
      ...(keywords.length > 0 ? { keywords } : {}),
    },
  }
}

function normalizeUnknownQuestion(row: Record<string, unknown>): EduUnknownQuestionItem {
  const common = normalizeQuestionCommon(row)
  const originalType = normalizeTrimmedString(row.type) || "unknown"

  return {
    id: common.id,
    type: "unknown",
    originalType,
    prompt: common.prompt,
    raw: row,
  }
}

export function createQuestionByType(
  type: EduQuestionType,
  options?: { id?: string; prompt?: string },
): EduQuestionItem {
  const id = normalizeTrimmedString(options?.id) || createEntityId("q")
  const prompt = normalizeString(options?.prompt)

  if (type === "choice") {
    return {
      id,
      type: "choice",
      prompt,
      choice: {
        selectionMode: "single",
        options: [
          { id: createEntityId("opt"), text: "选项 1" },
          { id: createEntityId("opt"), text: "选项 2" },
          { id: createEntityId("opt"), text: "选项 3" },
          { id: createEntityId("opt"), text: "选项 4" },
        ],
        correctOptionIds: [],
      },
    }
  }

  if (type === "blank") {
    const blankId = createEntityId("blank")
    return {
      id,
      type: "blank",
      prompt: appendEduBlankToken(prompt, blankId),
      blank: {
        blanks: [
          {
            id: blankId,
            acceptedAnswers: [],
          },
        ],
      },
    }
  }

  return {
    id,
    type: "essay",
    prompt,
    essay: {
      referenceAnswer: "",
      keywords: [],
    },
  }
}

export function normalizeQuestionList(value: unknown): EduQuestionItem[] {
  if (!Array.isArray(value)) {
    return [createQuestionByType("choice")]
  }

  const result: EduQuestionItem[] = []
  const idSet = new Set<string>()

  for (const item of value) {
    if (result.length >= EDU_MAX_QUESTION_COUNT) {
      break
    }

    const row = asRecord(item)
    const type = normalizeTrimmedString(row.type)
    let next: EduQuestionItem

    if (type === "choice") {
      next = normalizeChoiceQuestion(row)
    } else if (type === "blank") {
      next = normalizeBlankQuestion(row)
    } else if (type === "essay") {
      next = normalizeEssayQuestion(row)
    } else {
      next = normalizeUnknownQuestion(row)
    }

    let questionId = normalizeTrimmedString(next.id) || createEntityId("q")
    while (idSet.has(questionId)) {
      questionId = createEntityId("q")
    }
    idSet.add(questionId)

    if (next.id !== questionId) {
      next = {
        ...next,
        id: questionId,
      } as EduQuestionItem
    }

    result.push(next)
  }

  if (result.length === 0) {
    result.push(createQuestionByType("choice"))
  }

  return result
}

export function normalizeEduQuestionSetAttrs(raw: unknown): EduQuestionSetAttrs {
  const row = asRecord(raw)

  return {
    schemaVersion: SCHEMA_VERSION,
    stem: normalizeString(row.stem),
    questions: normalizeQuestionList(row.questions),
    meta: normalizeMeta(row.meta),
  }
}

export function createDefaultEduQuestionSetAttrs(
  template: EduQuestionType = "choice",
): EduQuestionSetAttrs {
  return normalizeEduQuestionSetAttrs({
    schemaVersion: SCHEMA_VERSION,
    stem: "",
    questions: [createQuestionByType(template)],
    meta: {},
  })
}

function encodeJsonAttribute(value: unknown): string {
  try {
    return encodeURIComponent(JSON.stringify(value))
  } catch {
    return encodeURIComponent("{}")
  }
}

function decodeJsonAttribute<T>(value: string, fallback: T): T {
  try {
    const decoded = decodeURIComponent(value)
    const parsed = JSON.parse(decoded)
    return parsed as T
  } catch {
    return fallback
  }
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    edu_question_set: {
      insertEduQuestionSet: (input?: { template?: EduQuestionType }) => ReturnType
    }
  }
}

export const EduQuestionSetNode = Node.create<EduQuestionSetNodeOptions>({
  name: EDU_QUESTION_SET_NODE_TYPE,

  group: "block",

  atom: true,

  draggable: true,

  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      schemaVersion: {
        default: SCHEMA_VERSION,
        parseHTML: (element: HTMLElement) => {
          const value = Number(element.getAttribute("data-schema-version") || SCHEMA_VERSION)
          return Number.isFinite(value) ? value : SCHEMA_VERSION
        },
        renderHTML: (attrs: EduQuestionSetAttrs) => ({
          "data-schema-version": String(attrs.schemaVersion || SCHEMA_VERSION),
        }),
      },
      stem: {
        default: "",
        parseHTML: (element: HTMLElement) => {
          const encoded = element.getAttribute("data-stem") || ""
          try {
            return decodeURIComponent(encoded)
          } catch {
            return ""
          }
        },
        renderHTML: (attrs: EduQuestionSetAttrs) => ({
          "data-stem": encodeURIComponent(normalizeString(attrs.stem)),
        }),
      },
      questions: {
        default: [createQuestionByType("choice")],
        parseHTML: (element: HTMLElement) => {
          const encoded = element.getAttribute("data-questions") || ""
          const parsed = decodeJsonAttribute<unknown[]>(encoded, [createQuestionByType("choice")])
          return normalizeQuestionList(parsed)
        },
        renderHTML: (attrs: EduQuestionSetAttrs) => ({
          "data-questions": encodeJsonAttribute(normalizeQuestionList(attrs.questions)),
        }),
      },
      meta: {
        default: {},
        parseHTML: (element: HTMLElement) => {
          const encoded = element.getAttribute("data-meta") || ""
          const parsed = decodeJsonAttribute<Record<string, unknown>>(encoded, {})
          return normalizeMeta(parsed) || {}
        },
        renderHTML: (attrs: EduQuestionSetAttrs) => ({
          "data-meta": encodeJsonAttribute(normalizeMeta(attrs.meta) || {}),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="edu-question-set"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = normalizeEduQuestionSetAttrs(HTMLAttributes)

    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "edu-question-set",
        "data-schema-version": String(attrs.schemaVersion),
        "data-stem": encodeURIComponent(attrs.stem),
        "data-questions": encodeJsonAttribute(attrs.questions),
        "data-meta": encodeJsonAttribute(attrs.meta || {}),
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(EduQuestionSetNodeView)
  },

  addCommands() {
    return {
      insertEduQuestionSet:
        ({ template = "choice" } = {}) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: createDefaultEduQuestionSetAttrs(template),
          })
        },
    }
  },
})

export default EduQuestionSetNode
