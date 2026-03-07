import { apiFetch, encodeProjectRef } from "../config/api";

export type UploadedAsset = {
    asset_id: string;
    filename: string;
    mime: string;
    size: number;
};

export const uploadAsset = async (projectKey: string, file: File): Promise<UploadedAsset> => {
    const form = new FormData();
    form.append("file", file);
    const response = await apiFetch(
        `/api/projects/${encodeProjectRef(projectKey)}/assets/import`,
        {
            method: "POST",
            body: form,
        },
    );
    if (!response.ok) {
        throw new Error("upload failed");
    }
    const payload = await response.json();
    const data = payload?.data ?? payload ?? {};
    return {
        asset_id: String(data.asset_id ?? ""),
        filename: String(data.filename ?? file.name),
        mime: String(data.mime ?? file.type),
        size: Number(data.size ?? file.size),
    };
};
