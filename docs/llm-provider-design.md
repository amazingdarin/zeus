# Multi-Provider LLM Support (Zeus)

## Overview

This document defines the design and implementation plan for adding multi-provider LLM support to Zeus, starting with OpenAI and GitHub Copilot, using a unified OpenAI-compatible protocol and server-side credential storage.

## Goals

- Support multiple LLM providers with a common runtime abstraction.
- Keep `model_runtime` as the default runtime source to avoid breaking existing flows.
- Store credentials in Postgres with envelope encryption and audit fields.
- Provide server-side authentication for providers, including Copilot Device Code.
- Design interfaces to allow future KMS integration without changing business logic.

## Non-Goals (Phase 1)

- Project-level credential scoping (only global in phase 1).
- OAuth redirect flow for Copilot (Device Code only).
- Full provider marketplace or dynamic provider discovery.

## Current Baseline

- `model_runtime` table stores scenario-based runtime config.
- OpenAI-compatible clients exist for chat, embeddings, and streaming.
- Encryption uses a single `security.encryption_key` value.

## Target Architecture

### Provider Registry

- Provider definitions are static for phase 1.
- Each provider specifies:
  - `ID`, `Name`, `AuthType`, `BaseURL`, `Capabilities`.
  - Protocol adapter (OpenAI-compatible).

### Credential Store

- New table `provider_credential` stores credentials for providers.
- Credentials are encrypted using envelope encryption.
- Default scope is global (future project scope supported by schema).

### Key Management (Local, KMS-ready)

- Introduce `KeyManager` interface for data key lifecycle.
- Local implementation uses config-defined master keys.
- Supports key rotation with rewrap.

### Runtime Routing

- Keep existing `model_runtime` behavior for default scenario runtime.
- Provider-specific runtime is resolved using `provider_id` and `model_id`.
- Codex routing rule:
  - `model_id` contains `codex` -> use `responses` endpoint.
  - Otherwise use `chat/completions`.

## Config Changes

Extend `config.yaml`:

```yaml
security:
  encryption_key: zeus-dev-key
  encryption_keys:
    - id: default
      version: 1
      key: "BASE64_MASTER_KEY_1"
    - id: rotate-2025q1
      version: 2
      key: "BASE64_MASTER_KEY_2"
  active_key_id: rotate-2025q1
  active_key_version: 2
```

Rules:

- If `encryption_keys` is empty, fallback to `encryption_key`.
- If `active_key_id/version` is missing, use the first key in the list.

## Database Schema

New table `provider_credential`:

- `id` (text, PK)
- `provider_id` (text)
- `scope_type` (text: global|project|user)
- `scope_id` (text, nullable)
- `type` (text: api|device|oauth)
- `ciphertext` (text)
- `nonce` (text)
- `cipher` (text)
- `encrypted_key` (text)
- `key_id` (text)
- `key_version` (int)
- `expires_at` (timestamptz, nullable)
- `scopes` (text, nullable)
- `metadata` (jsonb)
- `created_at`, `updated_at` (timestamptz)
- `created_by`, `updated_by` (text, nullable)
- `last_used_at`, `last_used_by` (nullable)

## Encryption

- Data key: random 32 bytes
- Credential payload: AES-256-GCM with data key
- Data key wrap: AES-256-GCM with master key
- Stored values include `ciphertext`, `nonce`, `encrypted_key`, `key_id`, `key_version`, `cipher`.

## API Endpoints (Phase 1)

- `GET /api/providers`
  - List providers and connection status.
- `POST /api/providers/:id/auth/api`
  - Store API key (OpenAI).
- `POST /api/providers/:id/auth/start`
  - Start Device Code for Copilot.
- `POST /api/providers/:id/auth/poll`
  - Poll Device Code to exchange token.
- `POST /api/providers/test`
  - Validate connectivity for provider + model.

## Copilot Device Code Flow

- Server requests device code from GitHub.
- Server returns `verification_uri`, `user_code`, `interval` to frontend.
- Frontend instructs user to complete login.
- Server polls GitHub and stores token on success.

## Integration Points (Zeus)

- `internal/config/config.go`: add new security fields.
- `internal/util`: add envelope encryption helpers and key manager.
- `internal/repository`: add provider credential repository + mapper.
- `internal/service`: add provider registry + auth services.
- `internal/api/handler`: add provider endpoints.
- `cmd/zeus/main.go`: wire services into router.
- `ddl/sql/init.sql`: add new table.

## Backward Compatibility

- Existing `model_runtime` usage remains unchanged.
- API key encryption for `model_runtime` continues to use existing `EncryptString`.
- New provider credentials use the envelope scheme.

## Key Rotation

- Update `active_key_id/version` in config.
- Run rewrap job:
  - Decrypt `encrypted_key` with old master key.
  - Re-encrypt with active master key.
  - Update `key_id/version`.

## Testing

- Unit tests for key manager and envelope encrypt/decrypt.
- Repository tests for credential CRUD.
- API integration tests for auth flows and provider listing.
