import { z } from 'zod';

export const MALIGN_REALTIME_PROTOCOL = 'malign.realtime.v1' as const;
export const MALIGN_REALTIME_SCHEMA_VERSION = '1' as const;

const opaqueId = z.string().min(1).max(160);
const safeInteger = z.number().int().nonnegative().finite();

export const RealtimeCursorSchema = z.object({
  gameId: opaqueId,
  viewerParticipantId: opaqueId,
  viewerRole: z.enum(['PLAYER', 'FACILITATOR']),
  projectionId: opaqueId,
  gameVersion: safeInteger,
  lastSequenceNumber: safeInteger,
}).strict();

export type RealtimeCursorV1 = z.infer<typeof RealtimeCursorSchema>;

const base = {
  protocolVersion: z.literal(MALIGN_REALTIME_PROTOCOL),
  schemaVersion: z.literal(MALIGN_REALTIME_SCHEMA_VERSION),
  messageId: opaqueId,
  correlationId: opaqueId,
};

export const AuthenticateFrameSchema = z.object({
  ...base,
  type: z.literal('AUTHENTICATE'),
  payload: z.object({ accessToken: z.string().min(1).max(16_384) }).strict(),
}).strict();

export const SubscribeFrameSchema = z.object({
  ...base,
  type: z.literal('SUBSCRIBE'),
  gameId: opaqueId,
  payload: z.object({ afterCursor: RealtimeCursorSchema.optional() }).strict(),
}).strict();

export const AckFrameSchema = z.object({
  ...base,
  type: z.literal('ACK'),
  gameId: opaqueId,
  subscriptionId: opaqueId,
  payload: z.object({ cursor: RealtimeCursorSchema }).strict(),
}).strict();

export const ResyncRequestFrameSchema = z.object({
  ...base,
  type: z.literal('RESYNC_REQUEST'),
  gameId: opaqueId,
  subscriptionId: opaqueId,
  payload: z.object({ afterCursor: RealtimeCursorSchema }).strict(),
}).strict();

export const UnsubscribeFrameSchema = z.object({
  ...base,
  type: z.literal('UNSUBSCRIBE'),
  gameId: opaqueId,
  subscriptionId: opaqueId,
  payload: z.object({}).strict(),
}).strict();

export const RealtimeClientFrameSchema = z.discriminatedUnion('type', [
  AuthenticateFrameSchema,
  SubscribeFrameSchema,
  AckFrameSchema,
  ResyncRequestFrameSchema,
  UnsubscribeFrameSchema,
]);

export type RealtimeClientFrame = z.infer<typeof RealtimeClientFrameSchema>;
export type RealtimeClientFrameType = RealtimeClientFrame['type'];

export type RealtimeServerFrameType =
  | 'AUTHENTICATED'
  | 'SYNC'
  | 'EVENT_BATCH'
  | 'GAP_DETECTED'
  | 'RESYNC_REQUIRED'
  | 'DRAINING'
  | 'ERROR';

export interface RealtimeServerFrame<TPayload = unknown> {
  readonly protocolVersion: typeof MALIGN_REALTIME_PROTOCOL;
  readonly schemaVersion: typeof MALIGN_REALTIME_SCHEMA_VERSION;
  readonly messageId: string;
  readonly correlationId: string;
  readonly type: RealtimeServerFrameType;
  readonly gameId?: string;
  readonly subscriptionId?: string;
  readonly payload: TPayload;
}

export const parseRealtimeClientFrame = (value: unknown): RealtimeClientFrame =>
  RealtimeClientFrameSchema.parse(value);
