export type OpenAPIRefType = "spec" | "module" | "endpoint"

export type OpenAPIRef = {
  tag?: string
  path?: string
  method?: string
}

export type OpenAPITag = {
  name: string
  description?: string
}

export type OpenAPISpec = {
  openapi?: string
  swagger?: string
  info?: {
    title?: string
    version?: string
  }
  paths?: Record<string, Record<string, unknown>>
  tags?: OpenAPITag[]
  [key: string]: unknown
}

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "trace",
])

const cloneSpec = (spec: OpenAPISpec): OpenAPISpec => {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(spec)
  }
  return JSON.parse(JSON.stringify(spec)) as OpenAPISpec
}

const isMethodKey = (key: string) => HTTP_METHODS.has(key.toLowerCase())

const getOperationTags = (operation: unknown): string[] => {
  if (!operation || typeof operation !== "object") {
    return []
  }
  const rawTags = (operation as { tags?: unknown }).tags
  if (!Array.isArray(rawTags)) {
    return []
  }
  return rawTags.filter((tag): tag is string => typeof tag === "string")
}

const normalizeMethod = (method?: string) => (method || "").toLowerCase()

export const filterOpenAPISpec = (
  spec: OpenAPISpec,
  refType: OpenAPIRefType,
  ref?: OpenAPIRef
): OpenAPISpec => {
  const cloned = cloneSpec(spec)
  const paths = cloned.paths

  if (!paths || typeof paths !== "object") {
    return cloned
  }

  if (refType === "spec") {
    return cloned
  }

  const targetTag = (ref?.tag || "").trim()
  const targetPath = (ref?.path || "").trim()
  const targetMethod = normalizeMethod(ref?.method)

  if (refType === "module" && !targetTag) {
    return cloned
  }

  if (refType === "endpoint" && (!targetPath || !targetMethod)) {
    return cloned
  }

  const usedTags = new Set<string>()
  const filteredPaths: Record<string, Record<string, unknown>> = {}

  for (const [pathKey, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") {
      continue
    }

    if (refType === "endpoint" && pathKey !== targetPath) {
      continue
    }

    const methodEntries: Record<string, unknown> = {}
    const otherEntries: Record<string, unknown> = {}

    for (const [entryKey, entryValue] of Object.entries(pathItem)) {
      if (!isMethodKey(entryKey)) {
        otherEntries[entryKey] = entryValue
        continue
      }

      if (refType === "module") {
        const tags = getOperationTags(entryValue)
        if (tags.includes(targetTag)) {
          methodEntries[entryKey] = entryValue
          tags.forEach((tag) => usedTags.add(tag))
        }
        continue
      }

      if (refType === "endpoint" && entryKey.toLowerCase() === targetMethod) {
        methodEntries[entryKey] = entryValue
        getOperationTags(entryValue).forEach((tag) => usedTags.add(tag))
      }
    }

    if (Object.keys(methodEntries).length > 0) {
      filteredPaths[pathKey] = {
        ...otherEntries,
        ...methodEntries,
      }
    }
  }

  cloned.paths = filteredPaths

  if (cloned.tags && cloned.tags.length > 0 && usedTags.size > 0) {
    cloned.tags = cloned.tags.filter((tag) => usedTags.has(tag.name))
  }

  return cloned
}
