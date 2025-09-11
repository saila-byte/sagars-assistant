import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; // don't statically cache this route

const isoZ = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '.000000Z');

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const duration = 30; // Only 30-minute meetings
  const timezone = searchParams.get('timezone') || 'America/Los_Angeles';

  const eventType = process.env.CALENDLY_EVENT_TYPE_30_URI; // Only 30-minute event type

  if (!process.env.CALENDLY_TOKEN || !eventType) {
    return NextResponse.json(
      { error: 'Missing CALENDLY_TOKEN or event type URI env vars' },
      { status: 500 }
    );
  }

  // Calendly requires future window <= 7 days, but let's try to get more slots
  const now = new Date();
  const start = new Date(now.getTime() + 60_000); // +1 minute to avoid "past" edge cases
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Full 7 days

  const url = new URL('https://api.calendly.com/event_type_available_times');
  url.searchParams.set('event_type', eventType);
  url.searchParams.set('start_time', isoZ(start));
  url.searchParams.set('end_time', isoZ(end));
  url.searchParams.set('timezone', timezone);

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.CALENDLY_TOKEN}` },
    cache: 'no-store',
  });

  if (!r.ok) {
    const text = await r.text();
    return NextResponse.json({ error: text }, { status: r.status });
  }

  const data = await r.json();
  
  const slots = (data?.collection || []).map((s: any) => ({
    start_time: s.start_time,
    end_time: s.end_time,
    scheduling_url: s.scheduling_url || null,
  }));

  return NextResponse.json({ slots, duration, timezone });
}
