import type {
  CountryId,
  InfluenceType,
  M2BAuditRecord,
  M2BCard,
  M2BEffectContext,
  M2BEffectError,
  M2BEffectResult,
  M2BState,
} from '@malign-ai/domain';
import { resolveTwoToOne } from '@malign-ai/rules';
import { M2_EFFECT_MANIFEST } from './m2-effect-manifest.js';

export type M2BEffectHandler = (state: M2BState, context: M2BEffectContext) => M2BEffectError | undefined;

export interface M2BEffectDefinition {
  readonly effectId: string;
  readonly version: '0.1';
  readonly enabledBlock: 'M2-3' | 'M2-4';
  readonly handler: M2BEffectHandler;
}

const clone = (state: M2BState): M2BState => structuredClone(state);
const stringParameter = (context: M2BEffectContext, key: string): string | undefined => {
  const value = context.parameters[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};
const integerParameter = (context: M2BEffectContext, key: string): number | undefined => {
  const value = context.parameters[key];
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) ? value : undefined;
};
const stringArrayParameter = (context: M2BEffectContext, key: string): readonly string[] | undefined => {
  const value = context.parameters[key];
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
};
const actor = (state: M2BState, context: M2BEffectContext) => state.participants[context.actorParticipantId];
const audit = (state: M2BState, context: M2BEffectContext, type: string, payload: M2BAuditRecord['payload']): void => {
  state.audit.push({ type, actorParticipantId: context.actorParticipantId, payload });
};
const pay = (state: M2BState, context: M2BEffectContext, amount: number): M2BEffectError | undefined => {
  const participant = actor(state, context);
  if (participant === undefined) return 'INVALID_EFFECT_INPUT';
  if (participant.resources < amount) return 'INSUFFICIENT_RESOURCES';
  participant.resources -= amount;
  audit(state, context, 'RESOURCE_SPENT', { amount, balanceAfter: participant.resources });
  recordQualifyingResourceSpend(state, { id: `spend:${state.version}:${state.audit.length}`, participantId: participant.id, amount, reason: 'CARD_COST' });
  return undefined;
};
const transfer = (state: M2BState, context: M2BEffectContext, targetId: string, amount: number): M2BEffectError | undefined => {
  const source = actor(state, context);
  const target = state.participants[targetId];
  if (source === undefined || target === undefined || amount < 0) return 'INVALID_EFFECT_INPUT';
  const effective = Math.min(source.resources, amount);
  source.resources -= effective;
  target.resources += effective;
  audit(state, context, 'RESOURCE_TRANSFERRED', { targetParticipantId: targetId, amount: effective });
  return undefined;
};

export const discardWithLifecycle = (state: M2BState, cardId: string): M2BEffectError | undefined => {
  const card = state.cards[cardId];
  if (card === undefined) return 'CARD_NOT_ELIGIBLE';
  const registeredCampaignReturn = card.definitionId === 'BASE_CARD_061' && card.zone === 'CAMPAIGN';
  if (registeredCampaignReturn || (card.returnToOwnerOnDiscard && card.controllerParticipantId !== card.ownerParticipantId)) {
    card.controllerParticipantId = card.ownerParticipantId;
    card.zone = 'HAND';
    card.returnToOwnerOnDiscard = false;
  } else {
    card.zone = card.cardClass === 'STARTER' ? 'REMOVED_FROM_GAME' : 'DISCARD';
  }
  return undefined;
};

export const applyDirectInfluence = (
  state: M2BState,
  pdId: string,
  type: InfluenceType,
  attributionCountryId: CountryId,
  count: number,
): { readonly placed: number; readonly removed: number } => {
  const opposite = type === 'MALIGN' ? 'RESILIENCY' : 'MALIGN';
  const oppositeStacks = state.influence.filter((stack) => stack.pdId === pdId && stack.type === opposite && stack.count > 0);
  const resolution = resolveTwoToOne(count, oppositeStacks.reduce((total, stack) => total + stack.count, 0));
  let remainingRemoval = resolution.oppositeRemoved;
  for (const stack of oppositeStacks) {
    const removed = Math.min(stack.count, remainingRemoval);
    stack.count -= removed;
    remainingRemoval -= removed;
  }
  const existing = state.influence.find((stack) => stack.pdId === pdId && stack.type === type && stack.attributionCountryId === attributionCountryId);
  if (existing === undefined) state.influence.push({ pdId, type, attributionCountryId, count: resolution.placed });
  else existing.count += resolution.placed;
  return { placed: resolution.placed, removed: resolution.oppositeRemoved };
};

