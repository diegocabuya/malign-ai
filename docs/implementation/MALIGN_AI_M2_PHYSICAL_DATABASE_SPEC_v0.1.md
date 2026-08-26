# MALIGN-AI — M2 PHYSICAL DATABASE SPECIFICATION v0.1

**Fecha:** 2026-08-26
**Estado:** **M2-0 CORRECTION M20-R01…R06 IMPLEMENTED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW — NO EXECUTABLE SCHEMA AUTHORIZED**
**Autoridad de preparación:** DEC-076
**Implementación, DDL, migrations y seed:** **NOT AUTHORIZED**

> Esta es una especificación física candidata, no SQL, migration, seed, configuración de proveedor ni selección de ORM. Una revisión humana posterior debe aprobarla antes de M2-1.

## 1. Resultado de la reconciliación

El modelo físico propuesto contiene exactamente **87 tablas**. No se fuerza el antiguo catálogo mínimo de 61: se preservan sus 61 entidades, se incorpora `ScenarioCountryConfig` que sí existe en el Data Dictionary, se materializan tres relaciones normalizadas exigidas allí (`GameOutcomeWinner`, `DealParticipant`, `TemporaryRevealCard`) y se añaden 22 tablas físicas necesarias para versionado, sesiones, requests/continuations, durabilidad, idempotencia, outbox, snapshots y recovery.

```text
61 catálogo lógico mínimo del Game Data Model
+1 ScenarioCountryConfig del Data Dictionary
+3 relaciones normalizadas explícitas del Data Dictionary
+22 extensiones físicas/arquitectónicas M1–M2
=87 tablas físicas propuestas
```

No existe ninguna obligación normativa de mantener el número 61. Cada extensión tiene una fuente concreta; ninguna introduce una regla de juego.

## 2. Convenciones físicas

### 2.1 Tipos y columnas comunes

- `uuid`: UUIDv7 para PK físicas y FKs de instancia. La forma de generación queda abierta en IQ-M2-011.
- `text`: UTF-8; nunca se usa un nombre visible como identidad.
- `smallint`, `integer`, `bigint`: enteros exactos; contadores normativos usan checks no negativos/positivos.
- `boolean`: no nullable salvo que una tabla diga lo contrario.
- `timestamptz`: UTC; `created_at` no nullable y sin semántica de orden autoritativo.
- `jsonb`: sólo para estructuras versionadas y runtime-validated; cada columna JSON crítica tiene `*_schema_id` + `*_schema_version` FK a `json_schema_versions`.
- `bytea`: digests/hash binarios; la representación de intercambio es hex lowercase.
- `M`: `id uuid PK`, `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`, `row_version bigint NOT NULL DEFAULT 1 CHECK >0`.
- `A`: `id uuid PK`, `created_at timestamptz NOT NULL`; fila append-only, sin update/delete funcional. Todo journal o artifact game-scoped que participe en replay añade `game_event_sequence bigint NOT NULL` y `artifact_ordinal smallint NOT NULL`: el par se asigna bajo el lock de Game, usa ordinal 1…N determinístico dentro del command/event y tiene `UNIQUE(game_id, game_event_sequence, artifact_ordinal)` en cada journal. Una tabla con un orden canónico más fuerte ya declarado (`game_events`, outbox message/attempt, AP por subject) lo conserva y referencia la misma secuencia causal.
- `TXS`: `id uuid PK`, `created_at timestamptz NOT NULL`; fila sellada por transacción: identidad y fingerprint inmutables, única transición `INTERNAL_PENDING → COMMITTED` dentro de la misma command transaction, y estado `INTERNAL_PENDING` nunca visible después de commit; una fila `COMMITTED` queda inmutable.
- `V`: `id uuid PK`, `logical_id text NOT NULL`, `version text NOT NULL`, `status text NOT NULL DEFAULT 'DRAFT'`, `source_reference text NOT NULL`, `content_digest bytea NOT NULL`, `created_at timestamptz NOT NULL`, `UNIQUE(logical_id, version)`; retirada por status, nunca hard-delete si está referenciada.

Los dominios evolutivos son `text` con FK compuesta a `ruleset_domain_values(domain_name, value, ruleset_version_id)`, no PostgreSQL ENUM. Los checks locales numéricos/estructurales siguen siendo checks físicos. Todos los nombres `*_version_id` son FKs a tablas de versión, no strings sueltos.

### 2.2 Políticas abreviadas usadas por tabla

| Código | Mutabilidad/retención | Visibilidad y autoridad |
|---|---|---|
| `REF` | versionada; insert/retire; no rewrite histórico | pública salvo source metadata operativa; application service owner |
| `CUR` | mutable sólo por command transaction y CAS | proyección server-side por actor; nunca cliente-directo |
| `SEC` | mutable por application/authz boundary | owner/F1/system según fila; secretos nunca a logs generales |
| `APP` | append-only; corrección compensatoria | proyección redactada; raw sólo autoridad autorizada |
| `OPS` | operativa, no regla; retention según política aprobada | server/operations only |

En todas las tablas game-scoped, `game_id` participa en los índices de acceso y las FKs compuestas críticas impiden referencias cross-game. `owner` significa actor que controla el dato; `viewer` se resuelve server-side mediante Information Security Matrix, nunca mediante claims del cliente.

## 3. Catálogo físico completo — 87 tablas

Cada fila documenta columnas propias además de `M`, `A` o `V`; nulabilidad se marca `?`, defaults con `=`, y JSON siempre incluye su schema/version. `FKg` significa FK compuesta que conserva `game_id`.

### 3.1 Meta, versiones y reference data (1–16)

