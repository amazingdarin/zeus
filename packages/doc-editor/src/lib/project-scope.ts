const PROJECT_REF_SEPARATOR = "::"

export type ProjectRefOwnerType = "personal" | "team"

export type ParsedProjectRef = {
  ownerType: ProjectRefOwnerType
  ownerKey: string
  projectKey: string
}

const normalizeOwnerType = (ownerType: string): ProjectRefOwnerType =>
  String(ownerType ?? "").trim().toLowerCase() === "team" ? "team" : "personal"

const decodeSegment = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const parseProjectRef = (projectRef: string): ParsedProjectRef => {
  const raw = String(projectRef ?? "").trim()
  if (!raw) {
    return { ownerType: "personal", ownerKey: "me", projectKey: "" }
  }

  if (raw.includes(PROJECT_REF_SEPARATOR)) {
    const parts = raw.split(PROJECT_REF_SEPARATOR)
    if (parts.length >= 3) {
      const ownerType = normalizeOwnerType(parts[0] ?? "")
      const ownerKeyRaw = String(parts[1] ?? "").trim()
      const projectKey = String(parts.slice(2).join(PROJECT_REF_SEPARATOR) ?? "").trim()
      const ownerKey = ownerKeyRaw || (ownerType === "personal" ? "me" : "")
      return { ownerType, ownerKey, projectKey }
    }
  }

  const pathParts = raw.split("/").filter(Boolean)
  if (pathParts.length >= 3) {
    const ownerType = normalizeOwnerType(decodeSegment(pathParts[0] ?? ""))
    const ownerKeyRaw = decodeSegment(pathParts[1] ?? "")
    const ownerKey = ownerKeyRaw || (ownerType === "personal" ? "me" : "")
    const projectKey = decodeSegment(pathParts.slice(2).join("/"))
    return { ownerType, ownerKey, projectKey }
  }

  return { ownerType: "personal", ownerKey: "me", projectKey: raw }
}

export const encodeProjectRefPath = (projectRef: string): string => {
  const parsed = parseProjectRef(projectRef)
  return `${encodeURIComponent(parsed.ownerType)}/${encodeURIComponent(parsed.ownerKey)}/${encodeURIComponent(parsed.projectKey)}`
}

