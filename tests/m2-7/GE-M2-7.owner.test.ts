import { describe, expect, it } from 'vitest';
import type { CountryId, EndGameState, PdObjectiveMetrics } from '../../packages/domain/src/index.js';
import { determineWinners, endTurn, evaluateObjectives, finalizeGame } from '../../packages/game-engine/src/index.js';
import { m2bState } from '../m2-b/test-fixtures.js';

const objectiveOwners = ['GE-VO-ARD-001','GE-VO-ARD-002','GE-VO-ARD-003','GE-VO-ARD-004','GE-VO-URS-001','GE-VO-URS-002','GE-VO-URS-003','GE-VO-PRE-001','GE-VO-PRE-002','GE-VO-PRE-003','GE-VO-FLU-001','GE-VO-FLU-002','GE-VO-FLU-003','GE-VO-FLU-004','GE-VO-FLU-005','GE-VO-DIN-001','GE-VO-DIN-002','GE-VO-DIN-003'] as const;
const owners = [...objectiveOwners, ...Array.from({ length: 5 }, (_, index) => `GE-END-${String(index + 1).padStart(3, '0')}`), ...Array.from({ length: 5 }, (_, index) => `GE-E2E-${String(index + 1).padStart(3, '0')}`), 'GE-M2-END-001', 'GE-M2-END-002'] as const;
const countries: CountryId[] = ['ARDEN','FLUMA','URSARIA','PRESQUE','DINESIA'];
const blank = (hostCountryId: CountryId): PdObjectiveMetrics => ({ hostCountryId, traits: [], totalMalign: 0, totalResiliency: 0, attributedMalign: {}, attributedResiliency: {} });
const metrics = (): Record<string, PdObjectiveMetrics> => Object.fromEntries(countries.flatMap((country) => [1,2,3].map((number) => [`${country}_PD_${number}`, blank(country)])));
const endState = (): EndGameState => ({ idempotencyResults: {}, awardedObjectiveKeys: [] });
const set = (all: Record<string, PdObjectiveMetrics>, id: string, patch: Partial<PdObjectiveMetrics>) => { all[id] = { ...all[id]!, ...patch }; };

