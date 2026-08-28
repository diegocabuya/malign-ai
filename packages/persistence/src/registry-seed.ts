import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { sha256CanonicalJson } from '@malign-ai/shared';
import { BASE_2025_COUNTRIES, BASE_2025_COUNTRY_SOURCE_REFERENCE } from '@malign-ai/domain';
import type { Pool, PoolClient } from 'pg';

import { PersistenceError } from './errors.js';

export const APPROVED_REGISTRY_JCS_SHA256 =
  '735fd01b65416bdeb1baaa596bb36ea0d0eef31cb1d1d9b7f4b2322c9c585e4a';
export const APPROVED_REGISTRY_BLOB_SHA1 = '8d5c150bed742391555bc6bafe022f45baee0163';
export const APPROVED_REGISTRY_VERSION = 'BASE_2025/0.1-candidate';

interface RegistryDefinition {
  readonly action_point_cost: number | null;
  readonly alignment: string;
  readonly card_type: string;
  readonly definition_id: string;
  readonly display_name: string;
  readonly effect_ids: readonly string[];
  readonly influence_values: Readonly<Record<string, number>>;
  readonly is_reaction: boolean;
  readonly is_starter: boolean;
  readonly remove_after_use: boolean;
  readonly resource_cost: number | null;
  readonly source_refs: readonly string[];
  readonly subtype: string | null;
}

interface RegistryEffect {
  readonly authority_status: string;
  readonly effect_id: string;
  readonly effect_version: string;
  readonly operations: readonly unknown[];
  readonly source_definition_id: string;
  readonly source_refs: readonly string[];
  readonly source_text: string;
  readonly timing_window: string;
  readonly trigger: Readonly<Record<string, unknown>>;
}

interface RegistrySerialTemplate {
  readonly definition_id: string;
  readonly serial_within_country_set: number;
  readonly starter: boolean;
  readonly template_id: string;
  readonly primary_source_ref: string;
  readonly primary_source_sha256: string;
}

interface RegistryAlias {
  readonly alias_display: string;
  readonly alias_normalized: string;
  readonly authority: string;
  readonly definition_id: string;
  readonly locale: string;
}

interface RegistrySnapshot {
  readonly aliases: readonly RegistryAlias[];
  readonly compatibility: Readonly<{ seedable: boolean }>;
  readonly country_ids: readonly string[];
  readonly definition_count: number;
  readonly definitions: readonly RegistryDefinition[];
  readonly effect_definition_count: number;
  readonly effect_definitions: readonly RegistryEffect[];
  readonly materialization: Readonly<{
    card_instances_per_base_game: number;
    starter_instances_per_base_game: number;
    templates_per_country: number;
  }>;
  readonly registry_version: string;
  readonly serial_template_count: number;
  readonly serial_templates: readonly RegistrySerialTemplate[];
  readonly status: string;
  readonly unresolved_items: readonly Readonly<{ status: string }>[];
}

const snapshotPath = resolve(
  process.cwd(),
  'docs/normative/MALIGN_AI_CARD_REGISTRY_SNAPSHOT_v0.1.json',
);

export const loadApprovedRegistrySnapshot = async (): Promise<RegistrySnapshot> => {
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as RegistrySnapshot;
  const digest = sha256CanonicalJson(snapshot);
  const operationCount = snapshot.effect_definitions.reduce(
    (total, effect) => total + effect.operations.length,
    0,
  );
  const valid =
    digest === APPROVED_REGISTRY_JCS_SHA256 &&
    snapshot.registry_version === APPROVED_REGISTRY_VERSION &&
    snapshot.status === 'approved' &&
    snapshot.compatibility.seedable &&
    snapshot.definition_count === 100 &&
    snapshot.definitions.length === 100 &&
    snapshot.serial_template_count === 108 &&
    snapshot.serial_templates.length === 108 &&
    snapshot.aliases.length === 4 &&
    snapshot.effect_definition_count === 59 &&
    snapshot.effect_definitions.length === 59 &&
    operationCount === 103 &&
    snapshot.country_ids.length === 5 &&
    snapshot.unresolved_items.every((item) => item.status.startsWith('resolved_'));
  if (!valid) {
    throw new PersistenceError('REGISTRY_SNAPSHOT_REJECTED', 'Registry snapshot is not the DEC-077 approved artifact');
  }
  return snapshot;
};

