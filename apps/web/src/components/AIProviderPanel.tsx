import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Form, Input, Modal, Select, Switch, Spin, Card } from "antd";
import { useAppFeedback } from "../hooks/useAppFeedback";
import {
	PlusOutlined,
	EditOutlined,
	DeleteOutlined,
	ThunderboltOutlined,
	RobotOutlined,
	CloudServerOutlined,
	ApiOutlined,
	DesktopOutlined,
	SyncOutlined,
} from "@ant-design/icons";

import {
	getConfigByType,
	setConfigByType,
	deleteConfigByType,
	testConfigByType,
	getProviderTypes,
	fetchOllamaModels,
	type ProviderConfig,
	type ProviderConfigInput,
	type ProviderType,
	type LLMProviderId,
	type OllamaModel,
	type ConfigType,
} from "../api/llm-config";

const TRANSCRIPTION_PROVIDER: LLMProviderId = "openai-compatible";
const DEFAULT_TRANSCRIPTION_BASE_URL = "http://localhost:30800/v1";
const DEFAULT_TRANSCRIPTION_MODEL = "whisper-large-v3";

/**
 * Format file size
 */
function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * Get icon for provider type
 */
function getProviderIcon(providerId: LLMProviderId) {
	switch (providerId) {
		case "openai":
			return <RobotOutlined />;
		case "anthropic":
			return <CloudServerOutlined />;
		case "google":
			return <ApiOutlined />;
		case "ollama":
			return <DesktopOutlined />;
		case "paddleocr":
			return <ThunderboltOutlined />;
		default:
			return <CloudServerOutlined />;
	}
}

/**
 * AI Provider configuration panel
 */
