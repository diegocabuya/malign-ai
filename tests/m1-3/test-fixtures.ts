import { readFileSync } from 'node:fs';
import { InMemorySessionAuthority } from '../../packages/authz/src/index.js';
import type { SetupGameState } from '../../packages/domain/src/index.js';
import {
  InMemorySetupGameStore,
  M1AdjudicationEngine,
  SetupCommandDispatcher,
} from '../../packages/game-engine/src/index.js';
import {
  InMemoryGameSessionApplication,
} from '../../apps/server/src/game-session-application.js';
import {
  InMemoryProjectedEventConsumer,
  InMemoryRealtimeTestAdapter,
} from '../../apps/server/src/m1-realtime.js';
import {
  adjudicationHarness,
  type AdjudicationHarness,
} from '../m1-2/test-fixtures.js';
import {
  GAME_ID,
  harness,
  MinimumRandomProvider,
  sessionId,
  trustedBindings,
  type M1Harness,
} from '../m1-0/test-fixtures.js';

interface ReconnectFixture {
  readonly fixture_schema_version: string;
  readonly game_id: string;
  readonly fixed_timestamp: string;
  readonly cursor_contract: readonly ['game_version', 'last_sequence_number'];
  readonly snapshot_serialized: {
    readonly source_fixture: string;
    readonly checkpoint: 'NARRATIVE_REQUIRED';
    readonly serializer: 'createM1StateSnapshot';
    readonly canonical_state_json_required: true;
    readonly rehydrate_in_new_in_memory_instance: true;
  };
  readonly initial_sync: {
    readonly concurrent_commit: 'CAMPAIGN_CREATED';
    readonly expected_application_count: 1;
  };
  readonly delivery_duplicate: {
    readonly identity: readonly ['event_id', 'sequence_number'];
    readonly expected_application_count: 1;
  };
  readonly known_gap: {
    readonly drop_delivery: 1;
    readonly recover_with: 'GET_EVENT_FEED';
    readonly expected_convergence: 'LATEST_AUTHORIZED_PROJECTION';
  };
  readonly pending_resolution: {
    readonly kind: 'NARRATIVE';
    readonly actor_participant_id: 'P1';
    readonly owner_session_id: 'session-p1';
    readonly rival_session_id: 'session-p2';
    readonly facilitator_session_id: 'session-f1';
    readonly reconnect_auto_pass: false;
    readonly reconnect_consumes_rng: false;
  };
  readonly negative_assertions: readonly string[];
}

export const RECONNECT_FIXTURE = JSON.parse(
  readFileSync(new URL('../fixtures/m1-3/reconnect-checkpoints-m1.json', import.meta.url), 'utf8'),
) as ReconnectFixture;

export interface M13RealtimeHarness extends AdjudicationHarness {
  readonly app: InMemoryGameSessionApplication;
  readonly realtime: InMemoryRealtimeTestAdapter;
}

export interface M13PlanningHarness extends M1Harness {
  readonly engine: M1AdjudicationEngine;
  readonly app: InMemoryGameSessionApplication;
  readonly realtime: InMemoryRealtimeTestAdapter;
}

const materializeAllMemberships = (authority: InMemorySessionAuthority): void => {
  for (const participantId of ['F1', 'P1', 'P2', 'P3', 'P4', 'P5']) {
    authority.materializeMembership(sessionId(participantId), GAME_ID, participantId);
  }
};

export const realtimeAdjudicationHarness = (options: {
  readonly includeNarrative?: boolean;
  readonly die?: number;
} = {}): M13RealtimeHarness => {
  const base = adjudicationHarness(options);
  const realtime = new InMemoryRealtimeTestAdapter();
  const app = new InMemoryGameSessionApplication(
    base.authority,
    base.store,
    base.dispatcher,
    () => new Date(RECONNECT_FIXTURE.fixed_timestamp),
    base.engine,
    realtime,
  );
  return { ...base, app, realtime };
};

export const realtimePlanningHarness = (state: SetupGameState): M13PlanningHarness => {
  const base = harness({ states: [state], bindings: trustedBindings() });
  materializeAllMemberships(base.authority);
  const engine = new M1AdjudicationEngine(
    base.store,
    base.random,
    () => new Date(RECONNECT_FIXTURE.fixed_timestamp),
  );
  const realtime = new InMemoryRealtimeTestAdapter();
  const app = new InMemoryGameSessionApplication(
    base.authority,
    base.store,
    base.dispatcher,
    () => new Date(RECONNECT_FIXTURE.fixed_timestamp),
    engine,
    realtime,
  );
  return { ...base, engine, app, realtime };
};

export const rehydratedRealtimeHarness = (state: SetupGameState): M13PlanningHarness => {
  const store = new InMemorySetupGameStore([state]);
  const random = new MinimumRandomProvider();
  const authority = new InMemorySessionAuthority(trustedBindings());
  materializeAllMemberships(authority);
  const dispatcher = new SetupCommandDispatcher(
    store,
    random,
    () => new Date(RECONNECT_FIXTURE.fixed_timestamp),
  );
  const engine = new M1AdjudicationEngine(
    store,
    random,
    () => new Date(RECONNECT_FIXTURE.fixed_timestamp),
  );
  const realtime = new InMemoryRealtimeTestAdapter();
  const app = new InMemoryGameSessionApplication(
    authority,
    store,
    dispatcher,
    () => new Date(RECONNECT_FIXTURE.fixed_timestamp),
    engine,
    realtime,
  );
  return { store, random, authority, dispatcher, engine, app, realtime };
};

export const connectConsumer = (
  testHarness: M13RealtimeHarness | M13PlanningHarness,
  participantId: string,
): {
  readonly consumer: InMemoryProjectedEventConsumer;
  readonly subscriptionId: string;
} => {
  const initial = testHarness.app.getM1InitialSync(sessionId(participantId), GAME_ID);
  if (!initial.ok) throw new Error(`Initial sync failed: ${initial.error.code}`);
  const consumer = new InMemoryProjectedEventConsumer();
  consumer.initialize(initial.value);
  const subscribed = testHarness.app.subscribeM1Realtime(
    sessionId(participantId),
    GAME_ID,
    initial.value.cursor,
    consumer.receive,
  );
  if (!subscribed.ok) throw new Error(`Realtime subscription failed: ${subscribed.error.code}`);
  return { consumer, subscriptionId: subscribed.value.subscription.subscriptionId };
};