export interface RegistrySeedResult {
  readonly registryVersionId: string;
  readonly rulesetVersionId: string;
  readonly engineContractVersionId: string;
  readonly definitions: number;
  readonly templates: number;
  readonly aliases: number;
  readonly effects: number;
  readonly operations: number;
}

const insertCatalog = async (client: PoolClient, snapshot: RegistrySnapshot): Promise<RegistrySeedResult> => {
  const ruleset = await client.query<{ id: string }>(
    `INSERT INTO malign.ruleset_versions(logical_id, version, status, activated_at)
     VALUES ('MALIGN_RULESET', '0.1', 'ACTIVE', clock_timestamp())
     ON CONFLICT (logical_id, version) DO UPDATE SET logical_id = EXCLUDED.logical_id RETURNING id`,
  );
  const engine = await client.query<{ id: string }>(
    `INSERT INTO malign.engine_contract_versions(logical_id, version, status, activated_at)
     VALUES ('MALIGN_ENGINE', '0.1', 'ACTIVE', clock_timestamp())
     ON CONFLICT (logical_id, version) DO UPDATE SET logical_id = EXCLUDED.logical_id RETURNING id`,
  );
  const registry = await client.query<{ id: string }>(
    `INSERT INTO malign.card_registry_versions(
       logical_id, version, status, jcs_sha256, snapshot_blob_sha1, approved_decision_id, activated_at
     ) VALUES ('MALIGN_CARD_REGISTRY', $1, 'ACTIVE', decode($2, 'hex'), decode($3, 'hex'), 'DEC-077', clock_timestamp())
     ON CONFLICT (logical_id, version) DO UPDATE SET logical_id = EXCLUDED.logical_id RETURNING id`,
    [snapshot.registry_version, APPROVED_REGISTRY_JCS_SHA256, APPROVED_REGISTRY_BLOB_SHA1],
  );
  const rulesetId = ruleset.rows[0]?.id;
  const engineId = engine.rows[0]?.id;
  const registryId = registry.rows[0]?.id;
  if (!rulesetId || !engineId || !registryId) throw new Error('Seed version identity missing');

  const countrySourceColumn = await client.query<{ present: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='malign' AND table_name='country_definitions' AND column_name='source_reference') present`,
  );
  const hasCountrySourceReference = countrySourceColumn.rows[0]?.present === true;

  const approvedCountryIds = new Set(snapshot.country_ids);
  for (const country of BASE_2025_COUNTRIES) {
    if (!approvedCountryIds.has(country.id)) {
      throw new PersistenceError('REGISTRY_SNAPSHOT_REJECTED', `Approved registry is missing country ${country.id}`);
    }
    const parameters = [
      country.id,country.canonicalName,country.regimeType,country.mascot,country.colorKey,
      country.startingResources,country.turnIncome,BASE_2025_COUNTRY_SOURCE_REFERENCE,
    ];
    await client.query(hasCountrySourceReference
      ? `INSERT INTO malign.country_definitions(
         logical_id, version, canonical_name, regime_type, mascot, color_key,
         starting_resource_default, turn_income_default, status, source_reference
       ) VALUES ($1, '0.1', $2, $3, $4, $5, $6, $7, 'ACTIVE', $8)
       ON CONFLICT (logical_id, version) DO UPDATE SET
         canonical_name=EXCLUDED.canonical_name,
         regime_type=EXCLUDED.regime_type,
         mascot=EXCLUDED.mascot,
         color_key=EXCLUDED.color_key,
         starting_resource_default=EXCLUDED.starting_resource_default,
         turn_income_default=EXCLUDED.turn_income_default,
         source_reference=EXCLUDED.source_reference`
      : `INSERT INTO malign.country_definitions(
         logical_id,version,canonical_name,regime_type,mascot,color_key,
         starting_resource_default,turn_income_default,status
       ) VALUES ($1,'0.1',$2,$3,$4,$5,$6,$7,'ACTIVE')
       ON CONFLICT (logical_id,version) DO UPDATE SET
         canonical_name=EXCLUDED.canonical_name,regime_type=EXCLUDED.regime_type,
         mascot=EXCLUDED.mascot,color_key=EXCLUDED.color_key,
         starting_resource_default=EXCLUDED.starting_resource_default,
         turn_income_default=EXCLUDED.turn_income_default`,
      hasCountrySourceReference ? parameters : parameters.slice(0,7));
  }

  for (const definition of snapshot.definitions) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO malign.card_definitions(
         logical_id, registry_version_id, canonical_name, category, subtype, intent_alignment,
         is_starter, is_action, is_reaction, remove_after_use, action_point_cost, resource_cost,
         description, effect_text, status, source_reference
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,NULL,'ACTIVE',$13)
       ON CONFLICT (logical_id, registry_version_id) DO UPDATE SET logical_id = EXCLUDED.logical_id
       RETURNING id`,
      [
        definition.definition_id,
        registryId,
        definition.display_name,
        definition.is_starter ? 'STARTER' : definition.card_type,
        definition.subtype,
        definition.alignment,
        definition.is_starter,
        definition.card_type === 'ACTION' || definition.is_reaction,
        definition.is_reaction,
        definition.remove_after_use,
        definition.action_point_cost ?? 0,
        definition.resource_cost ?? 0,
        definition.source_refs.join(' | '),
      ],
    );
    const definitionUuid = result.rows[0]?.id;
    if (!definitionUuid) throw new Error('Seed definition identity missing');
    for (const [slotType, influenceValue] of Object.entries(definition.influence_values)) {
      await client.query(
        `INSERT INTO malign.card_slot_values(card_definition_id, slot_type, influence_value, registry_version_id)
         VALUES ($1, upper($2), $3, $4) ON CONFLICT DO NOTHING`,
        [definitionUuid, slotType, influenceValue, registryId],
      );
    }
  }

  for (const template of snapshot.serial_templates) {
    await client.query(
      `INSERT INTO malign.country_card_serial_templates(
         template_id, registry_version_id, serial_within_country_set, card_definition_id,
         starter, primary_source_ref, primary_source_sha256
       ) SELECT $1,$2,$3,id,$4,$5,decode($6, 'hex')
         FROM malign.card_definitions WHERE registry_version_id=$2 AND logical_id=$7
       ON CONFLICT (template_id, registry_version_id) DO NOTHING`,
      [
        template.template_id,
        registryId,
        template.serial_within_country_set,
        template.starter,
        template.primary_source_ref,
        template.primary_source_sha256,
        template.definition_id,
      ],
    );
  }

  const effectOrdinals = new Map<string, number>();
  for (const effect of snapshot.effect_definitions) {
    const effectOrdinal = effectOrdinals.get(effect.source_definition_id) ?? 0;
    effectOrdinals.set(effect.source_definition_id, effectOrdinal + 1);
    await client.query(
      `INSERT INTO malign.card_effect_definitions(
         logical_effect_id, card_definition_id, ruleset_version_id, registry_version_id,
         effect_type, timing_window, trigger_json, operations_json, operations_schema_id,
         operations_schema_version, order_index, effect_version, source_text, status
       ) SELECT $1,id,$2,$3,'TYPED_OPERATIONS',$4,$5::jsonb,$6::jsonb,
         'malign.card-effect-operations','0.1',$11,$7,$8,$9
         FROM malign.card_definitions WHERE registry_version_id=$3 AND logical_id=$10
       ON CONFLICT (logical_effect_id, effect_version) DO NOTHING`,
      [
        effect.effect_id,
        rulesetId,
        registryId,
        effect.timing_window,
        JSON.stringify(effect.trigger),
        JSON.stringify(effect.operations),
        effect.effect_version,
        effect.source_text,
        effect.authority_status,
        effect.source_definition_id,
        effectOrdinal,
      ],
    );
  }

  for (const alias of snapshot.aliases) {
    await client.query(
      `INSERT INTO malign.card_aliases(
         registry_version_id, alias_normalized, alias_display, card_definition_id, locale, source_reference
       ) SELECT $1,$2,$3,id,$4,$5 FROM malign.card_definitions
         WHERE registry_version_id=$1 AND logical_id=$6
       ON CONFLICT (registry_version_id, alias_normalized, locale) DO NOTHING`,
      [registryId, alias.alias_normalized, alias.alias_display, alias.locale, alias.authority, alias.definition_id],
    );
  }

  await client.query(
    `INSERT INTO malign.registry_seed_runs(
       registry_version_id, snapshot_jcs_sha256, snapshot_git_blob_sha1, row_count, status, migration_version
     ) VALUES ($1,decode($2,'hex'),decode($3,'hex'),271,'COMMITTED','004')
     ON CONFLICT (registry_version_id) DO NOTHING`,
    [registryId, APPROVED_REGISTRY_JCS_SHA256, APPROVED_REGISTRY_BLOB_SHA1],
  );
  return {
    registryVersionId: registryId,
    rulesetVersionId: rulesetId,
    engineContractVersionId: engineId,
    definitions: snapshot.definitions.length,
    templates: snapshot.serial_templates.length,
    aliases: snapshot.aliases.length,
    effects: snapshot.effect_definitions.length,
    operations: snapshot.effect_definitions.reduce((total, effect) => total + effect.operations.length, 0),
  };
};

