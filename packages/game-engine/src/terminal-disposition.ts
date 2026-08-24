import type { SetupGameState } from "@malign-ai/domain";

export type NotExecutedTerminalDispositionResult =
  | { readonly ok: true; readonly nextState: SetupGameState }
  | {
      readonly ok: false;
      readonly error: "ACTION_PLAN_NOT_FOUND" | "INVALID_SLOT";
    };

/**
 * Minimal Engine-owned seam for a downstream resolver to record a terminal
 * non-execution. It is deliberately not exposed as a client command and does
 * not infer or accept any reason for the outcome.
 */
export const applyNotExecutedTerminalDisposition = (
  state: SetupGameState,
  participantId: string,
  sequenceIndex: number,
): NotExecutedTerminalDispositionResult => {
  const planning = state.actionPlanning[participantId];
  if (planning === undefined || !planning.locked) {
    return { ok: false, error: "ACTION_PLAN_NOT_FOUND" };
  }
  const slotIndex = planning.lockedSlots.findIndex(
    (slot) => slot.sequenceIndex === sequenceIndex,
  );
  if (slotIndex < 0) return { ok: false, error: "INVALID_SLOT" };

  const nextState = structuredClone(state);
  const slot = nextState.actionPlanning[participantId]?.lockedSlots[slotIndex];
  if (slot === undefined) return { ok: false, error: "INVALID_SLOT" };
  slot.terminalOutcome = "NOT_EXECUTED";
  return { ok: true, nextState };
};
