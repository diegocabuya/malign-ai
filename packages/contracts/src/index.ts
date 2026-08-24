import { z } from "zod";

export const HealthResponseSchema = z.object({ status: z.literal("ok") });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export type CommandResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    };

export type ActorType = "PLAYER" | "FACILITATOR" | "SYSTEM";
export interface ActorContext {
  readonly actorId: string;
  readonly actorType: ActorType;
  readonly participantId?: string;
  readonly playerSeatId?: string;
  readonly countryId?: string;
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
  readonly causationId?: string;
}

export type EngineErrorCode =
  | "WRONG_PHASE"
  | "NOT_AUTHORIZED"
  | "GAME_PAUSED"
  | "STALE_STATE_VERSION"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_ACTION_PLAN"
  | "GAME_ID_MISMATCH"
  | "INVALID_ACTOR_CONTEXT"
  | "EXTRA_ACTIVATION_NOT_AUTHORIZED"
  | "INSUFFICIENT_AP"
  | "INSUFFICIENT_RESOURCES"
  | "ACTION_PLAN_LOCKED"
  | "ILLEGAL_STATE_TRANSITION"
  | "CARD_NOT_CONTROLLED"
  | "CARD_WRONG_ZONE"
  | "CARD_NOT_ELIGIBLE"
  | "DUPLICATE_CARD_INSTANCE"
  | "CAMPAIGN_ROW_OCCUPIED"
  | "CAMPAIGN_NOT_FOUND"
  | "CAMPAIGN_NOT_OWNED"
  | "CAMPAIGN_ALREADY_ACTIVATED"
  | "CAMPAIGN_INVALID_STRUCTURE"
  | "CAMPAIGN_ALIGNMENT_MISMATCH"
  | "CAMPAIGN_ID_CONFLICT"
  | "INVALID_SLOT"
  | "INVALID_DT"
  | "INVALID_TARGET_PD";

export type SetupEngineErrorCode =
  | "GAME_NOT_FOUND"
  | "GAME_ALREADY_EXISTS"
  | "SETUP_INVALID"
  | "INVALID_TURN_LIMIT"
  | "INVALID_DICE_MODE"
  | "UNSUPPORTED_SCENARIO"
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "UNSUPPORTED_PAYLOAD_VERSION"
  | "INVALID_COMMAND_PAYLOAD"
  | "PARTICIPANT_NOT_FOUND"
  | "PARTICIPANT_ALREADY_EXISTS"
  | "PARTICIPANT_ALREADY_SEATED"
  | "COUNTRY_ALREADY_ASSIGNED"
  | "SEAT_INDEX_ALREADY_ASSIGNED"
  | "CLOCKWISE_INDEX_ALREADY_ASSIGNED"
  | "SEAT_ASSIGNMENT_LOCKED"
  | "STRATEGY_DECK_SIZE_INVALID"
  | "STRATEGY_DECK_NOT_SUBMITTED"
  | "STRATEGY_ALREADY_LOCKED"
  | "RANDOM_PROVIDER_FAILURE"
  | "INITIATIVE_ALREADY_RESOLVED"
  | "INITIATIVE_NOT_RESOLVED"
  | "INITIATIVE_MAINTENANCE_NOT_SET"
  | "INITIATIVE_MAINTENANCE_ALREADY_LOCKED"
  | "INVALID_MAINTENANCE_SELECTION"
  | "ACTION_PLAN_NOT_FOUND"
  | "NO_ACTION_TO_REVEAL";

export type AnyEngineErrorCode = EngineErrorCode | SetupEngineErrorCode;

export type EngineErrorCategory =
  | "AUTHORIZATION"
  | "PHASE_STATE"
  | "CONCURRENCY"
  | "RESOURCE"
  | "CARD"
  | "CAMPAIGN"
  | "TARGETING"
  | "RULE_INVARIANT"
  | "CONTRACT";
export interface EngineError {
  readonly code: AnyEngineErrorCode;
  readonly category: EngineErrorCategory;
  readonly retryable: boolean;
  readonly safeMessageKey: string;
}

export type EngineCommandStatus = "RESOLVED" | "REJECTED";
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

export const engineErrorFor = (code: AnyEngineErrorCode): EngineError => {
  let category: EngineErrorCategory = "PHASE_STATE";
  if (code === "STALE_STATE_VERSION" || code === "IDEMPOTENCY_KEY_REUSED")
    category = "CONCURRENCY";
  else if (
    code === "NOT_AUTHORIZED" ||
    code === "INVALID_ACTOR_CONTEXT" ||
    code === "PARTICIPANT_NOT_FOUND"
  )
    category = "AUTHORIZATION";
  else if (code === "INSUFFICIENT_AP" || code === "INSUFFICIENT_RESOURCES")
    category = "RESOURCE";
  else if (
    code.startsWith("CARD_") ||
    code.startsWith("STRATEGY_") ||
    code === "DUPLICATE_CARD_INSTANCE"
  )
    category = "CARD";
  else if (code.startsWith("INVALID_DT") || code.startsWith("INVALID_TARGET"))
    category = "TARGETING";
  else if (code.startsWith("CAMPAIGN_") || code === "INVALID_SLOT")
    category = "CAMPAIGN";
  else if (
    code.startsWith("UNSUPPORTED_") ||
    code === "INVALID_COMMAND_PAYLOAD"
  )
    category = "CONTRACT";
  else if (code === "INVALID_MAINTENANCE_SELECTION") category = "CARD";
  else if (
    code.includes("ALREADY_ASSIGNED") ||
    code.includes("ALREADY_SEATED") ||
    code === "PARTICIPANT_ALREADY_EXISTS" ||
    code === "SETUP_INVALID"
  )
    category = "RULE_INVARIANT";
  return {
    code,
    category,
    retryable: code === "STALE_STATE_VERSION",
    safeMessageKey: `engine.error.${code.toLowerCase()}`,
  };
};
