import { filterOpenAPISpec } from "../src/utils/openapiFilter"

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message)
  }
}

const sampleSpec = {
  openapi: "3.0.1",
  info: { title: "Demo", version: "1.0.0" },
  tags: [{ name: "users" }, { name: "admin" }],
  paths: {
    "/users": {
      get: { tags: ["users"], summary: "List users" },
      post: { tags: ["users"], summary: "Create user" },
    },
    "/admin": {
      get: { tags: ["admin"], summary: "Admin" },
    },
  },
}

export const runOpenApiFilterTests = () => {
  const specAll = filterOpenAPISpec(sampleSpec, "spec")
  assert(Object.keys(specAll.paths || {}).length === 2, "spec keeps all paths")

  const specModule = filterOpenAPISpec(sampleSpec, "module", { tag: "users" })
  assert(Object.keys(specModule.paths || {}).length === 1, "module filters paths")
  assert(
    !!specModule.paths?.["/users"]?.get,
    "module keeps matching operations"
  )

  const specEndpoint = filterOpenAPISpec(sampleSpec, "endpoint", {
    path: "/admin",
    method: "GET",
  })
  assert(Object.keys(specEndpoint.paths || {}).length === 1, "endpoint filters")
  assert(
    !!specEndpoint.paths?.["/admin"]?.get,
    "endpoint keeps specified method"
  )
  assert(
    !specEndpoint.paths?.["/admin"]?.post,
    "endpoint removes other methods"
  )
}

runOpenApiFilterTests()
