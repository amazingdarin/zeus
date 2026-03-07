type TitleNode = {
  id: string;
  title: string;
};

type TreeMap<T extends TitleNode> = Record<string, T[]>;

type TreeUpdateResult<T extends TitleNode> = {
  rootDocuments: T[];
  childrenByParent: TreeMap<T>;
  changed: boolean;
};

export function normalizeDocumentDisplayTitle(title: string): string {
  const normalized = String(title ?? "").trim();
  return normalized || "无标题文档";
}

function updateTitleInList<T extends TitleNode>(
  nodes: T[],
  docId: string,
  nextTitle: string
): { nodes: T[]; changed: boolean } {
  let changed = false;
  const nextNodes = nodes.map((item) => {
    if (item.id !== docId || item.title === nextTitle) {
      return item;
    }
    changed = true;
    return {
      ...item,
      title: nextTitle,
    };
  });
  return changed ? { nodes: nextNodes, changed: true } : { nodes, changed: false };
}

export function updateTitleInTree<T extends TitleNode>(
  rootDocuments: T[],
  childrenByParent: TreeMap<T>,
  docId: string,
  nextTitle: string
): TreeUpdateResult<T> {
  const rootUpdate = updateTitleInList(rootDocuments, docId, nextTitle);
  let mapChanged = false;
  const nextChildrenEntries = Object.entries(childrenByParent).map(([parentId, nodes]) => {
    const update = updateTitleInList(nodes, docId, nextTitle);
    if (update.changed) {
      mapChanged = true;
    }
    return [parentId, update.nodes] as const;
  });

  return {
    rootDocuments: rootUpdate.nodes,
    childrenByParent: mapChanged
      ? Object.fromEntries(nextChildrenEntries)
      : childrenByParent,
    changed: rootUpdate.changed || mapChanged,
  };
}

type DocumentMapUpdateResult<T extends TitleNode> = {
  documentsById: Record<string, T>;
  changed: boolean;
};

type BreadcrumbHierarchyItem = {
  id: string;
  name: string;
};

export type BreadcrumbItem = {
  label: string;
  to?: string;
};

export function updateTitleInDocumentMap<T extends TitleNode>(
  documentsById: Record<string, T>,
  docId: string,
  nextTitle: string,
): DocumentMapUpdateResult<T> {
  const target = documentsById[docId];
  if (!target || target.title === nextTitle) {
    return {
      documentsById,
      changed: false,
    };
  }

  return {
    documentsById: {
      ...documentsById,
      [docId]: {
        ...target,
        title: nextTitle,
      },
    },
    changed: true,
  };
}

export function mapHierarchyToBreadcrumb(
  hierarchy: BreadcrumbHierarchyItem[],
  fallbackId: string,
  fallbackTitle: string,
): BreadcrumbItem[] {
  if (!hierarchy || hierarchy.length === 0) {
    return [
      {
        label: fallbackTitle || "文档",
        to: `/documents/${encodeURIComponent(fallbackId)}`,
      },
    ];
  }

  const normalizedFallback = String(fallbackTitle ?? "").trim();
  const mapped = hierarchy.map((item) => ({
    label: item.name || "文档",
    to: `/documents/${encodeURIComponent(item.id)}`,
  }));
  if (!normalizedFallback) {
    return mapped;
  }
  const lastIndex = mapped.length - 1;
  if (mapped[lastIndex]?.label === normalizedFallback) {
    return mapped;
  }
  const next = mapped.slice();
  next[lastIndex] = {
    ...next[lastIndex],
    label: normalizedFallback,
  };
  return next;
}
