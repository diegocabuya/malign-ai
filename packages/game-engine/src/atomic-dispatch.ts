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

export type StateCommitListener<TState extends AtomicVersionedState> = (
  before: TState | undefined,
  after: TState,
) => void;

export class InMemoryAtomicStateStore<TState extends AtomicVersionedState> implements AtomicCommandStore<TState> {
  readonly #states = new Map<string, TState>();
  readonly #idempotency = new Map<string, StoredIdempotency>();
  readonly #commitListeners = new Set<StateCommitListener<TState>>();
  readonly #commitListenerErrors: unknown[] = [];

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
    for (const listener of this.#commitListeners) {
      try {
        listener(current === undefined ? undefined : structuredClone(current), structuredClone(next));
      } catch (error) {
        // A post-commit observer cannot roll back or invalidate an accepted command.
        // Recovery reads the authoritative event log if an operational delivery fails.
        this.#commitListenerErrors.push(error);
      }
    }
    return true;
  }

  onCommitted(listener: StateCommitListener<TState>): () => void {
    this.#commitListeners.add(listener);
    return () => this.#commitListeners.delete(listener);
  }

  commitListenerErrors(): readonly unknown[] {
    return [...this.#commitListenerErrors];
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
  readonly status?: 'RESOLVED' | 'REQUIRES_CHOICE';
  readonly resultCode: string;
  readonly resultPayload?: unknown;
  readonly emittedEventRefs: readonly string[];
  readonly adjudicationTraceRefs?: readonly string[];
}

export type PreparedResolution<TState extends AtomicVersionedState> =
  | AtomicResolution<TState>
  | { readonly error: AnyEngineErrorCode; readonly version: number };

// Stable recursive key ordering for validated JSON command payloads. This is
// deliberately scoped to deterministic idempotency fingerprints, not full JCS.
export const deterministicJsonSerialize = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => deterministicJsonSerialize(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${deterministicJsonSerialize(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Unsupported JSON value');
};

export const dispatchAtomicCommand = <TState extends AtomicVersionedState, TCommandType extends string, TPayload>(options: {
  readonly envelope: Envelope<TCommandType, TPayload>;
  readonly store: AtomicCommandStore<TState>;
  readonly now: () => Date;
  readonly validatePayload?: (envelope: Envelope<TCommandType, TPayload>) => AnyEngineErrorCode | undefined;
  readonly prepare: (before: TState | undefined, envelope: Envelope<TCommandType, TPayload>) => PreparedResolution<TState>;
}): EngineCommandResult => {
  const { envelope, store } = options;
  const before = store.load(envelope.gameId);
  const beforeVersion = before?.version ?? 0;
  const payloadError = options.validatePayload?.(envelope);
  if (payloadError !== undefined) return rejectedResult(envelope, beforeVersion, payloadError, options.now);
  const identity = `${envelope.gameId}:${envelope.actorContext.actorId}:${envelope.idempotencyKey}`;
  const commandFingerprint = deterministicJsonSerialize({
    commandType: envelope.commandType,
    payloadSchemaVersion: envelope.payloadSchemaVersion,
    payload: envelope.payload,
  });
  const previous = store.idempotencyGet(identity);
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
    status: prepared.status ?? 'RESOLVED',
    gameVersionBefore: beforeVersion,
    gameVersionAfter: prepared.nextState.version,
    resultCode: prepared.resultCode,
    ...(prepared.resultPayload === undefined ? {} : { resultPayload: prepared.resultPayload }),
    emittedEventRefs: prepared.emittedEventRefs,
    adjudicationTraceRefs: prepared.adjudicationTraceRefs ?? [],
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