describe('M2-7 owner gate — Objectives, Victory and End Game', () => {
  it.each(owners)('%s', (id) => {
    const all = metrics();
    if (id.startsWith('GE-VO-')) {
      const country = id.slice(6, 9) === 'ARD' ? 'ARDEN' : id.slice(6, 9) === 'URS' ? 'URSARIA' : id.slice(6, 9) === 'PRE' ? 'PRESQUE' : id.slice(6, 9) === 'FLU' ? 'FLUMA' : 'DINESIA';
      if (id === 'GE-VO-ARD-001' || id === 'GE-VO-ARD-002') set(all,'FLUMA_PD_2',{ attributedMalign:{ARDEN:id.endsWith('001')?6:5} });
      if (id === 'GE-VO-ARD-003') set(all,'FLUMA_PD_1',{ attributedResiliency:{ARDEN:4} });
      if (id === 'GE-VO-ARD-004') [3,2,7].forEach((value,index)=>set(all,`ARDEN_PD_${index+1}`,{totalResiliency:value}));
      if (id === 'GE-VO-URS-001') set(all,'ARDEN_PD_1',{attributedMalign:{URSARIA:8}});
      if (id === 'GE-VO-URS-002') ['PRESQUE_PD_1','PRESQUE_PD_2'].forEach((pd)=>set(all,pd,{traits:['CHRISTIAN'],attributedMalign:{URSARIA:2}}));
      if (id === 'GE-VO-URS-003') ['ARDEN_PD_1','FLUMA_PD_1','DINESIA_PD_1'].forEach((pd)=>set(all,pd,{attributedMalign:{URSARIA:2}}));
      if (id === 'GE-VO-PRE-001') ['DINESIA_PD_1','DINESIA_PD_2'].forEach((pd)=>set(all,pd,{attributedMalign:{PRESQUE:4}}));
      if (id === 'GE-VO-PRE-002') [1,2,3].forEach((n)=>set(all,`ARDEN_PD_${n}`,{attributedResiliency:{PRESQUE:3}}));
      if (id === 'GE-VO-PRE-003') [1,2,3].forEach((n)=>set(all,`PRESQUE_PD_${n}`,{totalResiliency:3}));
      if (id === 'GE-VO-FLU-001') ['ARDEN_PD_2','ARDEN_PD_3'].forEach((pd)=>set(all,pd,{totalMalign:4}));
      if (id === 'GE-VO-FLU-002' || id === 'GE-VO-FLU-003') { set(all,'FLUMA_PD_1',{totalResiliency:4}); set(all,'FLUMA_PD_2',{totalResiliency:id.endsWith('002')?3:4}); }
      if (id === 'GE-VO-FLU-004') ['ARDEN_PD_1','PRESQUE_PD_1'].forEach((pd)=>set(all,pd,{attributedResiliency:{FLUMA:3},narrativeTaggedCountries:[all[pd]!.hostCountryId]}));
      if (id === 'GE-VO-FLU-005') ['ARDEN_PD_1','PRESQUE_PD_1','DINESIA_PD_1','DINESIA_PD_2'].forEach((pd)=>set(all,pd,{traits:['MIDDLE'],attributedResiliency:{FLUMA:3},narrativeTaggedCountries:[all[pd]!.hostCountryId]}));
      if (id === 'GE-VO-DIN-001') [1,2,3].forEach((n)=>set(all,`PRESQUE_PD_${n}`,{totalMalign:3}));
      if (id === 'GE-VO-DIN-002') [2,3,2].forEach((value,index)=>set(all,`DINESIA_PD_${index+1}`,{totalResiliency:value}));
      if (id === 'GE-VO-DIN-003') { set(all,'FLUMA_PD_1',{attributedResiliency:{DINESIA:3}}); set(all,'FLUMA_PD_2',{attributedMalign:{DINESIA:3}}); }
      const result = evaluateObjectives(country, all);
      const expected: Record<string,number> = {'GE-VO-ARD-001':15,'GE-VO-ARD-002':0,'GE-VO-ARD-003':7,'GE-VO-ARD-004':10,'GE-VO-URS-001':20,'GE-VO-URS-002':7,'GE-VO-URS-003':15,'GE-VO-PRE-001':15,'GE-VO-PRE-002':20,'GE-VO-PRE-003':14,'GE-VO-FLU-001':20,'GE-VO-FLU-002':10,'GE-VO-FLU-003':0,'GE-VO-FLU-004':6,'GE-VO-FLU-005':17,'GE-VO-DIN-001':20,'GE-VO-DIN-002':20,'GE-VO-DIN-003':5};
      const observed = id === 'GE-VO-URS-001' ? result.hardVp : id === 'GE-VO-URS-002' ? result.mediumVp : result.totalVp;
      expect(observed).toBe(expected[id]);
    } else if (id === 'GE-END-002') {
      expect(endTurn(1,2)).toBe('INITIATIVE_STAGE');
    } else if (id === 'GE-END-004' || id === 'GE-END-005') {
      const sameMalign = id.endsWith('005');
      const winners = determineWinners([{participantId:'P1',countryId:'ARDEN',baseVp:10,objectiveVp:0,finalVp:10,ownCountryMalign:3},{participantId:'P2',countryId:'FLUMA',baseVp:10,objectiveVp:0,finalVp:10,ownCountryMalign:sameMalign?3:5}]);
      expect(winners).toEqual(sameMalign?['P1','P2']:['P1']);
    } else {
      const state = m2bState(); const ending = endState(); const first = finalizeGame(ending,state,all,'K1'); const replay = structuredClone(first);
      if (id === 'GE-END-001' || id === 'GE-M2-END-001') { const retry=finalizeGame(ending,state,all,'K1'); expect(retry).toEqual(first); expect(ending.awardedObjectiveKeys).toHaveLength(5);
        expect(ending.objectiveAwards).toHaveLength(15); expect(new Set(ending.objectiveAwards?.map(({objectiveLogicalId,participantId})=>
          `${participantId}:${objectiveLogicalId}`)).size).toBe(15); }
      else if (id === 'GE-END-003') expect(first.status).toBe('GAME_COMPLETED');
      else if (id === 'GE-M2-END-002') expect(replay).toEqual(first);
      else { expect(first.scores).toHaveLength(5); expect(first.winnerParticipantIds.length).toBeGreaterThan(0); }
    }
  });
});
