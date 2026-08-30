# MALIGN-AI — M2-2 PRODUCTIVE TRANSPORT AND RECONNECT SPECIFICATION v0.1

**Fecha:** 2026-08-29
**Estado:** IMPLEMENTED AND APPROVED / CLOSED mediante DEC-083
**Autoridad:** DEC-081; DEC-082; DEC-083; PTD-M2-012…016
**Baseline preservada:** 253/253 PASS; suite actual 302/302 PASS en 34 archivos

> DEC-082 autorizó y materializó exclusivamente M2-2; DEC-083 aprobó y cerró posteriormente su implementación. Ninguna de estas decisiones autoriza cuentas, secrets, infraestructura persistente, despliegue ni bloques posteriores.

## 1. Alcance y límites

M2-2 materializa transporte productivo configurable y reconnect sobre el Engine y la persistencia aprobados. Los commands autoritativos continúan por HTTP/HTTPS; WebSocket se limita a autenticación, subscriptions, sync, feed autorizado, ACK, resync y draining.

Fuera de este gate permanecen:

- tenant, cuenta, plan, región, costos, secrets o contratación;
- infraestructura persistente, Blueprint y despliegue;
- cambios PostgreSQL, migrations o ampliación de las 87 tablas;
- M2-3…M2-7, cierre global de M2 y M3.

## 2. Investigación oficial

**Fecha de consulta de todas las fuentes:** 2026-08-29. Sólo se usaron fuentes oficiales o primarias.

