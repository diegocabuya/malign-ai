# MALIGN-AI — DECISIONS

**Fecha de baseline:** 2026-08-22  
**Estado:** ACTIVO  
**Autoridad de aprobación:** usuario del proyecto, quien autorizó expresamente resolver las ambigüedades con el mejor criterio técnico disponible.  

> Estas decisiones NO reescriben las reglas oficiales de Malign. Cuando resuelven una laguna o contradicción del Gamebook, se consideran **DECISIONES APROBADAS DEL PROYECTO MALIGN-AI** y deben permanecer trazables frente a la fuente oficial.

---

## DEC-001 — Fidelidad del MVP
**FECHA:** 2026-08-22  
**TEMA:** Alcance del producto inicial.  
**PROBLEMA:** Determinar si MALIGN-AI debe ser una digitalización 1:1 o una evolución libre.  
**OPCIONES:** Réplica estricta; evolución libre; fidelidad normativa con variantes explícitas.  
**DECISIÓN:** El MVP será **fidelity-first**: reproduce las reglas oficiales y sólo introduce resoluciones de ambigüedad o variantes de forma explícita y versionada. Las mejoras no sustituyen silenciosamente reglas oficiales.  
**JUSTIFICACIÓN:** Mantiene valor pedagógico, auditabilidad y comparabilidad con el juego físico.  
**IMPACTO:** Toda desviación futura debe registrarse como variante o decisión de diseño.  
**ESTADO:** APPROVED

---

## DEC-002 — Facciones y número de jugadores del MVP
**FECHA:** 2026-08-22  
**TEMA:** Representación de países.  
**PROBLEMA:** El Gamebook permite hasta dos personas por país, pero no define la semántica compartida.  
**OPCIONES:** Implementar copilotaje desde v1; inventar reglas de reparto; diferir.  
**DECISIÓN:** El MVP soportará **cinco países originales y un jugador por país**. El modo de dos jugadores por país queda diferido como variante futura.  
**JUSTIFICACIÓN:** Evita crear reglas no documentadas sobre mano, AP, recursos y autoridad compartida.  
**IMPACTO:** No bloquea el juego base de cinco jugadores.  
**ESTADO:** APPROVED

---

## DEC-003 — Identificadores canónicos de PD
**FECHA:** 2026-08-22  
**TEMA:** Conflicto de numeración de Population Demographics.  
**PROBLEMA:** El Gamebook y el tablero físico utilizan numeraciones incompatibles; el tablero además imprime `0` en la primera PD de Presque.  
**OPCIONES:** Adoptar Gamebook; adoptar tablero; IDs internos independientes.  
**DECISIÓN:** Usar IDs internos semánticos estables (`PRESQUE_PD_1`, etc.). Conservar `gamebook_label` y `board_label` como metadatos. El `0` del tablero se tratará como error gráfico y se mapeará a `board_label=1`.  
**JUSTIFICACIÓN:** Evita que un error de arte o una versión previa de escenario contamine claves persistentes.  
**IMPACTO:** Scenario Data, replay y objetivos usan IDs internos; la UI puede mostrar etiquetas físicas.  
**ESTADO:** APPROVED

---

## DEC-004 — Límite de turnos del escenario base
**FECHA:** 2026-08-22  
**TEMA:** Fin de partida.  
**PROBLEMA:** Las reglas exigen un límite definido por escenario, pero el escenario base no publica un número.  
**OPCIONES:** Inventar un valor; partida ilimitada; exigir configuración.  
**DECISIÓN:** `turn_limit` será **parámetro obligatorio al crear la partida**. El escenario base no impondrá un valor normativo inventado.  
**JUSTIFICACIÓN:** Resuelve la ejecutabilidad sin alterar una regla ausente.  
**IMPACTO:** El facilitador debe confirmar el límite antes de iniciar.  
**ESTADO:** APPROVED

---

## DEC-005 — Empates de iniciativa
**FECHA:** 2026-08-22  
**TEMA:** Initiative Stage.  
**PROBLEMA:** No existe procedimiento de desempate.  
**OPCIONES:** Orden anterior; seat order; reroll.  
**DECISIÓN:** Si existe empate por la tirada más alta, **sólo los jugadores empatados vuelven a tirar d10 hasta obtener un único ganador**. Desde ese ganador el orden continúa según el seat order horario fijado en el lobby.  
**JUSTIFICACIÓN:** Preserva la naturaleza probabilística de la iniciativa y no introduce ventaja persistente.  
**IMPACTO:** La secuencia de rerolls se audita.  
**ESTADO:** APPROVED

---

## DEC-006 — Campañas en fila II y modificación
**FECHA:** 2026-08-22  
**TEMA:** Campaign lifecycle.  
**PROBLEMA:** `Modify an existing campaign` no restringe fila I/II.  
**OPCIONES:** Sólo fila I; cualquier campaña.  
**DECISIÓN:** Puede modificarse una campaña existente en **fila I o II**, siempre que continúe en el tablero. La modificación no reinicia su edad; una campaña en II se descartará normalmente en Cleanup.  
**JUSTIFICACIÓN:** Sigue literalmente `any existing campaign` sin crear rejuvenecimiento implícito.  
**IMPACTO:** El estado de edad es independiente de modificaciones.  
**ESTADO:** APPROVED

---

## DEC-007 — CV, bonuses y coste
**FECHA:** 2026-08-22  
**TEMA:** Campaign Value / ERT.  
**PROBLEMA:** Bonuses pueden elevar el CV efectivo por encima de 15; también existen costes propios de cartas.  
**OPCIONES:** Invalidar >15; crear nueva columna; cap al tier High.  
**DECISIÓN:** Mantener `base_cv` y `effective_cv`. El coste por tier se calcula con `base_cv`. Todos los bonuses válidos se acumulan una vez por instancia/trigger. Para ERT: `effective_cv >= 12` usa **HIGH**; no existe tier superior. Costes impresos de cartas de campaña se **suman** al coste normal de activación.  
**JUSTIFICACIÓN:** Es la extensión mínima compatible con la ERT oficial y con la regla de bonuses.  
**IMPACTO:** El raw `effective_cv` se conserva en auditoría aunque la columna sea High.  
**ESTADO:** APPROVED

---

