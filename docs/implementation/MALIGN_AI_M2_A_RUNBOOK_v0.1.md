# MALIGN-AI — M2-A PostgreSQL Persistence Runbook v0.1

**Estado:** IMPLEMENTED / PENDING EXTERNAL REVIEW mediante DEC-078

**PostgreSQL:** 18.6

**Driver:** `pg` 8.23.0 de bajo nivel; sin ORM ni query builder

## Límites

M2-A implementa exclusivamente persistencia y recuperación durable. `pg` y SQL permanecen dentro de `packages/persistence` o composición de infraestructura. Domain, Rules, Game Engine, Contracts, Projections y AuthZ no conocen PostgreSQL. No hay RLS, browser-to-database, WebSocket productivo, proveedor externo ni trabajo M2-2+.

## Entorno local

```bash
cp .env.example .env
docker compose up -d postgres
docker compose ps
pnpm db:migrate
pnpm db:seed
pnpm db:verify
pnpm test:m2a
docker compose down
```

PostgreSQL ausente hace fallar el owner gate; no existe ruta de skip, mock, SQLite o PGlite. Las credenciales de `.env.example` son exclusivamente locales y no son secretos productivos.

## Migrations y manifest

El manifest `packages/persistence/migrations/manifest.json` fija orden y SHA-256. `malign_meta.schema_migrations` es el ledger técnico y no forma parte de las 87 tablas de producto; `malign.schema_migrations` conserva el mirror contractual del modelo aprobado.

| Versión | Archivo | Función |
|---:|---|---|
| 001 | `001_product_schema.sql` | 87 tablas, UUIDv7, PK/FK/UK/checks e índices |
| 002 | `002_append_only_and_ordering.sql` | historia inmutable, idempotency seal, pins e índices keyset |
| 003 | `003_roles_and_privileges.sql` | roles y revocaciones reproducibles |
| 004 | `004_recovery_gate.sql` | upgrade N-1 y bloqueo fail-closed |

La validación exige versiones contiguas y checksum exacto. Cada migration nueva corre en su propia transacción; un fallo revierte esa unidad. Reaplicar el bootstrap no reescribe ni duplica. No existe down migration automática.

## Roles

- `malign_migration_owner`: NOLOGIN; ownership/migrations, nunca runtime.
- `malign_app_runtime`: USAGE + DML server-side, sin DDL, DELETE ni rewrite de journals.
- `malign_outbox_publisher`: lee mensajes/estado, actualiza sólo columnas de delivery state e inserta attempts; no puede modificar gameplay.

`PUBLIC` no conserva privilegios sobre schema, tablas o funciones. Ninguna credencial se versiona. Application AuthZ y AuthorizedProjection continúan fail-closed antes del adapter.

## Registry seed

`pnpm db:seed` canonicaliza el snapshot mediante RFC 8785/JCS y exige SHA-256 `735fd01b65416bdeb1baaa596bb36ea0d0eef31cb1d1d9b7f4b2322c9c585e4a` antes de abrir writes. La seed idempotente conserva 100 definitions, 108 templates, 4 aliases, 59 effects y 103 operaciones. La materialización game-scoped produce 540 CardInstance: 108 por país y 25 Starter. Los Games conservan pins inmutables; publicar una versión futura no actualiza partidas existentes.

## Unit of Work

El command pipeline usa un solo `pg` client y `READ COMMITTED`: fast lookup idempotente; `BEGIN`; Game `FOR UPDATE`; recheck bajo lock; CAS; validación actor/game/pins; pending interno; RNG/Clock transaccionales; estado, journals, event/trace, continuation, snapshot, outbox; incremento único de versión; seal `COMMITTED`; `COMMIT`; observer post-commit. Cualquier fallo ejecuta rollback y restaura cursores. El CAS loser no deja estado, costes, sequence, artifacts ni idempotencia durable.

## Outbox y recuperación

`OutboxMessage` es inmutable, `OutboxDeliveryState` es mutable/reconciliable y `OutboxDeliveryAttempt` es append-only. El publisher de pruebas implementa pending, claim, send started/returned, ack, fail, lease expiry y retry. La garantía es at-least-once con deduplicación del consumidor, nunca exactly-once delivery.

Recovery carga estado, último snapshot, event tail, continuation discriminada y pins desde una instancia nueva. Replay no invoca RNG, Clock, IA ni provider externo. Reconciliation compara digest, sequence heads, AP, Resources, VP, influence, snapshots y outbox; un mismatch marca `recovery_blocked=true`, falla tipado y no repara historia.

## Backup y restore

Sólo se aceptan bases disposable cuyo nombre empiece con `malign_m2a_`:

```bash
scripts/m2a-backup.sh malign_m2a_source /tmp/malign-m2a.dump
scripts/m2a-restore.sh malign_m2a_restored /tmp/malign-m2a.dump
```

El owner gate usa `pg_dump`/`pg_restore` 18.6, restaura en una segunda base creada por el harness y compara manifest, registry hash y pins. Los scripts no eliminan bases y no implementan downgrade.

## Query budgets

Los seis fixtures estructurales cubren aggregate load, authorized projection, replay page, pending dashboard, outbox claim y registry pin lookup. Cada fixture declara query count determinístico e índice esperado; replay/feed usan keyset y prohíben `OFFSET`. El gate captura `EXPLAIN (FORMAT JSON)` sin fijar SLA temporal ni topología.

## Autoauditoría cerrada

| Hallazgo | Corrección y regresión |
|---|---|
| M2A-R01 | Eliminada dependencia accidental de `pgcrypto`; hash default usa funciones core. DB-001/002. |
| M2A-R02 | Corregidos nombres físicos de índices/triggers contra DDL aprobado. DB-001. |
| M2A-R03 | Pins de Game protegidos por trigger inmutable. DB-006. |
| M2A-R04 | Claim de outbox filtrable por Game para impedir cruce operacional. TX-006/007. |
| M2A-R05 | Ordinal de effects por definition evita colisión sin alterar 59/103. DB-005. |
| M2A-R06 | Upgrade N-1 usa comparación UUID tipada y preserva historia. DB-003. |
| M2A-R07 | Lease recovery continúa stage ordinals append-only sin colisión. TX-007. |
| M2A-R08 | CLI ESM usa `tsx` 4.20.6 fijado y build de `esbuild` explícitamente permitido; bootstrap/seed dobles ejecutables. |
| M2A-R09 | ACK, fail→retry y lease-expiry actualizan DeliveryState + attempts en transacciones atómicas. TX-007. |
| M2A-R10 | Reconciliation amplía el fail-closed matrix a state, event ordering, ledgers, orphan trace, outbox state, legitimacy, snapshots y pins. TX-009. |

Todos los hallazgos M2A-R01…R10 están corregidos dentro de M2-A. No se creó waiver ni `IMPLEMENTATION_QUESTION` nueva. IQ-M2-008/009 permanecen OPEN y bloquean exclusivamente M2-2.
