import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isPointerInLeftRail,
  moveMenuHighlightIndex,
  resolveNormalizedDropTarget,
  resolveHandleAnchorBlockId,
  shouldHideControlsOnPointerExit,
  resolveHoveredBlockId,
  isDesktopHandleEnabled,
  isBlockActionMenuShortcut,
  resolveFloatingMenuPlacement,
  type BuiltinBlockType,
} from "../src/extensions/block-add-handle";
import {
  getBuiltinBlockItems,
  getPluginBlockItems,
  groupBlockMenuItems,
  groupBuiltinBlockItems,
} from "../src/ui/block-add-menu";

test("only desktop edit mode enables block add handle", () => {
  assert.equal(isDesktopHandleEnabled({ isMobile: false, mode: "edit" }), true);
  assert.equal(isDesktopHandleEnabled({ isMobile: true, mode: "edit" }), false);
  assert.equal(isDesktopHandleEnabled({ isMobile: false, mode: "view" }), false);
});

test("builtin block menu exposes expected first-phase blocks", () => {
  const ids = getBuiltinBlockItems().map((item) => item.id);
  const expected: BuiltinBlockType[] = [
    "paragraph",
    "heading-1",
    "collapsible-heading-1",
    "heading-2",
    "collapsible-heading-2",
    "heading-3",
    "collapsible-heading-3",
    "toggle-block",
    "bullet-list",
    "ordered-list",
    "task-list",
    "blockquote",
    "horizontal-rule",
    "code-block",
    "math",
    "chart",
    "mindmap",
    "toc",
    "link-preview",
    "image",
    "file",
    "table",
    "columns",
  ];
  assert.deepEqual(ids, expected);
});

test("builtin block menu groups upload-related blocks into media section", () => {
  const sections = groupBuiltinBlockItems(getBuiltinBlockItems());
  const basicSection = sections.find((section) => section.id === "basic");
  const mediaSection = sections.find((section) => section.id === "media");

  assert.ok(basicSection);
  assert.ok(mediaSection);
  assert.deepEqual(
    mediaSection?.items.map(({ item }) => item.id),
    ["image", "file"]
  );
  assert.equal(
    basicSection?.items.some(({ item }) => item.id === "image"),
    false
  );
});

test("builtin block menu provides hint for every item", () => {
  const items = getBuiltinBlockItems();
  for (const item of items) {
    assert.equal(
      Boolean(String(item.hint ?? "").trim()),
      true,
      `missing hint for builtin block: ${item.id}`
    );
  }
});

test("block menu groups plugin blocks as one section per plugin", () => {
  const builtinItems = getBuiltinBlockItems();
  const pluginItems = getPluginBlockItems([
    {
      pluginId: "plugin.alpha",
      pluginTitle: "Alpha 插件",
      blocks: [
        { id: "alpha.block.a", title: "Alpha A" },
        { id: "alpha.block.b", title: "Alpha B" },
      ],
    },
    {
      pluginId: "plugin.beta",
      pluginTitle: "Beta 插件",
      blocks: [{ id: "beta.block.a", title: "Beta A" }],
    },
  ]);
  const sections = groupBlockMenuItems([...builtinItems, ...pluginItems]);

  const alphaSection = sections.find((section) => section.id === "plugin:plugin.alpha");
  const betaSection = sections.find((section) => section.id === "plugin:plugin.beta");

  assert.ok(alphaSection);
  assert.ok(betaSection);
  assert.equal(alphaSection?.label, "Alpha 插件");
  assert.equal(betaSection?.label, "Beta 插件");
  assert.deepEqual(
    alphaSection?.items.map(({ item }) => (item.kind === "plugin" ? item.blockId : "")),
    ["alpha.block.a", "alpha.block.b"]
  );
  assert.deepEqual(
    betaSection?.items.map(({ item }) => (item.kind === "plugin" ? item.blockId : "")),
    ["beta.block.a"]
  );
});

