# MALIGN-AI --- PROJECT MASTER FILE

## Documento maestro de continuidad, contexto e instrucciones del proyecto

**Versión:** 0.1\
**Fecha:** 2026-08-22\
**Estado:** Inicio del proyecto\
**Propósito:** Servir como fuente de continuidad del proyecto MALIGN-AI
y reducir la dependencia de la memoria conversacional.

------------------------------------------------------------------------

# 1. IDENTIDAD DEL PROYECTO

**Nombre de trabajo:** MALIGN-AI

**Descripción:** Sistema web inteligente de apoyo al juego de mesa serio
**Malign**, diseñado para digitalizar y asistir la conducción de una
partida de hasta cinco jugadores y un facilitador.

La plataforma deberá permitir que los jugadores y el facilitador accedan
a un único entorno web, manteniendo roles y permisos diferenciados.

La IA deberá: - orientar a los jugadores; - resolver dudas sobre las
reglas y el escenario; - interpretar acciones expresadas en lenguaje
natural; - asistir al facilitador; - apoyar la construcción y
explicación de narrativas; - explicar los resultados de las
adjudicaciones; - apoyar el análisis posterior al ejercicio.

La adjudicación principal NO debe depender exclusivamente de un LLM.
Debe existir un **Game Engine / Adjudication Engine determinístico**,
basado en las reglas formalizadas de Malign. La IA debe interpretar,
consultar, orientar y explicar; el motor de juego debe validar,
calcular, adjudicar y actualizar el estado de la partida.

------------------------------------------------------------------------

# 2. PRINCIPIO FUNDAMENTAL DEL PROYECTO

## LLM ≠ Motor de adjudicación

Arquitectura conceptual:

LLM / IA → interpreta intención → consulta conocimiento autorizado →
guía al usuario → explica resultados → apoya al facilitador

Game Engine → valida acciones → aplica reglas → calcula valores →
resuelve ERT → actualiza el estado del juego → comprueba condiciones de
victoria

Esta separación es obligatoria salvo decisión posterior explícitamente
aprobada.

------------------------------------------------------------------------

# 3. FUENTES NORMATIVAS INICIALES

Los documentos base entregados por el usuario son:

1.  `Malign-Influence-Rulebook_ENGLISH.pdf`
2.  `Malign-Influence-Rulebook_ESPAÑOL.pdf`

Estos documentos son las fuentes primarias para determinar las reglas
oficiales de Malign.

## Regla de interpretación de fuentes

No modificar, completar, reconciliar o "mejorar" una regla oficial sin
identificarlo explícitamente como: - regla oficial; - interpretación; -
propuesta de diseño; - variante; - decisión aprobada del proyecto.

Cuando exista una ambigüedad en los documentos, debe registrarse como
**OPEN QUESTION** y no resolverse silenciosamente.

------------------------------------------------------------------------

# 4. ESTADO ACTUAL DEL ANÁLISIS

El análisis inicial identifica que Malign ya posee un conjunto
importante de mecánicas formalizables:

-   cinco jugadores/facciones;
-   escenarios;
-   mazos de operaciones;
-   cartas de Intención;
-   cartas de Método;
-   cartas de Amplificador;
-   cartas de Acción;
-   cartas de Reacción;
-   cartas iniciales;
-   recursos;
-   puntos de acción (AP);
-   iniciativa;
-   campañas;
-   Valor de Influencia (IV);
-   Valor de Campaña (CV);
-   Tabla de Resultados de Efectos (ERT);
-   dado d10;
-   Poblaciones Demográficas (PD);
-   Tokens Demográficos (DT);
-   influencia maligna;
-   resiliencia;
-   legitimidad;
-   puntos de victoria;
-   objetivos secretos;
-   backlash;
-   habilidades de régimen;
-   negociación;
-   narrativa;
-   veto;
-   mecánicas de viralización;
-   escenarios y reglas adaptables.

