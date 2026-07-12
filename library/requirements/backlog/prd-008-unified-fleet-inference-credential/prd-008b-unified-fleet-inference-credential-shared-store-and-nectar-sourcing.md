# PRD-008b: Shared credential store and Nectar sourcing (nectar + honeycomb read surface)

> **Parent:** [`prd-008-unified-fleet-inference-credential`](./prd-008-unified-fleet-inference-credential-index.md)
> **Status:** Draft
> **Priority:** P1
> **Effort:** L
> **Repo:** nectar (primary), honeycomb (read surface)

---

## Scope

Make one stored inference credential serve both daemons: define the single source of truth, have Nectar read the chosen provider + key from it (retiring `NECTAR_PORTKEY_*` env as the *required* path), and give Nectar's brooding/describe transport parity for the non-Portkey providers so any of the five choices works fleet-wide.

### Out of scope

- The catalog/Gemini/per-service-model settings — [`prd-008a`](./prd-008a-unified-fleet-inference-credential-provider-catalog-and-gemini.md).
- The dashboard/onboarding UI — [`prd-008c`](./prd-008c-unified-fleet-inference-credential-single-key-dashboard-and-onboarding.md).

### Dependencies

- **Blocked by:** [`prd-008a`](./prd-008a-unified-fleet-inference-credential-provider-catalog-and-gemini.md) (the `{ provider, key, model.describe }` selection this reads).
- **Reuses:** the brood prereq gate ([`brood-prereqs.ts`](../../../../nectar/src/brood-prereqs.ts)), Nectar's Portkey transport + embeddings config ([`portkey/transport.ts`](../../../../nectar/src/portkey/transport.ts), [`embeddings/config.ts`](../../../../nectar/src/embeddings/config.ts)), the shared credential precedent from [`PRD-003`](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003-fleet-lifecycle-login-and-uninstall-index.md).

---

## Design

### The single source of truth — a dedicated fleet inference-credential file

The fleet inference selection — `{ provider, key, per-service models }` — lives in **one dedicated file beside `~/.deeplake/credentials.json`** (confirmed 2026-07-12), read directly by every daemon. This is symmetric with the identity credential the fleet already shares that way ([`PRD-003`](../../completed/prd-003-fleet-lifecycle-login-and-uninstall/prd-003-fleet-lifecycle-login-and-uninstall-index.md)).

**Security guardrails (load-bearing — route through `security-worker-bee`):** the file is a secret at rest — daemon-written, `0600`, loopback/daemon-local, and **never** browser-reachable. The dashboard write path stays write-only with names-only presence: the browser POSTs the key, the daemon persists it to this file, and **no read-back API exists** (the write-only invariant is preserved at the API layer even though the on-disk format is now a plaintext sibling file rather than the encrypted vault — this matches the existing `~/.deeplake/credentials.json` at-rest posture, a deliberate owner decision over the encrypted vault so a second daemon can read it).

### Nectar sources the fleet selection

Nectar's brood prerequisites ([`brood-prereqs.ts`](../../../../nectar/src/brood-prereqs.ts)) change from "require `NECTAR_PORTKEY_ENABLED` + `NECTAR_PORTKEY_API_KEY` + `NECTAR_PORTKEY_CONFIG`" to "the fleet inference selection resolves (provider + key present)". Resolution order:

1. The fleet-shared selection (the new primary path).
2. `NECTAR_PORTKEY_*` env vars — **retained as an explicit override** for headless/advanced use (back-compat, confirmed 2026-07-12), but no longer required when the fleet selection is set.

The dormancy reasons stay machine-readable on `/health` and in the startup log; the human message points at the dashboard's one provider/key setting rather than three env vars.

### Direct-provider parity for brood/describe

Nectar's describe transport is Portkey-specific today ([`portkey/transport.ts`](../../../../nectar/src/portkey/transport.ts)). **First ship carries full five-provider parity** (confirmed 2026-07-12): Nectar's describe path gains a provider dispatch covering the gateways (Portkey/OpenRouter) **and** direct Anthropic/OpenAI/Gemini transports (parity with honeycomb's [`prd-008a`](./prd-008a-unified-fleet-inference-credential-provider-catalog-and-gemini.md) transports — shared or mirrored), so any of the five picks works in Nectar on day one with no phasing. The describe **model** is `model.describe` from the shared selection. Hosted embeddings ([`embeddings/config.ts`](../../../../nectar/src/embeddings/config.ts)) draw on the same shared credential when enabled; the local-default **Nomic 768-dim** embeddings choice is unchanged (embeddings are a distinct layer — see the parent index Non-Goals).

> **Largest lift.** The direct Anthropic/OpenAI/Gemini transports in Nectar are the biggest single piece of work in PRD-008; sharing the transport implementations with honeycomb's [`prd-008a`](./prd-008a-unified-fleet-inference-credential-provider-catalog-and-gemini.md) (rather than mirroring) is the recommended way to avoid duplicating five provider clients across two repos.

---

## User stories

### US-8b.1 — One key, both daemons

**As a** user, **I want** the key I entered once to power Nectar too, **so that** I never set `NECTAR_PORTKEY_*` by hand.

**Acceptance criteria:**
- AC-8b.1.1 With the fleet inference selection set and **no** `NECTAR_PORTKEY_*` env present, Nectar's brood prereqs evaluate `ready` and brooding runs against the shared provider/key.
- AC-8b.1.2 The key is never exposed to the browser; Nectar reads it via the daemon-local source of truth only.
- AC-8b.1.3 `NECTAR_PORTKEY_*` env, when present, still works as an explicit override and is documented as secondary.

### US-8b.2 — Any picked provider works in Nectar

**As a** user who picked a direct provider, **I want** codebase-graph descriptions to work, **so that** my one non-gateway key is truly fleet-wide.

**Acceptance criteria:**
- AC-8b.2.1 Brood/describe resolves a model call for the selected provider (gateway or direct, per the shipped phase) using `model.describe`.
- AC-8b.2.2 An unresolved/invalid selection leaves brooding dormant with an honest machine-readable reason and a dashboard-pointing message — never a fabricated ready state.

---

## Implementation notes

- **Edited:** [`brood-prereqs.ts`](../../../../nectar/src/brood-prereqs.ts) — resolution from the shared selection first, env override second; reasons/messages updated.
- **Edited/new:** Nectar describe transport dispatch (gateway + direct), reading `model.describe`; honeycomb materializes the selection to the daemon-local read path.
- **Security:** the key crosses no browser boundary; the shared read path is loopback/daemon-local, owned like `~/.deeplake/credentials.json`. Route this sub-PRD's implementation through `security-worker-bee` given it touches credential storage/movement.
- **Tests:** brood prereqs ready with shared selection + no env; env override still honored; describe dispatch per provider (mocked HTTP); dormancy reasons honest on an empty selection.

---

## Decisions

Confirmed 2026-07-12 (parent index [Decisions](./prd-008-unified-fleet-inference-credential-index.md#decisions-confirmed-2026-07-12)): the source of truth is a **dedicated fleet inference-credential file** beside `~/.deeplake/credentials.json` (daemon-local, `0600`, never browser-readable); Nectar ships **full five-provider parity** in the first release (no phasing); and `NECTAR_PORTKEY_*` env stays honored as a secondary override.
