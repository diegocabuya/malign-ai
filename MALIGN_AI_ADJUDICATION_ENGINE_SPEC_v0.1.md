# MALIGN-AI — ADJUDICATION ENGINE SPECIFICATION v0.1

**Fecha:** 2026-08-22  
**Fase:** transición FASE 1 → FASE 2 (diseño del Game Engine)  
**Estado:** DRAFT BASELINE / contrato funcional previo a implementación  
**Código:** NO iniciado  
**Predecesores:** `GAME_SYSTEM_SPECIFICATION v0.1`, `MALIGN_AI_RULE_EFFECT_TAXONOMY_v0.2.md`, `MALIGN_AI_GAME_DATA_MODEL_SPEC_v0.1.md`, `MALIGN_AI_DATA_DICTIONARY_ER_SPEC_v0.1.md`, `DECISIONS.md`

> Este documento especifica **qué debe hacer** el futuro Game Engine / Adjudication Engine de MALIGN-AI y en qué orden. No contiene código de implementación ni sustituye las reglas oficiales. Cuando una regla proviene directamente del Gamebook se marca **OFICIAL**; cuando una laguna fue resuelta por el proyecto se marca **DECISIÓN APROBADA**. El AI Engine nunca ejecuta este contrato.

---

# 1. Propósito

El Adjudication Engine debe transformar:

```text
pre-state + command + authorized choices + RNG/manual die inputs
                         ↓
              deterministic adjudication
                         ↓
post-state + domain events + adjudication trace
```

con las siguientes propiedades:

1. **Determinismo condicionado:** dados, elecciones humanas y decisiones del facilitador son inputs explícitos; dado el mismo conjunto de inputs, el resultado es idéntico.
2. **Atomicidad:** una operación crítica se confirma completa o no se confirma.
3. **Trazabilidad:** toda mutación autoritativa produce eventos y una traza reconstruible.
4. **Fidelidad:** reglas oficiales primero; decisiones MALIGN-AI sólo donde la fuente no basta.
5. **Privacidad:** el motor valida con estado completo, pero sólo publica la proyección autorizada a cada rol.
6. **Separación IA/motor:** un LLM puede proponer un command o explicar un resultado, nunca crear el post-state autoritativo.

---

# 2. Jerarquía de autoridad

Orden de precedencia para adjudicar una partida:

```text
1. Gamebook / regla oficial aplicable
2. Texto impreso de la carta o componente aplicable
3. ScenarioDefinition y ScenarioRuleConfig fijados al iniciar la partida
4. DECISIONS.md aprobado para el ruleset de la partida
5. Regla declarativa del Card Registry / Rule Effect Taxonomy
6. FacilitatorDecision explícita y auditada para una excepción humana concreta
```

Una `FacilitatorDecision` no modifica silenciosamente el ruleset. Si cambia estado o resultado fuera del flujo normal, debe quedar marcada como override.

---

# 3. Fronteras del motor

## 3.1 Responsabilidades del Game Engine

- validar fase, turno, actor, ownership/control y permisos;
- consumir AP y recursos;
- mover cartas entre zonas;
- construir/modificar/envejecer campañas;
- abrir/cerrar Reaction Windows;
- calcular IV/CV, bonuses, costes y modifiers;
- generar/aceptar d10;
- consultar ERT;
- resolver backlash;
- aplicar 2:1;
- actualizar legitimidad;
- puntuar VP;
- resolver habilidades de régimen;
- resolver cartas y Starter Cards;
- viralización;
- evaluación de Victory Objectives;
- cierre/desempate;
- event log y `AdjudicationTrace`.

## 3.2 Fuera del Game Engine

- plausibilidad semántica final de una narrativa;
- moderación de Veto Abuse;
- redacción narrativa;
- interpretación conversacional de intención del usuario;
- sugerencias estratégicas;
- RAG y explicación pedagógica.

Esas funciones pertenecen a Facilitator/AI Engine, sin autoridad directa sobre Game State.

---

# 4. Unidad de ejecución: Command → Resolution

Todo cambio intencional comienza con un `Command` autenticado.

Campos lógicos mínimos:

```text
command_id
idempotency_key
game_id
participant_id
expected_game_version
command_type
payload
submitted_at
```

El motor responde con:

```text
ACCEPTED
REQUIRES_CHOICE
REQUIRES_REACTION
REQUIRES_FACILITATOR
RESOLVED
REJECTED
```

`idempotency_key` impide doble ejecución por reintentos de red.

---

# 5. Taxonomía de errores normativos

Los errores deben ser tipados y nunca depender de texto libre.

```text
WRONG_PHASE
NOT_CURRENT_ACTOR
NOT_AUTHORIZED
GAME_PAUSED
STALE_STATE_VERSION
INSUFFICIENT_AP
INSUFFICIENT_RESOURCES
CARD_NOT_CONTROLLED
CARD_WRONG_ZONE
CARD_NOT_ELIGIBLE
HAND_LIMIT_VIOLATION
CAMPAIGN_ROW_OCCUPIED
CAMPAIGN_NOT_FOUND
CAMPAIGN_NOT_OWNED
CAMPAIGN_ALREADY_ACTIVATED
CAMPAIGN_INVALID_STRUCTURE
CAMPAIGN_ALIGNMENT_MISMATCH
INVALID_SLOT
INVALID_DT
INVALID_TARGET_PD
TARGET_NO_LONGER_EXISTS
REACTION_NOT_ELIGIBLE
REACTION_WINDOW_CLOSED
REGIME_ABILITY_ALREADY_USED
ROLL_MODIFIER_ALREADY_USED
LEGITIMACY_CAP_REQUIRES_CHOICE
INVALID_DIE_VALUE
VOTE_ALREADY_CAST
COST_PAYMENT_FAILED
OBJECT_NO_LONGER_VALID
```

`REJECTED` antes del lock no consume nada. Un fallo durante resolución de una acción ya comprometida sigue DEC-036/040.

---

# 6. Atomicidad y optimistic concurrency

Toda mutación se ejecuta contra `expected_game_version`.

```text
if expected_game_version != current_game_version:
    reject STALE_STATE_VERSION
else:
    validate
    resolve choices / RNG
    apply all mutations atomically
    append events
    increment game version
```

No existe una mutación crítica sin evento asociado.

---

# 7. Máquina de estados de partida