## DEC-008 — Algoritmo exacto de la regla 2:1
**FECHA:** 2026-08-22  
**TEMA:** Malign/Resiliency interaction.  
**PROBLEMA:** Formalizar matemáticamente los ejemplos del Gamebook.  
**OPCIONES:** Cubos entrantes no se consumen; cubos entrantes sí se consumen por pares.  
**DECISIÓN:** Los cubos entrantes se procesan por pares: cada **2 cubos entrantes consumidos eliminan 1 cubo opuesto preexistente**. Los cubos entrantes no consumidos permanecen y se colocan. El jugador activo elige qué atribución opuesta eliminar cuando existe elección.  
**JUSTIFICACIÓN:** Reproduce los ejemplos oficiales, incluido `4 malign existentes + 3 resiliency entrantes -> 3 malign + 1 resiliency`.  
**IMPACTO:** Se distinguen `generated`, `consumed_in_cancellation`, `opposite_removed` y `placed`.  
**ESTADO:** APPROVED

---

## DEC-009 — Cubos directos, legitimidad y VP
**FECHA:** 2026-08-22  
**TEMA:** Cartas/habilidades que añaden cubos sin ERT.  
**PROBLEMA:** No está definido si producen 2:1, legitimidad y VP.  
**OPCIONES:** Tratar como campaña; ignorar reglas globales; separar efectos.  
**DECISIÓN:** **Todo ingreso de cubos a una PD aplica 2:1.** Sin embargo, los cubos añadidos directamente por cartas/habilidades **no generan VP ni establecen/subvierten legitimidad**, salvo texto explícito. Las campañas exitosas sí aplican scoring/legitimidad.  
**JUSTIFICACIÓN:** La regla 2:1 está formulada sobre la adición de cubos; VP/legitimidad están ligados explícitamente a campañas exitosas.  
**IMPACTO:** `Filtraciones`, `Gestión de Crisis`, Fluma y Dinesia afectan el mapa sin puntuar automáticamente. Presque puede otorgar legitimidad porque su habilidad lo dice expresamente.  
**ESTADO:** APPROVED

---

## DEC-010 — Cubos colocados para VP y legitimidad
**FECHA:** 2026-08-22  
**TEMA:** Scoring de campañas tras 2:1.  
**PROBLEMA:** Una campaña puede generar cubos que sean consumidos totalmente cancelando influencia existente.  
**OPCIONES:** Puntuar generated; puntuar placed.  
**DECISIÓN:** Para VP y para el requisito de `adds new cubes` de legitimidad cuentan únicamente los **cubos que permanecen colocados después del 2:1**. Si una campaña no deja ningún cubo nuevo, no establece ni subvierte legitimidad y no obtiene VP por cubos. Backlash resta VP por cubos de backlash que efectivamente quedan colocados.  
**JUSTIFICACIÓN:** El reglamento usa `new cube placed/added`; evita puntuar cubos consumidos.  
**IMPACTO:** Adjudication trace debe guardar las cuatro cantidades del DEC-008.  
**ESTADO:** APPROVED

---

## DEC-011 — Regime Ability dice y efectos
**FECHA:** 2026-08-22  
**TEMA:** Habilidades de país.  
**PROBLEMA:** Arden/Presque exigen una tirada sin definir si es independiente.  
**OPCIONES:** Reusar otra tirada; tirada independiente.  
**DECISIÓN:** Toda habilidad que diga `roll` realiza una **tirada d10 independiente al resolver la habilidad**. Se resuelve en el turno de iniciativa correspondiente. El límite de una vez por turno se mantiene.  
**JUSTIFICACIÓN:** Es la interpretación operacional mínima y no depende de una campaña inexistente.  
**IMPACTO:** Tiradas registradas con source=`REGIME_ABILITY`.  
**ESTADO:** APPROVED

---

## DEC-012 — Presque: legitimidad por habilidad
**FECHA:** 2026-08-22  
**TEMA:** International Leader.  
**PROBLEMA:** La habilidad puede intentar colocar legitimidad donde ya existe otra.  
**OPCIONES:** Sólo PD vacía; sustituir; invalidar.  
**DECISIÓN:** Si Presque tiene éxito, puede elegir cualquier PD. Si existe legitimidad ajena, ésta se retira y se coloca la de Presque. **No concede VP de establishment/subversion**, porque no es una campaña exitosa. Se respeta el máximo de 3; si Presque ya tiene 3, debe retirar uno propio antes de colocar el nuevo.  
**JUSTIFICACIÓN:** Da pleno efecto a `add a Legitimacy Marker to any PD` sin crear scoring no escrito.  
**IMPACTO:** Es una excepción explícita al flujo normal de legitimidad.  
**ESTADO:** APPROVED

---

## DEC-013 — Fluma: Patrocinio Extranjero
**FECHA:** 2026-08-22  
**TEMA:** Trigger de recursos descartados.  
**PROBLEMA:** La habilidad dice `during Action Stage`, mientras muchos costes se pagan durante Resolution.  
**OPCIONES:** Contar sólo pagos físicamente realizados en Action; contar recursos gastados por acciones de ese ciclo.  
**DECISIÓN:** Al activar la habilidad de Fluma para el turno, queda armada durante el **ciclo Action+Resolution**. Cada recurso que otro jugador gaste/descarta como coste de una acción, carta o campaña durante ese ciclo dispara 2 cubos malignos a una PD de Arden elegida por Fluma. Cada recurso se cuenta una sola vez.  
**JUSTIFICACIÓN:** Hace ejecutable la habilidad en el flujo simultáneo del Gamebook y conserva `for every 1 Resource discarded`.  
**IMPACTO:** Los cubos son directos: 2:1 sí; VP/legitimidad no, por DEC-009.  
**ESTADO:** APPROVED

---

## DEC-014 — Ventanas de reacción y prioridad
**FECHA:** 2026-08-22  
**TEMA:** Reaction Engine.  
**PROBLEMA:** No se define prioridad o encadenamiento global.  
**OPCIONES:** Stack complejo; reacción libre; ventanas determinísticas.  
**DECISIÓN:** Cada texto crea una **ventana específica**. Las reacciones marcadas REACTION se juegan desde mano y no consumen AP salvo coste explícito. Al abrir una ventana, los jugadores elegibles reciben prioridad en orden de iniciativa comenzando por el siguiente al actor. Cada reacción se resuelve inmediatamente; después continúa la prioridad. Si el objeto reaccionado deja de existir o el efecto queda anulado, se cierra la ventana. No se permiten reacciones genéricas fuera de triggers impresos.  
**JUSTIFICACIÓN:** Evita un stack no documentado y mantiene interacción simultánea predecible.  
**IMPACTO:** Veto y Derecho preferente de compra comparten una ventana pre-roll de campaña y se procesan por prioridad.  
**ESTADO:** APPROVED

