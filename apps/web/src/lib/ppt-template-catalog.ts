import {
  readPluginLocalDataFile,
  writePluginLocalDataFile,
} from "../api/plugins";

const PPT_PLUGIN_ID = "ppt-plugin";
const PPT_TEMPLATE_CATALOG_PATH = "templates/catalog.json";

export type PptTemplateItem = {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  source: "preset" | "custom";
};

export type PptTemplateCatalog = {
  version: number;
  presets: Array<{ id?: unknown; name?: unknown; title?: unknown; description?: unknown; tags?: unknown }>;
  custom: Array<{ id?: unknown; name?: unknown; title?: unknown; description?: unknown; tags?: unknown }>;
};

export const DEFAULT_PPT_TEMPLATE_CATALOG: PptTemplateCatalog = {
  version: 1,
  presets: [
    {
      id: "clean-blue",
      name: "Clean Blue",
      description: "Corporate deck with calm blue accents.",
      tags: ["business", "minimal"],
    },
    {
      id: "growth-orange",
      name: "Growth Orange",
      description: "High-energy sales presentation template.",
      tags: ["sales", "marketing"],
    },
    {
      id: "research-dark",
      name: "Research Dark",
      description: "Academic presentation with dense content layout.",
      tags: ["research", "report"],
    },
  ],
  custom: [],
};

function asString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asString(item))
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeTemplate(
  item: { id?: unknown; name?: unknown; title?: unknown; description?: unknown; tags?: unknown },
  source: "preset" | "custom",
  index: number,
): PptTemplateItem | null {
  const id = asString(item.id || `template-${index + 1}`);
  const name = asString(item.name || item.title || "");
  if (!id || !name) {
    return null;
  }
  const description = asString(item.description);
  return {
    id,
    name,
    description: description || undefined,
    tags: normalizeTags(item.tags),
    source,
  };
}

function dedupeTemplates(templates: PptTemplateItem[]): PptTemplateItem[] {
  const result: PptTemplateItem[] = [];
  const seen = new Set<string>();
  for (const template of templates) {
    if (!template || seen.has(template.id)) {
      continue;
    }
    seen.add(template.id);
    result.push(template);
  }
  return result;
}

export function normalizePptTemplateCatalog(raw: unknown): {
  presets: PptTemplateItem[];
  custom: PptTemplateItem[];
  merged: PptTemplateItem[];
} {
  if (!raw || typeof raw !== "object") {
    return { presets: [], custom: [], merged: [] };
  }
  const row = raw as Partial<PptTemplateCatalog>;
  const presetsRaw = Array.isArray(row.presets) ? row.presets : [];
  const customRaw = Array.isArray(row.custom) ? row.custom : [];

  const presets = presetsRaw
    .map((item, index) => normalizeTemplate(item as any, "preset", index))
    .filter(Boolean) as PptTemplateItem[];
  const custom = customRaw
    .map((item, index) => normalizeTemplate(item as any, "custom", index))
    .filter(Boolean) as PptTemplateItem[];

  const merged = dedupeTemplates([...presets, ...custom]);
  return { presets, custom, merged };
}

export async function loadPptTemplateCatalog(projectKey: string): Promise<{
  presets: PptTemplateItem[];
  custom: PptTemplateItem[];
  merged: PptTemplateItem[];
}> {
  try {
    const file = await readPluginLocalDataFile(
      projectKey,
      PPT_PLUGIN_ID,
      PPT_TEMPLATE_CATALOG_PATH,
      { scope: "project", encoding: "utf8" },
    );
    const parsed = JSON.parse(file.content || "{}");
    const normalized = normalizePptTemplateCatalog(parsed);
    if (normalized.merged.length > 0) {
      return normalized;
    }
  } catch {
    // fallthrough to default bootstrap
  }

  const fallback = normalizePptTemplateCatalog(DEFAULT_PPT_TEMPLATE_CATALOG);
  try {
    await writePluginLocalDataFile(
      projectKey,
      PPT_PLUGIN_ID,
      PPT_TEMPLATE_CATALOG_PATH,
      JSON.stringify(DEFAULT_PPT_TEMPLATE_CATALOG, null, 2),
      { scope: "project", encoding: "utf8", overwrite: false },
    );
  } catch {
    // ignore bootstrap write errors and still return defaults
  }

  return fallback;
}
