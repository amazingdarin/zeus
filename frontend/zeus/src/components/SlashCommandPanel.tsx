import { Dropdown } from "antd";
import type { DefaultOptionType } from "antd/es/select";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { useLayoutEffect, useMemo, useRef } from "react";

export type SlashCommandPanelProps = {
  value: string;
  options: DefaultOptionType[];
  open: boolean;
  placeholder: string;
  inputRef: RefObject<HTMLDivElement>;
  onChange: (value: string, caret?: number) => void;
  onSelect: (value: string) => void;
  onDropdownVisibleChange: (open: boolean) => void;
  filterOption?: ((inputValue: string, option?: DefaultOptionType) => boolean) | boolean;
  notFoundContent?: ReactNode;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  disabled?: boolean;
  activeKey?: string | null;
  renderHtml?: string;
};

function SlashCommandPanel({
  value,
  options,
  open,
  placeholder,
  inputRef,
  onChange,
  onSelect,
  onDropdownVisibleChange,
  filterOption,
  notFoundContent,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  disabled,
  activeKey,
  renderHtml,
}: SlashCommandPanelProps) {
  const composingRef = useRef(false);
  const lastHtmlRef = useRef<string>("");
  const filteredOptions = useMemo(() => {
    if (filterOption === false) {
      return options;
    }
    if (typeof filterOption === "function") {
      return options.filter((option) => filterOption(value, option));
    }
    return options;
  }, [filterOption, options, value]);

  const menuItems = filteredOptions.map((option) => ({
    key: String(option.value ?? option.label ?? ""),
    label: option.label,
  }));

  const serializeNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? "";
    }
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      return Array.from(node.childNodes).map(serializeNode).join("");
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (element.tagName === "BR") {
        return "\n";
      }
      const raw = element.dataset?.raw;
      if (raw) {
        return raw;
      }
      return Array.from(element.childNodes).map(serializeNode).join("");
    }
    return "";
  };

  const readEditableContent = () => {
    const container = inputRef.current;
    if (!container) {
      return { rawText: value, caret: value.length };
    }
    const rawText = serializeNode(container);
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return { rawText, caret: rawText.length };
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.startContainer)) {
      return { rawText, caret: rawText.length };
    }
    const caretRange = document.createRange();
    caretRange.selectNodeContents(container);
    caretRange.setEnd(range.startContainer, range.startOffset);
    const caret = serializeNode(caretRange.cloneContents()).length;
    return { rawText, caret };
  };

  useLayoutEffect(() => {
    if (composingRef.current) {
      return;
    }
    const container = inputRef.current;
    if (!container) {
      return;
    }
    const html = renderHtml ?? "";
    if (container.innerHTML === html && lastHtmlRef.current === html) {
      return;
    }
    container.innerHTML = html;
    lastHtmlRef.current = html;
  }, [renderHtml, inputRef]);

  return (
    <Dropdown
      open={open}
      onOpenChange={onDropdownVisibleChange}
      trigger={["click"]}
      menu={{
        items: menuItems,
        selectable: true,
        selectedKeys: activeKey ? [activeKey] : [],
        onClick: ({ key }) => onSelect(String(key)),
      }}
      overlayClassName="chat-dock-dropdown"
      popupRender={(menu) =>
        menuItems.length === 0 ? (
          <div className="chat-dock-dropdown-empty">{notFoundContent}</div>
        ) : (
          menu
        )
      }
    >
      <div
        className={`chat-dock-input-editor${disabled ? " disabled" : ""}`}
        contentEditable={!disabled}
        role="textbox"
        data-placeholder={placeholder}
        ref={inputRef}
        onInput={() => {
          if (composingRef.current) {
            return;
          }
          const { rawText, caret } = readEditableContent();
          onChange(rawText, caret);
        }}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composingRef.current = true;
          onCompositionStart();
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          onCompositionEnd();
          const { rawText, caret } = readEditableContent();
          onChange(rawText, caret);
        }}
        suppressContentEditableWarning
      >
      </div>
    </Dropdown>
  );
}

export default SlashCommandPanel;
