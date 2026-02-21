/**
 * RequiredInputDialog
 *
 * Modal dialog for collecting missing required input before a skill can run.
 * Supports doc scope selection and schema-driven argument collection.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Modal, Button, Select, Typography, Space, Tag, Form, Input, InputNumber, message } from "antd";
import { suggestDocuments } from "../api/documents";
import type { PendingRequiredInputInfo, ProvideRequiredInputPayload } from "../api/chat";

const { Text, Paragraph } = Typography;

export type RequiredInputDialogProps = {
  visible: boolean;
  projectKey: string;
  pendingInput: PendingRequiredInputInfo | null;
  onSubmit: (payload: ProvideRequiredInputPayload) => void;
  loading?: boolean;
  inline?: boolean;
};

type DocOption = {
  value: string;
  label: string;
  titlePath: string;
  hasChildren: boolean;
};

type PendingFieldOption = {
  value: string;
  label: string;
  description?: string;
};

function ChoiceListField(props: {
  options: PendingFieldOption[];
  value?: string;
  onChange?: (value: string) => void;
}) {
  const { options, value, onChange } = props;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (options.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = (selectedIndex + 1) % options.length;
      onChange?.(options[nextIndex]?.value || "");
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = (selectedIndex - 1 + options.length) % options.length;
      onChange?.(options[nextIndex]?.value || "");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onChange?.(options[selectedIndex]?.value || options[0]?.value || "");
    }
  };

  return (
    <div
      className="chat-choice-list"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="listbox"
      aria-label="候选列表"
      aria-activedescendant={options[selectedIndex]?.value || undefined}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            id={option.value}
            type="button"
            className={`chat-choice-item${selected ? " is-selected" : ""}`}
            onClick={() => onChange?.(option.value)}
            role="option"
            aria-selected={selected}
          >
            <div className="chat-choice-item-label">{option.label}</div>
            {option.description && (
              <div className="chat-choice-item-desc">{option.description}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function RequiredInputDialog({
  visible,
  projectKey,
  pendingInput,
  onSubmit,
  loading = false,
  inline = false,
}: RequiredInputDialogProps) {
  const [form] = Form.useForm();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<DocOption[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>("");
  const [fetching, setFetching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const kind = pendingInput?.kind;
  const requiredKeys = useMemo(() => {
    if (!pendingInput || pendingInput.kind !== "skill_args") return new Set<string>();
    return new Set<string>(pendingInput.missing || []);
  }, [pendingInput]);

  const title = useMemo(() => {
    if (!pendingInput) return "需要补充信息";
    return `需要补充信息: ${pendingInput.skillName}`;
  }, [pendingInput]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setOptions([]);
      setSelectedDocId("");
      if (pendingInput?.kind === "skill_args") {
        form.resetFields();
      }
    }
  }, [visible, form]);

  useEffect(() => {
    if (!visible || !projectKey || kind !== "doc_scope") return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      setFetching(true);
      try {
        const results = await suggestDocuments(projectKey, query, 20);
        setOptions(
          results.map((r) => ({
            value: r.id,
            label: r.titlePath || r.title || r.id,
            titlePath: r.titlePath,
            hasChildren: r.hasChildren,
          })),
        );
      } catch {
        setOptions([]);
      } finally {
        setFetching(false);
      }
    }, 150);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [visible, projectKey, kind, query]);

  useEffect(() => {
    if (!visible || !pendingInput) return;
    if (pendingInput.kind !== "skill_args") return;

    const initialValues: Record<string, unknown> = {};
    for (const f of pendingInput.fields || []) {
      const v = pendingInput.currentArgs?.[f.key];
      if (typeof v === "undefined") continue;
      if (f.type === "object" || f.type === "array") {
        try {
          initialValues[f.key] = JSON.stringify(v, null, 2);
        } catch {
          // Ignore JSON stringify errors
        }
      } else {
        initialValues[f.key] = v;
      }
    }
    form.resetFields();
    form.setFieldsValue(initialValues);
  }, [visible, pendingInput, form]);

  const submit = async () => {
    if (!pendingInput) return;

    if (pendingInput.kind === "doc_scope") {
      onSubmit({ doc_id: selectedDocId });
      return;
    }

    // skill_args
    try {
      const values = (await form.validateFields()) as Record<string, unknown>;
      const argsUpdate: Record<string, unknown> = {};

      for (const f of pendingInput.fields || []) {
        const raw = values[f.key];
        if (typeof raw === "undefined") continue;

        if (f.type === "string") {
          const s = String(raw);
          if (s.trim().length === 0) continue;
          argsUpdate[f.key] = s;
          continue;
        }

        if (f.type === "integer") {
          if (typeof raw === "number" && Number.isFinite(raw)) {
            argsUpdate[f.key] = Math.trunc(raw);
          }
          continue;
        }

        if (f.type === "number") {
          if (typeof raw === "number" && Number.isFinite(raw)) {
            argsUpdate[f.key] = raw;
          }
          continue;
        }

        if (f.type === "boolean") {
          if (typeof raw === "boolean") {
            argsUpdate[f.key] = raw;
          }
          continue;
        }

        if (f.type === "object" || f.type === "array") {
          const s = typeof raw === "string" ? raw.trim() : "";
          if (!s) continue;
          try {
            argsUpdate[f.key] = JSON.parse(s);
          } catch {
            // validateFields should prevent this, but keep a guard.
            return;
          }
          continue;
        }

        argsUpdate[f.key] = raw;
      }

      if (Object.keys(argsUpdate).length === 0) {
        message.warning("请至少填写一个参数后继续，或点击取消操作。");
        return;
      }

      onSubmit({ args: argsUpdate });
    } catch {
      // Form validation failed
    }
  };

  const cancel = () => {
    if (!pendingInput) return;
    if (pendingInput.kind === "doc_scope") {
      onSubmit({ doc_id: "" });
      return;
    }
    onSubmit({ args: {} });
  };

  if (!visible || !pendingInput) return null;

  const body = (
    <Space direction="vertical" size={10} style={{ width: "100%" }}>
      <div>
        <Space size={8}>
          <Tag color="gold">{pendingInput.kind === "doc_scope" ? "需要文档" : "需要参数"}</Tag>
          <Text strong>{pendingInput.skillName}</Text>
        </Space>
        <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          {pendingInput.skillDescription}
        </Paragraph>
      </div>

      <Text>
        {pendingInput.message ||
          (pendingInput.kind === "doc_scope" ? "请选择文档后继续。" : "请补充所需参数后继续。")}
      </Text>

      {pendingInput.kind === "doc_scope" && (
        <Select
          showSearch
          value={selectedDocId || undefined}
          placeholder="搜索并选择文档"
          filterOption={false}
          onSearch={(v) => setQuery(v)}
          onChange={(v) => setSelectedDocId(String(v))}
          notFoundContent={fetching ? "加载中..." : "无匹配文档"}
          options={options}
          loading={fetching}
          style={{ width: "100%" }}
        />
      )}

      {pendingInput.kind === "skill_args" && (
        <Form
          form={form}
          layout="vertical"
          style={{ width: "100%" }}
        >
          {Array.isArray(pendingInput.missing) && pendingInput.missing.length > 0 && (
            <Text type="secondary">
              缺少参数: {pendingInput.missing.slice(0, 12).join(", ")}
            </Text>
          )}
          {Array.isArray(pendingInput.issues) && pendingInput.issues.length > 0 && (
            <Paragraph type="secondary" style={{ marginTop: 6, marginBottom: 0 }}>
              校验提示: {pendingInput.issues.slice(0, 3).map((i) => i.message).join("; ")}
            </Paragraph>
          )}

          {pendingInput.fields.map((f) => {
            const isRequired = requiredKeys.has(f.key);
            const desc = f.description && f.description !== f.key ? f.description : "";
            const optionList = Array.isArray(f.options) ? f.options : [];

            if (f.widget === "choice_list" && optionList.length > 0) {
              return (
                <Form.Item
                  key={f.key}
                  name={f.key}
                  label={f.key}
                  extra={desc || "可使用 ↑ / ↓ 选择，回车确认"}
                  rules={isRequired ? [{ required: true, message: "必填" }] : undefined}
                >
                  <ChoiceListField
                    options={optionList.map((option) => ({
                      value: option.value,
                      label: option.label,
                      description: option.description,
                    }))}
                  />
                </Form.Item>
              );
            }

            if (optionList.length > 0) {
              return (
                <Form.Item
                  key={f.key}
                  name={f.key}
                  label={f.key}
                  extra={desc || undefined}
                  rules={isRequired ? [{ required: true, message: "必填" }] : undefined}
                >
                  <Select
                    placeholder={desc || "请选择"}
                    options={optionList.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                    allowClear={!isRequired}
                  />
                </Form.Item>
              );
            }

            if (Array.isArray(f.enum) && f.enum.length > 0) {
              return (
                <Form.Item
                  key={f.key}
                  name={f.key}
                  label={f.key}
                  extra={desc || undefined}
                  rules={isRequired ? [{ required: true, message: "必填" }] : undefined}
                >
                  <Select
                    placeholder={desc || "请选择"}
                    options={f.enum.map((v) => ({
                      label: v === "__ALL__" ? "全部候选媒体（__ALL__）" : v,
                      value: v,
                    }))}
                    allowClear={!isRequired}
                  />
                </Form.Item>
              );
            }

            if (f.type === "boolean") {
              return (
                <Form.Item
                  key={f.key}
                  name={f.key}
                  label={f.key}
                  extra={desc || undefined}
                  rules={isRequired ? [{ required: true, message: "必填" }] : undefined}
                >
                  <Select
                    placeholder={desc || "请选择"}
                    options={[
                      { label: "是", value: true },
                      { label: "否", value: false },
                    ]}
                    allowClear={!isRequired}
                  />
                </Form.Item>
              );
            }

            if (f.type === "number" || f.type === "integer") {
              return (
                <Form.Item
                  key={f.key}
                  name={f.key}
                  label={f.key}
                  extra={desc || undefined}
                  rules={isRequired ? [{ required: true, message: "必填" }] : undefined}
                >
                  <InputNumber
                    style={{ width: "100%" }}
                    precision={f.type === "integer" ? 0 : undefined}
                    placeholder={desc || "请输入数字"}
                  />
                </Form.Item>
              );
            }

            if (f.type === "object" || f.type === "array") {
              return (
                <Form.Item
                  key={f.key}
                  name={f.key}
                  label={f.key}
                  extra={desc ? `${desc} (JSON)` : "JSON"}
                  rules={[
                    ...(isRequired ? [{ required: true, message: "必填" }] : []),
                    {
                      validator: async (_rule, value) => {
                        const s = typeof value === "string" ? value.trim() : "";
                        if (!s) return Promise.resolve();
                        try {
                          JSON.parse(s);
                          return Promise.resolve();
                        } catch {
                          return Promise.reject(new Error("请输入有效 JSON"));
                        }
                      },
                    },
                  ]}
                >
                  <Input.TextArea
                    placeholder={f.type === "array" ? "[]" : "{}"}
                    autoSize={{ minRows: 3, maxRows: 10 }}
                  />
                </Form.Item>
              );
            }

            return (
              <Form.Item
                key={f.key}
                name={f.key}
                label={f.key}
                extra={desc || undefined}
                rules={isRequired ? [{ required: true, message: "必填" }] : undefined}
              >
                <Input placeholder={desc || "请输入"} />
              </Form.Item>
            );
          })}
        </Form>
      )}
    </Space>
  );

  const actions = (
    <Space className="chat-inline-input-actions" size={8}>
      <Button
        key="cancel"
        onClick={cancel}
        disabled={loading}
      >
        取消操作
      </Button>
      <Button
        key="submit"
        type="primary"
        onClick={submit}
        disabled={(pendingInput.kind === "doc_scope" && !selectedDocId) || loading}
        loading={loading}
      >
        继续执行
      </Button>
    </Space>
  );

  if (inline) {
    return (
      <div className="chat-inline-input-panel">
        <div className="chat-inline-input-title">{title}</div>
        {body}
        {actions}
      </div>
    );
  }

  return (
    <Modal
      title={title}
      open={visible}
      centered
      width={560}
      maskClosable={false}
      closable={false}
      footer={actions}
    >
      {body}
    </Modal>
  );
}
