import { NextResponse } from 'next/server';
import { DateTime } from 'luxon';
import * as chrono from 'chrono-node';

type BookPayload = {
  intent: 'BOOK_MEETING';
  email: string;            // invitee email
  duration: 15 | 30;        // minutes
  datetimeText: string;     // e.g., "tomorrow at 9am"
  timezone?: string;        // IANA TZ, default America/Los_Angeles
  confirm?: boolean;        // if true, book immediately
};

type Slot = { start_time: string; scheduling_url?: string | null };

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<BookPayload>;
    if (body.intent !== 'BOOK_MEETING') {
      return NextResponse.json({ error: 'Unsupported intent' }, { status: 400 });
    }

    const email = body.email?.trim();
    const duration = Number(body.duration ?? 15) as 15 | 30;
    const datetimeText = body.datetimeText?.trim();
    const tz = body.timezone || 'America/Los_Angeles';
    const confirm = body.confirm !== false; // default true

    if (!email || !datetimeText || !duration) {
      return NextResponse.json({ error: 'email, duration, datetimeText are required' }, { status: 400 });
    }

    // 1) Parse requested time ("tomorrow 9am", etc.)
    const parsed = chrono.parseDate(datetimeText, new Date(), { forwardDate: true });
    if (!parsed) {
      return NextResponse.json({ error: `Could not parse datetimeText: "${datetimeText}"` }, { status: 400 });
    }
    // Interpret in user's TZ, then to UTC to compare with Calendly slots (which are Z times)
    const targetLocal = DateTime.fromJSDate(parsed, { zone: tz });
    const targetUtc = targetLocal.toUTC();

    // 2) Pull availability for this duration
    const origin = new URL(req.url).origin;
    const availRes = await fetch(
      `${origin}/api/calendly/availability?duration=${duration}&timezone=${encodeURIComponent(tz)}`,
      { cache: 'no-store' }
    );
    if (!availRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch availability' }, { status: 502 });
    }
    const avail = await availRes.json();
    const slots: Slot[] = Array.isArray(avail?.slots) ? avail.slots : [];
    if (!slots.length) {
      return NextResponse.json({ error: 'No availability returned' }, { status: 409 });
    }

    // 3) Choose the slot: exact match, else first at/after requested time
    const targetMs = targetUtc.toJSDate().getTime();
    const exact = slots.find((s) => new Date(s.start_time).getTime() === targetMs);
    const chosen =
      exact ||
      slots.find((s) => new Date(s.start_time).getTime() >= targetMs) ||
      null;

    if (!chosen) {
      const suggestions = slots.slice(0, 3).map((s) => s.start_time);
      return NextResponse.json({ error: 'Requested time not available', suggestions }, { status: 409 });
    }

    if (!confirm) {
      return NextResponse.json({ proposed_start_time: chosen.start_time });
    }

    // 4) Book via our existing Google Calendar API route
    const bookRes = await fetch(`${origin}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        start_time: chosen.start_time,
        duration,
        title: 'Meeting with Sagar',
        notes: `Booked via Tavus assistant (request: "${datetimeText}" in ${tz})`,
      }),
    });

    const data = await bookRes.json();
    if (!bookRes.ok || !data?.ok) {
      // If the slot was sniped, try the next one (optional retry)
      if (data?.error?.toString?.().includes('no longer available')) {
        const idx = slots.findIndex((s) => s.start_time === chosen.start_time);
        const next = slots[idx + 1];
        if (next) {
          const retry = await fetch(`${origin}/api/book`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              start_time: next.start_time,
              duration,
              title: 'Meeting with Sagar',
              notes: `Auto-picked next slot after conflict. Original: "${datetimeText}" in ${tz}`,
            }),
          });
          const retryData = await retry.json();
          if (retry.ok && retryData?.ok) {
            return NextResponse.json({
              ok: true,
              booked_start_time: next.start_time,
              htmlLink: retryData.htmlLink,
              hangoutLink: retryData.hangoutLink,
            });
          }
        }
      }
      return NextResponse.json({ error: data?.error || 'Booking failed' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      booked_start_time: chosen.start_time,
      htmlLink: data.htmlLink,
      hangoutLink: data.hangoutLink,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
