# MALIGN-AI — RULE EFFECT TAXONOMY v0.2

**Estado:** APPROVED BASELINE PARA MODELADO  
**Fase:** cierre de Fase 0  
**Código:** no iniciado

## 1. Principio

Las reglas se representarán como efectos declarativos. La IA puede interpretar intención y explicar resultados; el Game Engine valida y ejecuta.

```text
RuleEffect
  id
  source_type              # CORE_RULE | CARD | REGIME_ABILITY | SCENARIO | FACILITATOR_OVERRIDE
  source_id
  timing_window
  trigger
  preconditions[]
  costs[]
  targets[]
  operations[]
  choices[]
  random_resolution[]
  postconditions[]
  visibility
  audit_payload
```

## 2. Timing windows aprobadas

1. `SETUP`
2. `STRATEGY_STAGE`
3. `INITIATIVE_ROLL`
4. `INITIATIVE_MAINTENANCE`
5. `ACTION_STAGE_PLAN`
6. `ACTION_STAGE_LOCKED`
7. `RESOLUTION_ACTION_START`
8. `CAMPAIGN_REVEALED`
9. `NARRATIVE_DECLARED`
10. `PRE_ROLL_REACTION_WINDOW`
11. `CAMPAIGN_COST_PAYMENT`
12. `COALITION_CONTRIBUTION_WINDOW`
13. `BEFORE_CAMPAIGN_ROLL`
14. `ON_CAMPAIGN_ROLL`
15. `ERT_RESOLUTION`
16. `CUBE_ADDITION`
17. `POST_CAMPAIGN`
18. `ON_CARD_PLAYED`
19. `ON_CARD_DRAWN`
20. `ON_DISCARD`
21. `CLEANUP_CAMPAIGN_AGING`
22. `CLEANUP_VIRAL`
23. `END_TURN_VICTORY_CHECK`
24. `END_GAME_SCORING`

## 3. Operaciones base

- `RESOURCE_GAIN`, `RESOURCE_SPEND`, `RESOURCE_TRANSFER`
- `CARD_DRAW`, `CARD_SEARCH`, `CARD_REVEAL`, `CARD_DISCARD`, `CARD_REMOVE_FROM_GAME`
- `CARD_STEAL`, `CARD_RETURN_TO_OWNER`, `CARD_SWAP`, `DECK_SHUFFLE`
- `CAMPAIGN_CREATE`, `CAMPAIGN_MODIFY`, `CAMPAIGN_DISCARD`, `CAMPAIGN_ACTIVATE`, `CAMPAIGN_EXTRA_ACTIVATION`
- `CV_ADD`, `CV_PAIR_BONUS`, `CV_RESOLUTION_TIER`
- `ROLL_D10`, `ROLL_MODIFY`, `CHECK_THRESHOLD`
- `EFFECT_NEGATE`
- `CUBE_GENERATE`, `CUBE_RESOLVE_2_TO_1`, `CUBE_PLACE`, `CUBE_REMOVE`
- `LEGITIMACY_SET`, `LEGITIMACY_REMOVE`, `LEGITIMACY_MOVE`
- `VP_ADD`, `VP_SUBTRACT_FLOOR_ZERO`
- `TARGET_DT_SET`
- `VOTE_START`, `VOTE_CAST`, `VOTE_RESOLVE`
- `NARRATIVE_SUBMIT`, `FACILITATOR_VALIDATE_NARRATIVE`
- `OBJECTIVE_TAG_EVENT`, `OBJECTIVE_EVALUATE`
- `CHOICE_REQUEST`, `RANDOM_CARD_SELECT`
- `HAND_LIMIT_ENFORCE`
- `GAME_STATE_OVERRIDE_AUDITED`

## 4. Precedencia de resolución aprobada — Campaign Activation

```text
A. validate planned activation / AP already committed
B. reveal campaign + target DT
C. validate Intent/Method minimum, alignment and target eligibility
D. player submits 2-3 sentence narrative
E. facilitator-only narrative checks if needed
F. open PRE_ROLL_REACTION_WINDOW (Veto, Right of First Refusal, etc.)
   - process eligible reactions in initiative priority
   - if campaign discarded/negated: stop
G. compute base_cv
H. determine base cost tier
I. pay base campaign cost + card-specific use costs
J. coalition contribution window if applicable
K. compute effective_cv = base_cv + all valid bonuses/contributions
L. resolution_tier = LOW 3-6 / MEDIUM 7-11 / HIGH >=12
M. apply pre-roll modifier choices (2 Resources -> +1 once/turn)
N. reveal planned Boost if assigned; apply ON_CAMPAIGN_ROLL modifier
O. roll d10 and apply all roll modifiers
P. lookup ERT result
Q. generate normal or backlash cubes
R. apply global 2:1; active player chooses attribution removals
S. place remaining cubes
T. if campaign-success path leaves >=1 new cube:
   - resolve legitimacy establishment/subversion
   - score +1 VP per placed cube + legitimacy bonuses
U. if backlash: -1 VP per backlash cube placed, floor VP at 0
V. postconditions / remove-after-use / event logging
```

## 5. Direct cube effects

`Filtraciones`, `Gestión de Crisis` y habilidades directas usan:

```text
CUBE_GENERATE -> CUBE_RESOLVE_2_TO_1 -> CUBE_PLACE
```

No ejecutan `LEGITIMACY_*` ni `VP_*` salvo efecto explícito.

## 6. Reaction priority

- Reactions are trigger-specific.
- REACTION cards are from hand, 0 AP unless text says cost.
- Priority follows initiative order starting after the triggering actor.
- Each reaction resolves immediately.
- If target/effect becomes invalid, window closes.
- Veto uses strict majority of all active players; tie => campaign proceeds.

## 7. Viral resolution

```text
for each PD at CLEANUP_VIRAL:
  if max(total_malign,total_resiliency) > 8 and legitimacy_owner != null:
      legitimacy_owner selects destination sharing >=1 DT
      roll d10
      if roll >= 6:
          roll d10 again
          cubes = 2 if even else 1
          type = dominant qualifying type selected from origin
          apply direct cube flow (2:1 yes, no VP/legitimacy)
```

If both malign and resiliency independently exceed 8 in the same PD, process the type with the larger count; if tied, legitimacy owner chooses. This tie rule is an approved deterministic extension required for executability.

## 8. Objective evaluation

Use the formulas and algorithms in `MALIGN_AI_SCENARIO_DATA_SPEC_v0.1.md`. Objective awards are added at end game for BASE_2025.
