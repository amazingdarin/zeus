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
  - `ID`, `Name`, `AuthType`, `DefaultBaseURL`, `Capabilities`.
  - Protocol adapter (OpenAI-compatible).
  - Routing rules (endpoint selection by capability or model name).

### Provider Connections (Runtime Bindings)

- Introduce `provider_connection` to bind provider definitions to runtime settings.
- A connection includes:
  - `ProviderID`, `BaseURL` override, `ModelName`, `CredentialID`.
  - `Status`/`LastError`/`LastUsedAt` to surface health in UI.
- `model_runtime` can reference a connection for scenario routing.
- Backward compatible: if no connection is set, fall back to existing `model_runtime` fields.

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
- Scenario can target a `provider_connection` when set.
- Endpoint selection based on provider capabilities:
  - `responses_endpoint` for models that require Responses API.
  - `chat_endpoint` for standard chat completions.
  - `embeddings_endpoint` for embeddings.
- Avoid hard-coded model name checks; use provider routing rules instead.
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

New table `provider_connection`:

- `id` (text, PK)
- `provider_id` (text)
- `display_name` (text)
- `base_url` (text, nullable)
- `model_name` (text)
- `credential_id` (text)
- `status` (text: active|invalid|expired|revoked)
- `last_error` (text, nullable)
- `last_used_at` (timestamptz, nullable)
- `created_at`, `updated_at` (timestamptz)
- `created_by`, `updated_by` (text, nullable)

New table `provider_credential`:

- `id` (text, PK)
- `provider_id` (text)
- `scope_type` (text: global|project|user)
- `scope_id` (text, nullable)
- `type` (text: api|device|oauth)
- `ciphertext` (text)
- `nonce` (text)
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
- `GET /api/provider-connections`
  - List configured connections with health state.
- `POST /api/provider-connections`
  - Create/update a provider connection.
- `POST /api/providers/:id/auth/api`
  - Store API key (OpenAI).
- `POST /api/providers/:id/auth/start`
  - Start Device Code for Copilot.
- `POST /api/providers/:id/auth/poll`
  - Poll Device Code to exchange token.
- `POST /api/providers/test`
  - Validate connectivity for provider + model (updates connection status).

## Copilot Device Code Flow

- Server requests device code from GitHub.
- Server returns `verification_uri`, `user_code`, `interval`, `expires_in` to frontend.
- Frontend instructs user to complete login.
- Server polls GitHub (respecting `interval` and `slow_down`).
- Server stores token on success and updates connection status.

## Integration Points (Zeus)

- `server/internal/config/config.go`: add new security fields.
- `server/internal/util`: add envelope encryption helpers and key manager.
- `server/internal/repository`: add provider credential repository + mapper.
- `server/internal/service`: add provider registry + auth services.
- `server/internal/api/handler`: add provider + connection endpoints.
- `server/cmd/zeus/main.go`: wire services into router.
- `ddl/sql/init.sql`: add new tables (`provider_connection`, `provider_credential`).

## Backward Compatibility

- Existing `model_runtime` usage remains unchanged.
- If a scenario has no `provider_connection`, use legacy `model_runtime` fields.
- API key encryption for `model_runtime` continues to use existing `EncryptString`.
- New provider credentials use the envelope scheme.

## Key Rotation

- Update `active_key_id/version` in config.
- Run rewrap job:
  - Decrypt `encrypted_key` with old master key.
  - Re-encrypt with active master key.
  - Update `key_id/version`.

## Implementation Steps (Phase 1)

1. Add `provider_connection` + `provider_credential` tables and mappers.
2. Introduce provider registry definitions (static list) and routing rules.
3. Implement envelope encryption with `KeyManager` (local master keys).
4. Add provider credential repository and service for API key/device code flows.
5. Add provider connection CRUD + health test endpoint.
6. Wire scenario runtime to use connection when set; fallback to existing `model_runtime`.
7. Add audit updates (`last_used_at`, `last_error`, `status`) on test/call.

## Testing

- Unit tests for key manager and envelope encrypt/decrypt.
- Repository tests for credential CRUD.
- API integration tests for auth flows, provider listing, and connection health.
