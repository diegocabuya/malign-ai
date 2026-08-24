import type { CommandEnvelope, EngineCommandResult, EngineErrorCode } from '@malign-ai/contracts';
import { calculateCampaignValue, type AssignedCampaignComponent } from '@malign-ai/rules';
import type { ActivateCampaignPayload, CampaignState, ConstructCampaignPayload, GameCommandPayload, GameCommandType, GameEvent, GameState, ModifyCampaignPayload, SetActionPlanPayload } from './model.js';
import { dispatchAtomicCommand, InMemoryAtomicStateStore } from './atomic-dispatch.js';

type Envelope = CommandEnvelope<GameCommandType, GameCommandPayload>;

export class InMemoryGameStore extends InMemoryAtomicStateStore<GameState> {
  readonly #gameId: string;
  constructor(initialState: GameState) { super([initialState]); this.#gameId = initialState.id; }
  override load(gameId: string): GameState | undefined { void gameId; return super.load(this.#gameId); }
  snapshot(): GameState { const state = super.load(this.#gameId); if (state === undefined) throw new Error('Game state missing'); return state; }
  commit(expectedVersion: number, next: GameState): boolean { return super.commitState(this.#gameId, expectedVersion, next); }
}

export class CommandDispatcher {
  constructor(private readonly store: InMemoryGameStore, private readonly now: () => Date) {}

  dispatch(envelope: Envelope): EngineCommandResult {
    return dispatchAtomicCommand({
      envelope,
      store: this.store,
      now: this.now,
      prepare: (loaded, candidate) => {
        const before = loaded ?? this.store.snapshot();
        if (candidate.gameId !== before.id) return { error: 'GAME_ID_MISMATCH' as const, version: before.version };
        if (candidate.actorContext.actorType !== 'PLAYER' || candidate.actorContext.participantId === undefined || before.participants[candidate.actorContext.participantId] === undefined) return { error: 'INVALID_ACTOR_CONTEXT' as const, version: before.version };
        if (candidate.expectedGameVersion !== before.version) return { error: 'STALE_STATE_VERSION' as const, version: before.version };
        if (before.overlay === 'PAUSED') return { error: 'GAME_PAUSED' as const, version: before.version };
        const working = structuredClone(before);
        const outcome = this.reduce(working, candidate);
        if ('error' in outcome) return { error: outcome.error, version: before.version };
        return {
          nextState: working,
          resultCode: outcome.code,
          ...(outcome.payload === undefined ? {} : { resultPayload: outcome.payload }),
          emittedEventRefs: outcome.events.map(({ id }) => id),
        };
      },
    });
  }

  #actorParticipant(state: GameState, envelope: Envelope) {
    const participantId = envelope.actorContext.participantId;
    return participantId === undefined ? undefined : state.participants[participantId];
  }

  reduce(state: GameState, envelope: Envelope): { code: string; payload?: unknown; events: GameEvent[] } | { error: EngineErrorCode } {
    if (envelope.commandType === 'END_GAME_SCORING') return { error: 'ILLEGAL_STATE_TRANSITION' };
    if (envelope.commandType === 'ACTIVATE_CAMPAIGN' ? state.phase !== 'RESOLUTION_STAGE' : state.phase !== 'ACTION_STAGE_PLAN') return { error: 'WRONG_PHASE' };
    const participant = this.#actorParticipant(state, envelope);
    if (participant === undefined) return { error: 'NOT_AUTHORIZED' };

    if (envelope.commandType === 'SET_ACTION_PLAN') {
      if (participant.planStatus === 'LOCKED') return { error: 'ACTION_PLAN_LOCKED' };
      const actionSlots = (envelope.payload as SetActionPlanPayload).actionSlots;
      if (!this.validActionPlan(actionSlots)) return { error: 'INVALID_ACTION_PLAN' };
      participant.plan = [...actionSlots];
      return { code: 'ACTION_PLAN_SET', events: [] };
    }
    if (envelope.commandType === 'LOCK_ACTION_PLAN') {
      if (participant.planStatus === 'LOCKED') return { error: 'ACTION_PLAN_LOCKED' };
      const apCost = participant.plan.reduce((sum, slot) => sum + slot.apCost, 0);
      if (participant.plan.length > 3 || apCost > participant.actionPointsAvailable) return { error: 'INSUFFICIENT_AP' };
      if (!this.validActionPlan(participant.plan)) return { error: 'INVALID_ACTION_PLAN' };
      participant.actionPointsAvailable -= apCost;
      participant.planStatus = 'LOCKED';
      const events: GameEvent[] = [{ id: `${envelope.commandId}:plan-locked`, type: 'ACTION_PLAN_LOCKED' }, { id: `${envelope.commandId}:ap`, type: 'AP_COMMITTED' }];
      state.events.push(...events);
      return { code: 'ACTION_PLAN_LOCKED', events };
    }
    if (envelope.commandType === 'CONSTRUCT_CAMPAIGN') return this.construct(state, participant.id, envelope, envelope.payload as ConstructCampaignPayload);
    if (envelope.commandType === 'MODIFY_CAMPAIGN') return this.modify(state, participant.id, envelope, envelope.payload as ModifyCampaignPayload);
    return this.activate(state, participant.id, envelope, envelope.payload as ActivateCampaignPayload);
  }

  private controlledCard(state: GameState, participantId: string, cardId: string) {
    const card = state.cards[cardId];
    return card?.controllerParticipantId === participantId && card.zone === 'HAND' ? card : undefined;
  }

  private validActionPlan(actionSlots: readonly SetActionPlanPayload['actionSlots'][number][]): boolean {
    if (actionSlots.length > 3) return false;
    const sequenceIndexes = actionSlots.map(({ sequenceIndex }) => sequenceIndex);
    return actionSlots.every((slot, index) => Number.isInteger(slot.apCost) && Number.isFinite(slot.apCost) && slot.apCost === 1 && Number.isInteger(slot.sequenceIndex) && slot.sequenceIndex === index + 1) && new Set(sequenceIndexes).size === sequenceIndexes.length;
  }

  private construct(state: GameState, participantId: string, envelope: Envelope, payload: ConstructCampaignPayload) {
    if (state.campaigns[payload.campaignId] !== undefined) return { error: 'CAMPAIGN_ID_CONFLICT' as const };
    if (Object.values(state.campaigns).some((campaign) => campaign.ownerParticipantId === participantId && campaign.row === 'I')) return { error: 'CAMPAIGN_ROW_OCCUPIED' as const };
    if (payload.methodCardInstanceId === undefined) return { error: 'CAMPAIGN_INVALID_STRUCTURE' as const };
    const ids = [payload.intentCardInstanceId, payload.methodCardInstanceId, ...(payload.amplifierCardInstanceId === undefined ? [] : [payload.amplifierCardInstanceId])];
    if (new Set(ids).size !== ids.length) return { error: 'DUPLICATE_CARD_INSTANCE' as const };
    const cards = ids.map((id) => this.controlledCard(state, participantId, id));
    if (cards.some((card) => card === undefined)) return { error: 'CARD_NOT_CONTROLLED' as const };
    const [intent, method, amplifier] = cards;
    if (intent === undefined || method === undefined) return { error: 'CAMPAIGN_INVALID_STRUCTURE' as const };
    const intentDefinition = state.cardDefinitions[intent.definitionId];
    const methodDefinition = state.cardDefinitions[method.definitionId];
    const amplifierDefinition = amplifier === undefined ? undefined : state.cardDefinitions[amplifier.definitionId];
    if (intentDefinition === undefined || methodDefinition === undefined || intentDefinition.targetDtId !== payload.targetDtId) return { error: 'INVALID_DT' as const };
    if (intentDefinition.influenceValueBySlot.INTENT === undefined || methodDefinition.influenceValueBySlot.METHOD === undefined || (amplifierDefinition !== undefined && amplifierDefinition.influenceValueBySlot.AMPLIFIER === undefined)) return { error: 'CARD_NOT_ELIGIBLE' as const };
    const alignment = intentDefinition.alignment;
    if (alignment === 'DUAL') return { error: 'CAMPAIGN_ALIGNMENT_MISMATCH' as const };
    const compatible = [methodDefinition, amplifierDefinition].filter((definition) => definition !== undefined).every((definition) => definition.alignment === 'DUAL' || definition.alignment === alignment);
    if (!compatible) return { error: 'CAMPAIGN_ALIGNMENT_MISMATCH' as const };
    const assignments = [{ slot: 'INTENT' as const, cardInstanceId: intent.id }, { slot: 'METHOD' as const, cardInstanceId: method.id }, ...(amplifier === undefined ? [] : [{ slot: 'AMPLIFIER' as const, cardInstanceId: amplifier.id }])];
    for (const card of cards) if (card !== undefined) card.zone = 'CAMPAIGN';
    const campaign: CampaignState = { id: payload.campaignId, ownerParticipantId: participantId, row: 'I', alignment, targetDtId: payload.targetDtId, assignments, activatedCountThisTurn: 0 };
    state.campaigns[campaign.id] = campaign;
    const event: GameEvent = { id: `${envelope.commandId}:campaign-created`, type: 'CAMPAIGN_CREATED' }; state.events.push(event);
    return { code: 'CAMPAIGN_CREATED', payload: campaign, events: [event] };
  }

  private modify(state: GameState, participantId: string, envelope: Envelope, payload: ModifyCampaignPayload) {
    const campaign = state.campaigns[payload.campaignId];
    if (campaign === undefined) return { error: 'CAMPAIGN_NOT_FOUND' as const };
    if (campaign.ownerParticipantId !== participantId) return { error: 'CAMPAIGN_NOT_OWNED' as const };
    if (payload.slot === 'INTENT') return { error: 'INVALID_SLOT' as const };
    const replacement = this.controlledCard(state, participantId, payload.replacementCardInstanceId);
    if (replacement === undefined) return { error: 'CARD_NOT_CONTROLLED' as const };
    const definition = state.cardDefinitions[replacement.definitionId];
    if (definition === undefined || (definition.alignment !== 'DUAL' && definition.alignment !== campaign.alignment)) return { error: 'CAMPAIGN_ALIGNMENT_MISMATCH' as const };
    if (definition.influenceValueBySlot[payload.slot] === undefined) return { error: 'CARD_NOT_ELIGIBLE' as const };
    const replaced = campaign.assignments.find((assignment) => assignment.slot === payload.slot);
    if (replaced !== undefined) { const old = state.cards[replaced.cardInstanceId]; if (old !== undefined) old.zone = 'DISCARD'; campaign.assignments = campaign.assignments.filter((assignment) => assignment !== replaced); }
    replacement.zone = 'CAMPAIGN'; campaign.assignments.push({ slot: payload.slot, cardInstanceId: replacement.id });
    const event: GameEvent = { id: `${envelope.commandId}:campaign-modified`, type: 'CAMPAIGN_MODIFIED' }; state.events.push(event);
    return { code: 'CAMPAIGN_MODIFIED', events: [event] };
  }

  private activate(state: GameState, participantId: string, envelope: Envelope, payload: ActivateCampaignPayload) {
    if ('extraActivation' in payload) return { error: 'EXTRA_ACTIVATION_NOT_AUTHORIZED' as const };
    const campaign = state.campaigns[payload.campaignId];
    if (campaign === undefined) return { error: 'CAMPAIGN_NOT_FOUND' as const };
    if (campaign.ownerParticipantId !== participantId) return { error: 'CAMPAIGN_NOT_OWNED' as const };
    if (campaign.activatedCountThisTurn > 0) return { error: 'CAMPAIGN_ALREADY_ACTIVATED' as const };
    const pd = state.populationDemographics[payload.requestedTargetPdId];
    if (pd === undefined) return { error: 'INVALID_TARGET_PD' as const };
    if (!pd.demographicTokenIds.includes(campaign.targetDtId)) return { error: 'INVALID_DT' as const };
    const components: AssignedCampaignComponent[] = campaign.assignments.map((assignment) => {
      const card = state.cards[assignment.cardInstanceId]; const definition = card === undefined ? undefined : state.cardDefinitions[card.definitionId];
      if (definition === undefined) throw new Error('Campaign references missing card definition');
      return { slot: assignment.slot, influenceValueBySlot: definition.influenceValueBySlot };
    });
    const definitionIds = campaign.assignments.map((assignment) => state.cards[assignment.cardInstanceId]?.definitionId).filter((id): id is string => id !== undefined);
    const hasPair = definitionIds.some((id) => { const pair = state.cardDefinitions[id]?.pairBonusWith; return pair !== undefined && definitionIds.includes(pair); });
    const cv = calculateCampaignValue(components, hasPair ? [2] : []);
    const participant = state.participants[participantId]; if (participant === undefined) return { error: 'NOT_AUTHORIZED' as const };
    if (participant.resources < cv.baseCost) return { error: 'INSUFFICIENT_RESOURCES' as const };
    participant.resources -= cv.baseCost; campaign.activatedCountThisTurn += 1;
    const event: GameEvent = { id: `${envelope.commandId}:campaign-activated`, type: 'CAMPAIGN_ACTIVATED' }; state.events.push(event);
    return { code: 'CAMPAIGN_ACTIVATED', payload: cv, events: [event] };
  }

}