```text
DRAFT
  ↓
LOBBY
  ↓
SETUP
  ↓
STRATEGY_STAGE           # sólo inicio de partida
  ↓
INITIATIVE_STAGE
  ↓
ACTION_STAGE_PLAN
  ↓
ACTION_STAGE_LOCKED
  ↓
RESOLUTION_STAGE
  ↓
CLEANUP_CAMPAIGN_AGING
  ↓
CLEANUP_VIRAL
  ↓
END_TURN_VICTORY_CHECK
  ├─> INITIATIVE_STAGE   # nuevo turno
  └─> END_GAME_SCORING
         ↓
      COMPLETED
```

`PAUSED` es un overlay administrativo: conserva la fase subyacente y bloquea commands de juego salvo Facilitator.

---

# 8. Setup adjudication

Antes de `ACTIVE`, el motor debe validar:

1. exactamente cinco países del MVP;
2. exactamente un jugador controlador por país;
3. exactamente un facilitador;
4. `turn_limit >= 1`;
5. ScenarioDefinition y versions fijadas;
6. 14 PD internas del escenario base;
7. DTs/atributos requeridos por cada PD;
8. influencia inicial con atribución;
9. 108 CardInstances por país conforme DEC-025;
10. cinco Starter separadas;
11. Operations Deck de exactamente 30 cartas no-Starter elegibles;
12. player mat/resource defaults;
13. configuración de `dice_mode`, narrativa y viral variant.

No se inicia la partida con setup parcialmente válido.

---

# 9. Strategy Stage

**OFICIAL:** ocurre una vez al inicio.

## 9.1 Construcción del Operations Deck

```text
pool = 103 non-starter instances owned by country
player selects exactly 30
validate all selected ∈ pool and unique instances
move selected -> OPERATIONS_DECK
shuffle using engine RNG
remaining pool -> OPERATIONS_POOL / inactive
```

## 9.2 Mano inicial

1. mover las 5 Starter del jugador a `HAND`;
2. robar 5 del Operations Deck;
3. ejecutar triggers `ON_CARD_DRAWN` en cada robo;
4. aplicar `HAND_LIMIT_ENFORCE`;
5. resultado esperado: hasta 10 cartas, normalmente 10.

`Protocolos de Seguridad` puede alterar el resultado si su trigger se produce durante un robo.

---

# 10. Initiative Stage

## 10.1 Roll de iniciativa

Cada jugador activo tira un d10.

```text
roll[player] = d10
highest = max(roll)
if unique(highest): winner = player
else: reroll only tied-highest players until unique winner
initiative_order = winner + clockwise seat order
```

Todos los rolls/rerolls quedan auditados (`source=INITIATIVE`).

## 10.2 Maintenance en orden de iniciativa

Para cada jugador:

1. puede elegir cualquier subconjunto de cartas de `HAND` para descartar;
2. se aplican destinos especiales de discard (Starter, stolen cards);
3. elige robar hasta un tamaño final máximo 10; UI default = 10;
4. cada robo es secuencial y dispara `ON_CARD_DRAWN`;
5. si Operations Deck se agota durante la operación, se baraja el Discard propio válido y se continúa;
6. recibe ingreso del turno como `RESOURCE_GAIN`.

### 10.2.1 `Protocolos de Seguridad`

Si durante un `CARD_DRAW` se roba `Filtraciones` y el jugador controla `Protocolos de Seguridad` en HAND:

```text
trigger is mandatory
move Protocolos -> DISCARD
move Filtraciones -> DISCARD
Filtraciones does not become available in HAND
```

En un mantenimiento cuyo objetivo es `draw up to N hand size`, el motor puede seguir robando hasta el tamaño elegido. En un efecto `draw exactly N`, el draw cancelado sigue contando como uno de los N eventos de robo.

---

# 11. Action Stage: planificación simultánea

Cada jugador comienza con:

```text
AP_available = 3
```

## 11.1 Acciones de 1 AP

- `CONSTRUCT_CAMPAIGN`
- `MODIFY_CAMPAIGN`
- `ACTIVATE_CAMPAIGN`
- `PLAY_ACTION_CARD`
- `ACTIVATE_REGIME_ABILITY`

La misma clase puede repetirse si su regla específica lo permite.

## 11.2 Plan ordenado

El jugador crea hasta 3 slots ordenados. Al bloquear el plan:

- AP correspondiente se consume;
- cartas usadas para build/modify/action cards pasan a `PLANNED_ACTION` face-down;
- acciones sin carta quedan representadas como PlannedAction ocultas;
- rivales no reciben payload privado;
- Facilitator conserva visibilidad total;
- después de lock, el jugador no edita el plan salvo override auditado.

## 11.3 Starter Free Play

Antes de bloquear el plan, el jugador puede jugar 0 AP:

### Presupuesto Aumentado

```text
RESOURCE_GAIN +4
remove Starter from game
```

### Política Prioritaria

```text
search up to 2 cards in own Operations Deck
select privately
move selected toward HAND subject to hand limit choice
shuffle remaining Operations Deck
remove Starter from game
```

### Giro de Política

```text
move Giro de Política out of HAND for resolution
process every remaining HAND card:
  normal own card -> own DISCARD
  own Starter -> REMOVED_FROM_GAME
  stolen-return-on-discard card -> original owner
combine own eligible DISCARD + OPERATIONS_DECK
shuffle
CARD_DRAW until 10 or no drawable cards
remove Giro de Política from game
```

`Veto` y `Intención Libre` no usan esta ventana.

## 11.4 Negociación

Durante Initiative y Action planning antes de lock:

- `DEAL_PROMISE` no muta automáticamente recursos/cartas;
- transferencia efectiva requiere confirmación de cada transferidor;
- recursos transferidos no pueden dejar saldo negativo;
- cartas transferibles deben estar en `HAND` y no estar comprometidas;
- negotiated card transfer cambia control persistente; ownership/provenance permanece;
- una carta transferida por acuerdo no tiene `return_on_discard` salvo efecto propio;
- aplicar hand limit al receptor.

---

# 12. Resolution Stage: scheduler

Cuando todos los jugadores están locked (o Facilitator fuerza pass/lock):

```text
for participant in initiative_order:
    for planned_action in participant.actions ordered by sequence_index:
        resolve planned_action
```

Una resolución puede suspenderse en:

- `CHOICE_REQUEST`;
- `REACTION_WINDOW`;
- `VETO_VOTE`;
- `FACILITATOR_VALIDATE_NARRATIVE`;
- `MANUAL_DIE_INPUT`.

Mientras está suspendida, no avanza el siguiente slot.

---

# 13. Construct Campaign

## 13.1 Precondiciones

- actor controla las cartas planificadas;
- Row I está libre al resolver;
- existe exactamente 1 Intent;
- existe exactamente 1 Method;
- Amplifier es 0 o 1;
- cada carta ocupa un solo slot compatible;
- existe un `campaign_alignment` común soportado por todas: `MALIGN` o `RESILIENCY`;
- el DT elegido está permitido por Intent.

