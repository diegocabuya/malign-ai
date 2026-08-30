import type {
  M2BState,
  NarrativeResolution,
  ReactionCommandError,
  ReactionContinuation,
  ReactionTrigger,
  ReactionWindowState,
  VetoResolution,
} from '@malign-ai/domain';
import { discardCampaign, discardWithLifecycle } from './m2b.js';

const reactionEffects: Readonly<Record<string, ReactionTrigger>> = {
  CARD_EFFECT_BASE_2025_E010: 'HACK_BACK',
  CARD_EFFECT_BASE_2025_E012: 'DOUBLE_AGENT',
  CARD_EFFECT_BASE_2025_E022: 'CYBERATTACK',
  CARD_EFFECT_BASE_2025_E036: 'CORRUPTION',
  CARD_EFFECT_BASE_2025_E040: 'PRE_ROLL',
  CARD_EFFECT_BASE_2025_E048: 'NARRATIVE',
  CARD_EFFECT_BASE_2025_E054: 'LEAKS_DRAWN',
};

export const reactionPriority = (initiative: readonly string[], actorId: string): readonly string[] => {
  const actorIndex = initiative.indexOf(actorId);
  if (actorIndex < 0) return [];
  return [...initiative.slice(actorIndex + 1), ...initiative.slice(0, actorIndex)];
};

export const openReactionWindow = (
  id: string,
  trigger: ReactionTrigger,
  actorId: string,
  initiative: readonly string[],
  parentWindowId?: string,
): ReactionWindowState => ({
  id, version: 1, trigger, triggeringParticipantId: actorId,
  priorityParticipantIds: reactionPriority(initiative, actorId), priorityIndex: 0,
  status: 'WAITING_FOR_PRIORITY_PLAYER', ...(parentWindowId === undefined ? {} : { parentWindowId }),
  expiresAt: null, passes: [], plays: [],
});

export const passReactionPriority = (window: ReactionWindowState, participantId: string): ReactionCommandError | undefined => {
  if (window.status === 'CLOSED') return 'REACTION_WINDOW_CLOSED';
  if (window.priorityParticipantIds[window.priorityIndex] !== participantId) return 'REACTION_NOT_PRIORITY';
  window.passes.push(participantId); window.priorityIndex += 1;
  if (window.priorityIndex >= window.priorityParticipantIds.length) window.status = 'CLOSED';
  return undefined;
};

export interface PlayReactionInput {
  readonly participantId: string;
  readonly cardId: string;
  readonly effectId: string;
  readonly roll?: number;
  readonly vetoAbuse?: boolean;
}

export const playReaction = (
  state: M2BState,
  window: ReactionWindowState,
  input: PlayReactionInput,
): { readonly error?: ReactionCommandError; readonly negated?: boolean; readonly child?: ReactionWindowState } => {
  if (window.status === 'CLOSED') return { error: 'REACTION_WINDOW_CLOSED' };
  if (window.priorityParticipantIds[window.priorityIndex] !== input.participantId) return { error: 'REACTION_NOT_PRIORITY' };
  const card = state.cards[input.cardId];
  if (card?.zone !== 'HAND' || card.controllerParticipantId !== input.participantId || reactionEffects[input.effectId] !== window.trigger) return { error: 'REACTION_NOT_ELIGIBLE' };
  if (input.effectId === 'CARD_EFFECT_BASE_2025_E048' && input.vetoAbuse) return { error: 'VETO_ABUSE' };
  const rolled = input.roll;
  if ((input.effectId === 'CARD_EFFECT_BASE_2025_E036' || input.effectId === 'CARD_EFFECT_BASE_2025_E040') && (!Number.isInteger(rolled) || rolled! < 1 || rolled! > 10)) return { error: 'INVALID_REACTION_INPUT' };
  discardWithLifecycle(state, input.cardId);
  const success = input.effectId === 'CARD_EFFECT_BASE_2025_E036' || input.effectId === 'CARD_EFFECT_BASE_2025_E040' ? rolled! <= 4 : true;
  const child = input.effectId === 'CARD_EFFECT_BASE_2025_E022'
    ? openReactionWindow(`${window.id}:child`, 'HACK_BACK', input.participantId, [input.participantId, window.triggeringParticipantId], window.id)
    : undefined;
  window.plays.push({ participantId: input.participantId, cardId: input.cardId, effectId: input.effectId, outcome: child ? 'PENDING_CHILD' : input.effectId === 'CARD_EFFECT_BASE_2025_E048' ? 'VOTE_PENDING' : success ? 'NEGATED' : 'FAILED' });
  window.status = child ? 'CHILD_WINDOW' : 'CLOSED';
  return { negated: success, ...(child === undefined ? {} : { child }) };
};

