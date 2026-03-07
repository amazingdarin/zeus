"use client"

import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from "react"
import {
  EDU_MAX_BLANK_SLOTS,
  EDU_MAX_CHOICE_OPTIONS,
  EDU_MAX_QUESTION_COUNT,
  EDU_MIN_BLANK_SLOTS,
  EDU_MIN_CHOICE_OPTIONS,
  createQuestionByType,
  formatEduBlankToken,
  normalizeEduQuestionSetAttrs,
  normalizeQuestionList,
  type EduBlankQuestionItem,
  type EduBlankSlot,
  type EduChoiceQuestionItem,
  type EduChoiceSelectionMode,
  type EduEssayQuestionItem,
  type EduQuestionItem,
  type EduQuestionSetAttrs,
  type EduQuestionType,
} from "./edu-question-set-node-extension"

const BLANK_TOKEN_PATTERN = /\{\{blank:([A-Za-z0-9_-]+)\}\}/g
const BLANK_MIN_CH_WIDTH = 4
const BLANK_MAX_CH_WIDTH = 24
const BLANK_DEFAULT_CH_WIDTH = 8

type BlankPromptSegment =
  | {
    kind: "text"
    text: string
  }
  | {
    kind: "blank"
    slotId: string
    raw: string
  }

function questionTypeLabel(type: EduQuestionItem["type"]): string {
  if (type === "choice") return "选择题"
  if (type === "blank") return "填空题"
  if (type === "essay") return "问答题"
  return "暂不支持题型"
}

function parseBlankPromptSegments(prompt: string): BlankPromptSegment[] {
  const segments: BlankPromptSegment[] = []
  let lastIndex = 0
  let match = BLANK_TOKEN_PATTERN.exec(prompt)

  while (match) {
    const fullMatch = match[0]
    const slotId = match[1]
    const start = match.index

    if (start > lastIndex) {
      segments.push({
        kind: "text",
        text: prompt.slice(lastIndex, start),
      })
    }

    segments.push({
      kind: "blank",
      slotId,
      raw: fullMatch,
    })

    lastIndex = start + fullMatch.length
    match = BLANK_TOKEN_PATTERN.exec(prompt)
  }

  if (lastIndex < prompt.length) {
    segments.push({
      kind: "text",
      text: prompt.slice(lastIndex),
    })
  }

  BLANK_TOKEN_PATTERN.lastIndex = 0

  if (segments.length === 0) {
    return [{ kind: "text", text: prompt }]
  }
  return segments
}

function extractBlankTokenIds(prompt: string): string[] {
  const ids: string[] = []
  let match = BLANK_TOKEN_PATTERN.exec(prompt)
  while (match) {
    const slotId = String(match[1] || "").trim()
    if (slotId && !ids.includes(slotId)) {
      ids.push(slotId)
    }
    match = BLANK_TOKEN_PATTERN.exec(prompt)
  }
  BLANK_TOKEN_PATTERN.lastIndex = 0
  return ids
}

function promptHasBlankToken(prompt: string, slotId: string): boolean {
  return prompt.includes(formatEduBlankToken(slotId))
}

function appendBlankTokenToPrompt(prompt: string, slotId: string): string {
  const token = formatEduBlankToken(slotId)
  if (promptHasBlankToken(prompt, slotId)) {
    return prompt
  }

  if (!prompt) {
    return token
  }

  const separator = /[\s\n]$/.test(prompt) ? "" : " "
  return `${prompt}${separator}${token}`
}

function removeBlankTokenFromPrompt(prompt: string, slotId: string): string {
  const token = formatEduBlankToken(slotId)
  return prompt.split(token).join("")
}

function calculateBlankWidthCh(slot: EduBlankSlot): number {
  const longestAnswerLength = (slot.acceptedAnswers || [])
    .map((answer) => answer.trim().length)
    .reduce((max, current) => (current > max ? current : max), 0)

  if (longestAnswerLength <= 0) {
    return BLANK_DEFAULT_CH_WIDTH
  }

  const nextWidth = longestAnswerLength + 1
  return Math.max(BLANK_MIN_CH_WIDTH, Math.min(BLANK_MAX_CH_WIDTH, nextWidth))
}

function parseAcceptedAnswersInput(input: string): string[] {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index)
}

function answersToInput(answers: string[]): string {
  return (answers || []).join(", ")
}

