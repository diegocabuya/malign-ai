import type { CleanupContinuation, CleanupResult, InfluenceType, LifecycleError, M2BState, ViralOrigin, ViralResolution } from '@malign-ai/domain';
import { applyDirectInfluence, discardCampaign } from './m2b.js';

export const cleanupCampaignAging = (input: M2BState): CleanupResult => {
  const state = structuredClone(input); const snapshot = Object.values(state.campaigns).map(({ id, row }) => ({ id, row }));
  const aged: string[] = []; const discarded: string[] = [];
  for (const campaign of snapshot.filter(({ row }) => row === 'II').sort((a, b) => a.id.localeCompare(b.id))) {
    discardCampaign(state, campaign.id); discarded.push(campaign.id);
  }
  for (const campaign of snapshot.filter(({ row }) => row === 'I').sort((a, b) => a.id.localeCompare(b.id))) {
    const current = state.campaigns[campaign.id]; if (current !== undefined) { current.row = 'II'; aged.push(current.id); }
  }
  return { state, agedCampaignIds: aged, discardedCampaignIds: discarded };
};

export const resetTurnFlags = (state: M2BState): void => {
  for (const campaign of Object.values(state.campaigns)) campaign.activationCountThisTurn = 0;
  for (const participant of Object.values(state.participants)) { participant.regimeAbilityUsed = false; participant.coreModifierUsed = false; }
  state.scheduler.participantIndex = 0; state.scheduler.slotIndex = 0; state.scheduler.status = 'READY';
};

const totals = (state: M2BState, pdId: string, type: InfluenceType) => state.influence
  .filter((stack) => stack.pdId === pdId && stack.type === type).reduce((sum, stack) => sum + stack.count, 0);
const sharesTrait = (left: readonly string[], right: readonly string[]) => left.some((trait) => right.includes(trait));

export const snapshotViralOrigins = (
  state: M2BState,
  initiative: readonly string[],
  pdTraits: Readonly<Record<string, readonly string[]>>,
  variant: 'BASELINE' | 'SHORT',
  tieChoices: Readonly<Record<string, InfluenceType>> = {},
): readonly ViralOrigin[] => {
  const threshold = variant === 'SHORT' ? 6 : 8; const origins: ViralOrigin[] = [];
  for (const [pdId, ownerParticipantId] of Object.entries(state.legitimacyByPd)) {
    if (ownerParticipantId === null) continue;
    const malign = totals(state, pdId, 'MALIGN'); const resiliency = totals(state, pdId, 'RESILIENCY');
    let type: InfluenceType | undefined;
    if (malign > threshold || resiliency > threshold) type = malign === resiliency ? tieChoices[pdId] : malign > resiliency ? 'MALIGN' : 'RESILIENCY';
    if (type === undefined || !state.influence.some((stack) => stack.pdId === pdId && stack.type === type && stack.attributionCountryId === state.participants[ownerParticipantId]?.countryId && stack.count > 0)) continue;
    const sourceTraits = pdTraits[pdId] ?? [];
    const destinations = Object.keys(pdTraits).filter((candidate) => candidate !== pdId && sharesTrait(sourceTraits, pdTraits[candidate] ?? [])).sort();
    if (destinations.length > 0) origins.push({ pdId, ownerParticipantId, type, validDestinationPdIds: destinations });
  }
  return origins.sort((left, right) => (initiative.indexOf(left.ownerParticipantId) - initiative.indexOf(right.ownerParticipantId)) || left.pdId.localeCompare(right.pdId));
};

export const resolveViralOrigin = (
  state: M2BState,
  origin: ViralOrigin,
  destinationPdId: string,
  rolls: readonly number[],
  variant: 'BASELINE' | 'SHORT',
): ViralResolution | LifecycleError => {
  if (!origin.validDestinationPdIds.includes(destinationPdId)) return 'INVALID_TARGET_PD';
  const first = rolls[0]; if (!Number.isInteger(first) || first! < 1 || first! > 10) return 'INVALID_VIRAL_ROLL';
  if (first! < 6) return { attempted: true, success: false, generated: 0, placed: 0, removed: 0, rollsConsumed: 1 };
  let generated = 1; let consumed = 1;
  if (variant === 'BASELINE') {
    const second = rolls[1]; if (!Number.isInteger(second) || second! < 1 || second! > 10) return 'INVALID_VIRAL_ROLL';
    generated = second! % 2 === 0 ? 2 : 1; consumed = 2;
  }
  const country = state.participants[origin.ownerParticipantId]?.countryId; if (country === undefined) return 'INVALID_TARGET_PD';
  const result = applyDirectInfluence(state, destinationPdId, origin.type, country, generated);
  return { attempted: true, success: true, generated, placed: result.placed, removed: result.removed, rollsConsumed: consumed };
};

export const makeCleanupContinuation = (id: string, expectedGameVersion: number, step: CleanupContinuation['step'] = 'AGING', viralOrigins: readonly ViralOrigin[] = [], nextOriginIndex = 0): CleanupContinuation => ({
  kind: 'CLEANUP', schemaVersion: 1, id, expectedGameVersion, step, viralOrigins: structuredClone(viralOrigins), nextOriginIndex,
});

export const advanceCleanupContinuation = (continuation: CleanupContinuation, currentVersion: number): CleanupContinuation | LifecycleError => {
  if (continuation.expectedGameVersion !== currentVersion) return 'STALE_CLEANUP_CONTINUATION';
  const steps: CleanupContinuation['step'][] = ['AGING', 'VIRAL_SNAPSHOT', 'VIRAL_RESOLUTION', 'RESET', 'END_TURN', 'COMPLETE'];
  const index = steps.indexOf(continuation.step); if (index < 0 || continuation.step === 'COMPLETE') return 'INVALID_CLEANUP_STEP';
  return { ...continuation, expectedGameVersion: currentVersion + 1, step: steps[index + 1]! };
};