---

## DEC-015 — `¡Impulso!` (Boost)
**FECHA:** 2026-08-22  
**TEMA:** Action Card con timing de tirada pero sin REACTION.  
**PROBLEMA:** El texto dice jugar al tirar, pero las Action Cards cuestan 1 AP.  
**OPCIONES:** Gratis desde mano; 1 AP en el momento; planificación previa.  
**DECISIÓN:** En el juego base, `¡Impulso!` se **planifica durante Action Stage por 1 AP**, vinculada a una activación de campaña del mismo jugador; se revela/aplica en `ON_CAMPAIGN_ROLL` y suma +1. No puede improvisarse gratis desde mano.  
**JUSTIFICACIÓN:** Respeta simultáneamente el coste general de Action Card y el timing impreso.  
**IMPACTO:** Con la variante rápida oficial que usa 1 AP para +1, Boost deberá dar +2 como indica el Gamebook.  
**ESTADO:** APPROVED

---

## DEC-016 — `Doble Acción`
**FECHA:** 2026-08-22  
**TEMA:** Activación adicional.  
**PROBLEMA:** Determinar AP y recursos de la campaña extra.  
**OPCIONES:** Nueva activación completa con AP; activación gratis; efecto de carta.  
**DECISIÓN:** Jugar `Doble Acción` consume el **1 AP de la Action Card** y su coste impreso de 1 Recurso. La activación generada no consume un AP adicional, pero sí paga el coste normal de activación por tier y cualquier coste propio de las cartas de campaña. Puede activar una campaña ya activada ese turno.  
**JUSTIFICACIÓN:** La carta existe precisamente para generar una activación adicional sin otro AP, pero no elimina la economía de campaña.  
**IMPACTO:** `CAMPAIGN_EXTRA_ACTIVATION` ignora sólo el flag once-per-turn.  
**ESTADO:** APPROVED

---

## DEC-017 — Veto
**FECHA:** 2026-08-22  
**TEMA:** Mayoría y autoridad.  
**PROBLEMA:** El Gamebook no define empates ni electorado exacto.  
**OPCIONES:** Unanimidad; mayoría de presentes; mayoría estricta de jugadores activos.  
**DECISIÓN:** Votan **todos los jugadores activos**, incluido el jugador de la campaña y quien jugó Veto. El facilitador no vota salvo que sea también jugador. Para rechazar la narrativa se requiere **mayoría estricta de votos `unacceptable` sobre el total de jugadores activos**. Empate o falta de mayoría -> narrativa aceptada. El facilitador puede detener un Veto abusivo antes de la votación.  
**JUSTIFICACIÓN:** La carga para invalidar una campaña debe ser positiva y el texto dice ALL players.  
**IMPACTO:** El resultado y cada voto se auditan.  
**ESTADO:** APPROVED

---

## DEC-018 — Narrative Rule
**FECHA:** 2026-08-22  
**TEMA:** Evaluación narrativa.  
**PROBLEMA:** Longitud es automatizable; plagio/lectura literal y plausibilidad requieren juicio.  
**OPCIONES:** LLM árbitro; facilitador; reglas híbridas.  
**DECISIÓN:** El sistema exige 2-3 oraciones. Si hay >3, aplica automáticamente el descarte aleatorio de 1 carta. La detección de `simplemente leer la carta` y la plausibilidad **no serán adjudicadas automáticamente por IA**: la IA puede señalar similitud, pero la sanción de 2 cartas y la validez narrativa requieren confirmación del facilitador. Habrá toggle de leniencia para principiantes.  
**JUSTIFICACIÓN:** Conserva el componente humano y evita convertir un LLM en árbitro normativo.  
**IMPACTO:** Se registra la decisión del facilitador.  
**ESTADO:** APPROVED

---

## DEC-019 — Viralización
**FECHA:** 2026-08-22  
**TEMA:** Viral Mechanic.  
**PROBLEMA:** `0 or even` en d10 1-10 y ausencia de legitimidad.  
**OPCIONES:** Tratar 10 como 0; paridad normal; permitir viral sin legitimacy.  
**DECISIÓN:** El d10 digital usa 1-10. Segunda tirada: **par (2,4,6,8,10) -> 2 cubos; impar -> 1**. Si la PD supera el umbral pero no tiene Legitimacy Marker, **no viraliza**. La versión base usa `>8`, tirada de propagación 6+, y segunda tirada; la variante corta (`>6`, 1 cube, sin segunda tirada) es configurable explícitamente.  
**JUSTIFICACIÓN:** Preserva el rol explícito de legitimidad y elimina la anomalía del cero sin alterar probabilidades por paridad.  
**IMPACTO:** Viralization es un subproceso de Cleanup.  
**ESTADO:** APPROVED

---

## DEC-020 — Victory Objectives y victoria instantánea
**FECHA:** 2026-08-22  
**TEMA:** Contradicción entre sección 2 y sección 11.  
**PROBLEMA:** Sección 2 describe VOs como instant victory; sección 11 los suma como VP al final.  
**OPCIONES:** Victoria inmediata; puntuación final; configurable por escenario.  
**DECISIÓN:** Para el **escenario base 2025**, los VOs se evalúan y puntúan al final de la partida conforme a la sección 11. La capacidad `instant_victory` existirá en el modelo de escenario pero sólo se activa si un escenario lo declara expresamente.  
**JUSTIFICACIÓN:** Las tablas base asignan VP numéricos y la sección 11 es el procedimiento específico de cierre.  
**IMPACTO:** No hay victoria inmediata en base 2025.  
**ESTADO:** APPROVED

---

