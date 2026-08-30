import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getConfiguredAuth0 } from './lib/auth0';

export const proxy = async (request: NextRequest): Promise<NextResponse> => {
  try {
    return await getConfiguredAuth0().middleware(request);
  } catch {
    return NextResponse.json(
      { error: { code: 'AUTHN_UNAVAILABLE' } },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
};

export const config = {
  matcher: ['/auth/:path*', '/api/:path*'],
};
