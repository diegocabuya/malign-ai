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
  readonly fromCursor: M1RealtimeCursor;
  readonly events: readonly ProjectedM1Event[];
}

export interface M1RealtimeDelivery extends M1AuthorizedEventFeed {
  readonly deliveryId: string;
  readonly deliveryKind: 'LIVE' | 'RECOVERY';
}

export type M1RealtimeOperationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: EngineError };

/** Opaque public handle. Session authority never crosses the application boundary. */
export interface M1RealtimeSubscriptionHandle {
  readonly subscriptionId: string;
}

export interface InternalRealtimeSubscription extends M1RealtimeSubscriptionHandle {
  readonly authenticatedSessionId: string;
  readonly gameId: string;
  readonly viewerParticipantId: string;
  readonly viewerRole: ParticipantRole;
  readonly projectionId: string;
  readonly startCursor: M1RealtimeCursor;
  readonly lastIssuedCursor: M1RealtimeCursor;
  readonly active: boolean;
}

export type M1RealtimeDeliveryHandler = (delivery: M1RealtimeDelivery) => void;

export interface M1RealtimePort {
  register(
    target: Omit<InternalRealtimeSubscription, 'subscriptionId' | 'lastIssuedCursor' | 'active'>,
  ): M1RealtimeSubscriptionHandle;
  subscriptionsForGame(gameId: string): readonly InternalRealtimeSubscription[];
  matches(
    subscriptionId: string,
    target: Pick<InternalRealtimeSubscription, 'authenticatedSessionId' | 'gameId' | 'viewerParticipantId' | 'viewerRole' | 'projectionId'>,
  ): boolean;
  publish(subscriptionId: string, delivery: M1RealtimeDelivery): void;
  activate(
    subscriptionId: string,
    handler: M1RealtimeDeliveryHandler,
    catchup?: M1RealtimeDelivery,
  ): void;
  unsubscribe(subscriptionId: string): void;
}

interface StoredSubscription {
  readonly target: Omit<InternalRealtimeSubscription, 'lastIssuedCursor' | 'active'>;
  handler?: M1RealtimeDeliveryHandler;
  lastIssuedCursor: M1RealtimeCursor;
  active: boolean;
  readonly bufferedDeliveries: M1RealtimeDelivery[];
  readonly deliveries: M1RealtimeDelivery[];
  readonly droppedDeliveries: M1RealtimeDelivery[];
  readonly handlerErrors: unknown[];
  dropNext: boolean;
}

const cursorScopeMatches = (left: M1RealtimeCursor, right: M1RealtimeCursor): boolean =>
  left.gameId === right.gameId &&
  left.viewerParticipantId === right.viewerParticipantId &&
  left.viewerRole === right.viewerRole &&
  left.projectionId === right.projectionId;

const cursorPositionAtOrAfter = (left: M1RealtimeCursor, right: M1RealtimeCursor): boolean =>
  left.lastSequenceNumber > right.lastSequenceNumber ||
  (left.lastSequenceNumber === right.lastSequenceNumber && left.gameVersion >= right.gameVersion);

/** Operational adapter used only inside deterministic in-memory tests. */
export class InMemoryRealtimeTestAdapter implements M1RealtimePort {
  readonly #subscriptions = new Map<string, StoredSubscription>();
  #nextSubscription = 1;