## 13.2 Resolución

```text
create Campaign(row=I, owner=actor, alignment, target_dt)
move Intent -> CAMPAIGN_SLOT(INTENT)
move Method -> CAMPAIGN_SLOT(METHOD)
if Amplifier: move -> CAMPAIGN_SLOT(AMPLIFIER)
set revealed = true
set activations_this_turn = 0
```

No hay coste de Resource por construir.

Si Row I se ocupó antes de esta resolución, `INVALIDATED`; cartas reservadas retornan a HAND; AP no se devuelve.

---

# 14. Modify Campaign

## 14.1 Targets permitidos

Campaña propia existente en Row I o II.

Puede:

1. reemplazar Method;
2. reemplazar Amplifier;
3. llenar un Amplifier vacío.

No puede:

- modificar Intent;
- vaciar Method;
- reiniciar edad;
- mover Row II a Row I.

## 14.2 Validación de nueva carta

La carta nueva debe:

- soportar el slot;
- soportar el alignment de la campaña;
- estar controlada por actor y reservada para la acción.

## 14.3 Destino de reemplazada

- normal: DISCARD de su controlador conforme provenance;
- `Identidades Falsas` sólo retorna a hand cuando **la campaña completa** se descarta; reemplazo individual no activa ese texto;
- Starter Intent nunca es target de modify.

---

# 15. Play Action Card — pipeline genérico

Para una Action Card ordinaria planificada:

```text
1. reveal card
2. validate target still legal
3. validate/pay printed mandatory cost
4. open trigger-specific ON_CARD_PLAYED reaction window
5. if effect negated -> consume card, stop
6. resolve card operations atomically
7. move Action Card -> DISCARD (unless special remove rule)
8. enforce postconditions (hand limit, ledgers, events)
```

Un coste pagado antes de una reacción no se reembolsa si la reacción niega el efecto.

---

# 16. Action Cards — adjudicación específica

## 16.1 Acuerdos Comerciales

**AP:** 1.  
**Target:** exactamente otro jugador activo.

```text
actor +2 Resources
target +2 Resources
```

No requiere consentimiento del target.

## 16.2 Agente Doble

**AP:** 1. **Coste:** 1 Resource. **Target:** otro jugador.

1. pagar 1;
2. abrir reacción `Contrainteligencia` para target;
3. si no es negado, crear TemporaryReveal de la mano completa sólo para actor+facilitador;
4. actor selecciona hasta 5 cartas; si hay <=5, todas;
5. ejecutar discard especial de cada una;
6. cerrar TemporaryReveal.

## 16.3 Descartar

**AP:** 1.

1. actor elige 2 cartas de HAND y las descarta;
2. después del discard, elige 1 carta disponible en su propio DISCARD y la mueve a HAND;
3. si tras procesar destinos especiales no existe carta elegible en DISCARD, el paso 2 no produce carta;
4. hand limit.

## 16.4 Filtraciones

**AP:** 1. **Target:** cualquier PD.

```text
generate 3 MALIGN attributed to actor
resolve global 2:1
place remainder
no VP / no legitimacy
```

`Protocolos de Seguridad` no reacciona al play; su trigger aprobado es `ON_CARD_DRAWN`.

## 16.5 Gestión de Crisis

**AP:** 1. **Coste:** 3 Resources. **Target:** una PD cualquiera.

```text
generate 3 RESILIENCY attributed to actor
2:1
place remainder
no VP / no legitimacy
```

## 16.6 Ladrón Encubierto

**AP:** 1. **Target:** otro jugador con al menos una carta controlada en HAND.

1. actor elige a ciegas una posición válida de la mano;
2. motor revela/entrega sólo la carta seleccionada;
3. `owner` original no cambia; `current_controller=actor`;
4. `return_to_owner_on_discard=true`;
5. puede ser Starter;
6. hand limit inmediato en actor.

Al descartarse posteriormente sin ser usada, vuelve al owner. Si una Starter robada es usada, remove-after-use prevalece.

## 16.7 Medidas Activas

**AP:** 1. **Coste:** 1 Resource. **Target:** cualquier campaña existente I/II de cualquier jugador, incluida propia.

`CAMPAIGN_DISCARD` completo con lifecycle de sus cartas. No puntúa.

## 16.8 Sanciones Económicas

**AP:** 1. **Target:** otro jugador.

```text
amount = min(2, target.resources)
transfer amount target -> actor
```

No crea recursos nuevos.

## 16.9 Doble Acción

**AP de carta:** 1. **Coste impreso:** 1 Resource.

1. pagar 1;
2. actor elige una campaña propia existente;
3. generar `CAMPAIGN_EXTRA_ACTIVATION`;
4. la activación extra no consume AP;
5. ignora sólo el límite normal de una activación/turno;
6. paga coste normal de campaña + costes de componentes;
7. usa pipeline completo de narrativa/reacciones/ERT.

## 16.10 Espionaje

**AP:** 1. **Target:** cualquier otro jugador.

```text
n = min(3, target.hand_count)
randomly sample n card instances without replacement
TemporaryReveal selected cards to actor+facilitator
return cards unchanged to target HAND
close reveal
```

## 16.11 Interagencia

**AP:** 1. **Coste:** 1 Resource.

- selecciona privadamente 1 carta del propio Operations Deck;
- selecciona 1 carta elegible de propia HAND;
- la carta de HAND debe ser no-Starter y apta para existir en Operations Deck; no puede ser una carta foreign/stolen con retorno especial;
- swap 1:1;
- barajar Operations Deck;
- hand size no cambia.

## 16.12 Robar

**AP:** 1.

Ejecutar exactamente 3 eventos `CARD_DRAW`, salvo agotamiento total sin discard reciclable. Cada draw puede disparar Protocolos. Al terminar, el jugador elige descartes necesarios para quedar en <=10.

## 16.13 Robo Cibernético

**AP:** 1.

Para cada otro jugador, siguiendo initiative order relativo:

```text
roll d10 source=ACTION_CARD
if roll <= 4:
    transfer min(1, resources) to actor
```

## 16.14 Tarro de Miel

**AP:** 1. **Target:** otro jugador.

```text
target rolls d10
if roll <= 6:
    target chooses one ACTION-class card from HAND and discards it
    if none: no discard
```

Starter no cuenta como Action salvo que su CardDefinition también lo declare, lo que no ocurre en baseline.

## 16.15 ¡Impulso!

**AP:** 1. Debe planificarse y vincularse a una activación posterior del mismo jugador.

