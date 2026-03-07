import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Input, Select, Spin, Switch } from "antd";
import { useAppFeedback } from "../hooks/useAppFeedback";
import {
	CloudServerOutlined,
	InfoCircleOutlined,
	LockOutlined,
	SyncOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import {
	getGeneralSettings,
	updateGeneralSettings,
} from "../api/general-settings";
import { updateCurrentUserProfile } from "../api/user-profile";
import {
	DEFAULT_DOCUMENT_BLOCK_SHORTCUTS,
	DOCUMENT_BLOCK_SHORTCUT_FIELDS,
	buildShortcutConflictMap,
	normalizeShortcutValue,
	toBlockShortcutFormValue,
	toShortcutPayload,
	type BuiltinBlockType,
	type DocumentBlockShortcutFormValue,
} from "../constants/document-block-shortcuts";
import {
	getRemoteKnowledgeBaseBackendUrl,
	setRemoteKnowledgeBaseEnabled,
} from "../config/api";
import { useAuth } from "../context/AuthContext";
import { SUPPORTED_LOCALES, normalizeLocale } from "../i18n/locale";
import { getAppLocale, setAppLocale } from "../i18n/runtime";

function GeneralSettingsPanel() {
	const { messageApi } = useAppFeedback();
	const { isAuthenticated, user, refreshUser } = useAuth();
	const { t } = useTranslation("settings");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [useRemoteKnowledgeBase, setUseRemoteKnowledgeBase] = useState(false);
	const [documentAutoSync, setDocumentAutoSync] = useState(false);
	const [trashAutoCleanupEnabled, setTrashAutoCleanupEnabled] = useState(false);
	const [trashAutoCleanupDays, setTrashAutoCleanupDays] = useState(30);
	const [documentBlockShortcutForm, setDocumentBlockShortcutForm] =
		useState<DocumentBlockShortcutFormValue>({});
	const [interfaceLanguage, setInterfaceLanguage] = useState(() =>
		normalizeLocale(user?.language ?? getAppLocale()),
	);
	const [languageSaving, setLanguageSaving] = useState(false);
	const remoteKnowledgeBaseUrl = getRemoteKnowledgeBaseBackendUrl();

	const shortcutConflictMap = useMemo(
		() => buildShortcutConflictMap(documentBlockShortcutForm),
		[documentBlockShortcutForm],
	);
	const hasShortcutConflict = useMemo(
		() => Object.values(shortcutConflictMap).some(Boolean),
		[shortcutConflictMap],
	);
	const languageOptions = useMemo(
		() =>
			SUPPORTED_LOCALES.map((locale) => ({
				value: locale,
				label: t(`settings.language.option.${locale}`),
			})),
		[t],
	);
	const blockLabelById = useMemo(
		() =>
			Object.fromEntries(
				DOCUMENT_BLOCK_SHORTCUT_FIELDS.map((field) => [
					field.id,
					t(`settings.shortcuts.blocks.${field.id}`, {
						defaultValue: field.label,
					}),
				]),
			) as Record<BuiltinBlockType, string>,
		[t],
	);

	const loadSettings = useCallback(async () => {
		setLoading(true);
		try {
			const settings = await getGeneralSettings();
			setUseRemoteKnowledgeBase(settings.useRemoteKnowledgeBase);
			setDocumentAutoSync(settings.documentAutoSync);
			setTrashAutoCleanupEnabled(settings.trashAutoCleanupEnabled);
			setTrashAutoCleanupDays(settings.trashAutoCleanupDays);
			setDocumentBlockShortcutForm(
				toBlockShortcutFormValue(settings.documentBlockShortcuts),
			);
			setRemoteKnowledgeBaseEnabled(settings.useRemoteKnowledgeBase);
		} catch (err) {
			console.error("Failed to load general settings:", err);
			messageApi.error(
				err instanceof Error ? err.message : t("settings.general.loadFailed"),
			);
		} finally {
			setLoading(false);
		}
	}, [t]);

	useEffect(() => {
		void loadSettings();
	}, [loadSettings]);

	useEffect(() => {
		setInterfaceLanguage(normalizeLocale(user?.language ?? getAppLocale()));
	}, [user?.language]);

	const handleLanguageSave = useCallback(async () => {
		const targetLocale = normalizeLocale(interfaceLanguage);
		const previousLocale = getAppLocale();
		setLanguageSaving(true);
		try {
			await setAppLocale(targetLocale);
			if (isAuthenticated) {
				await updateCurrentUserProfile({ language: targetLocale });
				await refreshUser();
			}
			messageApi.success(t("settings.language.saved"));
		} catch (err) {
			await setAppLocale(previousLocale);
			messageApi.error(
				err instanceof Error ? err.message : t("settings.language.saveFailed"),
			);
		} finally {
			setLanguageSaving(false);
		}
	}, [interfaceLanguage, isAuthenticated, refreshUser, t]);

	const handleSave = useCallback(async () => {
		if (!isAuthenticated) {
			messageApi.warning(t("settings.general.authRequired"));
			return;
		}
		if (hasShortcutConflict) {
			messageApi.error(t("settings.general.shortcutConflict"));
			return;
		}

		setSaving(true);
		try {
			const documentBlockShortcuts = toShortcutPayload(
				documentBlockShortcutForm,
			);
			const updated = await updateGeneralSettings({
				useRemoteKnowledgeBase,
				documentAutoSync,
				trashAutoCleanupEnabled,
				trashAutoCleanupDays,
				documentBlockShortcuts,
			});
			setUseRemoteKnowledgeBase(updated.useRemoteKnowledgeBase);
			setDocumentAutoSync(updated.documentAutoSync);
			setTrashAutoCleanupEnabled(updated.trashAutoCleanupEnabled);
			setTrashAutoCleanupDays(updated.trashAutoCleanupDays);
			setDocumentBlockShortcutForm(
				toBlockShortcutFormValue(updated.documentBlockShortcuts),
			);
			setRemoteKnowledgeBaseEnabled(updated.useRemoteKnowledgeBase);
			window.dispatchEvent(
				new CustomEvent("zeus:general-settings-updated", {
					detail: updated,
				}),
			);
			messageApi.success(t("settings.general.saved"));
		} catch (err) {
			messageApi.error(
				err instanceof Error ? err.message : t("settings.general.saveFailed"),
			);
		} finally {
			setSaving(false);
		}
	}, [
		documentAutoSync,
		documentBlockShortcutForm,
		hasShortcutConflict,
		isAuthenticated,
		t,
		trashAutoCleanupDays,
		trashAutoCleanupEnabled,
		useRemoteKnowledgeBase,
	]);

	const handleShortcutChange = useCallback(
		(blockType: BuiltinBlockType, nextRawValue: string) => {
			const normalized = normalizeShortcutValue(nextRawValue);
			setDocumentBlockShortcutForm((prev) => ({
				...prev,
				[blockType]: normalized,
			}));
		},
		[],
	);

	const handleResetDefaultShortcuts = useCallback(() => {
		setDocumentBlockShortcutForm(
			toBlockShortcutFormValue(DEFAULT_DOCUMENT_BLOCK_SHORTCUTS),
		);
	}, []);

	const handleTrashDaysChange = useCallback((nextRawValue: string) => {
		const parsed = Number(nextRawValue);
		if (!Number.isFinite(parsed)) {
			setTrashAutoCleanupDays(30);
			return;
		}
		const next = Math.min(3650, Math.max(1, Math.floor(parsed)));
		setTrashAutoCleanupDays(next);
	}, []);

	const loadingContent = (
		<div className="general-settings-loading">
			<Spin size="small" />
			<span>{t("settings.general.loading")}</span>
		</div>
	);

	return (
		<div className="general-settings-panel">
			<div className="settings-content-header">
				<h2 className="settings-content-title">
					{t("settings.general.title")}
				</h2>
			</div>

			<Card
				className="general-settings-card"
				title={t("settings.language.cardTitle")}
			>
				<div className="general-settings-row">
					<div className="general-settings-row-main">
						<div className="general-settings-row-title">
							<span>{t("settings.language.title")}</span>
						</div>
						<div className="general-settings-row-desc">
							{t("settings.language.description")}
						</div>
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
						<Select
							value={interfaceLanguage}
							options={languageOptions}
							onChange={(value) => setInterfaceLanguage(normalizeLocale(value))}
							disabled={languageSaving}
							style={{ minWidth: 160 }}
						/>
						<Button
							type="primary"
							onClick={() => void handleLanguageSave()}
							loading={languageSaving}
						>
							{t("settings.language.save")}
						</Button>
					</div>
				</div>
			</Card>

			{!isAuthenticated ? (
				<Alert
					className="general-settings-auth-alert"
					type="warning"
					showIcon
					icon={<LockOutlined />}
					message={t("settings.general.authRequired")}
				/>
			) : null}

			<Card
				className="general-settings-card"
				title={t("settings.remoteKnowledge.title")}
			>
				{loading ? (
					loadingContent
				) : (
					<>
						<div className="general-settings-row">
							<div className="general-settings-row-main">
								<div className="general-settings-row-title">
									<CloudServerOutlined />
									<span>{t("settings.remoteKnowledge.useRemote.title")}</span>
								</div>
								<div className="general-settings-row-desc">
									{t("settings.remoteKnowledge.useRemote.description")}
								</div>
							</div>
							<Switch
								checked={useRemoteKnowledgeBase}
								onChange={setUseRemoteKnowledgeBase}
								disabled={!isAuthenticated || saving}
							/>
						</div>

						<div className="general-settings-row">
							<div className="general-settings-row-main">
								<div className="general-settings-row-title">
									<SyncOutlined />
									<span>{t("settings.remoteKnowledge.sync.title")}</span>
								</div>
								<div className="general-settings-row-desc">
									{t("settings.remoteKnowledge.sync.description")}
								</div>
							</div>
							<Switch
								checked={documentAutoSync}
								onChange={setDocumentAutoSync}
								disabled={!isAuthenticated || saving}
							/>
						</div>

						{remoteKnowledgeBaseUrl ? (
							<div className="general-settings-remote-url">
								<InfoCircleOutlined />
								<span>
									{t("settings.remoteKnowledge.urlPrefix")}
									{remoteKnowledgeBaseUrl}
								</span>
							</div>
						) : (
							<Alert
								className="general-settings-url-alert"
								type="info"
								showIcon
								icon={<InfoCircleOutlined />}
								message={t("settings.remoteKnowledge.urlMissing")}
							/>
						)}
					</>
				)}
			</Card>

			<Card className="general-settings-card" title={t("settings.trash.title")}>
				{loading ? (
					loadingContent
				) : (
					<>
						<div className="general-settings-row">
							<div className="general-settings-row-main">
								<div className="general-settings-row-title">
									<SyncOutlined />
									<span>{t("settings.trash.enabled.title")}</span>
								</div>
								<div className="general-settings-row-desc">
									{t("settings.trash.enabled.description")}
								</div>
							</div>
							<Switch
								checked={trashAutoCleanupEnabled}
								onChange={setTrashAutoCleanupEnabled}
								disabled={!isAuthenticated || saving}
							/>
						</div>
						<div className="general-settings-shortcut-row">
							<span className="general-settings-shortcut-label">
								{t("settings.trash.daysLabel")}
							</span>
							<Input
								className="general-settings-shortcut-input"
								type="number"
								min={1}
								max={3650}
								value={String(trashAutoCleanupDays)}
								onChange={(event) => handleTrashDaysChange(event.target.value)}
								disabled={
									!isAuthenticated || saving || !trashAutoCleanupEnabled
								}
							/>
						</div>
					</>
				)}
			</Card>

			<Card
				className="general-settings-card"
				title={t("settings.shortcuts.title")}
			>
				{loading ? (
					loadingContent
				) : (
					<div className="general-settings-shortcuts">
						<div className="general-settings-shortcuts-header">
							<div className="general-settings-row-desc">
								{t("settings.shortcuts.description")}
							</div>
							<Button
								size="small"
								onClick={handleResetDefaultShortcuts}
								disabled={!isAuthenticated || loading || saving}
							>
								{t("settings.shortcuts.reset")}
							</Button>
						</div>
						{DOCUMENT_BLOCK_SHORTCUT_FIELDS.map((field) => {
							const shortcutValue = documentBlockShortcutForm[field.id] ?? "";
							const hasConflict = shortcutConflictMap[field.id] === true;
							return (
								<div
									key={field.id}
									className={
										hasConflict
											? "general-settings-shortcut-row conflict"
											: "general-settings-shortcut-row"
									}
								>
									<span className="general-settings-shortcut-label">
										{blockLabelById[field.id] ?? field.label}
									</span>
									<Input
										className="general-settings-shortcut-input"
										value={shortcutValue}
										maxLength={16}
										onChange={(event) =>
											handleShortcutChange(field.id, event.target.value)
										}
										disabled={!isAuthenticated || saving || loading}
										placeholder="-"
									/>
								</div>
							);
						})}
						{hasShortcutConflict ? (
							<div className="general-settings-shortcut-error">
								{t("settings.shortcuts.conflict")}
							</div>
						) : null}
					</div>
				)}
			</Card>

			<div className="general-settings-actions">
				<Button
					type="primary"
					onClick={handleSave}
					loading={saving}
					disabled={!isAuthenticated || loading || hasShortcutConflict}
				>
					{t("settings.actions.save")}
				</Button>
			</div>
		</div>
	);
}

export default GeneralSettingsPanel;
