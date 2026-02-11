const plugin = {
  async register(ctx) {
    const sdk = ctx && ctx.docEditor ? ctx.docEditor : null;
    if (!sdk || typeof sdk.loadBuiltinModule !== "function") {
      console.warn("[music-plugin] docEditor SDK is unavailable");
      return {};
    }

    const builtin = await sdk.loadBuiltinModule("music");
    const createMusicBlockContribution = builtin && typeof builtin.createMusicBlockContribution === "function"
      ? builtin.createMusicBlockContribution
      : null;

    if (!createMusicBlockContribution) {
      console.warn("[music-plugin] music builtin module does not expose createMusicBlockContribution");
      return {};
    }

    return {
      blocks: [createMusicBlockContribution(sdk.react.createElement)],
    };
  },
};

export default plugin;
