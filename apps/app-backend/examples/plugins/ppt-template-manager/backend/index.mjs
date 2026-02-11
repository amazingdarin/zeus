const TEMPLATES = [
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
];

function searchTemplates(keywordRaw) {
  const keyword = typeof keywordRaw === "string"
    ? keywordRaw.trim().toLowerCase()
    : "";

  if (!keyword) {
    return TEMPLATES;
  }

  return TEMPLATES.filter((item) =>
    item.name.toLowerCase().includes(keyword)
      || item.description.toLowerCase().includes(keyword)
      || item.tags.some((tag) => tag.toLowerCase().includes(keyword)),
  );
}

async function runListTemplates(input, ctx) {
  const templates = searchTemplates(input?.keyword);

  return {
    pluginId: ctx.pluginId,
    operationId: "list-templates",
    count: templates.length,
    templates,
    message: `已找到 ${templates.length} 个 PPT 模版`,
  };
}

const plugin = {
  async listOperations() {
    return [
      {
        id: "list-templates",
        title: "List PPT Templates",
        description: "List available PPT templates",
        riskLevel: "low",
        requiresDocScope: false,
      },
    ];
  },

  async execute(operationId, input, ctx) {
    if (operationId !== "list-templates") {
      throw new Error(`Unsupported operation: ${operationId}`);
    }
    return runListTemplates(input, ctx);
  },

  async executeCommand(commandId, input, ctx) {
    if (commandId !== "list-templates" && commandId !== "ppt-template-manager.list-templates") {
      throw new Error(`Unsupported command: ${commandId}`);
    }
    return runListTemplates(input, ctx);
  },
};

export default plugin;
