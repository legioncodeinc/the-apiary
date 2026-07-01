# Execution Ledger: Portal and Telemetry Realignment

> Driven by `/the-smoker` against `library/initiatives/portal-and-telemetry-realignment.md` and its 9 constituent PRDs (5 repos). This ledger is the single source of truth for every acceptance criterion in scope. Status values: `OPEN`, `IN PROGRESS`, `DONE`, `VERIFIED`, `BLOCKED`.

**Branches:** `feature/portal-realignment-impl` in the-apiary, the-hive, hivedoctor, honeycomb, hivenectar (all created off latest `main`).

## Pinned Wave-0 contracts (defined here, before code, so Wave 1 can run in parallel)

These three contracts are PINNED as written specs so honeycomb/hivenectar/the-hive implementers do not have to wait on hivedoctor's code to literally exist first; hivedoctor's own implementation must conform to these same specs.

### Contract A: extended static registry entry (hivedoctor ADR-0002 / PRD-001a)

Adds one new OPTIONAL field to the existing `DaemonEntry` shape in `hivedoctor/src/registry.ts`:

```json
{
  "name": "honeycomb",
  "healthUrl": "http://127.0.0.1:3850/health",
  "pidPath": "~/.honeycomb/daemon.pid",
  "probeIntervalMs": 30000,
  "startupGraceMs": 60000,
  "restartGiveUpThreshold": 3,
  "restartCooldownMs": 5000,
  "telemetryDbPath": "~/.honeycomb/telemetry/honeycomb.sqlite"
}
```

- `telemetryDbPath` (string, optional, `~`-expanded like `pidPath`). Absent means health-probe-only (no SQLite ingestion), preserving the existing PRD-004a fallback.
- Purely additive; `coerceName`/`coerceHealthUrl`/`coercePidPath`/interval coercions are unchanged.

### Contract B: runtime status, metrics, and log SQLite schema (hivedoctor ADR-0001/0002, PRD-001b/002b)

Each service's `telemetryDbPath` database (WAL mode, `node:sqlite`) contains:

```sql
CREATE TABLE IF NOT EXISTS service_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  binding_time TEXT NOT NULL,       -- ISO-8601, set once at process start
  last_seen TEXT NOT NULL,          -- ISO-8601, updated every heartbeat
  health TEXT NOT NULL,             -- 'ok' | 'degraded' | 'unconfigured'
  deeplake_connected INTEGER,       -- 0/1, nullable
  deeplake_last_comm TEXT           -- ISO-8601, nullable
);

-- honeycomb's metric set (3 counters)
CREATE TABLE IF NOT EXISTS service_metrics (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  actions_taken INTEGER NOT NULL DEFAULT 0,
  files_processed INTEGER NOT NULL DEFAULT 0,
  memories_created INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- hivenectar's metric set (5 counters; own table variant, additive per PRD-002b-AC-4)
CREATE TABLE IF NOT EXISTS service_metrics (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  files_registered INTEGER NOT NULL DEFAULT 0,
  nectars_minted INTEGER NOT NULL DEFAULT 0,
  descriptions_generated INTEGER NOT NULL DEFAULT 0,
  source_graph_versions INTEGER NOT NULL DEFAULT 0,
  embeddings_computed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('error','warn','info','debug')),
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_service_logs_ts ON service_logs(ts DESC);
```

- `service_status` / `service_metrics` are single-row (`id=1`) latest-wins tables, updated in place, never appended.
- `service_logs` is append-only but rotated: writer caps at 5,000 rows (delete oldest beyond cap after insert or on an interval).
- Metrics reset to 0 on process start (a new `binding_time` implies fresh counters).
- Non-sensitive only: no tokens, credentials, memory bodies, source content, descriptions, or PII in any column.
- hivedoctor opens every service DB **read-only**.

### Contract C: hivedoctor to the-hive SSE event shape (ADR-0001, PRD-002a)

Single stream at `GET http://127.0.0.1:3852/events` (loopback only), `text/event-stream`, one event type `fleet-telemetry`:

```json
{
  "asOf": "2026-07-01T18:00:00.000Z",
  "services": [
    {
      "name": "honeycomb",
      "health": "ok",
      "lastSeen": "2026-07-01T17:59:59.500Z",
      "metrics": { "actionsTaken": 12, "filesProcessed": 3, "memoriesCreated": 5 },
      "deeplake": { "connected": true, "lastCommunicationAt": "2026-07-01T17:59:50.000Z" }
    }
  ],
  "logs": [{ "service": "honeycomb", "ts": "2026-07-01T17:59:59.400Z", "level": "info", "message": "..." }]
}
```

- Emitted once per poll tick (about 1s). A never-registered service is absent from `services`; a registered-but-silent service appears with `health: "unknown"`.
- `GET /api/fleet-status` (the-hive's existing REST projection) stays as the fail-soft fallback when the SSE stream is unavailable.

---

## Wave plan

| Wave | Rows | Rule |
|---|---|---|
| 0 | Contracts A/B/C above | Pinned in writing before any Wave 1 dispatch (this section). |
| 1 | hivedoctor PRD-001, PRD-002; honeycomb PRD-071; hivenectar PRD-017; the-hive PRD-003; the-apiary PRD-001 | All run in parallel, each conforming to the pinned contracts. |
| 2 | the-hive PRD-004, PRD-005; the-apiary PRD-002 | Consume hivedoctor's real SSE/registry (Wave 1 output) + the-apiary PRD-001's publish pipelines. |
| 3 | Close-out | security-worker-bee then quality-worker-bee per repo, medium+ remediated. |
| 4 | Ship | Commit, push, PR per repo, include ledger summary. |

## AC Ledger

### hivedoctor PRD-001: Service registration and telemetry ingestion (Wave 1, contract-conformant)

| ID | Criterion (condensed) | Owner (repo) | Status | Evidence |
|---|---|---|---|---|
| 001-AC-1 | Registry entry w/ SQLite path loads into memory; hivedoctor polls that DB | hivedoctor | OPEN | |
| 001-AC-2 | Legacy entry with no DB path parses fine; health-probe-only | hivedoctor | OPEN | |
| 001-AC-3 | Malformed registry falls back + surfaces needs-attention (no crash-loop) | hivedoctor | OPEN | (already implemented pre-realignment; verify no regression) |
| 001-AC-4 | Runtime status row carries registration, binding time, last-seen, health, metrics | hivedoctor | OPEN | |
| 001-AC-5 | Poll loop opens each DB read-only, windowed queries, probes /health, merges ~1s | hivedoctor | OPEN | |
| 001-AC-6 | Service disconnect recorded with last-seen; static entry retained | hivedoctor | OPEN | |
| 001-AC-7 | Registry reload on boot/restart/explicit (de)registration | hivedoctor | OPEN | |
| 001-AC-8 | Zero external runtime deps (node:sqlite only) | hivedoctor | OPEN | |
| 001a-AC-1 | `telemetryDbPath` field parsed onto entry | hivedoctor | OPEN | |
| 001a-AC-2 | Legacy entry w/o field loads, marked health-probe-only | hivedoctor | OPEN | |
| 001a-AC-3 | List of DB paths retained (if plural form supported) | hivedoctor | OPEN | |
| 001a-AC-4 | Malformed registry: fail-soft, needs-attention, no crash-loop | hivedoctor | OPEN | |
| 001a-AC-5 | Existing PRD-004a fields preserved with identical semantics | hivedoctor | OPEN | |
| 001b-AC-1 | Runtime row shape: registration, binding time, last-seen, health, metrics | hivedoctor (reader) / all services (writer) | OPEN | |
| 001b-AC-2 | Services write health/metric check-ins on interval, logs live | all services (writer) | OPEN | |
| 001b-AC-3 | hivedoctor opens read-only; DB is WAL mode | hivedoctor | OPEN | |
| 001b-AC-4 | No tokens/credentials/secrets/Deep Lake payloads in any written row | all services | OPEN | |
| 001b-AC-5 | Runtime row associates with correct static registry entry by name | hivedoctor | OPEN | |
| 001c-AC-1 | Loop opens DB read-only WAL, windowed query, ~1s | hivedoctor | OPEN | |
| 001c-AC-2 | Loop probes /health, merges with SQLite read | hivedoctor | OPEN | |
| 001c-AC-3 | Merge = static entry + runtime row + health probe as one record | hivedoctor | OPEN | |
| 001c-AC-4 | Disconnect after ~1 interval: last-seen recorded, static entry retained | hivedoctor | OPEN | |
| 001c-AC-5 | Registry reload triggers (boot/restart/explicit) update polled DB set | hivedoctor | OPEN | |
| 001c-AC-6 | One service's bad DB is isolated (skip + needs-attention); others unaffected | hivedoctor | OPEN | |
| 001c-AC-7 | Memory bounded via windowed queries | hivedoctor | OPEN | |
| 001c-AC-8 | Built-ins only (node:sqlite, node:http) | hivedoctor | OPEN | |

### hivedoctor PRD-002: Telemetry SoT SSE stream and schema (Wave 1)

| ID | Criterion (condensed) | Owner | Status | Evidence |
|---|---|---|---|---|
| 002-AC-1 | Exactly one SSE stream hivedoctor→the-hive | hivedoctor | OPEN | |
| 002-AC-2 | Stream carries merged health + actions/files/memories since restart | hivedoctor | OPEN | |
| 002-AC-3 | Log rows carry verbosity level | hivedoctor | OPEN | |
| 002-AC-4 | Deep Lake connection + last-comm stats present | hivedoctor | OPEN | |
| 002-AC-5 | Memory bounded via windowed reads; DB bounded via retention/rotation | hivedoctor | OPEN | |
| 002-AC-6 | Fail-soft: portal disconnect / DB unavailable never crashes hivedoctor | hivedoctor | OPEN | |
| 002-AC-7 | No external runtime dependency added | hivedoctor | OPEN | |
| 002a-AC-1 | Exactly one SSE stream, no other streaming surface | hivedoctor | OPEN | |
| 002a-AC-2 | Emits from in-memory model near-real-time (~1 poll interval) | hivedoctor | OPEN | |
| 002a-AC-3 | Log rows carry verbosity | hivedoctor | OPEN | |
| 002a-AC-4 | Deep Lake stats fields present | hivedoctor | OPEN | |
| 002a-AC-5 | Disconnect/slow consumer cleaned up; hivedoctor keeps running | hivedoctor | OPEN | |
| 002a-AC-6 | One service's DB unavailable degrades only that service's fields | hivedoctor | OPEN | |
| 002a-AC-7 | node:http only, no external dep | hivedoctor | OPEN | |
| 002b-AC-1 | Metrics schema: actions/files/memories since restart per service | hivedoctor + services | OPEN | |
| 002b-AC-2 | Log schema: timestamp + verbosity + message | hivedoctor + services | OPEN | |
| 002b-AC-3 | Deep Lake stats schema: connection state + last-comm time | hivedoctor + services | OPEN | |
| 002b-AC-4 | Schema changes are additive only | hivedoctor | OPEN | |
| 002b-AC-5 | No secrets/tokens/PII in any row | all services | OPEN | |
| 002b-AC-6 | All reads read-only against WAL-mode DBs | hivedoctor | OPEN | |
| 002c-AC-1 | Reads return bounded windows, not whole history | hivedoctor | OPEN | |
| 002c-AC-2 | SSE delivers logs as bounded slices | hivedoctor | OPEN | |
| 002c-AC-3 | Retention/rotation prunes old rows within cap | all services (writer-side) | OPEN | |
| 002c-AC-4 | Memory (hivedoctor) + disk (services) both stay bounded over time | hivedoctor + services | OPEN | |
| 002c-AC-5 | Rotation touches only its own telemetry rows, never other data | all services | OPEN | |

### honeycomb PRD-071: Service check-in and SQLite telemetry (Wave 1, needs Contracts A/B)

| ID | Criterion (condensed) | Status | Evidence |
|---|---|---|---|
| 071-AC-1..10 (index) | Registry entry w/ DB path on install; check-in w/ binding time + health; heartbeat advances last-seen; live metrics pollable; logs w/ verbosity pollable; restart resets counters; SQLite failure fail-soft; log rotation bounded; hivedoctor reads read-only w/o lock contention; no sensitive data in any row | OPEN | |
| 071a-AC (7 rows) | Registry entry on install/reinstall (idempotent); check-in binding time/health matches `/health`; heartbeat advances last-seen; restart updates binding time, DB path stable | OPEN | |
| 071b-AC (4 rows) | Metrics snapshot readable (latest-wins); values derive from existing counters (memoryCount, sessions/turns, ROI) without double-count; restart resets to zero; no sensitive data | OPEN | |
| 071c-AC (5 rows) | Log rows readable w/ timestamp + verbosity; rotation bounds table; bounded over time; every row has verbosity; no sensitive data | OPEN | |

### hivenectar PRD-017: Service check-in and SQLite telemetry (Wave 1, needs Contracts A/B)

| ID | Criterion (condensed) | Status | Evidence |
|---|---|---|---|
| 017-AC-1..10 (index) | Same shape as honeycomb PRD-071 but extends existing `src/hivedoctor-registry.ts`; metric set = files registered, nectars minted, descriptions generated, source-graph versions, embeddings computed | OPEN | |
| 017a-AC (7 rows) | Extend `HivedoctorRegistryEntry`/`buildHivenectarRegistryEntry()` w/ DB path; idempotent re-registration keyed by name, preserves other entries; malformed-registry fail-loud behavior UNCHANGED (`HivedoctorRegistryError`); check-in binding time/health | OPEN | |
| 017b-AC (4 rows) | 5-counter metrics snapshot; counters increment once per unit of work (no double-count across PRD-006/007/016/005/014 touchpoints); restart resets; no sensitive data (esp. no source content/descriptions) | OPEN | |
| 017c-AC (5 rows) | Log rows w/ timestamp+verbosity; rotation bounded; bounded over time; no sensitive data | OPEN | |

### the-hive PRD-003: Portal landing gate and routing (Wave 1, independent, no hivedoctor dependency)

| ID | Criterion (condensed) | Status | Evidence |
|---|---|---|---|
| g-AC-1..11 (003a) | Path-based routes (not hash); server determines route; unhealthy fleet → `/buzzing` before auth check; unauthenticated → `/login`; healthy+authed+`/` → dashboard; healthy+authed+specific route → that route; `/buzzing`/`/login` exempt (never redirect); no redirect loop; refresh-safe (server-side, no client-state dependency); redirect targets are a fixed internal allowlist (no open redirect) | OPEN | |
| l-AC-1..8 (003b) | `/login` renders reused device-flow via BFF proxy to `/setup/login`; all `/setup/*` same-origin via existing proxy; `/login` gate-exempt; auth = proxied `/setup/state` `authenticated` bit; no portal session/cookie; `/setup/state` failure/timeout → treated as logged out; successful device-flow flips gate; post-completion lands on `/` or original route | OPEN | |
| m-AC-1..8 (003c) | `useHashRoute`/`routeFromHash` removed; History API back/forward works; all 9 existing routes reachable at real paths w/ identical content; `registry.tsx` mapping preserved 1:1; `/` renders dashboard post-migration; `ReadinessSplash`→`SetupGate` nested pre-mount gate removed, replaced by server gate; `ReadinessSplash` becomes `/buzzing` route (PRD-004); `SetupGate`'s device-flow view becomes `/login` route | OPEN | |

### the-hive PRD-004: Buzzing readiness screen and status loaders (Wave 2, blocked on hivedoctor SSE/registry landing)

| ID | Criterion (condensed) | Status | Evidence |
|---|---|---|---|
| 004-IDX-1..7 | One tile per registered service; 5 bee-SVG states render; SSE-driven near-real-time per-tile updates; REST fallback when SSE down; one service's failure isolates to its tile; readiness-driven dismissal (reuse `isFleetReady`); deterministic single shared state-derivation | BLOCKED | needs hivedoctor Wave 1 |
| bz-AC-1..10 (004a) | Independent subset (bz-AC-9, bz-AC-10, and the fallback-wiring half of bz-AC-3/AC-5) buildable now; rest blocked on live SSE/registration | OPEN (partial) / BLOCKED (rest) | |
| svg-AC-1..6 (004b) | Fully independent: 5 distinct bee SVGs, shape-distinguishable (not color-only), legible + dark-mode, single shared state→icon map, fail-safe default icon, state enum contract (5 states, no more/fewer) | OPEN | |
| sd-AC-1..9 (004c) | All blocked: derivation needs hivedoctor's actual health enum/thresholds | BLOCKED | needs hivedoctor Wave 1 |

### the-hive PRD-005: Health rail and health page (Wave 2, blocked on hivedoctor SSE/registry landing)

| ID | Criterion (condensed) | Status | Evidence |
|---|---|---|---|
| 005-IDX-1..7 | Health rail on every route; REST fallback; `/health` shows metrics since restart, Deep Lake stats, live logs w/ verbosity; windowed consumption; browser never contacts hivedoctor directly (proxied) | BLOCKED | needs hivedoctor Wave 1 |
| hr-AC-1..7 (005a) | Independent subset: fallback-wiring half of hr-AC-4/AC-6; rest blocked | OPEN (partial) / BLOCKED (rest) | |
| hm-AC-1..10 (005b) | All blocked: no metrics/Deep-Lake-stats source exists yet | BLOCKED | needs hivedoctor Wave 1 |
| lg-AC-1..8 (005c) | All blocked: no live log SSE feed exists yet | BLOCKED | needs hivedoctor Wave 1 |

### the-apiary PRD-001: Hive release manifest and combined release train (Wave 1, independent)

| ID | Criterion (condensed) | Status | Evidence |
|---|---|---|---|
| AC-1..5 (index) | Manifest pins 4 product versions; CI fails on unresolvable/inconsistent pins; the-hive+hivenectar publish via OIDC; installer installs exactly the pinned set; each submodule's own release path unchanged | OPEN | |
| a-AC-1..4 (001a) | `hive-release.json` at superproject root, documented schema, versioned; 4 required pins, missing pin invalid; schema documented for CI+installer; reserves room for future per-product metadata | OPEN | |
| b-AC-1..5 (001b) | PR touching manifest runs validation (resolvable + consistent); clear failure message; fleet tag runs release train; train never touches submodule CI; same manifest version → same 4 pins on repeat runs | OPEN | |
| c-AC-1..4 (001c) | the-hive OIDC publish workflow (mirrors honeycomb); hivenectar OIDC publish workflow; tagged versions resolve+pin+validate; each product's release path stays independent | OPEN | |

### the-apiary PRD-002: Installer product loading and phone-home (Wave 2, needs PRD-001's publish pipelines)

| ID | Criterion (condensed) | Status | Evidence |
|---|---|---|---|
| AC-1..7 (index) | `--products=` installs exact set + registers; phone-home fires even keyless/early-failure; product code resolves to set+config; flags/env/config-file same precedence; installer installs the-hive+hivenectar (not just opens URL); registration created/updated on install/update/delete; stable anon install id, `honeycomb_first_link` unchanged | BLOCKED (partial) | AC-5 needs PRD-001c publish pipelines |
| a-AC-1..6 (002a) | Flag parsing; `--code=` resolution; flags/env/config precedence; combo-URL sugar; `--profile=`/`--license=` parse+thread; sh+ps1 parity | OPEN | |
| b-AC-1..5 (002b) | Installs the-hive/hivenectar when selected; installs at manifest-pinned version; registry entry created; updated on install/update/delete; `--products=honeycomb,thehive` installs exactly those | BLOCKED | needs PRD-001c |
| c-AC-1..6 (002c) | `install_started` fires at run start; `install_completed`/`install_failed` fires at terminal state incl. pre-CLI failure; public key baked in, fires keyless; stable anon id shared start/terminal; `honeycomb_installed` de-duplicated vs new event; sh+ps1 parity | OPEN | |

---

## Watchdog log

(populated as agents are dispatched/terminated/decomposed)

## Blocked items requiring user input

(none yet: all current BLOCKED items are internally sequenced by wave, not external blockers)