test("plugin block menu provides fallback hint when plugin block hint is empty", () => {
  const pluginItems = getPluginBlockItems([
    {
      pluginId: "plugin.alpha",
      pluginTitle: "Alpha 插件",
      blocks: [{ id: "alpha.block.a", title: "Alpha A" }],
    },
  ]);
  assert.equal(pluginItems.length, 1);
  assert.equal(
    String(pluginItems[0]?.hint ?? "").trim(),
    "来自插件「Alpha 插件」的功能块"
  );
});

test("resolveHoveredBlockId picks the block nearest to hovered row", () => {
  const ranges = [
    { id: "a", top: 10, bottom: 30 },
    { id: "b", top: 30, bottom: 60 },
    { id: "c", top: 60, bottom: 100 },
  ];

  assert.equal(resolveHoveredBlockId(ranges, 5), "a");
  assert.equal(resolveHoveredBlockId(ranges, 25), "a");
  assert.equal(resolveHoveredBlockId(ranges, 45), "b");
  assert.equal(resolveHoveredBlockId(ranges, 90), "c");
  assert.equal(resolveHoveredBlockId(ranges, 140), "c");
  assert.equal(resolveHoveredBlockId([], 50), null);
});

test("isPointerInLeftRail only matches the left control strip", () => {
  const opts = {
    railLeft: 4,
    railButtonSize: 26,
    railGap: 0,
  };

  assert.equal(isPointerInLeftRail({ ...opts, relativeX: 3 }), true);
  assert.equal(isPointerInLeftRail({ ...opts, relativeX: 20 }), true);
  assert.equal(isPointerInLeftRail({ ...opts, relativeX: 56 }), true);
  assert.equal(isPointerInLeftRail({ ...opts, relativeX: 70 }), false);
  assert.equal(isPointerInLeftRail({ ...opts, relativeX: 140 }), false);
});

test("shouldHideControlsOnPointerExit keeps controls stable when entering rail controls", () => {
  assert.equal(
    shouldHideControlsOnPointerExit({
      dragging: false,
      menuOpen: false,
      movingIntoControls: true,
    }),
    false
  );
  assert.equal(
    shouldHideControlsOnPointerExit({
      dragging: true,
      menuOpen: false,
      movingIntoControls: false,
    }),
    false
  );
  assert.equal(
    shouldHideControlsOnPointerExit({
      dragging: false,
      menuOpen: true,
      movingIntoControls: false,
    }),
    false
  );
  assert.equal(
    shouldHideControlsOnPointerExit({
      dragging: false,
      menuOpen: false,
      movingIntoControls: false,
    }),
    true
  );
});

test("resolveHandleAnchorBlockId prefers dragging block to prevent handle drift", () => {
  assert.equal(
    resolveHandleAnchorBlockId({
      draggingBlockId: "drag",
      hoveredBlockId: "hover",
      selectionBlockId: "selection",
      controlsVisible: true,
    }),
    "drag"
  );
  assert.equal(
    resolveHandleAnchorBlockId({
      draggingBlockId: null,
      hoveredBlockId: "hover",
      selectionBlockId: "selection",
      controlsVisible: true,
    }),
    "hover"
  );
  assert.equal(
    resolveHandleAnchorBlockId({
      draggingBlockId: null,
      hoveredBlockId: "hover",
      selectionBlockId: "selection",
      controlsVisible: false,
    }),
    "selection"
  );
});

test("resolveNormalizedDropTarget uses a single insertion slot between adjacent blocks", () => {
  const ranges = [
    { id: "a", top: 10, bottom: 30 },
    { id: "b", top: 30, bottom: 60 },
    { id: "c", top: 60, bottom: 100 },
  ];

  assert.deepEqual(resolveNormalizedDropTarget(ranges, 15), {
    blockId: "a",
    placement: "before",
    indicatorTop: 10,
  });
  assert.deepEqual(resolveNormalizedDropTarget(ranges, 25), {
    blockId: "b",
    placement: "before",
    indicatorTop: 30,
  });
  assert.deepEqual(resolveNormalizedDropTarget(ranges, 30), {
    blockId: "b",
    placement: "before",
    indicatorTop: 30,
  });
  assert.deepEqual(resolveNormalizedDropTarget(ranges, 45), {
    blockId: "b",
    placement: "before",
    indicatorTop: 30,
  });
  assert.deepEqual(resolveNormalizedDropTarget(ranges, 50), {
    blockId: "c",
    placement: "before",
    indicatorTop: 60,
  });
  assert.deepEqual(resolveNormalizedDropTarget(ranges, 95), {
    blockId: "c",
    placement: "after",
    indicatorTop: 100,
  });
  assert.deepEqual(resolveNormalizedDropTarget(ranges, 120), {
    blockId: "c",
    placement: "after",
    indicatorTop: 100,
  });
  assert.equal(resolveNormalizedDropTarget([], 20), null);
});

