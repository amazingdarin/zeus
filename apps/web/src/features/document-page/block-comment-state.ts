export type BlockCommentPanelState = {
  visible: boolean;
  blockId: string | null;
  threadId: string | null;
};

export type BlockCommentState = {
  panelByDocId: Record<string, BlockCommentPanelState>;
  countByDocId: Record<string, Record<string, number>>;
  threadIdsByDocId: Record<string, Record<string, Record<string, true>>>;
};

type BlockCommentEvent =
  | { type: "open-panel"; docId: string; blockId: string; threadId?: string | null }
  | { type: "close-panel"; docId: string }
  | { type: "replace-block-threads"; docId: string; blockId: string; threadIds: string[] }
  | { type: "upsert-thread"; docId: string; blockId: string; threadId: string }
  | { type: "remove-thread"; docId: string; blockId: string; threadId: string }
  | { type: "hydrate-counts"; docId: string; counts: Record<string, number> }
  | { type: "clear-doc"; docId: string };

function normalizeId(input: string): string {
  return String(input ?? "").trim();
}

function getPanelFallback(): BlockCommentPanelState {
  return { visible: false, blockId: null, threadId: null };
}

function countThreadIds(map: Record<string, true> | undefined): number {
  if (!map) {
    return 0;
  }
  return Object.keys(map).length;
}

export function createBlockCommentState(): BlockCommentState {
  return {
    panelByDocId: {},
    countByDocId: {},
    threadIdsByDocId: {},
  };
}

export function reduceBlockCommentState(
  state: BlockCommentState,
  event: BlockCommentEvent,
): BlockCommentState {
  const docId = normalizeId(event.docId);
  if (!docId) {
    return state;
  }

  if (event.type === "open-panel") {
    const blockId = normalizeId(event.blockId);
    if (!blockId) {
      return state;
    }
    return {
      ...state,
      panelByDocId: {
        ...state.panelByDocId,
        [docId]: {
          visible: true,
          blockId,
          threadId: normalizeId(event.threadId ?? "") || null,
        },
      },
    };
  }

  if (event.type === "close-panel") {
    const current = state.panelByDocId[docId];
    if (!current?.visible) {
      return state;
    }
    return {
      ...state,
      panelByDocId: {
        ...state.panelByDocId,
        [docId]: {
          ...current,
          visible: false,
        },
      },
    };
  }

  if (event.type === "clear-doc") {
    if (!(docId in state.panelByDocId) && !(docId in state.countByDocId) && !(docId in state.threadIdsByDocId)) {
      return state;
    }
    const nextPanelByDocId = { ...state.panelByDocId };
    const nextCountByDocId = { ...state.countByDocId };
    const nextThreadIdsByDocId = { ...state.threadIdsByDocId };
    delete nextPanelByDocId[docId];
    delete nextCountByDocId[docId];
    delete nextThreadIdsByDocId[docId];
    return {
      panelByDocId: nextPanelByDocId,
      countByDocId: nextCountByDocId,
      threadIdsByDocId: nextThreadIdsByDocId,
    };
  }

  if (event.type === "hydrate-counts") {
    const nextCounts: Record<string, number> = {};
    const nextThreadIds: Record<string, Record<string, true>> = {};
    for (const [rawBlockId, rawCount] of Object.entries(event.counts ?? {})) {
      const blockId = normalizeId(rawBlockId);
      if (!blockId) {
        continue;
      }
      const count = Number(rawCount);
      if (!Number.isFinite(count) || count <= 0) {
        continue;
      }
      nextCounts[blockId] = Math.floor(count);
      nextThreadIds[blockId] = {};
    }
    return {
      ...state,
      countByDocId: {
        ...state.countByDocId,
        [docId]: nextCounts,
      },
      threadIdsByDocId: {
        ...state.threadIdsByDocId,
        [docId]: nextThreadIds,
      },
      panelByDocId: {
        ...state.panelByDocId,
        [docId]: state.panelByDocId[docId] ?? getPanelFallback(),
      },
    };
  }

  if (event.type === "replace-block-threads") {
    const blockId = normalizeId(event.blockId);
    if (!blockId) {
      return state;
    }
    const nextByBlock: Record<string, true> = {};
    for (const rawThreadId of event.threadIds ?? []) {
      const threadId = normalizeId(rawThreadId);
      if (!threadId) {
        continue;
      }
      nextByBlock[threadId] = true;
    }
    const currentByDoc = state.threadIdsByDocId[docId] ?? {};
    const nextByDoc = {
      ...currentByDoc,
      [blockId]: nextByBlock,
    };
    const currentCountByDoc = state.countByDocId[docId] ?? {};
    const nextCountByDoc = {
      ...currentCountByDoc,
      [blockId]: countThreadIds(nextByBlock),
    };
    return {
      ...state,
      threadIdsByDocId: {
        ...state.threadIdsByDocId,
        [docId]: nextByDoc,
      },
      countByDocId: {
        ...state.countByDocId,
        [docId]: nextCountByDoc,
      },
      panelByDocId: {
        ...state.panelByDocId,
        [docId]: state.panelByDocId[docId] ?? getPanelFallback(),
      },
    };
  }

  const blockId = normalizeId(event.blockId);
  const threadId = normalizeId(event.threadId);
  if (!blockId || !threadId) {
    return state;
  }

  const currentByDoc = state.threadIdsByDocId[docId] ?? {};
  const currentByBlock = currentByDoc[blockId] ?? {};
  let nextByBlock: Record<string, true> | null = null;

  if (event.type === "upsert-thread") {
    if (currentByBlock[threadId]) {
      return state;
    }
    nextByBlock = {
      ...currentByBlock,
      [threadId]: true,
    };
  } else {
    if (!currentByBlock[threadId]) {
      return state;
    }
    nextByBlock = { ...currentByBlock };
    delete nextByBlock[threadId];
  }

  const nextByDoc = {
    ...currentByDoc,
    [blockId]: nextByBlock,
  };
  const currentCountByDoc = state.countByDocId[docId] ?? {};
  const nextCountByDoc = {
    ...currentCountByDoc,
    [blockId]: countThreadIds(nextByBlock),
  };

  return {
    ...state,
    threadIdsByDocId: {
      ...state.threadIdsByDocId,
      [docId]: nextByDoc,
    },
    countByDocId: {
      ...state.countByDocId,
      [docId]: nextCountByDoc,
    },
    panelByDocId: {
      ...state.panelByDocId,
      [docId]: state.panelByDocId[docId] ?? getPanelFallback(),
    },
  };
}
