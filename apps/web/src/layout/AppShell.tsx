import { useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
	AppstoreOutlined,
	BookOutlined,
	FileTextOutlined,
	RobotOutlined,
} from "@ant-design/icons";
import { useAppFeedback } from "../hooks/useAppFeedback";
import { useTranslation } from "react-i18next";

import Sidebar from "../components/Sidebar";
import SettingsModal from "../components/SettingsModal";
import CommandPalette from "../components/CommandPalette";
import { useAuth } from "../context/AuthContext";
import { useProjectContext } from "../context/ProjectContext";
import { usePluginRuntime } from "../context/PluginRuntimeContext";

type AppShellProps = {
	children: ReactNode;
};

function AppShell({ children }: AppShellProps) {
	const { messageApi } = useAppFeedback();
	const { t } = useTranslation("common");
	const location = useLocation();
	const navigate = useNavigate();
	const [settingsOpen, setSettingsOpen] = useState(false);
	const { user, isAuthenticated, logout } = useAuth();
	const { currentProject } = useProjectContext();
	const { sidebarMenus, runMenuAction } = usePluginRuntime();

	const coreNavItems = useMemo(
		() => [
			{
				label: t("shell.nav.aiAssistant"),
				to: "/chat",
				icon: <RobotOutlined />,
			},
			{
				label: t("shell.nav.documents"),
				to: "/documents",
				icon: <FileTextOutlined />,
			},
			{ label: t("shell.nav.edu"), to: "/edu", icon: <BookOutlined /> },
		],
		[t],
	);

	const navItems = useMemo(() => {
		const pluginItems = sidebarMenus.map((menuItem) => ({
			label: menuItem.title,
			to: menuItem.route,
			icon: <AppstoreOutlined />,
			onClick: menuItem.route
				? undefined
				: () => {
						void runMenuAction(menuItem).catch((err) => {
							const msg =
								err instanceof Error
									? err.message
									: t("shell.messages.pluginMenuFailed");
							messageApi.error(msg);
						});
					},
		}));

		return [...coreNavItems, ...pluginItems];
	}, [coreNavItems, runMenuAction, sidebarMenus, t]);

	const activeIndex = useMemo(() => {
		const path = location.pathname;
		const index = navItems.findIndex(
			(item) => item.to && path.startsWith(item.to),
		);
		return index === -1 ? -1 : index;
	}, [location.pathname, navItems]);

	const isDocumentPageRoute = useMemo(() => {
		if (location.pathname === "/documents") {
			return true;
		}
		if (location.pathname === "/documents/new") {
			return true;
		}
		return /^\/documents\/[^/]+$/.test(location.pathname);
	}, [location.pathname]);

	const handleLogout = async () => {
		try {
			await logout();
			messageApi.success(t("shell.messages.logoutSuccess"));
			navigate("/login");
		} catch {
			messageApi.error(t("shell.messages.logoutFailure"));
		}
	};

	return (
		<div className="app-shell">
			<div className="app-body compact">
				<Sidebar
					items={navItems}
					activeIndex={activeIndex}
					settingsActive={settingsOpen}
					onLoginClick={() => {
						setSettingsOpen(false);
						navigate("/login");
					}}
					onTeamsClick={() => {
						setSettingsOpen(false);
						navigate("/teams");
					}}
					onSettingsClick={() => setSettingsOpen(true)}
					onTutorialDocsClick={() => {
						setSettingsOpen(false);
						navigate("/system-docs");
					}}
					user={isAuthenticated ? user : null}
					messageCenterProjectKey={currentProject?.projectRef ?? null}
					onLogout={handleLogout}
				/>
				<main
					className={`content${isDocumentPageRoute ? " content--flush" : ""}`}
				>
					{children}
				</main>
			</div>

			<SettingsModal
				isOpen={settingsOpen}
				onClose={() => setSettingsOpen(false)}
			/>
			<CommandPalette />
		</div>
	);
}

export default AppShell;
