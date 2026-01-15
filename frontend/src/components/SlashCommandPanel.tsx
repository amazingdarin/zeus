import { AutoComplete, Input } from "antd";
import type { DefaultOptionType } from "antd/es/select";
import type { KeyboardEvent, ReactNode, RefObject } from "react";

export type SlashCommandPanelProps = {
  value: string;
  options: DefaultOptionType[];
  open: boolean;
  placeholder: string;
  inputRef: RefObject<HTMLTextAreaElement>;
  onChange: (value: string, caret?: number) => void;
  onSelect: (value: string) => void;
  onDropdownVisibleChange: (open: boolean) => void;
  filterOption?: ((inputValue: string, option?: DefaultOptionType) => boolean) | boolean;
  notFoundContent?: ReactNode;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  disabled?: boolean;
  highlightActive?: boolean;
  highlightContent?: ReactNode;
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
  highlightActive,
  highlightContent,
}: SlashCommandPanelProps) {
  const textAreaClassName = highlightActive
    ? "chat-dock-input-textarea ghost"
    : "chat-dock-input-textarea";

  return (
    <div className="chat-dock-input-field">
      {highlightActive ? (
        <div className="chat-dock-input-highlight">
          {highlightContent ?? value}
        </div>
      ) : null}
      <AutoComplete
        className="chat-dock-autocomplete"
        options={options}
        value={value}
        open={open}
        onChange={(next) => {
          const caret = inputRef.current?.selectionStart ?? next.length;
          onChange(next, caret);
        }}
        onSelect={(next) => onSelect(String(next))}
        onDropdownVisibleChange={onDropdownVisibleChange}
        filterOption={filterOption}
        defaultActiveFirstOption
        notFoundContent={notFoundContent}
      >
        <Input.TextArea
          autoSize={{ minRows: 1, maxRows: 4 }}
          className={textAreaClassName}
          placeholder={placeholder}
          ref={inputRef}
          onKeyDown={onKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          disabled={disabled}
        />
      </AutoComplete>
    </div>
  );
}

export default SlashCommandPanel;
