# MALIGN-AI — M2-2 Productive Transport Runbook v0.1

**Estado:** CORRECTION IMPLEMENTED / PENDING REVIEW mediante DEC-082 y M22-R09…R14
**Baseline:** `1569b0b634d63be0c7aee011b44353fd6df317ca`
**PostgreSQL:** 18.6; migrations 001…006; 87/87 tablas

## Componentes y dependencias

- `ProductiveAuthnPort` expone identidad externa verificada, nunca autoridad de juego.
- `Auth0JwksAuthnAdapter` usa `jose@6.2.10` con issuer/audience/RS256/exp/nbf/azp/scopes, cache y timeout fail-closed.
- `PostgresMembershipAuthorityAdapter` deriva `ActorContext` exclusivamente de PostgreSQL.
- Next.js BFF usa `@auth0/nextjs-auth0@4.28.0`: Authorization Code + PKCE, sesión server-side, cookie HttpOnly/Secure/SameSite, access-token endpoint y refresh server-side si se configura.
- `ProductiveRealtimeServer` usa `ws@8.21.3` y tipos `@types/ws@8.18.1`; `perMessageDeflate=false`, `maxPayload=65536` y subprotocolo exacto `malign.realtime.v1`.
- `PostgresRealtimeWakeupListener` mantiene una conexión LISTEN dedicada y catch-up periódico; `RealtimeOutboxPump` conserva claim/send/ack durable separado del ACK de browser.

No se instalaron Socket.IO, framework HTTP, ORM, Redis/broker, addon opcional de `ws`, SDK Render ni paquete de IA.

## Configuración

`.env.example` contiene únicamente nombres y placeholders. Los valores productivos deben entrar por secret manager externo y nunca por Git.

| Variable | Función |
|---|---|
| `MALIGN_APP_DATABASE_URL` | pool application runtime |
| `MALIGN_OUTBOX_DATABASE_URL` | pool outbox publisher |
| `MALIGN_LISTENER_DATABASE_URL` | conexión LISTEN dedicada |
| `MALIGN_ALLOWED_ORIGINS` | allowlist exacta, separada por comas |
| `MALIGN_NODE_ID` | identidad estructurada del nodo |
| `MALIGN_TLS_MODE` | `direct`, `trusted_proxy` o `disabled` sólo para test/desarrollo |
| `MALIGN_TRUSTED_PROXY_ADDRESSES` | peers exactos autorizados para terminación TLS en edge |
| `MALIGN_REALTIME_FEED_BATCH_SIZE` | default 100 |
| `MALIGN_REALTIME_CATCHUP_MS` | default 5000 ms |
| `MALIGN_OUTBOX_POLL_MS` | default 100 ms |
| `MALIGN_SHUTDOWN_GRACE_MS` | default 10000 ms |
| `MALIGN_TLS_KEY_PATH`, `MALIGN_TLS_CERT_PATH` | TLS local/directo; obligatorios en `NODE_ENV=production` |
| `AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE`, `AUTH0_CLIENT_ID` | binding JWT exacto |
| `AUTH0_REQUIRED_SCOPES` | default `malign:connect` |
| `AUTH0_JWKS_TIMEOUT_MS` | default 3000 ms |
| `AUTH0_CLOCK_TOLERANCE_SECONDS` | default 2; máximo 5 |

AuthN se construye de forma lazy en el BFF para que `pnpm build` no haga discovery. Un request productivo sin configuración falla cerrado. El access token aparece sólo en el header HTTPS o primer frame WSS, nunca en URL, log, métrica o error.

El transporte requiere Games y memberships previamente provisionados. `CREATE_GAME` y `JOIN_GAME_MEMBERSHIP` no están disponibles productivamente; onboarding queda diferido. No existe fallback desde las tres URLs PostgreSQL explícitas hacia `DATABASE_URL`, `MALIGN_TEST_DATABASE_URL` o credenciales administrativas.