- carta queda en `PLANNED_ACTION`;
- al llegar `ON_CAMPAIGN_ROLL`, se revela;
- base rules: `ROLL_MODIFY +1`;
- variante rápida: `+2`;
- después va a DISCARD;
- si la activación vinculada es anulada antes de roll, Boost igualmente se considera acción comprometida; al resolverse su slot queda sin efecto y va a DISCARD.

## 16.16 Corrupción

**AP:** 1. **Coste:** 1 Resource. **Target:** otro jugador.

1. pagar 1;
2. abrir reacción `Leyes Anticorrupción` para target;
3. si reacción no niega: `VP_SUBTRACT_FLOOR_ZERO(2)`.

---

# 17. Reaction Engine

## 17.1 Principios

- sólo triggers explícitos;
- Reaction desde HAND, 0 AP salvo texto;
- prioridad por iniciativa empezando por el siguiente al actor que creó el trigger;
- cada reacción resuelve inmediatamente;
- una reacción puede abrir **una ventana hija** sólo si otro texto impreso reacciona específicamente a esa reacción;
- no existe stack genérico ilimitado;
- cartas usadas se consumen aunque su efecto sea contrarrestado.

## 17.2 Estado

```text
OPEN
WAITING_FOR_PRIORITY_PLAYER
RESOLVING_REACTION
CHILD_WINDOW
CLOSED
```

## 17.3 Pass

Cada jugador elegible puede `PLAY_REACTION` o `PASS`. Tras recorrer todos los elegibles sin nueva reacción, la ventana cierra.

---

# 18. Reacciones específicas

## 18.1 Contrainteligencia

Trigger: target recibe `Agente Doble`.

```text
play -> EFFECT_NEGATE(Agente Doble)
move reaction -> DISCARD
```

El coste de Agente Doble ya pagado no se devuelve.

## 18.2 Leyes Anticorrupción

Trigger: target recibe `Corrupción`.

```text
play reaction
roll d10
if <=4: negate Corrupción
else: no negate
reaction -> DISCARD
```

## 18.3 Contraataque Informático (Hack Back)

Trigger: una campaña MALIGN que contiene `Ciberataque` apunta a PD del país del reactor.

```text
play -> pending NEGATE_CAMPAIGN_ACTIVATION
open child trigger for Ciberseguridad on original campaign actor
if child does not negate Hack Back:
    campaign activation NEGATED
reaction -> DISCARD
```

## 18.4 Ciberseguridad

Trigger: actor original es objetivo de `Contraataque Informático/Hack Back`.

```text
play -> negate Hack Back
Ciberseguridad -> DISCARD
Hack Back -> DISCARD
campaign continues
```

## 18.5 Derecho preferente de compra

Trigger: campaña revelada/activada en `PRE_ROLL_REACTION_WINDOW`.

```text
play
roll d10
if <=4:
    discard whole campaign
    activation INVALIDATED
reaction -> DISCARD
```

Si la campaña desaparece, la ventana cierra y no se pagan costes de campaña.

## 18.6 Veto

Trigger: narrativa de campaña declarada, antes de roll.

1. jugador elegible juega Veto;
2. Veto se marca consumida y eventualmente `REMOVED_FROM_GAME`;
3. facilitator puede rechazar el intento por `VETO_ABUSE` **antes de aceptar el PLAY_REACTION**; si lo hace, el command se rechaza sin mutación de la carta y se registra la razón;
4. actor de Veto registra breve objeción;
5. actor de campaña registra defensa breve;
6. todos los jugadores activos emiten exactamente un voto `ACCEPTABLE | UNACCEPTABLE`;
7. si `UNACCEPTABLE > active_players/2`, campaña completa se descarta y el actor no puede activar otra campaña durante ese turno;
8. de lo contrario continúa;
9. Veto usada se retira del juego.

Pueden ocurrir múltiples Veto secuenciales de distintos jugadores mientras la campaña siga existiendo y la ventana continúe abierta.

---

# 19. Narrative Rule

Antes de cualquier campaña activation:

1. actor entrega narrativa;
2. modo strict exige 2–3 oraciones;
3. `<2` bloquea el avance hasta corregir o Facilitator override;
4. `>3` en strict aplica `RANDOM_CARD_SELECT(1)` de HAND y discard;
5. en beginner leniency, la longitud produce warning y Facilitator decide si aplica sanción;
6. si Facilitator confirma que el jugador simplemente leyó el texto de cartas, `RANDOM_CARD_SELECT(min(2, hand_count))` y discard;
7. IA sólo puede señalar similitud/plausibilidad; no sanciona;
8. el texto de narrativa y cualquier FacilitatorDecision quedan en traza.

Las cartas ya comprometidas en `PLANNED_ACTION` no son elegibles para random discard de HAND.

---

# 20. Campaign Activation — contrato principal

## 20.1 Elegibilidad

Campaña:

- propia;
- en Row I o II;
- Intent presente;
- Method presente;
- alignment coherente;
- no activada ya este turno, salvo `EXTRA_ACTIVATION`;
- target PD seleccionada al resolver;
- target PD posee el `target_dt` de la campaña.

El target PD puede cambiar entre activaciones; el DT de campaña no cambia.

## 20.2 Pipeline normativo

```text
A. validate activation/AP commitment
B. choose target PD
C. reveal campaign/target DT if needed
D. validate structure, alignment, DT-target
E. submit narrative
F. narrative sanctions / facilitator tags
G. PRE_ROLL_REACTION_WINDOW
   G1 Veto
   G2 Right of First Refusal
   G3 Cyber reaction chain when eligible
   if campaign removed/activation negated -> STOP
H. compute base_cv
I. determine base_cost_tier
J. compute card-specific activation costs
K. pay campaign activation cost + card-specific costs
   if cannot pay -> FAILED_COST, STOP
L. process pending Fluma resource-spend triggers
M. COALITION_CONTRIBUTION_WINDOW if card present
N. compute all valid card pair bonuses
O. effective_cv = base_cv + pair bonuses + coalition contributions
P. resolution_tier = LOW/MEDIUM/HIGH
Q. optional core roll modifier (2 Resources -> +1 once/turn) OR configured AP variant
R. apply planned Boost if linked
S. apply Legitimacy +1 if actor owns legitimacy at target PD
T. roll d10
U. modified_roll_raw = die + modifiers
V. ert_roll = clamp(modified_roll_raw,1,10)
W. lookup ERT by campaign alignment/tier/ert_roll
X. classify ERT result
Y. generate cubes or backlash cubes
Z. resolve 2:1 with actor choices
AA. place remainder
AB. campaign scoring/legitimacy if applicable
AC. backlash VP if applicable
AD. objective narrative tags / post effects
AE. increment activation counters
AF. append trace/events
```