export const recordQualifyingResourceSpend = (
  state: M2BState,
  spend: NonNullable<M2BState['resourceSpends']>[number],
): M2BEffectError | undefined => {
  state.resourceSpends ??= [];
  if (!Number.isInteger(spend.amount) || spend.amount <= 0 || state.participants[spend.participantId] === undefined ||
      state.resourceSpends.some(({ id }) => id === spend.id)) return 'INVALID_EFFECT_INPUT';
  state.resourceSpends.push(structuredClone(spend));
  return undefined;
};

export const resolveFlumaRegimeSpends = (
  state: M2BState,
  actorParticipantId: string,
  targetPdIds: readonly string[],
): M2BEffectError | undefined => {
  const participant = state.participants[actorParticipantId];
  if (participant?.countryId !== 'FLUMA') return 'INVALID_EFFECT_INPUT';
  state.flumaRegime ??= { active: false, processedSpendIds: [] };
  const eligible = (state.resourceSpends ?? []).filter(({ participantId, id }) =>
    participantId !== actorParticipantId && !state.flumaRegime!.processedSpendIds.includes(id));
  const unitCount = eligible.reduce((total, { amount }) => total + amount, 0);
  if (targetPdIds.length !== unitCount || targetPdIds.some((pdId) => !pdId.startsWith('ARDEN_PD_'))) return 'INVALID_EFFECT_INPUT';
  let targetIndex = 0;
  for (const spend of eligible) {
    for (let unit = 0; unit < spend.amount; unit += 1) {
      const pdId = targetPdIds[targetIndex++]!;
      const result = applyDirectInfluence(state, pdId, 'MALIGN', 'FLUMA', 2);
      state.audit.push({ type: 'FLUMA_SPEND_TRIGGER_RESOLVED', actorParticipantId,
        payload: { spendId: spend.id, unit: unit + 1, pdId, generated: 2, placed: result.placed, removed: result.removed } });
    }
    state.flumaRegime.processedSpendIds.push(spend.id);
  }
  state.flumaRegime.active = true;
  return undefined;
};

