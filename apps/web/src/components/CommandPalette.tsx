import { useEffect, useMemo, useState } from "react";
import { useAppFeedback } from "../hooks/useAppFeedback";

import { usePluginRuntime } from "../context/PluginRuntimeContext";
import { useProjectContext } from "../context/ProjectContext";

function normalizeText(value: string): string {
	return value.trim().toLowerCase();
}

export default function CommandPalette() {
	const { messageApi } = useAppFeedback();
	const { commands, executeCommand } = usePluginRuntime();
	const { currentProject } = useProjectContext();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [runningCommandId, setRunningCommandId] = useState<string | null>(null);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const isPaletteShortcut =
				(event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
			if (isPaletteShortcut) {
				event.preventDefault();
				setOpen((prev) => !prev);
				return;
			}
			if (event.key === "Escape") {
				setOpen(false);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, []);

	useEffect(() => {
		if (!open) {
			setQuery("");
		}
	}, [open]);

	const filteredCommands = useMemo(() => {
		const keyword = normalizeText(query);
		if (!keyword) return commands;

		return commands.filter((command) => {
			const text = [
				command.commandId,
				command.title,
				command.description,
				command.category || "",
				...(command.slashAliases || []),
			]
				.join(" ")
				.toLowerCase();
			return text.includes(keyword);
		});
	}, [commands, query]);

	const runCommand = async (commandId: string) => {
		if (!currentProject?.projectRef) {
			messageApi.error("请先选择项目");
			return;
		}
		setRunningCommandId(commandId);
		try {
			const result = await executeCommand(
				commandId,
				{},
				currentProject.projectRef,
				"palette",
			);
			const text =
				typeof result?.message === "string"
					? result.message
					: `命令 ${commandId} 执行完成`;
			messageApi.success(text);
			setOpen(false);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "命令执行失败";
			messageApi.error(msg);
		} finally {
			setRunningCommandId(null);
		}
	};

	if (!open) {
		return null;
	}

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				background: "rgba(20, 20, 20, 0.45)",
				zIndex: 1600,
				display: "flex",
				alignItems: "flex-start",
				justifyContent: "center",
				paddingTop: "10vh",
			}}
			onClick={() => setOpen(false)}
		>
			<div
				style={{
					width: "min(760px, 92vw)",
					background: "#ffffff",
					borderRadius: 12,
					boxShadow: "0 18px 36px rgba(0,0,0,0.18)",
					overflow: "hidden",
				}}
				onClick={(event) => event.stopPropagation()}
			>
				<div style={{ padding: 14, borderBottom: "1px solid #efefef" }}>
					<input
						autoFocus
						value={query}
						placeholder="搜索插件命令（Cmd/Ctrl+K）"
						onChange={(event) => setQuery(event.target.value)}
						style={{
							width: "100%",
							border: "none",
							outline: "none",
							fontSize: 15,
						}}
					/>
				</div>
				<div style={{ maxHeight: "56vh", overflowY: "auto" }}>
					{filteredCommands.length === 0 ? (
						<div style={{ padding: 16, color: "#666" }}>没有匹配的插件命令</div>
					) : (
						filteredCommands.map((command) => {
							const running = runningCommandId === command.commandId;
							return (
								<button
									key={`${command.pluginId}:${command.commandId}`}
									type="button"
									onClick={() => void runCommand(command.commandId)}
									disabled={Boolean(runningCommandId)}
									style={{
										width: "100%",
										border: "none",
										borderBottom: "1px solid #f3f3f3",
										textAlign: "left",
										background: "#fff",
										padding: "12px 14px",
										cursor: "pointer",
									}}
								>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											gap: 12,
										}}
									>
										<strong>{command.title}</strong>
										<span style={{ color: "#888", fontSize: 12 }}>
											{command.pluginId}
										</span>
									</div>
									<div style={{ color: "#555", fontSize: 12, marginTop: 4 }}>
										{command.description}
									</div>
									<div style={{ color: "#999", fontSize: 12, marginTop: 6 }}>
										{(command.slashAliases || []).join(" ") ||
											command.commandId}
										{running ? " · 执行中..." : ""}
									</div>
								</button>
							);
						})
					)}
				</div>
			</div>
		</div>
	);
}
