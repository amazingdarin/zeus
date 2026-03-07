export type EditorSaveStatus = "draft" | "idle" | "dirty" | "saving" | "error";

export type EditorSaveState = {
  status: EditorSaveStatus;
  error: string;
};

export type EditorSaveEvent =
  | { type: "changed" }
  | { type: "save-start" }
  | { type: "save-success" }
  | { type: "save-error"; error?: string };

export function initialSaveState(): EditorSaveState {
  return {
    status: "idle",
    error: "",
  };
}

export function reduceSaveState(state: EditorSaveState, event: EditorSaveEvent): EditorSaveState {
  switch (event.type) {
    case "changed":
      return {
        status: state.status === "saving" ? "saving" : "dirty",
        error: "",
      };
    case "save-start":
      return {
        status: "saving",
        error: "",
      };
    case "save-success":
      return {
        status: "idle",
        error: "",
      };
    case "save-error":
      return {
        status: "error",
        error: event.error?.trim() || "保存失败",
      };
    default:
      return state;
  }
}
