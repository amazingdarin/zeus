import React, { useState, useEffect, useMemo } from "react";
import {
	Card,
	Tabs,
	Form,
	Input,
	Button,
	Table,
	Tag,
	Space,
	Modal,
	Select,
	Popconfirm,
	Typography,
	Avatar,
	QRCode,
} from "antd";
import { useAppFeedback } from "../hooks/useAppFeedback";
import {
	UserOutlined,
	MailOutlined,
	DeleteOutlined,
	TeamOutlined,
	LinkOutlined,
	CopyOutlined,
	ArrowLeftOutlined,
} from "@ant-design/icons";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
	Team,
	TeamMember,
	TeamInvitation,
	TeamJoinLink,
	getTeam,
	updateTeam,
	deleteTeam,
	listTeamMembers,
	updateMemberRole,
	removeMember,
	listInvitations,
	inviteMember,
	createTeamJoinLink,
	UpdateTeamRequest,
	InviteMemberRequest,
} from "../api/teams";
import { useAuth } from "../context/AuthContext";

const { Title, Text } = Typography;

export function TeamSettingsPage() {
	const { t } = useTranslation(["team", "common"]);
	const { messageApi } = useAppFeedback();
	const { slug } = useParams<{ slug: string }>();
	const navigate = useNavigate();
	const location = useLocation();
	const { user } = useAuth();

	const [team, setTeam] = useState<Team | null>(null);
	const [members, setMembers] = useState<TeamMember[]>([]);
	const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
	const [loading, setLoading] = useState(true);
	const [inviteModalVisible, setInviteModalVisible] = useState(false);
	const [inviteLoading, setInviteLoading] = useState(false);
	const [inviteTab, setInviteTab] = useState<"email" | "link">("email");
	const [joinLinkRole, setJoinLinkRole] = useState<
		"admin" | "member" | "viewer"
	>("member");
	const [joinLinkLoading, setJoinLinkLoading] = useState(false);
	const [joinLink, setJoinLink] = useState<TeamJoinLink | null>(null);
	const [form] = Form.useForm();
	const [inviteForm] = Form.useForm();

	const isOwner = team?.owner_id === user?.id;
	const currentMember = members.find((m) => m.user_id === user?.id);
	const canManage =
		currentMember?.role === "owner" || currentMember?.role === "admin";
	const isSettingsRoute = location.pathname.endsWith("/settings");

	const inviteLinkUrl = useMemo(() => {
		if (!joinLink) {
			return "";
		}
		return `${window.location.origin}${window.location.pathname}${window.location.search}#/invite/${encodeURIComponent(joinLink.token)}`;
	}, [joinLink]);

	const fetchData = async () => {
		if (!slug) return;
		try {
			const [teamData, membersData] = await Promise.all([
				getTeam(slug),
				listTeamMembers(slug),
			]);
			const member = membersData.find((m) => m.user_id === user?.id);
			const canManageMembers =
				member?.role === "owner" || member?.role === "admin";
			const invitationsData = canManageMembers
				? await listInvitations(slug)
				: [];
			setTeam(teamData);
			setMembers(membersData);
			setInvitations(invitationsData);
			form.setFieldsValue({
				name: teamData.name,
				description: teamData.description,
			});
		} catch (error) {
			messageApi.error(t("team.settings.loadFailed"));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchData();
	}, [slug, user?.id]);

	const handleUpdateTeam = async (values: UpdateTeamRequest) => {
		if (!slug) return;
		try {
			await updateTeam(slug, values);
			messageApi.success(t("team.settings.updated"));
			fetchData();
		} catch (error) {
			messageApi.error(error instanceof Error ? error.message : t("team.settings.updateFailed"));
		}
	};

	const handleDeleteTeam = async () => {
		if (!slug) return;
		try {
			await deleteTeam(slug);
			messageApi.success(t("team.settings.deleted"));
			navigate("/teams");
		} catch (error) {
			messageApi.error(error instanceof Error ? error.message : t("team.settings.deleteFailed"));
		}
	};

	const handleRoleChange = async (userId: string, role: string) => {
		if (!slug) return;
		try {
			await updateMemberRole(slug, userId, role);
			messageApi.success(t("team.settings.roleUpdated"));
			fetchData();
		} catch (error) {
			messageApi.error(error instanceof Error ? error.message : t("team.settings.updateFailed"));
		}
	};

	const handleRemoveMember = async (userId: string) => {
		if (!slug) return;
		try {
			await removeMember(slug, userId);
			messageApi.success(t("team.settings.memberRemoved"));
			fetchData();
		} catch (error) {
			messageApi.error(error instanceof Error ? error.message : t("team.settings.removeFailed"));
		}
	};

	const handleInvite = async (values: InviteMemberRequest) => {
		if (!slug) return;
		setInviteLoading(true);
		try {
			await inviteMember(slug, values);
			messageApi.success(t("team.settings.inviteSent"));
			setInviteModalVisible(false);
			inviteForm.resetFields();
			inviteForm.setFieldValue("role", "member");
			fetchData();
		} catch (error) {
			messageApi.error(error instanceof Error ? error.message : t("team.settings.inviteFailed"));
		} finally {
			setInviteLoading(false);
		}
	};

	const handleCreateJoinLink = async () => {
		if (!slug) return;
		setJoinLinkLoading(true);
		try {
			const link = await createTeamJoinLink(slug, { role: joinLinkRole });
			setJoinLink(link);
			messageApi.success(t("team.settings.joinLinkCreated"));
		} catch (error) {
			messageApi.error(
				error instanceof Error ? error.message : t("team.settings.joinLinkFailed"),
			);
		} finally {
			setJoinLinkLoading(false);
		}
	};

	const handleCopyJoinLink = async () => {
		if (!inviteLinkUrl) {
			return;
		}
		try {
			await navigator.clipboard.writeText(inviteLinkUrl);
			messageApi.success(t("team.settings.joinLinkCopied"));
		} catch {
			messageApi.error(t("team.settings.copyFailed"));
		}
	};

	const openInviteModal = () => {
		setInviteModalVisible(true);
		setInviteTab("email");
		setJoinLinkRole("member");
		setJoinLink(null);
		inviteForm.resetFields();
		inviteForm.setFieldValue("role", "member");
	};

	const closeInviteModal = () => {
		setInviteModalVisible(false);
		setInviteTab("email");
		setJoinLinkRole("member");
		setJoinLink(null);
		inviteForm.resetFields();
		inviteForm.setFieldValue("role", "member");
	};

	const memberColumns = [
		{
			title: t("team.role.member"),
			key: "user",
			render: (_: unknown, record: TeamMember) => (
				<Space>
					<Avatar icon={<UserOutlined />} src={record.user?.avatar_url} />
					<div>
						<div>{record.user?.display_name || record.user?.username}</div>
						<Text type="secondary" style={{ fontSize: 12 }}>
							@{record.user?.username}
						</Text>
					</div>
				</Space>
			),
		},
		{
			title: t("team.members.column.role"),
			key: "role",
			render: (_: unknown, record: TeamMember) => {
				const roleClassNames: Record<string, string> = {
					owner: "team-role-tag-owner",
					admin: "team-role-tag-admin",
					member: "team-role-tag-member",
					viewer: "team-role-tag-viewer",
				};
				const roleLabels: Record<string, string> = {
					owner: t("team.role.owner"),
					admin: t("team.role.admin"),
					member: t("team.role.member"),
					viewer: t("team.role.viewer"),
				};
				if (!canManage || record.role === "owner") {
					const roleClassName =
						roleClassNames[record.role] || "team-role-tag-viewer";
					return (
						<Tag className={`team-role-tag ${roleClassName}`}>
							{roleLabels[record.role] || record.role}
						</Tag>
					);
				}
				return (
					<Select
						value={record.role}
						style={{ width: 100 }}
						onChange={(value) => handleRoleChange(record.user_id, value)}
						options={[
							{ value: "admin", label: t("team.role.admin") },
							{ value: "member", label: t("team.role.member") },
							{ value: "viewer", label: t("team.role.viewer") },
						]}
					/>
				);
			},
		},
		{
			title: t("team.members.column.joinedAt"),
			dataIndex: "joined_at",
			key: "joined_at",
			render: (date: string) => new Date(date).toLocaleDateString(),
		},
		{
			title: t("team.members.column.action"),
			key: "action",
			render: (_: unknown, record: TeamMember) => {
				if (record.role === "owner" || !canManage) return null;
				return (
					<Popconfirm
						title={t("team.members.removeConfirm")}
						onConfirm={() => handleRemoveMember(record.user_id)}
					>
						<Button type="text" danger icon={<DeleteOutlined />} />
					</Popconfirm>
				);
			},
		},
	];

	const invitationColumns = [
		{
			title: t("team.invitations.column.email"),
			dataIndex: "email",
			key: "email",
		},
		{
			title: t("team.members.column.role"),
			dataIndex: "role",
			key: "role",
			render: (role: string) => {
				const labels: Record<string, string> = {
					admin: t("team.role.admin"),
					member: t("team.role.member"),
					viewer: t("team.role.viewer"),
				};
				return labels[role] || role;
			},
		},
		{
			title: t("team.invitations.column.status"),
			dataIndex: "status",
			key: "status",
			render: (status: string) => {
				const statusClassNames: Record<string, string> = {
					pending: "team-status-tag-pending",
					accepted: "team-status-tag-accepted",
					expired: "team-status-tag-expired",
					cancelled: "team-status-tag-cancelled",
				};
				const labels: Record<string, string> = {
					pending: t("team.invitation.pending"),
					accepted: t("team.invitation.accepted"),
					expired: t("team.invitation.expired"),
					cancelled: t("team.invitation.cancelled"),
				};
				const statusClassName =
					statusClassNames[status] || "team-status-tag-expired";
				return (
					<Tag className={`team-status-tag ${statusClassName}`}>
						{labels[status] || status}
					</Tag>
				);
			},
		},
		{
			title: t("team.invitations.column.expiresAt"),
			dataIndex: "expires_at",
			key: "expires_at",
			render: (date: string) => new Date(date).toLocaleString(),
		},
	];

	if (loading) {
		return (
			<div className="team-settings-page">
				<div className="team-settings-status">加载中...</div>
			</div>
		);
	}

	if (!team) {
		return (
			<div className="team-settings-page">
				<div className="team-settings-status">团队不存在</div>
			</div>
		);
	}

	return (
		<div className="team-settings-page">
			<div className="team-settings-header">
				<Button
					type="text"
					icon={<ArrowLeftOutlined />}
					className="team-settings-back-btn"
					onClick={() => navigate("/teams")}
				>
					返回团队列表
				</Button>
				<Space align="center">
					<Avatar icon={<TeamOutlined />} src={team.avatar_url} size={48} />
					<div>
						<Title
							level={3}
							style={{ margin: 0 }}
							className="team-settings-name"
						>
							{team.name}
						</Title>
						<Text type="secondary" className="team-settings-slug">
							@{team.slug}
						</Text>
					</div>
				</Space>
			</div>

			<Tabs
				key={isSettingsRoute ? "settings" : "detail"}
				defaultActiveKey={isSettingsRoute ? "general" : "members"}
				className="team-settings-tabs"
				items={[
					{
						key: "general",
						label: t("team.tab.basic"),
						children: (
							<Card>
								<Form
									form={form}
									layout="vertical"
									onFinish={handleUpdateTeam}
									disabled={!canManage}
								>
									<Form.Item
										name="name"
										label={t("team.basic.name")}
										rules={[{ required: true, message: t("team.create.nameRequired") }]}
									>
										<Input />
									</Form.Item>
									<Form.Item name="description" label={t("team.basic.description")}>
										<Input.TextArea rows={3} />
									</Form.Item>
									{canManage && (
										<Form.Item>
											<Button type="primary" htmlType="submit">
												保存更改
											</Button>
										</Form.Item>
									)}
								</Form>
							</Card>
						),
					},
					{
						key: "members",
						label: t("team.tab.members"),
						children: (
							<Card
								title={t("team.members.title")}
								extra={
									canManage && (
										<Button
											type="primary"
											icon={<MailOutlined />}
											onClick={openInviteModal}
										>
											邀请成员
										</Button>
									)
								}
							>
								<Table
									dataSource={members}
									columns={memberColumns}
									rowKey="id"
									pagination={false}
								/>

								{canManage && invitations.length > 0 && (
									<>
										<Title level={5} className="team-settings-subsection-title">
											待处理邀请
										</Title>
										<Table
											dataSource={invitations.filter(
												(i) => i.status === "pending",
											)}
											columns={invitationColumns}
											rowKey="id"
											pagination={false}
										/>
									</>
								)}
							</Card>
						),
					},
					...(isOwner
						? [
								{
									key: "danger",
									label: t("team.tab.danger"),
									children: (
										<Card>
											<div style={{ marginBottom: 16 }}>
												<Title level={5} className="team-settings-danger-title">
													删除团队
												</Title>
												<Text type="secondary">
													删除团队后，所有团队项目和数据将被永久删除，此操作不可恢复。
												</Text>
											</div>
											<Popconfirm
												title={t("team.danger.confirmTitle")}
												description={t("team.danger.confirmDescription")}
												onConfirm={handleDeleteTeam}
												okText={t("team.danger.confirmDelete")}
												okButtonProps={{ danger: true }}
											>
												<Button danger>{t("team.danger.delete")}</Button>
											</Popconfirm>
										</Card>
									),
								},
							]
						: []),
				]}
			/>

			<Modal
				className="team-invite-modal"
				title={t("team.invite.title")}
				open={inviteModalVisible}
				onCancel={closeInviteModal}
				footer={null}
			>
				<Tabs
					activeKey={inviteTab}
					onChange={(key) => setInviteTab(key as "email" | "link")}
					items={[
						{
							key: "email",
							label: t("team.invite.tab.email"),
							children: (
								<Form
									form={inviteForm}
									layout="vertical"
									onFinish={handleInvite}
									initialValues={{ role: "member" }}
								>
									<Form.Item
										name="email"
										label={t("team.invite.email")}
										rules={[
											{ required: true, message: t("team.invite.emailRequired") },
											{ type: "email", message: t("team.invite.emailInvalid") },
										]}
									>
										<Input placeholder={t("team.invite.emailPlaceholder")} />
									</Form.Item>
									<Form.Item
										name="role"
										label={t("team.members.column.role")}
										rules={[{ required: true, message: t("team.invite.roleRequired") }]}
									>
										<Select
											className="team-invite-role-select"
											popupClassName="team-invite-select-dropdown"
											options={[
												{ value: "admin", label: t("team.invite.role.adminDetail") },
												{ value: "member", label: t("team.invite.role.memberDetail") },
												{ value: "viewer", label: t("team.invite.role.viewerDetail") },
											]}
										/>
									</Form.Item>
									<Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
										<Space>
											<Button onClick={closeInviteModal}>{t("common.cancel")}</Button>
											<Button
												type="primary"
												htmlType="submit"
												loading={inviteLoading}
											>
												发送邀请
											</Button>
										</Space>
									</Form.Item>
								</Form>
							),
						},
						{
							key: "link",
							label: t("team.invite.tab.link"),
							children: (
								<Space direction="vertical" size={16} style={{ width: "100%" }}>
									<Form layout="vertical">
										<Form.Item label={t("team.invite.joinRole")}>
											<Select
												className="team-invite-role-select"
												popupClassName="team-invite-select-dropdown"
												value={joinLinkRole}
												onChange={(value) =>
													setJoinLinkRole(
														value as "admin" | "member" | "viewer",
													)
												}
												options={[
													{
														value: "admin",
														label: t("team.invite.role.adminDetail"),
													},
													{ value: "member", label: t("team.invite.role.memberDetail") },
													{ value: "viewer", label: t("team.invite.role.viewerDetail") },
												]}
											/>
										</Form.Item>
									</Form>

									<Space>
										<Button
											type="primary"
											icon={<LinkOutlined />}
											loading={joinLinkLoading}
											onClick={handleCreateJoinLink}
										>
											{joinLink ? t("team.invite.regenerate") : t("team.invite.generate")}
										</Button>
										<Text type="secondary" className="team-invite-link-hint">
											{t("team.invite.linkHint")}
										</Text>
									</Space>

									{joinLink ? (
										<Space
											direction="vertical"
											size={12}
											style={{ width: "100%" }}
										>
											<Input
												value={inviteLinkUrl}
												readOnly
												addonAfter={
													<Button
														type="text"
														icon={<CopyOutlined />}
														onClick={handleCopyJoinLink}
													>
														{t("team.invite.copy")}
													</Button>
												}
											/>
											<Space align="start" size={20}>
												<div className="team-invite-qr">
													<QRCode value={inviteLinkUrl} size={160} />
												</div>
												<div>
													<Text
														className="team-invite-qr-title"
														style={{ display: "block" }}
													>
														{t("team.invite.qrTitle")}
													</Text>
													<Text
														type="secondary"
														className="team-invite-qr-expire"
													>
														{t("team.invite.expiresAt")}
														{new Date(joinLink.expires_at).toLocaleString()}
													</Text>
												</div>
											</Space>
										</Space>
									) : null}

									<div style={{ textAlign: "right" }}>
										<Button onClick={closeInviteModal}>{t("team.modal.close")}</Button>
									</div>
								</Space>
							),
						},
					]}
				/>
			</Modal>
		</div>
	);
}
