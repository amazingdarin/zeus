import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
} from "react";
import {
	Modal,
	Button,
	Space,
	Typography,
	Tag,
	Select,
	Form,
	Input,
	InputNumber,
} from "antd";
import { useAppFeedback } from "../hooks/useAppFeedback";
import type {
	PendingPreflightInfo,
	ProvidePreflightInputPayload,
} from "../api/chat";
import { suggestDocuments } from "../api/documents";

const { Text, Paragraph } = Typography;

const EMPTY_MISSING_INPUTS: PendingPreflightInfo["missingInputs"] = [];

type PendingFieldOption = {
	value: string;
	label: string;
	description?: string;
};

type PreflightInputDialogProps = {
	visible: boolean;
	projectKey: string;
	pendingPreflight: PendingPreflightInfo | null;
	onSubmit: (payload: ProvidePreflightInputPayload) => void;
	loading?: boolean;
	inline?: boolean;
};

function ChoiceListField(props: {
	options: PendingFieldOption[];
	value?: string;
	onChange?: (value: string) => void;
}) {
	const { options, value, onChange } = props;
	const selectedIndex = Math.max(
		0,
		options.findIndex((option) => option.value === value),
	);

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

function renderFieldInput(
	field: {
		formKey: string;
		label: string;
		type: string;
		description: string;
		enum?: string[];
		options?: PendingFieldOption[];
		widget?: "select" | "choice_list";
	},
	required: boolean,
) {
	const desc =
		field.description && field.description !== field.label
			? field.description
			: "";
	const optionList = Array.isArray(field.options) ? field.options : [];

	if (field.widget === "choice_list" && optionList.length > 0) {
		return (
			<Form.Item
				key={field.formKey}
				name={field.formKey}
				label={field.label}
				extra={desc || "可使用 ↑ / ↓ 选择，回车确认"}
				rules={required ? [{ required: true, message: "必填" }] : undefined}
			>
				<ChoiceListField options={optionList} />
			</Form.Item>
		);
	}

	if (optionList.length > 0) {
		return (
			<Form.Item
				key={field.formKey}
				name={field.formKey}
				label={field.label}
				extra={desc || undefined}
				rules={required ? [{ required: true, message: "必填" }] : undefined}
			>
				<Select
					placeholder={desc || "请选择"}
					options={optionList.map((option) => ({
						label: option.label,
						value: option.value,
					}))}
					allowClear={!required}
				/>
			</Form.Item>
		);
	}

	if (Array.isArray(field.enum) && field.enum.length > 0) {
		return (
			<Form.Item
				key={field.formKey}
				name={field.formKey}
				label={field.label}
				extra={desc || undefined}
				rules={required ? [{ required: true, message: "必填" }] : undefined}
			>
				<Select
					placeholder={desc || "请选择"}
					options={field.enum.map((value) => ({
						label: value === "__ALL__" ? "全部候选媒体（__ALL__）" : value,
						value,
					}))}
					allowClear={!required}
				/>
			</Form.Item>
		);
	}

	if (field.type === "boolean") {
		return (
			<Form.Item
				key={field.formKey}
				name={field.formKey}
				label={field.label}
				extra={desc || undefined}
				rules={required ? [{ required: true, message: "必填" }] : undefined}
			>
				<Select
					placeholder={desc || "请选择"}
					options={[
						{ label: "是", value: true },
						{ label: "否", value: false },
					]}
					allowClear={!required}
				/>
			</Form.Item>
		);
	}

	if (field.type === "number" || field.type === "integer") {
		return (
			<Form.Item
				key={field.formKey}
				name={field.formKey}
				label={field.label}
				extra={desc || undefined}
				rules={required ? [{ required: true, message: "必填" }] : undefined}
			>
				<InputNumber
					style={{ width: "100%" }}
					precision={field.type === "integer" ? 0 : undefined}
					placeholder={desc || "请输入数字"}
				/>
			</Form.Item>
		);
	}

	if (field.type === "object" || field.type === "array") {
		return (
			<Form.Item
				key={field.formKey}
				name={field.formKey}
				label={field.label}
				extra={desc ? `${desc} (JSON)` : "JSON"}
				rules={[
					...(required ? [{ required: true, message: "必填" }] : []),
					{
						validator: async (_rule, value) => {
							const text = typeof value === "string" ? value.trim() : "";
							if (!text) return Promise.resolve();
							try {
								JSON.parse(text);
								return Promise.resolve();
							} catch {
								return Promise.reject(new Error("请输入有效 JSON"));
							}
						},
					},
				]}
			>
				<Input.TextArea
					placeholder={field.type === "array" ? "[]" : "{}"}
					autoSize={{ minRows: 3, maxRows: 10 }}
				/>
			</Form.Item>
		);
	}

	return (
		<Form.Item
			key={field.formKey}
			name={field.formKey}
			label={field.label}
			extra={desc || undefined}
			rules={required ? [{ required: true, message: "必填" }] : undefined}
		>
			<Input placeholder={desc || "请输入"} />
		</Form.Item>
	);
}

export default function PreflightInputDialog({
	visible,
	projectKey,
	pendingPreflight,
	onSubmit,
	loading = false,
	inline = false,
}: PreflightInputDialogProps) {
	const { messageApi } = useAppFeedback();
	const [docInputs, setDocInputs] = useState<Record<string, string>>({});
	const [form] = Form.useForm();
	const [docQuery, setDocQuery] = useState("");
	const [docOptions, setDocOptions] = useState<
		Array<{ value: string; label: string }>
	>([]);
	const [docFetching, setDocFetching] = useState(false);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const missingInputs = pendingPreflight?.missingInputs ?? EMPTY_MISSING_INPUTS;

	const hasDocScopeInput = useMemo(
		() => missingInputs.some((item) => item.kind === "doc_scope"),
		[missingInputs],
	);

	const skillArgsInput = useMemo(
		() => missingInputs.find((item) => item.kind === "skill_args"),
		[missingInputs],
	);

	useEffect(() => {
		if (visible) {
			return;
		}

		setDocInputs((prev) => (Object.keys(prev).length === 0 ? prev : {}));
		setDocQuery((prev) => (prev === "" ? prev : ""));
		setDocOptions((prev) => (prev.length === 0 ? prev : []));
		if (missingInputs.some((item) => item.kind === "skill_args")) {
			form.resetFields();
		}
	}, [visible, form]);

	useEffect(() => {
		if (!visible) {
			return;
		}

		if (!missingInputs.some((item) => item.kind === "skill_args")) {
			return;
		}

		const initialValues: Record<string, unknown> = {};
		for (const missing of missingInputs) {
			if (missing.kind !== "skill_args") continue;
			for (const field of missing.fields || []) {
				const value = missing.currentArgs?.[field.key];
				if (typeof value === "undefined") continue;
				if (field.type === "object" || field.type === "array") {
					try {
						initialValues[`${missing.taskId}::${field.key}`] = JSON.stringify(
							value,
							null,
							2,
						);
					} catch {
						// ignore serialization errors
					}
				} else {
					initialValues[`${missing.taskId}::${field.key}`] = value;
				}
			}
		}

		form.resetFields();
		form.setFieldsValue(initialValues);
	}, [visible, missingInputs, form]);

	useEffect(() => {
		if (!visible || !projectKey) return;
		if (!hasDocScopeInput) return;

		if (debounceRef.current) {
			clearTimeout(debounceRef.current);
		}

		debounceRef.current = setTimeout(async () => {
			setDocFetching(true);
			try {
				const results = await suggestDocuments(projectKey, docQuery, 20);
				setDocOptions(
					results.map((item) => ({
						value: item.id,
						label: item.titlePath || item.title || item.id,
					})),
				);
			} catch {
				setDocOptions([]);
			} finally {
				setDocFetching(false);
			}
		}, 180);

		return () => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
		};
	}, [visible, projectKey, docQuery, hasDocScopeInput]);

	const submit = async () => {
		if (!pendingPreflight) return;

		const taskInputs: ProvidePreflightInputPayload["taskInputs"] = [];

		for (const missing of missingInputs) {
			if (missing.kind === "doc_scope") {
				taskInputs.push({
					taskId: missing.taskId,
					doc_id: (docInputs[missing.taskId] || "").trim(),
				});
				continue;
			}

			try {
				const values = (await form.validateFields()) as Record<string, unknown>;
				const args: Record<string, unknown> = {};

				for (const field of missing.fields || []) {
					const raw = values[`${missing.taskId}::${field.key}`];
					if (typeof raw === "undefined") continue;

					if (field.type === "string") {
						const text = String(raw).trim();
						if (text) args[field.key] = text;
						continue;
					}

					if (field.type === "integer") {
						if (typeof raw === "number" && Number.isFinite(raw)) {
							args[field.key] = Math.trunc(raw);
						}
						continue;
					}

					if (field.type === "number") {
						if (typeof raw === "number" && Number.isFinite(raw)) {
							args[field.key] = raw;
						}
						continue;
					}

					if (field.type === "object" || field.type === "array") {
						const text = typeof raw === "string" ? raw.trim() : "";
						if (text) {
							args[field.key] = JSON.parse(text);
						}
						continue;
					}

					args[field.key] = raw;
				}

				taskInputs.push({ taskId: missing.taskId, args });
			} catch {
				return;
			}
		}

		const hasUsefulInput = taskInputs.some((item) => {
			if (typeof item.doc_id === "string" && item.doc_id.trim()) return true;
			if (item.args && Object.keys(item.args).length > 0) return true;
			return false;
		});

		if (!hasUsefulInput) {
			messageApi.warning("请至少补充一项必要信息后继续。");
			return;
		}

		onSubmit({ taskInputs });
	};

	const cancel = () => {
		if (!pendingPreflight) return;
		onSubmit({ taskInputs: [] });
	};

	if (!visible || !pendingPreflight) return null;

	const body = (
		<Space direction="vertical" size={12} style={{ width: "100%" }}>
			<Paragraph style={{ marginBottom: 0 }}>
				{pendingPreflight.message || "执行前需要补充必要信息"}
			</Paragraph>

			<div>
				<Text strong>执行任务</Text>
				<div style={{ marginTop: 8, display: "grid", gap: 8 }}>
					{pendingPreflight.tasks.map((task) => (
						<div
							key={task.taskId}
							style={{
								border: "1px solid #f0f0f0",
								borderRadius: 8,
								padding: 10,
							}}
						>
							<Space>
								<Text strong>{task.title}</Text>
								<Tag
									color={
										task.status === "ready"
											? "green"
											: task.status === "blocked"
												? "red"
												: task.status === "waiting_dependency"
													? "blue"
													: "gold"
									}
								>
									{task.status === "ready"
										? "就绪"
										: task.status === "blocked"
											? "阻塞"
											: task.status === "waiting_dependency"
												? "等待依赖"
												: "需补充"}
								</Tag>
							</Space>
							<div style={{ marginTop: 4 }}>
								<Text type="secondary">子代理: {task.subagentName}</Text>
							</div>
							{task.reason && (
								<div style={{ marginTop: 4 }}>
									<Text type="secondary">{task.reason}</Text>
								</div>
							)}
						</div>
					))}
				</div>
			</div>

			{missingInputs.map((missing) => (
				<div
					key={`${missing.taskId}-${missing.kind}`}
					style={{ borderTop: "1px solid #f0f0f0", paddingTop: 12 }}
				>
					<Space size={8} style={{ marginBottom: 6 }}>
						<Tag color={missing.kind === "doc_scope" ? "gold" : "blue"}>
							{missing.kind === "doc_scope" ? "文档范围" : "技能参数"}
						</Tag>
						<Text strong>{missing.skillName}</Text>
					</Space>
					<Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 8 }}>
						{missing.message}
					</Paragraph>

					{missing.kind === "doc_scope" ? (
						<Select
							showSearch
							value={docInputs[missing.taskId] || undefined}
							placeholder="搜索并选择文档"
							filterOption={false}
							onSearch={(value) => setDocQuery(value)}
							onChange={(value) => {
								setDocInputs((prev) => ({
									...prev,
									[missing.taskId]: String(value),
								}));
							}}
							notFoundContent={docFetching ? "加载中..." : "无匹配文档"}
							options={docOptions}
							loading={docFetching}
							style={{ width: "100%" }}
						/>
					) : (
						<Form form={form} layout="vertical">
							{(missing.fields || []).map((field) =>
								renderFieldInput(
									{
										formKey: `${missing.taskId}::${field.key}`,
										label: field.key,
										type: field.type,
										description: field.description,
										enum: field.enum,
										options: field.options,
										widget: field.widget,
									},
									Boolean(missing.missing?.includes(field.key)),
								),
							)}
						</Form>
					)}
				</div>
			))}

			{skillArgsInput &&
				Array.isArray(skillArgsInput.issues) &&
				skillArgsInput.issues.length > 0 && (
					<Paragraph type="secondary" style={{ marginBottom: 0 }}>
						校验提示:{" "}
						{skillArgsInput.issues
							.slice(0, 3)
							.map((item) => item.message)
							.join("; ")}
					</Paragraph>
				)}
		</Space>
	);

	const actions = (
		<Space className="chat-inline-input-actions" size={8}>
			<Button key="cancel" onClick={cancel} disabled={loading}>
				取消操作
			</Button>
			<Button key="submit" type="primary" onClick={submit} loading={loading}>
				继续执行
			</Button>
		</Space>
	);

	if (inline) {
		return (
			<div className="chat-inline-input-panel">
				<div className="chat-inline-input-title">执行前需要补充信息</div>
				{body}
				{actions}
			</div>
		);
	}

	return (
		<Modal
			title="执行前需要补充信息"
			open={visible}
			centered
			width={640}
			maskClosable={false}
			closable={false}
			footer={actions}
		>
			{body}
		</Modal>
	);
}