export const seedApprovedRegistry = async (pool: Pool): Promise<RegistrySeedResult> => {
  const snapshot = await loadApprovedRegistrySnapshot();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE malign_migration_owner');
    const result = await insertCatalog(client, snapshot);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const materializeRegistryForGame = async (
  pool: Pool,
  gameId: string,
  controllersByCountry: Readonly<Record<string, string>>,
): Promise<{ readonly cards: number; readonly starters: number }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE malign_app_runtime');
    const game = await client.query<{ card_registry_version_id: string }>(
      'SELECT card_registry_version_id FROM malign.games WHERE id=$1 FOR UPDATE',
      [gameId],
    );
    const registryId = game.rows[0]?.card_registry_version_id;
    if (!registryId) throw new PersistenceError('GAME_NOT_FOUND', 'Game does not exist');
    for (const [countryLogicalId, participantId] of Object.entries(controllersByCountry)) {
      await client.query(
        `INSERT INTO malign.card_instances(
           game_id, country_owner_definition_id, serial_template_id, card_definition_id,
           current_controller_participant_id, zone, face_state
         ) SELECT $1,c.id,t.id,t.card_definition_id,$2,
             CASE WHEN t.starter THEN 'HAND' ELSE 'DRAW_PILE' END,
             CASE WHEN t.starter THEN 'FACE_UP' ELSE 'FACE_DOWN' END
           FROM malign.country_definitions c
           CROSS JOIN malign.country_card_serial_templates t
          WHERE c.logical_id=$3 AND c.version='0.1' AND t.registry_version_id=$4
         ON CONFLICT (game_id, country_owner_definition_id, serial_template_id) DO NOTHING`,
        [gameId, participantId, countryLogicalId, registryId],
      );
    }
    const counts = await client.query<{ cards: string; starters: string }>(
      `SELECT count(*)::text cards,
              count(*) FILTER (WHERE t.starter)::text starters
         FROM malign.card_instances i
         JOIN malign.country_card_serial_templates t ON t.id=i.serial_template_id
        WHERE i.game_id=$1`,
      [gameId],
    );
    await client.query('COMMIT');
    return {
      cards: Number(counts.rows[0]?.cards ?? 0),
      starters: Number(counts.rows[0]?.starters ?? 0),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
