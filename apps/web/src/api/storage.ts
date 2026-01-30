import { apiFetch } from "../config/api";

export type StorageDownloadPayload = {
    mime_type?: string;
    download?: {
        url?: string;
    };
};

export const fetchStorageObjectDownload = async (
    projectKey: string,
    storageObjectId: string,
    signal?: AbortSignal,
): Promise<StorageDownloadPayload> => {
    const response = await apiFetch(
        `/api/projects/${encodeURIComponent(projectKey)}/storage-objects/${encodeURIComponent(
            storageObjectId,
        )}`,
        { signal },
    );
    if (!response.ok) {
        throw new Error("failed to load storage object");
    }
    const payload = await response.json();
    return payload;
};
