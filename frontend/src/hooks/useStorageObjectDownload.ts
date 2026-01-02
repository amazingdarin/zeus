import { useEffect, useState } from "react";

import { buildApiUrl } from "../config/api";

type DownloadPayload = {
  mime_type?: string;
  download?: {
    url?: string;
  };
};

type UseStorageObjectDownloadResult = {
  loading: boolean;
  error: string | null;
  mimeType: string | null;
  downloadUrl: string | null;
};

export const useStorageObjectDownload = (
  projectKey: string,
  storageObjectId: string,
): UseStorageObjectDownloadResult => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    const key = projectKey.trim();
    const id = storageObjectId.trim();
    if (!key || !id) {
      setError("project key and storage object id are required");
      setMimeType(null);
      setDownloadUrl(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          buildApiUrl(
            `/api/projects/${encodeURIComponent(key)}/storage-objects/${encodeURIComponent(id)}`,
          ),
          { signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error("failed to load document");
        }
        const payload = (await response.json()) as DownloadPayload;
        const type = (payload?.mime_type ?? "").trim();
        const url = (payload?.download?.url ?? "").trim();
        if (!url) {
          throw new Error("download url is missing");
        }
        setMimeType(type || null);
        setDownloadUrl(url);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }
        setError((err as Error).message || "failed to load document");
        setMimeType(null);
        setDownloadUrl(null);
      } finally {
        setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [projectKey, storageObjectId]);

  return { loading, error, mimeType, downloadUrl };
};
