import React, { useState, useEffect } from "react";
import {
	Card,
	List,
	Button,
	Typography,
	Modal,
	Form,
	Input,
	Empty,
	Avatar,
	Tag,
	Space,
} from "antd";
import { useAppFeedback } from "../hooks/useAppFeedback";
import { PlusOutlined, TeamOutlined, SettingOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Team, listTeams, createTeam, CreateTeamRequest } from "../api/teams";
import { useProjectContext } from "../context/ProjectContext";

const { Title, Text } = Typography;

export function TeamsPage() {
	const { t } = useTranslation("team");
	const { messageApi } = useAppFeedback();
	const [teams, setTeams] = useState<Team[]>([]);
	const [loading, setLoading] = useState(true);
	const [createModalVisible, setCreateModalVisible] = useState(false);
	const [createLoading, setCreateLoading] = useState(false);
	const [form] = Form.useForm();
	const navigate = useNavigate();
	const { reloadProjects } = useProjectContext();

	const fetchTeams = async () => {
		try {
			const data = await listTeams();
			setTeams(data);
			void reloadProjects().catch(() => undefined);
		} catch (error) {
			messageApi.error(t("team.list.loadFailed"));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchTeams();
	}, []);

	const handleCreate = async (values: CreateTeamRequest) => {
		setCreateLoading(true);
		try {
			await createTeam(values);
			messageApi.success(t("team.create.success"));
			setCreateModalVisible(false);
			form.resetFields();
			fetchTeams();
		} catch (error) {
			messageApi.error(error instanceof Error ? error.message : t("team.create.failed"));
		} finally {
			setCreateLoading(false);
		}
	};

	const generateSlug = (name: string) => {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40);
	};

	return (
		<div className="teams-page">
			<div className="teams-page-header">
				<Title level={2} style={{ margin: 0 }} className="teams-page-title">
					{t("team.list.title")}
				</Title>
				<Button
					type="primary"
					icon={<PlusOutlined />}
					onClick={() => setCreateModalVisible(true)}
				>
					{t("team.list.create")}
				</Button>
			</div>

			{teams.length === 0 && !loading ? (
				<Card>
					<Empty
						description={t("team.list.empty")}
						image={Empty.PRESENTED_IMAGE_SIMPLE}
					>
						<Button type="primary" onClick={() => setCreateModalVisible(true)}>
							{t("team.list.createFirst")}
						</Button>
					</Empty>
				</Card>
			) : (
				<List
					className="teams-page-list"
					loading={loading}
					grid={{ gutter: 16, xs: 1, sm: 1, md: 1, lg: 2, xl: 2, xxl: 3 }}
					dataSource={teams}
					renderItem={(team) => (
						<List.Item className="teams-page-list-item">
							<Card
								className="teams-page-card"
								hoverable
								onClick={() => navigate(`/teams/${team.slug}`)}
								actions={[
									<Button
										className="teams-page-settings-btn"
										type="text"
										icon={<SettingOutlined />}
										onClick={(e) => {
											e.stopPropagation();
											navigate(`/teams/${team.slug}/settings`);
										}}
									>
										{t("team.list.manage")}
									</Button>,
								]}
							>
								<Card.Meta
									avatar={
										team.avatar_url ? (
											<Avatar src={team.avatar_url} size={48} />
										) : (
											<Avatar
												icon={<TeamOutlined />}
												size={48}
												style={{ backgroundColor: "#1890ff" }}
											/>
										)
									}
									title={
										<Space>
											<span>{team.name}</span>
											{team.status === "archived" && (
												<Tag color="orange">{t("team.list.archived")}</Tag>
											)}
										</Space>
									}
									description={
										<div>
											<Text type="secondary" style={{ display: "block" }}>
												@{team.slug}
											</Text>
											{team.description && (
												<Text
													type="secondary"
													ellipsis
													style={{ display: "block", marginTop: 4 }}
												>
													{team.description}
												</Text>
											)}
										</div>
									}
								/>
							</Card>
						</List.Item>
					)}
				/>
			)}

			<Modal
				title={t("team.create.title")}
				open={createModalVisible}
				onCancel={() => {
					setCreateModalVisible(false);
					form.resetFields();
				}}
				footer={null}
			>
				<Form form={form} layout="vertical" onFinish={handleCreate}>
					<Form.Item
						name="name"
						label={t("team.create.name")}
						rules={[
							{ required: true, message: t("team.create.nameRequired") },
							{ max: 100, message: t("team.create.nameLength") },
						]}
					>
						<Input
							placeholder={t("team.create.namePlaceholder")}
							onChange={(e) => {
								const slug = generateSlug(e.target.value);
								form.setFieldValue("slug", slug);
							}}
						/>
					</Form.Item>

					<Form.Item
						name="slug"
						label={t("team.create.slug")}
						rules={[
							{ required: true, message: t("team.create.slugRequired") },
							{ min: 3, max: 40, message: t("team.create.slugLength") },
							{
								pattern: /^[a-z][a-z0-9-]*$/,
								message:
									t("team.create.slugPattern"),
							},
						]}
						extra={t("team.create.slugHint")}
					>
						<Input placeholder={t("team.create.slugPlaceholder")} />
					</Form.Item>

					<Form.Item name="description" label={t("team.create.description")}>
						<Input.TextArea placeholder={t("team.create.descriptionPlaceholder")} rows={3} />
					</Form.Item>

					<Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
						<Space>
							<Button
								onClick={() => {
									setCreateModalVisible(false);
									form.resetFields();
								}}
							>
								{t("common.cancel")}
							</Button>
							<Button type="primary" htmlType="submit" loading={createLoading}>
								{t("team.list.create")}
							</Button>
						</Space>
					</Form.Item>
				</Form>
			</Modal>
		</div>
	);
}