---

# 21. Campaign Value

## 21.1 Base CV

```text
base_cv = IV(Intent in Intent slot)
        + IV(Method in Method slot)
        + IV(Amplifier in Amplifier slot if present)
```

Una multi-slot card aporta sólo el IV del slot ocupado.

Rango base del registry actual: `3..15`.

## 21.2 Tier y coste

```text
3..6  => LOW    => 1 Resource
7..11 => MEDIUM => 2 Resources
12..15 => HIGH  => 3 Resources
```

Coste usa `base_cv`, nunca bonus CV.

## 21.3 Costes adicionales de componentes

Por cada activación de campaña:

- `Ejercicios Militares`: +1 Resource si está asignada;
- `Movilización Militar`: +3 Resources si está asignada.

Se suman al coste del tier.

## 21.4 Pair bonuses

Cada bonus válido se aplica una vez por instancia/trigger por activación. Todas las referencias se resuelven por `card_definition_id`/alias aprobado.

Baseline de pares:

| Carta | Requiere | Bonus |
|---|---|---:|
| Agravios Históricos | Temas Divisivos | +2 |
| Campaña de Alfabetización Mediática | Curso de Alfabetización Mediática | +2 |
| #Campaña | Influencers | +2 |
| Campaña de Hostigamiento | Doxing | +2 |
| Apps de Chat | Desinformación | +2 |
| Astroturfing | Agravios Históricos | +2 |
| Censura Doméstica | Control Editorial | +2 |
| Comentaristas Políticos | Cámara de Eco | +2 |
| Microtargeting | Temas Divisivos | +2 |
| Seguridad Electoral | Efectos Nacionales | +2 |
| Desinformación Electoral | Manipulación Electoral | +2 |
| Diásporas | Protestas Organizadas | +2 |
| Emitir Códigos y Estándares | Política Coordinada | +2 |
| Foros en Línea | Radicalización en Línea | +2 |
| Fortalecer Instituciones | Cohesión Social | +2 |
| Guerra Jurídica | Organizaciones Internacionales | +2 |
| Lista Blanca | Verificación de Hechos | +2 |
| Memes Maliciosos | Ejército de Bots | +2 |
| Presión Económica | Asociaciones Público-Privadas | +2 |
| Radicalización en Línea | Teoría Conspirativa | +2 |
| Regulación de Plataformas | Asociaciones Público-Privadas | +2 |
| Videos de Propaganda | Deepfake | +2 |
| Operación de Desinformación | Ejército de Bots | +2 |

## 21.5 Construcción de Coalición

Si la campaña contiene `Construcción de coalición`:

1. después de reacciones y pago de coste base, abrir Contribution Window;
2. cada **otro** jugador puede contribuir 0 o 1 Resource;
3. sólo se acepta si dispone de Resource en ese momento;
4. cada Resource pagado = `effective_cv +1`;
5. contribuciones son públicas al resolver;
6. cada pago puede disparar Patrocinio Extranjero de Fluma si corresponde.

## 21.6 Effective CV

```text
effective_cv = base_cv + Σ(pair_bonus) + coalition_bonus + other explicit CV modifiers
```

Para ERT:

```text
if effective_cv <= 6: LOW
elif effective_cv <= 11: MEDIUM
else: HIGH
```

Aunque `effective_cv >15`, permanece HIGH y se conserva raw para auditoría.

---

# 22. Modificadores de tirada de campaña

## 22.1 Modificador core

Una vez por jugador/turno:

```text
spend 2 Resources before roll
ROLL_MODIFY +1
```

Si la variante rápida está activa, sustituir por un AP planificado/reservado de 1 para +1 y no pagar 2 Resources.

## 22.2 Boost

- normal: +1;
- variante rápida: +2.

## 22.3 Legitimidad

Si el actor posee el marker en target PD al momento del roll:

```text
ROLL_MODIFY +1
```

## 22.4 Lookup

```text
die ∈ 1..10
modified_roll_raw = die + all applicable modifiers
ert_roll = clamp(modified_roll_raw,1,10)
```

---

# 23. ERT

Tabla autoritativa:

| d10 | LOW M/R | MEDIUM M/R | HIGH M/R |
|---:|---|---|---|
| 1 | -2/-1 | -2/-1 | -2/-1 |
| 2 | -1/-1 | -1/0 | -1/0 |
| 3 | -1/0 | -1/0 | 0/0 |
| 4 | 0/0 | 0/0 | +1/+1 |
| 5 | 0/0 | +1/+1 | +1/+1 |
| 6 | +1/+1 | +1/+1 | +2/+2 |
| 7 | +1/+1 | +2/+2 | +3/+3 |
| 8 | +1/+1 | +2/+2 | +3/+3 |
| 9 | +2/+2 | +3/+3 | +4/+4 |
| 10 | +2/+2 | +3/+3 | +4/+4 |

M/R = Malign / Resiliency.

## 23.1 Outcome classification

```text
ERT_BACKLASH       result < 0
ERT_NO_EFFECT      result = 0
ERT_POSITIVE       result > 0
```

Después de 2:1 se añade clasificación de board effect:

```text
NO_CUBE_PLACED
CUBE_PLACED
```

Una campaña puede ser `ERT_POSITIVE + NO_CUBE_PLACED` si todos los cubos generados se consumen cancelando oposición.

---

# 24. Backlash

Si ERT devuelve negativo:

- cantidad = abs(result);
- tipo = opuesto al alignment de campaña;
- atribución = país del actor de la campaña;
- 2:1 global normal;
- no establishment/subversion de legitimidad;
- VP del actor: `-1` por backlash cube que **permanece colocado**, floor 0.

---

# 25. Algoritmo de cubos 2:1

Inputs:

```text
incoming_type
incoming_count = N
incoming_attribution
PD current opposite stacks by attribution
```

Algoritmo:

```text
pairs_possible = floor(N / 2)
removable = min(pairs_possible, total_opposite_existing)
for i in 1..removable:
    actor chooses one opposite attribution with count > 0
    consume 2 incoming
    remove 1 opposite from chosen attribution
remaining_incoming = N - 2*removable
place remaining_incoming as incoming_type/incoming_attribution
```

La elección de atribución removida forma parte de la traza.

Propiedades:

- influencia ya colocada anteriormente en el turno es `pre-existing` para resoluciones posteriores;
- no se cancela 1:1;
- no se remueven cubos del mismo tipo;
- no se crean saldos negativos.

