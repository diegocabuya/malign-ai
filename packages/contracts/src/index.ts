import { z } from 'zod';

export const HealthResponseSchema = z.object({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export type CommandResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export type ActorType = 'PLAYER' | 'FACILITATOR' | 'SYSTEM';
export interface ActorContext {
  readonly actorId: string;
  readonly actorType: ActorType;
  readonly participantId?: string;
  readonly authenticatedSessionId: string;
  readonly permissions: readonly string[];
}

export interface CommandEnvelope<TCommandType extends string, TPayload> {
  readonly engineContractVersion: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly gameId: string;
  readonly actorContext: ActorContext;
  readonly expectedGameVersion: number;
  readonly commandType: TCommandType;
  readonly payloadSchemaVersion: string;
  readonly payload: TPayload;
  readonly correlationId?: string;
}

export type EngineErrorCode =
  | 'WRONG_PHASE'
  | 'NOT_AUTHORIZED'
  | 'GAME_PAUSED'
  | 'STALE_STATE_VERSION'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INVALID_ACTION_PLAN'
  | 'GAME_ID_MISMATCH'
  | 'INVALID_ACTOR_CONTEXT'
  | 'EXTRA_ACTIVATION_NOT_AUTHORIZED'
  | 'INSUFFICIENT_AP'
  | 'INSUFFICIENT_RESOURCES'
  | 'ACTION_PLAN_LOCKED'
  | 'ILLEGAL_STATE_TRANSITION'
  | 'CARD_NOT_CONTROLLED'
  | 'CARD_WRONG_ZONE'
  | 'CARD_NOT_ELIGIBLE'
  | 'DUPLICATE_CARD_INSTANCE'
  | 'CAMPAIGN_ROW_OCCUPIED'
  | 'CAMPAIGN_NOT_FOUND'
  | 'CAMPAIGN_NOT_OWNED'
  | 'CAMPAIGN_ALREADY_ACTIVATED'
  | 'CAMPAIGN_INVALID_STRUCTURE'
  | 'CAMPAIGN_ALIGNMENT_MISMATCH'
  | 'CAMPAIGN_ID_CONFLICT'
  | 'INVALID_SLOT'
  | 'INVALID_DT'
  | 'INVALID_TARGET_PD';

export type EngineErrorCategory = 'AUTHORIZATION' | 'PHASE_STATE' | 'CONCURRENCY' | 'RESOURCE' | 'CARD' | 'CAMPAIGN' | 'TARGETING' | 'RULE_INVARIANT';
export interface EngineError {
  readonly code: EngineErrorCode;
  readonly category: EngineErrorCategory;
  readonly retryable: boolean;
  readonly safeMessageKey: string;
}

export type EngineCommandStatus = 'RESOLVED' | 'REJECTED';
export interface EngineCommandResult<TPayload = unknown> {
  readonly commandId: string;
  readonly gameId: string;
  readonly status: EngineCommandStatus;
  readonly gameVersionBefore: number;
  readonly gameVersionAfter: number;
  readonly resultCode: string;
  readonly resultPayload?: TPayload;
  readonly emittedEventRefs: readonly string[];
  readonly adjudicationTraceRefs: readonly string[];
  readonly error?: EngineError;
  readonly resolvedAt: string;
}