La documentación establece, entre otros elementos, cinco fases generales
del turno: 1. Strategy Stage 2. Initiative Stage 3. Action Stage 4.
Resolution Stage 5. Cleanup Stage

La adjudicación de campañas utiliza el CV para determinar el nivel de
campaña y la ERT para resolver el efecto mediante d10.

------------------------------------------------------------------------

# 5. OBJETIVO DEL PRODUCTO

Construir una plataforma web profesional que permita:

## Jugadores

Cada uno de los cinco jugadores deberá poder: - iniciar sesión; - ver
solamente la información que le corresponde; - consultar sus recursos; -
gestionar sus cartas; - construir/modificar campañas; - seleccionar
acciones; - introducir narrativas; - recibir orientación de IA; -
consultar reglas; - observar los resultados autorizados; - participar en
votaciones/vetos; - interactuar con otros jugadores según las reglas; -
conocer su progreso y objetivos autorizados.

## Facilitador

El facilitador deberá poder: - crear/iniciar una partida; - seleccionar
escenario; - configurar parámetros; - controlar turnos y fases; -
observar el estado completo; - revisar acciones; - supervisar
adjudicaciones; - intervenir manualmente; - introducir eventos; -
resolver excepciones; - pausar/reanudar; - modificar estados cuando
corresponda; - consultar al asistente IA; - generar/revisar AAR.

------------------------------------------------------------------------

# 6. ARQUITECTURA CONCEPTUAL

La arquitectura inicial propuesta es:

Usuario → Web App → Backend / API → Game Engine → Adjudication Engine →
Game State / Database

Y en paralelo:

Web App → AI Orchestration Layer → OpenAI API / modelos → Knowledge Base
/ RAG → Game Engine / datos autorizados

La IA NO debe tener acceso indiscriminado a toda la información de la
partida.

Debe existir control de: - rol; - jugador; - escenario; - información
conocida; - información oculta; - información del facilitador.

------------------------------------------------------------------------

# 7. STACK TECNOLÓGICO PROPUESTO

Esta es una propuesta inicial, NO una decisión irreversible.

### Frontend

-   Next.js
-   React
-   TypeScript

### Backend

-   Next.js/API o arquitectura backend equivalente
-   TypeScript

### Base de datos

-   PostgreSQL
-   Supabase como opción inicial de infraestructura gestionada

### Autenticación

-   Supabase Auth o solución equivalente

### Tiempo real

-   Supabase Realtime o equivalente

### IA

-   OpenAI API

### Control de versiones

-   GitHub

### Desarrollo asistido

-   Codex

### Hosting

-   Vercel como opción inicial

### Dominio

-   Dominio propio cuando exista el MVP

No contratar infraestructura costosa antes de conocer los requisitos
reales.

------------------------------------------------------------------------

# 8. PRINCIPIO DE FUENTE DE VERDAD

La memoria conversacional NO debe considerarse la única fuente de verdad
del proyecto.

Debe existir documentación persistente y versionada.

Archivos conceptuales previstos:

``` text
MALIGN-AI/
├── README.md
├── PROJECT_STATE.md
├── DECISIONS.md
├── OPEN_QUESTIONS.md
├── CHANGELOG.md
├── docs/
│   ├── GAME_ANALYSIS.md
│   ├── GAME_RULES_SPEC.md
│   ├── GAME_DATA_MODEL.md
│   ├── ADJUDICATION_ENGINE.md
│   ├── AI_ARCHITECTURE.md
│   ├── UX_SPEC.md
│   └── TEST_STRATEGY.md
├── frontend/
├── backend/
├── game-engine/
└── tests/
```

Los nombres podrán cambiar, pero el principio debe mantenerse.

------------------------------------------------------------------------

# 9. REGLAS PARA EL DESARROLLO

1.  No programar reglas no documentadas.
2.  No cambiar reglas oficiales silenciosamente.
3.  Toda modificación de una regla debe quedar registrada.
4.  Separar claramente:
    -   regla oficial;
    -   interpretación;
    -   propuesta;
    -   variante;
    -   decisión aprobada.
