const plugin = {
  async register(ctx) {
    return {
      menus: [
        {
          id: "ppt-template-sidebar",
          placement: "sidebar",
          title: "PPT 模版",
          order: 120,
          route: "/plugins/ppt-template-manager/templates",
        },
        {
          id: "ppt-template-doc-header",
          placement: "document_header",
          title: "PPT 模版推荐",
          order: 120,
          action: "list-templates",
          onClick: async () => {
            const result = await ctx.invokeOperation(
              "ppt-template-manager",
              "list-templates",
              {},
            );
            ctx.emitEvent("templates:list", result);
          },
        },
      ],
      routes: [
        {
          id: "ppt-template-route",
          path: "/plugins/ppt-template-manager/templates",
          title: "PPT 模版管理",
          render: () =>
            "PPT 模版管理插件已加载。你可以在文档页菜单中触发“PPT 模版推荐”。",
        },
      ],
    };
  },
};

export default plugin;
