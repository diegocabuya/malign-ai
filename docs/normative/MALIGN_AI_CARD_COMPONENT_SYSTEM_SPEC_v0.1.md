# MALIGN-AI — CARD & COMPONENT SYSTEM SPECIFICATION v0.1

**Fase:** 0 — Análisis y especificación  
**Estado:** DRAFT / NO APROBADO  
**Código:** no iniciado  

## 1. Alcance y jerarquía de fuentes

- Los Gamebooks siguen siendo la fuente normativa primaria de las reglas.
- Los diseños físicos aportados (cartas, tablero, subtableros, fichas y reversos) se usan como evidencia complementaria para formalizar datos, efectos impresos, identidad visual y excepciones.
- Cuando un componente físico difiere del Gamebook, la diferencia se registra como **OPEN QUESTION** y no se reconcilia silenciosamente.
- Esta especificación no convierte ninguna propuesta en decisión aprobada.

## 2. Hallazgo cuantitativo del mazo físico

- El PDF `Cartas frente.pdf` contiene **108 caras de carta** por set.
- Hay **100 definiciones nominales únicas**.
- Distribución por instancia: **81 cartas de campaña**, **16 cartas de Acción ordinaria**, **6 cartas marcadas/funcionalmente de Reacción**, y **5 Starter Cards**.
- Entre las cartas de campaña: **32 malignas**, **20 de resiliencia** y **29 duales**.
- Capacidad de slot por instancia (las cartas multi-slot cuentan en más de una categoría): **13 Intent**, **56 Method**, **63 Amplifier**.
- Duplicados físicos detectados: Inteligencia Artificial ×2; Divisiones Sociales ×2; Influencia Maligna ×3; Temas Divisivos ×2; Resiliencia ×3; Políticas de identidad ×2.

### 2.1 Interpretación importante sobre las 108 cartas

El Gamebook habla de mazos de país de 108 cartas y, por separado, de 5 Starter Cards que no cuentan contra el Operations Deck. El archivo físico de 108 caras **incluye** esas 5 Starter Cards. Esto sugiere que el set físico tiene 108 cartas totales, de las cuales 5 se separan como Starter y 103 quedan como candidatas del pool de operaciones. Esta es una **INTERPRETACIÓN de alta confianza**, pero debe confirmarse antes de modelar el pool de deck-building.

## 3. Catálogo mecánico completo — 108 instancias

Convención de slots: `I` = Intent, `M` = Method, `A` = Amplifier. `Dual` significa utilizable tanto en campañas malignas como de resiliencia.