const handlers: Record<string, M2BEffectHandler> = {
  PAIR_BONUS: (state, context) => {
    const definitionIds = context.parameters.definitionIds;
    if (!Array.isArray(definitionIds) || !definitionIds.every((value) => typeof value === 'string')) return 'INVALID_EFFECT_INPUT';
    const amount = calculateRegisteredPairBonus(definitionIds);
    audit(state, context, 'REGISTERED_PAIR_BONUS_CALCULATED', { amount });
    return undefined;
  },
  TRADE_AGREEMENTS: (state, context) => {
    const participant = actor(state, context); const targetId = stringParameter(context, 'targetParticipantId'); const target = targetId === undefined ? undefined : state.participants[targetId];
    if (participant === undefined || target === undefined || target.id === participant.id) return 'INVALID_EFFECT_INPUT';
    participant.resources += 2; target.resources += 2; audit(state, context, 'RESOURCE_GAINED', { amount: 2, targetParticipantId: target.id }); return undefined;
  },
  RESOURCE_GAIN: (state, context) => {
    const amount = integerParameter(context, 'amount'); const participant = actor(state, context);
    if (amount === undefined || amount < 0 || participant === undefined) return 'INVALID_EFFECT_INPUT';
    participant.resources += amount; audit(state, context, 'RESOURCE_GAINED', { amount }); return undefined;
  },
  RESOURCE_TRANSFER: (state, context) => {
    const target = stringParameter(context, 'targetParticipantId'); const amount = integerParameter(context, 'amount');
    return target === undefined || amount === undefined ? 'INVALID_EFFECT_INPUT' : transfer(state, context, target, amount);
  },
  FIXED_SPEND_1: (state, context) => pay(state, context, 1),
  FIXED_SPEND_3: (state, context) => pay(state, context, 3),
  FIXED_GAIN_4: (state, context) => {
    const participant = actor(state, context); if (participant === undefined) return 'INVALID_EFFECT_INPUT';
    participant.resources += 4; audit(state, context, 'RESOURCE_GAINED', { amount: 4 }); return undefined;
  },
  TARGET_DT_SET: (state, context) => {
    const campaignId = stringParameter(context, 'campaignId');
    const targetDtId = stringParameter(context, 'targetDtId');
    const sourceCardInstanceId = stringParameter(context, 'sourceCardInstanceId');
    const campaign = campaignId === undefined ? undefined : state.campaigns[campaignId];
    if (campaignId === undefined || campaign === undefined || targetDtId === undefined || sourceCardInstanceId === undefined ||
        campaign.ownerParticipantId !== context.actorParticipantId || !campaign.cardIds.includes(sourceCardInstanceId)) return 'INVALID_EFFECT_INPUT';
    campaign.targetDtId = targetDtId;
    audit(state, context, 'CAMPAIGN_TARGET_DT_SET', { campaignId, targetDtId });
    return undefined;
  },
  SANCTIONS: (state, context) => {
    const targetId = stringParameter(context, 'targetParticipantId'); const participant = actor(state, context); const target = targetId === undefined ? undefined : state.participants[targetId];
    if (participant === undefined || target === undefined || participant.id === target.id) return 'INVALID_EFFECT_INPUT';
    const amount = Math.min(2, target.resources); target.resources -= amount; participant.resources += amount;
    audit(state, context, 'RESOURCE_TRANSFERRED', { targetParticipantId: target.id, amount }); return undefined;
  },
  DIRECT_INFLUENCE: (state, context) => {
    const pdId = stringParameter(context, 'pdId'); const type = stringParameter(context, 'type'); const amount = integerParameter(context, 'amount');
    const participant = actor(state, context);
    if (pdId === undefined || (type !== 'MALIGN' && type !== 'RESILIENCY') || amount === undefined || amount < 0 || participant === undefined) return 'INVALID_EFFECT_INPUT';
    const result = applyDirectInfluence(state, pdId, type, participant.countryId, amount);
    audit(state, context, 'DIRECT_INFLUENCE_APPLIED', { pdId, type, generated: amount, placed: result.placed, removed: result.removed }); return undefined;
  },
  VP_PENALTY: (state, context) => {
    const targetId = stringParameter(context, 'targetParticipantId'); const amount = integerParameter(context, 'amount'); const target = targetId === undefined ? undefined : state.participants[targetId];
    if (target === undefined || amount === undefined || amount < 0) return 'INVALID_EFFECT_INPUT';
    const before = target.victoryPoints; target.victoryPoints = Math.max(0, before - amount);
    audit(state, context, 'VP_CHANGED', { targetParticipantId: target.id, delta: target.victoryPoints - before }); return undefined;
  },
  CORRUPTION: (state, context) => {
    const payment = pay(state, context, 1); if (payment !== undefined) return payment;
    return handlers.VP_PENALTY?.(state, { ...context, parameters: { ...context.parameters, amount: 2 } });
  },
  PAY_AND_DIRECT_INFLUENCE: (state, context) => {
    const cost = integerParameter(context, 'cost');
    if (cost === undefined) return 'INVALID_EFFECT_INPUT';
    const payment = pay(state, context, cost); if (payment !== undefined) return payment;
    return handlers.DIRECT_INFLUENCE?.(state, context);
  },
  PAY_AND_DISCARD_CAMPAIGN: (state, context) => {
    const campaignId = stringParameter(context, 'campaignId');
    if (campaignId === undefined || state.campaigns[campaignId] === undefined) return 'INVALID_EFFECT_INPUT';
    const payment = pay(state, context, 1); if (payment !== undefined) return payment;
    const discarded = discardCampaign(state, campaignId); if (discarded !== undefined) return discarded;
    audit(state, context, 'CAMPAIGN_DISCARDED', { campaignId });
    return undefined;
  },
  MULTI_ROLL_RESOURCE_TRANSFER: (state, context) => {
    const recipient = actor(state, context);
    const rolls = context.parameters.rollsByParticipant;
    if (recipient === undefined || typeof rolls !== 'object' || rolls === null || Array.isArray(rolls)) return 'INVALID_EFFECT_INPUT';
    const otherIds = Object.keys(state.participants).filter((participantId) => participantId !== context.actorParticipantId).sort();
    const rollRecord = rolls as Readonly<Record<string, unknown>>;
    if (Object.keys(rollRecord).sort().join('|') !== otherIds.join('|')) return 'INVALID_EFFECT_INPUT';
    const passing: string[] = [];
    for (const participantId of otherIds) {
      const roll = rollRecord[participantId];
      if (typeof roll !== 'number' || !Number.isInteger(roll) || !Number.isFinite(roll) || roll < 1 || roll > 10) return 'INVALID_DIE_VALUE';
      if (roll <= 4) passing.push(participantId);
    }
    if (passing.some((participantId) => state.participants[participantId]!.resources < 1)) return 'INSUFFICIENT_RESOURCES';
    for (const participantId of otherIds) {
      const roll = rollRecord[participantId] as number;
      audit(state, context, 'DIE_ROLLED', { rollerParticipantId: participantId, rawValue: roll, manual: false });
    }
    for (const participantId of passing) {
      const payer = state.participants[participantId]!;
      payer.resources -= 1; recipient.resources += 1;
      audit(state, context, 'RESOURCE_TRANSFERRED', { sourceParticipantId: participantId, targetParticipantId: recipient.id, amount: 1 });
    }
    return undefined;
  },
  RANDOM_HAND_REVIEW: (state, context) => {
    const targetParticipantId = stringParameter(context, 'targetParticipantId');
    const selectedCardIds = context.parameters.selectedCardIds;
    if (targetParticipantId === undefined || state.participants[targetParticipantId] === undefined || !Array.isArray(selectedCardIds) ||
        !selectedCardIds.every((cardId) => typeof cardId === 'string') || new Set(selectedCardIds).size !== selectedCardIds.length) return 'INVALID_EFFECT_INPUT';
    const eligible = Object.values(state.cards)
      .filter((card) => card.controllerParticipantId === targetParticipantId && card.zone === 'HAND')
      .map(({ id }) => id).sort();
    if (selectedCardIds.length !== Math.min(3, eligible.length) || selectedCardIds.some((cardId) => !eligible.includes(cardId))) return 'INVALID_EFFECT_INPUT';
    for (const cardId of selectedCardIds) audit(state, context, 'CARD_REVEALED', { cardId, targetParticipantId, viewerParticipantId: context.actorParticipantId });
    return undefined;
  },
  DOUBLE_ACTION: (state, context) => {
    const campaignId = stringParameter(context, 'campaignId');
    const campaign = campaignId === undefined ? undefined : state.campaigns[campaignId];
    if (campaign === undefined || campaign.ownerParticipantId !== context.actorParticipantId) return 'INVALID_EFFECT_INPUT';
    const payment = pay(state, context, 1); if (payment !== undefined) return payment;
    campaign.activationCountThisTurn += 1;
    audit(state, context, 'EXTRA_CAMPAIGN_ACTIVATION_GRANTED', { campaignId: campaign.id, activationCountThisTurn: campaign.activationCountThisTurn });
    return undefined;
  },
  REGIME_DIE_REMOVE: (state, context) => {
    const participant = actor(state, context); const roll = integerParameter(context, 'roll'); const pdId = stringParameter(context, 'pdId');
    const attributionCountryId = stringParameter(context, 'attributionCountryId') as CountryId | undefined;
    if (participant?.countryId !== 'ARDEN' || roll === undefined || roll < 1 || roll > 10) return 'INVALID_DIE_VALUE';
    if (participant.regimeAbilityUsed) return 'REGIME_ABILITY_ALREADY_USED'; participant.regimeAbilityUsed = true;
    audit(state, context, 'DIE_ROLLED', { rawValue: roll, manual: Boolean(context.parameters.manual) });
    if (roll <= 4) {
      if (pdId === undefined || !pdId.startsWith('ARDEN_PD_') || attributionCountryId === undefined) return 'INVALID_EFFECT_INPUT';
      const stack = state.influence.find((candidate) => candidate.pdId === pdId && candidate.type === 'MALIGN' &&
        candidate.attributionCountryId === attributionCountryId && candidate.count > 0);
      if (stack === undefined) return 'INVALID_EFFECT_INPUT';
      stack.count -= 1; audit(state, context, 'REGIME_INFLUENCE_REMOVED', { pdId, attributionCountryId, amount: 1 });
    }
    return undefined;
  },
  REGIME_URSARIA: (state, context) => {
    const participant = actor(state, context); const cardIds = stringArrayParameter(context, 'cardIds');
    const pdId = stringParameter(context, 'pdId'); const attributions = stringArrayParameter(context, 'attributionCountryIds');
    if (participant?.countryId !== 'URSARIA' || cardIds === undefined || cardIds.length !== 2 || new Set(cardIds).size !== 2 ||
        pdId === undefined || !pdId.startsWith('URSARIA_PD_') || attributions === undefined || attributions.length > 3) return 'INVALID_EFFECT_INPUT';
    if (participant.regimeAbilityUsed) return 'REGIME_ABILITY_ALREADY_USED'; participant.regimeAbilityUsed = true;
    const cards = cardIds.map((id) => state.cards[id]);
    if (cards.some((card) => card === undefined || card.controllerParticipantId !== participant.id || card.zone !== 'HAND' ||
        (card.alignment !== 'MALIGN' && card.alignment !== 'DUAL'))) return undefined;
    for (const attribution of attributions) {
      const stack = state.influence.find((candidate) => candidate.pdId === pdId && candidate.type === 'MALIGN' &&
        candidate.attributionCountryId === attribution && candidate.count > 0);
      if (stack === undefined) return 'INVALID_EFFECT_INPUT';
    }
    for (const cardId of cardIds) discardWithLifecycle(state, cardId);
    for (const attribution of attributions) state.influence.find((candidate) => candidate.pdId === pdId && candidate.type === 'MALIGN' &&
      candidate.attributionCountryId === attribution)!.count -= 1;
    audit(state, context, 'REGIME_CARDS_DISCARDED', { firstCardId: cardIds[0]!, secondCardId: cardIds[1]! });
    audit(state, context, 'REGIME_INFLUENCE_REMOVED', { pdId, amount: attributions.length });
    return undefined;
  },
  REGIME_FLUMA: (state, context) => {
    const participant = actor(state, context); const targetPdIds = stringArrayParameter(context, 'targetPdIds');
    if (participant?.countryId !== 'FLUMA' || targetPdIds === undefined) return 'INVALID_EFFECT_INPUT';
    if (participant.regimeAbilityUsed && state.flumaRegime?.active !== true) return 'REGIME_ABILITY_ALREADY_USED';
    const resolved = resolveFlumaRegimeSpends(state, participant.id, targetPdIds); if (resolved !== undefined) return resolved;
    participant.regimeAbilityUsed = true;
    audit(state, context, 'FLUMA_REGIME_ACTIVATED', { processedSpendCount: state.flumaRegime?.processedSpendIds.length ?? 0 });
    return undefined;
  },
  REGIME_PRESQUE: (state, context) => {
    const participant = actor(state, context); const roll = integerParameter(context, 'roll'); const pdId = stringParameter(context, 'pdId');
    const removeOwnPdId = stringParameter(context, 'removeOwnPdId');
    if (participant?.countryId !== 'PRESQUE' || roll === undefined || roll < 1 || roll > 10) return 'INVALID_DIE_VALUE';
    if (participant.regimeAbilityUsed) return 'REGIME_ABILITY_ALREADY_USED'; participant.regimeAbilityUsed = true;
    audit(state, context, 'DIE_ROLLED', { rawValue: roll, manual: Boolean(context.parameters.manual) });
    if (roll > 4) return undefined;
    if (pdId === undefined || state.legitimacyByPd[pdId] === undefined && !Object.hasOwn(state.legitimacyByPd, pdId)) return 'INVALID_EFFECT_INPUT';
    const ownMarkers = Object.entries(state.legitimacyByPd).filter(([, owner]) => owner === participant.id).map(([id]) => id);
    if (ownMarkers.length >= 3) {
      if (removeOwnPdId === undefined || !ownMarkers.includes(removeOwnPdId) || removeOwnPdId === pdId) return 'INVALID_EFFECT_INPUT';
      state.legitimacyByPd[removeOwnPdId] = null;
    }
    const previousParticipantId = state.legitimacyByPd[pdId] ?? '';
    state.legitimacyByPd[pdId] = participant.id;
    audit(state, context, 'REGIME_LEGITIMACY_REPLACED', { pdId, previousParticipantId });
    return undefined;
  },
  REGIME_DINESIA: (state, context) => {
    const participant = actor(state, context); const pdId = stringParameter(context, 'pdId');
    if (participant?.countryId !== 'DINESIA' || pdId === undefined || !pdId.startsWith('DINESIA_PD_')) return 'INVALID_EFFECT_INPUT';
    if (participant.regimeAbilityUsed) return 'REGIME_ABILITY_ALREADY_USED'; participant.regimeAbilityUsed = true;
    const payment = pay(state, context, 2); if (payment !== undefined) return payment;
    const result = applyDirectInfluence(state, pdId, 'RESILIENCY', 'DINESIA', 1);
    audit(state, context, 'REGIME_DIRECT_INFLUENCE', { pdId, generated: 1, placed: result.placed, removed: result.removed });
    return undefined;
  },
};

