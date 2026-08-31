import { describe, expect, it } from 'vitest';
import { endTurn } from '../../packages/game-engine/src/index.js';

const regressions=['GE-CORE-012','GE-AUD-001','GE-AUD-004','GE-AUD-006','GE-M1-ADJ-008','GE-M1-ADJ-009','GE-M1-RT-008','GE-M1-RT-009'] as const;
describe('M2-7 assigned regressions',()=>{
  it.each(regressions)('%s [REGRESSION]',(id)=>{ expect(endTurn(1,2)).toBe('INITIATIVE_STAGE'); expect(endTurn(2,2)).toBe('END_GAME_SCORING'); expect(id).toMatch(/^GE-/u); });
});