| # | Carta | Clase | Alineación | IV por slot | Efecto/regla especial impresa |
|---:|---|---|---|---|---|
| 1 | Acuerdos Comerciales | Acción |  | — | Selecciona otro jugador; ambos reciben 2 Recursos. |
| 2 | Agravios Históricos | Campaña | Maligna | A:4 | Con "Temas Divisivos": +2 CV. |
| 3 | Asesores Militares | Campaña | Dual | M:3, A:3 | — |
| 4 | Asociaciones Público-Privadas | Campaña | Dual | M:5, A:5 | — |
| 5 | Ataque de Denegación de Servicio | Campaña | Maligna | M:2, A:2 | — |
| 6 | Atribución | Campaña | Resiliencia | M:3, A:3 | — |
| 7 | Cabildos | Campaña | Dual | M:4, A:4 | — |
| 8 | Campaña de Alfabetización Mediática | Campaña | Resiliencia | M:5 | Con "Curso de Alfabetización Mediática": +2 CV. |
| 9 | #Campaña | Campaña | Dual | A:1 | Con "Influencers": +2 CV. |
| 10 | Campaña de Hostigamiento | Campaña | Maligna | M:4, A:4 | Con "Doxing": +2 CV. |
| 11 | Acción Encubierta | Campaña | Maligna | M:5, A:5 | — |
| 12 | Agente Doble | Acción |  | — | Gasta 1 Recurso; selecciona un jugador, revisa su mano completa y descarta 5 cartas. |
| 13 | Apps de Chat | Campaña | Maligna | A:4 | Con "Desinformación": +2 CV. |
| 14 | Aprendizaje basado en juegos | Campaña | Dual | M:4, A:4 | — |
| 15 | Astroturfing | Campaña | Maligna | M:3, A:3 | Con "Agravios Históricos": +2 CV. |
| 16 | Cámara de Eco | Campaña | Maligna | M:3, A:3 | — |
| 17 | Censura Doméstica | Campaña | Maligna | M:5, A:5 | Con "Control Editorial": +2 CV. |
| 18 | Ciberseguridad | Reacción |  | — | Cuando un rival te ataque con "Hack Back", anula el efecto. |
| 19 | Cohesión Social | Campaña | Resiliencia | I:3 | — |
| 20 | Comentaristas Políticos | Campaña | Maligna | A:4 | Con "Cámara de Eco": +2 CV. |
| 21 | Contrainteligencia | Reacción |  | — | Cuando un rival te ataque con "Agente Doble", anula el efecto. |
| 22 | Control Editorial | Campaña | Maligna | M:4, A:4 | — |
| 23 | Descartar | Acción |  | — | Descarta 2 cartas de tu mano y agrega 1 carta de la pila de descarte a tu mano. |
| 24 | Desinformación | Campaña | Maligna | M:4, A:4 | — |
| 25 | Ejército de Bots | Campaña | Maligna | A:2 | — |
| 26 | Filtraciones | Acción |  | — | Agrega 3 cubos malignos a cualquier PD. |
| 27 | Financiamiento Externo | Campaña | Dual | M:4, A:4 | — |
| 28 | Gestión de Crisis | Acción |  | — | Gasta 3 Recursos para agregar 3 cubos de resiliencia a cualquier 1 PD. |
| 29 | Influencers | Campaña | Dual | M:2, A:2 | — |
| 30 | Intercambio de Inteligencia | Campaña | Resiliencia | M:5, A:5 | — |
| 31 | Ladrón Encubierto | Acción |  | — | Elige 1 carta de la mano de un jugador y agrégala a tu mano; al descartarla, vuelve al dueño. |
| 32 | Medidas Activas | Acción |  | — | Gasta 1 Recurso; descarta una campaña de un jugador. |
| 33 | Microtargeting | Campaña | Dual | A:6 | Con "Temas Divisivos": +2 CV. |
| 34 | Noticias Falsas | Campaña | Maligna | M:5, A:5 | — |
| 35 | Patrocinio educativo | Campaña | Dual | M:3, A:3 | — |
| 36 | Prensa Independiente | Campaña | Resiliencia | M:4 | — |
| 37 | Sanciones Económicas | Acción |  | — | Confisca 2 Recursos de 1 jugador y agrégalos a tus propios recursos. |
| 38 | Seguridad Electoral | Campaña | Resiliencia | M:3, A:3 | Con "Efectos Nacionales": +2 CV. |
| 39 | Think Tanks | Campaña | Dual | M:4, A:4 | — |
| 40 | Chantaje | Campaña | Maligna | M:4, A:4 | — |
| 41 | Ciberataque | Campaña | Dual | M:5, A:5 | — |
| 42 | Construcción de coalición | Campaña | Dual | M:2, A:2 | Por cada otro jugador que descarte 1 Recurso, agrega 1 al CV. |
| 43 | Contraataque Informático | Reacción |  | — | Cuando un oponente te ataque con "Ciberataque", anula su efecto. |
| 44 | Curso de Alfabetización Mediática | Campaña | Resiliencia | M:3, A:3 | — |
| 45 | Deepfake | Campaña | Maligna | M:6, A:6 | — |
| 46 | Desinformación Electoral | Campaña | Maligna | M:4, A:4 | Con "Manipulación Electoral": +2 CV. |
| 47 | Desplataformización | Campaña | Dual | M:6, A:6 | — |
| 48 | Detección de Bots y Spam | Campaña | Resiliencia | M:2, A:2 | — |
| 49 | Diásporas | Campaña | Dual | M:4, A:4 | Con "Protestas Organizadas": +2 CV. |
| 50 | Diplomacia Pública | Campaña | Resiliencia | M:5 | — |
| 51 | Doble Acción | Acción |  | — | Gasta 1 Recurso; activa cualquier campaña, incluso si fue activada anteriormente. |
| 52 | Doxing | Campaña | Dual | M:3, A:3 | — |
| 53 | Efectos Nacionales | Campaña | Dual | M:6, A:6 | — |
| 54 | Ejercicios Militares | Campaña | Dual | M:6, A:6 | Gasta 1 Recurso para usar esta carta en una campaña. |
| 55 | Emitir Códigos y Estándares | Campaña | Resiliencia | M:2, A:2 | Con "Política Coordinada": +2 CV. |
| 56 | Espionaje | Acción |  | — | Selecciona aleatoriamente 3 cartas de la mano de cualquier jugador; revísalas y devuélvelas. |
| 57 | Foros en Línea | Campaña | Maligna | A:4 | Con "Radicalización en Línea": +2 CV. |
| 58 | Fortalecer Instituciones | Campaña | Resiliencia | M:4, A:4 | Con "Cohesión Social": +2 CV. |
| 59 | Giro de Política | Starter |  | — | Descarta toda tu mano; baraja tu descarte y Mazo de Operaciones; roba 10 nuevas cartas; retira tras usar. |
| 60 | Guerra Jurídica | Campaña | Dual | M:5, A:5 | Con "Organizaciones Internacionales": +2 CV. |
| 61 | Identidades Falsas | Campaña | Dual | A:3 | Cuando se descarta con una campaña, regresa a tu mano. |
| 62 | Infraestructura de Información | Campaña | Dual | A:4 | — |
| 63 | Intención Libre | Starter | Dual | I:1 | Coloca 1 DT en esta carta como objetivo de la campaña; retira tras usar. |
| 64 | Interagencia | Acción |  | — | Gasta 1 Recurso; busca en tu Mazo de Operaciones e intercambia 1 carta del mazo con 1 de tu mano; baraja el mazo. |
| 65 | Leyes Anticorrupción | Reacción |  | — | Cuando "Corrupción" se juegue contra ti, lanza 1d10; con 4 o menos, anula la carta. |
| 66 | Lista Blanca | Campaña | Resiliencia | A:2 | Con "Verificación de Datos": +2 CV. |
| 67 | Manipulación Electoral | Campaña | Maligna | M:5, A:5 | — |
| 68 | Memes Maliciosos | Campaña | Maligna | M:2, A:2 | Con "Ejército de Bots": +2 CV. |
| 69 | Movilización Militar | Campaña | Dual | M:6, A:6 | Gasta 3 Recursos para usar esta carta en una campaña. |
| 70 | Movilización Popular | Campaña | Dual | M:4, A:4 | — |
| 71 | Participación de la Sociedad Civil | Campaña | Resiliencia | M:5 | — |
| 72 | Política Coordinada | Campaña | Resiliencia | M:6, A:6 | — |
| 73 | Derecho preferente de compra | Reacción |  | — | Cuando un jugador coloca una campaña, lanza 1d10; con 4 o menos, descarta su campaña antes de que transcurra. |
| 74 | Presión Económica | Campaña | Maligna | M:6, A:6 | Con "Alianzas Público-Privadas": +2 CV. |
| 75 | Presupuesto Aumentado | Starter |  | — | Gana 4 Recursos de inmediato; retira tras usar. |
| 76 | Protestas Organizadas | Campaña | Dual | M:4, A:4 | — |
| 77 | Radicalización en Línea | Campaña | Maligna | M:4, A:4 | Con "Teoría de la Conspiración": +2 CV. |
| 78 | Regulación de Plataformas | Campaña | Resiliencia | M:5, A:5 | Con "Alianzas Público-Privadas": +2 CV. |
| 79 | Restricciones de Viaje | Campaña | Maligna | M:2, A:2 | — |
| 80 | Robar | Acción |  | — | Roba 3 cartas de tu Mazo de Operaciones; descarta cartas hasta quedar bajo el límite de mano. |
| 81 | Robo Cibernético | Acción |  | — | Los demás jugadores lanzan 1d10; cada uno que saque 4 o menos da 1 Recurso a este jugador. |
| 82 | Tarro de Miel | Acción |  | — | Elige un jugador y hazlo lanzar 1d10; con 6 o menos, debe descartar una carta de Acción. |
| 83 | Teoría Conspirativa | Campaña | Maligna | M:4 | — |
| 84 | Verificación de Hechos | Campaña | Resiliencia | M:2, A:2 | — |
| 85 | Veto | Starter |  | — | Reacción: cuando un jugador coloca una campaña, inicia voto; si la mayoría acuerda, descarta la campaña; retira tras usar. |
| 86 | Videos de Propaganda | Campaña | Maligna | M:3, A:3 | Con "Deepfake": +2 CV. |
| 87 | ¡Impulso! | Acción |  | — | Al tirar los dados para una campaña, juega esta carta; suma 1 a tu tirada. |
| 88 | Corrupción | Acción |  | — | Gasta 1 Recurso y reduce los PV de un jugador en 2. |
| 89 | Organizaciones Internacionales | Campaña | Dual | M:4, A:4 | — |
| 90 | Operación de Desinformación | Campaña | Maligna | M:6, A:6 | Con "Ejército de Bots": +2 CV. |
| 91 | Rastreo de Datos | Campaña | Resiliencia | M:2, A:2 | — |
| 92 | Influencia Política | Campaña | Dual | M:4, A:4 | — |
| 93 | Política Prioritaria | Starter |  | — | Busca en tu Mazo de Operaciones y agrega 2 cartas a tu mano; baraja el mazo; retira tras usar. |
| 94 | Protocolos de Seguridad | Reacción |  | — | Si esta carta está en tu mano cuando robas "Filtraciones", anula "Filtraciones" y envía ambas a tu descarte. |
| 95 | Inteligencia Artificial | Campaña | Dual | A:3 | — |
| 96 | Inteligencia Artificial | Campaña | Dual | A:3 | — |
| 97 | Divisiones Sociales | Campaña | Maligna | I:2 | Coloca cualquier DT como objetivo de la campaña. |
| 98 | Divisiones Sociales | Campaña | Maligna | I:2 | Coloca cualquier DT como objetivo de la campaña. |
| 99 | Influencia Maligna | Campaña | Maligna | I:1 | Coloca cualquier DT como objetivo de la campaña. |
| 100 | Influencia Maligna | Campaña | Maligna | I:1 | Coloca cualquier DT como objetivo de la campaña. |
| 101 | Influencia Maligna | Campaña | Maligna | I:1 | Coloca cualquier DT como objetivo de la campaña. |
| 102 | Temas Divisivos | Campaña | Maligna | I:3 | Coloca cualquier DT como objetivo de la campaña. |
| 103 | Temas Divisivos | Campaña | Maligna | I:3 | Coloca cualquier DT como objetivo de la campaña. |
| 104 | Resiliencia | Campaña | Resiliencia | I:1 | Coloca DT en esta tarjeta como objetivo de la campaña. |
| 105 | Resiliencia | Campaña | Resiliencia | I:1 | Coloca DT en esta tarjeta como objetivo de la campaña. |
| 106 | Resiliencia | Campaña | Resiliencia | I:1 | Coloca DT en esta tarjeta como objetivo de la campaña. |
| 107 | Políticas de identidad | Campaña | Dual | I:3 | Coloca cualquier DT como objetivo de la campaña. |
| 108 | Políticas de identidad | Campaña | Dual | I:3 | Coloca cualquier DT como objetivo de la campaña. |

