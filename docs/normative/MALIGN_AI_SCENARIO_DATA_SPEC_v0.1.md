# MALIGN-AI — SCENARIO DATA SPECIFICATION v0.1

**Fase:** 0 — Análisis y especificación  
**Estado:** BASELINE APROBADA PARA EL ESCENARIO BASE 2025  
**Código:** no iniciado  

## 1. Fuente y criterio

La narrativa, setup de PD y Victory Objectives proceden del Gamebook. Los assets físicos se utilizan para mapear la versión de tablero entregada. Donde existe contradicción de numeración, rige `DEC-003`: IDs internos semánticos + etiquetas de fuente separadas.

El escenario del Gamebook describe cinco actores jugables aunque el texto narrativo use la expresión "4 major nations"; Fluma funciona como República/Territorio separatista y sigue siendo una facción jugable.

## 2. Identidad del escenario

```text
scenario_id: BASE_2025
name: Malign Base Scenario — 2025
factions: [ARDEN, FLUMA, URSARIA, PRESQUE, DINESIA]
recommended_player_model: one_player_per_country
turn_limit: REQUIRED_GAME_CONFIGURATION
instant_victory_enabled: false
viral_rule: BASE
strategy_deck_size: 30
starter_cards_per_player: 5
hand_limit: 10
base_ap_per_turn: 3
```

`turn_limit` no tiene un valor oficial en la tabla del escenario; el facilitador debe fijarlo antes del inicio (`DEC-004`).

## 3. Países

| Country ID | Nombre | Régimen físico | Starting Resources | Turn Income | Board color family |
|---|---|---|---:|---:|---|
| PRESQUE | Presque | Democracia Multipartidista | 3 | 2 | naranja |
| DINESIA | Dinesia | Democracia Experimental | 4 | 3 | morado |
| URSARIA | Ursaria | Autoritaria | 3 | 2 | rojo |
| FLUMA | Republic of Fluma / Fluma | Territorio Democrático | 2 | 1 | verde oliva |
| ARDEN | Arden | Democracia Bipartidista | 2 | 2 | verde oscuro |

## 4. Taxonomías normalizadas

### Population size
- `S` = Small
- `M` = Medium
- `L` = Large

### Ethnicity/Race IDs
- `WHITE`
- `BLACK`
- `NATIVE`
- `HISPANIC`
- `ASIAN`

### Religion IDs
- `CHRISTIAN`
- `ISLAM` (aliases: Muslim, Islam)
- `NONE` (aliases: No Religion, No Religious Affiliation)

### Education IDs
- `LT_HIGH_SCHOOL`
- `HIGH_SCHOOL`
- `UNIVERSITY`
- `ADVANCED`

## 5. Mapeo canónico de PD

