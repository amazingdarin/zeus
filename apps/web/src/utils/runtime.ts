type TauriWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

function getBrowserWindow(): TauriWindow | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window as TauriWindow;
}

export function isNativeRuntime(): boolean {
  const currentWindow = getBrowserWindow();
  if (!currentWindow) {
    return false;
  }
  return (
    typeof currentWindow.__TAURI__ !== "undefined" ||
    typeof currentWindow.__TAURI_INTERNALS__ !== "undefined"
  );
}

export function requiresAuthForCoreRoutes(): boolean {
  return !isNativeRuntime();
}