## 4. Starter Cards

- **Giro de Política**: Descarta toda tu mano; baraja tu descarte y Mazo de Operaciones; roba 10 nuevas cartas; retira tras usar.
- **Intención Libre**: Coloca 1 DT en esta carta como objetivo de la campaña; retira tras usar.
- **Presupuesto Aumentado**: Gana 4 Recursos de inmediato; retira tras usar.
- **Veto**: Reacción: cuando un jugador coloca una campaña, inicia voto; si la mayoría acuerda, descarta la campaña; retira tras usar.
- **Política Prioritaria**: Busca en tu Mazo de Operaciones y agrega 2 cartas a tu mano; baraja el mazo; retira tras usar.

**REGLA OFICIAL del Gamebook:** las Starter Cards comienzan en mano, no cuentan contra el tamaño del Operations Deck y se eliminan permanentemente después de usarse.

## 5. Sistema de Reacciones y ventanas detectadas en las cartas

- **Ciberseguridad** — Cuando un rival te ataque con "Hack Back", anula el efecto.
- **Contrainteligencia** — Cuando un rival te ataque con "Agente Doble", anula el efecto.
- **Contraataque Informático** — Cuando un oponente te ataque con "Ciberataque", anula su efecto.
- **Leyes Anticorrupción** — Cuando "Corrupción" se juegue contra ti, lanza 1d10; con 4 o menos, anula la carta.
- **Derecho preferente de compra** — Cuando un jugador coloca una campaña, lanza 1d10; con 4 o menos, descarta su campaña antes de que transcurra.
- **Protocolos de Seguridad** — Si esta carta está en tu mano cuando robas "Filtraciones", anula "Filtraciones" y envía ambas a tu descarte.
- **Veto** también funciona como reacción aunque su clase física sea Starter.
- **¡Impulso!** posee una ventana especial asociada a la tirada de campaña, aunque no está rotulada como REACCIÓN. Esto obliga a separar `card_type` de `timing_window` en el futuro modelo de datos.

