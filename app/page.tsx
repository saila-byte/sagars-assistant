'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Conversation } from './components/cvi/components/conversation';

// ---------- helpers ----------
// Removed useMeetingDuration - only 30-minute meetings

const emailRegex = /[^@\s]+@[^@\s]+\.[^@\s]+/;

type Slot = { start_time: string; scheduling_url: string | null };

type ToolCallMsg = {
  type?: string;
  event_type?: string;
  message_type?: string;
  tool_call_id?: string;
  tool?: { name?: string; arguments?: string | Record<string, any> };
  name?: string;
  arguments?: unknown;
};

type ToolResult =
  | { ok: true; start_time?: string; htmlLink?: string; hangoutLink?: string }
  | { ok: false; error: string };

function sendToolResultToTavus(conversationUrl: string | null, tool_call_id: string | undefined, result: ToolResult) {
  if (!conversationUrl || !tool_call_id) {
    console.warn('[tool_result] Missing conversationUrl or tool_call_id; skipping postMessage', { conversationUrl, tool_call_id, result });
    return;
  }
  try {
    const targetOrigin = new URL(conversationUrl).origin;
    const iframes = Array.from(document.getElementsByTagName('iframe'));
    const target = iframes.find((f) => {
      try {
        const src = f.getAttribute('src') || '';
        return src.startsWith(targetOrigin);
      } catch {
        return false;
      }
    });
    console.log('[tool_result] Posting result back to Tavus iframe', { targetOrigin, tool_call_id, result });
    target?.contentWindow?.postMessage(
      { type: 'conversation.tool_result', tool_call_id, result },
      targetOrigin
    );
  } catch (e) {
    console.error('[tool_result] Failed to postMessage result back to Tavus', e);
  }
}

function safeStringify(v: any) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
// --------------------------------