## DEC-021 — Semántica `net` y `attributed`
**FECHA:** 2026-08-22  
**TEMA:** Evaluación de objetivos secretos.  
**PROBLEMA:** El Gamebook usa `net` y `attributed` sin fórmula formal.  
**OPCIONES:** Contar sólo tipo; restar oposición total; restar oposición del mismo actor.  
**DECISIÓN:** `net_total_malign = total_malign - total_resiliency`; `net_total_resiliency = total_resiliency - total_malign`. Para `net attributed`, el scope se limita a la atribución del jugador: `actor_type - actor_opposite_type`. `Attributed` sin `net` cuenta cubos cuya `attribution_country` es el actor, incluidos cubos atribuidos por setup.  
**JUSTIFICACIÓN:** Hace composables las dos palabras y respeta la nota de atribución del escenario.  
**IMPACTO:** Todos los VOs tienen funciones determinísticas.  
**ESTADO:** APPROVED

---

## DEC-022 — Victory Objective tiers del escenario base
**FECHA:** 2026-08-22  
**TEMA:** Hard/Medium/Easy.  
**PROBLEMA:** No se dice si son alternativas o acumulables.  
**OPCIONES:** Elegir una dificultad; puntuar todos; puntuar máximo uno.  
**DECISIÓN:** Los objetivos **Hard, Medium y Easy están activos simultáneamente y sus VP son acumulables**, porque la sección final habla de Victory Objectives en plural y las tablas asignan VP diferenciados. Dinesia Easy Option 1/2 se trata como **una sola condición OR**, con máximo +5 VP.  
**JUSTIFICACIÓN:** Evita introducir una selección de dificultad que no aparece en setup.  
**IMPACTO:** El evaluator puede devolver varios objective awards por jugador.  
**ESTADO:** APPROVED

---

## DEC-023 — Fluma Easy bonus
**FECHA:** 2026-08-22  
**TEMA:** Texto `OR +5 bonus`.  
**PROBLEMA:** La tabla mezcla `OR` y `bonus`.  
**OPCIONES:** Alternativa exclusiva; bonus adicional.  
**DECISIÓN:** Se otorgan +3 VP por cada PD extranjera calificante y **+5 VP adicionales** si existen PDs Medium/Large calificantes en al menos 3 países extranjeros distintos.  
**JUSTIFICACIÓN:** El término `bonus` y la estructura de otros VOs favorecen el carácter adicional; tratarlo como alternativa haría el bonus paradójicamente menos valioso.  
**IMPACTO:** El escenario base usa esta interpretación aprobada.  
**ESTADO:** APPROVED

---

## DEC-024 — Fluma Easy: requisito narrativo
**FECHA:** 2026-08-22  
**TEMA:** Narrative-dependent VO.  
**PROBLEMA:** El How to Win exige narrativa sobre valor como nación independiente.  
**OPCIONES:** Ignorar; LLM clasifica; facilitador etiqueta.  
**DECISIÓN:** Los cubos/acciones que pretendan contar para este VO deben provenir de una campaña marcada `objective_eligible_fluma_independence_narrative=true` por el **facilitador** en la resolución. IA puede asistir, no aprobar.  
**JUSTIFICACIÓN:** El requisito forma parte del How to Win y no es reducible de forma segura a estado numérico.  
**IMPACTO:** Los eventos conservan trazabilidad de elegibilidad.  
**ESTADO:** APPROVED

---

## DEC-025 — Deck físico de 108 y Starter Cards
**FECHA:** 2026-08-22  
**TEMA:** Composición del set.  
**PROBLEMA:** Gamebook dice 108 cartas por country deck y Starter separadas; el asset contiene 108 caras incluyendo 5 Starter.  
**OPCIONES:** 108+5; 108 total; catálogo abstracto.  
**DECISIÓN:** Para MALIGN-AI v1, el set canónico es **108 instancias totales por país: 103 elegibles para Operations pool + 5 Starter separadas**. Operations Deck selecciona 30 de las 103.  
**JUSTIFICACIÓN:** Es la evidencia material disponible y preserva la regla de que Starter no cuentan contra el deck de 30.  
**IMPACTO:** Card registry debe marcar `is_starter` y excluirlas del pool.  
**ESTADO:** APPROVED

---

## DEC-026 — Edge cases de Action Cards
**FECHA:** 2026-08-22  
**TEMA:** Agente Doble, Ladrón Encubierto, Medidas Activas, Tarro de Miel, Corrupción.  
**PROBLEMA:** Faltan selectores/limites.  
**OPCIONES:** Varias.  
**DECISIÓN:** (a) Agente Doble: el actor, tras ver la mano, elige hasta 5; si hay <5, descarta todas. (b) Ladrón Encubierto: selecciona a ciegas una posición de la mano del objetivo; puede obtener cualquier carta, incluida Starter. Ownership original se conserva. Si una Starter robada se usa, `remove after use` prevalece; si se descarta sin uso, vuelve al owner. Hand limit se aplica inmediatamente. (c) Medidas Activas puede descartar cualquier campaña existente en I o II. (d) Tarro de Miel: si supera el check, el objetivo elige una Action Card de su mano para descartar; si no tiene, no ocurre descarte. (e) VP nunca baja de 0 por Corrupción.  
**JUSTIFICACIÓN:** Son las lecturas menos invasivas de los verbos impresos y preservan privacidad/ownership.  
**IMPACTO:** Se eliminan blockers de implementación declarativa.  
**ESTADO:** APPROVED

---

## DEC-027 — Construcción de Coalición
**FECHA:** 2026-08-22  
**TEMA:** Contribuciones de recursos.  
**PROBLEMA:** `for every other player that discards 1 Resource` no fija timing.  
**OPCIONES:** Múltiples recursos por jugador; máximo uno; antes/después Veto.  
**DECISIÓN:** Cada otro jugador puede contribuir **0 o 1 Recurso** voluntariamente. La ventana ocurre después de resolver Veto/otras reacciones que puedan destruir la campaña y antes de la tirada ERT. Cada contribución pagada añade +1 al `effective_cv`.  
**JUSTIFICACIÓN:** La frase cuantifica jugadores, no recursos, y evita cobrar por una campaña ya vetada.  
**IMPACTO:** Se requiere `COALITION_CONTRIBUTION_WINDOW`.  
**ESTADO:** APPROVED

---

