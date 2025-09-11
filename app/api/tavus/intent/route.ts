import { NextResponse } from 'next/server';
import { DateTime } from 'luxon';
import * as chrono from 'chrono-node';

type BookPayload = {
  intent: 'BOOK_MEETING';
  email: string;            // invitee email
  duration: 30;             // minutes (only 30-minute meetings)
  datetimeText: string;     // e.g., "tomorrow at 9am"
  timezone?: string;        // IANA TZ, default America/Los_Angeles
  confirm?: boolean;        // if true, book immediately
};

type Slot = { start_time: string; scheduling_url?: string | null };

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    console.log('[intent] === BOOKING REQUEST START ===');
    
    const body = (await req.json()) as Partial<BookPayload>;
    console.log('[intent] Request body:', body);
    
    if (body.intent !== 'BOOK_MEETING') {
      return NextResponse.json({ error: 'Unsupported intent' }, { status: 400 });
    }

    const email = body.email?.trim();
    const duration = 30; // Only 30-minute meetings
    const datetimeText = body.datetimeText?.trim();
    const tz = body.timezone || 'America/Los_Angeles';
    const confirm = body.confirm !== false; // default true

    console.log('[intent] Parsed parameters:', { email, duration, datetimeText, tz, confirm });

    if (!email || !datetimeText || !duration) {
      console.error('[intent] Missing required parameters:', { email, datetimeText, duration });
      return NextResponse.json({ error: 'email, duration, datetimeText are required' }, { status: 400 });
    }

    // 1) Parse requested time ("tomorrow 9am", etc.)
    console.log('[intent] Parsing datetimeText:', datetimeText);
    const parsed = chrono.parseDate(datetimeText, new Date(), { forwardDate: true });
    if (!parsed) {
      console.error('[intent] Failed to parse datetimeText:', datetimeText);
      return NextResponse.json({ error: `Could not parse datetimeText: "${datetimeText}"` }, { status: 400 });
    }
    // Interpret in user's TZ, then to UTC to compare with Calendly slots (which are Z times)
    const targetLocal = DateTime.fromJSDate(parsed, { zone: tz });
    const targetUtc = targetLocal.toUTC();
    console.log('[intent] Parsed time:', { 
      parsed: parsed.toISOString(), 
      targetLocal: targetLocal.toISO(), 
      targetUtc: targetUtc.toISO() 
    });

    // 2) Pull availability for this duration
    const host = req.headers.get('host') || 'localhost:3000';
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const origin = `${protocol}://${host}`;
    const availabilityUrl = `${origin}/api/calendly/availability?duration=${duration}&timezone=${encodeURIComponent(tz)}`;
    console.log('[intent] Fetching availability from:', availabilityUrl);
    
    const availRes = await fetch(availabilityUrl, { cache: 'no-store' });
    console.log('[intent] Availability response status:', availRes.status);
    
    if (!availRes.ok) {
      console.error('[intent] Failed to fetch availability:', availRes.status, await availRes.text());
      return NextResponse.json({ error: 'Failed to fetch availability' }, { status: 502 });
    }
    const avail = await availRes.json();
    
    const slots: Slot[] = Array.isArray(avail?.slots) ? avail.slots : [];
    console.log('[intent] Available slots count:', slots.length);
    
    if (!slots.length) {
      console.error('[intent] No availability returned');
      return NextResponse.json({ error: 'No availability returned' }, { status: 409 });
    }

    // 3) Choose the slot: exact match, else first at/after requested time
    const targetMs = targetUtc.toJSDate().getTime();
    console.log('[intent] Target time in ms:', targetMs);
    
    const exact = slots.find((s) => new Date(s.start_time).getTime() === targetMs);
    const chosen =
      exact ||
      slots.find((s) => new Date(s.start_time).getTime() >= targetMs) ||
      null;

    console.log('[intent] Slot selection:', { 
      exact: !!exact, 
      chosen: chosen ? { start_time: chosen.start_time, scheduling_url: chosen.scheduling_url } : null 
    });

    if (!chosen) {
      const suggestions = slots.slice(0, 3).map((s) => s.start_time);
      console.error('[intent] No suitable slot found. Suggestions:', suggestions);
      return NextResponse.json({ error: 'Requested time not available', suggestions }, { status: 409 });
    }

    if (!confirm) {
      console.log('[intent] Not confirming, returning proposed time:', chosen.start_time);
      return NextResponse.json({ proposed_start_time: chosen.start_time });
    }

    // 4) Book via our existing Google Calendar API route
    const bookingPayload = {
      email,
      start_time: chosen.start_time,
      duration,
      title: 'Meeting with Hassaan',
      notes: `Booked via Tavus assistant (request: "${datetimeText}" in ${tz})`,
    };
    
    console.log('[intent] Booking payload:', bookingPayload);
    console.log('[intent] Calling /api/book...');
    
    const bookRes = await fetch(`${origin}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingPayload),
    });

    console.log('[intent] Book API response status:', bookRes.status);
    const data = await bookRes.json();
    console.log('[intent] Book API response data:', data);
    
    if (!bookRes.ok || !data?.ok) {
      console.error('[intent] Booking failed:', { status: bookRes.status, error: data?.error });
      
      // If the slot was sniped, try the next one (optional retry)
      if (data?.error?.toString?.().includes('no longer available')) {
        console.log('[intent] Slot was sniped, trying next available slot...');
        const idx = slots.findIndex((s) => s.start_time === chosen.start_time);
        const next = slots[idx + 1];
        if (next) {
          console.log('[intent] Retrying with next slot:', next.start_time);
          const retry = await fetch(`${origin}/api/book`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              start_time: next.start_time,
              duration,
              title: 'Meeting with Hassaan',
              notes: `Auto-picked next slot after conflict. Original: "${datetimeText}" in ${tz}`,
            }),
          });
          const retryData = await retry.json();
          console.log('[intent] Retry response:', { status: retry.status, data: retryData });
          
          if (retry.ok && retryData?.ok) {
            console.log('[intent] Retry successful!');
            return NextResponse.json({
              ok: true,
              booked_start_time: next.start_time,
            });
          }
        }
      }
      return NextResponse.json({ error: data?.error || 'Booking failed' }, { status: 500 });
    }

    console.log('[intent] Booking successful!');
    return NextResponse.json({
      ok: true,
      booked_start_time: chosen.start_time,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
