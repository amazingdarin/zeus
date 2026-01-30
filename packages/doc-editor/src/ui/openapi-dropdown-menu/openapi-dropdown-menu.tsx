import { forwardRef, useCallback, useState } from "react"

import { ChevronDownIcon } from "../../icons/chevron-down-icon"
import { useTiptapEditor } from "../../hooks/use-tiptap-editor"
import type { UseOpenApiDropdownMenuConfig } from "./use-openapi-dropdown-menu"
import { useOpenApiDropdownMenu } from "./use-openapi-dropdown-menu"
import type { ButtonProps } from "../../primitives/button"
import { Button, ButtonGroup } from "../../primitives/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../primitives/dropdown-menu"
import { Card, CardBody } from "../../primitives/card"

export interface OpenApiDropdownMenuProps
  extends Omit<ButtonProps, "type">,
    UseOpenApiDropdownMenuConfig {
  portal?: boolean
  onOpenChange?: (isOpen: boolean) => void
}

export const OpenApiDropdownMenu = forwardRef<
  HTMLButtonElement,
  OpenApiDropdownMenuProps
>(
  (
    {
      editor: providedEditor,
      hideWhenUnavailable = false,
      portal = false,
      onOpenChange,
      ...buttonProps
    },
    ref
  ) => {
    const { editor } = useTiptapEditor(providedEditor)
    const [isOpen, setIsOpen] = useState<boolean>(false)
    const { isVisible, canInsert, Icon } = useOpenApiDropdownMenu({
      editor,
      hideWhenUnavailable,
    })

    const handleOpenChange = useCallback(
      (open: boolean) => {
        if (!editor || !canInsert) return
        setIsOpen(open)
        onOpenChange?.(open)
      },
      [canInsert, editor, onOpenChange]
    )

    const handleInsertOpenApi = useCallback(() => {
      if (!editor) return

      editor
        .chain()
        .focus()
        .insertContent({
          type: "openapi",
          attrs: {
            source: "",
            source_type: "yaml",
            renderer: "swagger",
          },
        })
        .run()

      setIsOpen(false)
    }, [editor])

    if (!isVisible) {
      return null
    }

    return (
      <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            data-style="ghost"
            role="button"
            tabIndex={-1}
            disabled={!canInsert}
            data-disabled={!canInsert}
            aria-label="Insert OpenAPI specification"
            tooltip="OpenAPI"
            {...buttonProps}
            ref={ref}
          >
            <Icon className="tiptap-button-icon" />
            <ChevronDownIcon className="tiptap-button-dropdown-small" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" portal={portal}>
          <Card>
            <CardBody>
              <ButtonGroup>
                <DropdownMenuItem asChild>
                  <Button
                    type="button"
                    data-style="ghost"
                    onClick={handleInsertOpenApi}
                  >
                    OpenAPI 文档
                  </Button>
                </DropdownMenuItem>
              </ButtonGroup>
            </CardBody>
          </Card>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
)

OpenApiDropdownMenu.displayName = "OpenApiDropdownMenu"

export default OpenApiDropdownMenu
