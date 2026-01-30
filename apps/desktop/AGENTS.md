# FRONTEND/SRC-TAURI

Tauri desktop shell (Rust) for the React app.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Entry | src/main.rs | calls `frontend_lib::run()` |
| Library | src/lib.rs | Tauri setup |

## ANTI-PATTERNS
- `src/main.rs` has a Windows console suppression flag; DO NOT REMOVE.