const sentenceCount = (text: string): number => text.split(/[.!?]+/u).map((part) => part.trim()).filter(Boolean).length;
const eligibleHand = (state: M2BState, participantId: string) => Object.values(state.cards)
  .filter((card) => card.controllerParticipantId === participantId && card.zone === 'HAND')
  .sort((left, right) => left.id.localeCompare(right.id));

export const resolveNarrative = (
  state: M2BState,
  participantId: string,
  text: string,
  randomPositions: readonly number[] = [],
  options: { readonly facilitatorOverride?: boolean; readonly confirmedReading?: boolean } = {},
): NarrativeResolution => {
  const count = sentenceCount(text);
  if (count < 2 && !options.facilitatorOverride) return { accepted: false, blocked: true, sentenceCount: count, discardedCardIds: [], reason: 'TOO_SHORT' };
  const discardCount = options.confirmedReading ? Math.min(2, eligibleHand(state, participantId).length) : count > 3 ? Math.min(1, eligibleHand(state, participantId).length) : 0;
  const cards = eligibleHand(state, participantId); const discarded: string[] = [];
  for (let index = 0; index < discardCount; index += 1) {
    const card = cards[randomPositions[index] ?? 0]; if (card !== undefined && !discarded.includes(card.id)) { discardWithLifecycle(state, card.id); discarded.push(card.id); }
  }
  const reason = options.facilitatorOverride ? 'FACILITATOR_OVERRIDE' : options.confirmedReading ? 'READING_PENALTY' : count > 3 ? 'TOO_LONG_PENALTY' : 'ACCEPTED';
  return { accepted: true, blocked: false, sentenceCount: count, discardedCardIds: discarded, reason };
};

export const resolveVeto = (votes: Readonly<Record<string, 'ACCEPTABLE' | 'UNACCEPTABLE'>>): VetoResolution => {
  const values = Object.values(votes); const unacceptable = values.filter((vote) => vote === 'UNACCEPTABLE').length;
  return { rejectedCampaign: unacceptable > values.length / 2, unacceptable, activePlayers: values.length };
};

export const applyVeto = (state: M2BState, campaignId: string, vetoCardId: string, result: VetoResolution): ReactionCommandError | undefined => {
  const veto = state.cards[vetoCardId]; if (veto?.zone !== 'HAND') return 'REACTION_NOT_ELIGIBLE';
  veto.zone = 'REMOVED_FROM_GAME';
  if (result.rejectedCampaign) discardCampaign(state, campaignId);
  return undefined;
};

export const makeReactionContinuation = (id: string, gameVersion: number, window: ReactionWindowState, parent?: ReactionContinuation): ReactionContinuation => ({
  kind: 'REACTION', schemaVersion: 1, id, gameVersion, window: structuredClone(window), ...(parent === undefined ? {} : { parent }),
});

export const projectReactionWindow = (window: ReactionWindowState, viewerId: string, facilitator: boolean) => ({
  id: window.id, status: window.status, currentActor: window.priorityParticipantIds[window.priorityIndex] ?? null,
  ...(facilitator || window.priorityParticipantIds[window.priorityIndex] === viewerId ? { options: ['PASS', 'PLAY_REACTION'] as const } : {}),
});
