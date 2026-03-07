export type PluginTextExtractor = (node: unknown) => string;
export type PluginMarkdownSerializer = (node: unknown) => string;

const pluginBlockTypes = new Set<string>();
const pluginBlockIdTypes = new Set<string>();
const pluginTextExtractors = new Map<string, PluginTextExtractor>();
const pluginMarkdownSerializers = new Map<string, PluginMarkdownSerializer>();

export function registerPluginBlockType(
  blockType: string,
  options?: {
    requiresBlockId?: boolean;
    textExtractor?: PluginTextExtractor;
    markdownSerializer?: PluginMarkdownSerializer;
  },
): void {
  const normalized = String(blockType || "").trim();
  if (!normalized) return;
  pluginBlockTypes.add(normalized);
  if (options?.requiresBlockId) {
    pluginBlockIdTypes.add(normalized);
  }
  if (options?.textExtractor) {
    pluginTextExtractors.set(normalized, options.textExtractor);
  }
  if (options?.markdownSerializer) {
    pluginMarkdownSerializers.set(normalized, options.markdownSerializer);
  }
}

export function registerPluginBlockTypes(
  blocks: Array<{ blockType: string; requiresBlockId?: boolean }>,
): void {
  for (const block of blocks) {
    registerPluginBlockType(block.blockType, {
      requiresBlockId: block.requiresBlockId,
    });
  }
}

export function getRegisteredPluginBlockTypes(): string[] {
  return Array.from(pluginBlockTypes);
}

export function getRegisteredPluginBlockIdTypes(): string[] {
  return Array.from(pluginBlockIdTypes);
}

export function getPluginTextExtractor(type: string): PluginTextExtractor | undefined {
  return pluginTextExtractors.get(type);
}

export function getPluginMarkdownSerializer(type: string): PluginMarkdownSerializer | undefined {
  return pluginMarkdownSerializers.get(type);
}
