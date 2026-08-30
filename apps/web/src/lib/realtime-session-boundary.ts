/** Server-only seam used by logout/session revocation to invalidate associated realtime sockets. */
export interface RealtimeSessionInvalidationPort {
  invalidateCurrentSession(accessToken: string): Promise<void>;
}

export class HttpRealtimeSessionInvalidationAdapter implements RealtimeSessionInvalidationPort {
  constructor(private readonly authoritativeServerUrl: string) {}

  async invalidateCurrentSession(accessToken: string): Promise<void> {
    const response = await fetch(new URL('/v1/session/invalidate', this.authoritativeServerUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (response.status !== 204) throw new Error('REALTIME_SESSION_INVALIDATION_FAILED');
  }
}

export interface ServerSideLogoutDependencies {
  readonly getAccessToken: () => Promise<string>;
  readonly invalidateRealtime: RealtimeSessionInvalidationPort;
  readonly completeLocalLogout: () => Promise<void>;
}

/** Server-only ordering boundary: distributed realtime invalidation completes before local BFF logout. */
export const completeServerSideLogout = async (dependencies: ServerSideLogoutDependencies): Promise<void> => {
  const accessToken = await dependencies.getAccessToken();
  await dependencies.invalidateRealtime.invalidateCurrentSession(accessToken);
  await dependencies.completeLocalLogout();
};
