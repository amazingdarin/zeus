import React, { useMemo, useState } from "react";
import {
	Button,
	Card,
	Checkbox,
	Divider,
	Form,
	Input,
	Modal,
	Typography,
} from "antd";
import { useAppFeedback } from "../hooks/useAppFeedback";
import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { getRememberedEmail } from "../api/auth";
import { useAuth } from "../context/AuthContext";

const { Title, Text } = Typography;

interface LoginFormValues {
	email: string;
	password: string;
	remember_me?: boolean;
}

function isDesktopRuntime(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	const currentWindow = window as Window & {
		__TAURI__?: unknown;
		__TAURI_INTERNALS__?: unknown;
	};
	return (
		typeof currentWindow.__TAURI__ !== "undefined" ||
		typeof currentWindow.__TAURI_INTERNALS__ !== "undefined"
	);
}

export function LoginPage() {
	const { messageApi } = useAppFeedback();
	const { t } = useTranslation("auth");
	const [loading, setLoading] = useState(false);
	const { login } = useAuth();
	const navigate = useNavigate();
	const location = useLocation();
	const desktopRuntime = isDesktopRuntime();
	const from = (location.state as { from?: string })?.from || "/";

	const initialValues = useMemo(() => {
		const rememberedEmail = getRememberedEmail();
		return {
			email: rememberedEmail || "",
			remember_me: !!rememberedEmail,
		};
	}, []);

	const onFinish = async (values: LoginFormValues) => {
		setLoading(true);
		try {
			await login(values);
			messageApi.success(t("auth.login.success"));
			navigate(from, { replace: true });
		} catch (error) {
			messageApi.error(
				error instanceof Error ? error.message : t("auth.login.failure"),
			);
		} finally {
			setLoading(false);
		}
	};

	const loginFormContent = (
		<>
			<div style={{ textAlign: "center", marginBottom: 24 }}>
				<Title level={2} className="login-logo">
					{t("auth.login.heading")}
				</Title>
				<Text type="secondary">{t("auth.login.subtitle")}</Text>
			</div>

			<Form
				name="login"
				onFinish={onFinish}
				initialValues={initialValues}
				autoComplete="off"
				layout="vertical"
				size="large"
			>
				<Form.Item
					name="email"
					rules={[
						{ required: true, message: t("auth.login.emailRequired") },
						{ type: "email", message: t("auth.login.emailInvalid") },
					]}
				>
					<Input
						prefix={<MailOutlined />}
						placeholder={t("auth.login.emailPlaceholder")}
					/>
				</Form.Item>

				<Form.Item
					name="password"
					rules={[
						{ required: true, message: t("auth.login.passwordRequired") },
					]}
				>
					<Input.Password
						prefix={<LockOutlined />}
						placeholder={t("auth.login.passwordPlaceholder")}
					/>
				</Form.Item>

				<Form.Item name="remember_me" valuePropName="checked">
					<Checkbox>{t("auth.login.rememberMe")}</Checkbox>
				</Form.Item>

				<Form.Item>
					<Button type="primary" htmlType="submit" loading={loading} block>
						{t("auth.login.submit")}
					</Button>
				</Form.Item>
			</Form>

			<Divider>{t("auth.login.or")}</Divider>

			<div style={{ textAlign: "center" }}>
				<Text>{t("auth.login.noAccount")}</Text>
				<Link to="/register" state={{ from }}>
					{" "}
					{t("auth.login.registerNow")}
				</Link>
			</div>
		</>
	);

	if (desktopRuntime) {
		return (
			<div className="login-page">
				<Modal
					open
					centered
					footer={null}
					width={420}
					maskClosable={false}
					onCancel={() => navigate("/", { replace: true })}
					destroyOnClose
				>
					{loginFormContent}
				</Modal>
			</div>
		);
	}

	return (
		<div className="login-page">
			<Card className="login-card">{loginFormContent}</Card>
		</div>
	);
}