## DEC-028 — Protocolos de Seguridad
**FECHA:** 2026-08-22  
**TEMA:** Trigger ambiguo `cuando robas Filtraciones`.  
**PROBLEMA:** Puede interpretarse como ataque recibido o como draw del deck.  
**OPCIONES:** Reacción a oponente; trigger literal de draw; desactivar.  
**DECISIÓN:** Se aplica **literalmente al robo**: si un jugador tiene Protocolos de Seguridad en mano y roba `Filtraciones` de su Operations Deck, el trigger es obligatorio; ambas cartas van al descarte y Filtraciones no entra operativamente en mano.  
**JUSTIFICACIÓN:** `robar/draw` es terminología inequívoca dentro del juego y no existe texto que mencione un ataque de un rival.  
**IMPACTO:** Es una reacción a evento de deck, no a carta jugada.  
**ESTADO:** APPROVED

---

## DEC-029 — Alias de nombres de cartas
**FECHA:** 2026-08-22  
**TEMA:** Referencias inconsistentes.  
**PROBLEMA:** Algunas cartas llaman a otras con nombres distintos.  
**OPCIONES:** Fallar el pairing; corregir texto; alias.  
**DECISIÓN:** Usar `card_definition_id` canónico y una tabla de aliases. Se aprueban: `HACK BACK -> Contraataque Informático`; `Verificación de Datos -> Verificación de Hechos`; `Alianzas Público-Privadas -> Asociaciones Público-Privadas`; `Teoría de la Conspiración -> Teoría Conspirativa`.  
**JUSTIFICACIÓN:** Resuelve referencias sin alterar el arte original.  
**IMPACTO:** Pairing y reacciones operan por ID, no por string.  
**ESTADO:** APPROVED

---

## DEC-030 — Componentes y color visual
**FECHA:** 2026-08-22  
**TEMA:** Assets físicos.  
**PROBLEMA:** Nombres de colores y activos visuales pueden diferir.  
**OPCIONES:** Texto; asset; colores nuevos.  
**DECISIÓN:** Los **assets físicos aportados son la referencia visual canónica** para color/logos/layout; los nombres del Gamebook se conservan como semántica/alias. La ficha `Juventud` de Dinesia se considera disponible para escenarios custom pero no parte del escenario base, porque no aparece en su setup.  
**JUSTIFICACIÓN:** Distingue identidad visual de reglas del escenario.  
**IMPACTO:** Base Scenario no incorpora DTs no usados.  
**ESTADO:** APPROVED

---

## DEC-031 — Visibilidad de información
**FECHA:** 2026-08-22  
**TEMA:** Public/private/secret.  
**PROBLEMA:** Gamebook no publica una matriz formal.  
**OPCIONES:** Todo visible; todo oculto; emulación de información física.  
**DECISIÓN:** Aplicar la matriz definida en `MALIGN_AI_INFORMATION_SECURITY_MATRIX_v0.1.md`: estado del tablero/VP/recursos/legitimidad público; identidad de mano/deck order/acciones face-down/DT face-down privados; Secret VOs secretos owner+facilitator; facilitador puede ver todo; AI recibe sólo datos autorizados al rol.  
**JUSTIFICACIÓN:** Replica la asimetría física y cumple el principio de seguridad del proyecto.  
**IMPACTO:** Requiere autorización a nivel de backend/RAG.  
**ESTADO:** APPROVED

---

## DEC-032 — Negociación digital
**FECHA:** 2026-08-22  
**TEMA:** Deals no vinculantes.  
**PROBLEMA:** Digitalizar acuerdos sin volver obligatorias las promesas.  
**OPCIONES:** Chat libre; contratos autoejecutables; ofertas no vinculantes + transferencias confirmadas.  
**DECISIÓN:** Habrá negociación privada entre participantes. Las **promesas/acuerdos son no vinculantes** y el sistema no los ejecuta automáticamente. Una transferencia efectiva de carta/recurso requiere confirmación explícita de quienes transfieren y cambia el estado una vez confirmada. En MVP, las transferencias se permiten durante Initiative/Action planning antes de bloquear acciones; no consumen AP salvo regla futura.  
**JUSTIFICACIÓN:** Conserva confianza/betrayal sin impedir transferencias reales.  
**IMPACTO:** El log distingue `DEAL_PROMISE` de `TRANSFER_EXECUTED`.  
**ESTADO:** APPROVED

---

## DEC-033 — Dados digitales y entrada manual
**FECHA:** 2026-08-22  
**TEMA:** RNG.  
**PROBLEMA:** Dado físico vs digital.  
**OPCIONES:** Sólo físico; sólo digital; modo configurable.  
**DECISIÓN:** Default: **d10 digital generado por Game Engine** con log auditable. El facilitador puede habilitar modo `MANUAL_DIE_INPUT` para usar dados físicos; cada entrada manual queda marcada como tal.  
**JUSTIFICACIÓN:** Permite juego web completo y también modalidad híbrida.  
**IMPACTO:** El RNG no pertenece al LLM.  
**ESTADO:** APPROVED

---

## DEC-034 — IA y autoridad
**FECHA:** 2026-08-22  
**TEMA:** Límites del AI Engine.  
**PROBLEMA:** Qué decisiones puede tomar automáticamente.  
**OPCIONES:** IA árbitro; IA sólo consultiva; híbrido.  
**DECISIÓN:** IA es **consultiva e interpretativa**. Puede parsear intención, explicar reglas, sugerir targets, ayudar narrativa y señalar inconsistencias. No valida ni ejecuta reglas críticas, no decide Veto, no determina plausibilidad final, no revela secretos y no sobreescribe Game State. El Game Engine adjudica; el facilitador resuelve excepciones humanas.  
**JUSTIFICACIÓN:** Principio fundacional del proyecto.  
**IMPACTO:** Toda herramienta IA trabaja sobre un authorization context.  
**ESTADO:** APPROVED

---

## DEC-035 — Arquitectura Malign-first, modular
**FECHA:** 2026-08-22  
**TEMA:** Reutilización del engine.  
**PROBLEMA:** Motor genérico para wargames vs producto Malign.  
**OPCIONES:** Framework genérico desde el inicio; hardcode Malign; núcleo modular Malign-first.  
**DECISIÓN:** Diseñar un núcleo modular, declarativo y reusable donde sea natural, pero **optimizado y validado primero para Malign**. No se introduce abstracción adicional sólo para soportar juegos hipotéticos.  
**JUSTIFICACIÓN:** Evita sobrearquitectura sin perder extensibilidad.  
**IMPACTO:** Card effects/scenarios son data-driven; fases y reglas siguen dominio Malign.  
**ESTADO:** APPROVED