| # | Tabla física → lógica | Columnas físicas | PK/FK/UK/checks e índices | Política, transacción, JSON y versión |
|---:|---|---|---|---|
| 1 | `schema_migrations` → extensión | `version text PK`; `name text`; `checksum bytea`; `applied_at timestamptz`; `application_build text`; `restore_drill_ref text?` | UK checksum; IDX applied_at; checksum no vacío | `APP/OPS`; forward-only; no down destructivo; fuera de command tx |
| 2 | `registry_seed_runs` → extensión | `A`; `registry_version_id uuid`; `snapshot_jcs_sha256 bytea`; `snapshot_git_blob_sha1 bytea`; `row_count integer`; `status text`; `migration_version text` | FK registry version/migration; UK registry_version_id; CK row_count>=0; IDX status | `APP/OPS`; seed futuro sólo con registry aprobado; rollback por deploy+restore |
| 3 | `ruleset_versions` → extensión/version pin | `V`; `compatibility_parent_id uuid?`; `activated_at timestamptz?` | FK self; UK(logical_id,version); IDX status | `REF`; pin inmutable por Game; no JSON |
| 4 | `engine_contract_versions` → extensión/version pin | `V`; `compatibility_parent_id uuid?`; `activated_at timestamptz?` | FK self; UK(logical_id,version); IDX status | `REF`; compatibilidad explícita, nunca coerción silenciosa |
| 5 | `card_registry_versions` → extensión/version pin | `V`; `jcs_sha256 bytea`; `snapshot_blob_sha1 bytea`; `approved_decision_id text?`; `activated_at timestamptz?` | UK version/JCS hash; CK ACTIVE exige decision+hash; IDX status | `REF`; el candidate v0.1 no satisface ACTIVE/seedable |
| 6 | `ruleset_domain_values` → lookup versionado | `id uuid PK`; `domain_name text`; `value text`; `ruleset_version_id uuid`; `display_order integer`; `status text='ACTIVE'`; `source_reference text` | UK(domain,value,ruleset); FK ruleset; CK display_order>=0; IDX ruleset/domain/status | `REF`; UUIDv7 física y clave lógica compuesta; reemplaza enums evolutivos; valores históricos no se borran |
| 7 | `json_schema_versions` → extensión | `id uuid PK`; `schema_id text`; `schema_version text`; `schema_json jsonb`; `jcs_sha256 bytea`; `compatibility_mode text`; `status text='DRAFT'`; `source_reference text` | UK(schema_id,version); CK JSON object y hash no vacío; IDX status | `REF`; UUIDv7 física, schema ID/version lógicos; se autocanoniza; no código/prompt |
| 8 | `country_definitions` → CountryDefinition | `V`; `canonical_name text`; `regime_type text`; `mascot text`; `color_key text`; `visual_asset_key text?`; `starting_resource_default integer`; `turn_income_default integer`; `regime_ability_definition_id uuid` | UK(canonical_name,version), UK(color_key,version); FK ability diferible; CK recursos/ingreso>=0; IDX status/version | `REF`; `id uuid` físico separado de `logical_id` (`ARDEN`…`DINESIA`) |
| 9 | `regime_ability_definitions` → RegimeAbilityDefinition | `M`; `logical_id text`; `country_definition_id uuid`; `ruleset_version_id uuid`; `name text`; `ap_cost integer`; `once_per_turn boolean=true`; `effect_definition_id uuid`; `status text`; `source_reference text` | UK(logical_id,ruleset); FK country/ruleset/effect; CK ap_cost>=0; IDX country/version | `REF`; UUID PK separada de logical_id estable |
| 10 | `card_definitions` → CardDefinition | `M`; `logical_id text`; `registry_version_id uuid`; `canonical_name text`; `category text`; `intent_alignment text`; `is_starter boolean=false`; `is_action boolean=false`; `is_reaction boolean=false`; `remove_after_use boolean=false`; `description text?`; `effect_text text?`; `status text`; `source_reference text` | UK(logical_id,registry), UK(canonical_name,registry); FK registry/domain values; CK starter/category y reaction/action; IDX registry/status/category | `REF`; 100 logical definitions sólo tras approval; printed text no ejecuta lógica |
| 11 | `country_card_serial_templates` → extensión requerida 108/100 | `M`; `template_id text`; `registry_version_id uuid`; `serial_within_country_set smallint`; `card_definition_id uuid`; `starter boolean` | UK(template_id,registry), UK(registry,serial); FK definition+registry; CK serial 1..108; IDX definition | `REF`; materializa 108 por país sin convertir serial en definition ID |
| 12 | `card_slot_values` → CardSlotValue | `card_definition_id uuid`; `slot_type text`; `influence_value smallint`; `registry_version_id uuid` | PK(definition,slot,registry); FKs; CK IV 1..6; IDX registry/slot | `REF`; normalizado, no JSON |
| 13 | `card_requirements` → CardRequirement | `M`; `card_definition_id uuid`; `requirement_type text`; `parameters_json jsonb`; `parameters_schema_id text`; `parameters_schema_version text`; `order_index integer` | UK(definition,order,registry vía FK); FK definition/schema; CK order>=0, JSON object; IDX definition | `REF`; JSON permitido, declarativo y validado; no código |
| 14 | `card_effect_definitions` → CardEffectDefinition | `M`; `logical_effect_id text`; `card_definition_id uuid?`; `ruleset_version_id uuid`; `registry_version_id uuid?`; `effect_type text`; `timing_window text`; `operations_json jsonb`; `operations_schema_id text`; `operations_schema_version text`; `order_index integer`; `effect_version text`; `status text` | UK(logical_effect_id,effect_version); UK(card_definition_id,order_index,effect_version); FK versions/schema/domains; CK order>=0; IDX card/effect/status | `REF`; typed DSL data only; unknown effect fails closed; no generic silent handler |
| 15 | `card_aliases` → CardAlias | `M`; `registry_version_id uuid`; `alias_normalized text`; `alias_display text`; `card_definition_id uuid`; `locale text?`; `source_reference text` | UK(registry,alias_normalized,locale); FK definition+registry; IDX definition | `REF`; aliases never crean identidad ni lógica |
| 16 | `demographic_token_definitions` → DemographicTokenDefinition | `M`; `logical_id text`; `ruleset_version_id uuid`; `category text`; `canonical_value text`; `display_label text`; `visual_asset_key text?`; `status text` | UK(logical_id,ruleset), UK(category,value,ruleset); FKs domain/ruleset; IDX status/category | `REF`; ID lógico independiente del label |

### 3.2 ERT y scenario (17–25)

| # | Tabla física → lógica | Columnas físicas | PK/FK/UK/checks e índices | Política, transacción, JSON y versión |
|---:|---|---|---|---|
| 17 | `ert_definitions` → ERTDefinition | `M`; `logical_id text`; `name text`; `ruleset_version_id uuid`; `status text` | UK(logical_id,ruleset); FK ruleset; IDX status | `REF`; ERT exacta versionada, no fórmula |
| 18 | `ert_cells` → ERTCell | `ert_definition_id uuid`; `tier text`; `die_value smallint`; `malign_result integer`; `resiliency_result integer` | PK(ert,tier,die); FK ert/domain; CK die 1..10; IDX ert/tier | `REF`; datos exactos; no JSON |
| 19 | `scenario_definitions` → ScenarioDefinition | `M`; `logical_id text`; `canonical_name text`; `scenario_version text`; `narrative text`; `default_turn_limit integer?`; `allows_instant_victory boolean=false`; `ruleset_version_id uuid`; `card_registry_version_id uuid`; `status text`; `source_reference text` | UK(logical_id,scenario_version), UK(name,scenario_version); FK pins; CK turn_limit>0; IDX status | `REF`; scenario historical pinned |
| 20 | `scenario_country_configs` → ScenarioCountryConfig (omitida del viejo 61, presente en DD) | `M`; `scenario_definition_id uuid`; `country_definition_id uuid`; `starting_resources integer`; `turn_income integer`; `enabled boolean=true` | UK(scenario,country); FKs; CK values>=0; IDX scenario/enabled | `REF`; justifica +1 en reconciliación |
| 21 | `scenario_pd_definitions` → ScenarioPDDefinition | `M`; `scenario_definition_id uuid`; `logical_pd_id text`; `host_country_definition_id uuid`; `local_index smallint`; `gamebook_label text?`; `board_label text?`; `population_size text`; `visual_anchor_key text?` | UK(scenario,logical_pd_id), UK(scenario,country,local_index); FKs; CK local_index>0; IDX host | `REF`; logical PD ID separado de etiquetas impresas |
| 22 | `scenario_pd_demographics` → ScenarioPDDemographic | `scenario_pd_definition_id uuid`; `demographic_token_definition_id uuid` | PK ambos; FKs; IDX token | `REF`; normalizado |
| 23 | `scenario_initial_influences` → ScenarioInitialInfluence | `M`; `scenario_pd_definition_id uuid`; `influence_type text`; `attribution_country_definition_id uuid`; `count integer`; `source_reference text` | FKs; CK count>0; IDX PD/type | `REF`; normalizado |
| 24 | `scenario_rule_configs` → ScenarioRuleConfig | `M`; `scenario_definition_id uuid`; `key text`; `value_json jsonb`; `value_schema_id text`; `value_schema_version text`; `rule_version text` | UK(scenario,key,rule_version); FK schema; CK JSON validado; IDX scenario | `REF`; sólo configuración autorizada/versionada |
| 25 | `victory_objective_definitions` → VictoryObjectiveDefinition | `M`; `scenario_definition_id uuid`; `logical_id text`; `country_definition_id uuid`; `tier text`; `title text`; `description text`; `points_mode text`; `points_value integer`; `evaluator_type text`; `evaluator_parameters_json jsonb`; `evaluator_schema_id text`; `evaluator_schema_version text`; `requires_facilitator_tag boolean`; `instant_victory boolean`; `display_order integer` | UK(scenario,logical_id); FKs domains/schema; CK display_order>=0; IDX scenario/country/tier | `REF/SEC`; objective definition visible sólo owner+F1 durante juego; evaluator declarativo |

### 3.3 Sesión, Game, turno e iniciativa (26–36)