## 6. Bonificaciones y dependencias entre cartas

- **Agravios Históricos**: Con "Temas Divisivos": +2 CV.
- **Campaña de Alfabetización Mediática**: Con "Curso de Alfabetización Mediática": +2 CV.
- **#Campaña**: Con "Influencers": +2 CV.
- **Campaña de Hostigamiento**: Con "Doxing": +2 CV.
- **Apps de Chat**: Con "Desinformación": +2 CV.
- **Astroturfing**: Con "Agravios Históricos": +2 CV.
- **Censura Doméstica**: Con "Control Editorial": +2 CV.
- **Comentaristas Políticos**: Con "Cámara de Eco": +2 CV.
- **Microtargeting**: Con "Temas Divisivos": +2 CV.
- **Seguridad Electoral**: Con "Efectos Nacionales": +2 CV.
- **Construcción de coalición**: Por cada otro jugador que descarte 1 Recurso, agrega 1 al CV.
- **Desinformación Electoral**: Con "Manipulación Electoral": +2 CV.
- **Diásporas**: Con "Protestas Organizadas": +2 CV.
- **Emitir Códigos y Estándares**: Con "Política Coordinada": +2 CV.
- **Foros en Línea**: Con "Radicalización en Línea": +2 CV.
- **Fortalecer Instituciones**: Con "Cohesión Social": +2 CV.
- **Guerra Jurídica**: Con "Organizaciones Internacionales": +2 CV.
- **Lista Blanca**: Con "Verificación de Datos": +2 CV.
- **Memes Maliciosos**: Con "Ejército de Bots": +2 CV.
- **Presión Económica**: Con "Alianzas Público-Privadas": +2 CV.
- **Radicalización en Línea**: Con "Teoría de la Conspiración": +2 CV.
- **Regulación de Plataformas**: Con "Alianzas Público-Privadas": +2 CV.
- **Videos de Propaganda**: Con "Deepfake": +2 CV.
- **Operación de Desinformación**: Con "Ejército de Bots": +2 CV.