function AIProviderPanel() {
	const { messageApi, modalApi } = useAppFeedback();
	const [llmConfig, setLlmConfig] = useState<ProviderConfig | null>(null);
	const [embeddingConfig, setEmbeddingConfig] = useState<ProviderConfig | null>(
		null,
	);
	const [visionConfig, setVisionConfig] = useState<ProviderConfig | null>(null);
	const [transcriptionConfig, setTranscriptionConfig] =
		useState<ProviderConfig | null>(null);
	const [providerTypes, setProviderTypes] = useState<ProviderType[]>([]);
	const [loading, setLoading] = useState(true);
	const [modalVisible, setModalVisible] = useState(false);
	const [editingType, setEditingType] = useState<ConfigType | null>(null);
	const [selectedProvider, setSelectedProvider] =
		useState<LLMProviderId | null>(null);
	const [testingType, setTestingType] = useState<ConfigType | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
	const [loadingOllamaModels, setLoadingOllamaModels] = useState(false);
	const { t } = useTranslation("settings");
	const [form] = Form.useForm();
	const transcriptionDisplayName = t(
		"settings.aiProviders.transcription.displayName",
	);
	const getStatusLabel = (status: string) => {
		if (status === "active") return t("settings.aiProviders.status.active");
		if (status === "error") return t("settings.aiProviders.status.error");
		return t("settings.aiProviders.status.untested");
	};

	/**
	 * Load configurations and provider types
	 */
	const loadData = useCallback(async () => {
		setLoading(true);
		try {
			const [llm, embedding, vision, transcription, types] = await Promise.all([
				getConfigByType("llm"),
				getConfigByType("embedding"),
				getConfigByType("vision"),
				getConfigByType("transcription"),
				getProviderTypes(),
			]);
			setLlmConfig(llm);
			setEmbeddingConfig(embedding);
			setVisionConfig(vision);
			setTranscriptionConfig(transcription);
			setProviderTypes(types);
		} catch (err) {
			messageApi.error(t("settings.aiProviders.loadFailed"));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadData();
	}, [loadData]);

	/**
	 * Open modal to add/edit configuration
	 */
	const handleOpenModal = (
		configType: ConfigType,
		existingConfig?: ProviderConfig | null,
	) => {
		setEditingType(configType);
		form.resetFields();
		if (configType === "transcription") {
			setSelectedProvider(TRANSCRIPTION_PROVIDER);
			form.setFieldsValue({
				displayName: existingConfig?.displayName || transcriptionDisplayName,
				baseUrl: existingConfig?.baseUrl || DEFAULT_TRANSCRIPTION_BASE_URL,
				defaultModel:
					existingConfig?.defaultModel || DEFAULT_TRANSCRIPTION_MODEL,
				apiKey: "",
				enabled: existingConfig?.enabled ?? true,
			});
			setModalVisible(true);
			return;
		}

		if (existingConfig) {
			setSelectedProvider(existingConfig.providerId);
			form.setFieldsValue({
				displayName: existingConfig.displayName,
				baseUrl: existingConfig.baseUrl,
				defaultModel: existingConfig.defaultModel,
				apiKey: "", // Don't fill in the API key
				enabled: existingConfig.enabled,
			});
			// Load Ollama models when editing Ollama provider
			if (existingConfig.providerId === "ollama" && existingConfig.baseUrl) {
				loadOllamaModels(existingConfig.baseUrl);
			}
		} else {
			setSelectedProvider(null);
		}
		setModalVisible(true);
	};

	/**
	 * Delete a configuration
	 */
	const handleDelete = async (configType: ConfigType, displayName: string) => {
		modalApi.confirm({
			title: t("settings.aiProviders.deleteTitle"),
			content: t("settings.aiProviders.deleteConfirm", { displayName }),
			okText: t("settings.aiProviders.deleteOk"),
			okType: "danger",
			cancelText: t("settings.aiProviders.deleteCancel"),
			onOk: async () => {
				try {
					await deleteConfigByType(configType);
					messageApi.success(t("settings.aiProviders.deleteSuccess"));
					loadData();
				} catch (err) {
					messageApi.error(t("settings.aiProviders.deleteFailed"));
				}
			},
		});
	};

	/**
	 * Test a configuration
	 */
	const handleTest = async (configType: ConfigType) => {
		setTestingType(configType);
		try {
			const result = await testConfigByType(configType);
			if (result.success) {
				messageApi.success(t("settings.aiProviders.testSuccess"));
			} else {
				messageApi.error(t("settings.aiProviders.testFailed"));
			}
			loadData(); // Refresh to update status
		} catch (err) {
			const errorMsg =
				err instanceof Error
					? err.message
					: t("settings.aiProviders.testFailedFallback");
			messageApi.error(errorMsg);
			loadData(); // Refresh to update status
		} finally {
			setTestingType(null);
		}
	};

	/**
	 * Handle form submission
	 */
	const handleSubmit = async (values: Record<string, unknown>) => {
		if (!editingType) {
			messageApi.error(t("settings.aiProviders.providerRequired"));
			return;
		}
		const providerId =
			editingType === "transcription"
				? TRANSCRIPTION_PROVIDER
				: selectedProvider;
		if (!providerId) {
			messageApi.error(t("settings.aiProviders.providerRequired"));
			return;
		}
		const isTranscription = editingType === "transcription";

		const input: ProviderConfigInput = {
			providerId,
			displayName: isTranscription
				? transcriptionDisplayName
				: (values.displayName as string),
			baseUrl: (values.baseUrl as string) || undefined,
			defaultModel: (values.defaultModel as string) || undefined,
			apiKey: isTranscription
				? undefined
				: (values.apiKey as string) || undefined,
			enabled: (values.enabled as boolean) ?? true,
		};

		setSubmitting(true);
		try {
			await setConfigByType(editingType, input);
			messageApi.success(t("settings.aiProviders.saveSuccess"));
			setModalVisible(false);
			loadData();
		} catch (err) {
			const errorMsg =
				err instanceof Error
					? err.message
					: t("settings.aiProviders.saveFailed");
			messageApi.error(errorMsg);
		} finally {
			setSubmitting(false);
		}
	};

	/**
	 * Get provider type info by ID
	 */
	const getTypeInfo = (providerId: LLMProviderId) => {
		return providerTypes.find((t) => t.id === providerId);
	};

	/**
	 * Load Ollama models from the API
	 */
	const loadOllamaModels = useCallback(async (baseUrl: string) => {
		setLoadingOllamaModels(true);
		try {
			const models = await fetchOllamaModels(baseUrl);
			setOllamaModels(models);
			if (models.length > 0) {
				messageApi.success(
					t("settings.aiProviders.modelsLoaded", { count: models.length }),
				);
			}
		} catch (err) {
			const errorMsg =
				err instanceof Error
					? err.message
					: t("settings.aiProviders.modelsLoadFailed");
			messageApi.error(errorMsg);
			setOllamaModels([]);
		} finally {
			setLoadingOllamaModels(false);
		}
	}, []);

	/**
	 * Handle provider type selection
	 */
	const handleSelectProvider = (providerId: LLMProviderId) => {
		setSelectedProvider(providerId);
		const typeInfo = providerTypes.find((t) => t.id === providerId);
		// Pre-fill default values
		if (typeInfo?.defaultBaseUrl) {
			form.setFieldValue("baseUrl", typeInfo.defaultBaseUrl);
			// Auto-load Ollama models
			if (providerId === "ollama") {
				loadOllamaModels(typeInfo.defaultBaseUrl);
			}
		}
	};

	/**
	 * Render a provider config card
	 */
	const renderConfigCard = (
		configType: ConfigType,
		config: ProviderConfig | null,
		title: string,
		description: string,
	) => {
		const isConfigured = !!config;
		const typeInfo = config ? getTypeInfo(config.providerId) : null;

		return (
			<Card
				className="provider-section-card"
				title={
					<div className="provider-section-header">
						<span>{title}</span>
						<span className="provider-section-desc">{description}</span>
					</div>
				}
				extra={
					isConfigured ? (
						<div className="provider-card-actions">
							<Button
								icon={<ThunderboltOutlined />}
								loading={testingType === configType}
								onClick={() => handleTest(configType)}
								title={t("settings.aiProviders.action.test")}
								size="small"
							/>
							<Button
								icon={<EditOutlined />}
								onClick={() => handleOpenModal(configType, config)}
								title={t("settings.aiProviders.action.edit")}
								size="small"
							/>
							<Button
								icon={<DeleteOutlined />}
								onClick={() => handleDelete(configType, config.displayName)}
								title={t("settings.aiProviders.action.delete")}
								size="small"
							/>
						</div>
					) : (
						<Button
							type="primary"
							icon={<PlusOutlined />}
							onClick={() => handleOpenModal(configType)}
							size="small"
						>
							{t("settings.aiProviders.action.configure")}
						</Button>
					)
				}
			>
				{isConfigured ? (
					<div className="provider-config-info">
						<div className="provider-config-row">
							<span className="provider-config-icon">
								{getProviderIcon(config.providerId)}
							</span>
							<span className="provider-config-name">{config.displayName}</span>
							<span className="provider-config-type">
								{typeInfo?.name || config.providerId}
							</span>
						</div>
						<div className="provider-config-details">
							<div className="provider-card-status">
								<span className={`provider-card-status-dot ${config.status}`} />
								<span>{getStatusLabel(config.status)}</span>
							</div>
							{config.defaultModel && (
								<span className="provider-config-model">
									{t("settings.aiProviders.label.model")}：{config.defaultModel}
								</span>
							)}
							{config.apiKeyMasked && (
								<span className="provider-config-key">
									{t("settings.aiProviders.label.key")}：{config.apiKeyMasked}
								</span>
							)}
							{!config.enabled && (
								<span className="provider-disabled-tag">
									{t("settings.aiProviders.label.disabled")}
								</span>
							)}
						</div>
						{config.lastError && (
							<div className="provider-error-msg">
								{t("settings.aiProviders.label.error")}：{config.lastError}
							</div>
						)}
					</div>
				) : (
					<div className="provider-empty-hint">
						{t("settings.aiProviders.empty")}
					</div>
				)}
			</Card>
		);
	};

	/**
	 * Render the selected provider type's configuration form
	 */
	/**
	 * Get existing config by type
	 */
	const getExistingConfig = (
		configType: ConfigType | null,
	): ProviderConfig | null => {
		if (configType === "llm") return llmConfig;
		if (configType === "embedding") return embeddingConfig;
		if (configType === "vision") return visionConfig;
		if (configType === "transcription") return transcriptionConfig;
		return null;
	};

	/**
	 * Render the selected provider type's configuration form
	 */
	const renderForm = () => {
		if (!selectedProvider) return null;

		const typeInfo = getTypeInfo(selectedProvider);
		const existingConfig = getExistingConfig(editingType);
		const isEditing = !!existingConfig;
		const requiresApiKey = typeInfo?.requiresApiKey ?? true;
		const isTranscription = editingType === "transcription";

		return (
			<Form form={form} layout="vertical" onFinish={handleSubmit}>
				{!isTranscription && (
					<Form.Item
						name="displayName"
						label={t("settings.aiProviders.field.displayName")}
						rules={[
							{
								required: true,
								message: t("settings.aiProviders.field.displayNameRequired"),
							},
						]}
					>
						<Input
							placeholder={t(
								"settings.aiProviders.field.displayNamePlaceholder",
								{ provider: typeInfo?.name || "" },
							)}
						/>
					</Form.Item>
				)}

				{!isTranscription && requiresApiKey && (
					<Form.Item
						name="apiKey"
						label={t("settings.aiProviders.field.apiKey")}
						extra={
							isEditing ? t("settings.aiProviders.field.apiKeyKeep") : undefined
						}
						rules={[
							{
								required: !isEditing,
								message: t("settings.aiProviders.field.apiKeyRequired"),
							},
						]}
					>
						<Input.Password placeholder="sk-..." />
					</Form.Item>
				)}

				{typeInfo?.supportsBaseUrl && (
					<Form.Item
						name="baseUrl"
						label={
							isTranscription
								? t("settings.aiProviders.field.baseUrl.transcription")
								: selectedProvider === "paddleocr"
									? t("settings.aiProviders.field.baseUrl.service")
									: t("settings.aiProviders.field.baseUrl.api")
						}
						extra={
							isTranscription
								? t("settings.aiProviders.field.baseUrl.transcriptionHelp")
								: selectedProvider === "paddleocr"
									? t("settings.aiProviders.field.baseUrl.paddleocrHelp")
									: typeInfo.requiresBaseUrl
										? t("settings.aiProviders.field.baseUrl.requiredHelp")
										: t("settings.aiProviders.field.baseUrl.optionalHelp")
						}
						rules={
							isTranscription
								? [
										{
											required: true,
											message: t(
												"settings.aiProviders.field.baseUrl.transcriptionRequired",
											),
										},
									]
								: typeInfo.requiresBaseUrl
									? [
											{
												required: true,
												message:
													selectedProvider === "paddleocr"
														? t(
																"settings.aiProviders.field.baseUrl.serviceRequired",
															)
														: t(
																"settings.aiProviders.field.baseUrl.apiRequired",
															),
											},
										]
									: undefined
						}
					>
						<Input
							placeholder={
								isTranscription
									? DEFAULT_TRANSCRIPTION_BASE_URL
									: typeInfo.defaultBaseUrl || "https://api.example.com/v1"
							}
							onBlur={(e) => {
								// Auto-refresh Ollama models when baseUrl changes
								if (selectedProvider === "ollama" && e.target.value) {
									loadOllamaModels(e.target.value);
								}
							}}
						/>
					</Form.Item>
				)}

				{/* Don't show model field for PaddleOCR */}
				{(isTranscription || selectedProvider !== "paddleocr") && (
					<Form.Item
						name="defaultModel"
						label={
							<span>
								{isTranscription
									? t("settings.aiProviders.field.whisperModel")
									: t("settings.aiProviders.field.defaultModel")}
								{!isTranscription && selectedProvider === "ollama" && (
									<Button
										type="link"
										size="small"
										icon={<SyncOutlined spin={loadingOllamaModels} />}
										onClick={() => {
											const baseUrl =
												form.getFieldValue("baseUrl") ||
												typeInfo?.defaultBaseUrl;
											if (baseUrl) loadOllamaModels(baseUrl);
										}}
										style={{ marginLeft: 8, padding: 0 }}
									>
										{t("settings.aiProviders.field.modelRefresh")}
									</Button>
								)}
							</span>
						}
						extra={
							isTranscription
								? t("settings.aiProviders.field.whisperModelHelp")
								: selectedProvider === "ollama"
									? t("settings.aiProviders.field.ollamaModelHelp")
									: t("settings.aiProviders.field.modelHelp")
						}
						rules={
							isTranscription
								? [
										{
											required: true,
											message: t(
												"settings.aiProviders.field.whisperModelRequired",
											),
										},
									]
								: undefined
						}
					>
						{!isTranscription && selectedProvider === "ollama" ? (
							<Select
								placeholder={
									loadingOllamaModels
										? t("settings.aiProviders.field.modelLoading")
										: t("settings.aiProviders.field.modelSelect")
								}
								allowClear
								showSearch
								loading={loadingOllamaModels}
								options={ollamaModels.map((m) => ({
									label: `${m.id} (${formatSize(m.size)})`,
									value: m.id,
								}))}
								notFoundContent={
									loadingOllamaModels ? (
										<Spin size="small" />
									) : (
										t("settings.aiProviders.field.modelNotFound")
									)
								}
							/>
						) : !isTranscription &&
							typeInfo?.defaultModels &&
							typeInfo.defaultModels.length > 0 ? (
							<Select
								placeholder={t("settings.aiProviders.field.modelSelect")}
								allowClear
								showSearch
								options={typeInfo.defaultModels.map((m) => ({
									label: m,
									value: m,
								}))}
							/>
						) : (
							<Input
								placeholder={
									isTranscription
										? DEFAULT_TRANSCRIPTION_MODEL
										: t("settings.aiProviders.field.modelName")
								}
							/>
						)}
					</Form.Item>
				)}

				<Form.Item
					name="enabled"
					label={t("settings.aiProviders.field.enabled")}
					valuePropName="checked"
					initialValue={true}
				>
					<Switch />
				</Form.Item>

				<div className="provider-form-actions">
					<Button onClick={() => setModalVisible(false)}>
						{t("settings.aiProviders.action.cancel")}
					</Button>
					<Button type="primary" htmlType="submit" loading={submitting}>
						{t("settings.aiProviders.action.save")}
					</Button>
				</div>
			</Form>
		);
	};

	if (loading) {
		return (
			<div className="settings-empty">
				<Spin size="large" />
			</div>
		);
	}

	const existingConfig = getExistingConfig(editingType);

	return (
		<>
			<div className="settings-content-header">
				<h2 className="settings-content-title">
					{t("settings.aiProviders.title")}
				</h2>
			</div>

			<div className="provider-sections">
				{renderConfigCard(
					"llm",
					llmConfig,
					t("settings.aiProviders.section.llm.title"),
					t("settings.aiProviders.section.llm.description"),
				)}
				{renderConfigCard(
					"embedding",
					embeddingConfig,
					t("settings.aiProviders.section.embedding.title"),
					t("settings.aiProviders.section.embedding.description"),
				)}
				{renderConfigCard(
					"vision",
					visionConfig,
					t("settings.aiProviders.section.vision.title"),
					t("settings.aiProviders.section.vision.description"),
				)}
				{renderConfigCard(
					"transcription",
					transcriptionConfig,
					t("settings.aiProviders.section.transcription.title"),
					t("settings.aiProviders.section.transcription.description"),
				)}
			</div>

			<Modal
				title={
					existingConfig
						? t("settings.aiProviders.modal.editTitle")
						: t("settings.aiProviders.modal.addTitle")
				}
				open={modalVisible}
				onCancel={() => setModalVisible(false)}
				footer={null}
				width={500}
				destroyOnClose
			>
				{!selectedProvider && !existingConfig ? (
					<>
						<p className="provider-type-hint">
							{t("settings.aiProviders.modal.providerHint")}
						</p>
						<div className="provider-type-grid">
							{providerTypes
								.filter((type) => {
									if (editingType === "transcription") {
										return (
											type.id === "openai" || type.id === "openai-compatible"
										);
									}
									// PaddleOCR only shows for vision/OCR config
									if (type.id === "paddleocr") {
										return editingType === "vision";
									}
									// For vision config, show all providers (LLM vision models too)
									return true;
								})
								.map((type) => (
									<div
										key={type.id}
										className={`provider-type-card${selectedProvider === type.id ? " selected" : ""}`}
										onClick={() => handleSelectProvider(type.id)}
									>
										<div className="provider-type-card-icon">
											{getProviderIcon(type.id)}
										</div>
										<div className="provider-type-card-name">{type.name}</div>
										<div className="provider-type-card-desc">
											{type.description}
										</div>
									</div>
								))}
						</div>
					</>
				) : (
					renderForm()
				)}
			</Modal>
		</>
	);
}

export default AIProviderPanel;
