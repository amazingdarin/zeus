export type ProjectOwnerType = "personal" | "team";
export type DbOwnerType = "user" | "team";

export type ScopedProjectKey = {
  ownerType: ProjectOwnerType;
  ownerId: string;
  projectKey: string;
};

export type ResolvedProjectScope = ScopedProjectKey & {
  scopedProjectKey: string;
};

const SCOPE_SEPARATOR = "::";

export function normalizeOwnerType(value: string): ProjectOwnerType | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "personal") {
    return "personal";
  }
  if (normalized === "team") {
    return "team";
  }
  return null;
}

export function toDbOwnerType(ownerType: ProjectOwnerType): DbOwnerType {
  return ownerType === "team" ? "team" : "user";
}

export function fromDbOwnerType(ownerType: string): ProjectOwnerType {
  return String(ownerType ?? "").trim().toLowerCase() === "team" ? "team" : "personal";
}

export function buildScopedProjectKey(input: ScopedProjectKey): string {
  const ownerType = normalizeOwnerType(input.ownerType) ?? "personal";
  const ownerId = String(input.ownerId ?? "").trim();
  const projectKey = String(input.projectKey ?? "").trim();
  if (!ownerId || !projectKey) {
    return projectKey;
  }
  return `${ownerType}${SCOPE_SEPARATOR}${ownerId}${SCOPE_SEPARATOR}${projectKey}`;
}

export function parseScopedProjectKey(value: string): ScopedProjectKey | null {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const parts = raw.split(SCOPE_SEPARATOR);
  if (parts.length !== 3) {
    return null;
  }

  const ownerType = normalizeOwnerType(parts[0]);
  const ownerId = String(parts[1] ?? "").trim();
  const projectKey = String(parts[2] ?? "").trim();
  if (!ownerType || !ownerId || !projectKey) {
    return null;
  }

  return { ownerType, ownerId, projectKey };
}

export function resolveProjectScope(userId: string, projectKey: string): ResolvedProjectScope {
  const scoped = parseScopedProjectKey(projectKey);
  if (scoped) {
    return {
      ...scoped,
      scopedProjectKey: buildScopedProjectKey(scoped),
    };
  }

  const normalizedUserId = String(userId ?? "").trim();
  const normalizedProjectKey = String(projectKey ?? "").trim();
  return {
    ownerType: "personal",
    ownerId: normalizedUserId,
    projectKey: normalizedProjectKey,
    scopedProjectKey: buildScopedProjectKey({
      ownerType: "personal",
      ownerId: normalizedUserId,
      projectKey: normalizedProjectKey,
    }),
  };
}


export function buildScopedProjectPath(projectRef: string): string {
  const scoped = parseScopedProjectKey(projectRef);
  if (!scoped) {
    const fallback = String(projectRef ?? "").trim();
    return `personal/me/${encodeURIComponent(fallback)}`;
  }
  return `${encodeURIComponent(scoped.ownerType)}/${encodeURIComponent(scoped.ownerId)}/${encodeURIComponent(scoped.projectKey)}`;
}
