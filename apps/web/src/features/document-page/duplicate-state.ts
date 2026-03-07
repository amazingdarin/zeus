type DuplicateNode = {
  id: string;
  parentId: string;
};

type TreeMap<T extends DuplicateNode> = Record<string, T[]>;

type InsertResult<T extends DuplicateNode> = {
  rootDocuments: T[];
  childrenByParent: TreeMap<T>;
  changed: boolean;
};

function insertDuplicateInList<T extends DuplicateNode>(
  nodes: T[],
  sourceDocId: string,
  duplicatedDoc: T,
): { nodes: T[]; changed: boolean } {
  const withoutDuplicate = nodes.filter((item) => item.id !== duplicatedDoc.id);
  const sourceIndex = withoutDuplicate.findIndex((item) => item.id === sourceDocId);
  const insertIndex = sourceIndex >= 0 ? sourceIndex + 1 : withoutDuplicate.length;
  const nextNodes = [
    ...withoutDuplicate.slice(0, insertIndex),
    duplicatedDoc,
    ...withoutDuplicate.slice(insertIndex),
  ];

  let changed = withoutDuplicate.length !== nodes.length || sourceIndex < 0;
  if (!changed) {
    changed = nextNodes.some((item, index) => item !== nodes[index]);
  }

  return changed ? { nodes: nextNodes, changed: true } : { nodes, changed: false };
}

export function insertDuplicateIntoTree<T extends DuplicateNode>(
  rootDocuments: T[],
  childrenByParent: TreeMap<T>,
  sourceDocId: string,
  duplicatedDoc: T,
): InsertResult<T> {
  const parentId = String(duplicatedDoc.parentId || "root").trim() || "root";

  if (parentId === "root") {
    const update = insertDuplicateInList(rootDocuments, sourceDocId, duplicatedDoc);
    return {
      rootDocuments: update.nodes,
      childrenByParent,
      changed: update.changed,
    };
  }

  const siblings = childrenByParent[parentId] ?? [];
  const update = insertDuplicateInList(siblings, sourceDocId, duplicatedDoc);
  if (!update.changed) {
    return {
      rootDocuments,
      childrenByParent,
      changed: false,
    };
  }
  return {
    rootDocuments,
    childrenByParent: {
      ...childrenByParent,
      [parentId]: update.nodes,
    },
    changed: true,
  };
}

