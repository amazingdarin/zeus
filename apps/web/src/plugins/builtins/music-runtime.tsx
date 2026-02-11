import type { EditorBlockContribution } from "@zeus/plugin-sdk-web";
import { MusicButton, MusicNode } from "@zeus/doc-editor";

export function createMusicBlockContribution(
  reactCreateElement: (...args: unknown[]) => unknown,
): EditorBlockContribution {
  return {
    id: "music-block",
    blockType: "music",
    title: "Music",
    extension: MusicNode,
    toolbarButton: reactCreateElement(MusicButton),
  };
}

export { MusicButton, MusicNode };
