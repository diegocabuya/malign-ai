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
