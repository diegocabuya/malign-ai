import {
  type ActorContext,
  type EngineError,
  type M1AdjudicationErrorCode,
} from '@malign-ai/contracts';
import type { ParticipantRole, SetupGameState } from '@malign-ai/domain';
import {
  buildM1RealtimeCursor,
  buildM1RealtimeProjection,
  projectM1EventForViewer,
  realtimeProjectionId,
  type M1RealtimeCursor,
  type M1RealtimeProjection,
  type ProjectedM1Event,
} from '@malign-ai/projections';

export interface M1InitialSync {
  readonly projection: M1RealtimeProjection;
  readonly cursor: M1RealtimeCursor;
}

export interface M1AuthorizedEventFeed extends M1InitialSync {
  readonly events: readonly ProjectedM1Event[];
}

export interface M1RealtimeDelivery extends M1AuthorizedEventFeed {
  readonly deliveryId: string;
  readonly deliveryKind: 'LIVE' | 'RECOVERY';
}

export type M1RealtimeOperationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: EngineError };

export interface AuthorizedRealtimeSubscription {
  readonly subscriptionId: string;
  readonly authenticatedSessionId: string;
  readonly gameId: string;
  readonly viewerParticipantId: string;
  readonly viewerRole: ParticipantRole;
  readonly projectionId: string;
}

export type M1RealtimeDeliveryHandler = (delivery: M1RealtimeDelivery) => void;

export interface M1RealtimePort {
  subscribe(
    target: Omit<AuthorizedRealtimeSubscription, 'subscriptionId'>,
    handler: M1RealtimeDeliveryHandler,
  ): AuthorizedRealtimeSubscription;
  subscriptionsForGame(gameId: string): readonly AuthorizedRealtimeSubscription[];
  publish(subscriptionId: string, delivery: M1RealtimeDelivery): void;
  unsubscribe(subscriptionId: string): void;
}

interface StoredSubscription {
  readonly target: AuthorizedRealtimeSubscription;
  readonly handler: M1RealtimeDeliveryHandler;
  readonly deliveries: M1RealtimeDelivery[];
  readonly droppedDeliveries: M1RealtimeDelivery[];
  dropNext: boolean;
}

/**
 * Operational test adapter only. It owns no rules, state or authorization
 * decisions and intentionally has no network or production transport.
 */
export class InMemoryRealtimeTestAdapter implements M1RealtimePort {
  readonly #subscriptions = new Map<string, StoredSubscription>();
  #nextSubscription = 1;

