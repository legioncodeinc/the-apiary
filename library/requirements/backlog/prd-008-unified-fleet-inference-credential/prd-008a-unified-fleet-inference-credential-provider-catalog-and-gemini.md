# PRD-008a: Provider catalog, Gemini, and per-service models (honeycomb)

> **Parent:** [`prd-008-unified-fleet-inference-credential`](./prd-008-unified-fleet-inference-credential-index.md)
> **Status:** Draft
> **Priority:** P1
> **Effort:** M
> **Repo:** honeycomb

---

## Scope

The honeycomb-side foundation for one-provider-one-key: extend the curated catalog with **Gemini**, keep the fleet inference selection a single authoritative `{ provider, key }`, and add **per-service model settings** so a user picks one provider/key and then a model for each model-consuming service.

### Out of scope

- The shared credential store + Nectar sourcing — [`prd-008b`](./prd-008b-unified-fleet-inference-credential-shared-store-and-nectar-sourcing.md).
- The dashboard UI + onboarding rework — [`prd-008c`](./prd-008c-unified-fleet-inference-credential-single-key-dashboard-and-onboarding.md).
- Embeddings provider selection (keeps its own local-vs-hosted toggle).

### Dependencies

- **Reuses:** `PROVIDER_CATALOG` / `isValidProviderModel` ([`catalog.ts`](../../../../honeycomb/src/daemon/runtime/vault/catalog.ts)), `KNOWN_SETTING_KEYS` + the settings write/validate surface ([`api.ts`](../../../../honeycomb/src/daemon/runtime/vault/api.ts)), the Portkey transports ([`transport-portkey.ts`](../../../../honeycomb/src/daemon/runtime/inference/transport-portkey.ts), [`rerank-portkey.ts`](../../../../honeycomb/src/daemon/runtime/recall/rerank-portkey.ts)).

---

## Design

### Add Gemini to the catalog

`PROVIDERS` becomes `["anthropic", "openai", "openrouter", "portkey", "gemini"]`; `PROVIDER_CATALOG` gains a `gemini` entry with a curated, ordered model list (e.g. the current Gemini flash/pro ids, `models[0]` the default) and `openEnded: false` (direct provider, closed list). A Gemini chat transport is added beside the existing provider transports so `provider: "gemini"` actually resolves a model call (direct Google Generative Language API, keyed by the one stored `GEMINI_API_KEY`). `isValidProviderModel("gemini", m)` validates against the curated list, fail-closed like `anthropic`/`openai`.

### Per-service model settings

`KNOWN_SETTING_KEYS` gains three model keys, each a `setting`-class scalar validated against the active provider via `isValidProviderModel` (gateways accept free-form ids, direct providers validate against their list):

| Setting | Service | Consumed by |
|---|---|---|
| `model.summarize` | memory-formation summarization | honeycomb inference |
| `model.rerank` | recall rerank | honeycomb recall |
| `model.describe` | codebase-graph descriptions | nectar brooding (read via the shared selection, [`prd-008b`](./prd-008b-unified-fleet-inference-credential-shared-store-and-nectar-sourcing.md)) |

The legacy `activeModel` is retained as the default/fallback for any unset per-service model (back-compat: an existing single-model config keeps working). Provider is still a single global `activeProvider` (one provider fleet-wide — the parent Non-Goal). The single stored key for the active provider is the one secret (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `PORTKEY_API_KEY` / new `GEMINI_API_KEY`), and for the gateway providers the existing `portkey.config` / OpenRouter passthrough is unchanged.

### The "configured" signal, single-sourced

The memory-formation `reasons.memory.provider === "configured"` bit (already the gate the hive UI and PRD-013 read) resolves to: *the active provider's one key is present and valid*. This stays the single authoritative "an inference credential exists" signal fleet-wide, so the dashboard, the onboarding memory gate, and the checklist all agree.

---

## User stories

### US-8a.1 — Choose Gemini like any other provider

**As a** user, **I want** Gemini offered alongside the other providers, **so that** I can use one Gemini key for the fleet.

**Acceptance criteria:**
- AC-8a.1.1 `PROVIDERS`/`PROVIDER_CATALOG` include `gemini` with a curated model list; `catalogView()` returns it; `defaultModelFor("gemini")` is its `models[0]`.
- AC-8a.1.2 A chat call with `provider: "gemini"` resolves through a working Gemini transport keyed by the single stored Gemini key.
- AC-8a.1.3 `isValidProviderModel("gemini", m)` accepts a curated id and rejects an unknown one (fail-closed).

### US-8a.2 — Pick a model per service under one provider

**As a** user, **I want** to choose a model for summarization, rerank, and descriptions separately, **so that** I can tune each without changing my one key.

**Acceptance criteria:**
- AC-8a.2.1 `model.summarize`, `model.rerank`, `model.describe` are known setting keys, each validated against `activeProvider` via `isValidProviderModel`.
- AC-8a.2.2 An unset per-service model falls back to `activeModel` (then the provider default) so an existing single-model config is unaffected.
- AC-8a.2.3 Setting a per-service model persists and the corresponding service uses it on its next run (summarize/rerank immediately per the daemon's existing read points; describe via [`prd-008b`](./prd-008b-unified-fleet-inference-credential-shared-store-and-nectar-sourcing.md)).

---

## Implementation notes

- **Edited:** [`catalog.ts`](../../../../honeycomb/src/daemon/runtime/vault/catalog.ts) — add `gemini` to `PROVIDERS` + `PROVIDER_CATALOG`; keep `isValidProviderModel` the single gate. **New:** a `transport-gemini.ts` beside the existing transports, wired into the provider→transport dispatch.
- **Edited:** [`api.ts`](../../../../honeycomb/src/daemon/runtime/vault/api.ts) — add the three `model.*` keys to `KNOWN_SETTING_KEYS` with per-key validation mirroring the `activeModel` → `activeProvider` check; add `GEMINI_API_KEY` to the provider→key-name map.
- **Tests:** catalog includes Gemini + validation; per-service model keys validate against the active provider and fall back to `activeModel`; the Gemini transport is exercised against a mocked HTTP client.

---

## Decisions

Confirmed 2026-07-12 (parent index [Decisions](./prd-008-unified-fleet-inference-credential-index.md#decisions-confirmed-2026-07-12)): ship **three** per-service model settings (`model.summarize`/`model.rerank`/`model.describe`, each falling back to `activeModel`); the standalone **Cohere key is retired** and rerank routes through the chosen provider/gateway (Cohere is a *rerank* provider, not embeddings — the 768-dim constraint is the **Nomic** embeddings layer, which is out of scope). The source of truth is the dedicated fleet file in [`prd-008b`](./prd-008b-unified-fleet-inference-credential-shared-store-and-nectar-sourcing.md).