export const M2_PAIR_BONUS_EFFECT_IDS = [
  'CARD_EFFECT_BASE_2025_E002', 'CARD_EFFECT_BASE_2025_E003', 'CARD_EFFECT_BASE_2025_E004',
  'CARD_EFFECT_BASE_2025_E005', 'CARD_EFFECT_BASE_2025_E007', 'CARD_EFFECT_BASE_2025_E008',
  'CARD_EFFECT_BASE_2025_E009', 'CARD_EFFECT_BASE_2025_E011', 'CARD_EFFECT_BASE_2025_E018',
  'CARD_EFFECT_BASE_2025_E020', 'CARD_EFFECT_BASE_2025_E023', 'CARD_EFFECT_BASE_2025_E024',
  'CARD_EFFECT_BASE_2025_E027', 'CARD_EFFECT_BASE_2025_E029', 'CARD_EFFECT_BASE_2025_E030',
  'CARD_EFFECT_BASE_2025_E032', 'CARD_EFFECT_BASE_2025_E037', 'CARD_EFFECT_BASE_2025_E038',
  'CARD_EFFECT_BASE_2025_E041', 'CARD_EFFECT_BASE_2025_E043', 'CARD_EFFECT_BASE_2025_E044',
  'CARD_EFFECT_BASE_2025_E049', 'CARD_EFFECT_BASE_2025_E052',
] as const;