| Internal PD ID | Country | local_index | Gamebook label | Board label | Size | Political Party | Race | Religion | Education | Initial influence |
|---|---|---:|---:|---:|---|---|---|---|---|---|
| PRESQUE_PD_1 | Presque | 1 | 1 | 1* | S | Clean Earth Party | Black | Christian | Advanced | 1 Resiliency, attribution=Presque |
| PRESQUE_PD_2 | Presque | 2 | 2 | 2 | M | Republican Forum | Asian | Christian | University | 2 Resiliency, attribution=Presque |
| PRESQUE_PD_3 | Presque | 3 | 3 | 3 | L | Socialist Party | White | Christian | University | 6 Resiliency, attribution=Presque |
| DINESIA_PD_1 | Dinesia | 1 | 18 | 4 | M | Dinesia People's Party | Black | None | High School | 1 Malign, attribution=Ursaria |
| DINESIA_PD_2 | Dinesia | 2 | 19 | 5 | L | People's Democratic | Asian | Christian | Advanced | 3 Resiliency, attribution=Dinesia |
| DINESIA_PD_3 | Dinesia | 3 | 20 | 6 | S | People's Democratic | White | Christian | High School | 2 Malign, attribution=Presque |
| URSARIA_PD_1 | Ursaria | 1 | 4 | 7 | S | Ursaria People's Party | White | None | < High School | 1 Malign, attribution=Presque |
| URSARIA_PD_2 | Ursaria | 2 | 5 | 8 | L | Ursaria People's Party | Asian | Christian | University | 3 Resiliency, attribution=Ursaria |
| URSARIA_PD_3 | Ursaria | 3 | 6 | 9 | M | Central Party | Native | Christian | University | 1 Malign, attribution=Arden |
| FLUMA_PD_1 | Fluma | 1 | 7 | 10 | S | Worker's Front | Native | None | High School | 1 Malign, attribution=Ursaria |
| FLUMA_PD_2 | Fluma | 2 | 8 | 11 | L | Liberty Party | Native | Christian | University | 4 Resiliency, attribution=Fluma |
| ARDEN_PD_1 | Arden | 1 | 9 | 12 | S | Citizen's Democrat | Asian | None | Advanced | 2 Resiliency, attribution=Arden |
| ARDEN_PD_2 | Arden | 2 | 10 | 13 | M | New Republican | Black | Islam | High School | 1 Resiliency, attribution=Arden |
| ARDEN_PD_3 | Arden | 3 | 11 | 14 | L | New Republican | White | Christian | University | 6 Resiliency, attribution=Arden |

`*` El asset físico imprime `0`; MALIGN-AI lo trata como error gráfico y lo mapea a 1 conforme a DEC-003.

## 6. Representación de influencia inicial

La inicialización debe crear registros de influencia atribuida, no sólo totales. Ejemplo:

```text
InfluenceStack
  pd_id: DINESIA_PD_1
  type: MALIGN
  count: 1
  attribution_country: URSARIA
  source: SCENARIO_SETUP
```

El campo `attribution_country` es el usado por los Victory Objectives que requieren influencia `attributed`.

## 7. Funciones de evaluación de estado

```text
total_malign(pd) = sum(MALIGN all attributions)
total_resiliency(pd) = sum(RESILIENCY all attributions)

net_total_malign(pd) = total_malign(pd) - total_resiliency(pd)
net_total_resiliency(pd) = total_resiliency(pd) - total_malign(pd)

attributed_malign(player,pd) = MALIGN attributed to player
attributed_resiliency(player,pd) = RESILIENCY attributed to player

net_attributed_malign(player,pd) = attributed_malign - attributed_resiliency
net_attributed_resiliency(player,pd) = attributed_resiliency - attributed_malign
```

Thresholds con `>` son estrictos. `at least`/`>=` son inclusivos. Cuando el texto sólo dice `2`, se interpreta `>=2`.

## 8. Secret Victory Objectives — computable baseline

Los Hard/Medium/Easy son acumulables (`DEC-022`) y se evalúan al final del escenario base (`DEC-020`).

### 8.1 Arden

**ARDEN_HARD — Destroy the Fluma Independence Movement**  
Condición: `attributed_malign(ARDEN, FLUMA_PD_2) > 5`  
Award: `+15 VP`

**ARDEN_MEDIUM — Bolster the Fluma Worker's Party**  
Condición: `net_attributed_resiliency(ARDEN, FLUMA_PD_1) > 3`  
Award: `+7 VP`

**ARDEN_EASY — Defend your democracy from Ursaria**  
Por cada `pd in ARDEN` con `total_resiliency(pd) > 2`: `+5 VP`.

### 8.2 Ursaria

**URSARIA_HARD — Make Arden rejoin the empire**  
Condición: `sum(attributed_malign(URSARIA, each ARDEN pd)) > 7`  
Award: `+20 VP`

**URSARIA_MEDIUM — Keep Presque out of it**  
Target set: todas las PD de Presque con religión Christian.  
Condición: cada target cumple `net_attributed_malign(URSARIA,pd) >= 2`.  
Award: `+7 VP`

