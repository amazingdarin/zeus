/**
 * WebSearchPanel - Web search configuration panel in settings
 */

import { useCallback, useEffect, useState } from "react";
import {
	Button,
	Form,
	Input,
	Select,
	Switch,
	Card,
	Alert,
	Spin,
	Tag,
} from "antd";
import { useAppFeedback } from "../hooks/useAppFeedback";
import {
	GlobalOutlined,
	CheckCircleOutlined,
	CloseCircleOutlined,
	ExclamationCircleOutlined,
	SearchOutlined,
	LinkOutlined,
	DeleteOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import {
	getWebSearchConfig,
	setWebSearchConfig,
	deleteWebSearchConfig,
	testWebSearch,
	WEB_SEARCH_PROVIDERS,
	type WebSearchConfig,
	type WebSearchProvider,
} from "../api/web-search";

function WebSearchPanel() {
	const { messageApi } = useAppFeedback();
	const { t } = useTranslation("settings");
	const [config, setConfig] = useState<WebSearchConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<{
		success: boolean;
		message: string;
	} | null>(null);
	const [form] = Form.useForm();

	const selectedProvider = Form.useWatch("provider", form) as
		| WebSearchProvider
		| undefined;
	const providerInfo = WEB_SEARCH_PROVIDERS.find(
		(p) => p.id === selectedProvider,
	);

	useEffect(() => {
		let mounted = true;

		const doLoad = async () => {
			setLoading(true);
			try {
				const data = await getWebSearchConfig();
				if (!mounted) return;

				setConfig(data);
				if (data) {
					setTimeout(() => {
						if (!mounted) return;
						form.setFieldsValue({
							provider: data.provider,
							apiKey: data.apiKeyMasked || "",
							enabled: data.enabled,
						});
					}, 50);
				}
			} catch (err) {
				console.error("Failed to load web search config:", err);
			} finally {
				if (mounted) {
					setLoading(false);
				}
			}
		};

		void doLoad();

		return () => {
			mounted = false;
		};
	}, [form]);

	const handleSave = async (values: {
		provider: WebSearchProvider;
		apiKey?: string;
		enabled: boolean;
	}) => {
		setSubmitting(true);
		setTestResult(null);
		try {
			const updated = await setWebSearchConfig({
				provider: values.provider,
				apiKey: values.apiKey,
				enabled: values.enabled,
			});
			setConfig(updated);
			messageApi.success(t("settings.webSearch.saveSuccess"));
		} catch (err) {
			messageApi.error(
				err instanceof Error ? err.message : t("settings.webSearch.saveFailed"),
			);
		} finally {
			setSubmitting(false);
		}
	};

	const handleDelete = async () => {
		setSubmitting(true);
		try {
			await deleteWebSearchConfig();
			setConfig(null);
			form.resetFields();
			messageApi.success(t("settings.webSearch.deleteSuccess"));
		} catch (err) {
			messageApi.error(
				err instanceof Error
					? err.message
					: t("settings.webSearch.deleteFailed"),
			);
		} finally {
			setSubmitting(false);
		}
	};

	const handleTest = async () => {
		setTesting(true);
		setTestResult(null);
		try {
			const results = await testWebSearch(t("settings.webSearch.testQuery"));
			if (results.length > 0) {
				setTestResult({
					success: true,
					message: t("settings.webSearch.testSuccess", {
						count: results.length,
						title: results[0]?.title ?? "",
					}),
				});
			} else {
				setTestResult({
					success: false,
					message: t("settings.webSearch.testEmpty"),
				});
			}
		} catch (err) {
			setTestResult({
				success: false,
				message:
					err instanceof Error
						? err.message
						: t("settings.webSearch.testFailed"),
			});
		} finally {
			setTesting(false);
		}
	};

	if (loading) {
		return (
			<div className="web-search-panel-loading">
				<Spin size="large" />
				<p>{t("settings.general.loading")}</p>
			</div>
		);
	}

	return (
		<div className="web-search-panel">
			<div className="web-search-panel-header">
				<h3>
					<GlobalOutlined /> {t("settings.webSearch.title")}
				</h3>
				<p className="web-search-panel-desc">
					{t("settings.webSearch.description")}
				</p>
			</div>

			<Card className="web-search-panel-card">
				<Form
					form={form}
					layout="vertical"
					onFinish={handleSave}
					initialValues={{
						provider: "tavily",
						enabled: true,
					}}
				>
					{config && (
						<div className="web-search-status">
							{config.enabled ? (
								<Tag icon={<CheckCircleOutlined />} color="success">
									{t("settings.webSearch.status.enabled")}
								</Tag>
							) : (
								<Tag icon={<CloseCircleOutlined />} color="default">
									{t("settings.webSearch.status.disabled")}
								</Tag>
							)}
							<span className="web-search-status-provider">
								{t("settings.webSearch.status.current")}:{" "}
								{
									WEB_SEARCH_PROVIDERS.find((p) => p.id === config.provider)
										?.name
								}
							</span>
						</div>
					)}

					<Form.Item
						name="provider"
						label={t("settings.webSearch.provider")}
						rules={[
							{
								required: true,
								message: t("settings.webSearch.providerRequired"),
							},
						]}
					>
						<Select
							placeholder={t("settings.webSearch.providerPlaceholder")}
							options={WEB_SEARCH_PROVIDERS.map((p) => ({
								value: p.id,
								label: (
									<div className="web-search-provider-option">
										<span className="web-search-provider-name">{p.name}</span>
										<span className="web-search-provider-desc">
											{p.description}
										</span>
									</div>
								),
							}))}
						/>
					</Form.Item>

					{providerInfo && (
						<Alert
							type="info"
							showIcon
							icon={<ExclamationCircleOutlined />}
							message={
								<div className="web-search-provider-info">
									<span>{providerInfo.description}</span>
									<a
										href={providerInfo.website}
										target="_blank"
										rel="noopener noreferrer"
										className="web-search-provider-link"
									>
										<LinkOutlined /> {t("settings.webSearch.getApiKey")}
									</a>
								</div>
							}
							style={{ marginBottom: 16 }}
						/>
					)}

					{providerInfo?.requiresApiKey && (
						<Form.Item
							name="apiKey"
							label={t("settings.webSearch.apiKey")}
							rules={[
								{
									required: !config,
									message: t("settings.webSearch.apiKeyRequired"),
								},
							]}
						>
							<Input.Password
								placeholder={
									config
										? t("settings.webSearch.apiKeyKeep")
										: t("settings.webSearch.apiKeyPlaceholder")
								}
								autoComplete="off"
							/>
						</Form.Item>
					)}

					<Form.Item
						name="enabled"
						label={t("settings.webSearch.enabled")}
						valuePropName="checked"
					>
						<Switch
							checkedChildren={t("settings.webSearch.enable")}
							unCheckedChildren={t("settings.webSearch.disable")}
						/>
					</Form.Item>

					{testResult && (
						<Alert
							type={testResult.success ? "success" : "error"}
							message={testResult.message}
							showIcon
							style={{ marginBottom: 16 }}
							closable
							onClose={() => setTestResult(null)}
						/>
					)}

					<div className="web-search-actions">
						<Button
							type="primary"
							htmlType="submit"
							loading={submitting}
							disabled={testing}
						>
							{t("settings.webSearch.save")}
						</Button>

						{config && (
							<>
								<Button
									icon={<SearchOutlined />}
									onClick={handleTest}
									loading={testing}
									disabled={submitting || !config.enabled}
								>
									{t("settings.webSearch.test")}
								</Button>
								<Button
									danger
									icon={<DeleteOutlined />}
									onClick={handleDelete}
									disabled={submitting || testing}
								>
									{t("settings.webSearch.delete")}
								</Button>
							</>
						)}
					</div>
				</Form>
			</Card>

			<div className="web-search-hint">
				<h4>{t("settings.webSearch.howToUse")}</h4>
				<ol>
					<li>{t("settings.webSearch.hint.1")}</li>
					<li>{t("settings.webSearch.hint.2")}</li>
					<li>{t("settings.webSearch.hint.3")}</li>
					<li>{t("settings.webSearch.hint.4")}</li>
				</ol>
			</div>
		</div>
	);
}

export default WebSearchPanel;
