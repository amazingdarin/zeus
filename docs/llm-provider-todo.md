# Multi-Provider LLM Support TODO

## Phase 0: Preparation

- [ ] Confirm target providers (OpenAI, GitHub Copilot)
- [ ] Confirm Copilot Device Code flow and GitHub OAuth app settings
- [ ] Confirm base URLs and scopes required for Copilot

## Phase 1: Config + Crypto

- [ ] Extend `security` config with `encryption_keys`, `active_key_id`, `active_key_version`
- [ ] Add config parsing defaults and backward compatibility
- [ ] Implement `KeyManager` interface (local implementation)
- [ ] Implement envelope crypto helpers (data key + AES-GCM)
- [ ] Add tests for encrypt/decrypt and key lookup

## Phase 2: Storage Layer

- [ ] Add `provider_credential` table to `ddl/sql/init.sql`
- [ ] Create GORM model for provider credentials
- [ ] Create domain model for provider credentials
- [ ] Add mapper functions
- [ ] Add repository interface and Postgres implementation
- [ ] Add tests for CRUD and audit fields

## Phase 3: Provider Registry + Services

- [ ] Define Provider registry (OpenAI, GitHub Copilot)
- [ ] Add provider capabilities and default base URLs
- [ ] Implement `ProviderService` for listing/test
- [ ] Implement `ProviderAuthService` for API key storage
- [ ] Implement Copilot Device Code start + poll
- [ ] Add key rotation rewrap job

## Phase 4: API Endpoints

- [ ] Add API types (request/response DTOs)
- [ ] Add handlers:
  - `GET /api/providers`
  - `POST /api/providers/:id/auth/api`
  - `POST /api/providers/:id/auth/start`
  - `POST /api/providers/:id/auth/poll`
  - `POST /api/providers/test`
- [ ] Wire handlers into router

## Phase 5: Integration

- [ ] Wire services into `server/cmd/zeus/main.go`
- [ ] Update runtime resolution to use provider credentials when available
- [ ] Add usage tracking for `last_used_at`/`last_used_by`

## Phase 6: Tests & Validation

- [ ] Unit tests for key rotation and rewrap
- [ ] API integration tests for provider auth
- [ ] Manual validation with OpenAI and Copilot

## Phase 7: Docs

- [ ] Update docs with API usage examples
- [ ] Document key rotation operational procedure
