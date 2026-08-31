import type { M2BCard, M2BState, SetupGameState } from '@malign-ai/domain';

const cardClass = (state: SetupGameState, cardId: string): M2BCard['cardClass'] => {
  if (Object.values(state.adjudication.campaigns).some(({ assignments }) => assignments.some(({ cardInstanceId }) => cardInstanceId === cardId))) return 'CAMPAIGN';
  return state.cardDefinitions[state.cards[cardId]?.definitionId ?? '']?.starter === true ? 'STARTER' : 'ACTION';
};

export const buildM2StateFromCanonical = (state: SetupGameState): M2BState => ({
  version: state.version,
  registryVersion: '0.1',
  participants: Object.fromEntries(Object.values(state.participants).filter(({ role }) => role === 'PLAYER').map((participant) => {
    const seat = state.seats[participant.id];
    if (seat === undefined) throw new Error(`M2 integration requires a seat for ${participant.id}`);
    return [participant.id, {
      id: participant.id, countryId: seat.countryId, resources: state.countries[seat.countryId].resources,
      victoryPoints: state.adjudication.vpByParticipant[participant.id] ?? 0,
      cardIds: Object.values(state.cards).filter(({ controllerParticipantId }) => controllerParticipantId === participant.id).map(({ id }) => id).sort(),
      regimeAbilityUsed: false, coreModifierUsed: false,
    }];
  })),
  cards: Object.fromEntries(Object.values(state.cards).filter(({ controllerParticipantId }) => controllerParticipantId !== undefined).map((card) => [card.id, {
    id: card.id, definitionId: card.definitionId, ownerParticipantId: state.countries[card.countryOwnerId].controllerParticipantId ?? card.controllerParticipantId!,
    controllerParticipantId: card.controllerParticipantId!, cardClass: cardClass(state, card.id), alignment: 'DUAL',
    zone: card.zone === 'OPERATIONS_DECK' || card.zone === 'OPERATIONS_POOL' || card.zone === 'STARTER_POOL' ? 'DECK' : card.zone,
    returnToOwnerOnDiscard: card.returnToOwnerOnDiscard ?? false,
  }])),
  campaigns: Object.fromEntries(Object.values(state.adjudication.campaigns).map((campaign) => [campaign.id, {
    id: campaign.id, ownerParticipantId: campaign.ownerParticipantId, row: campaign.row,
    cardIds: campaign.assignments.map(({ cardInstanceId }) => cardInstanceId), activationCountThisTurn: campaign.activationCountThisTurn,
    ...(campaign.targetDtId === undefined ? {} : { targetDtId: campaign.targetDtId }),
  }])),
  influence: structuredClone(state.adjudication.influenceStacks),
  legitimacyByPd: structuredClone(state.adjudication.legitimacyByPd),
  scheduler: structuredClone(state.adjudication.scheduler),
  audit: structuredClone(state.m2Audit ?? []),
});

export const applyM2StateToCanonical = (target: SetupGameState, source: M2BState): void => {
  for (const participant of Object.values(source.participants)) {
    target.countries[participant.countryId].resources = participant.resources;
    target.adjudication.vpByParticipant[participant.id] = participant.victoryPoints;
  }
  for (const card of Object.values(source.cards)) {
    const canonical = target.cards[card.id]; if (canonical === undefined) continue;
    canonical.controllerParticipantId = card.controllerParticipantId;
    canonical.returnToOwnerOnDiscard = card.returnToOwnerOnDiscard;
    canonical.zone = card.zone === 'DECK' || card.zone === 'PLANNED_ACTION' ? 'DISCARD' : card.zone;
    for (const strategy of Object.values(target.strategy)) {
      const handIndex = strategy.handCardInstanceIds.indexOf(card.id);
      if (handIndex >= 0) strategy.handCardInstanceIds.splice(handIndex, 1);
      const discardIndex = strategy.discardCardInstanceIds.indexOf(card.id);
      if (discardIndex >= 0) strategy.discardCardInstanceIds.splice(discardIndex, 1);
    }
    const strategy = target.strategy[card.controllerParticipantId];
    if (strategy !== undefined && card.zone === 'HAND' && !strategy.handCardInstanceIds.includes(card.id)) strategy.handCardInstanceIds.push(card.id);
    if (strategy !== undefined && canonical.zone === 'DISCARD' && !strategy.discardCardInstanceIds.includes(card.id)) strategy.discardCardInstanceIds.push(card.id);
  }
  for (const campaignId of Object.keys(target.adjudication.campaigns)) {
    if (source.campaigns[campaignId] === undefined) delete target.adjudication.campaigns[campaignId];
  }
  for (const campaign of Object.values(source.campaigns)) {
    const canonical = target.adjudication.campaigns[campaign.id];
    if (canonical !== undefined) {
      (canonical as { row: 'I' | 'II' }).row = campaign.row;
      canonical.activationCountThisTurn = campaign.activationCountThisTurn;
      if (campaign.targetDtId !== undefined) (canonical as { targetDtId: string }).targetDtId = campaign.targetDtId;
    }
  }
  target.adjudication.influenceStacks.splice(0, target.adjudication.influenceStacks.length, ...structuredClone(source.influence));
  for (const key of Object.keys(target.adjudication.legitimacyByPd)) delete target.adjudication.legitimacyByPd[key];
  Object.assign(target.adjudication.legitimacyByPd, structuredClone(source.legitimacyByPd));
  Object.assign(target.adjudication.scheduler, structuredClone(source.scheduler));
  target.m2Audit = structuredClone(source.audit);
};