| # | Tabla física → lógica | Columnas físicas | PK/FK/UK/checks e índices | Política, transacción, JSON y versión |
|---:|---|---|---|---|
| 26 | `game_sessions` → GameSession extension | `M`; `game_id uuid`; `state text`; `opened_at timestamptz`; `closed_at timestamptz?` | UK(game_id); FK game diferible; IDX state | `SEC`; application authority, no segunda autoridad de reglas |
| 27 | `game_memberships` → GameSessionMembership extension | `M`; `game_session_id uuid`; `participant_id uuid`; `authenticated_session_digest bytea`; `connected boolean=false`; `last_verified_at timestamptz`; `disconnected_at timestamptz?` | UK(session,participant), UK(session,session_digest); FKs; digest no vacío; IDX participant/connected | `SEC`; no token/secret raw; application construye ActorContext |
| 28 | `games` → Game aggregate root | `M`; `name text`; `status text`; `ruleset_version_id uuid`; `scenario_definition_id uuid`; `card_registry_version_id uuid`; `engine_contract_version_id uuid`; `ert_definition_id uuid`; `facilitator_participant_id uuid?`; `turn_limit integer?`; `dice_mode text`; `beginner_narrative_leniency boolean=false`; `viral_variant text`; `game_version bigint=0`; `event_sequence_head bigint=0`; `outbox_sequence_head bigint=0`; `started_at timestamptz?`; `ended_at timestamptz?` | FKs pins/domains; CK versions/counters>=0, ACTIVE requires pins+turn limit; IDX status/created_at | `CUR`; fila única de lock + CAS; pins inmutables después ACTIVE |
| 29 | `game_participants` → GameParticipant | `M`; `game_id uuid`; `external_user_ref text`; `role text`; `status text`; `joined_at timestamptz`; `left_at timestamptz?` | UK(game,external_user_ref); FKg; IDX game/role/status | `SEC`; actor authority deriva server-side; external ref no es credencial |
| 30 | `player_seats` → PlayerSeat | `M`; `game_id uuid`; `participant_id uuid`; `seat_index smallint`; `clockwise_index smallint`; `country_definition_id uuid` | UK(game,participant/country/clockwise); FKg; CK indices>=0; IDX game/clockwise | `CUR`; público; sólo setup command/F1 |
| 31 | `game_countries` → GameCountry | `M`; `game_id uuid`; `country_definition_id uuid`; `controlling_participant_id uuid`; `current_vp_cache integer=0`; `current_resources_cache integer=0`; `legitimacy_count_cache integer=0` | UK(game,country); FKg; CK caches>=0; IDX controller | `CUR`; caches reconciliables con ledgers/board en misma command tx |
| 32 | `turns` → Turn | `M`; `game_id uuid`; `number integer`; `status text`; `started_at timestamptz?`; `ended_at timestamptz?` | UK(game,number); FKg; CK number>0; IDX game/status | `CUR`; versionado por Game CAS |
| 33 | `phase_states` → PhaseState | `M`; `game_id uuid`; `turn_id uuid`; `phase_type text`; `status text`; `opened_at timestamptz?`; `locked_at timestamptz?`; `resolved_at timestamptz?` | UK(turn,phase_type); FKg; IDX game/turn/status | `CUR`; transiciones sólo scheduler/commands |
| 34 | `player_phase_readiness` → PlayerPhaseReadiness | `phase_state_id uuid`; `game_id uuid`; `participant_id uuid`; `status text`; `locked_at timestamptz?`; `row_version bigint=1` | PK(phase,participant); FKg; IDX game/status | `CUR/SEC`; payload de plan no vive aquí |
| 35 | `initiative_rolls` → InitiativeRoll | `A`; `game_id uuid`; `turn_id uuid`; `participant_id uuid`; `attempt_number integer`; `die_roll_id uuid`; `is_tiebreak boolean=false` | UK(turn,participant,attempt); FKg; CK attempt>0; IDX game/turn | `APP`; RNG auditado |
| 36 | `initiative_entries` → InitiativeEntry | `game_id uuid`; `turn_id uuid`; `participant_id uuid`; `initiative_position smallint`; `winning_roll smallint`; `row_version bigint=1` | PK(turn,participant); UK(turn,position); FKg; CK position>0; IDX game/turn/position | `CUR`; resultado público |

### 3.4 Economía, cartas, campañas y board (37–49)

| # | Tabla física → lógica | Columnas físicas | PK/FK/UK/checks e índices | Política, transacción, JSON y versión |
|---:|---|---|---|---|
| 37 | `action_point_balances` → ActionPointBalance (proyección actual) | `M`; `game_id uuid`; `turn_id uuid`; `participant_id uuid`; `allocated integer`; `spent integer`; `remaining integer`; `last_transaction_sequence bigint=0` | UK(turn,participant); FKg; CK all>=0, allocated=spent+remaining y sequence>=0; IDX game/participant/turn | `CUR`; cache mutable sólo en command tx; debe reconciliar exactamente con #38 y nunca sustituye su journal |
| 38 | `action_point_transactions` → ActionPointTransaction (journal autoritativo) | `A`; `game_id uuid`; `game_event_sequence bigint`; `artifact_ordinal smallint`; `turn_id uuid`; `participant_id uuid`; `sequence_number bigint`; `delta integer`; `reason_type text`; `source_entity_type text?`; `source_entity_id uuid?`; `correlation_id uuid`; `adjudication_trace_id uuid`; `balance_after integer` | UK(game,turn,participant,sequence); UK(game,event_sequence,artifact_ordinal); FKg; CK sequences/ordinal>0, delta!=0, balance_after>=0 y source type/id ambos NULL o ambos presentes; IDX game/participant/turn/sequence, game/event/ordinal, source, correlation, trace | `APP`; journal AP autoritativo de deltas; #37 se actualiza y reconcilia en la misma tx; orden causal total por event/ordinal; ajustes sólo compensatorios, nunca rewrite |
| 39 | `resource_transactions` → ResourceTransaction | `A`; `game_id uuid`; `game_event_sequence bigint`; `artifact_ordinal smallint`; `turn_id uuid?`; `participant_id uuid`; `delta integer`; `reason_type text`; `source_entity_type text?`; `source_entity_id uuid?`; `counterparty_participant_id uuid?`; `adjudication_trace_id uuid?`; `balance_after integer` | UK(game,event_sequence,artifact_ordinal); FKg; CK event_sequence/ordinal>0, balance_after>=0; IDX game/event/ordinal, game/participant/event/ordinal, source | `APP`; ledger autoritativo; orden total no depende de `created_at`; corrección compensatoria |
| 40 | `card_instances` → CardInstance | `M`; `game_id uuid`; `country_owner_definition_id uuid`; `serial_template_id uuid`; `card_definition_id uuid`; `current_controller_participant_id uuid`; `zone text`; `face_state text`; `removed_from_game boolean=false`; `return_to_owner_on_discard boolean=false` | UK(game,country,serial_template); FKg; FK country/template/definition; IDX game/controller/zone, definition | `CUR/SEC`; single-zone; mano owner+F1; deck order SYSTEM_ONLY |
| 41 | `deck_card_positions` → DeckCardPosition | `M`; `game_id uuid`; `participant_id uuid`; `card_instance_id uuid`; `position integer`; `shuffle_revision bigint` | UK(game,participant,revision,position), UK(card,revision); FKg; CK position/revision>0; IDX game/participant/revision | `CUR/SEC`; reemplazo denso atómico; future order SYSTEM_ONLY |
| 42 | `campaigns` → Campaign | `M`; `game_id uuid`; `owner_participant_id uuid`; `created_turn_id uuid`; `row text`; `state text`; `intent_alignment text`; `target_dt_id uuid?`; `last_activated_turn_id uuid?`; `activation_count_current_turn_cache integer=0` | FKg; CK count>=0; IDX game/owner/state/row | `CUR/SEC`; face-down owner+F1 hasta reveal |
| 43 | `campaign_card_assignments` → CampaignCardAssignment | `M`; `game_id uuid`; `campaign_id uuid`; `slot_type text`; `card_instance_id uuid`; `assigned_turn_id uuid`; `removed_turn_id uuid?` | partial UK(campaign,slot) active; partial UK(card) active; FKg; IDX game/campaign | `CUR/SEC`; slot/card zone se actualizan en misma tx |
| 44 | `population_demographic_states` → PopulationDemographicState | `M`; `game_id uuid`; `scenario_pd_definition_id uuid`; `host_country_definition_id uuid`; `current_legitimacy_participant_id uuid?` | UK(game,scenario_pd); FKg; IDX game/host | `CUR`; board público autorizado |
| 45 | `influence_stacks` → InfluenceStack | `M`; `game_id uuid`; `pd_state_id uuid`; `influence_type text`; `attribution_country_definition_id uuid`; `count integer=0` | UK(pd,type,country); FKg; CK count>=0; IDX game/pd/type | `CUR`; estado normalizado; cero puede retirarse sólo preservando mutation log |
| 46 | `influence_mutations` → InfluenceMutation | `A`; `game_id uuid`; `game_event_sequence bigint`; `artifact_ordinal smallint`; `turn_id uuid?`; `adjudication_trace_id uuid?`; `pd_state_id uuid`; `influence_type text`; `attribution_country_definition_id uuid`; `delta integer`; `mutation_reason text`; `source_entity_type text?`; `source_entity_id uuid?`; `resulting_count integer` | UK(game,event_sequence,artifact_ordinal); FKg; CK event_sequence/ordinal>0, resulting_count>=0; IDX game/event/ordinal, game/pd/event/ordinal, trace | `APP`; historia íntegra y orden total determinístico durante M2 |
| 47 | `legitimacy_events` → LegitimacyEvent | `A`; `game_id uuid`; `game_event_sequence bigint`; `artifact_ordinal smallint`; `turn_id uuid?`; `pd_state_id uuid`; `previous_participant_id uuid?`; `new_participant_id uuid?`; `reason_type text`; `adjudication_trace_id uuid?` | UK(game,event_sequence,artifact_ordinal); FKg; CK event_sequence/ordinal>0 y previous/new no ambos iguales salvo audit reason; IDX game/event/ordinal, game/pd/event/ordinal | `APP`; estado actual se cambia atómicamente con evento y conserva orden total |
| 48 | `planned_actions` → PlannedAction | `M`; `game_id uuid`; `turn_id uuid`; `participant_id uuid`; `sequence_within_player smallint`; `action_type text`; `ap_cost integer`; `state text`; `target_entity_type text?`; `target_entity_id uuid?`; `card_instance_id uuid?`; `campaign_id uuid?`; `parameters_json jsonb?`; `parameters_schema_id text?`; `parameters_schema_version text?`; `locked_at timestamptz?` | UK(turn,participant,sequence); FKg/schema; CK sequence 1..3, cost>=0, JSON/schema paired; IDX game/turn/participant/state | `CUR/SEC`; owner+F1 antes de reveal; max 3 y AP lock atomically |
| 49 | `action_resolutions` → ActionResolution | `M`; `game_id uuid`; `planned_action_id uuid`; `initiative_position smallint`; `resolution_status text`; `adjudication_trace_id uuid?`; `started_at timestamptz`; `ended_at timestamptz?` | UK(planned_action); FKg; CK position>0; IDX game/status | `CUR`; scheduler/system authority |

