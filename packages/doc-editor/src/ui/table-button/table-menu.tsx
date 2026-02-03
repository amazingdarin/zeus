"use client"

import { forwardRef, useCallback } from "react"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import type { Editor } from "@tiptap/react"

// --- Hooks ---
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"
import { useTable } from "./use-table"

// --- Icons ---
import { TableIcon } from "../../icons/table-icon"

// --- UI Primitives ---
import { Button } from "../../primitives/button"

export interface TableMenuProps {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * Whether to show the menu trigger button
   * @default true
   */
  showTrigger?: boolean
}

interface MenuItemProps {
  label: string
  onClick: () => void
  disabled?: boolean
}

const MenuItem = ({ label, onClick, disabled }: MenuItemProps) => (
  <DropdownMenu.Item
    className="zeus-table-menu-item"
    onClick={onClick}
    disabled={disabled}
  >
    {label}
  </DropdownMenu.Item>
)

const MenuSeparator = () => (
  <DropdownMenu.Separator className="zeus-table-menu-separator" />
)

/**
 * Dropdown menu component for table operations in a Tiptap editor.
 */
export const TableMenu = forwardRef<HTMLButtonElement, TableMenuProps>(
  ({ editor: providedEditor, showTrigger = true }, ref) => {
    const { editor } = useTiptapEditor(providedEditor)
    const {
      inTable,
      canInsert,
      handleInsert,
      handleDelete,
      handleAddRowBefore,
      handleAddRowAfter,
      handleDeleteRow,
      handleAddColumnBefore,
      handleAddColumnAfter,
      handleDeleteColumn,
      handleMergeCells,
      handleSplitCell,
      handleToggleHeaderRow,
      handleToggleHeaderColumn,
    } = useTable({ editor })

    const handleInsertTable = useCallback(() => {
      handleInsert()
    }, [handleInsert])

    const isDisabled = !editor || !editor.isEditable

    return (
      <DropdownMenu.Root>
        {showTrigger && (
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              data-style="ghost"
              data-active-state={inTable ? "on" : "off"}
              disabled={isDisabled}
              data-disabled={isDisabled}
              tabIndex={-1}
              aria-label="Table options"
              tooltip="Table"
              ref={ref}
            >
              <TableIcon className="tiptap-button-icon" />
            </Button>
          </DropdownMenu.Trigger>
        )}

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="zeus-table-menu-content"
            sideOffset={5}
            align="start"
          >
            {!inTable ? (
              <MenuItem
                label="Insert Table"
                onClick={handleInsertTable}
                disabled={!canInsert}
              />
            ) : (
              <>
                <DropdownMenu.Label className="zeus-table-menu-label">
                  Rows
                </DropdownMenu.Label>
                <MenuItem label="Insert Row Above" onClick={handleAddRowBefore} />
                <MenuItem label="Insert Row Below" onClick={handleAddRowAfter} />
                <MenuItem label="Delete Row" onClick={handleDeleteRow} />

                <MenuSeparator />

                <DropdownMenu.Label className="zeus-table-menu-label">
                  Columns
                </DropdownMenu.Label>
                <MenuItem
                  label="Insert Column Left"
                  onClick={handleAddColumnBefore}
                />
                <MenuItem
                  label="Insert Column Right"
                  onClick={handleAddColumnAfter}
                />
                <MenuItem label="Delete Column" onClick={handleDeleteColumn} />

                <MenuSeparator />

                <DropdownMenu.Label className="zeus-table-menu-label">
                  Cells
                </DropdownMenu.Label>
                <MenuItem label="Merge Cells" onClick={handleMergeCells} />
                <MenuItem label="Split Cell" onClick={handleSplitCell} />

                <MenuSeparator />

                <DropdownMenu.Label className="zeus-table-menu-label">
                  Headers
                </DropdownMenu.Label>
                <MenuItem
                  label="Toggle Header Row"
                  onClick={handleToggleHeaderRow}
                />
                <MenuItem
                  label="Toggle Header Column"
                  onClick={handleToggleHeaderColumn}
                />

                <MenuSeparator />

                <MenuItem label="Delete Table" onClick={handleDelete} />
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    )
  }
)

TableMenu.displayName = "TableMenu"
