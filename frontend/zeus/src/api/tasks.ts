import { apiFetch } from "../config/api";

export type TaskStatusResponse = {
    status: string | null;
    [key: string]: unknown;
};

export const fetchTaskStatus = async (taskId: string): Promise<TaskStatusResponse | null> => {
    const response = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}`);
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Error("task status failed");
    }
    const payload = await response.json();
    const data = payload?.data ?? payload ?? {};
    return {
        status: typeof data.status === "string" ? data.status : null,
        ...data,
    };
};