  register(
    target: Omit<InternalRealtimeSubscription, 'subscriptionId' | 'lastIssuedCursor' | 'active'>,
  ): M1RealtimeSubscriptionHandle {
    const subscriptionId = `m1-rt-subscription-${this.#nextSubscription}`;
    this.#nextSubscription += 1;
    const storedTarget = { ...structuredClone(target), subscriptionId };
    this.#subscriptions.set(subscriptionId, {
      target: storedTarget,
      lastIssuedCursor: structuredClone(target.startCursor),
      active: false,
      bufferedDeliveries: [],
      deliveries: [],
      droppedDeliveries: [],
      handlerErrors: [],
      dropNext: false,
    });
    return { subscriptionId };
  }

  subscriptionsForGame(gameId: string): readonly InternalRealtimeSubscription[] {
    return [...this.#subscriptions.values()]
      .filter(({ target }) => target.gameId === gameId)
      .map(({ target, lastIssuedCursor, active }) => ({
        ...structuredClone(target),
        lastIssuedCursor: structuredClone(lastIssuedCursor),
        active,
      }));
  }

  matches(
    subscriptionId: string,
    target: Pick<InternalRealtimeSubscription, 'authenticatedSessionId' | 'gameId' | 'viewerParticipantId' | 'viewerRole' | 'projectionId'>,
  ): boolean {
    const stored = this.#subscriptions.get(subscriptionId)?.target;
    return stored !== undefined &&
      stored.authenticatedSessionId === target.authenticatedSessionId &&
      stored.gameId === target.gameId &&
      stored.viewerParticipantId === target.viewerParticipantId &&
      stored.viewerRole === target.viewerRole &&
      stored.projectionId === target.projectionId;
  }

  publish(subscriptionId: string, delivery: M1RealtimeDelivery): void {
    const subscription = this.#subscriptions.get(subscriptionId);
    if (subscription === undefined) return;
    if (
      !cursorScopeMatches(delivery.fromCursor, subscription.target.startCursor) ||
      !cursorScopeMatches(delivery.cursor, subscription.target.startCursor) ||
      !cursorPositionAtOrAfter(delivery.cursor, delivery.fromCursor)
    ) throw new Error('Realtime adapter received a delivery outside its authorized subscription');
    const stableDelivery = structuredClone(delivery);
    if (cursorPositionAtOrAfter(stableDelivery.cursor, subscription.lastIssuedCursor)) {
      subscription.lastIssuedCursor = structuredClone(stableDelivery.cursor);
    }
    if (subscription.dropNext) {
      subscription.dropNext = false;
      subscription.droppedDeliveries.push(stableDelivery);
      return;
    }
    if (!subscription.active) {
      subscription.bufferedDeliveries.push(stableDelivery);
      return;
    }
    this.deliver(subscription, stableDelivery);
  }

  activate(
    subscriptionId: string,
    handler: M1RealtimeDeliveryHandler,
    catchup?: M1RealtimeDelivery,
  ): void {
    const subscription = this.#subscriptions.get(subscriptionId);
    if (subscription === undefined) return;
    subscription.handler = handler;
    subscription.active = true;
    if (catchup !== undefined) {
      if (cursorPositionAtOrAfter(catchup.cursor, subscription.lastIssuedCursor)) {
        subscription.lastIssuedCursor = structuredClone(catchup.cursor);
      }
      this.deliver(subscription, structuredClone(catchup));
    }
    const buffered = subscription.bufferedDeliveries.splice(0);
    for (const delivery of buffered) this.deliver(subscription, delivery);
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

  handlerErrorsFor(subscriptionId: string): readonly unknown[] {
    return [...(this.#subscriptions.get(subscriptionId)?.handlerErrors ?? [])];
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
    this.invokeHandler(subscription, structuredClone(delivery));
  }

  private deliver(subscription: StoredSubscription, delivery: M1RealtimeDelivery): void {
    subscription.deliveries.push(structuredClone(delivery));
    this.invokeHandler(subscription, delivery);
  }

  private invokeHandler(subscription: StoredSubscription, delivery: M1RealtimeDelivery): void {
    try {
      subscription.handler?.(structuredClone(delivery));
    } catch (error) {
      subscription.handlerErrors.push(error);
    }
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
  fromCursor: structuredClone(afterCursor),
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

/** Test consumer proving identity dedupe and authorization-aware transport gaps. */
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
    this.assertRange(feed.fromCursor, feed.cursor, feed.events);
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
    this.assertRange(delivery.fromCursor, delivery.cursor, delivery.events);
    const cursor = this.#cursor;
    if (cursor === undefined) throw new Error('Realtime consumer is not initialized');
    if (delivery.fromCursor.lastSequenceNumber > cursor.lastSequenceNumber) {
      return {
        status: 'GAP_DETECTED',
        appliedEvents: 0,
        duplicateEvents: 0,
        gapAfterSequenceNumber: cursor.lastSequenceNumber,
      };
    }
    const counts = this.recordEvents(delivery.events);
    if (cursorPositionAtOrAfter(delivery.cursor, cursor)) {
      this.#cursor = structuredClone(delivery.cursor);
      this.#projection = structuredClone(delivery.projection);
    }
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
    if (!cursorScopeMatches(cursor, this.#cursor)) {
      throw new Error('Realtime consumer cursor scope mismatch');
    }
  }

  private assertRange(
    fromCursor: M1RealtimeCursor,
    toCursor: M1RealtimeCursor,
    events: readonly ProjectedM1Event[],
  ): void {
    if (!cursorScopeMatches(fromCursor, toCursor) || !cursorPositionAtOrAfter(toCursor, fromCursor)) {
      throw new Error('Realtime delivery cursor range is invalid');
    }
    let previousSequence = fromCursor.lastSequenceNumber;
    for (const event of events) {
      if (
        event.gameId !== toCursor.gameId ||
        event.sequenceNumber <= fromCursor.lastSequenceNumber ||
        event.sequenceNumber <= previousSequence ||
        event.sequenceNumber > toCursor.lastSequenceNumber ||
        event.gameVersion > toCursor.gameVersion
      ) throw new Error('Projected event lies outside its authorized cursor range');
      previousSequence = event.sequenceNumber;
    }
  }

  private recordEvents(events: readonly ProjectedM1Event[]): { readonly applied: number; readonly duplicates: number } {
    let applied = 0;
    let duplicates = 0;
    for (const event of events) {
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
