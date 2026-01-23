import { apiFetch } from "../config/api";

export type Project = {
  id: string;
  key: string;
  name: string;
  description?: string;
  status?: string;
  createdAt?: string;
};

export type CreateProjectInput = {
  key: string;
  name: string;
  description: string;
};

export type RebuildProjectOptions = {
  with_summary?: boolean;
};

export type RebuildProjectResponse = {
  task_id: string;
  status: string;
};

const parseProject = (item: any): Project => ({
  id: String(item.id ?? ""),
  key: String(item.key ?? ""),
  name: String(item.name ?? ""),
  description: item.description ?? undefined,
  status: item.status ?? undefined,
  createdAt: item.created_at ?? item.createdAt ?? undefined,
});

export const fetchProjects = async (): Promise<Project[]> => {
  const response = await apiFetch("/api/projects");
  if (!response.ok) {
    throw new Error("Failed to load projects");
  }
  const payload = await response.json();
  const items = Array.isArray(payload?.data) ? payload.data : [];
  return items.map(parseProject);
};

export const createProject = async (input: CreateProjectInput): Promise<Project> => {
  const response = await apiFetch("/api/projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || payload?.error || "Create project failed";
    throw new Error(message);
  }
  const data = payload?.data;
  return parseProject(data);
};

export const rebuildProjectRag = async (
  projectKey: string,
  options: RebuildProjectOptions = {},
): Promise<RebuildProjectResponse> => {
  const query = options.with_summary ? "?with_summary=true" : "";
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/rag/rebuild${query}`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error("rebuild failed");
  }
  const payload = await response.json();
  const data = payload?.data ?? payload ?? {};
  return {
    task_id: typeof data.task_id === "string" ? data.task_id : "",
    status: typeof data.status === "string" ? data.status : "pending",
  };
};

export const rebuildDocumentRag = async (
  projectKey: string,
  documentId: string,
  options: RebuildProjectOptions = {},
): Promise<void> => {
  const query = options.with_summary ? "?with_summary=true" : "";
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/rag/rebuild/documents/${encodeURIComponent(
      documentId,
    )}${query}`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error("rebuild failed");
  }
};