### 3.5 Continuations, reactions y adjudicación (50–68)

| # | Tabla física → lógica | Columnas físicas | PK/FK/UK/checks e índices | Política, transacción, JSON y versión |
|---:|---|---|---|---|
| 50 | `pending_resolutions` → PendingResolution + persisted continuation | `M`; `game_id uuid`; `source_resolution_id uuid`; `continuation_type text`; `continuation_state_json jsonb`; `continuation_schema_id text`; `continuation_schema_version text`; `waiting_interaction_type text`; `waiting_interaction_id uuid`; `status text`; `ruleset_version_id uuid`; `engine_contract_version_id uuid`; `state_hash bytea` | one OPEN partial UK(game,source_resolution); FKg/schema/pins; CK JSON object; IDX game/status/waiting | `CUR/SEC`; discriminated/runtime-validated; no closure viva; atomic suspend/resume |
| 51 | `choice_requests` → ChoiceRequest | `M`; `game_id uuid`; `choice_version bigint`; `choice_type text`; `actor_participant_id uuid`; `source_resolution_id uuid`; `source_event_id uuid?`; `visibility_scope text`; `status text`; `selection_mode text`; `min_selections integer`; `max_selections integer`; `options_json jsonb`; `options_schema_id text`; `options_schema_version text`; `constraints_json jsonb?`; `constraints_schema_id text?`; `constraints_schema_version text?`; `selected_option_ids_json jsonb?`; `resolved_by_participant_id uuid?`; `resolved_at timestamptz?`; `expires_at timestamptz?=NULL` | FKg/schema; CK min/max and JSON arrays, schema paired, expires null baseline; IDX game/actor/status | `CUR/SEC`; options sólo actor+F1; response queda en la misma fila y event/trace append-only |
| 52 | `reaction_windows` → ReactionWindow | `M`; `game_id uuid`; `turn_id uuid`; `window_type text`; `triggering_entity_type text`; `triggering_entity_id uuid`; `triggering_participant_id uuid`; `parent_window_id uuid?`; `current_priority_index integer`; `state text`; `opened_at timestamptz`; `closed_at timestamptz?`; `expires_at timestamptz?=NULL` | FKg/self; CK priority>=0, expires null baseline; IDX game/state/opened | `CUR/SEC`; existencia proyectada sin filtrar posesión |
| 53 | `reaction_eligibilities` → ReactionEligibility | `reaction_window_id uuid`; `game_id uuid`; `participant_id uuid`; `priority_order smallint`; `passed boolean=false`; `row_version bigint=1` | PK(window,participant); UK(window,priority); FKg; CK priority>0; IDX game/window | `CUR/SEC`; no lista de cartas elegibles autoritativa |
| 54 | `reaction_plays` → ReactionPlay | `A`; `game_id uuid`; `reaction_window_id uuid`; `participant_id uuid`; `card_instance_id uuid`; `priority_order smallint`; `resolution_status text`; `adjudication_trace_id uuid` | FKg; CK priority>0; IDX game/window/created | `APP/SEC`; card identity redacted según viewer |
| 55 | `campaign_activations` → CampaignActivation | `A`; `game_id uuid`; `turn_id uuid`; `participant_id uuid`; `campaign_id uuid`; `planned_action_id uuid?`; `activation_ordinal integer`; `activation_source text`; `target_pd_state_id uuid`; `target_dt_id uuid`; `base_cv integer`; `effective_cv integer`; `cost_tier text`; `resolution_tier text`; `tier_resource_cost integer`; `card_resource_cost integer`; `total_resource_cost integer`; `legitimacy_roll_bonus integer`; `roll_boost_spent boolean`; `die_roll_id uuid?`; `modified_roll_raw integer?`; `ert_lookup_roll smallint?`; `ert_result integer?`; `outcome_type text`; `adjudication_trace_id uuid` | UK(campaign,turn,ordinal); FKg; CK costs>=0, lookup 1..10, total=sum; IDX game/turn/participant | `APP`; conserva base/effective CV y roll raw; artifacts misma tx |
| 56 | `narrative_requests` → NarrativeRequest extension | `M`; `game_id uuid`; `campaign_activation_id uuid`; `actor_participant_id uuid`; `status text`; `visibility_scope text`; `request_schema_id text`; `request_schema_version text`; `opened_at timestamptz`; `resolved_at timestamptz?`; `expires_at timestamptz?=NULL` | one OPEN UK(activation); FKg/schema; IDX game/actor/status | `CUR/SEC`; sólo actor+F1; no texto inventado, no timeout |
| 57 | `narrative_submissions` → NarrativeSubmission | `A`; `game_id uuid`; `campaign_activation_id uuid`; `participant_id uuid`; `text text`; `sentence_count integer`; `objective_tag_fluma_independence boolean`; `submitted_at timestamptz` | UK activation; FKg; CK sentence_count>=0; IDX game/participant | `APP/SEC`; texto sensible fuera de logs generales |
| 58 | `narrative_reviews` → NarrativeReview | `M`; `game_id uuid`; `narrative_submission_id uuid`; `exceeds_length_rule boolean`; `suspected_card_text_reading boolean`; `facilitator_confirmed_reading_violation boolean`; `facilitator_plausibility_status text`; `notes text?`; `reviewed_by_participant_id uuid?`; `reviewed_at timestamptz?` | UK submission; FKg; IDX game/reviewed_at | `CUR/SEC`; juicio humano, no IA autoritativa |
| 59 | `veto_cases` → VetoCase | `M`; `game_id uuid`; `turn_id uuid`; `narrative_submission_id uuid`; `veto_card_instance_id uuid`; `initiator_participant_id uuid`; `rationale text`; `defender_response text?`; `state text`; `result text?`; `resolved_at timestamptz?` | UK narrative_submission active; FKg; IDX game/state | `CUR/SEC`; voto/resultado público autorizado, manos no |
| 60 | `veto_votes` → VetoVote | `A`; `game_id uuid`; `veto_case_id uuid`; `participant_id uuid`; `vote text`; `cast_at timestamptz` | UK(veto,participant); FKg; IDX game/veto | `APP`; no update; corrección F1 separada y auditada |
| 61 | `die_rolls` → DieRoll | `A`; `game_id uuid`; `turn_id uuid?`; `participant_id uuid?`; `die_type text`; `mode text`; `raw_value integer`; `source_type text`; `source_entity_id uuid`; `rng_metadata_json jsonb?`; `rng_schema_id text?`; `rng_schema_version text?`; `entered_by_participant_id uuid?` | FKg/schema; CK D10 raw 1..10, JSON/schema paired; IDX game/source | `APP`; raw RNG/manual preserved; no reroll during replay |
| 62 | `modifier_applications` → ModifierApplication | `A`; `game_id uuid`; `adjudication_trace_id uuid`; `modifier_type text`; `source_entity_type text`; `source_entity_id uuid`; `value integer`; `applied_to text`; `stacking_key text` | FKg; UK(trace,stacking_key) cuando no stack; IDX game/trace | `APP`; orden por trace/event sequence, no timestamp |
| 63 | `influence_resolutions` → InfluenceResolution | `A`; `game_id uuid`; `adjudication_trace_id uuid`; `pd_state_id uuid`; `incoming_type text`; `incoming_attribution_country_definition_id uuid`; `generated_count integer`; `consumed_in_cancellation integer`; `opposite_removed_count integer`; `placed_count integer` | FKg; CK generated=consumed+placed y consumed=2*removed; IDX game/trace | `APP`; prueba exacta 2:1 |
| 64 | `viralization_resolutions` → ViralizationResolution | `A`; `game_id uuid`; `turn_id uuid`; `origin_pd_state_id uuid`; `legitimacy_owner_participant_id uuid`; `influence_type text`; `origin_count integer`; `threshold integer`; `target_pd_state_id uuid?`; `shares_dt boolean`; `spread_check_die_roll_id uuid?`; `spread_succeeded boolean`; `quantity_die_roll_id uuid?`; `cubes_generated integer`; `adjudication_trace_id uuid` | FKg; CK counts>=0; IDX game/turn/origin | `APP`; M2-6 no autorizado |
| 65 | `regime_ability_activations` → RegimeAbilityActivation | `A`; `game_id uuid`; `turn_id uuid`; `participant_id uuid`; `ability_definition_id uuid`; `planned_action_id uuid`; `die_roll_id uuid?`; `target_pd_state_id uuid?`; `adjudication_trace_id uuid` | UK(turn,participant,ability); FKg; IDX game/turn | `APP`; M2-4 no autorizado |
| 66 | `adjudication_traces` → AdjudicationTrace | `A`; `game_id uuid`; `game_event_sequence bigint`; `artifact_ordinal smallint`; `turn_id uuid?`; `phase_state_id uuid?`; `participant_id uuid?`; `trace_type text`; `source_action_id uuid?`; `source_card_instance_id uuid?`; `source_campaign_id uuid?`; `target_pd_state_id uuid?`; `pre_state_hash bytea`; `post_state_hash bytea`; `input_snapshot_json jsonb`; `rule_evaluation_json jsonb`; `output_snapshot_json jsonb`; `trace_schema_id text`; `trace_schema_version text`; `facilitator_intervention_id uuid?`; `correlation_id uuid`; `causation_id uuid?` | UK(game,event_sequence,artifact_ordinal); FKg/schema; CK event_sequence/ordinal>0, hashes no vacíos/JSON objects; IDX game/event/ordinal, sources, correlation | `APP/SEC`; raw F1 y proyecciones redactadas; historia íntegra y orden causal total |
| 67 | `vp_transactions` → VPTransaction | `A`; `game_id uuid`; `game_event_sequence bigint`; `artifact_ordinal smallint`; `turn_id uuid?`; `participant_id uuid`; `delta integer`; `balance_after integer`; `reason_type text`; `source_entity_type text`; `source_entity_id uuid`; `adjudication_trace_id uuid?` | UK(game,event_sequence,artifact_ordinal); FKg; CK event_sequence/ordinal>0, balance_after>=0; IDX game/event/ordinal, game/participant/event/ordinal | `APP`; ledger autoritativo, floor cero y orden total determinístico |
| 68 | `victory_objective_progress` → VictoryObjectiveProgress | `M`; `game_id uuid`; `objective_definition_id uuid`; `participant_id uuid`; `current_status_json jsonb`; `status_schema_id text`; `status_schema_version text`; `currently_qualifies boolean`; `calculated_at timestamptz`; `evaluator_version text` | UK(game,objective,participant); FKg/schema; IDX game/participant | `CUR/SEC`; owner+F1; derivado/recalculable pero persistido para audit |

