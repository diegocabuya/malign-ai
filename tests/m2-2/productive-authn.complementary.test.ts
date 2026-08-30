import { createServer, type Server } from 'node:http';
import { once } from 'node:events';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProductiveAuthnError, ProductiveSessionRegistry } from '../../packages/authz/src/index.js';
import { Auth0JwksAuthnAdapter } from '../../apps/server/src/productive-authn.js';

type GeneratedPrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
interface SigningKey { readonly kid: string; readonly privateKey: GeneratedPrivateKey; readonly publicJwk: Record<string, unknown> }

const makeKey = async (kid: string): Promise<SigningKey> => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  return { kid, privateKey: pair.privateKey, publicJwk: { ...(await exportJWK(pair.publicKey)), kid, alg: 'RS256', use: 'sig' } };
};

describe('M2-2 cryptographic Auth0/JWKS adapter', () => {
  let server: Server;
  let issuer = '';
  let activeKeys: readonly SigningKey[] = [];
  let primary: SigningKey;
  let rotated: SigningKey;

  beforeAll(async () => {
    primary = await makeKey('primary');
    rotated = await makeKey('rotated');
    activeKeys = [primary];
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ keys: activeKeys.map(({ publicJwk }) => publicJwk) }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('JWKS port unavailable');
    issuer = `http://127.0.0.1:${String(address.port)}/`;
  });

  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

  const adapter = (): Auth0JwksAuthnAdapter => new Auth0JwksAuthnAdapter({
    issuer, audience: 'malign-api', clientId: 'malign-web', requiredScopes: ['malign:connect'],
    jwksUri: issuer, clockToleranceSeconds: 0, jwksTimeoutMilliseconds: 1_000, jwksCooldownMilliseconds: 0,
  });

  const token = async (overrides: Readonly<Record<string, unknown>> = {}, key = primary): Promise<string> => {
    const now = Math.floor(Date.now() / 1_000);
    const claims = {
      sub: 'auth0|p1', iss: issuer, aud: 'malign-api', azp: 'malign-web', scope: 'malign:connect',
      iat: now, exp: now + 60, ...overrides,
    };
    return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: key.kid }).sign(key.privateKey);
  };

  it('accepts a real RS256 token and exposes verified identity only', async () => {
    const identity = await adapter().verifyAccessToken(await token());
    expect(identity).toEqual(expect.objectContaining({ subject: 'auth0|p1', clientBinding: 'malign-web' }));
    expect(identity).not.toHaveProperty('participantId');
    expect(identity).not.toHaveProperty('actorType');
  });

  it.each([
    ['expired', { exp: Math.floor(Date.now() / 1_000) - 10 }],
    ['future nbf', { nbf: Math.floor(Date.now() / 1_000) + 60 }],
    ['wrong issuer', { iss: 'https://wrong.invalid/' }],
    ['wrong audience', { aud: 'other-api' }],
    ['wrong azp', { azp: 'other-client' }],
    ['missing scope', { scope: 'openid' }],
    ['missing sub', { sub: undefined }],
  ])('fails closed for %s', async (_label, overrides) => {
    await expect(adapter().verifyAccessToken(await token(overrides))).rejects.toBeInstanceOf(ProductiveAuthnError);
  });

  it('rejects malformed, unsigned and unexpected-algorithm tokens', async () => {
    await expect(adapter().verifyAccessToken('malformed')).rejects.toMatchObject({ code: 'AUTHN_TOKEN_INVALID' });
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from('{}').toString('base64url')}.`;
    await expect(adapter().verifyAccessToken(unsigned)).rejects.toMatchObject({ code: 'AUTHN_TOKEN_INVALID' });
    const pair = await generateKeyPair('ES256');
    const unexpected = await new SignJWT({ sub: 'auth0|p1' }).setProtectedHeader({ alg: 'ES256' }).sign(pair.privateKey);
    await expect(adapter().verifyAccessToken(unexpected)).rejects.toMatchObject({ code: 'AUTHN_TOKEN_INVALID' });
  });

  it('rejects a valid-looking token signed by an untrusted key', async () => {
    const foreign = await makeKey('foreign');
    await expect(adapter().verifyAccessToken(await token({}, foreign))).rejects.toBeInstanceOf(ProductiveAuthnError);
  });

  it('refreshes JWKS on an unknown rotated kid and verifies the new real signature', async () => {
    const verifying = adapter();
    await expect(verifying.verifyAccessToken(await token())).resolves.toMatchObject({ subject: 'auth0|p1' });
    activeKeys = [rotated];
    await expect(verifying.verifyAccessToken(await token({}, rotated))).resolves.toMatchObject({ subject: 'auth0|p1' });
  });

  it('invalidates server sessions and isolates a faulty invalidation observer', async () => {
    const sessions = new ProductiveSessionRegistry();
    let observed = 0;
    sessions.onInvalidated(() => { throw new Error('observer fault'); });
    sessions.onInvalidated(() => { observed += 1; });
    const session = sessions.create(await adapter().verifyAccessToken(await token({}, rotated)));
    sessions.invalidateExternalSubject('auth0|p1');
    expect(observed).toBe(1);
    expect(() => sessions.resolve(session.sessionId)).toThrow(ProductiveAuthnError);
  });
});