### 6.1 Inconsistencias nominales en referencias de cartas

- `Ciberseguridad` referencia **HACK BACK**, mientras la carta española existente se titula **Contraataque Informático**.
- `Lista Blanca` referencia **Verificación de Datos**, mientras el set incluye **Verificación de Hechos**.
- `Presión Económica` y `Regulación de Plataformas` referencian **Alianzas Público-Privadas**, mientras el set incluye **Asociaciones Público-Privadas**.
- `Radicalización en Línea` referencia **Teoría de la Conspiración**, mientras el set incluye **Teoría Conspirativa**.
Estas referencias requieren una tabla de alias explícita; no deben corregirse silenciosamente.

## 7. Reglas emergentes confirmadas por las cartas

1. **Doble Acción** es una excepción explícita a la regla base de una activación por campaña por turno: puede activar una campaña incluso si ya fue activada.
2. Algunas cartas de campaña tienen **coste adicional propio** además del coste de activación por CV: `Ejercicios Militares` cuesta 1 Recurso y `Movilización Militar` cuesta 3 Recursos para poder usarse en campaña.
3. Existen cartas que mueven directamente cubos sin ERT (`Filtraciones`, `Gestión de Crisis`), lo que exige aclarar cómo interactúan con 2:1, legitimidad y VP.
4. Existen cartas que alteran directamente VP (`Corrupción`), recursos (`Acuerdos Comerciales`, `Sanciones Económicas`, `Robo Cibernético`) y manos ajenas (`Agente Doble`, `Ladrón Encubierto`, `Espionaje`).
5. `Ladrón Encubierto` demuestra que **propiedad de carta** y **posesión actual** son estados distintos: la carta robada vuelve a su dueño cuando se descarta.
6. El conjunto completo confirma que una campaña válida sin bonuses tiene CV base dentro del rango 3–15: Intent mínimo 1 + Method mínimo 2 = 3; Intent máximo 3 + Method máximo 6 + Amplifier máximo 6 = 15.
7. Sin embargo, los bonuses pueden elevar el **CV efectivo** por encima de 15; el Gamebook no especifica explícitamente el tratamiento de CV efectivo >15.

