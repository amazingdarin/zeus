import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type UIEvent,
} from "react";
import { Popover, Tooltip } from "antd";
import { useAppFeedback } from "../hooks/useAppFeedback";
import { BellOutlined } from "@ant-design/icons";

import {
	createMessageCenterStream,
	fetchMessageCenter,
	type MessageItem,
} from "../api/message-center";
import { publishMessageCenter } from "../lib/message-center-callbacks";
import { shouldHandleSseDisconnectError } from "../features/chat/sse-error";

const ACTIVE_STATUSES = new Set(["pending", "running"]);
const HISTORY_PAGE_SIZE = 10;
const SCROLL_BOTTOM_THRESHOLD = 24;

const STATUS_LABELS: Record<string, string> = {
	pending: "等待中",
	running: "进行中",
	completed: "已完成",
	failed: "失败",
};

type MessageCenterProps = {
	projectKey: string | null;
};

const getStatusLabel = (status: string) => STATUS_LABELS[status] ?? status;

const isActiveStatus = (status: string) => ACTIVE_STATUSES.has(status);

const mergeItem = (prev: MessageItem, next: MessageItem): MessageItem => {
	return {
		...prev,
		...next,
		progress: {
			...prev.progress,
			...next.progress,
		},
		detail: {
			...(prev.detail || {}),
			...(next.detail || {}),
		},
	};
};

const mergeItemsById = (
	prev: MessageItem[],
	incoming: MessageItem[],
): MessageItem[] => {
	if (incoming.length === 0) {
		return prev;
	}
	const next = new Map(prev.map((item) => [item.id, item]));
	for (const item of incoming) {
		const existing = next.get(item.id);
		next.set(item.id, existing ? mergeItem(existing, item) : item);
	}
	return Array.from(next.values());
};

const computePercent = (item: MessageItem): number => {
	const percent = item.progress?.percent;
	if (typeof percent === "number" && !Number.isNaN(percent)) {
		return Math.min(100, Math.max(0, Math.round(percent)));
	}
	const current = item.progress?.current ?? 0;
	const total = item.progress?.total ?? 0;
	if (total > 0) {
		return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
	}
	return 0;
};

const formatTime = (value: string | undefined) => {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleTimeString();
};