export const M2_TARGET_DT_EFFECT_IDS = [
  'CARD_EFFECT_BASE_2025_E034', 'CARD_EFFECT_BASE_2025_E055', 'CARD_EFFECT_BASE_2025_E056',
  'CARD_EFFECT_BASE_2025_E057', 'CARD_EFFECT_BASE_2025_E058', 'CARD_EFFECT_BASE_2025_E059',
] as const;

const registeredPairBonusHandler: M2BEffectHandler = (state, context) => {
  const definitionIds = context.parameters.definitionIds;
  if (!Array.isArray(definitionIds) || !definitionIds.every((value) => typeof value === 'string')) return 'INVALID_EFFECT_INPUT';
  const index = (M2_PAIR_BONUS_EFFECT_IDS as readonly string[]).indexOf(context.effectId);
  const pair = BASE_2025_PAIR_BONUSES[index];
  if (pair === undefined) return 'EFFECT_UNKNOWN';
  const present = new Set(definitionIds);
  const amount = present.has(pair[0]) && present.has(pair[1]) ? 2 : 0;
  audit(state, context, 'REGISTERED_PAIR_BONUS_CALCULATED', { amount });
  return undefined;
};

const definitions: readonly M2BEffectDefinition[] = [
  ...M2_PAIR_BONUS_EFFECT_IDS.map((effectId) => ({ effectId, version: '0.1' as const, enabledBlock: 'M2-3' as const, handler: registeredPairBonusHandler })),
  { effectId: 'CARD_EFFECT_BASE_2025_E001', version: '0.1', enabledBlock: 'M2-4', handler: handlers.TRADE_AGREEMENTS! },
  { effectId: 'CARD_EFFECT_BASE_2025_E014', version: '0.1', enabledBlock: 'M2-4', handler: handlers.DIRECT_INFLUENCE! },
  { effectId: 'CARD_EFFECT_BASE_2025_E015', version: '0.1', enabledBlock: 'M2-4', handler: handlers.PAY_AND_DIRECT_INFLUENCE! },
  { effectId: 'CARD_EFFECT_BASE_2025_E017', version: '0.1', enabledBlock: 'M2-4', handler: handlers.PAY_AND_DISCARD_CAMPAIGN! },
  { effectId: 'CARD_EFFECT_BASE_2025_E019', version: '0.1', enabledBlock: 'M2-4', handler: handlers.SANCTIONS! },
  { effectId: 'CARD_EFFECT_BASE_2025_E025', version: '0.1', enabledBlock: 'M2-4', handler: handlers.DOUBLE_ACTION! },
  { effectId: 'CARD_EFFECT_BASE_2025_E026', version: '0.1', enabledBlock: 'M2-4', handler: handlers.FIXED_SPEND_1! },
  { effectId: 'CARD_EFFECT_BASE_2025_E028', version: '0.1', enabledBlock: 'M2-4', handler: handlers.RANDOM_HAND_REVIEW! },
  { effectId: 'CARD_EFFECT_BASE_2025_E039', version: '0.1', enabledBlock: 'M2-4', handler: handlers.FIXED_SPEND_3! },
  { effectId: 'CARD_EFFECT_BASE_2025_E042', version: '0.1', enabledBlock: 'M2-4', handler: handlers.FIXED_GAIN_4! },
  { effectId: 'CARD_EFFECT_BASE_2025_E046', version: '0.1', enabledBlock: 'M2-4', handler: handlers.MULTI_ROLL_RESOURCE_TRANSFER! },
  ...M2_TARGET_DT_EFFECT_IDS.map((effectId) => ({ effectId, version: '0.1' as const, enabledBlock: 'M2-4' as const, handler: handlers.TARGET_DT_SET! })),
  { effectId: 'CARD_EFFECT_BASE_2025_E051', version: '0.1', enabledBlock: 'M2-4', handler: handlers.CORRUPTION! },
  { effectId: 'REGIME_EFFECT_ARDEN', version: '0.1', enabledBlock: 'M2-4', handler: handlers.REGIME_DIE_REMOVE! },
  { effectId: 'REGIME_EFFECT_FLUMA', version: '0.1', enabledBlock: 'M2-4', handler: handlers.REGIME_FLUMA! },
  { effectId: 'REGIME_EFFECT_URSARIA', version: '0.1', enabledBlock: 'M2-4', handler: handlers.REGIME_URSARIA! },
  { effectId: 'REGIME_EFFECT_PRESQUE', version: '0.1', enabledBlock: 'M2-4', handler: handlers.REGIME_PRESQUE! },
  { effectId: 'REGIME_EFFECT_DINESIA', version: '0.1', enabledBlock: 'M2-4', handler: handlers.REGIME_DINESIA! },
] as const;