---

## DEC-036 — Orden intrajugador y compromiso de AP
**FECHA:** 2026-08-22  
**TEMA:** Secuencia de acciones planificadas.  
**PROBLEMA:** El Gamebook exige que Action Cards que modifiquen una campaña se jueguen antes de activarla, pero no formaliza el orden interno de las hasta 3 acciones de un jugador.  
**OPCIONES:** Resolver simultáneamente; orden arbitrario del facilitador; secuencia declarada por el jugador.  
**DECISIÓN:** Cada jugador planifica sus acciones en slots ordenados (`1..3`). Al bloquear el plan, los AP de esos slots quedan consumidos. Durante Resolution, en el turno de iniciativa del jugador, los slots se resuelven en ese orden. Los AP **no se reembolsan** si una acción es vetada, anulada, queda sin objetivo o falla por un cambio de estado. Una acción posterior puede referenciar una campaña creada por un slot anterior del mismo plan.  
**JUSTIFICACIÓN:** Hace ejecutable la precedencia oficial `Action Card before campaign activation` y reproduce la colocación secuencial de decisiones face-down.  
**IMPACTO:** `PlannedAction.sequence_index` es normativo para adjudicación.  
**ESTADO:** APPROVED

---

## DEC-037 — Normalización de tirada ERT modificada
**FECHA:** 2026-08-22  
**TEMA:** Modificadores sobre d10.  
**PROBLEMA:** Legitimidad, Boost y la modificación pre-roll pueden elevar el resultado por encima de 10; la ERT sólo tiene filas 1–10.  
**OPCIONES:** Permitir filas inexistentes; ignorar excedente; clamp.  
**DECISIÓN:** El dado base siempre produce `1..10`. Para campañas, se calcula `modified_roll_raw = die + modifiers`; para consultar ERT se usa `ert_roll = clamp(modified_roll_raw, 1, 10)`. Se conservan dado, modificadores, valor raw y valor normalizado en la traza. Los checks independientes de cartas/habilidades usan el d10 sin modificadores salvo texto explícito.  
**JUSTIFICACIÓN:** Extensión mínima compatible con una tabla cerrada de 10 filas.  
**IMPACTO:** Nunca se inventan resultados ERT fuera de tabla.  
**ESTADO:** APPROVED

---

## DEC-038 — Límite de tres legitimidades en campañas normales
**FECHA:** 2026-08-22  
**TEMA:** Legitimacy cap.  
**PROBLEMA:** El Gamebook fija máximo 3 markers por jugador, pero no dice qué hacer al intentar establecer un cuarto.  
**OPCIONES:** Prohibir el cuarto; reemplazo obligatorio; reemplazo/renuncia elegible.  
**DECISIÓN:** Si una campaña califica para **establecer** nueva legitimidad y el actor ya posee 3 markers, puede retirar voluntariamente uno propio y establecer el nuevo, o renunciar al establecimiento. Retirar un marker propio no concede VP. Si renuncia, no recibe el +1 VP de establishment. La subversión de legitimidad ajena sigue su flujo normal y no coloca marker nuevo.  
**JUSTIFICACIÓN:** Respeta el máximo sin imponer un movimiento no solicitado y es consistente con DEC-012.  
**IMPACTO:** La resolución puede abrir `LEGITIMACY_CAP_CHOICE`.  
**ESTADO:** APPROVED

---

## DEC-039 — Starter Cards: AP, timing y lifecycle
**FECHA:** 2026-08-22  
**TEMA:** Uso de Starter Cards no rotuladas como Action.  
**PROBLEMA:** El Gamebook identifica Starter como clase separada y no asigna AP/timing global a Presupuesto Aumentado, Política Prioritaria o Giro de Política.  
**OPCIONES:** Tratar todas como Action de 1 AP; uso libre; ventanas específicas por función.  
**DECISIÓN:** (a) `Presupuesto Aumentado`, `Política Prioritaria` y `Giro de Política` se juegan **sin AP**, de forma inmediata durante el Action Stage del propietario antes de bloquear su plan. (b) `Veto` es reacción 0 AP. (c) `Intención Libre` se usa como componente Intent de una campaña y la construcción conserva el coste normal de 1 AP. (d) Una Starter nunca entra al Operations Deck/Discard del propietario: al resolver su uso o al ser descartada sin uso por su controlador legítimo, pasa a `REMOVED_FROM_GAME`. (e) `Intención Libre` permanece asignada a su campaña mientras ésta exista y se retira del juego cuando la campaña abandona el mat. (f) El caso de Starter robada por Ladrón Encubierto conserva la excepción de DEC-026.  
**JUSTIFICACIÓN:** Permite que las Starter de preparación de mano/recursos cumplan su función antes de planificar y preserva la regla `remove after use`.  
**IMPACTO:** Se añade una ventana `STARTER_FREE_PLAY` dentro de Action planning.  
**ESTADO:** APPROVED

---

## DEC-040 — Atomicidad, costes y acciones que quedan sin efecto
**FECHA:** 2026-08-22  
**TEMA:** Failure semantics.  
**PROBLEMA:** El estado puede cambiar entre planificación y resolución, dejando targets o recursos inválidos.  
**OPCIONES:** Reservar todos los recursos; reembolsar AP; resolver parcialmente; transacciones atómicas.  
**DECISIÓN:** AP se compromete al lock del plan (DEC-036). Los costes no-AP se pagan en la ventana definida de resolución, no se reservan globalmente. Si en ese momento no puede pagarse un coste obligatorio, el efecto no se ejecuta y no hay pago parcial. Una Action Card ya revelada se considera jugada y va a su destino normal aunque su efecto sea anulado o falle; build/modify no consumen sus cartas si la mutación no llegó a ejecutarse; una activación fallida deja la campaña en el mat. Todas las mutaciones de una operación se aplican atómicamente.  
**JUSTIFICACIÓN:** Evita reservas invisibles que alterarían interacciones y proporciona semántica transaccional clara.  
**IMPACTO:** Estados de resolución incluyen `FAILED_COST`, `INVALIDATED` y `NEGATED`.  
**ESTADO:** APPROVED

---

