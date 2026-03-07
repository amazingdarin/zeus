import { forwardRef, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"
import { parseShortcutKeys } from "../../lib/tiptap-utils"
import type { EduQuestionType } from "../../nodes/edu-question-set-node"
import type { UseEduQuestionSetConfig } from "./use-edu-question-set"
import { EDU_QUESTION_SET_SHORTCUT_KEY, useEduQuestionSet } from "./use-edu-question-set"
import type { ButtonProps } from "../../primitives/button"
import { Button } from "../../primitives/button"
import { Badge } from "../../primitives/badge"
import { ChevronDownIcon } from "../../icons/chevron-down-icon"

export interface EduQuestionSetButtonProps
  extends Omit<ButtonProps, "type">,
    UseEduQuestionSetConfig {
  text?: string
  showShortcut?: boolean
}

export function EduQuestionSetShortcutBadge({
  shortcutKeys = EDU_QUESTION_SET_SHORTCUT_KEY,
}: {
  shortcutKeys?: string
}) {
  return <Badge>{parseShortcutKeys({ shortcutKeys })}</Badge>
}

const TEMPLATE_ITEMS: Array<{ type: EduQuestionType; title: string; description: string }> = [
  { type: "choice", title: "选择题模板", description: "默认 4 个选项，支持单选/多选" },
  { type: "blank", title: "填空题模板", description: "默认 1 个空位，可扩展多个空" },
  { type: "essay", title: "问答题模板", description: "默认问答题，支持参考答案" },
]

export const EduQuestionSetButton = forwardRef<HTMLButtonElement, EduQuestionSetButtonProps>(
  (
    {
      editor: providedEditor,
      text,
      hideWhenUnavailable = false,
      onInserted,
      showShortcut = false,
      onClick,
      children,
      ...buttonProps
    },
    ref,
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const {
      isVisible,
      canInsert,
      handleInsert,
      label,
      shortcutKeys,
      Icon,
    } = useEduQuestionSet({
      editor,
      hideWhenUnavailable,
      onInserted,
    })

    const [showDropdown, setShowDropdown] = useState(false)
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
    const dropdownRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
      if (!showDropdown || !buttonRef.current) return
      const rect = buttonRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left,
      })
    }, [showDropdown])

    useEffect(() => {
      if (!showDropdown) return

      const handleClickOutside = (event: MouseEvent) => {
        if (
          dropdownRef.current
          && !dropdownRef.current.contains(event.target as Node)
          && buttonRef.current
          && !buttonRef.current.contains(event.target as Node)
        ) {
          setShowDropdown(false)
        }
      }

      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [showDropdown])

    useEffect(() => {
      if (!showDropdown) return

      const handleScroll = (event: Event) => {
        if (
          dropdownRef.current
          && event.target instanceof Node
          && dropdownRef.current.contains(event.target)
        ) {
          return
        }
        setShowDropdown(false)
      }

      window.addEventListener("scroll", handleScroll, true)
      return () => window.removeEventListener("scroll", handleScroll, true)
    }, [showDropdown])

    const mergeRefs = (el: HTMLButtonElement | null) => {
      buttonRef.current = el
      if (typeof ref === "function") {
        ref(el)
      } else if (ref) {
        ref.current = el
      }
    }

    const handleClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event)
      if (event.defaultPrevented) return
      setShowDropdown((prev) => !prev)
    }, [onClick])

    const handleTemplateInsert = useCallback((template: EduQuestionType) => {
      handleInsert(template)
      setShowDropdown(false)
    }, [handleInsert])

    if (!isVisible) {
      return null
    }

    return (
      <>
        <Button
          type="button"
          data-style="ghost"
          data-active-state="off"
          role="button"
          tabIndex={-1}
          disabled={!canInsert}
          data-disabled={!canInsert}
          aria-label={label}
          aria-pressed={false}
          aria-haspopup="menu"
          aria-expanded={showDropdown}
          tooltip="Edu Question Set"
          onClick={handleClick}
          {...buttonProps}
          ref={mergeRefs}
        >
          {children ?? (
            <>
              <Icon className="tiptap-button-icon" />
              {text && <span className="tiptap-button-text">{text}</span>}
              <ChevronDownIcon className="tiptap-button-dropdown-small" />
              {showShortcut ? <EduQuestionSetShortcutBadge shortcutKeys={shortcutKeys} /> : null}
            </>
          )}
        </Button>

        {showDropdown
          ? createPortal(
            <div
              className="edu-question-set-dropdown"
              ref={dropdownRef}
              style={{
                position: "fixed",
                top: dropdownPosition.top,
                left: dropdownPosition.left,
              }}
            >
              {TEMPLATE_ITEMS.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  className="edu-question-set-dropdown-option"
                  onClick={() => handleTemplateInsert(item.type)}
                >
                  <span className="edu-question-set-dropdown-title">{item.title}</span>
                  <span className="edu-question-set-dropdown-description">{item.description}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
          : null}
      </>
    )
  },
)

EduQuestionSetButton.displayName = "EduQuestionSetButton"