export const M2_IMPLEMENTED_REGIME_EFFECT_IDS = [
  'REGIME_EFFECT_ARDEN', 'REGIME_EFFECT_FLUMA', 'REGIME_EFFECT_URSARIA', 'REGIME_EFFECT_PRESQUE', 'REGIME_EFFECT_DINESIA',
] as const;
/** Historical card-effect inventory plus Arden retained for compatibility; regime coverage is exported separately. */
export const M2_IMPLEMENTED_EFFECT_IDS: readonly string[] = definitions
  .map(({ effectId }) => effectId)
  .filter((effectId) => !M2_IMPLEMENTED_REGIME_EFFECT_IDS.slice(1).includes(effectId as typeof M2_IMPLEMENTED_REGIME_EFFECT_IDS[number]));

export const M2_EVENT_DRIVEN_EFFECT_IDS = [
  'CARD_EFFECT_BASE_2025_E033',
  'CARD_EFFECT_BASE_2025_E010',
  'CARD_EFFECT_BASE_2025_E012',
  'CARD_EFFECT_BASE_2025_E022',
  'CARD_EFFECT_BASE_2025_E036',
  'CARD_EFFECT_BASE_2025_E040',
  'CARD_EFFECT_BASE_2025_E054',
  'CARD_EFFECT_BASE_2025_E016',
  'CARD_EFFECT_BASE_2025_E047',
  'CARD_EFFECT_BASE_2025_E006',
  'CARD_EFFECT_BASE_2025_E013',
  'CARD_EFFECT_BASE_2025_E031',
  'CARD_EFFECT_BASE_2025_E045',
  'CARD_EFFECT_BASE_2025_E035',
  'CARD_EFFECT_BASE_2025_E053',
  'CARD_EFFECT_BASE_2025_E048',
  'CARD_EFFECT_BASE_2025_E021',
  'CARD_EFFECT_BASE_2025_E050',
] as const;

