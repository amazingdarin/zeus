import { useEffect, useMemo, useState } from "react";
import { Alert, Form, Input, Modal, Select } from "antd";

import type { Project, ProjectOwnerContext } from "../context/ProjectContext";
import { createProject } from "../api/projects";

type CreateProjectModalProps = {
  ownerContexts: ProjectOwnerContext[];
  defaultOwnerRef?: string;
  onClose: () => void;
  onCreated?: (project: Project) => void;
};

type CreateProjectFormValues = {
  ownerRef: string;
  keyValue: string;
  name: string;
  description?: string;
};

type ParsedOwnerRef = {
  ownerType: "personal" | "team";
  ownerKey: string;
};

function buildOwnerRef(ownerType: string, ownerKey: string): string {
  return `${ownerType}::${ownerKey}`;
}

function parseOwnerRef(ownerRef: string): ParsedOwnerRef | null {
  const normalized = String(ownerRef ?? "").trim();
  if (!normalized.includes("::")) {
    return null;
  }

  const [rawOwnerType, ...ownerKeyParts] = normalized.split("::");
  const ownerType: ParsedOwnerRef["ownerType"] =
    String(rawOwnerType ?? "").trim().toLowerCase() === "team" ? "team" : "personal";
  const ownerKey = ownerKeyParts.join("::").trim() || (ownerType === "personal" ? "me" : "");

  if (!ownerKey) {
    return null;
  }

  return {
    ownerType,
    ownerKey,
  };
}

function CreateProjectModal({ ownerContexts, defaultOwnerRef, onClose, onCreated }: CreateProjectModalProps) {
  const [form] = Form.useForm<CreateProjectFormValues>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownerOptions = useMemo(
    () =>
      ownerContexts.map((context) => ({
        ...context,
        ownerRef: buildOwnerRef(context.ownerType, context.ownerKey),
      })),
    [ownerContexts],
  );

  const firstCreatable = useMemo(
    () => ownerOptions.find((item) => item.canCreate)?.ownerRef ?? "personal::me",
    [ownerOptions],
  );

  const initialOwnerRef = useMemo(() => {
    const normalized = String(defaultOwnerRef ?? "").trim();
    if (!normalized) {
      return firstCreatable;
    }
    const selected = ownerOptions.find((item) => item.ownerRef === normalized);
    if (!selected) {
      return firstCreatable;
    }
    return selected.canCreate ? selected.ownerRef : firstCreatable;
  }, [defaultOwnerRef, firstCreatable, ownerOptions]);

  const [ownerRef, setOwnerRef] = useState<string>(initialOwnerRef);

  useEffect(() => {
    setOwnerRef(initialOwnerRef);
    form.setFieldsValue({ ownerRef: initialOwnerRef });
  }, [form, initialOwnerRef]);

  const handleCreate = async (values: CreateProjectFormValues) => {
    const parsedOwner = parseOwnerRef(values.ownerRef);
    if (!parsedOwner) {
      setError("请选择项目归属");
      return;
    }

    const selectedOwner = ownerOptions.find((item) => item.ownerRef === values.ownerRef);

    if (selectedOwner?.canCreate === false) {
      setError("当前归属无创建权限");
      return;
    }

    if (parsedOwner.ownerType === "team") {
      const belongsToContext = ownerOptions.some(
        (item) =>
          item.ownerType === "team" &&
          item.ownerKey === parsedOwner.ownerKey,
      );
      if (!belongsToContext) {
        setError("当前团队归属不可用，请刷新后重试");
        return;
      }
    }

    if (selectedOwner && selectedOwner.ownerKey !== parsedOwner.ownerKey) {
      setError("项目归属发生变化，请重新选择");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const project = await createProject({
        key: values.keyValue.trim(),
        name: values.name.trim(),
        description: (values.description ?? "").trim(),
        ownerType: parsedOwner.ownerType,
        ownerKey: parsedOwner.ownerKey,
      });
      if (!project.id) {
        throw new Error("缺少项目 ID");
      }
      onCreated?.(project);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "创建项目失败";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open
      centered
      title="创建项目"
      onCancel={onClose}
      destroyOnHidden
      okText="创建"
      cancelText="取消"
      confirmLoading={loading}
      onOk={() => form.submit()}
      cancelButtonProps={{ disabled: loading }}
      width={520}
    >
      {error ? (
        <Alert
          type="error"
          message={error}
          showIcon
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form<CreateProjectFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          ownerRef,
          keyValue: "",
          name: "",
          description: "",
        }}
        onFinish={handleCreate}
      >
        <Form.Item
          name="ownerRef"
          label="归属"
          rules={[{ required: true, message: "请选择项目归属" }]}
        >
          <Select
            disabled={loading}
            onChange={(value) => {
              setOwnerRef(value);
              setError(null);
            }}
            options={ownerOptions.map((option) => ({
              value: option.ownerRef,
              label: `${option.ownerName}${option.canCreate ? "" : "（只读）"}`,
              disabled: !option.canCreate,
            }))}
          />
        </Form.Item>
        <Form.Item
          name="keyValue"
          label="标识"
          rules={[
            { required: true, message: "请输入项目标识" },
            { pattern: /^[a-zA-Z0-9_-]+$/, message: "标识只能包含字母、数字、下划线和连字符" },
          ]}
        >
          <Input placeholder="例如：my-project" disabled={loading} />
        </Form.Item>
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: "请输入项目名称" }]}
        >
          <Input placeholder="项目名称" disabled={loading} />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={4} placeholder="可选描述" disabled={loading} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default CreateProjectModal;
