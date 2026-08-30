import { z } from 'zod';

import { RealtimeCursorSchema } from './realtime-v1.js';

const id = z.string().min(1).max(160);

export const HttpCommandRequestSchema = z.object({
  engineContractVersion: id,
  commandId: id,
  idempotencyKey: id,
  gameId: id,
  expectedGameVersion: z.number().int().nonnegative().finite(),
  commandType: z.enum([
    'JOIN_GAME_MEMBERSHIP',
    'ASSIGN_PLAYER_SEAT',
    'CONFIGURE_GAME_OPTION',
    'START_GAME',
    'PAUSE_GAME',
    'RESUME_GAME',
    'SUBMIT_OPERATIONS_DECK',
    'LOCK_STRATEGY',
    'REQUEST_INITIATIVE_ROLL',
    'SET_INITIATIVE_MAINTENANCE',
    'LOCK_INITIATIVE_MAINTENANCE',
    'SET_ACTION_PLAN',
    'LOCK_ACTION_PLAN',
    'CONSTRUCT_CAMPAIGN',
    'END_GAME_SCORING',
    'SUBMIT_CHOICE',
    'SUBMIT_CAMPAIGN_NARRATIVE',
  ]),
  payloadSchemaVersion: id,
  payload: z.unknown(),
  correlationId: id.optional(),
  causationId: id.optional(),
}).strict();

export const HttpProjectionRequestSchema = z.object({ gameId: id }).strict();
export const HttpFeedRequestSchema = z.object({ gameId: id, afterCursor: RealtimeCursorSchema }).strict();

export type HttpCommandRequest = z.infer<typeof HttpCommandRequestSchema>;