## DEC-041 — Capacidad de filas de campaña
**FECHA:** 2026-08-22  
**TEMA:** Player Mat.  
**PROBLEMA:** El mat físico sólo tiene Campaign Row I y II; no se formaliza capacidad.  
**OPCIONES:** Campañas ilimitadas por fila; una por fila.  
**DECISIÓN:** Cada fila admite **máximo una campaña**. `Construct Campaign` crea en Row I y requiere que Row I esté libre al resolver. Row II sólo se ocupa por envejecimiento desde Row I. Si Row I queda ocupada antes de resolver una construcción planificada, esa construcción falla conforme DEC-040.  
**JUSTIFICACIÓN:** Refleja literalmente el layout físico y el flujo de Cleanup.  
**IMPACTO:** Máximo dos campañas simultáneas por jugador.  
**ESTADO:** APPROVED

---

## DEC-042 — Viralización: snapshot, cascada y atribución
**FECHA:** 2026-08-22  
**TEMA:** Determinismo de Cleanup Viral.  
**PROBLEMA:** No se define orden entre varias PD, cascada ni atribución exacta de los cubos propagados.  
**OPCIONES:** Cascada inmediata; snapshot; atribución al tipo agregado; atribución al legitimado.  
**DECISIÓN:** Al iniciar `CLEANUP_VIRAL` se toma un snapshot de orígenes elegibles; cada origen obtiene como máximo un intento y una PD que se vuelve elegible por propagación no viraliza hasta el siguiente turno. Los orígenes se procesan por iniciativa del dueño de legitimidad y luego por `pd_id` estable. El tipo elegible sigue Rule Effect Taxonomy v0.2 (único > umbral; si ambos, mayor; empate elige dueño de legitimidad). Los cubos propagados se atribuyen al **dueño del marker de legitimidad**, quien debe poseer al menos 1 cubo atribuido del tipo elegido en el origen; si no, no hay propagación. El destino debe ser distinto del origen y compartir al menos un DT activo.  
**JUSTIFICACIÓN:** Evita cascadas infinitas y da significado computable a `their influence` / `owner of the spreading influence cubes`.  
**IMPACTO:** Viral cubes son directos: 2:1 sí; VP/legitimidad no.  
**ESTADO:** APPROVED

---

## DEC-043 — Hand limit y zonas face-down
**FECHA:** 2026-08-22  
**TEMA:** Límite de 10 cartas.  
**PROBLEMA:** Algunas cartas añaden cartas y las acciones planificadas físicamente dejan de estar en mano.  
**OPCIONES:** Permitir excedente temporal persistente; descartar automáticamente; elección controlada.  
**DECISIÓN:** No existe estado estable con más de 10 cartas en `HAND`. Las cartas comprometidas en acciones face-down pasan a `PLANNED_ACTION` y no cuentan como mano. Cuando un efecto produciría >10, el motor abre una elección de descarte hasta 10 antes de confirmar el nuevo estado, salvo que el propio efecto defina otra secuencia. Penalizaciones aleatorias de narrativa seleccionan únicamente cartas que estén realmente en `HAND`.  
**JUSTIFICACIÓN:** Reproduce `may never have more than 10` y la separación física de cartas planificadas.  
**IMPACTO:** `HAND_LIMIT_ENFORCE` es postcondición universal de efectos de mano.  
**ESTADO:** APPROVED

---

## DEC-044 — Cadena Ciberataque / Contraataque Informático / Ciberseguridad
**FECHA:** 2026-08-22  
**TEMA:** Reacciones cibernéticas.  
**PROBLEMA:** `Ciberataque` es componente de campaña y `Contraataque Informático` dice anular su efecto; `Ciberseguridad` reacciona a Hack Back.  
**OPCIONES:** Restar sólo IV; anular componente; anular activación; ignorar cadena.  
**DECISIÓN:** Si una campaña **maligna** que contiene `Ciberataque` apunta a una PD del país de un oponente, ese oponente puede jugar `Contraataque Informático` (alias Hack Back) para **negar toda la activación de campaña**. Esa reacción abre el trigger específico para que el actor original pueda jugar `Ciberseguridad`; si lo hace, `Ciberseguridad` niega `Contraataque Informático` y la activación continúa. Las reacciones usadas se consumen aunque sean negadas.  
**JUSTIFICACIÓN:** `Ciberataque` no posee otro efecto independiente que pueda anularse; esta lectura hace funcional la cadena impresa.  
**IMPACTO:** Reaction Engine permite ventanas hijas sólo cuando un trigger impreso lo exige.  
**ESTADO:** APPROVED

---

## DEC-045 — Cantidades físicas y pistas no son caps digitales
**FECHA:** 2026-08-22  
**TEMA:** Límites materiales.  
**PROBLEMA:** Los componentes incluyen 40 cubos por tipo y pista de VP finita, sin indicar que sean máximos de reglas.  
**OPCIONES:** Hard caps por componentes; cantidades abstractas.  
**DECISIÓN:** MALIGN-AI no impone máximos de recursos, influencia/resiliencia ni VP por disponibilidad física o longitud de la pista, salvo una regla explícita. VP conserva floor 0 por DEC-026.  
**JUSTIFICACIÓN:** El conteo de componentes es una restricción de producción, no una regla declarada de adjudicación.  
**IMPACTO:** Estado digital usa enteros no negativos sin cap superior normativo.  
**ESTADO:** APPROVED

---

## DEC-046 — Modificar campaña con Amplifier vacío
**FECHA:** 2026-08-22  
**TEMA:** `Modify an existing campaign`.  
**PROBLEMA:** Una campaña puede activarse con Intent+Method, pero la redacción `replace Method or Amplifier` no aclara si luego puede llenarse un slot Amplifier vacío.  
**OPCIONES:** Sólo reemplazo literal; permitir completar Amplifier.  
**DECISIÓN:** `Modify Campaign` puede reemplazar un Method existente, reemplazar un Amplifier existente **o llenar un Amplifier vacío**. No puede modificar/reemplazar Intent ni eliminar una carta sin sustitución.  
**JUSTIFICACIÓN:** Hace útil el carácter opcional del Amplifier sin crear una nueva clase de acción.  
**IMPACTO:** La campaña mínima Intent+Method puede evolucionar en turno posterior.  
**ESTADO:** APPROVED

---

