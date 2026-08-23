# MALIGN-AI — INFORMATION SECURITY MATRIX v0.1

**Estado:** APPROVED BASELINE  
**Principio:** ningún jugador ni instancia de IA asociada a un jugador puede recibir información que el rol no esté autorizado a conocer.

| Información | Owner player | Other players | Facilitator | Player AI | Facilitator AI |
|---|---|---|---|---|---|
| Scenario narrative / PD attributes | yes | yes | yes | yes | yes |
| Current turn / phase / initiative | yes | yes | yes | yes | yes |
| VP totals | yes | yes | yes | yes | yes |
| Resource totals | yes | yes | yes | yes | yes |
| Influence/resiliency on map + attribution | yes | yes | yes | yes | yes |
| Legitimacy markers | yes | yes | yes | yes | yes |
| Hand size | yes | yes | yes | yes | yes |
| Card identities in own hand | yes | no | yes | yes | yes |
| Card identities in opponent hand | no | no | yes | no | yes |
| Operations Deck composition | yes | no | yes | yes | yes |
| Operations Deck order | no* | no | no* | no | no* |
| Operations Deck remaining count | yes | yes | yes | yes | yes |
| Discard pile identities | yes | yes | yes | yes | yes |
| Planned face-down actions | yes | no | yes | yes | yes |
| Face-down campaign cards | yes | no | yes | yes | yes |
| Face-down target DT | yes | no | yes | yes | yes |
| Revealed campaign / Action Card | yes | yes | yes | yes | yes |
| Narrative after declaration | yes | yes | yes | yes | yes |
| Veto and votes | yes | yes | yes | yes | yes |
| Secret Victory Objectives | yes | no | yes | yes | yes |
| Objective progress | yes | no | yes | yes | yes |
| Private negotiation messages | participant only | no | yes | participant context only | yes |
| Temporary reveal from Espionage/Agente Doble | effect-authorized player | no | yes | only if user is authorized viewer | yes |
| Full adjudication/audit trace containing secrets | filtered | filtered | yes | filtered | yes |

`*` El orden del deck no debe ser visible a nadie durante juego normal; el sistema puede almacenarlo internamente como estado técnico, pero no exponerse a usuarios o LLMs. El facilitador puede auditar eventos de shuffle/draw sin recibir el orden futuro.

## Reglas de filtrado

1. La autorización se evalúa antes de construir prompts/RAG context.
2. El modelo nunca recibe primero secretos para después "decidir no decirlos"; los secretos deben excluirse aguas arriba.
3. Toda revelación temporal tiene scope, destinatario y expiración/evento de cierre.
4. Las respuestas del Player AI no pueden inferir o confirmar objetivos secretos de rivales.
5. Las correcciones manuales del facilitador que afecten estado privado deben emitirse en vistas públicas sólo en el nivel necesario.
