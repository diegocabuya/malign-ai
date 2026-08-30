import { Auth0Client } from '@auth0/nextjs-auth0/server';

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') throw new Error('AUTHN_CONFIGURATION_MISSING');
  return value;
};

let configuredClient: Auth0Client | undefined;

/** Lazy construction prevents discovery or provider calls during build and fails closed at request time. */
export const getConfiguredAuth0 = (): Auth0Client => {
  if (configuredClient !== undefined) return configuredClient;
  configuredClient = new Auth0Client({
    domain: required('AUTH0_DOMAIN'),
    clientId: required('AUTH0_CLIENT_ID'),
    clientSecret: required('AUTH0_CLIENT_SECRET'),
    secret: required('AUTH0_SECRET'),
    appBaseUrl: required('APP_BASE_URL'),
    authorizationParameters: {
      audience: required('AUTH0_AUDIENCE'),
      scope: process.env.AUTH0_REQUIRED_SCOPES ?? 'openid profile email offline_access malign:connect',
    },
    session: {
      rolling: true,
      absoluteDuration: 86_400,
      inactivityDuration: 3_600,
      // The SDK always emits the session cookie HttpOnly; these options harden transport and CSRF behavior.
      cookie: { secure: true, sameSite: 'lax', path: '/' },
    },
    transactionCookie: { sameSite: 'lax', secure: true },
    enableAccessTokenEndpoint: true,
    tokenRefreshBuffer: 30,
    httpTimeout: 5_000,
    enableTelemetry: false,
  });
  return configuredClient;
};