## DEC-047 — Transferencias forzadas de recursos
**FECHA:** 2026-08-22  
**TEMA:** Sanciones Económicas y Robo Cibernético.  
**PROBLEMA:** Un objetivo puede tener menos recursos que la cantidad a confiscar/entregar.  
**OPCIONES:** Acción inválida; saldo negativo; transferir disponible.  
**DECISIÓN:** Las transferencias forzadas transfieren `min(cantidad indicada, recursos disponibles del pagador)`. Nunca producen recursos negativos.  
**JUSTIFICACIÓN:** Es la lectura conservadora de `confisca/da` sin crear deuda.  
**IMPACTO:** Sanciones puede transferir 0–2; cada resultado de Robo Cibernético transfiere 0–1.  
**ESTADO:** APPROVED


---

## DEC-048 — Plataforma web multijugador compartida
**FECHA:** 2026-08-22  
**TEMA:** Forma de producto y multiplayer.  
**DECISIÓN:** MALIGN-AI será una **aplicación web multijugador de sesión compartida**, inicialmente para cinco jugadores y un facilitador. El backend mantiene el estado autoritativo y distribuye en tiempo real proyecciones diferenciadas por rol/permisos.  
**JUSTIFICACIÓN:** Requisito explícito del proyecto confirmado por el usuario.  
**IMPACTO:** Multiplayer, concurrencia, realtime, autenticación, projection security y reconexión son requisitos desde el inicio.  
**ESTADO:** APPROVED

## DEC-049 — Estilo de arquitectura
**DECISIÓN PROPUESTA:** Modular monolith TypeScript en monorepo; sin microservicios en MVP.  
**ESTADO:** APPROVED

## DEC-050 — Deployables
**DECISIÓN PROPUESTA:** `apps/web` y `apps/server` separados; Game Engine framework-agnostic.  
**ESTADO:** APPROVED

## DEC-051 — Frontend
**DECISIÓN PROPUESTA:** Next.js + React + TypeScript.  
**ESTADO:** APPROVED

## DEC-052 — Persistencia primaria
**DECISIÓN PROPUESTA:** PostgreSQL; Supabase puede administrarlo sin acoplar el dominio al SDK.  
**ESTADO:** APPROVED

## DEC-053 — Transporte multiplayer
**DECISIÓN PROPUESTA:** HTTP para commands/queries y WebSocket para realtime.  
**ESTADO:** APPROVED

## DEC-054 — Atomicidad / outbox
**DECISIÓN PROPUESTA:** Una transacción PostgreSQL por command estable + Transactional Outbox.  
**ESTADO:** APPROVED

## DEC-055 — Game Engine puro
**DECISIÓN PROPUESTA:** Ports & Adapters; persistence/RNG/clock/audit como ports.  
**ESTADO:** APPROVED

## DEC-056 — Historial
**DECISIÓN PROPUESTA:** Estado actual normalizado + logs/ledgers/events/traces append-only; no Event Sourcing puro.  
**ESTADO:** APPROVED

## DEC-057 — Projection security
**DECISIÓN PROPUESTA:** Filtrado server-side antes de HTTP/WebSocket/AI context.  
**ESTADO:** APPROVED

## DEC-058 — Orden de implementación
**DECISIÓN PROPUESTA:** Rule Kernel puro + adapters in-memory + P0 tests antes de UI/IA.  
**ESTADO:** APPROVED


---

## DEC-059 — AI fuera del Game Engine
**FECHA:** 2026-08-22  
**TEMA:** Frontera de IA.  
**PROBLEMA:** Determinar si la IA puede formar parte del motor autoritativo o acceder al estado completo de la partida.  
**OPCIONES:** IA dentro del Game Engine; IA omnisciente; AI Orchestration separada con contexto autorizado.  
**DECISIÓN:** La AI Orchestration permanece **fuera del Game Engine**. Para jugadores sólo recibe `AuthorizedProjection` construida por las mismas políticas server-side que protegen la UI. La IA puede interpretar, orientar, explicar o proponer comandos, pero no muta directamente el estado autoritativo ni decide reglas determinísticas.  
**JUSTIFICACIÓN:** Preserva el principio fundamental del proyecto `LLM ≠ Motor de adjudicación` y evita filtraciones de información secreta.  
**IMPACTO:** OpenAI/RAG se integra después del MVP determinístico mediante una capa separada.  
**ESTADO:** APPROVED


---

# GATE ARQUITECTÓNICO — APROBACIÓN ARC-01…ARC-12

**FECHA:** 2026-08-22  
**AUTORIDAD:** Usuario / Product Owner  
**ALCANCE:** El usuario aprobó expresamente el conjunto `ARC-01` a `ARC-12` de `MALIGN_AI_GAME_ENGINE_IMPLEMENTATION_ARCHITECTURE_SPEC_v0.1.md`.

Quedan aprobadas como baseline de implementación:

1. Web multijugador compartida para 5 jugadores + facilitador.
2. Modular monolith TypeScript en monorepo.
3. `apps/web` + `apps/server`, con Game Engine framework-agnostic.
4. Next.js + React + TypeScript.
5. PostgreSQL; Supabase como opción gestionada sin acoplamiento de dominio.
6. HTTP para commands/queries + WebSocket para realtime.
7. `game_version`, transacción por command y Transactional Outbox.
8. Ports & Adapters para el Game Engine.
9. Estado actual normalizado + historial append-only; no Event Sourcing puro.
10. Rule Kernel + in-memory adapters + P0 tests como primer milestone.
11. Proyecciones y filtrado de secretos server-side.
12. AI Orchestration fuera del Game Engine y limitada a Authorized Projections.

**ESTADO DEL GATE:** APPROVED

---

## DEC-060 — Incorporación incremental de tests M0
**FECHA:** 2026-08-23  
**TEMA:** Resolución de `IQ-PR0-001`.  
**DECISIÓN:** El inventario ejecutable y validado de los 35 IDs M0 satisface PR-0. Los tests funcionales se incorporan junto con el comportamiento probado: 15 M0A durante PR-1 y 20 M0B/M0C durante PR-2. No se crean tests deliberadamente fallidos o falsamente verdes, no se usa `skip` y CI permanece verde.  
**JUSTIFICACIÓN:** Conserva TDD incremental sin adelantar comportamiento fuera del PR autorizado.  
**IMPACTO:** PR-1 implementa exclusivamente Rule Kernel y sus 15 tests P0.  
**ESTADO:** APPROVED