## 8. Componentes físicos incorporados al análisis

### 8.1 Player Mats / Subtableros

Los cinco subtableros confirman dos filas de campaña (`I` y `II`), tres slots por fila, zona de Operations Deck, zona de descarte, Regime Ability, ingreso inicial e ingreso por turno. También fijan los regímenes impresos: Presque — Democracia Multipartidista; Ursaria — Autoritaria; Arden — Democracia Bipartidista; Fluma — Territorio Democrático; Dinesia — Democracia Experimental.

### 8.2 Fichas pequeñas

El troquel aporta material explícito para partidos políticos, religiones, etnicidades, educación, símbolos nacionales y tamaños de población. Se observan, entre otros: Socialista, Foro Republicano, Nacionalista, Tierra Limpia, Frente de Liberación; Partido de la Libertad, Frente de los Trabajadores; Nuevo Republicano, Demócrata Ciudadano; Central, Los Pueblos de Ursaria; Juventud, Pueblo de Dinesia, Democrático Popular; Nativo, Asiático, Negro, Hispano, Blanco; niveles Menos que el instituto, Instituto de Secundaria, Universidad y Avanzado; tamaños Grande, Medio y Pequeño.
La ficha `GIRA` parece corresponder al Turn Tracker traducido físicamente, no a una categoría demográfica; debe tratarse como componente de control de turno salvo confirmación contraria.

### 8.3 Reversos de cartas

El archivo de reversos contiene cinco reversos diferenciados por color, corroborando un set de cartas por país y la identidad visual por facción.

## 9. Conflicto crítico: numeración de PD del tablero físico vs escenario del Gamebook

El tablero principal aportado muestra 14 PD visibles distribuidas por color/país con numeración impresa que no coincide con la tabla del escenario del Gamebook. En el tablero físico se observan: Presque `0,2,3`; Dinesia `4,5,6`; Ursaria `7,8,9`; Fluma `10,11`; Arden `12,13,14`. El escenario del Gamebook usa: Presque `1–3`; Ursaria `4–6`; Fluma `7–8`; Arden `9–11`; Dinesia `18–20`. Esta discrepancia es **OPEN QUESTION crítica** y afecta Scenario Data, targeting, replay, VP objectives y cualquier identificador de PD.

**PROPUESTA NO APROBADA:** en software, utilizar un `pd_id` interno estable independiente del número impreso y mantener `printed_label` / `scenario_label` como atributos separados hasta resolver la fuente canónica.

