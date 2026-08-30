export type ReactionWindowStatus = 'OPEN' | 'WAITING_FOR_PRIORITY_PLAYER' | 'RESOLVING_REACTION' | 'CHILD_WINDOW' | 'CLOSED';
export type ReactionTrigger = 'DOUBLE_AGENT' | 'CORRUPTION' | 'CYBERATTACK' | 'HACK_BACK' | 'PRE_ROLL' | 'NARRATIVE' | 'LEAKS_DRAWN';

export interface ReactionWindowState {
  readonly id: string;
  readonly version: 1;
  readonly trigger: ReactionTrigger;
  readonly triggeringParticipantId: string;
  readonly priorityParticipantIds: readonly string[];
  priorityIndex: number;
  status: ReactionWindowStatus;
  readonly parentWindowId?: string;
  readonly expiresAt: null;
  readonly passes: string[];
  readonly plays: ReactionPlayRecord[];
}

export interface ReactionPlayRecord {
  readonly participantId: string;
  readonly cardId: string;
  readonly effectId: string;
  readonly outcome: 'NEGATED' | 'FAILED' | 'PENDING_CHILD' | 'VOTE_PENDING';
}

export interface ReactionContinuation {
  readonly kind: 'REACTION';
  readonly schemaVersion: 1;
  readonly id: string;
  readonly gameVersion: number;
  readonly window: ReactionWindowState;
  readonly parent?: ReactionContinuation;
}

export interface NarrativeResolution {
  readonly accepted: boolean;
  readonly blocked: boolean;
  readonly sentenceCount: number;
  readonly discardedCardIds: readonly string[];
  readonly reason: 'ACCEPTED' | 'TOO_SHORT' | 'TOO_LONG_PENALTY' | 'READING_PENALTY' | 'FACILITATOR_OVERRIDE';
}

export interface VetoResolution {
  readonly rejectedCampaign: boolean;
  readonly unacceptable: number;
  readonly activePlayers: number;
}

export type ReactionCommandError =
  | 'REACTION_WINDOW_CLOSED'
  | 'REACTION_NOT_ELIGIBLE'
  | 'REACTION_NOT_PRIORITY'
  | 'VETO_ABUSE'
  | 'STALE_CONTINUATION'
  | 'INVALID_REACTION_INPUT';
