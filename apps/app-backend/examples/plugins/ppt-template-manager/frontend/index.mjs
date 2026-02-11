const plugin = {
  async register() {
    return {
      routes: [
        {
          id: "templates",
          path: "/plugins/ppt-template-manager/templates",
          title: "PPT 模版管理",
          render: () =>
            "PPT 模版管理插件（v2）已加载。你可以在文档页头部菜单点击“PPT 模版推荐”，或在命令面板执行 /ppt-template-list。",
        },
      ],
    };
  },
};

export default plugin;
