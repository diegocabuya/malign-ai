import { engineErrorFor, type EngineCommandResult } from '@malign-ai/contracts';

/**
 * Explicit M2-A test seam for persistence-only artifacts whose gameplay rules belong to later M2
 * blocks. It does not claim those rules are implemented and it never imports PostgreSQL.
 */
export interface M2APersistenceFixtureState extends Readonly<Record<string, unknown>> {
  readonly id: string;
  readonly version: number;
  readonly targets: readonly string[];
  readonly plannedTargetId: string;
  readonly influenceCount: number;
  readonly victoryPoints: number;
  readonly resources: number;
}

export type M2APersistenceFixtureCommand =
  | Readonly<{type:'APPLY_COMPONENT_EFFECT';commandId:string;influenceDelta:number;victoryPointDelta:number}>
  | Readonly<{type:'RESOURCE_EFFECT';commandId:string;reason:'TURN_INCOME'|'SPEND'|'TRANSFER_IN'|'TRANSFER_OUT';delta:number}>
  | Readonly<{type:'RESOURCE_TRANSFER';commandId:string;amount:number;targetParticipantId:string}>
  | Readonly<{type:'VP_EFFECT';commandId:string;reason:'CAMPAIGN'|'LEGITIMACY'|'CORRUPTION'|'OBJECTIVE';delta:number;floorZero:boolean}>
  | Readonly<{type:'REMOVE_TARGET';commandId:string;targetId:string}>
  | Readonly<{type:'RESOLVE_PLANNED_TARGET';commandId:string}>;

export interface M2AFixtureArtifact {
  readonly family:'INFLUENCE'|'VP'|'RESOURCE'|'TARGET';
  readonly reason:string;
  readonly delta?:number;
  readonly targetId?:string;
}

export interface M2APersistenceFixtureOutcome {
  readonly before:M2APersistenceFixtureState;
  readonly after:M2APersistenceFixtureState;
  readonly result:EngineCommandResult;
  readonly artifacts:readonly M2AFixtureArtifact[];
}

const validInteger=(value:number):boolean=>Number.isSafeInteger(value);

export const dispatchM2APersistenceFixture = (
  state:M2APersistenceFixtureState,
  command:M2APersistenceFixtureCommand,
  now:()=>Date,
):M2APersistenceFixtureOutcome => {
  const before=structuredClone(state);
  if (command.type==='RESOLVE_PLANNED_TARGET' && !state.targets.includes(state.plannedTargetId)) {
    const result:EngineCommandResult={commandId:command.commandId,gameId:state.id,status:'REJECTED',
      gameVersionBefore:state.version,gameVersionAfter:state.version,resultCode:'OBJECT_NO_LONGER_VALID',
      emittedEventRefs:[],adjudicationTraceRefs:[],error:engineErrorFor('OBJECT_NO_LONGER_VALID'),
      resolvedAt:now().toISOString()};
    return {before,after:before,result,artifacts:[]};
  }
  const working={...structuredClone(state),targets:[...state.targets]};
  const artifacts:M2AFixtureArtifact[]=[];
  if (command.type==='APPLY_COMPONENT_EFFECT') {
    if (!validInteger(command.influenceDelta)||!validInteger(command.victoryPointDelta)) throw new Error('Invalid fixture delta');
    working.influenceCount+=command.influenceDelta;
    working.victoryPoints=Math.max(0,working.victoryPoints+command.victoryPointDelta);
    artifacts.push({family:'INFLUENCE',reason:'VALID_ENGINE_EFFECT',delta:command.influenceDelta});
    artifacts.push({family:'VP',reason:'CAMPAIGN',delta:working.victoryPoints-state.victoryPoints});
  } else if (command.type==='RESOURCE_EFFECT') {
    if (!validInteger(command.delta)||working.resources+command.delta<0) throw new Error('Invalid resource fixture delta');
    working.resources+=command.delta;
    artifacts.push({family:'RESOURCE',reason:command.reason,delta:command.delta});
  } else if (command.type==='RESOURCE_TRANSFER') {
    if (!Number.isSafeInteger(command.amount)||command.amount<=0||working.resources-command.amount<0) throw new Error('Invalid resource transfer');
    working.resources-=command.amount;
    artifacts.push({family:'RESOURCE',reason:'TRANSFER_OUT',delta:-command.amount});
    artifacts.push({family:'RESOURCE',reason:`TRANSFER_IN:${command.targetParticipantId}`,delta:command.amount});
  } else if (command.type==='VP_EFFECT') {
    if (!validInteger(command.delta)) throw new Error('Invalid VP fixture delta');
    const target=command.floorZero?Math.max(0,working.victoryPoints+command.delta):working.victoryPoints+command.delta;
    if (target<0) throw new Error('Invalid VP fixture balance');
    const actualDelta=target-working.victoryPoints;
    working.victoryPoints=target;
    if (actualDelta!==0) artifacts.push({family:'VP',reason:command.reason,delta:actualDelta});
  } else if (command.type==='REMOVE_TARGET') {
    working.targets=working.targets.filter(target=>target!==command.targetId);
    artifacts.push({family:'TARGET',reason:'REMOVED',targetId:command.targetId});
  } else {
    artifacts.push({family:'TARGET',reason:'RESOLVED',targetId:working.plannedTargetId});
  }
  working.version=state.version+1;
  const result:EngineCommandResult={commandId:command.commandId,gameId:state.id,status:'RESOLVED',
    gameVersionBefore:state.version,gameVersionAfter:working.version,resultCode:`M2A_FIXTURE_${command.type}`,
    emittedEventRefs:[`${state.id}:fixture:${working.version}`],adjudicationTraceRefs:[],resolvedAt:now().toISOString()};
  return {before,after:working,result,artifacts};
};