export const BASE_2025_PAIR_BONUSES: readonly (readonly [string, string])[] = [
  ['CARD_DEF_BASE_2025_D002', 'CARD_DEF_BASE_2025_D098'], ['CARD_DEF_BASE_2025_D008', 'CARD_DEF_BASE_2025_D044'],
  ['CARD_DEF_BASE_2025_D009', 'CARD_DEF_BASE_2025_D029'], ['CARD_DEF_BASE_2025_D010', 'CARD_DEF_BASE_2025_D052'],
  ['CARD_DEF_BASE_2025_D013', 'CARD_DEF_BASE_2025_D024'], ['CARD_DEF_BASE_2025_D015', 'CARD_DEF_BASE_2025_D002'],
  ['CARD_DEF_BASE_2025_D017', 'CARD_DEF_BASE_2025_D022'], ['CARD_DEF_BASE_2025_D020', 'CARD_DEF_BASE_2025_D016'],
  ['CARD_DEF_BASE_2025_D033', 'CARD_DEF_BASE_2025_D098'], ['CARD_DEF_BASE_2025_D038', 'CARD_DEF_BASE_2025_D053'],
  ['CARD_DEF_BASE_2025_D046', 'CARD_DEF_BASE_2025_D067'], ['CARD_DEF_BASE_2025_D049', 'CARD_DEF_BASE_2025_D076'],
  ['CARD_DEF_BASE_2025_D055', 'CARD_DEF_BASE_2025_D072'], ['CARD_DEF_BASE_2025_D057', 'CARD_DEF_BASE_2025_D077'],
  ['CARD_DEF_BASE_2025_D058', 'CARD_DEF_BASE_2025_D019'], ['CARD_DEF_BASE_2025_D060', 'CARD_DEF_BASE_2025_D089'],
  ['CARD_DEF_BASE_2025_D066', 'CARD_DEF_BASE_2025_D084'], ['CARD_DEF_BASE_2025_D068', 'CARD_DEF_BASE_2025_D025'],
  ['CARD_DEF_BASE_2025_D074', 'CARD_DEF_BASE_2025_D004'], ['CARD_DEF_BASE_2025_D077', 'CARD_DEF_BASE_2025_D083'],
  ['CARD_DEF_BASE_2025_D078', 'CARD_DEF_BASE_2025_D004'], ['CARD_DEF_BASE_2025_D086', 'CARD_DEF_BASE_2025_D045'],
  ['CARD_DEF_BASE_2025_D090', 'CARD_DEF_BASE_2025_D025'],
] as const;

export const calculateRegisteredPairBonus = (definitionIds: readonly string[]): number => {
  const present = new Set(definitionIds);
  return BASE_2025_PAIR_BONUSES.reduce((total, [left, right]) => total + (present.has(left) && present.has(right) ? 2 : 0), 0);
};

export class M2BEffectDispatcher {
  private readonly manifest = new Map(definitions.map((definition) => [definition.effectId, definition]));
  private readonly approvedEffectIds = new Set(M2_EFFECT_MANIFEST.map(({ effectId }) => effectId));
  constructor(private readonly enabledThrough: 'M2-3' | 'M2-4') {}

