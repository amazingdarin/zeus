import { apiFetch, buildProjectRef, encodeProjectRef } from "../config/api";

export type ProjectOwnerType = "personal" | "team";

export type Project = {
  id: string;
  key: string;
  name: string;
  description?: string;
  status?: string;
  createdAt?: string;
  ownerType: ProjectOwnerType;
  ownerKey: string;
  ownerId: string;
  ownerName: string;
  canWrite: boolean;
  projectRef: string;
};

export type ProjectOwnerContext = {
  ownerType: ProjectOwnerType;
  ownerKey: string;
  ownerId: string;
  ownerName: string;
  myRole: string;
  canCreate: boolean;
};

type TeamSummaryItem = {
  id?: string;
  slug?: string;
  name?: string;
  role?: string;
  my_role?: string;
};

export type ProjectsListResult = {
  contexts: ProjectOwnerContext[];
  projects: Project[];
};

export type CreateProjectInput = {
  key: string;
  name: string;
  description?: string;
  ownerType: ProjectOwnerType;
  ownerKey: string;
};

export type RebuildProjectOptions = {
  with_summary?: boolean;
};

export type RebuildProjectResponse = {
  taskId?: string;
  status: string;
  message?: string;
  total?: number;
  succeeded?: number;
  failed?: number;
  processed?: number;
  errors?: Array<{ docId: string; error: string }>;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

const parseOwnerType = (value: unknown): ProjectOwnerType => {
  return String(value ?? "").trim().toLowerCase() === "team" ? "team" : "personal";
};

const parseProject = (item: any): Project => {
  const ownerType = parseOwnerType(item?.owner_type ?? item?.ownerType);
  const ownerKey =
    String(item?.owner_key ?? item?.ownerKey ?? "").trim() || (ownerType === "personal" ? "me" : "");
  const ownerId = String(item?.owner_id ?? item?.ownerId ?? "").trim();
  const projectKey = String(item?.key ?? "").trim();
  return {
    id: String(item?.id ?? ""),
    key: projectKey,
    name: String(item?.name ?? ""),
    description: item?.description ?? undefined,
    status: item?.status ?? undefined,
    createdAt: item?.created_at ?? item?.createdAt ?? undefined,
    ownerType,
    ownerKey,
    ownerId,
    ownerName:
      String(item?.owner_name ?? item?.ownerName ?? "").trim() ||
      (ownerType === "personal" ? "个人" : ownerKey || ownerId),
    canWrite: Boolean(item?.can_write ?? item?.canWrite ?? ownerType === "personal"),
    projectRef: buildProjectRef({
      ownerType,
      ownerKey,
      projectKey,
    }),
  };
};

const parseOwnerContext = (item: any): ProjectOwnerContext => {
  const ownerType = parseOwnerType(item?.owner_type ?? item?.ownerType);
  const ownerKey =
    String(item?.owner_key ?? item?.ownerKey ?? "").trim() || (ownerType === "personal" ? "me" : "");
  return {
    ownerType,
    ownerKey,
    ownerId: String(item?.owner_id ?? item?.ownerId ?? "").trim(),
    ownerName:
      String(item?.owner_name ?? item?.ownerName ?? "").trim() ||
      (ownerType === "personal" ? "个人" : ownerKey),
    myRole: String(item?.my_role ?? item?.myRole ?? "member").trim() || "member",
    canCreate: Boolean(item?.can_create ?? item?.canCreate),
  };
};

const parseRoleCanCreate = (role: string): boolean => {
  const normalized = String(role ?? "").trim().toLowerCase();
  return normalized === "owner" || normalized === "admin" || normalized === "member";
};

const uniqueOwnerContexts = (contexts: ProjectOwnerContext[]): ProjectOwnerContext[] => {
  const map = new Map<string, ProjectOwnerContext>();
  for (const context of contexts) {
    const key = `${context.ownerType}::${context.ownerKey}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, context);
      continue;
    }
    map.set(key, {
      ...existing,
      ownerName: context.ownerName || existing.ownerName,
      ownerId: context.ownerId || existing.ownerId,
      myRole: context.myRole || existing.myRole,
      canCreate: existing.canCreate || context.canCreate,
    });
  }

  const values = Array.from(map.values());
  values.sort((a, b) => {
    if (a.ownerType === "personal" && b.ownerType !== "personal") {
      return -1;
    }
    if (a.ownerType !== "personal" && b.ownerType === "personal") {
      return 1;
    }
    return a.ownerName.localeCompare(b.ownerName, "zh-Hans-CN");
  });
  return values;
};

const fetchTeamOwnerContexts = async (): Promise<ProjectOwnerContext[]> => {
  try {
    const response = await apiFetch("/api/teams");
    if (!response.ok) {
      return [];
    }
    const payload = await response.json();
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

    return rows
      .map((item: TeamSummaryItem): ProjectOwnerContext | null => {
        const slug = String(item?.slug ?? "").trim();
        if (!slug) {
          return null;
        }
        const role = String(item?.my_role ?? item?.role ?? "member").trim().toLowerCase() || "member";
        return {
          ownerType: "team",
          ownerKey: slug,
          ownerId: String(item?.id ?? "").trim(),
          ownerName: String(item?.name ?? slug).trim() || slug,
          myRole: role,
          canCreate: parseRoleCanCreate(role),
        };
      })
      .filter((item: ProjectOwnerContext | null): item is ProjectOwnerContext => Boolean(item));
  } catch {
    return [];
  }
};

const ensureOwnerContexts = async (contexts: ProjectOwnerContext[]): Promise<ProjectOwnerContext[]> => {
  const baseContexts = uniqueOwnerContexts(contexts);
  const hasTeamContext = baseContexts.some((context) => context.ownerType === "team");

  if (hasTeamContext) {
    return baseContexts;
  }

  const teamContexts = await fetchTeamOwnerContexts();
  if (teamContexts.length === 0) {
    return baseContexts;
  }

  return uniqueOwnerContexts([...baseContexts, ...teamContexts]);
};

export const fetchProjects = async (): Promise<ProjectsListResult> => {
  const response = await apiFetch("/api/projects");
  if (!response.ok) {
    throw new Error("Failed to load projects");
  }
  const payload = await response.json();

  const contextsData = payload?.data?.contexts;
  const projectsData = payload?.data?.projects;

  if (Array.isArray(projectsData)) {
    const contexts = Array.isArray(contextsData)
      ? contextsData.map(parseOwnerContext)
      : [
          {
            ownerType: "personal" as const,
            ownerKey: "me",
            ownerId: "",
            ownerName: "个人",
            myRole: "owner",
            canCreate: true,
          },
        ];
    return {
      contexts: await ensureOwnerContexts(contexts),
      projects: projectsData.map(parseProject),
    };
  }

  const legacyItems = Array.isArray(payload?.data) ? payload.data : [];
  return {
    contexts: await ensureOwnerContexts([
      {
        ownerType: "personal",
        ownerKey: "me",
        ownerId: "",
        ownerName: "个人",
        myRole: "owner",
        canCreate: true,
      },
    ]),
    projects: legacyItems.map(parseProject),
  };
};

export const createProject = async (input: CreateProjectInput): Promise<Project> => {
  const ownerType = input.ownerType;
  const ownerKey = String(input.ownerKey ?? "").trim() || (ownerType === "personal" ? "me" : "");

  if (ownerType === "team" && !ownerKey) {
    throw new Error("ownerKey is required for team project");
  }

  const response = await apiFetch("/api/projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key: input.key,
      name: input.name,
      description: input.description ?? "",
      owner_type: ownerType,
      owner_key: ownerKey,
    }),
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
  _options: RebuildProjectOptions = {},
): Promise<RebuildProjectResponse> => {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/rag/rebuild`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error("rebuild failed");
  }
  const payload = await response.json();
  const data = payload?.data ?? payload ?? {};
  return parseRebuildResponse(data);
};

export const getRebuildStatus = async (
  projectKey: string,
): Promise<RebuildProjectResponse> => {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/rag/rebuild/status`,
  );
  if (!response.ok) {
    throw new Error("Failed to get rebuild status");
  }
  const payload = await response.json();
  const data = payload?.data ?? payload ?? {};
  return parseRebuildResponse(data);
};

function parseRebuildResponse(data: Record<string, unknown>): RebuildProjectResponse {
  return {
    taskId: typeof data.taskId === "string" ? data.taskId : undefined,
    status: typeof data.status === "string" ? data.status : "idle",
    message: typeof data.message === "string" ? data.message : undefined,
    total: typeof data.total === "number" ? data.total : undefined,
    processed: typeof data.processed === "number" ? data.processed : undefined,
    succeeded: typeof data.succeeded === "number" ? data.succeeded : undefined,
    failed: typeof data.failed === "number" ? data.failed : undefined,
    errors: Array.isArray(data.errors) ? data.errors : undefined,
    startedAt: typeof data.startedAt === "string" ? data.startedAt : undefined,
    finishedAt: typeof data.finishedAt === "string" ? data.finishedAt : undefined,
    error: typeof data.error === "string" ? data.error : undefined,
  };
}

export const rebuildDocumentRag = async (
  projectKey: string,
  documentId: string,
  options: RebuildProjectOptions = {},
): Promise<void> => {
  const query = options.with_summary ? "?with_summary=true" : "";
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/rag/rebuild/documents/${encodeURIComponent(
      documentId,
    )}${query}`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error("rebuild failed");
  }
};
