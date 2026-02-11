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

    const keyword = typeof input?.keyword === "string"
      ? input.keyword.trim().toLowerCase()
      : "";
    const templates = keyword
      ? TEMPLATES.filter((item) =>
          item.name.toLowerCase().includes(keyword)
            || item.description.toLowerCase().includes(keyword)
            || item.tags.some((tag) => tag.toLowerCase().includes(keyword)),
        )
      : TEMPLATES;

    return {
      pluginId: ctx.pluginId,
      operationId,
      count: templates.length,
      templates,
      message: `已找到 ${templates.length} 个 PPT 模版`,
    };
  },
};

export default plugin;
