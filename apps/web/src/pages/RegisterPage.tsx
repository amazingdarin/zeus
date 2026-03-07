import React, { useState } from "react";
import { Button, Card, Divider, Form, Input, Typography } from "antd";
import { useAppFeedback } from "../hooks/useAppFeedback";
import { UserOutlined, LockOutlined, MailOutlined } from "@ant-design/icons";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAuth } from "../context/AuthContext";

const { Title, Text } = Typography;

interface RegisterFormValues {
	email: string;
	username: string;
	password: string;
	confirmPassword: string;
	display_name?: string;
}

export function RegisterPage() {
	const { messageApi } = useAppFeedback();
	const { t } = useTranslation("auth");
	const [loading, setLoading] = useState(false);
	const { register } = useAuth();
	const navigate = useNavigate();
	const location = useLocation();
	const from = (location.state as { from?: string })?.from || "/";

	const onFinish = async (values: RegisterFormValues) => {
		setLoading(true);
		try {
			await register({
				email: values.email,
				username: values.username,
				password: values.password,
				display_name: values.display_name,
			});
			messageApi.success(t("auth.register.success"));
			navigate(from, { replace: true });
		} catch (error) {
			messageApi.error(
				error instanceof Error ? error.message : t("auth.register.failure"),
			);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="login-page">
			<Card className="login-card">
				<div style={{ textAlign: "center", marginBottom: 24 }}>
					<Title level={2} className="login-logo">
						{t("auth.register.heading")}
					</Title>
					<Text type="secondary">{t("auth.register.subtitle")}</Text>
				</div>

				<Form
					name="register"
					onFinish={onFinish}
					autoComplete="off"
					layout="vertical"
					size="large"
				>
					<Form.Item
						name="email"
						rules={[
							{ required: true, message: t("auth.register.emailRequired") },
							{ type: "email", message: t("auth.register.emailInvalid") },
						]}
					>
						<Input
							prefix={<MailOutlined />}
							placeholder={t("auth.register.emailPlaceholder")}
						/>
					</Form.Item>

					<Form.Item
						name="username"
						rules={[
							{ required: true, message: t("auth.register.usernameRequired") },
							{ min: 3, max: 30, message: t("auth.register.usernameLength") },
							{
								pattern: /^[a-zA-Z][a-zA-Z0-9_-]*$/,
								message: t("auth.register.usernamePattern"),
							},
						]}
					>
						<Input
							prefix={<UserOutlined />}
							placeholder={t("auth.register.usernamePlaceholder")}
						/>
					</Form.Item>

					<Form.Item name="display_name">
						<Input
							prefix={<UserOutlined />}
							placeholder={t("auth.register.displayNamePlaceholder")}
						/>
					</Form.Item>

					<Form.Item
						name="password"
						rules={[
							{ required: true, message: t("auth.register.passwordRequired") },
							{ min: 8, message: t("auth.register.passwordLength") },
						]}
					>
						<Input.Password
							prefix={<LockOutlined />}
							placeholder={t("auth.register.passwordPlaceholder")}
						/>
					</Form.Item>

					<Form.Item
						name="confirmPassword"
						dependencies={["password"]}
						rules={[
							{
								required: true,
								message: t("auth.register.confirmPasswordRequired"),
							},
							({ getFieldValue }) => ({
								validator(_, value) {
									if (!value || getFieldValue("password") === value) {
										return Promise.resolve();
									}
									return Promise.reject(
										new Error(t("auth.register.passwordMismatch")),
									);
								},
							}),
						]}
					>
						<Input.Password
							prefix={<LockOutlined />}
							placeholder={t("auth.register.confirmPasswordPlaceholder")}
						/>
					</Form.Item>

					<Form.Item>
						<Button type="primary" htmlType="submit" loading={loading} block>
							{t("auth.register.title")}
						</Button>
					</Form.Item>
				</Form>

				<Divider>{t("auth.register.or")}</Divider>

				<div style={{ textAlign: "center" }}>
					<Text>{t("auth.register.hasAccount")}</Text>
					<Link to="/login" state={{ from }}>
						{" "}
						{t("auth.register.loginNow")}
					</Link>
				</div>
			</Card>
		</div>
	);
}