**URSARIA_EASY — Play the malign long game**  
Por cada país extranjero donde al menos una PD tenga `attributed_malign(URSARIA,pd) >= 2`: `+5 VP`.  
Ursaria no puede puntuar auto-maliginización de su propio país.

### 8.3 Presque

**PRESQUE_HARD — Break down Dinesia's claim**  
Condición: al menos 2 de las 3 PD de Dinesia cumplen `attributed_malign(PRESQUE,pd) > 3`.  
Award: `+15 VP`

**PRESQUE_MEDIUM — Reaffirm your alliance with Arden**  
Por cada PD de Arden con `net_attributed_resiliency(PRESQUE,pd) > 2`: `+5 VP`.  
Si las 3 PD cumplen: `+5 VP` adicional.

**PRESQUE_EASY — Build your own social cohesion**  
Por cada PD de Presque con `total_resiliency(pd) > 2`: `+3 VP`.  
Si las 3 PD cumplen: `+5 VP` adicional.

### 8.4 Fluma

**FLUMA_HARD — Secure your independence by force**  
Target set: `ARDEN_PD_2` (M) y `ARDEN_PD_3` (L).  
Condición: ambas cumplen `net_total_malign(pd) > 3`.  
Award: `+20 VP`

**FLUMA_MEDIUM — Protect your Independence Movement**  
Condiciones simultáneas:  
- `net_total_resiliency(FLUMA_PD_2) >= 4`; y  
- `net_total_resiliency(FLUMA_PD_2) > net_total_resiliency(FLUMA_PD_1)`.  
Award: `+10 VP`

**FLUMA_EASY — Make a name for yourself internationally**  
Sólo cuentan PD extranjeras y cubos derivados de campañas con narrativa de independencia validada por facilitador (`DEC-024`).  
Por cada PD con `net_attributed_resiliency(FLUMA,pd) > 2`: `+3 VP`.  
Bonus: `+5 VP` si existen al menos 3 países extranjeros distintos que contienen una PD M/L calificante con `net_attributed_resiliency > 2`.

### 8.5 Dinesia

**DINESIA_HARD — Lay your claim to the contested islands**  
Condición: todas las PD de Presque cumplen `net_total_malign(pd) > 2`.  
Award: `+20 VP`

**DINESIA_MEDIUM — Defend your population**  
Por cada PD de Dinesia con `net_total_resiliency(pd) > 1`: `+5 VP`.  
Si las 3 cumplen: `+5 VP` adicional.

**DINESIA_EASY — Signal support for independence movements**  
Una única recompensa OR:  
- Option 1: `net_attributed_resiliency(DINESIA,FLUMA_PD_2) > 2`; o  
- Option 2: `net_attributed_malign(DINESIA,FLUMA_PD_1) > 2`.  
Award máximo: `+5 VP` una sola vez.

## 9. Cierre de partida

```text
if turn_number == configured_turn_limit after Cleanup:
    evaluate all Secret Victory Objectives
    final_vp = in_game_vp + objective_vp
    winner = max(final_vp)
    if tie:
        winner = tied player(s) with least total_malign in own country
```

Si persiste empate después del desempate oficial, el facilitador declara empate compartido; MALIGN-AI no inventará un tercer tiebreaker.

## 10. Visibilidad de escenario

- Narrativa general, países, PDs, DTs y setup inicial: PUBLIC.
- Victory Objectives de cada país: SECRET_OWNER_AND_FACILITATOR.
- Evaluación intermedia automática de objetivos: visible sólo al owner y facilitador por defecto; el facilitador puede elegir si muestra progreso.

## 11. Validaciones de setup

Antes de iniciar:
1. Deben existir las 14 PD internas.
2. Cada PD debe tener exactamente un country host y sus DTs del escenario.
3. Deben cargarse las pilas iniciales de influencia con atribución.
4. Debe existir exactamente un player por country en MVP.
5. `turn_limit` debe estar definido.
6. Cada jugador debe tener 5 Starter Cards y un Operations Deck válido de 30.
