import { engineErrorFor, type AnyEngineErrorCode, type CommandEnvelope, type EngineCommandResult } from '@malign-ai/contracts';

export interface AtomicVersionedState {
  readonly id: string;
  version: number;
}

interface StoredIdempotency {
  readonly fingerprint: string;
  readonly result: EngineCommandResult;
}

export interface AtomicCommandStore<TState extends AtomicVersionedState> {
  load(gameId: string): TState | undefined;
  commitState(gameId: string, expectedVersion: number, next: TState): boolean;
  idempotencyGet(identity: string): StoredIdempotency | undefined;
  idempotencySet(identity: string, value: StoredIdempotency): void;
}

export class InMemoryAtomicStateStore<TState extends AtomicVersionedState> implements AtomicCommandStore<TState> {
  readonly #states = new Map<string, TState>();
  readonly #idempotency = new Map<string, StoredIdempotency>();

  constructor(initialStates: readonly TState[] = []) {
    for (const state of initialStates) this.#states.set(state.id, structuredClone(state));
  }

  load(gameId: string): TState | undefined {
    const state = this.#states.get(gameId);
    return state === undefined ? undefined : structuredClone(state);
  }

  listSnapshots(): TState[] {
    return [...this.#states.values()].map((state) => structuredClone(state));
  }

  commitState(gameId: string, expectedVersion: number, next: TState): boolean {
    const current = this.#states.get(gameId);
    if (current === undefined ? expectedVersion !== 0 : current.version !== expectedVersion) return false;
    if (current === undefined && this.#states.has(gameId)) return false;
    this.#states.set(gameId, structuredClone(next));
    return true;
  }

  idempotencyGet(identity: string): StoredIdempotency | undefined {
    return this.#idempotency.get(identity);
  }

  idempotencySet(identity: string, value: StoredIdempotency): void {
    this.#idempotency.set(identity, value);
  }

  idempotencyCount(): number {
    return this.#idempotency.size;
  }
}

type Envelope<TCommandType extends string, TPayload> = CommandEnvelope<TCommandType, TPayload>;

export interface AtomicResolution<TState extends AtomicVersionedState> {
  readonly nextState: TState;
  readonly resultCode: string;
  readonly resultPayload?: unknown;
  readonly emittedEventRefs: readonly string[];
}

type PreparedResolution<TState extends AtomicVersionedState> =
  | AtomicResolution<TState>
  | { readonly error: AnyEngineErrorCode; readonly version: number };

export const dispatchAtomicCommand = <TState extends AtomicVersionedState, TCommandType extends string, TPayload>(options: {
  readonly envelope: Envelope<TCommandType, TPayload>;
  readonly store: AtomicCommandStore<TState>;
  readonly now: () => Date;
  readonly prepare: (before: TState | undefined, envelope: Envelope<TCommandType, TPayload>) => PreparedResolution<TState>;
}): EngineCommandResult => {
  const { envelope, store } = options;
  const identity = `${envelope.gameId}:${envelope.actorContext.actorId}:${envelope.idempotencyKey}`;
  const commandFingerprint = JSON.stringify({
    commandType: envelope.commandType,
    payloadSchemaVersion: envelope.payloadSchemaVersion,
    payload: envelope.payload,
  });
  const previous = store.idempotencyGet(identity);
  const before = store.load(envelope.gameId);
  const beforeVersion = before?.version ?? 0;
  if (previous !== undefined) {
    if (previous.fingerprint === commandFingerprint) return previous.result;
    return rejectedResult(envelope, beforeVersion, 'IDEMPOTENCY_KEY_REUSED', options.now);
  }

  const prepared = options.prepare(before, envelope);
  if ('error' in prepared) return rejectedResult(envelope, prepared.version, prepared.error, options.now);
  prepared.nextState.version = beforeVersion + 1;
  if (!store.commitState(envelope.gameId, beforeVersion, prepared.nextState)) {
    return rejectedResult(envelope, store.load(envelope.gameId)?.version ?? beforeVersion, 'STALE_STATE_VERSION', options.now);
  }

  const result: EngineCommandResult = {
    commandId: envelope.commandId,
    gameId: envelope.gameId,
    status: 'RESOLVED',
    gameVersionBefore: beforeVersion,
    gameVersionAfter: prepared.nextState.version,
    resultCode: prepared.resultCode,
    ...(prepared.resultPayload === undefined ? {} : { resultPayload: prepared.resultPayload }),
    emittedEventRefs: prepared.emittedEventRefs,
    adjudicationTraceRefs: [],
    resolvedAt: options.now().toISOString(),
  };
  store.idempotencySet(identity, { fingerprint: commandFingerprint, result });
  return result;
};

export const rejectedResult = <TCommandType extends string, TPayload>(
  envelope: Envelope<TCommandType, TPayload>,
  version: number,
  code: AnyEngineErrorCode,
  now: () => Date,
): EngineCommandResult => ({
  commandId: envelope.commandId,
  gameId: envelope.gameId,
  status: 'REJECTED',
  gameVersionBefore: version,
  gameVersionAfter: version,
  resultCode: code,
  emittedEventRefs: [],
  adjudicationTraceRefs: [],
  error: engineErrorFor(code),
  resolvedAt: now().toISOString(),
});