export default function Page() {
  const duration = 30; // Only 30-minute meetings

  const [step, setStep] = useState<'landing' | 'haircheck' | 'call' | 'confirm'>('landing');
  const [email, setEmail] = useState('saila@tavus.io');
  const [errors, setErrors] = useState<string | null>(null);
  const [remembered, setRemembered] = useState<string | null>(null);
  const [conversationUrl, setConversationUrl] = useState<string | null>(null);

  // Availability UI (optional manual booking)
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ start_time: string } | null>(null);
  const [booking, setBooking] = useState(false);

  // Haircheck state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [avReady, setAvReady] = useState(false);

  // Tool-call / debug state
  const [toolError, setToolError] = useState<string | null>(null);
  const [bookingInfo, setBookingInfo] = useState<{ htmlLink?: string; hangoutLink?: string } | null>(null);
  const inFlightToolCalls = useRef<Set<string>>(new Set());

  // Debug panel state
  const [debugOpen, setDebugOpen] = useState(false);
  const [logs, setLogs] = useState<{ ts: number; origin: string; kind: 'message' | 'info' | 'error'; note?: string; data?: any }[]>([]);
  const [filterToolCalls, setFilterToolCalls] = useState(true);

  const pushLog = useCallback((entry: { ts: number; origin: string; kind: 'message' | 'info' | 'error'; note?: string; data?: any }) => {
    setLogs((prev) => {
      const next = [entry, ...prev];
      if (next.length > 50) next.length = 50;
      return next;
    });
  }, []);
  const clearLogs = useCallback(() => setLogs([]), []);
  const copyLogs = useCallback(async () => {
    const text = logs.map((l) => {
      const time = new Date(l.ts).toLocaleTimeString();
      return `[${time}] (${l.kind}) ${l.note || ''}\norigin: ${l.origin}\n${safeStringify(l.data)}\n`;
    }).join('\n---\n');
    try {
      await navigator.clipboard.writeText(text || '(no logs)');
      console.log('[debug] Logs copied to clipboard');
    } catch (e) {
      console.warn('[debug] Failed to copy logs', e);
    }
  }, [logs]);

  useEffect(() => {
    const last = localStorage.getItem('booking_last_email');
    if (last) setRemembered(last);
  }, []);

  function handleStart() {
    setErrors(null);
    if (!emailRegex.test(email)) {
      setErrors('Please enter a valid email.');
      return;
    }
    localStorage.setItem('booking_last_email', email);
    console.log('[ui] Email accepted, moving to Haircheck', { email });
    setStep('haircheck');
  }

  async function requestAV() {
    setErrors(null);
    try {
      console.log('[haircheck] Requesting camera/mic');
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setMediaStream(stream);
      if (videoRef.current) {
        // @ts-ignore
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        setMicLevel(rms);
        if (mediaStream) requestAnimationFrame(tick);
      };
      tick();

      setAvReady(true);
      console.log('[haircheck] AV granted');
    } catch (e) {
      console.error('[haircheck] Failed to get camera/mic', e);
      setErrors("We couldn't access your camera/mic. Check permissions and try again.");
    }
  }

  function leaveAV() {
    console.log('[haircheck] Turning off AV');
    mediaStream?.getTracks().forEach((t) => t.stop());
    setMediaStream(null);
    setAvReady(false);
  }

  async function goToCall() {
    if (!avReady) {
      setErrors('Please allow camera & mic to continue.');
      return;
    }
    try {
      const res = await fetch('/api/tavus/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const payload = await res.json();
      const { conversationUrl } = payload;
      if (!conversationUrl) throw new Error('No conversationUrl returned');
      setConversationUrl(conversationUrl);
      setStep('call');
      pushLog({ ts: Date.now(), origin: 'local', kind: 'info', note: 'Conversation URL set', data: { conversationUrl } });
    } catch (e) {
      console.error('[call] Failed to start conversation', e);
      setErrors('Could not start the assistant. Please try again.');
      pushLog({ ts: Date.now(), origin: 'local', kind: 'error', note: 'Failed to start conversation', data: String(e) });
    }
  }

  // -------- Availability (fetch on "call" step) --------
  useEffect(() => {
    if (step !== 'call') return;
    let cancelled = false;
    (async () => {
      setLoadingSlots(true);
      setErrors(null);
      setSelectedSlot(null);
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
        console.log('[availability] Fetching slots', { duration, tz });
        const res = await fetch(
          `/api/calendly/availability?duration=${duration}&timezone=${encodeURIComponent(tz)}`,
          { cache: 'no-store' }
        );
        const data = await res.json();
        console.log('[availability] Response', data);
        if (!cancelled) setSlots(Array.isArray(data.slots) ? data.slots : []);
        pushLog({ ts: Date.now(), origin: 'local', kind: 'info', note: 'Loaded availability', data });
      } catch (e) {
        console.error('[availability] Load failed', e);
        if (!cancelled) setErrors('Could not load availability from Calendly.');
        pushLog({ ts: Date.now(), origin: 'local', kind: 'error', note: 'Availability load failed', data: String(e) });
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    })();
    return () => { cancelled = true; };
  }, [step, duration, pushLog]);

  // -------- Manual confirm button (fallback) --------
  async function confirmAndBook(args?: {
    email?: string;
    start_time?: string; // ISO
    duration?: number;
    title?: string;
    notes?: string;
  }) {
    const start_time = args?.start_time ?? selectedSlot?.start_time;
    if (!start_time) {
      console.warn('[book] No start_time provided/selected');
      return;
    }

    const body = {
      email: (args?.email || email).trim(),
      start_time,
      duration: args?.duration ?? duration,
      title: args?.title || 'Intro with Sagar',
      notes: args?.notes || 'Booked via Tavus assistant',
    };

    try {
      setErrors(null);
      setBooking(true);
      console.log('[book] POST /api/book →', body);
      const r = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      console.log('[book] /api/book result', { status: r.status, data });
      pushLog({ ts: Date.now(), origin: 'local', kind: r.ok && data?.ok ? 'info' : 'error', note: 'POST /api/book result', data });
      if (!r.ok || !data?.ok) throw new Error(data?.error || 'Booking failed');
      setBookingInfo({ htmlLink: data.htmlLink, hangoutLink: data.hangoutLink });
      setStep('confirm');
    } catch (e: any) {
      const msg = e?.message || 'Could not book this time.';
      console.error('[book] Booking error', msg);
      setErrors(msg);
      pushLog({ ts: Date.now(), origin: 'local', kind: 'error', note: 'Booking error', data: msg });
    } finally {
      setBooking(false);
    }
  }

  // -------- Tool-call handler (VOICE-ONLY BOOKING) --------
  const handleToolCall = useCallback(
    async (msg: ToolCallMsg) => {
      try {
        console.log('🔧 [TOOL_CALL] ===== RECEIVED TOOL CALL =====');
        console.log('[tool_call] Full message:', JSON.stringify(msg, null, 2));
        console.log('[tool_call] Message type:', typeof msg);
        console.log('[tool_call] Is array:', Array.isArray(msg));
        console.log('[tool_call] Has tool property:', 'tool' in msg);
        console.log('[tool_call] Has name property:', 'name' in msg);
        console.log('[tool_call] Message keys:', Object.keys(msg));
        
        // Handle different message formats
        let name: string | undefined;
        let args: any;
        let toolCallId: string | undefined;
        
        if (Array.isArray(msg) && msg.length > 0) {
          console.log('[tool_call] Processing array format, length:', msg.length);
          // Format from system prompt: [{ "name": "update_calendar", "parameters": {...} }]
          const toolCall = msg[0];
          name = toolCall?.name;
          args = toolCall?.parameters;
          toolCallId = toolCall?.id || `tool_${Date.now()}`;
          console.log('[tool_call] Array - first item:', toolCall);
        } else if (msg.tool) {
          console.log('[tool_call] Processing tool object format');
          // Format: { tool: { name: "update_calendar", arguments: {...} } }
          name = msg.tool.name;
          args = msg.tool.arguments;
          toolCallId = msg.tool_call_id;
          console.log('[tool_call] Tool object:', msg.tool);
        } else {
          console.log('[tool_call] Processing direct format');
          // Format: { name: "update_calendar", arguments: {...} }
          name = msg.name;
          args = msg.arguments;
          toolCallId = msg.tool_call_id;
          console.log('[tool_call] Direct properties:', { name: msg.name, arguments: msg.arguments });
        }
        
        console.log('🔧 [TOOL_CALL] ===== EXTRACTED VALUES =====');
        console.log('[tool_call] Name:', name);
        console.log('[tool_call] Args:', args);
        console.log('[tool_call] Tool Call ID:', toolCallId);
        console.log('[tool_call] Args type:', typeof args);
        console.log('[tool_call] Args stringified:', JSON.stringify(args, null, 2));

        if (name === 'end_call') {
          console.log('[tool_call] End call requested:', args);
          // Actually end the call by going back to landing
          setStep('landing');
          setConversationUrl(null); // Clear the conversation URL
          sendToolResultToTavus(conversationUrl, toolCallId, { 
            success: true, 
            message: 'Call ended successfully',
            reason: args.reason || 'user_completed_task'
          });
          return;
        }
        
        if (name !== 'update_calendar') {
          console.log('[tool_call] Ignored different tool:', name);
          return;
        }

        const id = toolCallId || '';
        if (id && inFlightToolCalls.current.has(id)) {
          console.warn('[tool_call] Duplicate tool_call_id, ignoring', id);
          return;
        }
        if (id) inFlightToolCalls.current.add(id);

        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch (e) { console.warn('[tool_call] Could not parse string args', args, e); }
        }
        console.log('[tool_call] Parsed args', args);

        const inviteeEmail = String(args.email || email || '').trim();
        const reqDuration = 30; // Only 30-minute meetings

        const iso = args.iso_start || args.start_time || args.datetime || args.date_time;
        const whenISO = typeof iso === 'string' ? iso : (iso?.iso || iso?.value || null);
        const datetimeText = args.datetimeText || args.when || null;
        const timezone = args.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';

        if (!inviteeEmail || (!whenISO && !datetimeText)) {
          const errorMsg = 'Missing email or time in tool args';
          console.error('[tool_call] ' + errorMsg, { inviteeEmail, whenISO, datetimeText });
          sendToolResultToTavus(conversationUrl, id, { ok: false, error: errorMsg });
          setToolError('Missing booking info from tool call.');
          return;
        }

        // Path A: ISO provided → book directly
        if (whenISO) {
          console.log('[tool_call] ISO detected, calling confirmAndBook', { inviteeEmail, whenISO, reqDuration });
          await confirmAndBook({
            email: inviteeEmail,
            start_time: whenISO,
            duration: reqDuration,
            title: args.title,
            notes: args.notes,
          });
          sendToolResultToTavus(conversationUrl, id, { ok: true, start_time: whenISO });
          return;
        }

        // Path B: Natural language → send to intent endpoint to parse + check availability + book
        console.log('[tool_call] No ISO; calling /api/tavus/intent', { inviteeEmail, datetimeText, timezone, reqDuration });
        const bookingPayload = {
          intent: 'BOOK_MEETING',
          email: inviteeEmail,
          duration: reqDuration,
          datetimeText,
          timezone,
          confirm: true,
          notes: args.notes,
          title: args.title || 'Intro with Sagar'
        };
        
        console.log('[tool_call] Booking request payload:', bookingPayload);
        console.log('[tool_call] Calling /api/tavus/intent...');
        
        const res = await fetch('/api/tavus/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bookingPayload),
        });
        
        console.log('[tool_call] Intent API response status:', res.status);
        const data = await res.json();
        console.log('[tool_call] Intent API response data:', data);

        if (!res.ok || !data?.ok) {
          const errorMsg = data?.error || 'Booking failed via intent';
          console.error('[tool_call] Intent booking failed:', { status: res.status, error: errorMsg, data });
          sendToolResultToTavus(conversationUrl, id, { ok: false, error: errorMsg });
          setToolError(errorMsg);
          return;
        }

        console.log('[tool_call] Booking successful!', {
          start_time: data.booked_start_time,
          htmlLink: data.htmlLink,
          hangoutLink: data.hangoutLink
        });

        sendToolResultToTavus(conversationUrl, id, {
          ok: true,
          start_time: data.booked_start_time,
          htmlLink: data.htmlLink,
          hangoutLink: data.hangoutLink
        });
        setBookingInfo({ htmlLink: data.htmlLink, hangoutLink: data.hangoutLink });
        setStep('confirm');
      } finally {
        if ((msg as any)?.tool_call_id) inFlightToolCalls.current.delete((msg as any).tool_call_id);
      }
    },
    [conversationUrl, duration, email]
  );

  // Listen for Tavus app_messages via postMessage from Conversation (iframe)
  useEffect(() => {
    function handleAppMessage(event: any) {
      console.log('🔔 [APP_MESSAGE] ===== NEW MESSAGE RECEIVED =====');
      console.log('🔔 [APP_MESSAGE] Event:', event);
      console.log('🔔 [APP_MESSAGE] Timestamp:', new Date().toISOString());
      
      // The message is directly in the event data
      const message = event.data;
      console.log('🔔 [APP_MESSAGE] Message data:', message);
      console.log('🔔 [APP_MESSAGE] Message type:', message?.message_type);
      console.log('🔔 [APP_MESSAGE] Event type:', message?.event_type);
      
      // Check if we have a valid message with the expected structure
      if (!message || !message.message_type || !message.event_type) {
        console.log('🔔 [APP_MESSAGE] Invalid message structure:', message);
        return;
      }
      
      // Log user utterances
      if (message.message_type === 'conversation' && message.event_type === 'conversation.utterance' && 
          message.properties?.role === 'user') {
        console.log('🔔 [APP_MESSAGE] User said:', message.properties.speech);
      }
      
      // Only process tool call events
      if (message.message_type === 'conversation' && message.event_type === 'conversation.tool_call') {
        console.log('🔔 [APP_MESSAGE] ===== TOOL CALL DETECTED =====');
        
        // The tool call is directly in the properties object
        const toolCall = message.properties;
        console.log('🔔 [APP_MESSAGE] Tool call:', toolCall);
        
        if (!toolCall) {
          console.log('🔔 [APP_MESSAGE] No tool call found in message properties');
          return;
        }
        
        // Process the tool call
        handleToolCallFromAppMessage(toolCall, message.conversation_id);
      }
    }

    // Handle tool calls from app messages (similar to sample code)
    async function handleToolCallFromAppMessage(toolCall: any, conversationId: string) {
      console.log('🔧 [TOOL_CALL] Processing tool call from app message:', toolCall);
      
      if (toolCall.name === 'update_calendar') {
        try {
          // Parse the arguments string into an object
          const args = typeof toolCall.arguments === 'string' 
            ? JSON.parse(toolCall.arguments) 
            : toolCall.arguments;
          
          console.log('🔧 [TOOL_CALL] Parsed arguments:', args);
          
          const inviteeEmail = String(args.email || email || '').trim();
          const reqDuration = 30; // Only 30-minute meetings
          const datetimeText = args.datetimeText || args.when || null;
          const timezone = args.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
          
          if (!inviteeEmail || !datetimeText) {
            console.error('🔧 [TOOL_CALL] Missing email or time in tool args');
            return;
          }
          
          // Call the booking API
          console.log('🔧 [TOOL_CALL] Calling booking API...');
          const bookingResponse = await fetch('/api/tavus/intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              intent: 'BOOK_MEETING',
              email: inviteeEmail,
              duration: reqDuration,
              datetimeText: datetimeText,
              timezone: timezone,
              confirm: true,
              title: args.title || 'Meeting with Sagar',
              notes: args.notes || 'Booked via Tavus assistant'
            })
          });
          
          const bookingData = await bookingResponse.json();
          console.log('🔧 [TOOL_CALL] Booking result:', bookingData);
          
          // Send response back to Tavus (if needed)
          // This would require Daily.co call object to send app messages back
          
        } catch (error) {
          console.error('🔧 [TOOL_CALL] Error processing booking:', error);
        }
      } else if (toolCall.name === 'end_call') {
        console.log('🔧 [TOOL_CALL] End call requested:', toolCall.arguments);
        // Handle call ending
        setStep('landing');
        setConversationUrl(null);
      }
    }

    function looksLikeTavusOrigin(origin: string) {
      try {
        const host = new URL(origin).host;
        return host.endsWith('daily.co') || host.endsWith('tavus.ai') || host.endsWith('tavus.daily.co');
      } catch {
        return false;
      }
    }

    function onMessage(e: MessageEvent) {
      // Log ALL postMessage events for debugging
      console.log('📨 [POSTMESSAGE] ===== ALL MESSAGES =====');
      console.log('[pm] Origin:', e.origin);
      console.log('[pm] Data:', e.data);
      console.log('[pm] Data type:', typeof e.data);
      console.log('[pm] Data stringified:', JSON.stringify(e.data, null, 2));
      console.log('[pm] Timestamp:', new Date().toISOString());
      
      if (!conversationUrl) {
        console.log('[pm] No conversation URL, ignoring');
        return;
      }
      if (!looksLikeTavusOrigin(e.origin)) {
        console.log('[pm] Ignoring non-Tavus origin:', e.origin);
        return;
      }

      console.log('📨 [POSTMESSAGE] ===== TAVUS MESSAGE =====');
      console.log('[pm] postMessage from Tavus/Daily origin', e.origin, e.data);
      console.log('[pm] Message type:', e.data?.type, 'Event type:', e.data?.event_type);
      console.log('[pm] Message keys:', Object.keys(e.data || {}));
      pushLog({ ts: Date.now(), origin: e.origin, kind: 'message', note: 'postMessage', data: e.data });

      // Try to handle as app message first (new approach)
      handleAppMessage(e);
      
      // Fallback to old approach
      const tc = extractToolCallPayload(e.data);
      if (tc) {
        console.log('🔧 [POSTMESSAGE] ===== TOOL CALL DETECTED =====');
        console.log('[pm] Detected conversation.tool_call, calling handler...');
        console.log('[pm] Tool call payload:', tc);
        handleToolCall(tc);
      } else {
        console.log('[pm] No tool call detected in message');
        // Let's also check if there are any other interesting message types
        if (e.data?.type || e.data?.event_type) {
          console.log('[pm] Message has type/event_type but not recognized as tool call:', {
            type: e.data.type,
            event_type: e.data.event_type,
            data: e.data
          });
        }
      }
    }

    console.log('🔧 [SETUP] Setting up postMessage listener');
    window.addEventListener('message', onMessage);
    console.log('🔧 [SETUP] PostMessage listener added');
    return () => {
      console.log('🔧 [CLEANUP] Removing postMessage listener');
      window.removeEventListener('message', onMessage);
    };
  }, [conversationUrl, handleToolCall, pushLog]);

  // ---------- UI ----------
  function TopBar() {
    return (
      <div className="w-full flex items-center justify-between p-4 border-b border-zinc-200 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-black/90 text-white flex items-center justify-center font-semibold">T</div>
          <div className="text-sm text-zinc-600">Tavus • Sagar’s Assistant</div>
        </div>
        <div className="text-xs text-zinc-500">
          Duration: <span className="font-medium text-zinc-700">{duration} min</span>
        </div>
      </div>
    );
  }

  const visibleLogs = logs.filter((l) => {
    if (!filterToolCalls) return true;
    const d = l.data;
    const isTool =
      d?.type === 'conversation.tool_call' ||
      d?.event_type === 'conversation.tool_call' ||
      d?.name === 'update_calendar' ||
      d?.tool?.name === 'update_calendar' ||
      l.note?.includes('tool_call') ||
      l.note?.includes('/api/book') ||
      l.note?.includes('/api/tavus/intent');
    return isTool;
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white text-zinc-900">
      <TopBar />

      {step === 'landing' && (
        <div className="max-w-3xl mx-auto px-6 py-12">
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight mb-2">Book a {duration}-minute meeting with Sagar</h1>
            <p className="text-zinc-600 max-w-prose">
              I'm Sagar's assistant. I can schedule a <b>30-minute</b> meeting for you.
              Tell me your email below to get started.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 items-start">
            <div className="p-6 rounded-2xl border bg-white shadow-sm">
              <div className="space-y-4">
                <label className="block text-sm font-medium">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full rounded-xl border px-4 py-3 outline-none focus:ring-2 focus:ring-black/20"
                />
                {remembered && !email && (
                  <button onClick={() => setEmail(remembered)} className="text-xs underline text-zinc-600">
                    Use last email: {remembered}
                  </button>
                )}

                <div className="text-xs text-zinc-500">Duration from URL/path: <b>{duration} minutes</b></div>

                {errors && <div className="text-sm text-red-600">{errors}</div>}

                <button
                  onClick={handleStart}
                  className="w-full mt-2 rounded-xl bg-black text-white px-4 py-3 font-medium hover:bg-black/90"
                >
                  Continue → Haircheck
                </button>
              </div>
            </div>

            <div className="p-6 rounded-2xl border bg-white shadow-sm">
              <h3 className="font-semibold mb-2">What happens next</h3>
              <ul className="text-sm text-zinc-600 list-disc pl-5 space-y-1">
                <li>We’ll test your camera and mic.</li>
                <li>Join a quick AI-powered assistant call.</li>
                <li>I’ll check availability and confirm a time.</li>
                <li>You’ll get a calendar invite by email.</li>
              </ul>
              <div className="mt-4 text-xs text-zinc-500">Tip: All meetings are 30 minutes in duration.</div>
            </div>
          </div>
        </div>
      )}

      {step === 'haircheck' && (
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="mb-6 flex items-center justify-between">
            <div><h2 className="text-2xl font-semibold">Haircheck</h2>
              <p className="text-sm text-zinc-600">Allow camera & microphone so we can connect you to the assistant.</p>
            </div>
            <button onClick={() => setStep('landing')} className="text-sm underline text-zinc-600">← Back</button>
          </div>

          <div className="grid md:grid-cols-3 gap-8 items-start">
            <div className="md:col-span-2 p-4 rounded-2xl border bg-white shadow-sm">
              <div className="aspect-video bg-black/5 rounded-xl overflow-hidden flex items-center justify-center">
                <video ref={videoRef} className="w-full h-full object-cover" muted />
              </div>
              <div className="mt-4 flex items-center justify-between">
                <div className="text-sm text-zinc-600">Microphone level</div>
                <div className="h-2 w-48 rounded-full bg-zinc-100 overflow-hidden">
                  <div className="h-2 bg-black transition-all" style={{ width: `${Math.min(100, Math.floor(micLevel * 200))}%` }} />
                </div>
              </div>

              <div className="mt-4 flex gap-3">
                {!mediaStream ? (
                  <button onClick={requestAV} className="rounded-xl bg-black text-white px-4 py-2 text-sm font-medium">Allow Camera & Mic</button>
                ) : (
                  <>
                    <button onClick={leaveAV} className="rounded-xl border px-4 py-2 text-sm">Turn Off</button>
                    <button onClick={goToCall} className="rounded-xl bg-black text-white px-4 py-2 text-sm font-medium">Join Assistant Call</button>
                  </>
                )}
              </div>
              {errors && <div className="mt-3 text-sm text-red-600">{errors}</div>}
            </div>

            <div className="p-4 rounded-2xl border bg-white shadow-sm space-y-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">You</div>
                <div className="text-sm text-zinc-700">{email}</div>
                <div className="text-xs text-zinc-500">{duration}-minute session</div>
              </div>
              <div className="text-xs text-zinc-500">One assistant persona is used for all durations.</div>
            </div>
          </div>
        </div>
      )}

      {step === 'call' && (
        <div className="max-w-6xl mx-auto px-6 py-10">
          <div className="mb-6 flex items-center justify-between">
            <div><h2 className="text-2xl font-semibold">Scheduling Call</h2></div>
            <button onClick={() => setStep('haircheck')} className="text-sm underline text-zinc-600">← Back</button>
          </div>

          <div className="grid lg:grid-cols-3 gap-8 items-start">
            {/* Left: Tavus */}
            <div className="lg:col-span-2 p-4 rounded-2xl border bg-white shadow-sm">
              {conversationUrl ? (
                <div className="aspect-video rounded-xl overflow-hidden">
                  <Conversation conversationUrl={conversationUrl} onLeave={() => setStep('landing')} />
                </div>
              ) : (
                <div className="aspect-video rounded-xl overflow-hidden bg-black/5 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-6xl mb-3">🎥</div>
                    <div className="font-medium">Loading assistant…</div>
                    <div className="text-sm text-zinc-600">Please wait a moment.</div>
                  </div>
                </div>
              )}
              {toolError && <div className="mt-3 text-sm text-red-600">{toolError}</div>}
            </div>

            {/* Right: availability + optional manual booking */}
            <div className="p-4 rounded-2xl border bg-white shadow-sm space-y-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Available (next 7 days)</div>
                {loadingSlots && <div className="text-sm text-zinc-600">Loading times…</div>}
                {!loadingSlots && !slots.length && <div className="text-sm text-zinc-600">No open times returned.</div>}
                <div className="grid grid-cols-2 gap-2">
                  {slots.map((s) => {
                    const d = new Date(s.start_time);
                    const label = d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                    const isSelected = selectedSlot?.start_time === s.start_time;
                    return (
                      <button
                        key={s.start_time}
                        onClick={() => {
                          console.log('[ui] Slot selected', s.start_time);
                          setSelectedSlot({ start_time: s.start_time });
                        }}
                        className={`rounded-xl border px-3 py-2 text-sm text-left hover:border-black ${isSelected ? 'border-black ring-1 ring-black/10' : ''}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <button
                  disabled={!selectedSlot || booking}
                  onClick={() => confirmAndBook()}
                  className="w-full mt-3 rounded-xl bg-black text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {booking ? 'Booking…' : selectedSlot ? 'Confirm & Book' : 'Select a time to continue'}
                </button>

                {errors && <div className="mt-2 text-sm text-red-600">{errors}</div>}
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Guardrails</div>
                <ul className="text-sm text-zinc-600 list-disc pl-5 space-y-1">
                  <li>Respect chosen duration ({duration} minutes)</li>
                  <li>No private calendar details disclosed</li>
                  <li>Confirm time before booking</li>
                  <li>Graceful fallback if APIs fail</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="max-w-2xl mx-auto px-6 py-20 text-center">
          <div className="text-7xl mb-4">✅</div>
          <h2 className="text-2xl font-semibold mb-2">You’re all set!</h2>
          <p className="text-zinc-600">
            We’ve scheduled your {duration}-minute meeting with Sagar. A confirmation
            email will arrive at <span className="font-medium">{email}</span>.
          </p>
          {bookingInfo?.htmlLink && (
            <p className="text-xs text-zinc-500 mt-2">
              Calendar link:{' '}
              <a className="underline" href={bookingInfo.htmlLink} target="_blank" rel="noreferrer">
                {bookingInfo.htmlLink}
              </a>
            </p>
          )}
          <div className="mt-6 flex items-center justify-center gap-3">
            <a
              href="/"
              className="rounded-xl border px-4 py-2 text-sm"
              onClick={(e) => {
                e.preventDefault();
                console.log('[ui] Resetting to landing');
                setStep('landing');
              }}
            >
              Book another
            </a>
            <button className="rounded-xl bg-black text-white px-4 py-2 text-sm font-medium" onClick={() => window.print()}>
              Print
            </button>
          </div>
        </div>
      )}

      {/* Floating debug panel */}
      <button
        onClick={() => setDebugOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-50 rounded-full bg-black text-white text-xs px-3 py-2 shadow-lg"
      >
        {debugOpen ? 'Close Debug' : 'Debug'}
      </button>

      {debugOpen && (
        <div className="fixed bottom-14 right-4 w-[420px] max-h-[60vh] z-50 bg-white border rounded-xl shadow-xl flex flex-col">
          <div className="px-3 py-2 border-b flex items-center gap-2">
            <div className="font-medium text-sm">Event Log</div>
            <label className="ml-auto flex items-center gap-1 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={filterToolCalls}
                onChange={(e) => setFilterToolCalls(e.target.checked)}
              />
              Show tool-calls only
            </label>
            <button className="text-xs underline ml-2" onClick={copyLogs}>Copy</button>
            <button className="text-xs underline ml-2" onClick={clearLogs}>Clear</button>
          </div>
          <div className="p-3 overflow-auto text-xs leading-[1.2] space-y-2">
            {visibleLogs.length === 0 && <div className="text-zinc-500">No logs yet…</div>}
            {visibleLogs.map((l, i) => {
              const ts = new Date(l.ts).toLocaleTimeString();
              return (
                <div key={i} className="rounded border p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded ${l.kind === 'error' ? 'bg-red-100 text-red-700' : l.kind === 'info' ? 'bg-blue-100 text-blue-700' : 'bg-zinc-100 text-zinc-700'}`}>
                      {l.kind}
                    </span>
                    <span className="text-zinc-500">{ts}</span>
                    {l.note && <span className="text-zinc-800">• {l.note}</span>}
                  </div>
                  <div className="text-zinc-500 mb-1">origin: {l.origin}</div>
                  <pre className="whitespace-pre-wrap">{safeStringify(l.data)}</pre>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <footer className="max-w-6xl mx-auto px-6 py-10 text-xs text-zinc-500">
        <div className="border-t pt-6">Built for Sagar • Single Tavus persona • Voice tool-calls → server-side booking.</div>
      </footer>
    </div>
  );
}