---

# 26. Scoring de campaña

Sólo `ERT_POSITIVE` entra al flujo de VP positivo.

```text
placed = incoming cubes remaining after 2:1
VP += placed
```

Si `placed=0`, no hay VP por cubos ni legitimidad.

## 26.1 Legitimidad

Si `placed>=1`:

### Caso A — PD sin marker

- establecer actor si cap lo permite/actor reemplaza uno propio;
- +1 VP por establishment si realmente se establece.

### Caso B — marker ya es del actor

- marker permanece;
- no bonus adicional.

### Caso C — marker pertenece a otro jugador

- retirar marker ajeno;
- actor recibe +1 VP por subversion;
- **no** colocar marker del actor todavía;
- requerirá otra campaña exitosa posterior.

---

# 27. Campaign lifecycle y discard

Cuando una campaña completa abandona el mat por Veto, Right of First Refusal, Medidas Activas o Cleanup:

para cada CardInstance asignada:

1. si `Intención Libre` Starter -> `REMOVED_FROM_GAME`;
2. si tiene `return_to_owner_on_discard` -> original owner HAND, luego hand limit;
3. si `Identidades Falsas` controlada legítimamente -> HAND de su controlador/owner, luego hand limit;
4. en otro caso -> DISCARD del controlador actual.

Después eliminar/archivar Campaign state.

`Identidades Falsas` no retorna al hand si sólo fue reemplazada mediante Modify; en ese caso usa discard normal.

---

# 28. Regime Abilities

Cada habilidad consume 1 AP y sólo puede intentarse una vez por turno.

## 28.1 Arden — Unidad Nacional

```text
roll d10 independent
if <=4:
    actor chooses one own-country PD with MALIGN >0
    remove 1 MALIGN, actor chooses attribution if multiple
```

No VP/legitimidad.

## 28.2 Fluma — Patrocinio Extranjero

Al revelar la habilidad, queda activa para **todo el ciclo Action+Resolution** del turno conforme DEC-013.

Implementación funcional:

1. desde `ACTION_STAGE_LOCKED`, el motor registra en cola privada todos los `RESOURCE_SPEND` de otros jugadores que califican como coste de acción/carta/campaña;
2. cuando la Regime Ability de Fluma se revela, procesa retroactivamente los spends calificantes ya registrados;
3. permanece suscrita a spends posteriores hasta fin de Resolution;
4. por cada unidad gastada, Fluma elige una PD de Arden y genera 2 MALIGN atribuidos a Fluma;
5. cada trigger resuelve 2:1 inmediatamente;
6. no VP/legitimidad;
7. una unidad de Resource sólo puede generar un trigger.

No cuentan transferencias, ingresos ni pérdida de VP; sí cuentan campaign costs, card costs, coalition contributions y el gasto core de 2 Resources para +1 roll.

## 28.3 Ursaria — Controles Internos

Al resolver:

- debe controlar al menos 2 cartas con soporte/alineación MALIGN en HAND; dual con icono maligno califica;
- elige 2 y descarta;
- elige una PD propia;
- elimina hasta 3 MALIGN existentes de esa PD, eligiendo atribución por cubo;
- si no puede pagar el coste de 2 cartas, no hay efecto y el intento queda consumido.

## 28.4 Presque — Líder Internacional

```text
roll d10 independent
if <=4:
    choose any PD
    if Presque already has 3 markers:
        remove one own marker first
    remove existing foreign marker if any
    place Presque marker
```

No VP por establishment/subversion.

## 28.5 Dinesia — Compra de Favor

```text
pay 2 Resources
choose one own-country PD
generate 1 RESILIENCY attributed to Dinesia
2:1
place remainder
```

No VP/legitimidad.

---

# 29. Resource ledger semantics

Toda mutación usa ledger append-only.

Tipos mínimos:

```text
INCOME
STARTER_GAIN
ACTION_COST
CAMPAIGN_COST
CARD_COMPONENT_COST
ROLL_MODIFIER_COST
COALITION_CONTRIBUTION
DEAL_TRANSFER
FORCED_TRANSFER
ACTION_GAIN
FACILITATOR_ADJUSTMENT
```

Saldo nunca <0.

`RESOURCE_SPEND` que puede disparar Fluma debe incluir `spend_unit_ids` o equivalente para garantizar exactly-once.

---

# 30. VP ledger semantics

Tipos mínimos:

```text
CAMPAIGN_CUBE_PLACED
LEGITIMACY_ESTABLISHED
LEGITIMACY_SUBVERTED
BACKLASH_PENALTY
CORRUPTION_PENALTY
VICTORY_OBJECTIVE_AWARD
FACILITATOR_ADJUSTMENT
```

VP in-game tiene floor 0. No existe cap superior digital.

---

# 31. Cleanup — Campaign Aging

Al terminar todas las resoluciones:

snapshot de campañas por jugador.

Para cada jugador, conceptualmente simultáneo:

```text
if campaign.row == II:
    discard whole campaign
elif campaign.row == I:
    move campaign -> II
```

Después:

- reset `activations_this_turn` para campañas supervivientes;
- reset `regime_ability_used_this_turn`;
- reset core roll modifier usage;
- desarmar Fluma y cerrar trigger queue;
- limpiar flags temporales de plan/reacción.

---

# 32. Cleanup — Viral Mechanic

## 32.1 Snapshot de elegibilidad

Después de aging, calcular por PD:

```text
total_malign
total_resiliency
legitimacy_owner
```

Baseline threshold: `>8`. Variante corta: `>6`.

El origen necesita:

- legitimacy owner;
- al menos un tipo calificante;
- al menos 1 cube atribuido al legitimacy owner del tipo que se propagará;
- al menos un destino distinto que comparta >=1 DT activo.

## 32.2 Tipo a propagar

- sólo malign > threshold -> MALIGN;
- sólo resiliency > threshold -> RESILIENCY;
- ambos > threshold -> el de mayor total;
- empate -> legitimacy owner elige.

## 32.3 Orden

Procesar origins del snapshot por:

1. initiative rank de legitimacy owner;
2. `pd_id` estable.

Cada origin máximo una vez.

## 32.4 Resolución baseline

1. owner elige destination que comparte DT;
2. roll d10;
3. si `<6`: falla;
4. si `>=6`: segundo d10;
5. par -> 2 cubes; impar -> 1;
6. cubes del tipo elegido, attributed al legitimacy owner;
7. aplicar direct cube flow 2:1;
8. no VP/legitimidad.

## 32.5 Variante corta

Conforme DEC-019:

- threshold >6;
- se conserva el primer d10 de propagación y éxito con `>=6`;
- no existe segundo dado;
- una propagación exitosa añade exactamente 1 cube.

Nuevos destinos que superen threshold por esta propagación no viralizan hasta el turno siguiente.

---

# 33. Victory Objectives — funciones base

Evaluación intermedia puede calcularse privadamente, pero los awards BASE_2025 se materializan al final.

Funciones:

```text
total_malign(pd)
total_resiliency(pd)
net_total_malign(pd)
net_total_resiliency(pd)
attributed_malign(country,pd)
attributed_resiliency(country,pd)
net_attributed_malign(country,pd)
net_attributed_resiliency(country,pd)
```

## 33.1 Arden

- HARD: attributed_malign(ARDEN, FLUMA_PD_2) >5 => +15
- MEDIUM: net_attributed_resiliency(ARDEN, FLUMA_PD_1) >3 => +7
- EASY: +5 por cada Arden PD con total_resiliency >2

## 33.2 Ursaria

- HARD: sum attributed_malign en Arden >7 => +20
- MEDIUM: cada PD cristiana de Presque con net_attributed_malign >=2 => +7
- EASY: +5 por país extranjero con al menos una PD donde attributed_malign >=2

## 33.3 Presque

- HARD: >=2 PD de Dinesia con attributed_malign >3 => +15
- MEDIUM: +5 por Arden PD con net_attributed_resiliency >2; +5 si las 3
- EASY: +3 por Presque PD con total_resiliency >2; +5 si las 3

## 33.4 Fluma

- HARD: Arden M y L ambas net_total_malign >3 => +20
- MEDIUM: Fluma Liberty net_total_resiliency >=4 y > Worker’s Front => +10
- EASY: sólo eventos/cubos con narrative tag aprobado; +3 por PD extranjera con net_attributed_resiliency >2; +5 bonus si hay PD M/L calificante en >=3 países distintos

## 33.5 Dinesia

- HARD: todas Presque PD net_total_malign >2 => +20
- MEDIUM: +5 por Dinesia PD con net_total_resiliency >1; +5 si todas
- EASY OR: Fluma Liberty net_attributed_resiliency >2 OR Fluma Worker’s Front net_attributed_malign >2 => +5 máximo una vez

Los awards se materializan una sola vez por objective/partida.

---

# 34. End Turn / End Game

Después de Viral:

1. evaluar cualquier condición `instant_victory=true` del ScenarioDefinition;
2. BASE_2025 no tiene instant victory;
3. si `turn_number < turn_limit`, cerrar turno e iniciar nueva Initiative Stage;
4. si `turn_number == turn_limit`, ejecutar End Game Scoring.

## 34.1 Final scoring

```text
for each country:
    objective_vp = evaluate Secret VOs
    materialize VP awards
    final_vp = current_vp
winner_set = countries with max(final_vp)
```

## 34.2 Tiebreak

Si hay empate:

```text
own_country_malign(country) = sum MALIGN cubes in PD hosted by country
```

Gana entre empatados quien tenga menor `own_country_malign`.

Si persiste empate: resultado compartido; no tercer tiebreaker inventado.

---

# 35. Dice Service

## 35.1 DIGITAL

El Game Engine genera d10 1..10 mediante RNG independiente del LLM.

Registrar:

```text
die_roll_id
source
raw_value
rng_request_id
created_at
```

## 35.2 MANUAL_DIE_INPUT

- sólo valores 1..10;
- registrar submitter;
- marcar `manual=true`;
- Facilitator puede exigir confirmación;
- el motor aplica los mismos modifiers posteriores que en digital.

---

# 36. Choice Engine

Toda elección que pueda cambiar el resultado es una entidad auditada, no un parámetro oculto.

Tipos mínimos:

```text
SELECT_TARGET_PD
SELECT_DT
SELECT_CARD_FROM_HAND
SELECT_CARD_FROM_DISCARD
SELECT_DECK_CARD
SELECT_OPPOSITE_ATTRIBUTION_TO_REMOVE
SELECT_LEGITIMACY_TO_REPLACE
SELECT_VIRAL_DESTINATION
SELECT_VIRAL_TYPE_ON_TIE
COALITION_CONTRIBUTION
VETO_VOTE
```

Cada choice incluye actor autorizado, options calculadas por el motor y selección final.

---

# 37. Información y visibilidad durante adjudicación

## 37.1 Público

Después de revelar/resolver según timing:

- acción revelada;
- campaña face-up;
- narrativa;
- target PD;
- recursos públicos/saldos;
- tiradas y modifiers públicos;
- ERT result;
- cambios de cubes/legitimacy/VP;
- Veto y votos/resultados conforme UI aprobada.

## 37.2 Privado

- HAND;
- Operations Deck order;
- acciones todavía face-down;
- DT/planes aún ocultos cuando aplique;
- Secret VOs;
- TemporaryReveal de Espionaje/Agente Doble;
- negociación privada.

El facilitador puede ver todo. AI context se deriva **después** del authorization filter.

---

# 38. Facilitator Intervention

El facilitador puede:

- pause/resume;
- force pass/lock por desconexión o administración;
- validar sanción de narrativa;
- bloquear Veto abusivo;
- introducir/confirmar dado manual;
- resolver excepción no contemplada;
- corregir estado.

Toda corrección autoritativa requiere:

```text
facilitator_decision_id
reason_code
free_text_reason
pre_state_reference
mutation/decision
post_state_reference
created_at
```

Una corrección genera `GAME_STATE_OVERRIDE_AUDITED` y puede marcar la partida `noncanonical=true` para AAR si altera reglas/resultados.

---

# 39. AdjudicationTrace

Cada resolución importante debe poder reconstruirse sin pedir explicación al LLM.

Campos mínimos para campaña:

```text
activation_id
turn / phase / initiative rank / action slot
actor / country
campaign_id / row / activation ordinal
Intent / Method / Amplifier instance IDs
alignment / target_dt / target_pd
narrative_id / facilitator narrative tags
reaction window + reactions + votes
base IVs
base_cv
pair bonuses
coalition contributors
other CV modifiers
effective_cv
base tier / base cost
card-specific costs
all Resource transactions
core roll modifier / Boost / legitimacy modifier
die raw
modified_roll_raw
ert_roll normalized
ERT tier / result
outcome class
generated cube type/count/attribution
2:1 incoming consumed
opposite cube removals by attribution
placed count
legitimacy before/after
VP transactions
objective tags
state hash before / state hash after
ruleset/scenario/card registry versions
```

---

# 40. Domain events mínimos

