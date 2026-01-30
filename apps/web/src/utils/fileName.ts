export const sanitizeFileName = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    const cleaned = trimmed.replace(/[^a-z0-9-_]+/g, "_").replace(/^_+|_+$/g, "");
    return cleaned.slice(0, 48);
};
