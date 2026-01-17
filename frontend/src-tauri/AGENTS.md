# FRONTEND/SRC-TAURI

Tauri desktop shell (Rust) for the React app.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Entry | src-tauri/src/main.rs | calls `frontend_lib::run()` |
| Library | src-tauri/src/lib.rs | Tauri setup |

## ANTI-PATTERNS
- `src-tauri/src/main.rs` has a Windows console suppression flag; DO NOT REMOVE.
