# PRD-008c: Single-key dashboard and onboarding (hive)

> **Parent:** [`prd-008-unified-fleet-inference-credential`](./prd-008-unified-fleet-inference-credential-index.md)
> **Status:** Draft
> **Priority:** P1
> **Effort:** M
> **Repo:** hive

---

## Scope

The hive-side UX: replace the N-row provider-keys list with a single **"fleet inference provider"** picker + one write-only key field + per-service model selectors, and rework the [PRD-013a](../../../../hive/library/requirements/backlog/prd-013-guided-onboarding-setup/prd-013a-post-tenancy-setup-steps.md) onboarding key step to ask for **one** key.

### Out of scope

- The catalog/Gemini/model-setting backend — [`prd-008a`](./prd-008a-unified-fleet-inference-credential-provider-catalog-and-gemini.md).
- The shared store + Nectar sourcing — [`prd-008b`](./prd-008b-unified-fleet-inference-credential-shared-store-and-nectar-sourcing.md).

### Dependencies

- **Blocked by:** [`prd-008a`](./prd-008a-unified-fleet-inference-credential-provider-catalog-and-gemini.md) (Gemini in the catalog; the `model.*` setting keys).
- **Reshapes:** hive [`prd-013a`](../../../../hive/library/requirements/backlog/prd-013-guided-onboarding-setup/prd-013a-post-tenancy-setup-steps.md) API-key step.
- **Reuses:** `ProviderKeysSection` / `SearchAndInferenceSection` ([`settings.tsx`](../../../../hive/src/dashboard/web/pages/settings.tsx)), `PROVIDER_KEY_NAME` + the catalog `Select` ([`panels.tsx`](../../../../hive/src/dashboard/web/panels.tsx)), `wire.setSecret` / `wire.secretNames` / `wire.setSetting` / `wire.vaultSettings`.

---

## Design

### Settings: one provider, one key, models per service

The Settings "Provider keys" surface collapses from *"a password row per provider"* to:

1. **Fleet inference provider** — a single `Select` over `{ Portkey, OpenRouter, OpenAI, Anthropic, Gemini }` (writes `activeProvider`).
2. **One key** — a single write-only password field for the chosen provider's key (writes the one mapped secret via `setSecret`; presence shown names-only via `secretNames`; gateways also show their `portkey.config` / free-form field as today). Switching the provider swaps which single key the field targets.
3. **Models per service** — selectors for `model.summarize`, `model.rerank`, `model.describe` (closed lists for direct providers, free-form for gateways), each writing its setting.

The old multi-row list is removed; the standalone **Cohere key is retired** from the UI (confirmed 2026-07-12) — rerank routes through the chosen provider/gateway, so Cohere is no longer a co-equal key row (it is a *rerank* provider, not embeddings; the 768-dim concern is the Nomic embeddings layer, out of scope). The result reads as one decision — *which provider, one key, which models* — not a checklist of five keys.

### Onboarding: PRD-013a key step asks for one key

The [PRD-013a](../../../../hive/library/requirements/backlog/prd-013-guided-onboarding-setup/prd-013a-post-tenancy-setup-steps.md) API-key step is reworked to match: it asks the user to pick **one** provider (default Anthropic, selector incl. Gemini) and enter its **one** key — not a provider list to work through. The explainer copy stays (what/why), and the memory-formation gate + dashboard checklist keep reading the single-sourced `reasons.memory.provider === "configured"` signal from [`prd-008a`](./prd-008a-unified-fleet-inference-credential-provider-catalog-and-gemini.md). This supersedes the multi-provider framing in PRD-013a's original key-step design; PRD-013a is updated to point here.

### Honest states

Presence is names-only; the value is never echoed; an empty value is rejected before any write (the existing write-only discipline). "Which provider is active" and "key set / not set" are shown plainly. A malformed/failed read degrades to "not set" rather than a fabricated "configured", per the dashboard's fail-soft posture.

---

## User stories

### US-8c.1 — One decision in Settings

**As a** user, **I want** Settings to ask which provider and one key, **so that** I stop seeing five key fields.

**Acceptance criteria:**
- AC-8c.1.1 Settings shows one provider `Select` (incl. Gemini), one write-only key field for the chosen provider, and per-service model selectors — not an N-row provider list.
- AC-8c.1.2 Saving the key calls `setSecret` for the one mapped name; presence reflects via a `secretNames` re-read; the value is never echoed; an empty value is rejected pre-write.
- AC-8c.1.3 Changing the provider swaps the targeted key + updates the model selectors' option lists; changing a per-service model writes its setting.

### US-8c.2 — Onboarding asks for one key

**As a** first-run user, **I want** the wizard's key step to ask for one key, **so that** onboarding matches the one-key model.

**Acceptance criteria:**
- AC-8c.2.1 The PRD-013a key step presents one provider selector (default Anthropic, incl. Gemini) + one key field, with the what/why explainer retained.
- AC-8c.2.2 A successful save stores the one key and the step's completion + the memory gate read the single `provider === "configured"` signal.
- AC-8c.2.3 The dashboard checklist's "AI key" item reflects the same single signal (no per-provider rows).

---

## Implementation notes

- **Edited:** [`settings.tsx`](../../../../hive/src/dashboard/web/pages/settings.tsx) — replace `ProviderKeysSection`'s N-row render with the single provider picker + one key field; add the three model selectors (reuse the catalog `Select` and `wire.setSetting`). **Edited:** [`panels.tsx`](../../../../hive/src/dashboard/web/panels.tsx) — `PROVIDER_KEY_NAME` gains `gemini: "GEMINI_API_KEY"`.
- **Edited:** hive [`prd-013a`](../../../../hive/library/requirements/backlog/prd-013-guided-onboarding-setup/prd-013a-post-tenancy-setup-steps.md) + its implementation — the key step asks for one key; add a supersession note that the multi-provider framing is replaced by PRD-008.
- **Tests:** Settings renders one picker + one key field + model selectors; save targets the correct single secret; provider switch swaps the field/models; onboarding key step asks for one key; checklist/memory gate read the single signal. Follow the jsdom + mocked-wire conventions in the hive dashboard tests.

---

## Decisions

Confirmed 2026-07-12 (parent index [Decisions](./prd-008-unified-fleet-inference-credential-index.md#decisions-confirmed-2026-07-12)): the standalone Cohere key is **retired** (rerank routes through the chosen provider/gateway) and the UI ships **three** per-service model selectors (summarize/rerank/describe).