function toLetter(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index)
}

function replaceAt<T>(list: T[], index: number, value: T): T[] {
  return list.map((item, idx) => (idx === index ? value : item))
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list
  }
  const copy = [...list]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

function syncBlankQuestionWithPrompt(question: EduBlankQuestionItem, prompt: string): EduBlankQuestionItem {
  const tokenIds = extractBlankTokenIds(prompt)
  const slotMap = new Map(question.blank.blanks.map((slot) => [slot.id, slot]))
  const nextBlanks: EduBlankSlot[] = []
  for (const tokenId of tokenIds) {
    const slot = slotMap.get(tokenId)
    if (slot) {
      nextBlanks.push(slot)
    }
  }
  return {
    ...question,
    prompt,
    blank: {
      ...question.blank,
      blanks: nextBlanks,
    },
  }
}

function buildBlankEditorSignature(question: EduBlankQuestionItem): string {
  const slotPart = question.blank.blanks
    .map((slot) => `${slot.id}:${calculateBlankWidthCh(slot)}`)
    .join("|")
  return `${question.prompt}@@${slotPart}`
}

export function EduQuestionSetNodeView({ node, editor, updateAttributes }: NodeViewProps) {
  const attrs = useMemo<EduQuestionSetAttrs>(() => normalizeEduQuestionSetAttrs(node.attrs), [node.attrs])
  const blankPromptEditorRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const blankPromptRenderedSignatures = useRef<Record<string, string>>({})

  const applyAttrs = useCallback((next: EduQuestionSetAttrs) => {
    const normalized = normalizeEduQuestionSetAttrs(next)
    updateAttributes({
      schemaVersion: normalized.schemaVersion,
      stem: normalized.stem,
      questions: normalized.questions,
      meta: normalized.meta || {},
    })
  }, [updateAttributes])

  const setStem = useCallback((stem: string) => {
    applyAttrs({
      ...attrs,
      stem,
    })
  }, [applyAttrs, attrs])

  const setQuestionList = useCallback((questions: EduQuestionItem[]) => {
    applyAttrs({
      ...attrs,
      questions: normalizeQuestionList(questions),
    })
  }, [applyAttrs, attrs])

  const updateQuestionById = useCallback((questionId: string, updater: (item: EduQuestionItem) => EduQuestionItem) => {
    const nextQuestions = attrs.questions.map((item) => {
      if (item.id !== questionId) return item
      return updater(item)
    })
    setQuestionList(nextQuestions)
  }, [attrs.questions, setQuestionList])

  const addQuestion = useCallback((type: EduQuestionType) => {
    if (attrs.questions.length >= EDU_MAX_QUESTION_COUNT) {
      return
    }
    setQuestionList([...attrs.questions, createQuestionByType(type)])
  }, [attrs.questions, setQuestionList])

  const removeQuestion = useCallback((questionId: string) => {
    const next = attrs.questions.filter((item) => item.id !== questionId)
    if (next.length === 0) {
      setQuestionList([createQuestionByType("choice")])
      return
    }
    setQuestionList(next)
  }, [attrs.questions, setQuestionList])

  const moveQuestion = useCallback((index: number, direction: -1 | 1) => {
    const target = index + direction
    setQuestionList(moveItem(attrs.questions, index, target))
  }, [attrs.questions, setQuestionList])

  const changeQuestionType = useCallback((questionId: string, nextType: EduQuestionType) => {
    updateQuestionById(questionId, (item) => {
      if (item.type === nextType) {
        return item
      }
      const prompt = "prompt" in item ? item.prompt : ""
      return createQuestionByType(nextType, {
        id: item.id,
        prompt,
      })
    })
  }, [updateQuestionById])

  const updateQuestionPrompt = useCallback((questionId: string, prompt: string) => {
    updateQuestionById(questionId, (item) => ({
      ...item,
      prompt,
    }))
  }, [updateQuestionById])

  const updateQuestionExplanation = useCallback((questionId: string, explanation: string) => {
    updateQuestionById(questionId, (item) => ({
      ...item,
      explanation,
    }))
  }, [updateQuestionById])

  const updateChoiceSelectionMode = useCallback((questionId: string, selectionMode: EduChoiceSelectionMode) => {
    updateQuestionById(questionId, (item) => {
      if (item.type !== "choice") return item
      const nextCorrect = selectionMode === "single"
        ? item.choice.correctOptionIds.slice(0, 1)
        : item.choice.correctOptionIds
      return {
        ...item,
        choice: {
          ...item.choice,
          selectionMode,
          correctOptionIds: nextCorrect,
        },
      }
    })
  }, [updateQuestionById])

  const updateChoiceOptionText = useCallback((questionId: string, optionIndex: number, text: string) => {
    updateQuestionById(questionId, (item) => {
      if (item.type !== "choice") return item
      if (optionIndex < 0 || optionIndex >= item.choice.options.length) return item
      return {
        ...item,
        choice: {
          ...item.choice,
          options: replaceAt(item.choice.options, optionIndex, {
            ...item.choice.options[optionIndex],
            text,
          }),
        },
      }
    })
  }, [updateQuestionById])

  const addChoiceOption = useCallback((questionId: string) => {
    updateQuestionById(questionId, (item) => {
      if (item.type !== "choice") return item
      if (item.choice.options.length >= EDU_MAX_CHOICE_OPTIONS) return item
      return {
        ...item,
        choice: {
          ...item.choice,
          options: [
            ...item.choice.options,
            {
              id: `opt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
              text: `选项 ${item.choice.options.length + 1}`,
            },
          ],
        },
      }
    })
  }, [updateQuestionById])

  const removeChoiceOption = useCallback((questionId: string, optionIndex: number) => {
    updateQuestionById(questionId, (item) => {
      if (item.type !== "choice") return item
      if (item.choice.options.length <= EDU_MIN_CHOICE_OPTIONS) return item
      if (optionIndex < 0 || optionIndex >= item.choice.options.length) return item

      const removed = item.choice.options[optionIndex]
      const nextOptions = item.choice.options.filter((_, idx) => idx !== optionIndex)
      const nextCorrect = item.choice.correctOptionIds.filter((id) => id !== removed.id)

      return {
        ...item,
        choice: {
          ...item.choice,
          options: nextOptions,
          correctOptionIds: item.choice.selectionMode === "single" ? nextCorrect.slice(0, 1) : nextCorrect,
        },
      }
    })
  }, [updateQuestionById])

  const toggleChoiceCorrect = useCallback((questionId: string, optionId: string) => {
    updateQuestionById(questionId, (item) => {
      if (item.type !== "choice") return item

      if (item.choice.selectionMode === "single") {
        return {
          ...item,
          choice: {
            ...item.choice,
            correctOptionIds: [optionId],
          },
        }
      }

      const exists = item.choice.correctOptionIds.includes(optionId)
      const nextCorrect = exists
        ? item.choice.correctOptionIds.filter((id) => id !== optionId)
        : [...item.choice.correctOptionIds, optionId]

      return {
        ...item,
        choice: {
          ...item.choice,
          correctOptionIds: nextCorrect,
        },
      }
    })
  }, [updateQuestionById])

  const updateBlankAnswers = useCallback((questionId: string, blankIndex: number, input: string) => {
    updateQuestionById(questionId, (item) => {
      if (item.type !== "blank") return item
      if (blankIndex < 0 || blankIndex >= item.blank.blanks.length) return item

      const nextSlot: EduBlankSlot = {
        ...item.blank.blanks[blankIndex],
        acceptedAnswers: parseAcceptedAnswersInput(input),
      }

      return {
        ...item,
        blank: {
          ...item.blank,
          blanks: replaceAt(item.blank.blanks, blankIndex, nextSlot),
        },
      }
    })
  }, [updateQuestionById])

  const addBlankSlot = useCallback((questionId: string) => {
    updateQuestionById(questionId, (item) => {
      if (item.type !== "blank") return item
      if (item.blank.blanks.length >= EDU_MAX_BLANK_SLOTS) return item

      const nextSlot: EduBlankSlot = {
        id: `blank_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        acceptedAnswers: [],
      }
      return {
        ...item,
        prompt: appendBlankTokenToPrompt(item.prompt, nextSlot.id),
        blank: {
          ...item.blank,
          blanks: [
            ...item.blank.blanks,
            nextSlot,
          ],
        },
      }
    })
  }, [updateQuestionById])

  const removeBlankSlot = useCallback((questionId: string, blankIndex: number) => {
    updateQuestionById(questionId, (item) => {
      if (item.type !== "blank") return item
      if (item.blank.blanks.length <= EDU_MIN_BLANK_SLOTS) return item
      if (blankIndex < 0 || blankIndex >= item.blank.blanks.length) return item

      const removed = item.blank.blanks[blankIndex]

      return {
        ...item,
        prompt: removeBlankTokenFromPrompt(item.prompt, removed.id),
        blank: {
          ...item.blank,
          blanks: item.blank.blanks.filter((_, idx) => idx !== blankIndex),
        },
      }
    })
  }, [updateQuestionById])

  const updateEssayReferenceAnswer = useCallback((questionId: string, referenceAnswer: string) => {
    updateQuestionById(questionId, (item) => {
      if (item.type !== "essay") return item
      return {
        ...item,
        essay: {
          ...item.essay,
          referenceAnswer,
        },
      }
    })
  }, [updateQuestionById])

  const serializeBlankPromptFromEditor = useCallback((
    questionId: string,
    slots: EduBlankSlot[],
    fallbackPrompt: string,
    options?: {
      skipNode?: Node | null
    },
  ): string => {
    const root = blankPromptEditorRefs.current[questionId]
    if (!root) {
      return fallbackPrompt
    }
    const slotIdSet = new Set(slots.map((slot) => slot.id))
    let result = ""

    for (const child of Array.from(root.childNodes)) {
      if (options?.skipNode && child === options.skipNode) {
        continue
      }
      if (child.nodeType === 3) {
        result += child.textContent || ""
        continue
      }

      if (child.nodeType !== 1) {
        continue
      }

      const element = child as HTMLElement
      const slotId = String(element.dataset.slotId || "").trim()
      const rawToken = String(element.dataset.rawToken || "").trim()

      if (slotId && slotIdSet.has(slotId)) {
        result += formatEduBlankToken(slotId)
        continue
      }
      if (rawToken) {
        result += rawToken
        continue
      }
      result += element.textContent || ""
    }
    return result
  }, [])

  const commitBlankPromptEdit = useCallback((questionId: string) => {
    updateQuestionById(questionId, (item) => {
      if (item.type !== "blank") return item
      const nextPrompt = serializeBlankPromptFromEditor(questionId, item.blank.blanks, item.prompt)
      const nextItem = syncBlankQuestionWithPrompt(item, nextPrompt)
      const currentIds = item.blank.blanks.map((slot) => slot.id).join("|")
      const nextIds = nextItem.blank.blanks.map((slot) => slot.id).join("|")
      const promptSame = nextItem.prompt === item.prompt
      const blankSame = currentIds === nextIds
      if (promptSame && blankSame) {
        return item
      }
      return nextItem
    })
  }, [serializeBlankPromptFromEditor, updateQuestionById])

  const handleBlankPromptEditorKeyDown = useCallback((questionId: string, event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Backspace" && event.key !== "Delete") {
      return
    }
    if (typeof window === "undefined") {
      return
    }

    const root = blankPromptEditorRefs.current[questionId]
    if (!root) {
      return
    }

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      return
    }

    const range = selection.getRangeAt(0)
    const startContainer = range.startContainer
    const startOffset = range.startOffset

    if (!root.contains(startContainer)) {
      return
    }

    let candidate: Node | null = null
    if (event.key === "Backspace") {
      if (startContainer.nodeType === 3) {
        if (startOffset === 0) {
          candidate = startContainer.previousSibling
        }
      } else if (startContainer.nodeType === 1) {
        const element = startContainer as HTMLElement
        if (startOffset > 0) {
          candidate = element.childNodes[startOffset - 1] || null
        }
      }
    } else {
      if (startContainer.nodeType === 3) {
        const textLength = startContainer.textContent?.length || 0
        if (startOffset >= textLength) {
          candidate = startContainer.nextSibling
        }
      } else if (startContainer.nodeType === 1) {
        const element = startContainer as HTMLElement
        candidate = element.childNodes[startOffset] || null
      }
    }

    if (!(candidate instanceof HTMLElement)) {
      return
    }
    if (!candidate.dataset.slotId) {
      return
    }

    event.preventDefault()
    updateQuestionById(questionId, (item) => {
      if (item.type !== "blank") return item
      const nextPrompt = serializeBlankPromptFromEditor(
        questionId,
        item.blank.blanks,
        item.prompt,
        { skipNode: candidate },
      )
      const nextItem = syncBlankQuestionWithPrompt(item, nextPrompt)
      const currentIds = item.blank.blanks.map((slot) => slot.id).join("|")
      const nextIds = nextItem.blank.blanks.map((slot) => slot.id).join("|")
      const promptSame = nextItem.prompt === item.prompt
      const blankSame = currentIds === nextIds
      if (promptSame && blankSame) {
        return item
      }
      return nextItem
    })
  }, [serializeBlankPromptFromEditor, updateQuestionById])

  const insertBlankTokenAtPromptCursor = useCallback((questionId: string, slotId: string) => {
    let inserted = false

    updateQuestionById(questionId, (item) => {
      if (item.type !== "blank") return item
      const promptFromEditor = serializeBlankPromptFromEditor(questionId, item.blank.blanks, item.prompt)
      if (promptHasBlankToken(promptFromEditor, slotId)) {
        return item
      }
      inserted = true

      return {
        ...item,
        prompt: appendBlankTokenToPrompt(promptFromEditor, slotId),
      }
    })

    if (inserted && typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        const editorEl = blankPromptEditorRefs.current[questionId]
        if (!editorEl) return
        editorEl.focus()
      })
    }
  }, [serializeBlankPromptFromEditor, updateQuestionById])

  const renderBlankPromptEditorDom = useCallback((question: EduBlankQuestionItem) => {
    const root = blankPromptEditorRefs.current[question.id]
    if (!root) {
      return
    }

    const signature = buildBlankEditorSignature(question)
    if (blankPromptRenderedSignatures.current[question.id] === signature) {
      return
    }

    while (root.firstChild) {
      root.removeChild(root.firstChild)
    }

    const slotById = new Map(question.blank.blanks.map((slot, index) => [slot.id, { slot, index }] as const))
    const segments = parseBlankPromptSegments(question.prompt || "")

    for (const segment of segments) {
      if (segment.kind === "text") {
        root.appendChild(document.createTextNode(segment.text))
        continue
      }

      const matched = slotById.get(segment.slotId)
      const span = document.createElement("span")
      if (!matched) {
        span.className = "edu-question-set-inline-blank missing"
        span.dataset.rawToken = segment.raw
        span.contentEditable = "false"
        span.textContent = "空位未绑定"
        root.appendChild(span)
        continue
      }

      const widthCh = calculateBlankWidthCh(matched.slot)
      span.className = "edu-question-set-inline-blank"
      span.dataset.slotId = matched.slot.id
      span.contentEditable = "false"
      span.style.width = `${widthCh}ch`
      span.title = `空 ${matched.index + 1}`
      span.textContent = `空 ${matched.index + 1}`
      root.appendChild(span)
    }

    blankPromptRenderedSignatures.current[question.id] = signature
  }, [])

  useEffect(() => {
    const activeBlankIds = new Set<string>()
    for (const question of attrs.questions) {
      if (question.type !== "blank") {
        continue
      }
      activeBlankIds.add(question.id)
      renderBlankPromptEditorDom(question)
    }

    for (const key of Object.keys(blankPromptRenderedSignatures.current)) {
      if (!activeBlankIds.has(key)) {
        delete blankPromptRenderedSignatures.current[key]
      }
    }
  }, [attrs.questions, renderBlankPromptEditorDom])

  const renderBlankPromptContent = useCallback((question: EduBlankQuestionItem) => {
    const segments = parseBlankPromptSegments(question.prompt || "")
    const slotById = new Map(question.blank.blanks.map((slot, index) => [slot.id, { slot, index }] as const))
    const usedSlotIds = new Set<string>()

    const rendered = segments.map((segment, segmentIndex) => {
      if (segment.kind === "text") {
        return <span key={`text-${segmentIndex}`}>{segment.text}</span>
      }

      const matched = slotById.get(segment.slotId)
      if (!matched) {
        return (
          <span key={`blank-missing-${segmentIndex}`} className="edu-question-set-inline-blank missing">
            空位未绑定
          </span>
        )
      }

      usedSlotIds.add(matched.slot.id)
      const widthCh = calculateBlankWidthCh(matched.slot)

      return (
        <span
          key={`blank-${matched.slot.id}-${segmentIndex}`}
          className="edu-question-set-inline-blank"
          style={{ width: `${widthCh}ch` }}
          title={`空 ${matched.index + 1}`}
        >
          空 {matched.index + 1}
        </span>
      )
    })

    const hasMappedToken = usedSlotIds.size > 0
    const orphanSlots = question.blank.blanks
      .map((slot, index) => ({ slot, index }))
      .filter((entry) => !usedSlotIds.has(entry.slot.id))
    return { rendered, hasMappedToken, orphanSlots }
  }, [])

  const renderEditableQuestionCard = useCallback((question: EduQuestionItem, index: number) => {
    const canMoveUp = index > 0
    const canMoveDown = index < attrs.questions.length - 1

    return (
      <div className="edu-question-set-card" key={question.id}>
        <div className="edu-question-set-card-header">
          <div className="edu-question-set-card-title">题目 {index + 1}</div>
          <div className="edu-question-set-card-actions">
            <select
              value={question.type === "unknown" ? "essay" : question.type}
              onChange={(event) => changeQuestionType(question.id, event.target.value as EduQuestionType)}
              className="edu-question-set-select"
            >
              <option value="choice">选择题</option>
              <option value="blank">填空题</option>
              <option value="essay">问答题</option>
            </select>
            <button
              type="button"
              className="edu-question-set-btn"
              onClick={() => moveQuestion(index, -1)}
              disabled={!canMoveUp}
            >
              上移
            </button>
            <button
              type="button"
              className="edu-question-set-btn"
              onClick={() => moveQuestion(index, 1)}
              disabled={!canMoveDown}
            >
              下移
            </button>
            <button
              type="button"
              className="edu-question-set-btn danger"
              onClick={() => removeQuestion(question.id)}
            >
              删除
            </button>
          </div>
        </div>

        <label className="edu-question-set-field">
          <span className="edu-question-set-label">题目</span>
          {question.type === "blank" ? (
            <>
              <div
                className="edu-question-set-rich-input"
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label="填空题题目输入"
                ref={(el) => {
                  blankPromptEditorRefs.current[question.id] = el
                }}
                onKeyDown={(event) => handleBlankPromptEditorKeyDown(question.id, event)}
                onBlur={() => commitBlankPromptEdit(question.id)}
              />
              <div className="edu-question-set-hint">可直接在此输入文字，选中高亮空位后按删除键移除。</div>
            </>
          ) : (
            <textarea
              value={"prompt" in question ? question.prompt : ""}
              onChange={(event) => updateQuestionPrompt(question.id, event.target.value)}
              className="edu-question-set-textarea"
              rows={2}
              placeholder="输入题目内容"
            />
          )}
        </label>

        {question.type === "choice" ? renderChoiceEditor(question, {
          updateSelectionMode: (mode) => updateChoiceSelectionMode(question.id, mode),
          updateOptionText: (optionIndex, text) => updateChoiceOptionText(question.id, optionIndex, text),
          addOption: () => addChoiceOption(question.id),
          removeOption: (optionIndex) => removeChoiceOption(question.id, optionIndex),
          toggleCorrect: (optionId) => toggleChoiceCorrect(question.id, optionId),
        }) : null}

        {question.type === "blank" ? renderBlankEditor(question, {
          updateAnswers: (blankIndex, input) => updateBlankAnswers(question.id, blankIndex, input),
          addBlank: () => addBlankSlot(question.id),
          removeBlank: (blankIndex) => removeBlankSlot(question.id, blankIndex),
          insertTokenToPrompt: (slotId) => insertBlankTokenAtPromptCursor(question.id, slotId),
        }) : null}

        {question.type === "essay" ? (
          <label className="edu-question-set-field">
            <span className="edu-question-set-label">标准答案（编辑态可见）</span>
            <textarea
              value={question.essay.referenceAnswer}
              onChange={(event) => updateEssayReferenceAnswer(question.id, event.target.value)}
              className="edu-question-set-textarea"
              rows={3}
              placeholder="输入问答题标准答案"
            />
          </label>
        ) : null}

        {question.type === "unknown" ? (
          <div className="edu-question-set-unsupported">
            检测到暂不支持的题型：{question.originalType || "unknown"}。你可以将其切换到已支持题型。
          </div>
        ) : null}

        {question.type !== "unknown" ? (
          <label className="edu-question-set-field">
            <span className="edu-question-set-label">标准解析（展示态隐藏）</span>
            <textarea
              value={question.explanation || ""}
              onChange={(event) => updateQuestionExplanation(question.id, event.target.value)}
              className="edu-question-set-textarea"
              rows={2}
              placeholder="输入解析（可选）"
            />
          </label>
        ) : null}
      </div>
    )
  }, [
    addBlankSlot,
    addChoiceOption,
    attrs.questions.length,
    changeQuestionType,
    moveQuestion,
    removeQuestion,
    removeBlankSlot,
    removeChoiceOption,
    toggleChoiceCorrect,
    updateBlankAnswers,
    updateChoiceOptionText,
    updateChoiceSelectionMode,
    updateEssayReferenceAnswer,
    commitBlankPromptEdit,
    handleBlankPromptEditorKeyDown,
    insertBlankTokenAtPromptCursor,
    renderBlankPromptContent,
    updateQuestionExplanation,
    updateQuestionPrompt,
  ])

  const renderViewQuestionCard = useCallback((question: EduQuestionItem, index: number) => {
    return (
      <div className="edu-question-set-view-card" key={question.id}>
        <div className="edu-question-set-view-title">
          {index + 1}. {questionTypeLabel(question.type)}
        </div>
        {question.type === "blank" ? (() => {
          const parsed = renderBlankPromptContent(question)
          return (
            <>
              <div className="edu-question-set-view-prompt edu-question-set-inline-prompt">
                {parsed.rendered}
              </div>
              {parsed.orphanSlots.length > 0 ? (
                <div className="edu-question-set-view-blank-list">
                  {parsed.orphanSlots.map((entry) => (
                    <div key={entry.slot.id} className="edu-question-set-view-blank-item">
                      空 {entry.index + 1}: ________
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )
        })() : (
          <div className="edu-question-set-view-prompt">{"prompt" in question ? question.prompt : ""}</div>
        )}

        {question.type === "choice" ? (
          <ul className="edu-question-set-view-choice-list">
            {question.choice.options.map((option, optionIndex) => (
              <li key={option.id} className="edu-question-set-view-choice-item">
                <span className="edu-question-set-view-choice-key">{toLetter(optionIndex)}.</span>
                <span className="edu-question-set-view-choice-text">{option.text}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {question.type === "essay" ? (
          <div className="edu-question-set-view-essay-placeholder">请在作答区作答。</div>
        ) : null}

        {question.type === "unknown" ? (
          <div className="edu-question-set-unsupported">
            暂不支持的题型：{question.originalType || "unknown"}
          </div>
        ) : null}
      </div>
    )
  }, [renderBlankPromptContent])

  if (!editor.isEditable) {
    return (
      <NodeViewWrapper className="edu-question-set-node" contentEditable={false}>
        <div className="edu-question-set-card readonly">
          <div className="edu-question-set-view-header">
            <div className="edu-question-set-view-heading">题目编排</div>
            <div className="edu-question-set-view-count">共 {attrs.questions.length} 题</div>
          </div>
          {attrs.stem ? (
            <div className="edu-question-set-view-stem">{attrs.stem}</div>
          ) : (
            <div className="edu-question-set-view-stem placeholder">暂无题干</div>
          )}
          <div className="edu-question-set-view-list">
            {attrs.questions.map((question, index) => renderViewQuestionCard(question, index))}
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="edu-question-set-node" contentEditable={false}>
      <div className="edu-question-set-card editable">
        <div className="edu-question-set-head">
          <div>
            <div className="edu-question-set-heading">题目编排</div>
            <div className="edu-question-set-subtitle">支持选择题、填空题、问答题；展示态自动隐藏标准答案</div>
          </div>
          <div className="edu-question-set-count">{attrs.questions.length}/{EDU_MAX_QUESTION_COUNT}</div>
        </div>

        <label className="edu-question-set-field">
          <span className="edu-question-set-label">题干</span>
          <textarea
            value={attrs.stem}
            onChange={(event) => setStem(event.target.value)}
            className="edu-question-set-textarea"
            rows={3}
            placeholder="输入题干（可为空）"
          />
        </label>

        <div className="edu-question-set-list">
          {attrs.questions.map((question, index) => renderEditableQuestionCard(question, index))}
        </div>

        <div className="edu-question-set-footer">
          <button
            type="button"
            className="edu-question-set-btn"
            onClick={() => addQuestion("choice")}
            disabled={attrs.questions.length >= EDU_MAX_QUESTION_COUNT}
          >
            + 选择题
          </button>
          <button
            type="button"
            className="edu-question-set-btn"
            onClick={() => addQuestion("blank")}
            disabled={attrs.questions.length >= EDU_MAX_QUESTION_COUNT}
          >
            + 填空题
          </button>
          <button
            type="button"
            className="edu-question-set-btn"
            onClick={() => addQuestion("essay")}
            disabled={attrs.questions.length >= EDU_MAX_QUESTION_COUNT}
          >
            + 问答题
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  )
}

function renderChoiceEditor(
  question: EduChoiceQuestionItem,
  handlers: {
    updateSelectionMode: (mode: EduChoiceSelectionMode) => void
    updateOptionText: (optionIndex: number, text: string) => void
    addOption: () => void
    removeOption: (optionIndex: number) => void
    toggleCorrect: (optionId: string) => void
  },
) {
  const isSingle = question.choice.selectionMode === "single"

  return (
    <div className="edu-question-set-type-panel">
      <label className="edu-question-set-field inline">
        <span className="edu-question-set-label">题型设置</span>
        <select
          value={question.choice.selectionMode}
          onChange={(event) => handlers.updateSelectionMode(event.target.value as EduChoiceSelectionMode)}
          className="edu-question-set-select"
        >
          <option value="single">单选</option>
          <option value="multiple">多选</option>
        </select>
      </label>

      <div className="edu-question-set-option-list">
        {question.choice.options.map((option, index) => {
          const checked = question.choice.correctOptionIds.includes(option.id)
          return (
            <div className="edu-question-set-option-row" key={option.id}>
              <label className="edu-question-set-correct-toggle">
                <input
                  type={isSingle ? "radio" : "checkbox"}
                  checked={checked}
                  onChange={() => handlers.toggleCorrect(option.id)}
                  name={isSingle ? `correct-${question.id}` : undefined}
                />
                <span>答案</span>
              </label>
              <span className="edu-question-set-option-key">{toLetter(index)}.</span>
              <input
                value={option.text}
                onChange={(event) => handlers.updateOptionText(index, event.target.value)}
                className="edu-question-set-input"
                placeholder={`选项 ${index + 1}`}
              />
              <button
                type="button"
                className="edu-question-set-btn"
                onClick={() => handlers.removeOption(index)}
                disabled={question.choice.options.length <= EDU_MIN_CHOICE_OPTIONS}
              >
                删除
              </button>
            </div>
          )
        })}
      </div>

      <div>
        <button
          type="button"
          className="edu-question-set-btn"
          onClick={handlers.addOption}
          disabled={question.choice.options.length >= EDU_MAX_CHOICE_OPTIONS}
        >
          + 添加选项
        </button>
      </div>
    </div>
  )
}

function renderBlankEditor(
  question: EduBlankQuestionItem,
  handlers: {
    updateAnswers: (blankIndex: number, input: string) => void
    addBlank: () => void
    removeBlank: (blankIndex: number) => void
    insertTokenToPrompt: (slotId: string) => void
  },
) {
  return (
    <div className="edu-question-set-type-panel">
      <div className="edu-question-set-option-list">
        {question.blank.blanks.map((slot, index) => (
          <div className="edu-question-set-option-row" key={slot.id}>
            <span className="edu-question-set-option-key">空 {index + 1}</span>
            <input
              value={answersToInput(slot.acceptedAnswers)}
              onChange={(event) => handlers.updateAnswers(index, event.target.value)}
              className="edu-question-set-input"
              placeholder="标准答案，多个用逗号分隔"
            />
            <button
              type="button"
              className="edu-question-set-btn"
              onClick={() => handlers.insertTokenToPrompt(slot.id)}
            >
              插入到题目
            </button>
            <button
              type="button"
              className="edu-question-set-btn"
              onClick={() => handlers.removeBlank(index)}
              disabled={question.blank.blanks.length <= EDU_MIN_BLANK_SLOTS}
            >
              删除
            </button>
          </div>
        ))}
      </div>
      <div>
        <button
          type="button"
          className="edu-question-set-btn"
          onClick={handlers.addBlank}
          disabled={question.blank.blanks.length >= EDU_MAX_BLANK_SLOTS}
        >
          + 添加空位
        </button>
      </div>
    </div>
  )
}

export default EduQuestionSetNodeView