En `direct`, clave/certificado local y socket TLS son obligatorios. En `trusted_proxy`, el socket debe provenir de un peer allowlisted y declarar exactamente HTTPS externo; headers de un origen no confiable no tienen autoridad. `disabled` falla cerrado en producción.

## Flujo operativo

1. BFF completa PKCE y conserva sesión/refresh token server-side.
2. Browser obtiene access token corto desde el endpoint protegido y abre WSS.
3. Upgrade valida TLS, Origin y subprotocolo; el primer frame `AUTHENTICATE` llega en 5 s.
4. `sub` verificado se vincula contra membership PostgreSQL; claims de game/participant/role/permisos se ignoran.
5. `SUBSCRIBE` registra inactivo, emite `SYNC`, activa y drena feed autorizado.
6. Commands viajan sólo por HTTP/HTTPS y atraviesan `GameSessionApplicationPort`.
7. Commit PostgreSQL crea outbox; publisher confirma delivery y emite `NOTIFY` opaco post-commit.
8. Cada nodo relee feed/proyección durable. Browser aplica at-least-once, deduplica y ACK sólo el cursor emitido contiguo.
9. Gap explícito produce `GAP_DETECTED` seguido por feed/proyección autorizados. Reconnect revalida token, sesión y membership en cualquier nodo.
10. Logout BFF invoca invalidación server-side antes de borrar la sesión local. PostgreSQL propaga sólo un digest SHA-256 opaco; la revocación es distribuida pero efímera, con expiración del token como backstop.

## Límites y seguridad

- 30 s por ping; cierre tras dos pong ausentes.
- 64 KiB inbound; 256 mensajes pendientes o 1 MiB buffered.
- 1008 AuthN/AuthZ/policy, 1009 tamaño, 1012 restart, 1013 overload.
- Máximo configurable de 4 conexiones por identidad, 8 subscriptions por conexión y 30 handshakes/minuto/dirección.
- Errores externos opacos no distinguen game, participant, membership o subscription inexistente/ajeno.
- Logout/session revocation invalida por session id o `sub` y cierra sockets vinculados.
- Domain, Rules y Game Engine no importan Auth0, JWT/JWKS, HTTP, WebSocket, `ws` ni PostgreSQL transport.

## Observabilidad

Ports in-process registran conexiones, autenticaciones, rechazos, expiraciones, subscriptions, reconnect, gaps/recovery, catch-up, buffers, códigos de cierre, latencias sync, publisher y LISTEN reconnect/lag. Logs JSON contienen sólo correlation id, tipo, result code, duración y node id. No contienen token, cookie, secret, payload de proyección, mano, options ni stack entregado al cliente.

## Shutdown

SIGTERM/SIGINT marca draining y rechaza upgrades; detiene nuevos claims; espera el claim activo; ejecuta UNLISTEN; emite `DRAINING`; espera tails; cierra 1012 dentro del grace period; termina sockets remanentes; cierra HTTP y pools. El cliente reconecta a otro nodo y recupera desde cursor durable.

## Fault matrix y gates

Las pruebas cubren JWT real/rotation y claims inválidos; HTTP/WSS real; nodos distintos; carrera SYNC; pérdida/duplicado/desorden de NOTIFY; listener reconnect; publisher crash antes/después de send; socket antes de ACK; session expiry/revocation; cross-game/hijack/cursor foráneo; malformed/extra/oversized; Origin/protocolo; slow consumer/backpressure; observer isolation; DB unavailable; privacy P1/P2/F1 y logs sin token.

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:verify
pnpm test:m2a
pnpm test:m2-2
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm audit --prod
```

Estado verificado tras M22-R09…R14: 8/8 owner, 17/17 regresiones asignadas, 50/50 complementarias/regresiones ejecutables del gate M2-2 y gate dirigido 75/75; suite 302/302 en 34 archivos; 0 skips, 0 todo y 0 waivers. M2-2 no está aprobado/cerrado. M2-3…M2-7 no están autorizados.