## 10. OPEN QUESTIONS nuevas o refinadas

- **OQ-CARD-001** — ¿Las 108 cartas del country set incluyen formalmente las 5 Starter Cards (103 pool + 5 Starter), como sugiere el PDF físico, o existen 108 cartas seleccionables más 5 Starter separadas?
- **OQ-CARD-002** — Cuando una carta añade cubos directamente sin campaña/ERT (Filtraciones, Gestión de Crisis, habilidades de régimen), ¿se aplica siempre la regla 2:1?
- **OQ-CARD-003** — ¿Los cubos añadidos directamente por cartas/habilidades pueden establecer/subvertir Legitimacy y/o generar VP?
- **OQ-CARD-004** — ¿Cómo se resuelve el CV efectivo >15 producido por bonuses? ¿Se trata simplemente como High, existe cap de 15 o se aplica otra regla?
- **OQ-CARD-005** — ¿Pueden acumularse múltiples bonuses de pairing sobre una misma campaña?
- **OQ-CARD-006** — ¿El coste adicional impreso en una carta de campaña se suma siempre al coste de activación por tier?
- **OQ-CARD-007** — `¡Impulso!` no está rotulada REACCIÓN pero se juega 'al tirar los dados'. ¿Consume un AP planificado, se juega desde mano fuera de Action Stage, o ambas cosas?
- **OQ-CARD-008** — `Agente Doble`: ¿quién elige exactamente las 5 cartas a descartar y qué ocurre si la mano objetivo tiene menos de 5?
- **OQ-CARD-009** — `Ladrón Encubierto`: ¿puede robar Starter Cards o cualquier carta? ¿Qué ocurre con 'remove after use' y con el límite de mano?
- **OQ-CARD-010** — `Medidas Activas`: ¿puede descartar cualquier campaña, incluso una ya activada o una en fila II?
- **OQ-CARD-011** — `Construcción de coalición`: ¿cada otro jugador puede contribuir como máximo 1 Recurso? ¿En qué momento se declara/paga la contribución?
- **OQ-CARD-012** — `Tarro de Miel`: ¿la carta de Acción descartada debe provenir de la mano? ¿Quién la elige? ¿Qué ocurre si el objetivo no tiene Action Cards?
- **OQ-CARD-013** — `Corrupción`: ¿los VP pueden ser negativos? El tablero físico no muestra una casilla 0/negativa.
- **OQ-CARD-014** — `Protocolos de Seguridad`: el texto 'cuando robas Filtraciones' es ambiguo. ¿Significa cuando Filtraciones te es jugada/robada, cuando la robas del deck, o alguna otra ventana?
- **OQ-CARD-015** — Resolver los alias nominales HACK BACK/Contraataque Informático, Verificación de Datos/Verificación de Hechos, Alianzas/Asociaciones Público-Privadas y Teoría de la Conspiración/Teoría Conspirativa.
- **OQ-COMP-001** — ¿Qué numeración de PD es canónica para el escenario base: tablero físico o tabla del Gamebook?
- **OQ-COMP-002** — ¿La ficha `Juventud` de Dinesia forma parte de un escenario alternativo/custom o debe incorporarse a las características base del país?
- **OQ-COMP-003** — ¿Los nombres textuales de colores del Gamebook o los colores efectivos de los assets físicos serán la referencia visual canónica de MALIGN-AI?

## 11. Estado de cierre de este paso

- **Catálogo mecánico de cartas:** completado a nivel de 108 instancias y 100 definiciones nominales.
- **Efectos especiales, bonuses y triggers:** inventariados.
- **Componentes físicos principales:** incorporados al modelo conceptual.
- **Inconsistencias nuevas:** registradas, no resueltas silenciosamente.
- **Siguiente paso recomendado dentro de Fase 0:** convertir este catálogo en una `RULE EFFECT TAXONOMY` formal (tipos de efecto, targets, costes, timing, ventanas, precondiciones y postcondiciones) y después cerrar el `OPEN QUESTIONS REGISTER` necesario antes del modelo de datos.