test("moveMenuHighlightIndex cycles through menu items by arrow direction", () => {
  assert.equal(
    moveMenuHighlightIndex({
      current: 0,
      total: 4,
      direction: "down",
    }),
    1
  );
  assert.equal(
    moveMenuHighlightIndex({
      current: 3,
      total: 4,
      direction: "down",
    }),
    0
  );
  assert.equal(
    moveMenuHighlightIndex({
      current: 0,
      total: 4,
      direction: "up",
    }),
    3
  );
  assert.equal(
    moveMenuHighlightIndex({
      current: 2,
      total: 4,
      direction: "up",
    }),
    1
  );
  assert.equal(
    moveMenuHighlightIndex({
      current: 0,
      total: 0,
      direction: "down",
    }),
    0
  );
});

test("block action menu shortcut supports command+/ and alt+/", () => {
  assert.equal(
    isBlockActionMenuShortcut({
      key: "/",
      code: "Slash",
      metaKey: true,
      altKey: false,
      ctrlKey: false,
    }),
    true
  );
  assert.equal(
    isBlockActionMenuShortcut({
      key: "÷",
      code: "Slash",
      metaKey: false,
      altKey: true,
      ctrlKey: false,
    }),
    true
  );
  assert.equal(
    isBlockActionMenuShortcut({
      key: "/",
      code: "Slash",
      metaKey: false,
      altKey: false,
      ctrlKey: false,
    }),
    false
  );
  assert.equal(
    isBlockActionMenuShortcut({
      key: "/",
      code: "Slash",
      metaKey: false,
      altKey: true,
      ctrlKey: true,
    }),
    false
  );
});

test("floating menu placement prefers right-down when space is enough", () => {
  const result = resolveFloatingMenuPlacement({
    anchorX: 120,
    anchorY: 90,
    menuWidth: 236,
    menuHeight: 220,
    viewportLeft: 0,
    viewportTop: 0,
    viewportWidth: 800,
    viewportHeight: 600,
    offsetX: 6,
    offsetY: 6,
    margin: 8,
  });

  assert.equal(result.horizontal, "right");
  assert.equal(result.vertical, "down");
  assert.equal(result.left, 126);
  assert.equal(result.top, 96);
});

test("floating menu placement flips to up-left when right/down are insufficient", () => {
  const result = resolveFloatingMenuPlacement({
    anchorX: 520,
    anchorY: 420,
    menuWidth: 236,
    menuHeight: 220,
    viewportLeft: 0,
    viewportTop: 0,
    viewportWidth: 560,
    viewportHeight: 460,
    offsetX: 6,
    offsetY: 6,
    margin: 8,
  });

  assert.equal(result.horizontal, "left");
  assert.equal(result.vertical, "up");
  assert.equal(result.left, 278);
  assert.equal(result.top, 194);
});

test("floating menu placement clamps into visible viewport when no side fully fits", () => {
  const result = resolveFloatingMenuPlacement({
    anchorX: 170,
    anchorY: 120,
    menuWidth: 236,
    menuHeight: 220,
    viewportLeft: 100,
    viewportTop: 80,
    viewportWidth: 260,
    viewportHeight: 180,
    offsetX: 6,
    offsetY: 6,
    margin: 8,
  });

  assert.equal(result.left, 116);
  assert.equal(result.top, 88);
});
