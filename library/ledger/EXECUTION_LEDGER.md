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
| 001-AC-1 | Registry entry w/ SQLite path loads into memory; hivedoctor polls that DB | hivedoctor | DONE | `hivedoctor/src/ingestion/poll-loop.ts:132` `createPollLoop`/`pollEntry`; `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-1/c-AC-2/c-AC-3: merges the static entry..."; `hivedoctor/tests/compose/telemetry-wiring.test.ts` "a registered entry with telemetryDbPath feeds the telemetry poll loop end to end" |
| 001-AC-2 | Legacy entry with no DB path parses fine; health-probe-only | hivedoctor | DONE | `hivedoctor/src/registry.ts:188` `coerceTelemetryDbPath` (returns `undefined`, not a default); `hivedoctor/tests/registry.test.ts` "a-AC-2: a legacy entry..."; `hivedoctor/tests/ingestion/poll-loop.test.ts` "001a-AC-2/001-AC-2: an entry with no telemetryDbPath is health-probe-only" |
| 001-AC-3 | Malformed registry falls back + surfaces needs-attention (no crash-loop) | hivedoctor | DONE | Pre-existing `resolveDaemons` fail-soft path (`hivedoctor/src/compose/index.ts`) untouched by this change; regression-verified: `hivedoctor/tests/compose/create-hivedoctor.test.ts` "a MALFORMED registry does not crash boot..." (19/19 compose tests still green) + new `hivedoctor/tests/compose/telemetry-wiring.test.ts` "a MALFORMED registry does not prevent the telemetry loop from wiring over the honeycomb-primary fallback" |
| 001-AC-4 | Runtime status row carries registration, binding time, last-seen, health, metrics | hivedoctor (reader side only; writing is each service's job) | DONE | `hivedoctor/src/telemetry/schema.ts` `ServiceStatusRow`; `hivedoctor/src/telemetry/sqlite-reader.ts` `parseStatusRow`; `hivedoctor/tests/ingestion/poll-loop.test.ts` "001b-AC-1/AC-5: round-trips a full-shape service_status row" proves the reader accepts/parses every contract field. hivedoctor never writes this row (Contract B); the writer half is each service's own PRD (honeycomb PRD-071a, hivenectar PRD-017a). |
| 001-AC-5 | Poll loop opens each DB read-only, windowed queries, probes /health, merges ~1s | hivedoctor | DONE | `hivedoctor/src/ingestion/poll-loop.ts` `createPollLoop` (default `intervalMs=1000`); `hivedoctor/tests/ingestion/poll-loop.test.ts` (20 tests, all passing) |
| 001-AC-6 | Service disconnect recorded with last-seen; static entry retained | hivedoctor | DONE | `hivedoctor/src/ingestion/poll-loop.ts` `pollEntry` disconnect branch; `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-4: a disconnected service..." |
| 001-AC-7 | Registry reload on boot/restart/explicit (de)registration | hivedoctor | DONE | Boot/restart: existing `resolveDaemons` (unchanged) re-reads the registry on every process start. Explicit (de)registration seam: `hivedoctor/src/ingestion/poll-loop.ts` `PollLoop.reload()`; `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-5/001-AC-7: reload() changes which databases are polled". No runtime HTTP registration API exists or is needed (PRD-001 explicit non-goal); `reload()` is the seam a future installer/CLI hook would call. |
| 001-AC-8 | Zero external runtime deps (node:sqlite only) | hivedoctor | DONE | `hivedoctor/src/telemetry/sqlite-reader.ts` imports only `node:sqlite`; `hivedoctor/src/ingestion/sse.ts` imports only `node:http` types; `hivedoctor/package.json` byte-for-byte unchanged (verified via `git diff package.json` = empty) |
| 001a-AC-1 | `telemetryDbPath` field parsed onto entry | hivedoctor | DONE | `hivedoctor/src/registry.ts:76` `DaemonEntry.telemetryDbPath`; `hivedoctor/tests/registry.test.ts` "a-AC-1: an entry with telemetryDbPath records the path with ~ expanded" |
| 001a-AC-2 | Legacy entry w/o field loads, marked health-probe-only | hivedoctor | DONE | `hivedoctor/src/registry.ts:208` `parseEntry`; `hivedoctor/tests/registry.test.ts` "a-AC-2: a legacy entry with no telemetryDbPath field loads without error, health-probe-only" |
| 001a-AC-3 | List of DB paths retained (if plural form supported) | hivedoctor | OPEN | Not implemented by design: the pinned Wave-0 "Contract A" in this ledger fixes `telemetryDbPath` as a SINGLE optional string (not string-or-array), specifically so honeycomb/hivenectar/the-hive could conform to one literal shape in parallel without waiting on hivedoctor's code to exist. A plural form would diverge from the contract every other Wave-1 repo built against. Left OPEN rather than fudged; revisit only via a follow-up ADR if a service genuinely needs multiple DB paths. |
| 001a-AC-4 | Malformed registry: fail-soft, needs-attention, no crash-loop | hivedoctor | DONE | `hivedoctor/tests/registry.test.ts` "a-AC-4: a malformed registry still throws RegistryError..."; regression-verified against `hivedoctor/tests/compose/create-hivedoctor.test.ts` (unchanged, all passing) |
| 001a-AC-5 | Existing PRD-004a fields preserved with identical semantics | hivedoctor | DONE | `hivedoctor/tests/registry.test.ts` "a-AC-5: every existing PRD-004a field is preserved..." (both with and without `telemetryDbPath` present) |
| 001b-AC-1 | Runtime row shape: registration, binding time, last-seen, health, metrics | hivedoctor (reader) / all services (writer) | DONE (reader side) | `hivedoctor/src/telemetry/sqlite-reader.ts` `parseStatusRow`/`parseMetricsRow`; `hivedoctor/tests/ingestion/poll-loop.test.ts` "001b-AC-1/AC-5" + "002b-AC-1". Writer side is each service's own PRD, not hivedoctor's job per the task scope. |
| 001b-AC-2 | Services write health/metric check-ins on interval, logs live | all services (writer) | OPEN | Writer-side behavior owned by honeycomb PRD-071a/b, hivenectar PRD-017a/b, the-hive's own service PRD. Nothing for hivedoctor to implement here; hivedoctor's reader (001c poll loop) is schema-tolerant and works against any conforming writer. |
| 001b-AC-3 | hivedoctor opens read-only; DB is WAL mode | hivedoctor | DONE | `hivedoctor/src/telemetry/sqlite-reader.ts:123` `openTelemetryDb` (`new DatabaseSync(path, { readOnly: true, timeout: 1000 })`); `hivedoctor/tests/ingestion/poll-loop.test.ts` "b-AC-3: opens read-only -- a write attempt through the reader's handle is rejected by SQLite". The DB actually BEING in WAL mode is set by each service's own writer (Contract B); hivedoctor's read-only reader works correctly against a WAL-mode file regardless. |
| 001b-AC-4 | No tokens/credentials/secrets/Deep Lake payloads in any written row | all services | OPEN | Writer-side hygiene rule for each service's own writer; hivedoctor only reads and forwards whatever non-sensitive columns the contract defines (Contract B), it has no way to enforce what another process chooses to write. |
| 001b-AC-5 | Runtime row associates with correct static registry entry by name | hivedoctor | DONE | Association is by construction: the poll loop opens exactly the DB at `entry.telemetryDbPath` and tags every model row with that SAME `entry.name` (`hivedoctor/src/ingestion/poll-loop.ts` `pollEntry`), which is a stronger guarantee than a text cross-check against the row's own `name` column (still parsed and available, `ServiceStatusRow.name`). `hivedoctor/tests/ingestion/poll-loop.test.ts` "001b-AC-1/AC-5". |
| 001c-AC-1 | Loop opens DB read-only WAL, windowed query, ~1s | hivedoctor | DONE | `hivedoctor/src/ingestion/poll-loop.ts` `pollEntry`; `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-1/c-AC-2/c-AC-3" |
| 001c-AC-2 | Loop probes /health, merges with SQLite read | hivedoctor | DONE | `hivedoctor/src/ingestion/poll-loop.ts` `classifyProbe`+`pollEntry`; same test as above |
| 001c-AC-3 | Merge = static entry + runtime row + health probe as one record | hivedoctor | DONE | `hivedoctor/src/telemetry/schema.ts` `FleetServiceModel`; `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-1/c-AC-2/c-AC-3" |
| 001c-AC-4 | Disconnect after ~1 interval: last-seen recorded, static entry retained | hivedoctor | DONE | `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-4: a disconnected service (stale last-seen + failing /health) is marked unreachable; last-seen and the static entry are retained" |
| 001c-AC-5 | Registry reload triggers (boot/restart/explicit) update polled DB set | hivedoctor | DONE | `hivedoctor/src/ingestion/poll-loop.ts` `PollLoop.reload()`; `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-5/001-AC-7: reload() changes which databases are polled" |
| 001c-AC-6 | One service's bad DB is isolated (skip + needs-attention); others unaffected | hivedoctor | DONE | `hivedoctor/src/ingestion/poll-loop.ts` `pollEntry` catch branch (sets `telemetryFault`); `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-6: one service's missing telemetry DB is isolated...", "c-AC-6: a malformed (non-SQLite)...", "c-AC-6: recovers on a later tick...". "Needs-attention" is surfaced as the model's `telemetryFault` field (forwarded over SSE) plus a `logger.warn`, not a durable `needs-attention-store.ts` record -- that store is scoped to the remediation ladder's restart/escalation flow, a different concept than a per-poll telemetry gap. |
| 001c-AC-7 | Memory bounded via windowed queries | hivedoctor | DONE | `hivedoctor/src/telemetry/sqlite-reader.ts` `readNewLogs` (cursor + `LIMIT`); `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-7/002c-AC-1/002c-AC-2: logs are read as a bounded, advancing window..." |
| 001c-AC-8 | Built-ins only (node:sqlite, node:http) | hivedoctor | DONE | Same evidence as 001-AC-8 |

### hivedoctor PRD-002: Telemetry SoT SSE stream and schema (Wave 1)

| ID | Criterion (condensed) | Owner | Status | Evidence |
|---|---|---|---|---|
| 002-AC-1 | Exactly one SSE stream hivedoctor→the-hive | hivedoctor | DONE | `hivedoctor/src/ingestion/sse.ts:54` `handleSseRequest`, mounted at `GET /events` via `hivedoctor/src/status-page/server.ts:91` `onEvents`; `hivedoctor/tests/compose/telemetry-wiring.test.ts` "wires /events onto the existing status page..."; `hivedoctor/tests/ingestion/sse.test.ts` "a-AC-1/a-AC-2" |
| 002-AC-2 | Stream carries merged health + actions/files/memories since restart | hivedoctor | DONE | `hivedoctor/src/telemetry/schema.ts:102` `FleetTelemetryEvent`; `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-1/c-AC-2/c-AC-3" (metrics `{actionsTaken, filesProcessed, memoriesCreated}` present in the merged model) |
| 002-AC-3 | Log rows carry verbosity level | hivedoctor | DONE | `hivedoctor/src/telemetry/schema.ts` `FleetLogEntry.level`; `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-7/002c-AC-1/002c-AC-2" (log rows carry `level: "info"`/`"warn"`) |
| 002-AC-4 | Deep Lake connection + last-comm stats present | hivedoctor | DONE | `hivedoctor/src/telemetry/schema.ts` `FleetDeeplakeStats`; `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-1/c-AC-2/c-AC-3" asserts `deeplake: { connected, lastCommunicationAt }` |
| 002-AC-5 | Memory bounded via windowed reads; DB bounded via retention/rotation | hivedoctor (reader half) / all services (writer half) | DONE (reader half); see 002c-AC-3/AC-5 for the writer half | `hivedoctor/src/telemetry/sqlite-reader.ts` `readNewLogs` windowed cursor read; `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-7/002c-AC-1/002c-AC-2". Retention/rotation of the underlying DB file is each service's own job (Contract B), tracked at 002c-AC-3/AC-5 below, left OPEN. |
| 002-AC-6 | Fail-soft: portal disconnect / DB unavailable never crashes hivedoctor | hivedoctor | DONE | `hivedoctor/src/ingestion/sse.ts` `safeWrite`/`cleanup`; `hivedoctor/tests/ingestion/sse.test.ts` "a-AC-5: a client disconnect unsubscribes..." + "never throws when res.write itself throws"; DB-unavailable half proven by `hivedoctor/tests/ingestion/poll-loop.test.ts` c-AC-6 tests (isolated fault never throws out of the tick) |
| 002-AC-7 | No external runtime dependency added | hivedoctor | DONE | Same evidence as 001-AC-8 |
| 002a-AC-1 | Exactly one SSE stream, no other streaming surface | hivedoctor | DONE | Same evidence as 002-AC-1; no other streaming endpoint exists anywhere in `hivedoctor/src` |
| 002a-AC-2 | Emits from in-memory model near-real-time (~1 poll interval) | hivedoctor | DONE | `hivedoctor/src/ingestion/sse.ts` writes the CURRENT snapshot immediately on connect, then one frame per `pollLoop.onSnapshot` tick; `hivedoctor/tests/ingestion/sse.test.ts` "a-AC-2: a subsequent poll-loop snapshot is forwarded as a fresh frame..." |
| 002a-AC-3 | Log rows carry verbosity | hivedoctor | DONE | Same evidence as 002-AC-3 |
| 002a-AC-4 | Deep Lake stats fields present | hivedoctor | DONE | Same evidence as 002-AC-4 |
| 002a-AC-5 | Disconnect/slow consumer cleaned up; hivedoctor keeps running | hivedoctor | DONE | `hivedoctor/tests/ingestion/sse.test.ts` "a-AC-5: a client disconnect unsubscribes from the poll loop and never throws" |
| 002a-AC-6 | One service's DB unavailable degrades only that service's fields | hivedoctor | DONE | `hivedoctor/tests/ingestion/sse.test.ts` "a-AC-6: a service flagged with a telemetryFault in the snapshot still flows through untouched" (the producer forwards whatever the poll loop's c-AC-6 isolation already produced) |
| 002a-AC-7 | node:http only, no external dep | hivedoctor | DONE | `hivedoctor/src/ingestion/sse.ts` imports only `node:http` types |
| 002b-AC-1 | Metrics schema: actions/files/memories since restart per service | hivedoctor + services | DONE (reader honors the schema, schema-tolerant) | `hivedoctor/src/telemetry/sqlite-reader.ts` `parseMetricsRow`; `hivedoctor/tests/ingestion/poll-loop.test.ts` "002b-AC-1: readMetrics() is schema-tolerant..." proven against BOTH honeycomb's 3-counter and hivenectar's 5-counter Contract-B variants with zero hivedoctor code changes |
| 002b-AC-2 | Log schema: timestamp + verbosity + message | hivedoctor + services | DONE (reader honors the schema) | `hivedoctor/src/telemetry/schema.ts` `ServiceLogRow`; `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-7/002c-AC-1/002c-AC-2" |
| 002b-AC-3 | Deep Lake stats schema: connection state + last-comm time | hivedoctor + services | DONE (reader honors the schema) | `hivedoctor/src/telemetry/sqlite-reader.ts` `parseStatusRow` (`deeplake_connected`/`deeplake_last_comm`); `hivedoctor/tests/ingestion/poll-loop.test.ts` "001b-AC-1/AC-5" |
| 002b-AC-4 | Schema changes are additive only | hivedoctor | DONE | By construction: `hivedoctor/src/telemetry/sqlite-reader.ts` `parseMetricsRow` forwards EVERY `service_metrics` column except `id`/`updated_at` generically (never a hardcoded column list), so a service adding a new counter needs zero hivedoctor code changes. Proven by the same test running two different column sets (`002b-AC-1`). |
| 002b-AC-5 | No secrets/tokens/PII in any row | all services | OPEN | Writer-side hygiene rule; hivedoctor has no way to enforce what another process writes into its own database. Each service's own PRD (honeycomb PRD-071, hivenectar PRD-017) owns this. |
| 002b-AC-6 | All reads read-only against WAL-mode DBs | hivedoctor | DONE | Same evidence as 001b-AC-3 |
| 002c-AC-1 | Reads return bounded windows, not whole history | hivedoctor | DONE | `hivedoctor/tests/ingestion/poll-loop.test.ts` "c-AC-7/002c-AC-1/002c-AC-2: logs are read as a bounded, advancing window -- never the whole history, and each tick forwards only NEW rows" |
| 002c-AC-2 | SSE delivers logs as bounded slices | hivedoctor | DONE | `hivedoctor/src/ingestion/poll-loop.ts` builds `logs` as only the NEW rows since the previous tick (never a rolling in-memory history) before handing the event to the SSE producer; same test as 002c-AC-1 |
| 002c-AC-3 | Retention/rotation prunes old rows within cap | all services (writer-side) | OPEN | Writer-side, cross-repo: each service caps/rotates its own `service_logs` table (Contract B: "writer caps at 5,000 rows"). Nothing for hivedoctor to implement; it is a read-only consumer regardless of how the writer manages retention. |
| 002c-AC-4 | Memory (hivedoctor) + disk (services) both stay bounded over time | hivedoctor + services | OPEN (hivedoctor half DONE, service-disk half is cross-repo) | hivedoctor's memory-bounded half is proven at 002c-AC-1 (windowed cursor reads never accumulate). Left OPEN overall because the AC also requires the SERVICES' on-disk retention to hold, which is each service's own PRD's job, not hivedoctor's to implement or test. |
| 002c-AC-5 | Rotation touches only its own telemetry rows, never other data | all services | OPEN | Writer-side, cross-repo; hivedoctor never writes or rotates any of these tables (it opens every service DB read-only), so it cannot violate or fix this AC either way. |

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
| g-AC-1..11 (003a) | Path-based routes (not hash); server determines route; unhealthy fleet → `/buzzing` before auth check; unauthenticated → `/login`; healthy+authed+`/` → dashboard; healthy+authed+specific route → that route; `/buzzing`/`/login` exempt (never redirect); no redirect loop; refresh-safe (server-side, no client-state dependency); redirect targets are a fixed internal allowlist (no open redirect) | DONE | `the-hive/src/daemon/gate.ts` (new `createPortalGate` middleware, registered first in `src/daemon/server.ts`, ahead of the asset routes/`/health`/`/api/fleet-status`/BFF proxy/shell catch-all) implements the health-then-auth precedence via the EXISTING `isFleetReady()`/`fetchFleetStatus` (`fleet-status.ts`) and a new `fetchSetupAuthenticated` (`setup-auth.ts`) that reads the SAME honeycomb base the BFF proxy resolves. `src/daemon/dashboard/host.ts` split into `mountDashboardAssets` + `mountDashboardShellFallback` (a `GET *` catch-all registered last) so every gated path serves the identical shell. Redirects are hard-coded literals only (`/buzzing`/`/login`), never derived from the request. Verified by `tests/daemon/gate.test.ts` (22 cases: precedence, health-before-auth, exempt-never-redirects across all health×auth combinations, redirect-loop-freedom, g-AC-11 open-redirect defense incl. a traversal-shaped path, infra bypass) plus updated `tests/daemon/server.test.ts`/`tests/dashboard/host.test.ts` (gate-aware). `npm run typecheck`, `npm test` (113/113), `npm run build` all green. |
| l-AC-1..8 (003b) | `/login` renders reused device-flow via BFF proxy to `/setup/login`; all `/setup/*` same-origin via existing proxy; `/login` gate-exempt; auth = proxied `/setup/state` `authenticated` bit; no portal session/cookie; `/setup/state` failure/timeout → treated as logged out; successful device-flow flips gate; post-completion lands on `/` or original route | DONE | `setup-gate.tsx`'s former `SetupGate` renamed to `LoginScreen` (mounted at `/login` by `main.tsx`'s `resolveBootScreen`): still renders the UNCHANGED `GuidedSetup`/`CoexistenceWarning`/`MigrationInterrupted` device-flow views sourced from the existing proxied `/setup/login`/`/setup/state` (no reimplementation, no new portal session/cookie). On `authenticated:true` it does a HARD `window.location.assign("/")` (not a client swap) so the server gate re-validates and lands the operator on `/` (or `/buzzing` if health regressed) — l-AC-7/l-AC-8. `fetchSetupAuthenticated` fails closed (`false`) on any fetch error/timeout, feeding the gate's l-AC-6 requirement. Verified by `tests/dashboard/login-screen.test.tsx` (renders guided-setup while logged out; hard-navigates on auth flip; a failed poll never navigates) and `tests/daemon/gate.test.ts`'s l-AC-6 case. |
| m-AC-1..8 (003c) | `useHashRoute`/`routeFromHash` removed; History API back/forward works; all 9 existing routes reachable at real paths w/ identical content; `registry.tsx` mapping preserved 1:1; `/` renders dashboard post-migration; `ReadinessSplash`→`SetupGate` nested pre-mount gate removed, replaced by server gate; `ReadinessSplash` becomes `/buzzing` route (PRD-004); `SetupGate`'s device-flow view becomes `/login` route | DONE | `router.tsx` rewritten: `useHashRoute`/`routeFromHash` deleted, replaced by `usePathRoute`/`routeFromPath` (History API `pushState` + `popstate`, no `location.hash`). `app.tsx` and `pages/harnesses.tsx` (its per-harness detail sub-route) updated to the new hook. `registry.tsx`'s 9-entry `ROUTES` array and `matchRoute` mapping are UNCHANGED (already path-shaped strings) — only its docs/param names updated from "hash" to "path". `main.tsx` rewritten to a pure `resolveBootScreen(pathname)` lookup (`boot-route.ts`, new) that mounts `<ReadinessSplash>` at `/buzzing`, `<LoginScreen>` at `/login`, or `<Shell>` (the dashboard + its own path router) otherwise — the old `<ReadinessSplash>`→`<SetupGate>` unconditional pre-mount nesting is gone; the landing decision is the server gate (003a). Verified by `tests/dashboard/router.test.tsx` (path read, History push, `popstate` back/forward), `tests/dashboard/boot-route.test.ts` (all 9 registry routes + `/` + unknown → `shell`; `/buzzing`/`/login` → their screens), `tests/dashboard/registry.test.ts` (pre-existing, unmodified — proves the 9-route mapping survived), and `tests/daemon/gate.test.ts`'s m-AC-3 case (all 9 routes serve the identical shell end-to-end through the real server). `tests/dashboard/copy-map.test.ts` updated for the one new file (`boot-route.ts`, 29→30). |

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
| AC-1..5 (index) | Manifest pins 4 product versions; CI fails on unresolvable/inconsistent pins; the-hive+hivenectar publish via OIDC; installer installs exactly the pinned set; each submodule's own release path unchanged | IN PROGRESS | `hive-release.json` (AC-1) and `.github/workflows/{manifest-validate,release-train}.yaml` (AC-2) + `the-hive/.github/workflows/release.yaml` + `hivenectar/.github/workflows/release.yaml` (AC-3) all created and verified as described in the a-AC/b-AC/c-AC rows below (AC-5 holds by construction: no submodule `ci.yaml`/`release.yaml` was edited). AC-4 (the installer actually installing the pinned set) is explicitly out of scope for PRD-001 per its own Non-Goals ("Product selection... is PRD-002") — left OPEN, owned by the-apiary PRD-002 (Wave 2). Row is IN PROGRESS rather than DONE only because of that one out-of-scope sub-criterion. |
| a-AC-1..4 (001a) | `hive-release.json` at superproject root, documented schema, versioned; 4 required pins, missing pin invalid; schema documented for CI+installer; reserves room for future per-product metadata | DONE | `hive-release.json` (superproject root) + companion `hive-release.schema.md`. `manifestVersion: "0.1.0"`; `products` map has exactly the 4 required slugs (`honeycomb`, `hivedoctor`, `thehive`, `hivenectar`), each an object with a required `version` (a-AC-2: enforced by `.github/scripts/validate-hive-release-manifest.mjs`, which fails closed on a missing/empty pin — verified locally against a deliberately broken manifest, see below). Each entry is an object (not a bare string) specifically so future optional fields (`integrityHash`, `minNodeVersion`, `tagName`, documented in the schema doc) never require a breaking shape change (a-AC-4). `hive-release.schema.md` documents required vs optional fields in a table (a-AC-3). Verified by: (1) `node -e "JSON.parse(...)"` — parses cleanly; (2) ran `node .github/scripts/validate-hive-release-manifest.mjs hive-release.json` locally — PASSED, and it correctly resolved the real `@legioncodeinc/honeycomb@0.1.13` and `@legioncodeinc/hivedoctor@0.1.10` pins against the live npm registry; (3) ran the same validator against a hand-crafted broken manifest (missing version, unresolvable version) — correctly FAILED with 2 distinct, clear error messages and exit code 1. |
| b-AC-1..5 (001b) | PR touching manifest runs validation (resolvable + consistent); clear failure message; fleet tag runs release train; train never touches submodule CI; same manifest version → same 4 pins on repeat runs | DONE (b-AC-1/b-AC-2 softened for the two unpublished products, by explicit task instruction — see note) | `.github/workflows/manifest-validate.yaml` (triggers on any PR touching `hive-release.json`/schema/validator/itself) and `.github/workflows/release-train.yaml` (triggers on superproject `v*` tag push) both created; both invoke the identical `.github/scripts/validate-hive-release-manifest.mjs`. b-AC-1/b-AC-2: verified locally (workflow itself is untested in real CI — see report) that the validator passes cleanly for honeycomb/hivedoctor via live registry resolution and fails with a clear, specific, non-crashing message on a malformed manifest. For `thehive`/`hivenectar`, which the manifest marks `published: false` because PRD-001c's pipelines were only just added in this same change, registry resolution is deliberately skipped with a distinguishable "NOT YET PUBLISHED" log line rather than crashing/hard-failing — this is the explicit behavior requested for this pass; once each cuts a first real tag, flipping `published` to `true` (or removing the field) makes the same workflow enforce full 4-way resolution with zero workflow changes. b-AC-3: `release-train.yaml` runs the same validation on a `v*` tag and, on success, mints a GitHub Release naming the manifest version (`softprops/action-gh-release`) — this is the "mark that manifest version as a released fleet" mechanism; untested against a real tag push (no tag was pushed in this pass). b-AC-4: verified by construction/code review — `release-train.yaml` and `manifest-validate.yaml` check out the superproject only (`submodules: false`), never check out or invoke any submodule workflow, and hold no permissions beyond `contents:` (no `id-token`, since neither workflow ever publishes to npm). b-AC-5: holds by construction — `hive-release.schema.md` documents that the manifest is hand-pinned, never regenerated from submodule pointers, so the committed file at a given tag is immutable and any two reads resolve identically; no installer exists yet to exercise this end-to-end (PRD-002, Wave 2). |
| c-AC-1..4 (001c) | the-hive OIDC publish workflow (mirrors honeycomb); hivenectar OIDC publish workflow; tagged versions resolve+pin+validate; each product's release path stays independent | DONE (c-AC-3's registry resolution genuinely blocked on a human npm-side action — see note) | `the-hive/.github/workflows/release.yaml` and `hivenectar/.github/workflows/release.yaml` created, each mirroring `honeycomb/.github/workflows/release.yaml`'s OIDC Trusted Publishing shape line-for-line (same `id-token: write`/`contents: write` permissions, same npm-11.6.2-upgrade + dummy-authToken-strip steps, same tag-vs-`package.json`-version guard, same fail-closed preflight adapted from hivedoctor's version-sentinel + scoped-name guard, same publish-mode resolution keyed off trigger not token, same idempotent "already on npm" rerun guard, same dry-run-by-default `workflow_dispatch`, same `softprops/action-gh-release` step) — adjusted only for each package's real scripts (no aggregate `npm run ci`/`pack:check` script exists in either package today, so the gate runs `typecheck` + `test` as discrete steps instead of inventing scripts that don't exist; hivenectar's `build` is a plain `tsc`, honeycomb's/the-hive's includes an esbuild bundle step). c-AC-1/c-AC-2 (workflow exists, OIDC-only, no `NPM_TOKEN` anywhere): DONE, verified by code review — grep for `NPM_TOKEN` across both new files returns nothing. Minimum package.json fixes applied per this PRD's own implementation notes ("if missing publishConfig/files/correct bin, fix the minimum needed for a valid publish"): both `the-hive/package.json` and `hivenectar/package.json` were missing `publishConfig` (`access: public`, `provenance: true`) and a `prepack` script — added both; `files`/`bin`/scoped `name` were already correct in both, no other changes made. Verified locally: `npm run typecheck`, `npm run build`, and `npm publish --provenance --access public --dry-run` all succeed cleanly for both packages against the current working tree (the-hive: 157 files, 495.7 kB tarball; hivenectar: 167 files, 149.3 kB tarball — full local output captured in this session). c-AC-3 (a tagged version resolves + validates): the manifest-validator side is proven (see a-AC/b-AC evidence above); the registry-resolvability half is genuinely BLOCKED on a human action outside this session's scope — npm Trusted Publishing requires the package to already exist on the registry before a trusted publisher can be configured for it, so `@legioncodeinc/thehive` and `@legioncodeinc/hivenectar` each need a one-time manual `npm publish` (2FA) bootstrap plus npm-side trusted-publisher registration (org + repo + `release.yaml` filename) before their first real tag push can succeed — identical to honeycomb's/hivedoctor's own documented bootstrap. This is flagged, not fabricated as done. c-AC-4 (independent release path): DONE by construction — each workflow lives in its own submodule repo, fires on that repo's own `v*` tags only, and no submodule's existing `ci.yaml` (neither exists nor was touched) was created or modified by this change. |

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
