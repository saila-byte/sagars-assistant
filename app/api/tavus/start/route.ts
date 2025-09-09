// app/api/tavus/start/route.ts
import { NextResponse } from 'next/server';

type StartBody = {
  email?: string;       // kept for later use if you want to pass context
  duration?: number;    // kept for later use
  timezone?: string;    // kept for later use
};

export async function POST(req: Request) {
  try {
    // read body (not required for the minimal call)
    const body = (await req.json().catch(() => ({}))) as StartBody;
    const _email = (body?.email ?? '').toString().trim();
    const _duration = Number.isFinite(Number(body?.duration)) ? Number(body!.duration) : 15;
    const _timezone =
      typeof body?.timezone === 'string' && body.timezone ? body.timezone : 'America/Los_Angeles';

    // --- Env & URL setup ---
    const RAW_BASE = (process.env.TAVUS_API_BASE || 'https://tavusapi.com/v2').trim();
    const TAVUS_API_BASE = RAW_BASE.replace(/\/+$/, ''); // strip trailing slash
    const conversationsURL = `${TAVUS_API_BASE}/conversations`;

    const apiKey    = (process.env.TAVUS_API_KEY || '').trim();
    const personaId = (process.env.TAVUS_PERSONA_ID || '').trim();
    const replicaId = (process.env.TAVUS_REPLICA_ID || '').trim(); // required per your curl

    // quick visibility (safe) — remove once stable
    console.log('[tavus.start] env check', {
      base: TAVUS_API_BASE,
      hasKey: !!apiKey,
      hasPersona: !!personaId,
      hasReplica: !!replicaId,
      replicaPrefix: replicaId.slice(0, 6),
    });

    // Require all 3
    if (!apiKey || !personaId || !replicaId) {
      return NextResponse.json(
        { error: 'Set TAVUS_API_KEY, TAVUS_PERSONA_ID, TAVUS_REPLICA_ID in .env.local' },
        { status: 500 }
      );
    }

    // --- Minimal payload to isolate auth/IDs (matches your working curl shape) ---
    const payload = {
      persona_id: personaId,
      replica_id: replicaId,
      // can pass this context too at some point :
      // metadata: { email: _email, duration: _duration, timezone: _timezone },
      // variables: { session_email: _email, session_duration: _duration, session_timezone: _timezone },
      // callback_url: `${origin}/api/tavus/events`, // if you add a listener
    };

    console.log('[tavus.start] POST', conversationsURL);
    const r = await fetch(conversationsURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // ✅ Tavus uses x-api-key, not Authorization
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text().catch(() => '');
    if (!r.ok) {
      console.error('[tavus.start] Tavus error', r.status, safeTrim(text));
      return NextResponse.json(
        { error: 'Tavus conversation create failed', status: r.status, detail: safeTrim(text) },
        { status: 502 }
      );
    }

    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      // ignore
    }

    const conversationUrl: string | undefined =
      data?.conversation_url || data?.conversationUrl;

    if (!conversationUrl) {
      console.error('[tavus.start] Missing conversation_url in response', data);
      return NextResponse.json(
        { error: 'No conversation_url returned from Tavus', raw: data },
        { status: 502 }
      );
    }

    console.log('[tavus.start] OK conversation_url present');
    return NextResponse.json({ conversationUrl }, { status: 200 });
  } catch (err: any) {
    console.error('[tavus.start] unexpected', err);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}

function safeTrim(s: string) {
  return s.length > 800 ? s.slice(0, 800) + '…' : s;
}
