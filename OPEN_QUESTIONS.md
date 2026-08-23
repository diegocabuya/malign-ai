# MALIGN-AI — OPEN QUESTIONS

**Fecha:** 2026-08-22  
**Estado:** NO BLOQUEANTE PARA CERRAR FASE 0  

El usuario autorizó resolver las ambigüedades necesarias mediante criterio técnico. Los blockers previamente identificados se han trasladado a `DECISIONS.md` con estado APPROVED. Lo siguiente permanece abierto por razones de provenance, futura ampliación o UX, no porque impida modelar el juego base.

## SOURCE-Q-001 — Turn limit histórico del escenario base
Los Gamebooks exigen que el escenario determine un límite, pero no publican un número en la tabla del escenario base. MALIGN-AI lo resuelve mediante `DEC-004`: configuración obligatoria por facilitador. Queda abierta únicamente la pregunta histórica de si los diseñadores tenían un default no documentado.

## SOURCE-Q-002 — Etiqueta `0` de Presque en el tablero
El asset del tablero imprime `0` donde estructuralmente corresponde la primera PD de Presque. MALIGN-AI lo trata como `1` por `DEC-003`. Queda abierta únicamente la confirmación editorial del diseñador.

## SOURCE-Q-003 — Ficha `Juventud` de Dinesia
Existe en componentes físicos pero no en el setup base. Se reserva para escenarios custom por `DEC-030`. Queda abierta su procedencia/escenario original.

## SOURCE-Q-004 — Intención editorial de `Protocolos de Seguridad`
MALIGN-AI adopta el trigger literal de draw por `DEC-028`. Podría verificarse en una versión original adicional de las cartas si aparece.

## FUTURE-Q-001 — Dos jugadores por país
Fuera del MVP por `DEC-002`. Si se incorpora, será necesario definir reparto de mano, AP, recursos, acciones y autoridad del país.

## FUTURE-Q-002 — Editor de escenarios custom
La arquitectura debe soportar escenarios configurables desde datos. La UX exacta de autoría, validación y publicación se decidirá en fases de producto posteriores.

## FUTURE-Q-003 — Modalidad híbrida con tablero físico
El motor soportará entrada manual de dados y correcciones auditadas, pero no se ha decidido un flujo completo de sincronización con tablero físico.

## FUTURE-Q-004 — Escalado del AAR
Está previsto conservar todo el event log; las métricas exactas, visualizaciones y modelos analíticos se definirán en Fase 6.
