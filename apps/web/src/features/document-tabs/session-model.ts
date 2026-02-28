export const DOCUMENT_TAB_MAX = 8;

export type DocTab = {
  docId: string;
  title: string;
  openedAt: number;
  lastAccessAt: number;
};

export type TabSessionState = {
  tabs: DocTab[];
  activeDocId: string | null;
};

export function createInitialSessionState(): TabSessionState {
  return {
    tabs: [],
    activeDocId: null,
  };
}

export function hasTab(state: TabSessionState, docId: string): boolean {
  return state.tabs.some((tab) => tab.docId === docId);
}

export function getLruTabId(state: TabSessionState): string | null {
  if (!state.tabs.length) {
    return null;
  }
  const victim = [...state.tabs].sort((a, b) => a.lastAccessAt - b.lastAccessAt)[0];
  return victim?.docId ?? null;
}

export function activateTab(
  state: TabSessionState,
  input: { docId: string; now: number },
): TabSessionState {
  return {
    tabs: state.tabs.map((tab) =>
      tab.docId === input.docId
        ? { ...tab, lastAccessAt: input.now }
        : tab,
    ),
    activeDocId: input.docId,
  };
}

export function updateTabTitle(
  state: TabSessionState,
  input: { docId: string; title: string },
): TabSessionState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.docId === input.docId
        ? { ...tab, title: input.title }
        : tab,
    ),
  };
}

export function removeTab(
  state: TabSessionState,
  input: { docId: string },
): TabSessionState {
  const tabs = state.tabs.filter((tab) => tab.docId !== input.docId);
  if (!tabs.length) {
    return {
      tabs: [],
      activeDocId: null,
    };
  }

  if (state.activeDocId !== input.docId) {
    return {
      tabs,
      activeDocId: state.activeDocId,
    };
  }

  const fallback = [...tabs].sort((a, b) => b.lastAccessAt - a.lastAccessAt)[0];
  return {
    tabs,
    activeDocId: fallback?.docId ?? null,
  };
}

export function openTab(
  state: TabSessionState,
  input: {
    docId: string;
    title: string;
    now: number;
    maxTabs?: number;
  },
): TabSessionState {
  const maxTabs = input.maxTabs ?? DOCUMENT_TAB_MAX;

  if (hasTab(state, input.docId)) {
    return activateTab(
      updateTabTitle(state, { docId: input.docId, title: input.title }),
      { docId: input.docId, now: input.now },
    );
  }

  let nextState = state;
  if (nextState.tabs.length >= maxTabs) {
    const victimId = getLruTabId(nextState);
    if (victimId) {
      nextState = removeTab(nextState, { docId: victimId });
    }
  }

  return {
    tabs: [
      ...nextState.tabs,
      {
        docId: input.docId,
        title: input.title,
        openedAt: input.now,
        lastAccessAt: input.now,
      },
    ],
    activeDocId: input.docId,
  };
}

export function closeTab(
  state: TabSessionState,
  input: { docId: string },
): TabSessionState {
  return removeTab(state, input);
}
