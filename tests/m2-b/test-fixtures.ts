import type { M2BCard, M2BState } from '../../packages/domain/src/index.js';

const card = (
  id: string,
  ownerParticipantId: string,
  cardClass: M2BCard['cardClass'] = 'ACTION',
  zone: M2BCard['zone'] = 'HAND',
): M2BCard => ({
  id, definitionId: `DEF-${id}`, ownerParticipantId, controllerParticipantId: ownerParticipantId,
  cardClass, alignment: 'DUAL', zone, returnToOwnerOnDiscard: false,
});

export const m2bState = (): M2BState => ({
  version: 10,
  registryVersion: '0.1',
  participants: {
    P1: { id: 'P1', countryId: 'ARDEN', resources: 6, victoryPoints: 5, cardIds: [], regimeAbilityUsed: false, coreModifierUsed: false },
    P2: { id: 'P2', countryId: 'FLUMA', resources: 5, victoryPoints: 5, cardIds: [], regimeAbilityUsed: false, coreModifierUsed: false },
    P3: { id: 'P3', countryId: 'URSARIA', resources: 3, victoryPoints: 2, cardIds: [], regimeAbilityUsed: false, coreModifierUsed: false },
    P4: { id: 'P4', countryId: 'PRESQUE', resources: 3, victoryPoints: 1, cardIds: [], regimeAbilityUsed: false, coreModifierUsed: false },
    P5: { id: 'P5', countryId: 'DINESIA', resources: 4, victoryPoints: 0, cardIds: [], regimeAbilityUsed: false, coreModifierUsed: false },
  },
  cards: {
    A1: card('A1', 'P1'), A2: card('A2', 'P1'), A3: card('A3', 'P1'),
    S1: card('S1', 'P1', 'STARTER'), S2: card('S2', 'P2', 'STARTER'),
    C1: card('C1', 'P1', 'CAMPAIGN', 'CAMPAIGN'), C2: card('C2', 'P1', 'CAMPAIGN', 'CAMPAIGN'),
    R1: card('R1', 'P1', 'CAMPAIGN'),
    P2A: card('P2A', 'P2'), P2B: card('P2B', 'P2'), P2C: card('P2C', 'P2'), P2D: card('P2D', 'P2'),
  },
  campaigns: { CAM1: { id: 'CAM1', ownerParticipantId: 'P1', row: 'I', cardIds: ['C1', 'C2'], activationCountThisTurn: 1 } },
  influence: [
    { pdId: 'ARDEN_PD_1', type: 'MALIGN', attributionCountryId: 'P2', count: 1 },
    { pdId: 'FLUMA_PD_1', type: 'RESILIENCY', attributionCountryId: 'P2', count: 1 },
  ],
  legitimacyByPd: { ARDEN_PD_1: null, ARDEN_PD_2: 'P1', ARDEN_PD_3: 'P1', FLUMA_PD_1: 'P1', PRESQUE_PD_1: 'P2' },
  scheduler: { participantIndex: 0, slotIndex: 0, status: 'READY' },
  audit: [],
});