  subscribe(
    target: Omit<AuthorizedRealtimeSubscription, 'subscriptionId'>,
    handler: M1RealtimeDeliveryHandler,
  ): AuthorizedRealtimeSubscription {
    const subscriptionId = `m1-rt-subscription-${this.#nextSubscription}`;
    this.#nextSubscription += 1;
    const authorized = { ...structuredClone(target), subscriptionId };
    this.#subscriptions.set(subscriptionId, {
      target: authorized,
      handler,
      deliveries: [],
      droppedDeliveries: [],
      dropNext: false,
    });
    return structuredClone(authorized);
  }

  subscriptionsForGame(gameId: string): readonly AuthorizedRealtimeSubscription[] {
    return [...this.#subscriptions.values()]
      .filter(({ target }) => target.gameId === gameId)
      .map(({ target }) => structuredClone(target));
  }

  publish(subscriptionId: string, delivery: M1RealtimeDelivery): void {
    const subscription = this.#subscriptions.get(subscriptionId);
    if (subscription === undefined) return;
    if (
      delivery.cursor.gameId !== subscription.target.gameId ||
      delivery.cursor.projectionId !== subscription.target.projectionId
    ) throw new Error('Realtime adapter received a delivery outside its authorized subscription');
    const stableDelivery = structuredClone(delivery);
    if (subscription.dropNext) {
      subscription.dropNext = false;
      subscription.droppedDeliveries.push(stableDelivery);
      return;
    }
    subscription.deliveries.push(stableDelivery);
    subscription.handler(structuredClone(stableDelivery));
  }

  unsubscribe(subscriptionId: string): void {
    this.#subscriptions.delete(subscriptionId);
  }

  deliveriesFor(subscriptionId: string): readonly M1RealtimeDelivery[] {
    return structuredClone(this.#subscriptions.get(subscriptionId)?.deliveries ?? []);
  }

  droppedDeliveriesFor(subscriptionId: string): readonly M1RealtimeDelivery[] {
    return structuredClone(this.#subscriptions.get(subscriptionId)?.droppedDeliveries ?? []);
  }

  dropNextDelivery(subscriptionId: string): void {
    const subscription = this.#subscriptions.get(subscriptionId);
    if (subscription === undefined) throw new Error('Unknown realtime subscription');
    subscription.dropNext = true;
  }

  redeliver(subscriptionId: string, deliveryIndex: number): void {
    const subscription = this.#subscriptions.get(subscriptionId);
    const delivery = subscription?.deliveries[deliveryIndex];
    if (subscription === undefined || delivery === undefined) throw new Error('Unknown realtime delivery');
    subscription.handler(structuredClone(delivery));
  }
}

export const validateM1RealtimeCursor = (
  state: SetupGameState,
  viewer: ActorContext,
  cursor: unknown,
): M1AdjudicationErrorCode | undefined => {
  if (!isM1RealtimeCursor(cursor)) return 'REALTIME_CURSOR_INVALID';
  if (viewer.participantId === undefined || viewer.actorType === 'SYSTEM') {
    return 'REALTIME_CURSOR_SCOPE_MISMATCH';
  }
  if (
    cursor.gameId !== state.id ||
    cursor.viewerParticipantId !== viewer.participantId ||
    cursor.viewerRole !== viewer.actorType ||
    cursor.projectionId !== realtimeProjectionId(viewer)
  ) return 'REALTIME_CURSOR_SCOPE_MISMATCH';
  if (
    !Number.isSafeInteger(cursor.gameVersion) ||
    !Number.isSafeInteger(cursor.lastSequenceNumber) ||
    cursor.gameVersion < 0 ||
    cursor.lastSequenceNumber < 0 ||
    cursor.gameVersion > state.version ||
    cursor.lastSequenceNumber > (state.events.at(-1)?.sequenceNumber ?? 0)
  ) return 'REALTIME_CURSOR_INVALID';
  if (cursor.lastSequenceNumber === 0) {
    return cursor.gameVersion === 0 ? undefined : 'REALTIME_CURSOR_INVALID';
  }
  const cursorEvent = state.events[cursor.lastSequenceNumber - 1];
  if (
    cursorEvent === undefined ||
    cursorEvent.sequenceNumber !== cursor.lastSequenceNumber ||
    cursorEvent.gameVersion !== cursor.gameVersion
  ) return 'REALTIME_CURSOR_INVALID';
  return undefined;
};

export const isM1RealtimeCursor = (value: unknown): value is M1RealtimeCursor => {
  if (typeof value !== 'object' || value === null) return false;
  const cursor = value as Record<string, unknown>;
  return (
    typeof cursor.gameId === 'string' &&
    typeof cursor.viewerParticipantId === 'string' &&
    (cursor.viewerRole === 'PLAYER' || cursor.viewerRole === 'FACILITATOR') &&
    typeof cursor.projectionId === 'string' &&
    typeof cursor.gameVersion === 'number' &&
    typeof cursor.lastSequenceNumber === 'number'
  );
};

export const buildM1AuthorizedEventFeed = (
  state: SetupGameState,
  viewer: ActorContext,
  afterCursor: M1RealtimeCursor,
): M1AuthorizedEventFeed => ({
  projection: buildM1RealtimeProjection(state, viewer),
  cursor: buildM1RealtimeCursor(state, viewer),
  events: state.events
    .filter(({ sequenceNumber }) => sequenceNumber > afterCursor.lastSequenceNumber)
    .map((event) => projectM1EventForViewer(event, viewer))
    .filter((event): event is ProjectedM1Event => event !== undefined),
});

export interface ProjectedDeliveryResult {
  readonly status: 'APPLIED' | 'DEDUPLICATED' | 'GAP_DETECTED';
  readonly appliedEvents: number;
  readonly duplicateEvents: number;
  readonly gapAfterSequenceNumber?: number;
}

/** Test consumer proving authoritative identity dedupe and explicit gap recovery. */
export class InMemoryProjectedEventConsumer {
  readonly #eventIdBySequence = new Map<number, string>();
  readonly #sequenceByEventId = new Map<string, number>();
  #cursor?: M1RealtimeCursor;
  #projection?: M1RealtimeProjection;
  #lastResult: ProjectedDeliveryResult | undefined;

  initialize(initial: M1InitialSync): void {
    this.#cursor = structuredClone(initial.cursor);
    this.#projection = structuredClone(initial.projection);
    this.#lastResult = undefined;
  }

  receive = (delivery: M1RealtimeDelivery): void => {
    this.#lastResult = this.applyLive(delivery);
  };

  recover(feed: M1AuthorizedEventFeed): ProjectedDeliveryResult {
    this.assertInitializedFor(feed.cursor);
    this.assertProjectedEventsMatchCursor(feed.events, feed.cursor);
    const counts = this.recordEvents(feed.events);
    this.#cursor = structuredClone(feed.cursor);
    this.#projection = structuredClone(feed.projection);
    const result: ProjectedDeliveryResult = {
      status: counts.applied === 0 ? 'DEDUPLICATED' : 'APPLIED',
      appliedEvents: counts.applied,
      duplicateEvents: counts.duplicates,
    };
    this.#lastResult = result;
    return result;
  }

  get cursor(): M1RealtimeCursor | undefined {
    return this.#cursor === undefined ? undefined : structuredClone(this.#cursor);
  }

  get projection(): M1RealtimeProjection | undefined {
    return this.#projection === undefined ? undefined : structuredClone(this.#projection);
  }

  get appliedEventCount(): number {
    return this.#sequenceByEventId.size;
  }

  get lastResult(): ProjectedDeliveryResult | undefined {
    return this.#lastResult === undefined ? undefined : structuredClone(this.#lastResult);
  }

  private applyLive(delivery: M1RealtimeDelivery): ProjectedDeliveryResult {
    this.assertInitializedFor(delivery.cursor);
    this.assertProjectedEventsMatchCursor(delivery.events, delivery.cursor);
    const cursor = this.#cursor;
    if (cursor === undefined) throw new Error('Realtime consumer is not initialized');
    const firstUnseen = delivery.events.find((event) =>
      !this.#sequenceByEventId.has(event.eventId) && event.sequenceNumber > cursor.lastSequenceNumber,
    );
    if (firstUnseen !== undefined && firstUnseen.sequenceNumber > cursor.lastSequenceNumber + 1) {
      return {
        status: 'GAP_DETECTED',
        appliedEvents: 0,
        duplicateEvents: 0,
        gapAfterSequenceNumber: cursor.lastSequenceNumber,
      };
    }
    const counts = this.recordEvents(delivery.events);
    this.#cursor = structuredClone(delivery.cursor);
    this.#projection = structuredClone(delivery.projection);
    return {
      status: counts.applied === 0 ? 'DEDUPLICATED' : 'APPLIED',
      appliedEvents: counts.applied,
      duplicateEvents: counts.duplicates,
    };
  }

  private assertInitializedFor(cursor: M1RealtimeCursor): void {
    if (this.#cursor === undefined || this.#projection === undefined) {
      throw new Error('Realtime consumer must be initialized from an authorized projection');
    }
    if (
      cursor.gameId !== this.#cursor.gameId ||
      cursor.projectionId !== this.#cursor.projectionId
    ) throw new Error('Realtime consumer cursor scope mismatch');
    if (
      cursor.lastSequenceNumber < this.#cursor.lastSequenceNumber ||
      cursor.gameVersion < this.#cursor.gameVersion
    ) throw new Error('Realtime consumer cursor cannot move backwards');
  }

  private assertProjectedEventsMatchCursor(
    events: readonly ProjectedM1Event[],
    cursor: M1RealtimeCursor,
  ): void {
    if (events.some((event) =>
      event.gameId !== cursor.gameId ||
      event.sequenceNumber > cursor.lastSequenceNumber ||
      event.gameVersion > cursor.gameVersion
    )) throw new Error('Projected event lies outside its authorized cursor');
  }

  private recordEvents(events: readonly ProjectedM1Event[]): { readonly applied: number; readonly duplicates: number } {
    let applied = 0;
    let duplicates = 0;
    let previousSequence = -1;
    for (const event of events) {
      if (event.sequenceNumber <= previousSequence) throw new Error('Projected events are not ordered');
      previousSequence = event.sequenceNumber;
      const knownSequence = this.#sequenceByEventId.get(event.eventId);
      const knownEventId = this.#eventIdBySequence.get(event.sequenceNumber);
      if (knownSequence !== undefined || knownEventId !== undefined) {
        if (knownSequence !== event.sequenceNumber || knownEventId !== event.eventId) {
          throw new Error('Projected event identity conflict');
        }
        duplicates += 1;
        continue;
      }
      this.#sequenceByEventId.set(event.eventId, event.sequenceNumber);
      this.#eventIdBySequence.set(event.sequenceNumber, event.eventId);
      applied += 1;
    }
    return { applied, duplicates };
  }
}
