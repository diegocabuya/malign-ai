import { describe, expect, it } from 'vitest';
import { command, harness, sessionId } from '../m1-0/test-fixtures.js';
import { reachActionPlanning } from '../m1-1/test-fixtures.js';

const planning = () => { const testHarness = harness(); const state = reachActionPlanning(testHarness); return { testHarness, state }; };

describe('M2 integrated negotiation gate', () => {
  it('GE-PLAN-011 — a promise is auditable but never mutates either balance', () => {
    const { testHarness, state } = planning(); const before = [state.countries.ARDEN.resources, state.countries.FLUMA.resources];
    expect(testHarness.app.execute(sessionId('P1'), command('RECORD_DEAL_PROMISE', state.id, state.version, {
      targetParticipantId: 'P2', resourceAmount: 2,
    }, { commandId: 'GE-PLAN-011-command', idempotencyKey: 'GE-PLAN-011-key' }))).toMatchObject({ status: 'RESOLVED', resultCode: 'DEAL_PROMISE_RECORDED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect([committed.countries.ARDEN.resources, committed.countries.FLUMA.resources]).toEqual(before);
    expect(committed.events.at(-1)).toMatchObject({ type: 'DEAL_PROMISED', payload: { sourceParticipantId: 'P1', targetParticipantId: 'P2', resourceAmount: 2 } });
  });

  it('GE-PLAN-012 — the authenticated transferor moves resources atomically with a balanced ledger', () => {
    const { testHarness, state } = planning(); state.countries.ARDEN.resources = 3; state.countries.FLUMA.resources = 1;
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.app.execute(sessionId('P1'), command('TRANSFER_DEAL_RESOURCES', state.id, state.version, {
      targetParticipantId: 'P2', amount: 2,
    }, { commandId: 'GE-PLAN-012-command', idempotencyKey: 'GE-PLAN-012-key' }))).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect([committed.countries.ARDEN.resources, committed.countries.FLUMA.resources]).toEqual([1, 3]);
    expect(committed.resourceLedger.slice(-2).map(({ participantId, delta, reason }) => ({ participantId, delta, reason })))
      .toEqual([{ participantId: 'P1', delta: -2, reason: 'DEAL_TRANSFER' }, { participantId: 'P2', delta: 2, reason: 'DEAL_TRANSFER' }]);
  });

  it('GE-PLAN-013 — a committed card cannot be negotiated and rejection is mutation-free', () => {
    const { testHarness, state } = planning(); const card = state.cards[state.strategy.P1!.handCardInstanceIds[0]!]!;
    card.zone = 'PLANNED_ACTION'; expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    const before = testHarness.store.snapshot(state.id)!;
    expect(testHarness.app.execute(sessionId('P1'), command('TRANSFER_DEAL_CARD', state.id, state.version, {
      targetParticipantId: 'P2', cardInstanceId: card.id,
    }))).toMatchObject({ status: 'REJECTED', error: { code: 'CARD_WRONG_ZONE' } });
    expect(testHarness.store.snapshot(state.id)).toEqual(before);
  });

  it('GE-PLAN-014 — negotiated card changes controller while preserving printed provenance', () => {
    const { testHarness, state } = planning(); const card = state.cards[state.strategy.P1!.handCardInstanceIds[0]!]!;
    const released = state.strategy.P2!.handCardInstanceIds.pop()!; state.cards[released]!.zone = 'DISCARD'; state.strategy.P2!.discardCardInstanceIds.push(released);
    const printedOwner = card.countryOwnerId; const p2Before = state.strategy.P2!.handCardInstanceIds.length;
    expect(testHarness.store.commitState(state.id, state.version, state)).toBe(true);
    expect(testHarness.app.execute(sessionId('P1'), command('TRANSFER_DEAL_CARD', state.id, state.version, {
      targetParticipantId: 'P2', cardInstanceId: card.id,
    }, { commandId: 'GE-PLAN-014-command', idempotencyKey: 'GE-PLAN-014-key' }))).toMatchObject({ status: 'RESOLVED' });
    const committed = testHarness.store.snapshot(state.id)!;
    expect(committed.cards[card.id]).toMatchObject({ controllerParticipantId: 'P2', countryOwnerId: printedOwner, zone: 'HAND', returnToOwnerOnDiscard: false });
    expect(committed.strategy.P1!.handCardInstanceIds).not.toContain(card.id); expect(committed.strategy.P2!.handCardInstanceIds).toHaveLength(p2Before + 1);
  });
});