| Fuente oficial | Conclusión aplicada | Limitación relevante |
|---|---|---|
| [Auth0 — Next.js web app quickstart](https://auth0.com/docs/quickstart/webapp/nextjs) | Auth0 soporta sesión server-side, rutas protegidas y endpoint BFF para access token en Next.js. | El quickstart demuestra integración, pero no selecciona tenant, plan, secretos ni versión para MALIGN-AI. |
| [Auth0 — Validate Access Tokens](https://auth0.com/docs/secure/tokens/access-tokens/validate-access-tokens) | La API debe validar JWT, audience, permissions/scopes y claims estándar y rechazar cualquier fallo. | El contrato MALIGN-AI añade binding de cliente y autorización PostgreSQL fail-closed. |
| [Auth0 — Access Tokens](https://auth0.com/docs/secure/tokens/access-tokens) | Los tokens de Custom API son JWT; `sub` identifica al sujeto, `azp` al cliente autorizado y la API debe usar RS256. | El token no concede membership, seat, actor, game, role ni permisos internos. |
| [Auth0 — Update Access Token Lifetime](https://auth0.com/docs/secure/tokens/access-tokens/update-access-token-lifetime) | El lifetime de Custom API es configurable en segundos; PKCE usa el Token Expiration general. | 300 segundos es default técnico propuesto y debe validarse operacionalmente. |
| [Auth0 — Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation) | La rotación entrega un refresh token nuevo por intercambio e invalida el anterior; existe detección de reutilización. | Los refresh tokens no llegan al browser de MALIGN-AI; quedan sólo en BFF/server-side si se habilitan. |
| [Auth0 — Token Storage](https://auth0.com/docs/secure/security-guidance/data-security/token-storage) | Auth0 recomienda memoria para tokens de browser y advierte que localStorage queda expuesto ante XSS; un backend puede custodiar tokens server-side. | La memoria no persiste entre refresh/tabs, por lo que reconnect obtiene token nuevo desde BFF. |
| [Auth0 — OIDC Back-Channel Logout](https://auth0.com/docs/authenticate/login/logout/back-channel-logout) | Back-channel logout termina sesiones por `sid`/`sub` mediante comunicación server-to-server. | Auth0 lo documenta para tenants Enterprise; no es dependencia del baseline. |
| [`ws` — repositorio oficial](https://github.com/websockets/ws) | `ws` es implementación WebSocket para Node; browser usa `WebSocket` nativo; soporta HTTP upgrade, `noServer`, ping/pong y detección de conexiones rotas. | No se fija versión exacta ni se instala el paquete; compresión requiere pruebas de memoria/carga. |
| [`ws` — API oficial](https://github.com/websockets/ws/blob/master/doc/ws.md) | La API expone límites de payload, buffered amount, ping/pong, cierre y servidor `noServer`. | Los defaults de MALIGN-AI deben configurarse y probarse; no se heredan silenciosamente. |
| [Node.js — release status oficial](https://nodejs.org/en/about/previous-releases) | Node.js 24 figura como LTS y es apto como major de producción. | La versión exacta 24.x debe fijarse y probarse sólo al autorizar implementación. |
| [Render — WebSockets](https://render.com/docs/websocket) | Render acepta WSS, asigna conexiones aleatoriamente entre instancias, recomienda keepalive/reconnect y envía SIGTERM con ventana de shutdown. | Una conexión puede caer por deploy/mantenimiento y no vuelve necesariamente al mismo nodo. |
| [Render — Scaling](https://render.com/docs/scaling) | Render permite múltiples instancias y balancea tráfico; servicios con persistent disk no escalan horizontalmente. | Número, plan y autoscaling generan costos y requieren deployment gate. |
| [Render — Uptime best practices](https://render.com/docs/uptime-best-practices) | Recomienda más de una instancia, health checks, retry para conexiones largas y recovery probado. | Es recomendación operativa, no garantía de disponibilidad ni autorización contractual. |
| [Render — Web Services](https://render.com/docs/web-services) | Web services soportan TLS, WebSocket, scaling y un único puerto HTTP público. | No se crea servicio ni configuración en este gate. |
| [Render — Node version](https://render.com/docs/node-version) | La versión Node puede fijarse mediante `NODE_VERSION`, `.node-version`, `.nvmrc` o `engines`; la documentación vigente usa Node 24 por defecto para servicios nuevos. | La versión exacta 24.x se fijará al autorizar implementación; aquí sólo se selecciona Node.js 24 LTS. |
| [Render — PostgreSQL](https://render.com/docs/postgresql) | Render ofrece PostgreSQL administrado, backups/recovery, HA, pooling y upgrades. | No selecciona plan, RPO/RTO ni sustituye gates de MALIGN-AI. |
| [Render — Create and connect PostgreSQL](https://render.com/docs/postgresql-creating-connecting) | PostgreSQL 18 está disponible; misma región e internal URL reducen latencia y usan red privada. | Cuenta, región, compute, storage y allowlists quedan pendientes. |
| [Render — PostgreSQL upgrades](https://render.com/docs/postgresql-upgrading) | Los upgrades requieren downtime y Render recomienda probar primero sobre una copia. | Cualquier 18.x posterior exige migrations, `db:verify`, gates M2-A/M2-2 y suite completa antes de promover. |
| [Render — Blueprint specification](https://render.com/docs/blueprint-spec) | Blueprint permite declarar instancias, scaling, región, pre-deploy y servicios separados. | No se crea Blueprint; plan comercial y valores concretos quedan para deployment gate. |
| [PostgreSQL 18 — LISTEN](https://www.postgresql.org/docs/18/sql-listen.html) | `LISTEN` entra en vigor al commit y existe una carrera inicial; el orden oficial es LISTEN+commit, consultar estado y luego procesar notificaciones/deduplicar solapamiento. | NOTIFY es señal efímera, no feed durable ni autoridad de estado. |
| [PostgreSQL 18 — Asynchronous Notification](https://www.postgresql.org/docs/18/libpq-notify.html) | Las sesiones reciben notificaciones asíncronas y payload opcional; el cliente debe consumirlas explícitamente. | El payload no llevará secretos ni proyección; catch-up PostgreSQL repara pérdidas. |

## 3. Decisiones técnicas PTD-M2-012…016

| PTD | Decisión aprobada para el gate |
|---|---|
| PTD-M2-012 | Auth0 es proveedor de referencia de AuthN productiva, exclusivamente detrás de un port en application layer. |
| PTD-M2-013 | WebSocket autentica mediante primer frame `AUTHENTICATE`; el port valida token y la autorización/membership se reconstruye desde PostgreSQL. |
| PTD-M2-014 | Node.js 24 LTS + `ws` detrás del port + browser WebSocket nativo + protocolo propio `malign.realtime.v1`; no Socket.IO. |
| PTD-M2-015 | PostgreSQL 18 `LISTEN/NOTIFY` es sólo wake-up efímero; outbox, event log, snapshots y feed son autoridad durable. |
| PTD-M2-016 | Render es target productivo de referencia con topología multinodo stateless y envelope operacional configurable; no autoriza cuenta, plan ni deploy. |

## 4. Resolución de IQ-M2-008 — AuthN productiva

1. Auth0 será el proveedor de referencia, detrás de `ProductiveAuthnPort` en application layer. Domain, Game Engine y Rules no importan SDKs ni conceptos de Auth0.
2. Flujo: Authorization Code con PKCE y sesión server-side/BFF. Cookies de sesión `HttpOnly`, `Secure` y `SameSite` apropiado; nunca access/refresh token en `localStorage`.
3. Refresh tokens, si se usan, permanecen sólo en BFF/server-side y con rotación. El browser obtiene un access token de Custom API desde un endpoint BFF protegido, lo mantiene sólo en memoria y no lo persiste.
4. Lifetime inicial recomendado: **300 segundos**, configurable y sujeto a validación operacional.
5. Validación mínima: issuer, audience, firma RS256 mediante JWKS, `exp`, `nbf` cuando exista, `azp`/client binding y scopes. Cualquier fallo rechaza.
6. Sólo el `sub` verificado puede vincular identidad externa; `game_participants.external_user_ref` puede almacenarlo sin ampliar las 87 tablas.
7. Membership, `participantId`, seat, `actorType`, `gameId`, roles y permisos provienen del estado PostgreSQL autoritativo. Nunca se confía en `ActorContext` o autoridad enviada por el cliente ni derivada sólo del token.
8. Enrollment productivo será invitation-only/allowlisted. Email verificado sirve como evidencia de onboarding, nunca como autorización de partida.
9. Back-channel logout no es dependencia baseline por su disponibilidad Enterprise. Logout baseline invalida sesión local, cierra sockets asociados y limita acceso residual con token corto.
10. Crear tenant/cuentas, contratar Auth0, elegir plan o configurar secrets requiere autorización posterior.

**Resolución:** `IQ-M2-008 RESOLVED mediante DEC-081 / PTD-M2-012…013`.

## 5. Autenticación WebSocket

- WSS obligatorio; `Origin` contra allowlist estricta; subprotocolo único `malign.realtime.v1`.
- El browser no transmite tokens por URL/query, cookie interpretada como autoridad del juego o nombre de subprotocolo.
- Tras el upgrade, el primer frame debe ser `AUTHENTICATE` con access token corto; timeout **5 segundos**.
- Antes de autenticar se rechazan `SUBSCRIBE`, `ACK`, `RESYNC_REQUEST`, `UNSUBSCRIBE` y cualquier command.
- El servidor valida por AuthN port y consulta membership/autorización PostgreSQL; sólo entonces vincula sesión y subscriptions autorizadas.
- La conexión no sobrevive silenciosamente a `exp`: el browser obtiene token nuevo vía BFF, reconecta y repite AuthN, membership y AuthZ sin autoridad cacheada como fuente de verdad.
- Errores AuthN/AuthZ/policy cierran con **1008** y no revelan existencia de `gameId`, `participantId` o `subscriptionId`.

## 6. Transporte y protocolo `malign.realtime.v1`

Node.js 24 LTS y `ws@8.21.3` operan detrás del port de transporte; browser usa WebSocket nativo; servidor usa `noServer`/HTTP upgrade. No se adopta Socket.IO porque su framing, reconnect y ACK competirían con el protocolo versionado MALIGN-AI.

### 6.1 Frames

| Dirección | Frames |
|---|---|
| Cliente → servidor | `AUTHENTICATE`, `SUBSCRIBE`, `ACK`, `RESYNC_REQUEST`, `UNSUBSCRIBE` |
| Servidor → cliente | `AUTHENTICATED`, `SYNC`, `EVENT_BATCH`, `GAP_DETECTED`, `RESYNC_REQUIRED`, `DRAINING`, `ERROR` |

Todo frame incluye cuando aplique `protocolVersion`, `schemaVersion`, `messageId`, `correlationId`, `gameId`, `subscriptionId`, cursor/rango y payload tipado validado fail-closed. Un frame desconocido, incompatible o con campos de autoridad del cliente se rechaza.

### 6.2 Cursor y garantías

Cursor: `game_version + sequence_number + projection/viewer binding`.

- delivery at-least-once; nunca exactly-once delivery;
- deduplicación por `eventId` y `sequenceNumber`;
- ACK del mayor cursor autorizado contiguo;
- omisiones privadas no generan falsos gaps ni revelan existencia/tipo;
- pérdida real produce `GAP_DETECTED` y recuperación por feed/snapshot autorizado;
- initial sync y catch-up pueden solaparse, pero la aplicación converge sin duplicar;
- reconnect puede aterrizar en cualquier instancia;
- commands autoritativos permanecen por HTTPS y no cruzan el socket.

## 7. Fan-out multinodo

PostgreSQL 18 `LISTEN/NOTIFY` es exclusivamente wake-up hint efímero. Outbox, event log, snapshots y feed PostgreSQL son la fuente durable y autoritativa. El payload de `NOTIFY` sólo contiene identificadores opacos mínimos (`gameId`, `outboxSequence` o `eventSequence`), nunca contenido secreto ni proyección.

Race obligatorio por nodo:

1. establecer `LISTEN`;
2. confirmar la transacción;
3. consultar snapshot/feed actual;
4. procesar notificaciones posteriores;
5. deduplicar el solapamiento.

Cada wake-up obliga a consultar feed/projection autorizado por viewer. Catch-up periódico, heartbeat o reconnect repara notificación perdida. No se incorpora Redis ni otro broker; cualquier broker futuro requiere evidencia y decisión nueva.

## 8. Hosting de referencia

- Render como target de referencia, sin contratación ni despliegue.
- Web services Node.js 24, WSS y mínimo dos instancias para etiqueta production; una sólo en local/staging.
- Nodos stateless, sin persistent disk; publisher/outbox como proceso separado.
- PostgreSQL major 18 en misma región y red privada; baseline certificado actual 18.6.
- Upgrade posterior 18.x: migrations, `db:verify`, gates M2-A/M2-2 y suite completa antes de promover.
- No usar web service ni base free-tier en producción.
- Plan, región, costos, cuenta, secrets y contratación se deciden en deployment gate separado.

## 9. Envelope operacional configurable

| Parámetro | Default técnico inicial |
|---|---|
| heartbeat | ping cada 30 s; terminar después de dos pong ausentes |
| inbound máximo | 64 KiB por mensaje; exceso cierra 1009 |
| backpressure | 256 mensajes o 1 MiB buffered, lo que ocurra primero |
| overload | cierre 1013 y reconnect/catch-up |
| reconnect | exponencial con full jitter desde 500 ms hasta 30 s |
| restart | cierre 1012 |
| AuthN/policy | cierre 1008 |

Shutdown: rechazar upgrades nuevos; emitir `DRAINING`; detener claims nuevos; completar o liberar claims activos; cerrar sockets dentro del grace period; clientes reconectan a cualquier nodo. Estos defaults no son límites inmutables y deben validarse con fault/load tests antes de deploy.

Métricas mínimas: conexiones activas/autenticadas; rechazos handshake/AuthN/AuthZ; token expirations; reconnects; gaps/recovery; outbox lag; notify lag/pérdidas; catch-up batches; buffered bytes/backpressure; cierres 1013; fallos de redacción/proyección; latencias p95/p99 sync/reconnect; uso/saturación pool PostgreSQL.

Logs/traces nunca incluyen tokens, cookies, secrets, manos privadas ni proyecciones completas no autorizadas.

## 10. Topología textual

```text
Browser ── Authorization Code + PKCE ──> Next.js/BFF ── server-side ──> Auth0
Browser <── HttpOnly/Secure session ──── Next.js/BFF <── callback/token ─ Auth0
Browser ── protected BFF endpoint ─────> short API access token (memory only)

Browser ── WSS / malign.realtime.v1 ──> Render LB ─┬─> Node realtime A
                                                   └─> Node realtime B

HTTPS command ─> application boundary ─> PostgreSQL transaction
                                           ├─ state/events/ledgers/trace
                                           └─ durable outbox (post-commit)

Outbox publisher ─> durable claim/feed ─> PostgreSQL
       └─ NOTIFY opaque wake-up ─────────┬─> realtime A
                                        └─> realtime B

Realtime node ─> AuthN port + membership ─> AuthorizedProjection/feed ─> viewer

socket on A drops ─> BFF token refresh ─> reconnect via LB ─> node B
   └─ repeat AuthN + membership + AuthZ ─> catch-up from durable cursor
```

## 11. Ocho owners normativos — Given/When/Then exactos

Fuente preservada sin modificación: `MALIGN_AI_GAME_ENGINE_TEST_ACCEPTANCE_M2_ADDENDUM_v0.1.md`.

| Caso | Given exacto | When exacto | Then exacto |
|---|---|---|---|
| `GE-M2-RT-001` | conexión presenta claims y game | handshake application-side | identity y membership verificadas construyen ActorContext; Engine no autentica |
| `GE-M2-RT-002` | events posteriores a C persistidos | reconnect en proceso/nodo nuevo | reanuda desde sequence autoritativa sin pérdida |
| `GE-M2-RT-003` | consumer tiene cursor C | entregar n+2,n+1,n+1 | consumer recupera/ordena y converge una vez |
| `GE-M2-RT-004` | viewer detecta gap | pedir feed + latest projection | converge a cursor/latest projection autorizados |
| `GE-M2-RT-005` | commit ocurre entre initial projection y subscribe | iniciar sync concurrente | cambio aparece exactamente una vez por buffered live o catch-up |
| `GE-M2-RT-006` | actor, rival y F1 reconectan | ejecutar recovery | actor/F1 recuperan request completo; rival sólo estado autorizado; no resume |
| `GE-M2-RT-007` | rival ve avance de cursor/rango | recuperar feed | distingue omission autorizada de packet loss sin revelar tipo/existencia privada |
| `GE-M2-RT-008` | commit y outbox ya existen | publisher falla parcialmente y reintenta | no rollback/readjudication; consumidores convergen por dedup |

## 12. Matriz requisito → caso → componente → evidencia futura

| Requisito | Caso owner | Componente futuro | Evidencia requerida |
|---|---|---|---|
| AuthN application-side y authority PostgreSQL | `GE-M2-RT-001` | BFF, AuthN port, connection binder | token válido/inválido, membership, claim mismatch, Engine sin SDK |
| reconnect/handoff durable y cursor viewer-bound | `GE-M2-RT-002` | reconnect coordinator, authorized feed | restart y asignación a nodo distinto sin pérdida/reuse foráneo |
| at-least-once, orden y dedup | `GE-M2-RT-003` | client reducer, cursor/ACK manager | n+2,n+1,n+1 converge una vez y ACK contiguo |
| gap real vs omisión privada | `GE-M2-RT-004` | gap detector, authorized recovery | rango explícito, unavailable fail-closed y cero leakage |
| carrera initial sync/subscribe | `GE-M2-RT-005` | sync barrier, buffered catch-up | commit intercalado aparece exactamente una vez |
| recovery de interacción pendiente | `GE-M2-RT-006` | projection/feed, continuation reader | matriz actor/rival/F1 read-only, sin auto-pass |
| authorized ranges y redacción | `GE-M2-RT-007` | AuthorizedProjection policy | omisión privada sin falso gap/inferencia entre P1/P2/F1 |
| socket independiente del gameplay commit | `GE-M2-RT-008` | outbox publisher, fan-out wake-up | crash/retry conserva commit, sequence, autorización y dedup |

## 13. Regresiones asignadas — 17

- `GE-CORE-003 [REGRESSION]`
- `GE-CORE-004 [REGRESSION]`
- `GE-CORE-010 [REGRESSION]`
- `GE-SEC-001 [REGRESSION]`
- `GE-SEC-002 [REGRESSION]`
- `GE-SEC-003 [REGRESSION]`
- `GE-SEC-004 [REGRESSION]`
- `GE-M1-RT-001 [REGRESSION]`
- `GE-M1-RT-002 [REGRESSION]`
- `GE-M1-RT-003 [REGRESSION]`
- `GE-M1-RT-004 [REGRESSION]`
- `GE-M1-RT-005 [REGRESSION]`
- `GE-M1-RT-006 [REGRESSION]`
- `GE-M1-RT-007 [REGRESSION]`
- `GE-M1-RT-008 [REGRESSION]`
- `GE-M1-RT-009 [REGRESSION]`
- `GE-M1-RT-010 [REGRESSION]`

Reconciliación histórica del gate previo: **8 owners + 17 regresiones = 25 ejecuciones dirigidas**. Baseline aprobada de entrada: **253/253** y mínimo planificado **261 casos únicos**. El cierre real mediante DEC-083 alcanza **302/302**. Requiere 0 skips, 0 todo y 0 waivers.

## 14. Fault tests materializados

- dos o más nodos y random instance assignment;
- commit entre initial sync y activación;
- NOTIFY perdido, duplicado o fuera de orden;
- publisher crash; caída de nodo; deploy/SIGTERM;
- token expirado y sesión invalidada;
- cross-game access y subscription hijacking;
- omisiones privadas sin falso gap; gap real y recovery;
- DB outage; slow consumer/backpressure;
- observer/handler failure;
- reconnect a nodo diferente;
- ausencia de leakage entre P1, P2 y F1;
- load tests de heartbeat, límites, backpressure, pool y latencias p95/p99.

## 15. Evidencia de implementación

DEC-082 fijó `ws@8.21.3`, `@types/ws@8.18.1`, `jose@6.2.10` y `@auth0/nextjs-auth0@4.28.0`. Tras M22-R09…R14, el gate ejecuta 75/75 casos dirigidos, preserva la baseline 253/253 y alcanza 302/302 casos en 34 archivos, con 0 skips, 0 todo y 0 waivers. Las pruebas complementarias usan JWT RS256/JWKS real local, HTTP/WSS real, dos procesos Node y PostgreSQL 18.6 reales, más fallos reproducibles sin Auth0 ni Render reales.

## 16. Corrección integral M22-R09…R14

- **M22-R09:** gate obligatorio sobre PostgreSQL 18.6 con dos procesos Node, pools y application boundaries independientes, TCP/WebSocket reales, issuer JWKS efímero, outbox real y LISTEN/NOTIFY real. Los casos demuestran reconnect cruzado, post-commit, pérdida, duplicado, desorden, carrera subscribe/catch-up/live y aislamiento.
- **M22-R10 / IQ-M2-016:** sólo Games/memberships preprovisionados. `CREATE_GAME` y `JOIN_GAME_MEMBERSHIP` están fuera del contrato productivo y fallan antes de resolver membership. Onboarding productivo queda diferido.
- **M22-R11:** `direct` exige socket TLS y material local; headers proxy no lo eluden. `trusted_proxy` exige peer expresamente configurado y evidencia HTTPS externa exacta. `disabled` sólo sirve test/desarrollo autorizado.
- **M22-R12:** logout BFF obtiene token server-side, invoca invalidación y sólo después elimina sesión local. La propagación usa digest SHA-256 opaco de issuer normalizado + subject; es distribuida, efímera, tolerante a duplicados y no constituye ledger durable. Expiración del token es backstop; backchannel logout durable queda fuera.
- **M22-R13:** application, outbox y listener requieren URLs explícitas y pools independientes. Cada principal LOGIN posee exactamente una membership de producto; admin/migrator/roles intercambiados fallan antes de aceptar tráfico. Membership consulta dentro de transacción con `SET LOCAL ROLE malign_app_runtime`.
- **M22-R14:** cada subscription posee cola serial, cursores monotónicos y checkpoints emitidos. ACK acepta cualquier checkpoint emitido/autorizado y ACK stale aplicado; rechaza futuro, inventado, extranjero o no emitido. Batches intermedios no contienen proyección; sólo el final contiene una proyección coherente. Resync acepta únicamente cursor inicial/emitido/acknowledged y revalida membership.

No se añadieron dependencias, migrations, tablas, roles, reglas o despliegue. M22-R01…R08 permanecen vigentes.

**Estado final:** `M2-2 IMPLEMENTED AND APPROVED / CLOSED mediante DEC-083`.

M2-3…M2-7 permanecen **NOT AUTHORIZED**; M2 global **NOT YET CLOSED**; M3 **NOT AUTHORIZED**.