```text
GAME_STARTED
TURN_STARTED
INITIATIVE_ROLLED
INITIATIVE_REROLLED
INITIATIVE_ORDER_SET
CARDS_DISCARDED
CARD_DRAWN
DECK_RESHUFFLED
RESOURCE_GAINED
RESOURCE_SPENT
RESOURCE_TRANSFERRED
STARTER_PLAYED
STARTER_REMOVED
ACTION_PLAN_LOCKED
ACTION_REVEALED
ACTION_INVALIDATED
ACTION_NEGATED
CAMPAIGN_CREATED
CAMPAIGN_MODIFIED
CAMPAIGN_ACTIVATION_STARTED
CAMPAIGN_ACTIVATION_COMPLETED
CAMPAIGN_DISCARDED
REACTION_WINDOW_OPENED
REACTION_PLAYED
REACTION_NEGATED
REACTION_WINDOW_CLOSED
NARRATIVE_SUBMITTED
NARRATIVE_PENALTY_APPLIED
VETO_STARTED
VETO_VOTE_CAST
VETO_RESOLVED
DIE_ROLLED
CV_CALCULATED
CAMPAIGN_COST_PAID
COALITION_CONTRIBUTED
ERT_RESOLVED
CUBES_GENERATED
CUBES_CANCELLED_2_TO_1
CUBES_PLACED
CUBES_REMOVED
LEGITIMACY_ESTABLISHED
LEGITIMACY_SUBVERTED
LEGITIMACY_REMOVED
VP_CHANGED
REGIME_ABILITY_RESOLVED
VIRAL_ATTEMPTED
VIRAL_SPREAD_RESOLVED
CAMPAIGN_AGED
OBJECTIVE_EVALUATED
OBJECTIVE_AWARDED
GAME_COMPLETED
FACILITATOR_OVERRIDE
```

---

# 41. Invariantes globales del motor

1. AP por jugador/turno nunca <0 y baseline no >3 consumidos en plan salvo regla futura explícita.
2. Resources nunca <0.
3. VP nunca <0.
4. HAND estable nunca >10.
5. Una CardInstance sólo ocupa una zone autoritativa a la vez.
6. Una campaña tiene exactamente un Intent y un Method mientras exista como campaña activable.
7. Cada CampaignSlot contiene máximo una CardInstance.
8. Row I y Row II contienen máximo una campaña cada una.
9. Una normal activation por campaña/turno; extra sólo por efecto explícito.
10. Una Regime Ability attempt por jugador/turno.
11. Un core roll modifier por jugador/turno.
12. Una PD tiene máximo un Legitimacy Marker.
13. Un jugador tiene máximo 3 markers.
14. Todo cube count es entero no negativo.
15. Toda influencia/resiliencia tiene attribution/provenance.
16. Toda mutación de Resources/VP tiene ledger entry.
17. Toda tirada tiene DieRoll.
18. Toda adjudicación de campaña tiene AdjudicationTrace.
19. VOs secretos nunca se proyectan a jugadores no autorizados.
20. AI Engine no posee command authority sobre mutaciones críticas sin confirmación del usuario/flujo autorizado y validación del Game Engine.

---

# 42. Deterministic test oracle

Cada regla crítica debe poder probarse con el patrón:

```text
Given:
  pre-state fixture
  ruleset/scenario versions
  command
  deterministic choices
  deterministic die values
When:
  adjudicate
Then:
  exact post-state
  exact domain events
  exact ledgers
  exact adjudication trace
  no unauthorized visibility leakage
```

El motor se considera correcto sólo si estado, eventos y traza coinciden.

---

# 43. Casos de prueba obligatorios derivados de esta especificación

Como mínimo, la futura suite debe cubrir:

1. initiative tie con múltiples rerolls;
2. deck exhaustion + reshuffle durante fill-to-10;
3. Protocolos de Seguridad durante draw;
4. Starter play + hand limit;
5. build Intent+Method sin Amplifier;
6. modify Row II;
7. fill empty Amplifier;
8. action order: Action Card antes/después de activation;
9. campaign activation normal repeat rejected;
10. Doble Acción repeat accepted;
11. Veto accepted/rejected/tie;
12. Right of First Refusal success/failure;
13. Ciberataque → Hack Back → Ciberseguridad;
14. Anti-Corruption success/failure;
15. base CV cost vs bonus CV ERT tier;
16. effective CV >15 -> HIGH;
17. extra card-specific costs;
18. insufficient resource after prior forced transfer;
19. coalition 0..4 contributors;
20. core +1 modifier once/turn;
21. roll >10 after modifiers clamps 10;
22. ERT backlash;
23. ERT positive but all incoming consumed by 2:1;
24. 2:1 removal choice across multiple attributions;
25. legitimacy establishment, same-owner, subversion;
26. fourth legitimacy replacement/renunciation;
27. direct cube effects do not score;
28. Fluma retroactive resource spend triggers;
29. Ursaria discard dual malign cards;
30. Presque replaces foreign legitimacy without VP;
31. Dinesia direct resilience 2:1;
32. Identidades Falsas on whole campaign discard;
33. stolen card return-on-discard;
34. stolen Starter use/discard;
35. Policy Pivot with other Starter cards in hand;
36. Sanciones target with 0/1/2+ Resources;
37. Cyber Theft player with 0 Resources;
38. viral no legitimacy;
39. viral legitimacy owner has no attributed qualifying cube;
40. multiple viral origins snapshot no cascade;
41. both influence types > threshold tie choice;
42. each base Victory Objective;
43. final tie broken by least malign in own country;
44. persistent tie => shared result;
45. manual die audit;
46. facilitator override marks trace/noncanonical;
47. authorization tests for hand/VO/temp reveal.

---

# 44. Criterio de cierre de la especificación

Esta v0.1 se considera suficiente para pasar a una **Game Engine Test & Acceptance Specification** cuando:

- las reglas core tienen pipeline;
- cartas de Acción/Reaction/Starter tienen timing y efecto computable;
- campañas y ERT son determinísticos;
- edge cases aprobados están incorporados;
- todas las mutaciones críticas tienen evento/traza;
- no quedan OPEN QUESTIONS bloqueantes para el MVP base.

Se cumple ese criterio con el baseline actual.

---

# 45. Próximo entregable recomendado

`MALIGN-AI — GAME ENGINE TEST & ACCEPTANCE SPECIFICATION v0.1`

Objetivo: convertir cada invariante, regla, carta y escenario en casos de prueba Given/When/Then antes de escribir el Game Engine. Esto permitirá implementar posteriormente con TDD/regression fixtures y comparar el software contra el juego físico sin depender de juicio del LLM.