  dispatch(state: M2BState, context: M2BEffectContext): M2BEffectResult {
    const definition = this.manifest.get(context.effectId);
    if (definition === undefined) return { ok: false, state, error: this.approvedEffectIds.has(context.effectId) ? 'EFFECT_DISABLED' : 'EFFECT_UNKNOWN', emitted: [] };
    if (context.effectVersion !== definition.version) return { ok: false, state, error: 'EFFECT_VERSION_MISMATCH', emitted: [] };
    if (this.enabledThrough === 'M2-3' && definition.enabledBlock === 'M2-4') return { ok: false, state, error: 'EFFECT_DISABLED', emitted: [] };
    const draft = clone(state); const auditStart = draft.audit.length;
    const error = definition.handler(draft, context);
    if (error !== undefined) return { ok: false, state, error, emitted: [] };
    draft.version += 1;
    return { ok: true, state: draft, emitted: draft.audit.slice(auditStart) };
  }
}

export const validateManualDie = (value: number): M2BEffectError | undefined =>
  Number.isInteger(value) && Number.isFinite(value) && value >= 1 && value <= 10 ? undefined : 'INVALID_DIE_VALUE';

export const applyBacklash = (state: M2BState, participantId: string, pdId: string, amount: number): number => {
  const participant = state.participants[participantId]; if (participant === undefined) return 0;
  const placed = applyDirectInfluence(state, pdId, 'RESILIENCY', participant.countryId, amount).placed;
  participant.victoryPoints = Math.max(0, participant.victoryPoints - placed); return placed;
};

export const establishLegitimacy = (state: M2BState, participantId: string, pdId: string, replacePdId?: string): boolean => {
  const owned = Object.entries(state.legitimacyByPd).filter(([, owner]) => owner === participantId);
  if (owned.length >= 3) {
    if (replacePdId === undefined || state.legitimacyByPd[replacePdId] !== participantId) return false;
    state.legitimacyByPd[replacePdId] = null;
  }
  state.legitimacyByPd[pdId] = participantId; return true;
};

export const modifyCampaignCard = (state: M2BState, campaignId: string, oldCardId: string, replacementCardId?: string): M2BEffectError | undefined => {
  const campaign = state.campaigns[campaignId];
  if (campaign === undefined || replacementCardId === undefined) return 'CARD_NOT_ELIGIBLE';
  const index = campaign.cardIds.indexOf(oldCardId); const replacement = state.cards[replacementCardId];
  if (index < 0 || replacement?.zone !== 'HAND') return 'CARD_WRONG_ZONE';
  discardWithLifecycle(state, oldCardId); replacement.zone = 'CAMPAIGN'; campaign.cardIds[index] = replacementCardId; return undefined;
};

export const discardCampaign = (state: M2BState, campaignId: string): M2BEffectError | undefined => {
  const campaign = state.campaigns[campaignId]; if (campaign === undefined) return 'CARD_NOT_ELIGIBLE';
  for (const cardId of campaign.cardIds) discardWithLifecycle(state, cardId);
  delete state.campaigns[campaignId]; return undefined;
};

export const runM2BScheduler = <T>(
  orderedSlots: readonly T[],
  execute: (slot: T, index: number) => 'RESOLVED' | 'SUSPENDED',
  startIndex = 0,
): { readonly nextIndex: number; readonly status: 'SUSPENDED' | 'COMPLETE'; readonly executionOrder: readonly number[] } => {
  const order: number[] = [];
  for (let index = startIndex; index < orderedSlots.length; index += 1) {
    const slot = orderedSlots[index]; if (slot === undefined) break; order.push(index);
    if (execute(slot, index) === 'SUSPENDED') return { nextIndex: index, status: 'SUSPENDED', executionOrder: order };
  }
  return { nextIndex: orderedSlots.length, status: 'COMPLETE', executionOrder: order };
};

export const playStarter = (state: M2BState, cardId: string, actorParticipantId: string): M2BEffectError | undefined => {
  const card = state.cards[cardId]; const participant = state.participants[actorParticipantId];
  if (card === undefined || participant === undefined || card.cardClass !== 'STARTER' || card.zone !== 'HAND') return 'CARD_NOT_ELIGIBLE';
  card.zone = 'REMOVED_FROM_GAME'; return undefined;
};

export const stealBlindCard = (state: M2BState, actorId: string, targetId: string, position: number): string | undefined => {
  const targetCards = Object.values(state.cards).filter((card) => card.controllerParticipantId === targetId && card.zone === 'HAND').sort((a, b) => a.id.localeCompare(b.id));
  const card: M2BCard | undefined = targetCards[position]; if (card === undefined) return undefined;
  card.controllerParticipantId = actorId; card.returnToOwnerOnDiscard = true; return card.id;
};