5.  Toda función crítica del Game Engine debe tener pruebas.
6.  Toda adjudicación debe poder explicarse y auditarse.
7.  El facilitador debe conservar autoridad para intervenir.
8.  La IA no debe convertirse en árbitro absoluto.
9.  El sistema debe mantener un historial de eventos de la partida.
10. El sistema debe permitir reproducir una partida o reconstruir su
    secuencia de decisiones.
11. La información oculta debe estar protegida por roles/permisos.
12. Las decisiones importantes de arquitectura deben registrarse en
    `DECISIONS.md`.

------------------------------------------------------------------------

# 10. PLAN DE DESARROLLO

## FASE 0 --- Especificación

Estado: **ACTUAL**

Objetivo: Convertir los Gamebooks en una especificación computable.

Entregables: - análisis completo del juego; - inventario de entidades; -
inventario de reglas; - flujo de turnos; - reglas de adjudicación; -
excepciones; - información pública/privada; - preguntas abiertas.

## FASE 1 --- Modelo de datos

Definir: - Game; - Scenario; - Player; - Country/Faction; - Card; -
Deck; - Hand; - Campaign; - Population Demographic; - Influence; -
Resiliency; - Legitimacy; - Resource; - Action; - Turn; - Phase; -
Victory Condition; - Game Event; - Adjudication Result.

## FASE 2 --- Game Engine

Implementar primero sin IA: - fases; - turnos; - iniciativa; -
recursos; - AP; - cartas; - campañas; - CV; - ERT; - efectos; -
backlash; - legitimidad; - VP; - victoria.

## FASE 3 --- Interfaz MVP

Crear: - login; - lobby; - vista jugador; - vista facilitador; -
tablero; - cartas; - acciones; - resolución.

## FASE 4 --- IA

Agregar: - asistente de reglas; - asistente de jugador; - asistente de
facilitador; - interpretación de lenguaje natural; - narrativa; -
explicación de adjudicación; - RAG.

## FASE 5 --- Multiplayer / tiempo real

-   sincronización;
-   acciones simultáneas;
-   iniciativa;
-   votaciones;
-   eventos;
-   información diferenciada.

## FASE 6 --- AAR y analítica

-   replay;
-   timeline;
-   métricas;
-   decisiones críticas;
-   desempeño;
-   análisis posterior.

## FASE 7 --- Piloto y validación

-   pruebas técnicas;
-   pruebas de reglas;
-   pruebas de usabilidad;
-   partida piloto;
-   comparación con juego físico;
-   ajustes;
-   versión 1.0.

------------------------------------------------------------------------

# 11. ORDEN DE TRABAJO INMEDIATO

NO comenzar programando.

El siguiente trabajo autorizado es:

### Paso 1

Analizar exhaustivamente los dos Gamebooks.

### Paso 2

Construir el inventario de reglas de Malign.

### Paso 3

Clasificar cada regla como: - determinística; - probabilística; -
narrativa; - intervención del facilitador; - interacción entre
jugadores; - información oculta; - condición de victoria.

### Paso 4

Construir el modelo de datos.

### Paso 5

Diseñar el Adjudication Engine.

### Paso 6

Definir el MVP.

Solo después comenzar la implementación.

------------------------------------------------------------------------

# 12. DOCUMENTOS DE DECISIONES

Toda decisión importante deberá registrarse con:

``` text
DECISION ID:
FECHA:
TEMA:
PROBLEMA:
OPCIONES:
DECISIÓN:
JUSTIFICACIÓN:
IMPACTO:
ESTADO:
```

Estados permitidos: - PROPOSED - APPROVED - REJECTED - SUPERSEDED

------------------------------------------------------------------------

# 13. PREGUNTAS ABIERTAS INICIALES

Estas preguntas NO deben resolverse automáticamente:

-   ¿La plataforma será una digitalización 1:1 del juego físico o una
    evolución de Malign?