### 3.6 Outcome, colaboración, audit y delivery (69–87)

| # | Tabla física → lógica | Columnas físicas | PK/FK/UK/checks e índices | Política, transacción, JSON y versión |
|---:|---|---|---|---|
| 69 | `victory_objective_awards` → VictoryObjectiveAward | `A`; `game_id uuid`; `objective_definition_id uuid`; `participant_id uuid`; `vp_awarded integer`; `evaluation_snapshot_json jsonb`; `snapshot_schema_id text`; `snapshot_schema_version text`; `awarded_at timestamptz` | UK(game,objective,participant); FKg/schema; CK vp>=0; IDX game/participant | `APP/SEC`; M2-7 no autorizado |
| 70 | `game_outcomes` → GameOutcome | `game_id uuid PK`; `completed_turn integer`; `shared_tie boolean`; `tiebreak_stage text`; `final_scores_json jsonb`; `scores_schema_id text`; `scores_schema_version text`; `completed_at timestamptz`; `row_version bigint=1` | FKg/schema; CK turn>0; IDX completed_at | `CUR` terminal; no delete; winners normalizados en #71 |
| 71 | `game_outcome_winners` → GameOutcomeWinner normalizada | `game_id uuid`; `participant_id uuid`; `rank integer` | PK(game,participant); UK(game,rank) salvo shared tie; FKg; CK rank>0; IDX game/rank | `APP`; relación explícita del Data Dictionary |
| 72 | `deal_promises` → DealPromise | `M`; `game_id uuid`; `turn_id uuid?`; `proposer_participant_id uuid`; `terms_text text`; `visibility_scope text`; `state text`; `expires_at timestamptz?` | FKg; IDX game/state/created | `CUR/SEC`; no modifica Game State; texto sensible |
| 73 | `deal_participants` → DealParticipant normalizada | `deal_promise_id uuid`; `game_id uuid`; `participant_id uuid`; `role text` | PK(deal,participant); FKg; IDX game/participant | `CUR/SEC`; relación explícita del Data Dictionary |
| 74 | `transfer_transactions` → TransferTransaction | `M`; `game_id uuid`; `turn_id uuid`; `transfer_type text`; `from_participant_id uuid`; `to_participant_id uuid`; `card_instance_id uuid?`; `resource_amount integer?`; `state text`; `confirmed_by_from boolean=false`; `confirmed_by_to boolean=false`; `executed_at timestamptz?` | FKg; CK CARD xor RESOURCE y amount>0; IDX game/state | `CUR`; execute junto a card/ledger/event en una tx |
| 75 | `temporary_reveals` → TemporaryReveal | `M`; `game_id uuid`; `source_effect_definition_id uuid`; `viewer_participant_id uuid`; `target_participant_id uuid`; `scope text`; `opened_at timestamptz`; `expires_at_event_id uuid?`; `closed_at timestamptz?` | FKg; FK effect; IDX game/viewer/closed | `SEC`; acceso temporal, fail closed después de cierre |
| 76 | `temporary_reveal_cards` → TemporaryRevealCard normalizada | `temporary_reveal_id uuid`; `game_id uuid`; `card_instance_id uuid` | PK(reveal,card); FKg; IDX game/card | `SEC`; no array JSON de identidades secretas |
| 77 | `visibility_grants` → VisibilityGrant | `M`; `game_id uuid`; `subject_type text`; `subject_id uuid`; `viewer_type text`; `viewer_id uuid?`; `permission text`; `source text`; `expires_at timestamptz?` | FKg; CK viewer_id required by viewer_type; IDX game/viewer/expiry | `SEC`; sólo excepciones, no política base |
| 78 | `facilitator_decisions` → FacilitatorDecision | `A`; `game_id uuid`; `turn_id uuid?`; `participant_id uuid?`; `decision_type text`; `target_entity_type text`; `target_entity_id uuid`; `rationale text`; `before_snapshot_json jsonb?`; `after_snapshot_json jsonb?`; `snapshot_schema_id text?`; `snapshot_schema_version text?`; `created_by_participant_id uuid` | FKg/schema; CK rationale no vacío, JSON/schema paired; IDX game/turn/created | `APP/SEC`; intervención humana auditada; sin rewrite |
| 79 | `game_events` → GameEvent | `A`; `game_id uuid`; `sequence_number bigint`; `turn_id uuid?`; `phase_state_id uuid?`; `event_type text`; `actor_participant_id uuid?`; `subject_type text?`; `subject_id uuid?`; `payload_json jsonb`; `payload_schema_id text`; `payload_schema_version text`; `visibility_class text`; `caused_by_event_id uuid?`; `adjudication_trace_id uuid?`; `correlation_id uuid`; `causation_id uuid?`; `state_hash_after bytea?` | UK(game,sequence); FKg/schema; CK sequence>0; IDX game/turn/sequence, game/type/sequence, trace/correlation | `APP/SEC`; ordering autoritativo; payload no sustituye estado/ledgers |
| 80 | `game_snapshots` → snapshot/recovery extension | `A`; `game_id uuid`; `game_version bigint`; `last_event_sequence bigint`; `snapshot_json jsonb`; `snapshot_schema_id text`; `snapshot_schema_version text`; `canonical_jcs_sha256 bytea`; `gameplay_state_hash bytea`; `ruleset_version_id uuid`; `scenario_definition_id uuid`; `card_registry_version_id uuid`; `engine_contract_version_id uuid` | UK(game,game_version); FKg/schema/pins; CK versions/sequences>=0; IDX game/version DESC | `APP/SEC`; estable y verificable; no compaction/hard-delete M2 |
| 81 | `idempotency_records` → IdempotencyRepository | `TXS`; `game_id uuid`; `actor_id text`; `idempotency_key text`; `command_id uuid`; `command_fingerprint bytea`; `command_type text`; `status text='INTERNAL_PENDING'`; `game_version_before bigint`; `game_version_after bigint?`; `result_json jsonb?`; `result_schema_id text?`; `result_schema_version text?`; `completed_at timestamptz?` | UK(game,actor,key), UK(game,command_id); FKg/schema; CK versions>=0; COMMITTED exige resultado/schema/version_after/completed_at y INTERNAL_PENDING exige esos campos NULL; IDX game/status | `TXS/SEC`; identidad/key/fingerprint inmutables; resultado, schema, version_after, completed_at y status se fijan una sola vez antes del mismo COMMIT; después `COMMITTED` la fila completa es inmutable |
| 82 | `outbox_messages` → OutboxMessage (mensaje inmutable) | `A`; `game_id uuid`; `outbox_sequence bigint`; `event_id uuid`; `topic text`; `audience_class text`; `audience_id uuid?`; `payload_json jsonb`; `payload_schema_id text`; `payload_schema_version text`; `correlation_id uuid`; `deduplication_key text` | UK(game,outbox_sequence), UK(event,audience_class,audience_id), UK(deduplication_key); FKg/schema; CK sequence>0; IDX game/sequence, topic | `APP/SEC`; payload/envelope inmutable creado con evento y estado en command tx; nunca contiene estado mutable de entrega |
| 83 | `outbox_delivery_states` → OutboxDeliveryState (proyección operativa) | `M`; `outbox_message_id uuid`; `delivery_status text='PENDING'`; `last_attempt_ordinal bigint=0`; `claim_token_digest bytea?`; `claimed_at timestamptz?`; `claim_expires_at timestamptz?`; `acknowledged_at timestamptz?`; `next_attempt_at timestamptz?`; `last_error_code text?` | UK(outbox_message_id); FK message; CK ordinal>=0 y campos coherentes con status; IDX status/next_attempt, claim expiry | `CUR/OPS/SEC`; sólo publisher; estado mutable derivado y reconciliable desde #84; no altera payload ni gameplay |
| 84 | `outbox_delivery_attempts` → OutboxDeliveryAttempt (historial append-only) | `A`; `outbox_message_id uuid`; `attempt_ordinal bigint`; `stage_ordinal smallint`; `event_type text`; `occurred_at timestamptz`; `claim_token_digest bytea?`; `transport_message_id text?`; `result_code text?`; `error_code text?`; `redacted_detail_json jsonb?`; `correlation_id uuid` | UK(message,attempt,stage); FK message; CK attempt>0, stage>0 y event_type permitido; IDX message/attempt/stage, occurred_at, correlation | `APP/OPS/SEC`; eventos `CLAIM`, `SEND_STARTED`, `SEND_RETURNED`, `ACK`, `FAIL`, `LEASE_EXPIRED`, `RETRY_SCHEDULED`; permite reconstruir crash y auditoría at-least-once |
| 85 | `realtime_delivery_cursors` → durable reconnect/subscription cursor | `M`; `game_id uuid`; `participant_id uuid`; `projection_id text`; `game_version bigint`; `last_sequence_number bigint`; `subscription_epoch bigint`; `last_acknowledged_at timestamptz`; `status text` | UK(game,participant,projection_id); FKg; CK counters>=0; IDX game/status | `OPS/SEC`; persiste resume cursor, no socket/presence normativa; runtime/proveedor sigue IQ-M2-009 |
| 86 | `die_requests` → DieRequest del Interface Contract | `M`; `game_id uuid`; `purpose text`; `die_type text`; `requested_for_participant_id uuid?`; `source_mode text`; `status text`; `visibility_scope text`; `modifier_policy_ref text?`; `resolved_die_roll_id uuid?`; `resolved_at timestamptz?`; `expires_at timestamptz?=NULL` | FKg; partial UK(game,purpose,requested_for_participant_id) OPEN; CK expires null baseline y RESOLVED exige die roll; IDX game/status/participant | `CUR/SEC`; pending interaction durable; valor manual nunca vive en campaign payload; misma resume command tx |
| 87 | `facilitator_requests` → FacilitatorRequest del Interface Contract | `M`; `game_id uuid`; `request_type text`; `source_resolution_id uuid?`; `subject_participant_id uuid?`; `safe_context_json jsonb`; `safe_context_schema_id text`; `safe_context_schema_version text`; `full_context_trace_id uuid?`; `status text`; `resolved_by_participant_id uuid?`; `resolved_at timestamptz?`; `expires_at timestamptz?=NULL` | FKg/schema; partial UK(game,request_type,source_resolution_id) OPEN; CK safe JSON object/expires null; IDX game/status/subject | `CUR/SEC`; safe context proyectable, full context sólo F1; decisión final append-only en facilitator_decisions |

