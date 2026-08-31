import type { CountryId, EndGameState, FinalParticipantScore, GameOutcome, M2BState, ObjectiveEvaluation, PdObjectiveMetrics } from '@malign-ai/domain';

const net = (positive: number, opposite: number) => Math.max(0, positive - opposite);
const entriesFor = (metrics: Readonly<Record<string, PdObjectiveMetrics>>, countryId: CountryId) => Object.entries(metrics).filter(([, value]) => value.hostCountryId === countryId);
const am = (metric: PdObjectiveMetrics, countryId: CountryId) => metric.attributedMalign[countryId] ?? 0;
const ar = (metric: PdObjectiveMetrics, countryId: CountryId) => metric.attributedResiliency[countryId] ?? 0;
const nam = (metric: PdObjectiveMetrics, countryId: CountryId) => net(am(metric, countryId), ar(metric, countryId));
const nar = (metric: PdObjectiveMetrics, countryId: CountryId) => net(ar(metric, countryId), am(metric, countryId));
const ntm = (metric: PdObjectiveMetrics) => net(metric.totalMalign, metric.totalResiliency);
const ntr = (metric: PdObjectiveMetrics) => net(metric.totalResiliency, metric.totalMalign);

export const evaluateObjectives = (countryId: CountryId, metrics: Readonly<Record<string, PdObjectiveMetrics>>): ObjectiveEvaluation => {
  let hardVp: number; let mediumVp: number; let easyVp: number;
  const arden = entriesFor(metrics, 'ARDEN'); const presque = entriesFor(metrics, 'PRESQUE'); const dinesia = entriesFor(metrics, 'DINESIA');
  const liberty = metrics.FLUMA_PD_1; const workers = metrics.FLUMA_PD_2;
  if (countryId === 'ARDEN') {
    hardVp = am(metrics.FLUMA_PD_2!, 'ARDEN') > 5 ? 15 : 0;
    mediumVp = nar(metrics.FLUMA_PD_1!, 'ARDEN') > 3 ? 7 : 0;
    easyVp = arden.filter(([, value]) => value.totalResiliency > 2).length * 5;
  } else if (countryId === 'URSARIA') {
    hardVp = arden.reduce((sum, [, value]) => sum + am(value, 'URSARIA'), 0) > 7 ? 20 : 0;
    mediumVp = presque.filter(([, value]) => value.traits.includes('CHRISTIAN') && nam(value, 'URSARIA') >= 2).length >= 2 ? 7 : 0;
    easyVp = new Set(Object.values(metrics).filter((value) => value.hostCountryId !== 'URSARIA' && am(value, 'URSARIA') >= 2).map(({ hostCountryId }) => hostCountryId)).size * 5;
  } else if (countryId === 'PRESQUE') {
    hardVp = dinesia.filter(([, value]) => am(value, 'PRESQUE') > 3).length >= 2 ? 15 : 0;
    const mediumCount = arden.filter(([, value]) => nar(value, 'PRESQUE') > 2).length; mediumVp = mediumCount * 5 + (mediumCount === 3 ? 5 : 0);
    const easyCount = presque.filter(([, value]) => value.totalResiliency > 2).length; easyVp = easyCount * 3 + (easyCount === 3 ? 5 : 0);
  } else if (countryId === 'FLUMA') {
    hardVp = ntm(metrics.ARDEN_PD_1!) > 3 && ntm(metrics.ARDEN_PD_2!) > 3 ? 20 : 0;
    mediumVp = liberty !== undefined && workers !== undefined && ntr(liberty) >= 4 && ntr(liberty) > ntr(workers) ? 10 : 0;
    const tagged = Object.values(metrics).filter((value) => value.hostCountryId !== 'FLUMA' && nar(value, 'FLUMA') > 2 && value.narrativeTaggedCountries?.includes(value.hostCountryId));
    easyVp = tagged.length * 3 + (new Set(tagged.filter((value) => value.traits.includes('MIDDLE') || value.traits.includes('LOWER')).map(({ hostCountryId }) => hostCountryId)).size >= 3 ? 5 : 0);
  } else {
    hardVp = presque.length > 0 && presque.every(([, value]) => ntm(value) > 2) ? 20 : 0;
    const mediumCount = dinesia.filter(([, value]) => ntr(value) > 1).length; mediumVp = mediumCount * 5 + (mediumCount === dinesia.length && mediumCount > 0 ? 5 : 0);
    easyVp = liberty !== undefined && workers !== undefined && (nar(liberty, 'DINESIA') > 2 || nam(workers, 'DINESIA') > 2) ? 5 : 0;
  }
  return { countryId, hardVp, mediumVp, easyVp, totalVp: hardVp + mediumVp + easyVp };
};

export const determineWinners = (scores: readonly FinalParticipantScore[]): readonly string[] => {
  const maxVp = Math.max(...scores.map(({ finalVp }) => finalVp)); const leaders = scores.filter(({ finalVp }) => finalVp === maxVp);
  const leastMalign = Math.min(...leaders.map(({ ownCountryMalign }) => ownCountryMalign));
  return leaders.filter(({ ownCountryMalign }) => ownCountryMalign === leastMalign).map(({ participantId }) => participantId).sort();
};

export const finalizeGame = (endGame: EndGameState, state: M2BState, metrics: Readonly<Record<string, PdObjectiveMetrics>>, idempotencyKey: string): GameOutcome => {
  const prior = endGame.idempotencyResults[idempotencyKey]; if (prior !== undefined) return prior;
  const scores = Object.values(state.participants).map((participant): FinalParticipantScore => {
    const objectiveVp = evaluateObjectives(participant.countryId, metrics).totalVp;
    const ownCountryMalign = entriesFor(metrics, participant.countryId).reduce((sum, [, value]) => sum + value.totalMalign, 0);
    endGame.awardedObjectiveKeys.push(`${participant.id}:FINAL_OBJECTIVES`);
    return { participantId: participant.id, countryId: participant.countryId, baseVp: participant.victoryPoints, objectiveVp, finalVp: participant.victoryPoints + objectiveVp, ownCountryMalign };
  });
  const winners = determineWinners(scores); const outcome: GameOutcome = { status: 'GAME_COMPLETED', scores, winnerParticipantIds: winners, sharedVictory: winners.length > 1 };
  endGame.outcome = outcome; endGame.idempotencyResults[idempotencyKey] = outcome; return outcome;
};

export const endTurn = (turnNumber: number, turnLimit: number): 'INITIATIVE_STAGE' | 'END_GAME_SCORING' => turnNumber < turnLimit ? 'INITIATIVE_STAGE' : 'END_GAME_SCORING';