-   ¿Se mantendrán exactamente las cinco facciones originales?
-   ¿Qué reglas de viralización se implementarán en la primera versión?
-   ¿Qué eventos requieren intervención humana?
-   ¿Qué información debe ser secreta para cada jugador?
-   ¿Cómo se digitalizará la negociación?
-   ¿Cómo se manejarán las cartas de reacción?
-   ¿Cómo se manejará el veto?
-   ¿Cómo se manejarán escenarios personalizados?
-   ¿Qué grado de libertad narrativa tendrá la IA?
-   ¿Qué decisiones podrá tomar automáticamente la IA?
-   ¿Qué decisiones requerirán aprobación del facilitador?
-   ¿Se conservará el dado físico o será digital?
-   ¿Se conservará alguna interacción física con el tablero?
-   ¿El objetivo inicial es únicamente Malign o un motor reutilizable
    para otros wargames?

------------------------------------------------------------------------

# 14. REGLA DE CONTINUIDAD PARA CHATGPT

Cuando se retome este proyecto:

1.  Consultar primero este archivo.
2.  Revisar `DECISIONS.md`.
3.  Revisar `OPEN_QUESTIONS.md`.
4.  Revisar `CHANGELOG.md`.
5.  Identificar qué entregables ya están aprobados.
6.  No asumir que una propuesta es una decisión aprobada.
7.  Si existe contradicción entre documentación, señalarla antes de
    modificarla.
8.  Usar los Gamebooks como fuente normativa primaria para las reglas
    oficiales.
9.  Mantener trazabilidad de los cambios.

------------------------------------------------------------------------

# 15. MENSAJE DE ARRANQUE DEL PROYECTO

Al iniciar una nueva conversación dentro del Proyecto MALIGN-AI, se
puede utilizar:

> Estamos trabajando en MALIGN-AI. Usa `PROJECT_STATE.md` como documento
> maestro de continuidad. Los Gamebooks de Malign son las fuentes
> normativas primarias. Diferencia siempre entre reglas oficiales,
> interpretaciones, propuestas y decisiones aprobadas. No programes
> todavía salvo que se solicite explícitamente. El estado actual es FASE
> 0 --- Especificación. El siguiente objetivo es completar el análisis
> técnico de Malign y construir el inventario computable de reglas.

------------------------------------------------------------------------

# 16. PRINCIPIO DE CONTROL DE CAMBIOS

Ninguna modificación estructural importante debe hacerse simplemente
porque "parece mejor".

Para cambios importantes:

1.  Identificar problema.
2.  Presentar alternativas.
3.  Analizar impacto.
4.  Proponer solución.
5.  Obtener aprobación del usuario.
6.  Registrar decisión.
7.  Implementar.
8.  Crear/prueba actualizar tests.
9.  Actualizar documentación.

------------------------------------------------------------------------

# 17. ESTADO ACTUAL

**Proyecto:** MALIGN-AI\
**Versión:** 0.1\
**Fase:** 0 --- Especificación\
**Código:** todavía NO iniciado\
**Repositorio GitHub:** todavía NO creado\
**Hosting:** todavía NO contratado\
**Base de datos:** todavía NO creada\
**API de IA:** todavía NO configurada\
**Game Engine:** todavía NO implementado\
**Adjudication Engine:** todavía NO implementado\
**Gamebooks:** disponibles y analizados inicialmente\
**Próximo entregable:** análisis técnico exhaustivo + especificación
computable de Malign.

------------------------------------------------------------------------

# 18. NOTA SOBRE PERSISTENCIA

Este archivo NO garantiza por sí mismo la conservación de una
conversación de ChatGPT.

Su función es diferente: constituye una **fuente externa y versionable
del estado del proyecto**.

La continuidad robusta debe apoyarse en tres capas:

1.  **Proyecto de ChatGPT:** contexto, conversaciones, archivos e
    instrucciones.
2.  **Documentación del proyecto:** decisiones y estado persistente.
3.  **GitHub:** código y versiones del software.

La combinación de estas tres capas evita depender de una única memoria
conversacional.
