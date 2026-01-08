import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { OpenAPISpec, OpenAPIRefType, OpenAPIRef } from "../../utils/openapiFilter";
import { filterOpenAPISpec } from "../../utils/openapiFilter";
import { apiFetch } from "../../config/api";
import { parse as parseYaml } from "yaml";
import "swagger-ui-react/swagger-ui.css";

const SwaggerUI = lazy(() => import("swagger-ui-react"));

type OpenApiSpecViewerProps = {
  projectKey: string;
  source: string;
  refType?: OpenAPIRefType;
  ref?: OpenAPIRef;
};

type ViewState = {
  loading: boolean;
  error: string | null;
  spec: OpenAPISpec | null;
};

const initialState: ViewState = {
  loading: false,
  error: null,
  spec: null,
};

const parseSpec = (raw: string): OpenAPISpec | null => {
  if (!raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as OpenAPISpec;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // fall through to YAML
  }
  try {
    const parsed = parseYaml(raw) as OpenAPISpec;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
};

const normalizeSource = (source: string) => source.trim().replace(/^storage:\/\//, "");

function OpenApiSpecViewer({
  projectKey,
  source,
  refType = "spec",
  ref,
}: OpenApiSpecViewerProps) {
  const assetId = useMemo(() => normalizeSource(source), [source]);
  const refSignature = `${refType}|${ref?.tag ?? ""}|${ref?.path ?? ""}|${ref?.method ?? ""}`;
  const stableRef = useMemo(
    () => ({
      tag: ref?.tag,
      path: ref?.path,
      method: ref?.method,
    }),
    [refSignature],
  );
  const [state, setState] = useState<ViewState>(initialState);

  useEffect(() => {
    if (!projectKey || !assetId) {
      setState({
        loading: false,
        error: "Missing OpenAPI source",
        spec: null,
      });
      return;
    }

    const controller = new AbortController();
    const loadSpec = async () => {
      setState({ loading: true, error: null, spec: null });
      try {
        const response = await apiFetch(
          `/api/projects/${encodeURIComponent(projectKey)}/assets/${encodeURIComponent(
            assetId,
          )}/content`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error("failed to load OpenAPI spec");
        }
        const raw = await response.text();
        if (controller.signal.aborted) {
          return;
        }
        const spec = parseSpec(raw);
        if (!spec) {
          throw new Error("invalid OpenAPI content");
        }
        const filtered =
          refType === "spec" ? spec : filterOpenAPISpec(spec, refType, stableRef);
        setState({ loading: false, error: null, spec: filtered });
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }
        setState({
          loading: false,
          error: (err as Error).message || "failed to load OpenAPI spec",
          spec: null,
        });
      }
    };

    loadSpec();
    return () => controller.abort();
  }, [assetId, projectKey, refSignature]);

  if (state.loading) {
    return <div className="openapi-viewer-state">Loading OpenAPI spec...</div>;
  }

  if (state.error) {
    return <div className="openapi-viewer-error">{state.error}</div>;
  }

  if (!state.spec) {
    return <div className="openapi-viewer-state">No OpenAPI spec available</div>;
  }

  return (
    <div className="openapi-viewer">
      <Suspense fallback={<div className="openapi-viewer-state">Loading viewer...</div>}>
        <SwaggerUI spec={state.spec} />
      </Suspense>
    </div>
  );
}

export default OpenApiSpecViewer;