## 4. Identidad lógica y física

| Concepto | Identidad lógica estable | Identidad física |
|---|---|---|
| Country | `ARDEN`, `FLUMA`, `URSARIA`, `PRESQUE`, `DINESIA` | `country_definitions.id` UUIDv7 + UK(logical_id, version) |
| Card Definition | futuro `CARD_DEF_BASE_2025_Dnnn` aprobado | `card_definitions.id` UUIDv7 + UK(logical_id, registry) |
| Serial template | futuro `CARD_SERIAL_BASE_2025_Snnn` aprobado | `country_card_serial_templates.id` UUIDv7 + serial 1…108 |
| Card instance | referencia definition + serial + country + game | UUIDv7, UK(game,country,serial template) |
| PD | `logical_pd_id` independiente de etiquetas | UUIDv7 por scenario definition y por game state |
| Effect | `logical_effect_id` + effect version | UUIDv7 row; dispatch sólo por ID/version |
| Game/turn/artifacts | no nombre visible | UUIDv7; sequences monotónicas por Game |

La separación evita elevar `BASE_CARD_001…108` de M1 a 100 definition IDs, evita collisions nominales y permite replay con versiones fijadas.

## 5. Cardinalidades e invariantes cross-table

- Registry ACTIVE: exactamente 108 serial templates, seriales 1…108 únicos y continuos; exactamente 5 Starter y 103 pool; cada template apunta a una definition del mismo registry.
- BASE_2025 game: cinco country IDs; exactamente 540 CardInstance = 5×108, incluidas 25 Starter.
- Active game: cinco PlayerSeat/country únicos; una membership verificada por participante; `games.game_version` y sequences jamás retroceden.
- CardInstance: una zona lógica; campaign assignment/planned action/deck position deben coincidir con zone dentro de la misma transacción.
- Campaign activable: Intent+Method activos, Amplifier opcional, IDs de instancia distintos, compatibilidad por slot y misma game/owner boundary.
- `pending_resolutions`: máximo una OPEN por source resolution; interacción y continuation comparten version pins y state hash.
- Journals de recursos/AP/VP/influence/legitimacy, eventos, traces, dice, votes, outcomes y delivery attempts: append-only; cambios se compensan, no se reescriben.
- `action_point_balances` es sólo la proyección actual: en cada command tx su `remaining` y `last_transaction_sequence` deben coincidir con la suma/secuencia del journal `action_point_transactions`; un rollback no deja transacción ni balance parcial.
- Idempotencia es transaction-sealed: sólo un registro `COMMITTED` es durable/visible; no existe `PENDING` huérfano ni artefacto del perdedor CAS.
- Outbox separa mensaje inmutable (#82), estado operativo mutable (#83) e historial de intentos append-only (#84); un crash de publisher se reconstruye desde el historial sin readjudicar gameplay.
- Ningún JSON es única autoridad de recursos, AP, VP, cartas, campaign slots, influence, legitimacy, initiative, die/vote result o event order.
- Timestamps no ordenan adjudicación; `game_version`, `sequence_number`, `outbox_sequence` y order indexes sí.

## 6. Patrón transaccional por command

```text
BEGIN READ COMMITTED
  1. fast lookup of only durable COMMITTED idempotency:
       same fingerprint => return original result without readjudication
       different fingerprint => typed rejection without mutation
  2. SELECT Game row FOR UPDATE
  3. MANDATORY second idempotency lookup under the Game lock:
       same key + same fingerprint => return original result without checking expected_game_version
       same key + different fingerprint => typed IDEMPOTENCY_KEY_REUSE_CONFLICT
       only confirmed absence may continue
  4. CAS expected_game_version against current game_version
       loser exits before sequence allocation or any artifact
  5. runtime-validate command, JSON schemas and pinned versions
  6. insert INTERNAL_PENDING idempotency reservation (not externally visible)
  7. execute deterministic Engine with explicit RNG/Clock
  8. allocate next Game event sequence and deterministic artifact ordinals under the same lock
  9. persist normalized/current state, including AP balances
 10. append resource/AP/VP/influence/legitimacy/RNG artifacts with event_sequence+ordinal
 11. append AdjudicationTrace and GameEvent with the same causal sequence
 12. persist/close pending interaction and continuation as applicable
 13. optionally append stable GameSnapshot
 14. append immutable OutboxMessage + PENDING OutboxDeliveryState
 15. increment Game.game_version exactly once
 16. transition idempotency to COMMITTED with result before commit
COMMIT
publisher post-commit appends delivery-attempt stages and mutates delivery state;
delivery is at-least-once and consumer-deduplicated; INTERNAL_PENDING never commits
```

El segundo lookup es obligatorio aunque el fast path haya fallado: cierra la carrera entre dos procesos que observaron ausencia. El proceso perdedor de CAS no escribe mutación, journal, idempotency record, evento, trace, RNG, snapshot, outbox message, delivery state/attempt ni consumo/cursor. Cualquier fallo entre pasos revierte todo. `games.event_sequence_head` se incrementa dentro de la transacción bajo el mismo lock y cada ordinal se deriva de una lista estable de artifacts; rollback o CAS loser revierten también el head, por lo que no dejan huecos permanentes. `created_at` es sólo metadata.

Operaciones especialmente atómicas: setup/materialización; draw/shuffle/hand limit; plan lock/AP; transfer; campaign replacement; suspend/resume; reaction/Veto; campaign payment+ERT+2:1+VP/legitimacy; viral; victory settlement; facilitator correction; snapshot checkpoint.

### 6.1 Matriz de operaciones atómicas

| Operación | Filas mínimas en una sola transacción | Lock/check de entrada | Evidencia al commit |
|---|---|---|---|
| Setup/materialización | games, participants/seats/countries, card_instances, deck positions, initial influence, resource/AP journals, events/outbox_messages | Game row + pinned versions + cardinalidades 5×108 | setup events, hashes y game_version +1 |
| Draw/search/shuffle/hand limit | card_instances, deck positions, choice/pending si aplica, events/trace/outbox_messages | Game row + zone/controller + revision | movimientos y RNG/choice sin estado estable >10 |
| Plan lock | planned_actions, action_point_balances, action_point_transactions, readiness, event/outbox_messages | Game row + expected version + max3 + AP | plan secreto locked; balance AP reconcilia exactamente con journal |
| Transfer/deal | transfer, card instance o dos resource journal rows, event/outbox_messages | Game row + doble confirmación + ownership/available balance | provenance/control o balances consistentes |
| Campaign create/modify/discard | campaign, assignments, card zones, event/trace/outbox_messages | Game row + slot/identity/single-zone checks | campaña completa o cero mutación |
| Suspend/resume | action resolution, pending resolution, interaction, event/outbox_messages | Game row + interaction/version/state hash | continuation durable o resolución cerrada |
| Reaction/Veto | windows/eligibilities/plays o case/votes, card zones, trace/event/outbox_messages | Game row + priority/trigger/strict majority | chain causal y resultado auditado |
| Campaign adjudication | activation, resources, die/modifiers, influence/legitimacy/VP, trace/events/outbox_messages | Game row + campaign/version/phase/authority | todos los artifacts o rollback total |
| Cleanup/Viral/End | phase/board/rolls/VP/objectives/outcome, trace/events/outbox_messages | Game row + scheduler cursor + pinned rules | checkpoint y sequence completos |
| Facilitator correction | decision, compensating rows, trace/events/outbox_messages | Game row + F1 binding + rationale | before/after audit; historia original intacta |
| Snapshot | game_snapshot + optional checkpoint event/outbox_messages | Game row + exact game/event versions | JCS/hash verificable y pin completo |
| Idempotency | idempotency_records junto con todas las filas del command | Game row/CAS antes de reservar; UK(game,actor,key) y fingerprint | sólo COMMITTED durable; retry igual devuelve resultado; mismatch rechaza; nunca PENDING huérfano |
| Outbox delivery post-commit | outbox_delivery_attempts + outbox_delivery_states | claim/lease sobre mensaje COMMITTED; deduplication_key | intento completo o etapa durable para reconstrucción; nunca readjudica Game |

### 6.2 Matriz de fault injection y rollback

| Boundary inyectado | Resultado durable exigido |
|---|---|
| Antes/después del CAS, antes de reservar idempotencia | Perdedor/fallo deja cero idempotency, AP, event, outbox o delivery artifacts. |
| Después de `INTERNAL_PENDING` | Rollback elimina la reserva; ningún `PENDING` queda visible o durable. |
| Después de journal AP o balance AP | Rollback revierte ambos; jamás queda delta sin balance ni balance sin delta. |
| Después de estado/event/journal/trace | Rollback revierte el conjunto completo y no incrementa Game version. |
| Después de OutboxMessage/DeliveryState | Rollback elimina ambos junto con el command; no hay mensaje de un estado no committed. |
| Después de finalizar idempotencia, antes de COMMIT | Rollback elimina resultado y todos los artifacts; el retry adjudica una sola vez. |
| Publisher: después de CLAIM, SEND_STARTED, retorno de transporte o antes de ACK | Mensaje/payload committed permanece; se añade la etapa/lease/fallo/retry correspondiente y el estado se reconstruye sin ejecutar gameplay. |
| Dos procesos, misma key y mismo fingerprint, ambos fallan fast lookup | El primero adjudica; el segundo espera el lock, encuentra COMMITTED en el recheck y devuelve exactamente el resultado original sin evaluar `expected_game_version`; una mutación, una versión y una secuencia. |
| Dos procesos, misma key y fingerprints distintos, ambos fallan fast lookup | El primero adjudica; el segundo encuentra la key en el recheck y recibe `IDEMPOTENCY_KEY_REUSE_CONFLICT`; cero artifacts del segundo aunque su expected version fuera válido. |
| Fallo después de reservar event sequence/ordinals y antes de COMMIT | Rollback revierte `event_sequence_head` y todas las filas; el retry reutiliza el siguiente valor durable, sin hueco permanente ni `artifact_ordinal` parcial. |

## 7. Índices, N+1 y consultas

Además de los índices por tabla:

- cargar aggregate por `games.id`, luego relaciones game-scoped con consultas por lotes; nunca una query por card/PD/event;
- hand/deck/campaign: índices `(game_id, controller, zone)`, `(game_id, participant, shuffle_revision, position)`, `(game_id, owner, state, row)`;
- replay/feed: keyset pagination `(game_id, sequence_number)`; no OFFSET;
- AP: `(game_id,participant_id,turn_id,sequence_number)` para journal y UK `(turn_id,participant_id)` para balance reconciliable;
- outbox publisher: índice de `outbox_delivery_states(delivery_status,next_attempt_at)` y join por message ID; orden estable `(game_id,outbox_sequence)` del mensaje inmutable;
- idempotencia: UK `(game_id,actor_id,idempotency_key)` y covering lookup `(game_id,actor_id,idempotency_key,status,command_fingerprint)`; fast path y recheck bajo Game lock consultan sólo `COMMITTED`; fingerprint nunca se actualiza;
- pending dashboard F1: `(game_id,status)` para choice/reaction/narrative/resolution;
- traces/ledgers: `(game_id,game_event_sequence,artifact_ordinal)` es el orden autoritativo; índices alternos por subject conservan esa cola y nunca usan timestamp como desempate;
- toda carga de definitions usa registry/ruleset pinned y batch IDs; no lookup por nombre.

Antes de DDL, M2-1 deberá adjuntar `EXPLAIN`/query-budget fixtures para aggregate load, projection build, replay page, pending dashboard y outbox claim. Esta especificación no fija un ORM.

### 7.1 Matriz de índices/constraints por riesgo

| Riesgo | Constraint autoritativo | Índice de soporte |
|---|---|---|
| two writers / stale state | Game PK lock + CAS `game_version` | PK games(id) |
| duplicate/ordered events | UK(game_id, sequence_number), positive check | (game_id, sequence_number) |
| duplicate outbox/delivery | mensaje: UK(game_id,outbox_sequence), event/audience y dedup key; attempt: UK(message,attempt,stage) | delivery state status/next_attempt + message game/sequence |
| idempotency key reuse/concurrent miss | UK(game,actor,key) + fingerprint immutable + recheck obligatorio bajo Game lock; transición transaction-sealed a COMMITTED | covering game/actor/key/status/fingerprint y command ID; sólo COMMITTED es durable |
| journal/trace ordering | UK(game,event_sequence,artifact_ordinal), ambos positivos; event head transaccional | game/event_sequence/artifact_ordinal y game/subject/event_sequence/artifact_ordinal |
| cross-game reference | composite FKg in game-scoped relations | leading game_id on access paths |
| card in two active slots/zones | partial UK card assignment + state/zone transaction check | game/controller/zone; campaign active slot |
| duplicate seat/country/order | three UKs on player_seats | game/clockwise |
| duplicate open interaction | partial UK source resolution/activation | game/actor/status |
| negative balances/counters | journal resulting-balance y checks locales; AP balance=journal y mismo last sequence | game/participant/history; AP game/participant/turn/sequence |
| replay scan/N+1 | immutable pins + sequence keyset | game/sequence; game/version DESC |
| hidden-data overfetch | viewer-bound query predicates + application policy | game/viewer/status only where required |

## 8. JSON schemas y compatibilidad

Schemas mínimos a versionar en `json_schema_versions` antes de uso:

```text
COMMAND_RESULT, IDEMPOTENCY_RESULT, GAME_EVENT_PAYLOAD,
ADJUDICATION_TRACE_INPUT, ADJUDICATION_TRACE_RULE_EVALUATION,
ADJUDICATION_TRACE_OUTPUT, GAME_SNAPSHOT, PENDING_CONTINUATION,
CHOICE_OPTIONS, CHOICE_CONSTRAINTS, CHOICE_SELECTION,
FACILITATOR_REQUEST_SAFE_CONTEXT, DIE_REQUEST_POLICY,
CARD_REQUIREMENT_PARAMETERS, CARD_EFFECT_OPERATIONS,
SCENARIO_RULE_VALUE, OBJECTIVE_EVALUATOR, OBJECTIVE_PROGRESS,
OBJECTIVE_AWARD_SNAPSHOT, RNG_METADATA, FINAL_SCORES, OUTBOX_PAYLOAD
```

Cada schema tiene ID, versión, JCS SHA-256, fuente y `compatibility_mode = EXACT | BACKWARD_READ_ONLY | MIGRATION_REQUIRED`. Escritura exige versión exacta soportada; lectura histórica admite sólo compatibilidad declarada. Unknown discriminator/version falla cerrado. Se prohíben NaN, Infinity, undefined, coerción implícita, funciones, SQL, prompts o código en JSON.

## 9. Privacidad, ownership y secretos

- DB no recibe escrituras directas de browser; application layer verifica session binding y construye ActorContext.
- La proyección filtra antes de HTTP/WebSocket. Hand, deck order, hidden plan, secret objectives, choice options, reveals y raw traces usan tablas/filas con viewer explícito.
- `authenticated_session_digest` guarda digest de binding, no token/cookie/JWT. Credenciales y claves de proveedor no pertenecen al schema del juego.
- Logs operativos no contienen hands, objectives, future deck order, private deal/narrative, raw trace ni payloads de idempotencia.
- El uso de PostgreSQL RLS como defensa adicional queda abierto en IQ-M2-012; la falta de decisión no autoriza política permisiva.

### 9.1 Mapa de secretos

| Dato | Persistencia | Owner/viewer permitido | Prohibición |
|---|---|---|---|
| session binding | game_memberships digest | application authz service | token/JWT raw en DB o log |
| hand/card control | card_instances | controller + F1; conteo redactado a rival | query full-state a browser |
| future deck order | deck_card_positions | SYSTEM; F1 sólo si policy expresa | player/LLM/log general |
| hidden plan | planned_actions | owner + F1 antes de reveal | rival/event público prematuro |
| choice options/continuation | choice_requests/pending_resolutions | actor designado + F1 + SYSTEM | inferir eligibilidad rival |
| temporary reveal | reveals + reveal_cards | viewer explícito + F1 hasta cierre | cache posterior al expiry |
| secret objective/progress | objective definitions/progress | owner + F1 | rival/realtime público |
| narrative/deal text | narrative/deal tables | participantes autorizados + F1 | observability general |
| raw trace/snapshot/result | traces/snapshots/idempotency | SYSTEM/F1; proyección redactada | raw CommandResult broadcast |

## 10. Retention, backup, restore y migrations

- Durante M2 se conservan íntegramente events, journals de recursos/AP/VP/influence/legitimacy, outbox messages/delivery attempts, traces, rolls, decisions, votes, outcomes, idempotency results y snapshots. Sin compaction ni hard-delete.
- `action_point_balances`, `outbox_delivery_states` y demás proyecciones `CUR` son mutables sólo bajo sus transacciones autorizadas; no reemplazan sus journals append-only.
- Los registros de idempotencia `COMMITTED` se preservan íntegros e inmutables; ningún `INTERNAL_PENDING` puede sobrevivir al cierre de la transacción.
- Reference rows se retiran por status; pins históricos permanecen legibles.
- `GameSnapshot` puede añadirse por checkpoint estable; no reemplaza event log/ledgers.
- Migraciones forward-only, checksum y orden total. No down migration automática/destructiva.
- Rollback operacional: detener writer, volver al build compatible y restaurar backup ensayado; no reescribir historia con una migration descendente.
- Antes de M2-1 production claim: prueba de backup/restore sobre snapshot + log + journals (incluido AP) + outbox message/state/attempt history, verificación de hashes, sequences, versions y replay. RPO/RTO/proveedor no se fijan aquí.
- Particionado y archival thresholds quedan en IQ-M2-013; no se particiona prematuramente.

## 11. Manifest mínimo futuro `GE-M2-DB-001`

La prueba contractual del futuro adapter debe cubrir las 87 tablas por grupos, sus PK/FK/UK/checks/índices manifestados, pins de versión, schema JSON, single-zone, journals append-only, el par AP balance+journal, una fila Game lock/CAS, requests/continuations durables, sequences monotónicas, idempotencia `TXS` con fast path + recheck obligatorio y el trío outbox message/state/attempt. El manifest deberá comprobar en `resource_transactions`, `vp_transactions`, `influence_mutations`, `legitimacy_events`, `action_point_transactions` y `adjudication_traces` las columnas/UK/CK/IDX de `(game_id,game_event_sequence,artifact_ordinal)`. Tras la aprobación humana futura, deberá comparar introspección contra el catálogo aprobado; no basta contar tablas.

Acceptance adicional obligatoria:

- schema vacío y schema migrado convergen;
- migration aplicada dos veces no duplica ni reescribe;
- seed registry sólo acepta snapshot/hash aprobado;
- FK cross-game y version mismatch rechazan;
- fault injection en cada write boundary revierte todos los artifacts;
- fault injection específico demuestra: cero CAS-loser artifact, cero `INTERNAL_PENDING` committed, AP balance+journal atómicos y outbox gameplay/post-commit reconstruible;
- dos miss concurrentes de idempotencia demuestran recheck: same fingerprint retorna el resultado original sin expected-version check; different fingerprint rechaza tipadamente sin artifacts;
- replay de dos o más mutations del mismo command demuestra orden único event/ordinal; rollback y CAS loser no dejan gaps permanentes ni ordinals parciales;
- restore produce state hash/replay equivalentes;
- query fixtures no incurren en N+1;
- no secrets ni unauthorized rows aparecen en projection queries.

## 12. Preguntas de implementación abiertas

| ID | Pregunta | Impacto |
|---|---|---|
| IQ-M2-011 | ¿UUIDv7 se genera mediante función nativa/extensión PostgreSQL aprobada o application port verificado? | Bloquea DDL exacto/default de PK; no cambia el modelo lógico. |
| IQ-M2-012 | ¿RLS defense-in-depth se adopta y con qué identity binding/policy matrix, o el acceso queda exclusivamente detrás del application role? | Bloquea afirmar seguridad productiva del adapter; no autoriza acceso directo. |
| IQ-M2-013 | ¿Qué volumen/edad dispara particionado, archival y restore tiers para events/traces/outbox? | Bloquea operating envelope/retention productiva; en M2 rige conservación íntegra sin partición asumida. |

## 13. Gate

Las correcciones documentales **M20-R01…R06 están IMPLEMENTED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW**. El catálogo permanece en **87 tablas**: R05/R06 sólo completan lifecycle, columnas e invariantes de las tablas ya reconciliadas. Este documento queda **BLOCKED / PENDING PRODUCT OWNER AND TECHNICAL REVIEW**: no contiene DDL ejecutable y no aprueba las 87 tablas, UUID generator, RLS, particionado, proveedor, ORM, cloud, AuthN, WebSocket ni migrations. M2-1…M2-7, M2 global y M3 permanecen **NOT AUTHORIZED**.
