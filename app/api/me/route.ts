// GET /api/me — the signed-in caller's access status for the client to gate UI.
// { signedIn, email, approved, admin }. Never requires anything; anonymous → signedIn:false.

import { NextResponse, type NextRequest } from 'next/server';
import { verifyClaims } from '@server/auth';
import { isApproved } from '@server/allowlist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const claims = await verifyClaims(req);
    if (!claims) {
      return NextResponse.json({ signedIn: false, approved: false, admin: false });
    }
    const approved = claims.admin || (await isApproved(claims.email));
    return NextResponse.json({
      signedIn: true,
      email: claims.email,
      approved,
      admin: claims.admin,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