function MessageCenter({ projectKey }: MessageCenterProps) {
	const { messageApi } = useAppFeedback();
	const [items, setItems] = useState<MessageItem[]>([]);
	const [open, setOpen] = useState(false);
	const [historyCursor, setHistoryCursor] = useState<string | undefined>(
		undefined,
	);
	const [historyLoading, setHistoryLoading] = useState(false);
	const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
	const statusRef = useRef<Map<string, string>>(new Map());
	const sourceRef = useRef<EventSource | null>(null);
	const requestTokenRef = useRef(0);

	const loadMoreHistory = useCallback(async () => {
		if (!projectKey || !historyCursor || historyLoadingMore) {
			return;
		}
		const requestToken = requestTokenRef.current;
		setHistoryLoadingMore(true);
		try {
			const data = await fetchMessageCenter(projectKey, {
				limit: HISTORY_PAGE_SIZE,
				cursor: historyCursor,
			});
			if (requestTokenRef.current !== requestToken) {
				return;
			}
			const merged = [...data.active, ...data.history];
			setItems((prev) => mergeItemsById(prev, merged));
			setHistoryCursor(data.nextCursor);
			merged.forEach((item) => {
				statusRef.current.set(item.id, item.status);
			});
		} catch (err) {
			console.error("[message-center] load more history failed", err);
		} finally {
			if (requestTokenRef.current === requestToken) {
				setHistoryLoadingMore(false);
			}
		}
	}, [historyCursor, historyLoadingMore, projectKey]);

	const handleHistoryScroll = useCallback(
		(event: UIEvent<HTMLDivElement>) => {
			if (!historyCursor || historyLoadingMore) {
				return;
			}
			const el = event.currentTarget;
			const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
			if (distanceToBottom <= SCROLL_BOTTOM_THRESHOLD) {
				void loadMoreHistory();
			}
		},
		[historyCursor, historyLoadingMore, loadMoreHistory],
	);

	useEffect(() => {
		requestTokenRef.current += 1;
		const requestToken = requestTokenRef.current;
		statusRef.current.clear();
		setItems([]);
		setHistoryCursor(undefined);
		setHistoryLoading(false);
		setHistoryLoadingMore(false);
		if (!projectKey) {
			return;
		}

		let mounted = true;
		setHistoryLoading(true);
		fetchMessageCenter(projectKey, { limit: HISTORY_PAGE_SIZE })
			.then((data) => {
				if (!mounted || requestTokenRef.current !== requestToken) return;
				const merged = [...data.active, ...data.history];
				setItems(merged);
				setHistoryCursor(data.nextCursor);
				const nextStatus = new Map<string, string>();
				merged.forEach((item) => {
					nextStatus.set(item.id, item.status);
				});
				statusRef.current = nextStatus;
			})
			.catch((err) => {
				console.error("[message-center] load failed", err);
			})
			.finally(() => {
				if (mounted && requestTokenRef.current === requestToken) {
					setHistoryLoading(false);
				}
			});

		return () => {
			mounted = false;
		};
	}, [projectKey]);

	useEffect(() => {
		if (!projectKey) {
			return;
		}

		const source = createMessageCenterStream(projectKey);
		sourceRef.current = source;

		const handleUpdate = (event: MessageEvent) => {
			if (!event.data) {
				return;
			}
			let payload: MessageItem | null = null;
			try {
				payload = JSON.parse(event.data);
			} catch (err) {
				console.warn("[message-center] invalid payload", err);
				return;
			}
			if (!payload || !payload.id) {
				return;
			}

			publishMessageCenter(payload);

			setItems((prev) => mergeItemsById(prev, [payload!]));

			const prevStatus = statusRef.current.get(payload.id);
			if (
				prevStatus &&
				prevStatus !== payload.status &&
				isActiveStatus(prevStatus)
			) {
				const label = getStatusLabel(payload.status);
				if (payload.status === "completed") {
					messageApi.success(`${payload.title} 已完成`);
				} else if (payload.status === "failed") {
					messageApi.error(`${payload.title} 失败`);
				} else {
					messageApi.info(`${payload.title} 状态更新：${label}`);
				}
			}
			statusRef.current.set(payload.id, payload.status);
		};

		source.addEventListener("messageApi.update", handleUpdate as EventListener);

		source.onerror = (err) => {
			if (
				!shouldHandleSseDisconnectError({
					isActiveSource: sourceRef.current === source,
					readyState: source.readyState,
				})
			) {
				return;
			}
			console.debug("[message-center] stream closed", err);
		};

		return () => {
			source.removeEventListener(
				"messageApi.update",
				handleUpdate as EventListener,
			);
			source.close();
			sourceRef.current = null;
		};
	}, [projectKey]);

	const activeItems = useMemo(() => {
		return items
			.filter((item) => isActiveStatus(item.status))
			.sort(
				(a, b) =>
					new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
			);
	}, [items]);

	const historyItems = useMemo(() => {
		return items
			.filter((item) => !isActiveStatus(item.status))
			.sort(
				(a, b) =>
					new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
			);
	}, [items]);

	const runningCount = activeItems.length;

	const renderResultSummary = (item: MessageItem) => {
		const result =
			item.detail && typeof item.detail === "object"
				? (item.detail as Record<string, unknown>).result
				: undefined;
		if (!result || typeof result !== "object") {
			return null;
		}
		const data = result as Record<string, unknown>;
		const directories =
			typeof data.directories === "number" ? data.directories : null;
		const files = typeof data.files === "number" ? data.files : null;
		const skipped = typeof data.skipped === "number" ? data.skipped : null;
		if (directories === null && files === null && skipped === null) {
			return null;
		}
		const parts: string[] = [];
		if (directories !== null) parts.push(`目录 ${directories}`);
		if (files !== null) parts.push(`文件 ${files}`);
		if (skipped !== null && skipped > 0) parts.push(`跳过 ${skipped}`);
		return (
			<div className="message-center-item-summary">{parts.join(" · ")}</div>
		);
	};

	const renderItem = (item: MessageItem) => {
		const percent = computePercent(item);
		const statusLabel = getStatusLabel(item.status);
		const updatedAt = formatTime(item.updatedAt);
		const errorMessage =
			item.detail && typeof item.detail === "object"
				? (item.detail as Record<string, unknown>).error
				: undefined;
		const errorText = typeof errorMessage === "string" ? errorMessage : "";

		return (
			<div
				key={item.id}
				className={`message-center-item status-${item.status}`}
			>
				<div className="message-center-item-header">
					<div className="message-center-item-title">{item.title}</div>
					{item.status === "failed" && errorText ? (
						<Tooltip title={errorText} placement="top">
							<span className={`message-center-status status-${item.status}`}>
								{statusLabel}
							</span>
						</Tooltip>
					) : (
						<span className={`message-center-status status-${item.status}`}>
							{statusLabel}
						</span>
					)}
				</div>
				<div className="message-center-item-meta">
					{item.progress?.message
						? item.progress.message
						: item.progress?.phase
							? `阶段：${item.progress.phase}`
							: null}
					{updatedAt ? (
						<span className="message-center-item-time">{updatedAt}</span>
					) : null}
				</div>
				{isActiveStatus(item.status) ? (
					<div className="message-center-progress">
						<div className="message-center-progress-bar">
							<div
								className="message-center-progress-fill"
								style={{ width: `${percent}%` }}
							/>
						</div>
						<div className="message-center-progress-label">{percent}%</div>
					</div>
				) : (
					renderResultSummary(item)
				)}
			</div>
		);
	};

	const content = (
		<div className="message-center-panel">
			<div className="message-center-header">
				<div className="message-center-title">消息中心</div>
				<div className="message-center-count">进行中 {runningCount}</div>
			</div>
			<div className="message-center-section">
				<div className="message-center-section-title">进行中</div>
				{activeItems.length > 0 ? (
					<div className="message-center-list">
						{activeItems.map(renderItem)}
					</div>
				) : (
					<div className="message-center-empty">暂无进行中的任务</div>
				)}
			</div>
			<div className="message-center-section">
				<div className="message-center-section-title">历史</div>
				{historyItems.length > 0 || historyLoading ? (
					<div
						className="message-center-history-list"
						onScroll={handleHistoryScroll}
					>
						{historyItems.length > 0 ? (
							<div className="message-center-list">
								{historyItems.map(renderItem)}
							</div>
						) : null}
						{historyLoading ? (
							<div className="message-center-load-hint">加载中...</div>
						) : null}
						{historyLoadingMore ? (
							<div className="message-center-load-hint">加载更多...</div>
						) : null}
						{!historyLoading &&
						!historyLoadingMore &&
						!historyCursor &&
						historyItems.length > 0 ? (
							<div className="message-center-load-hint">没有更多历史任务</div>
						) : null}
					</div>
				) : (
					<div className="message-center-empty">暂无历史记录</div>
				)}
			</div>
		</div>
	);

	return (
		<>
			<Popover
				content={content}
				trigger="click"
				placement="bottomRight"
				open={open}
				onOpenChange={setOpen}
				overlayClassName="message-center-popover"
			>
				<button
					className="topbar-icon-button message-center-button"
					type="button"
					aria-label="消息中心"
					disabled={!projectKey}
				>
					<BellOutlined />
				</button>
			</Popover>
		</>
	);
}

export default MessageCenter;
