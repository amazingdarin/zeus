const plugin = {
  async register(ctx) {
    const sdk = ctx && ctx.docEditor ? ctx.docEditor : null;
    if (!sdk || typeof sdk.loadBuiltinModule !== "function") {
      console.warn("[edu-plugin] docEditor SDK is unavailable");
      return {};
    }

    const builtin = await sdk.loadBuiltinModule("edu");
    const createEduQuestionSetBlockContribution = builtin && typeof builtin.createEduQuestionSetBlockContribution === "function"
      ? builtin.createEduQuestionSetBlockContribution
      : null;

    if (!createEduQuestionSetBlockContribution) {
      console.warn("[edu-plugin] edu builtin module does not expose createEduQuestionSetBlockContribution");
      return {};
    }

    return {
      blocks: [createEduQuestionSetBlockContribution(sdk.react.createElement)],
    };
  },
};

export default plugin;
