import type { ZeusWebPluginV2 } from "@zeus/plugin-sdk-web";
import { MusicButton, MusicNode } from "@zeus/doc-editor";

const musicPlugin: ZeusWebPluginV2 = {
  async register() {
    return {
      blocks: [
        {
          id: "music-block",
          blockType: "music",
          title: "Music",
          extension: MusicNode,
          toolbarButton: <MusicButton />,
        },
      ],
    };
  },
};

export default musicPlugin;
