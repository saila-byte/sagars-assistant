'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Conversation } from './components/cvi/components/conversation';
import { AvailabilitySidebar } from './components/availability-sidebar';
import { useTavusToolCalls } from './components/cvi/hooks/use-tavus-tool-calls';

// ---------- helpers ----------
// Removed useMeetingDuration - only 30-minute meetings

const emailRegex = /[^@\s]+@[^@\s]+\.[^@\s]+/;

// Common timezones for the dropdown
const TIMEZONE_OPTIONS = [
  { value: 'America/Los_Angeles', label: 'Pacific Time (Los Angeles)' },
  { value: 'America/Denver', label: 'Mountain Time (Denver)' },
  { value: 'America/Chicago', label: 'Central Time (Chicago)' },
  { value: 'America/New_York', label: 'Eastern Time (New York)' },
  { value: 'Europe/London', label: 'GMT (London)' },
  { value: 'Europe/Paris', label: 'CET (Paris)' },
  { value: 'Europe/Berlin', label: 'CET (Berlin)' },
  { value: 'Asia/Tokyo', label: 'JST (Tokyo)' },
  { value: 'Asia/Shanghai', label: 'CST (Shanghai)' },
  { value: 'Asia/Kolkata', label: 'IST (Mumbai)' },
  { value: 'Australia/Sydney', label: 'AEST (Sydney)' },
  { value: 'Pacific/Auckland', label: 'NZST (Auckland)' },
];

function extractToolCallPayload(data: any): ToolCallMsg | null {
  if (!data || typeof data !== 'object') return null;

  // Check for direct tool call format
  if (data.type === 'conversation.tool_call' && data.tool) {
    return {
      type: data.type,
      tool_call_id: data.tool_call_id,
      tool: data.tool
    };
  }

  // Check for nested tool call format
  if (data.message_type === 'conversation' && data.event_type === 'conversation.tool_call') {
    return data.properties || null;
  }

  return null;
}

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
    target?.contentWindow?.postMessage(
      { type: 'conversation.tool_result', tool_call_id, result },
      targetOrigin
    );
  } catch (e) {
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

  const [step, setStep] = useState<'landing' | 'haircheck' | 'call' | 'confirm'>('haircheck');
  const [email, setEmail] = useState('ashish@tavus.io');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles');
  const [errors, setErrors] = useState<string | null>(null);
  const [remembered, setRemembered] = useState<string | null>(null);
  const [conversationUrl, setConversationUrl] = useState<string | null>(null);
  const [conversationPreparing, setConversationPreparing] = useState(false);

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
    } catch (e) {
    }
  }, [logs]);

  // Handle tool calls from Tavus using the built-in hooks
  const handleTavusToolCall = useCallback(async (toolCall: any, conversationId: string) => {
    console.log('🔧 [TOOL_CALL] Received tool call via Tavus hooks:', { toolCall, conversationId });
    pushLog({ ts: Date.now(), origin: 'tavus-hooks', kind: 'message', note: 'tool_call', data: toolCall });
    
    if (toolCall.name === 'update_calendar') {
      try {
        // Parse the arguments string into an object
        const args = typeof toolCall.arguments === 'string' 
          ? JSON.parse(toolCall.arguments) 
          : toolCall.arguments;
        
        const inviteeEmail = String(args.email || email || '').trim();
        const reqDuration = args.duration || 30; // Use provided duration or default to 30
        const datetimeText = args.datetime || args.datetimeText || args.when || null;
        const toolTimezone = args.timezone || timezone || 'America/Los_Angeles';
        
        console.log('🔧 [TOOL_CALL] Parsed arguments:', { 
          inviteeEmail, 
          reqDuration, 
          datetimeText, 
          toolTimezone,
          rawArgs: args 
        });
        
        if (!inviteeEmail || !datetimeText) {
          const errorMsg = `Missing required parameters: ${!inviteeEmail ? 'email' : ''} ${!datetimeText ? 'datetime' : ''}`.trim();
          console.error('🔧 [TOOL_CALL] Missing parameters:', { inviteeEmail, datetimeText, args });
          tavusToolCalls.sendToolResult(conversationId, toolCall.tool_call_id, {
            ok: false,
            error: errorMsg
          });
          return;
        }
        
        // Call the booking API
        const bookingResponse = await fetch('/api/tavus/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            intent: 'BOOK_MEETING',
            email: inviteeEmail,
            duration: reqDuration,
            datetimeText: datetimeText,
            timezone: toolTimezone,
            confirm: true,
            title: args.title || 'Meeting with Hassaan',
            notes: args.notes || 'Booked via Tavus assistant'
          })
        });
        
        const bookingData = await bookingResponse.json();
        
        if (!bookingResponse.ok || !bookingData?.ok) {
          tavusToolCalls.sendToolResult(conversationId, toolCall.tool_call_id, {
            ok: false,
            error: bookingData?.error || 'Booking failed'
          });
          return;
        }
        
        // Extract attendee name from email (everything before @)
        const attendeeName = inviteeEmail.split('@')[0];
        const meetingName = args.title || 'Meeting with Hassaan';
        
        // Format the time for the echo message
        const startTime = new Date(bookingData.booked_start_time);
        const timeString = startTime.toLocaleString('en-US', {
          timeZone: toolTimezone,
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short'
        });
        
        // Send echo message to Tavus
        const echoMessage = `I successfully scheduled a meeting with ${attendeeName} for ${timeString}.`;
        console.log('🔊 [ECHO] Sending echo message:', echoMessage);
        
        tavusToolCalls.sendEcho(conversationId, echoMessage, 'text');
        
        // Send success result back to Tavus
        tavusToolCalls.sendToolResult(conversationId, toolCall.tool_call_id, {
          ok: true,
          start_time: bookingData.booked_start_time,
          htmlLink: bookingData.htmlLink,
          hangoutLink: bookingData.hangoutLink
        });
        
        setBookingInfo({ htmlLink: bookingData.htmlLink, hangoutLink: bookingData.hangoutLink });
        setStep('confirm');
        
      } catch (error) {
        console.error('Error handling update_calendar tool call:', error);
        tavusToolCalls.sendToolResult(conversationId, toolCall.tool_call_id, {
          ok: false,
          error: `Failed to book meeting: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    } else if (toolCall.name === 'end_call') {
      // Handle call ending
      setStep('landing');
      setConversationUrl(null);
      tavusToolCalls.sendToolResult(conversationId, toolCall.tool_call_id, {
        ok: true
      });
    }
  }, [email, timezone]);

  // Initialize Tavus tool calls hook
  const tavusToolCalls = useTavusToolCalls(handleTavusToolCall);

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
    setStep('haircheck');
    // Immediately request camera access when continuing
    requestAV();
  }

  const requestAV = useCallback(async () => {
    setErrors(null);
    try {
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
    } catch (e) {
      setErrors("We couldn't access your camera/mic. Check permissions and try again.");
    }
  }, [mediaStream]);

  function leaveAV() {
    mediaStream?.getTracks().forEach((t) => t.stop());
    setMediaStream(null);
    setAvReady(false);
  }

  async function goToCall() {
    if (!avReady) {
      setErrors('Please allow camera & mic to continue.');
      return;
    }
    if (conversationPreparing) {
      setErrors('Please wait for conversation to prepare...');
      return;
    }
    if (!conversationUrl) {
      setErrors('Conversation not ready yet. Please wait a moment and try again.');
      return;
    }
    // Use pre-prepared URL
    setStep('call');
    pushLog({ ts: Date.now(), origin: 'local', kind: 'info', note: 'Using pre-prepared conversation', data: { conversationUrl } });
  }

  // -------- Availability (fetch on "haircheck" step, before conversation preparation) --------
  useEffect(() => {
    if (step !== 'haircheck') return;
    let cancelled = false;
    (async () => {
      setLoadingSlots(true);
      setErrors(null);
      setSelectedSlot(null);
      try {
        const res = await fetch(
          `/api/calendly/availability?duration=${duration}&timezone=${encodeURIComponent(timezone)}`,
          { cache: 'no-store' }
        );
        const data = await res.json();
        if (!cancelled) setSlots(Array.isArray(data.slots) ? data.slots : []);
        pushLog({ ts: Date.now(), origin: 'local', kind: 'info', note: 'Loaded availability', data });
      } catch (e) {
        if (!cancelled) setErrors('Could not load availability from Calendly.');
        pushLog({ ts: Date.now(), origin: 'local', kind: 'error', note: 'Availability load failed', data: String(e) });
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    })();
    return () => { cancelled = true; };
  }, [step, duration, timezone, pushLog]);

  // -------- Conversation preparation --------
  const prepareConversation = useCallback(async () => {
    if (conversationPreparing || conversationUrl) return;
    setConversationPreparing(true);
    try {
      const res = await fetch('/api/tavus/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, timezone, slots }),
      });
      const payload = await res.json();
      const { conversationUrl: newConversationUrl } = payload;
      if (newConversationUrl) {
        setConversationUrl(newConversationUrl);
        pushLog({ ts: Date.now(), origin: 'local', kind: 'info', note: 'Conversation prepared in background', data: { conversationUrl: newConversationUrl } });
      }
    } catch (e) {
      pushLog({ ts: Date.now(), origin: 'local', kind: 'error', note: 'Failed to prepare conversation', data: String(e) });
    } finally {
      setConversationPreparing(false);
    }
  }, [conversationPreparing, conversationUrl, email, timezone, slots, pushLog]);

  // Auto-initialize camera when on haircheck step
  useEffect(() => {
    if (step === 'haircheck' && !mediaStream) {
      requestAV();
    }
  }, [step, mediaStream, requestAV]);

  // Prepare conversation when camera is ready AND availability is loaded
  useEffect(() => {
    if (avReady && !conversationUrl && !conversationPreparing && !loadingSlots && slots.length >= 0) {
      prepareConversation();
    }
  }, [avReady, conversationUrl, conversationPreparing, loadingSlots, slots, prepareConversation]);

  // -------- Manual confirm button (fallback) --------
  async function confirmAndBook(args?: {
    email?: string;
    start_time?: string; // ISO
    duration?: number;
    title?: string;
    notes?: string;
    timezone?: string;
  }) {
    const start_time = args?.start_time ?? selectedSlot?.start_time;
    if (!start_time) {
      return;
    }

    const body = {
      email: (args?.email || email).trim(),
      start_time,
      duration: args?.duration ?? duration,
      title: args?.title || 'Intro with Hassaan',
      notes: args?.notes || 'Booked via Tavus assistant',
      timezone: args?.timezone || timezone,
    };

    try {
      setErrors(null);
      setBooking(true);
      const r = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      pushLog({ ts: Date.now(), origin: 'local', kind: r.ok && data?.ok ? 'info' : 'error', note: 'POST /api/book result', data });
      if (!r.ok || !data?.ok) throw new Error(data?.error || 'Booking failed');
      setBookingInfo({ htmlLink: data.htmlLink, hangoutLink: data.hangoutLink });
      setStep('confirm');
    } catch (e: any) {
      const msg = e?.message || 'Could not book this time.';
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
        
        // Handle different message formats
        let name: string | undefined;
        let args: any;
        let toolCallId: string | undefined;
        
        if (Array.isArray(msg) && msg.length > 0) {
          // Format from system prompt: [{ "name": "update_calendar", "parameters": {...} }]
          const toolCall = msg[0];
          name = toolCall?.name;
          args = toolCall?.parameters;
          toolCallId = toolCall?.id || `tool_${Date.now()}`;
        } else if (msg.tool) {
          // Format: { tool: { name: "update_calendar", arguments: {...} } }
          name = msg.tool.name;
          args = msg.tool.arguments;
          toolCallId = msg.tool_call_id;
        } else {
          // Format: { name: "update_calendar", arguments: {...} }
          name = msg.name;
          args = msg.arguments;
          toolCallId = msg.tool_call_id;
        }
        

        if (name === 'end_call') {
          // Actually end the call by going back to landing
          setStep('landing');
          setConversationUrl(null); // Clear the conversation URL
          sendToolResultToTavus(conversationUrl, toolCallId, { 
            ok: true
          });
          return;
        }

        if (name !== 'update_calendar') {
          return;
        }

        const id = toolCallId || '';
        if (id && inFlightToolCalls.current.has(id)) {
          return;
        }
        if (id) inFlightToolCalls.current.add(id);

        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch (e) { /* Could not parse string args */ }
        }

        const inviteeEmail = String(args.email || email || '').trim();
        const reqDuration = 30; // Only 30-minute meetings

        const iso = args.iso_start || args.start_time || args.datetime || args.date_time;
        const whenISO = typeof iso === 'string' ? iso : (iso?.iso || iso?.value || null);
        const datetimeText = args.datetimeText || args.when || null;
        const toolTimezone = args.timezone || timezone || 'America/Los_Angeles';

        if (!inviteeEmail || (!whenISO && !datetimeText)) {
          const errorMsg = 'Missing email or time in tool args';
          sendToolResultToTavus(conversationUrl, id, { ok: false, error: errorMsg });
          setToolError('Missing booking info from tool call.');
          return;
        }

        // Path A: ISO provided → book directly
        if (whenISO) {
          await confirmAndBook({
            email: inviteeEmail,
            start_time: whenISO,
            duration: reqDuration,
            title: args.title,
            notes: args.notes,
            timezone: toolTimezone,
          });
          sendToolResultToTavus(conversationUrl, id, { ok: true, start_time: whenISO });
          return;
        }

        // Path B: Natural language → send to intent endpoint to parse + check availability + book
        const bookingPayload = {
            intent: 'BOOK_MEETING',
            email: inviteeEmail,
            duration: reqDuration,
            datetimeText,
          timezone: toolTimezone,
            confirm: true,
            notes: args.notes,
            title: args.title || 'Intro with Hassaan'
        };
        
        
        const res = await fetch('/api/tavus/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bookingPayload),
        });
        
        const data = await res.json();

        if (!res.ok || !data?.ok) {
          const errorMsg = data?.error || 'Booking failed via intent';
          sendToolResultToTavus(conversationUrl, id, { ok: false, error: errorMsg });
          setToolError(errorMsg);
          return;
        }


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
    [conversationUrl, duration, email, timezone]
  );

  // OLD postMessage implementation - replaced with Tavus hooks above
  // Keeping this commented out for reference
  /*
  useEffect(() => {
    function handleAppMessage(event: any) {
      console.log('🔧 [TOOL_CALL] ===== APP MESSAGE RECEIVED =====')
      
      // The message is directly in the event data
      const message = event.data;
      
      // Check if we have a valid message with the expected structure
      if (!message || !message.message_type || !message.event_type) {
        return;
      }
    
      // Only process tool call events
      if (message.message_type === 'conversation' && message.event_type === 'conversation.tool_call') {
        
        // The tool call is directly in the properties object
        const toolCall = message.properties;
        
        if (!toolCall) {
          return;
        }
        
        // Process the tool call
        handleToolCallFromAppMessage(toolCall, message.conversation_id);
      }
    }

    // Handle tool calls from app messages (similar to sample code)
    async function handleToolCallFromAppMessage(toolCall: any, conversationId: string) {
      
      if (toolCall.name === 'update_calendar') {
        try {
          // Parse the arguments string into an object
          const args = typeof toolCall.arguments === 'string' 
            ? JSON.parse(toolCall.arguments) 
            : toolCall.arguments;
          
          
          const inviteeEmail = String(args.email || email || '').trim();
          const reqDuration = 30; // Only 30-minute meetings
          const datetimeText = args.datetimeText || args.when || null;
          const toolTimezone = args.timezone || timezone || 'America/Los_Angeles';
          
          if (!inviteeEmail || !datetimeText) {
            return;
          }
          
          // Call the booking API
          const bookingResponse = await fetch('/api/tavus/intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              intent: 'BOOK_MEETING',
              email: inviteeEmail,
              duration: reqDuration,
              datetimeText: datetimeText,
              timezone: toolTimezone,
              confirm: true,
              title: args.title || 'Meeting with Hassaan',
              notes: args.notes || 'Booked via Tavus assistant'
            })
          });
          
          const bookingData = await bookingResponse.json();
          
          // Send response back to Tavus (if needed)
          // This would require Daily.co call object to send app messages back
          
        } catch (error) {
        }
      } else if (toolCall.name === 'end_call') {
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
      
      if (!conversationUrl) {
        return;
      }
      if (!looksLikeTavusOrigin(e.origin)) {
        return;
      }

      pushLog({ ts: Date.now(), origin: e.origin, kind: 'message', note: 'postMessage', data: e.data });

      // Try to handle as app message first (new approach)
      handleAppMessage(e);
      
      // Fallback to old approach
      const tc = extractToolCallPayload(e.data);
      if (tc) {
        handleToolCall(tc);
      } else {
        // Let's also check if there are any other interesting message types
        if (e.data?.type || e.data?.event_type) {
        }
      }
    }

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [conversationUrl, handleToolCall, pushLog]);
  */

  // ---------- UI ----------

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
    <div className="min-h-screen terminal-scanlines" style={{ background: 'rgba(255, 255, 255, 0.1)', color: 'var(--terminal-text)' }}>

      {step === 'landing' && (
        <div className="max-w-3xl mx-auto px-6 py-12">
          <div className="mb-8">
            <h2 className="text-2xl mb-2" style={{ color: 'black' }}>Book a {duration}-minute meeting with Hassaan</h2>
            <p className="text-sm terminal-text">
              I'm Hassaan's assistant. I can schedule a 30-minute meeting for you.
              Tell me your email below to get started.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 items-start">
            <div className="p-6 terminal-border" style={{ background: 'var(--terminal-bg)' }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm mb-2" style={{ color: 'black' }}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                    className="w-full terminal-input rounded"
                />
                {remembered && !email && (
                    <button onClick={() => setEmail(remembered)} className="text-xs underline terminal-text mt-1">
                    Use last email: {remembered}
                  </button>
                )}
                </div>

                <div>
                  <label className="block text-sm mb-2" style={{ color: 'black' }}>Timezone</label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full terminal-input rounded"
                  >
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                </div>

                {errors && <div className="text-sm terminal-error">{errors}</div>}

                <button
                  onClick={handleStart}
                  className="w-full mt-2 terminal-button px-4 py-3"
                >
                  Continue
                </button>
              </div>
            </div>

            <div className="p-6 terminal-border" style={{ background: 'var(--terminal-bg)' }}>
              <h3 className="mb-2" style={{ color: 'black' }}>What happens next</h3>
              <ul className="text-sm terminal-text list-disc pl-5 space-y-1">
                <li>We'll test your camera and mic.</li>
                <li>Join a quick AI-powered assistant call.</li>
                <li>I'll check availability and confirm a time.</li>
                <li>You'll get a calendar invite by email.</li>
              </ul>
              <div className="mt-4 text-xs terminal-text">
                <div>Tip: All meetings are 30 minutes in duration.</div>
                <div className="mt-1">
                  Times will be shown in: <span className="terminal-green">
                    {TIMEZONE_OPTIONS.find(tz => tz.value === timezone)?.label || timezone}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 'haircheck' && (
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-2xl mb-2" style={{ color: 'black' }}>Meet Hassaan's AI Assistant</h2>
              <p className="text-sm terminal-text">
                {!mediaStream 
                  ? 'Initializing camera & microphone...' 
                  : loadingSlots 
                    ? 'Camera & microphone ready. Loading availability...'
                    : conversationPreparing 
                      ? 'Availability loaded. Preparing conversation...' 
                      : conversationUrl 
                        ? 'Ready! Click "Join Call" to book a 30-minute meeting with Hassaan.'
                        : 'Camera & microphone ready. You can join the assistant call to book a 30-minute meeting with Hassaan.'
                }
              </p>
            </div>
            <button onClick={() => {
              setStep('landing');
              setConversationPreparing(false);
            }} className="text-sm underline terminal-text">← Back</button>
          </div>

          <div className="grid md:grid-cols-3 gap-8 items-start">
            <div className="md:col-span-2 p-4 terminal-border" style={{ background: 'var(--terminal-bg)', boxShadow: '6px 6px 0px 0px var(--color-scheme-1-border)' }}>
              <div className="aspect-video terminal-border rounded overflow-hidden flex items-center justify-center" style={{ background: 'var(--terminal-bg)' }}>
                <video ref={videoRef} className="w-full h-full object-cover" muted />
              </div>

              <div className="mt-4 flex gap-3">
                {!mediaStream ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-sm terminal-text">
                      <div className="animate-spin w-4 h-4 border-2 terminal-border border-t-terminal-green rounded-full"></div>
                      Requesting camera & microphone access...
                    </div>
                    {errors && (
                      <button onClick={requestAV} className="terminal-button px-4 py-2 text-sm">
                        Try Again
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <button 
                      onClick={goToCall} 
                      disabled={conversationPreparing}
                      className="terminal-button px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {conversationPreparing ? (
                        <div className="flex items-center gap-2">
                          <div className="animate-spin w-4 h-4 border-2 terminal-border border-t-terminal-green rounded-full"></div>
                          Preparing...
                        </div>
                      ) : conversationUrl ? (
                        'Join Call'
                      ) : (
                        'Join Call'
                      )}
                    </button>
                  </>
                )}
              </div>
              {errors && <div className="mt-3 text-sm terminal-error">{errors}</div>}
            </div>

            <div className="p-4 terminal-border space-y-3 content-container">
              <div>
                <div className="text-xs uppercase tracking-wide terminal-text mb-1">You</div>
                <div className="text-sm terminal-green">{email}</div>
                <div className="text-xs terminal-text">{duration}-minute session</div>
                <div className="text-xs terminal-text mt-1">
                  Timezone: {TIMEZONE_OPTIONS.find(tz => tz.value === timezone)?.label || timezone}
              </div>
              </div>
              <div className="text-xs terminal-text">One assistant persona is used for all durations.</div>
            </div>
          </div>
        </div>
      )}

      {step === 'call' && (
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-2xl mb-2" style={{ color: 'black' }}>Scheduling Call</h2>
              <p className="text-sm terminal-text">Book your meeting with Hassaan's AI assistant</p>
            </div>
            <button onClick={() => setStep('haircheck')} className="text-sm underline terminal-text">← Back</button>
          </div>

          <div className="grid md:grid-cols-3 gap-8 items-start">
            {/* Left: Tavus */}
            <div className="md:col-span-2 p-4 terminal-border" style={{ background: 'var(--terminal-bg)', boxShadow: '6px 6px 0px 0px var(--color-scheme-1-border)' }}>
              {conversationUrl ? (
                <div className="aspect-video terminal-border rounded overflow-hidden" style={{ background: 'var(--terminal-bg)' }}>
                  <Conversation conversationUrl={conversationUrl} onLeave={() => setStep('landing')} />
                </div>
              ) : (
                <div className="aspect-video terminal-border rounded overflow-hidden bg-black/5 flex items-center justify-center" style={{ background: 'var(--terminal-bg)' }}>
                  <div className="text-center">
                    <div className="text-6xl mb-3">🎥</div>
                    <div>Loading assistant…</div>
                    <div className="text-sm text-zinc-600">Please wait a moment.</div>
                  </div>
                </div>
              )}
              {toolError && <div className="mt-3 text-sm text-red-600">{toolError}</div>}
            </div>

            {/* Right: availability + optional manual booking */}
            <AvailabilitySidebar
              slots={slots}
              loadingSlots={loadingSlots}
              selectedSlot={selectedSlot}
              onSlotSelect={(slot) => {
                setSelectedSlot(slot);
              }}
              onBook={confirmAndBook}
              booking={booking}
              errors={errors}
              duration={duration}
            />
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="max-w-2xl mx-auto px-6 py-20 text-center">
          <div className="text-7xl mb-4">✅</div>
          <h2 className="text-2xl mb-2" style={{ color: 'black' }}>You're all set!</h2>
          <p className="terminal-text">
            We've scheduled your {duration}-minute meeting with Hassaan. A confirmation
            email will arrive at <span className="terminal-accent">{email}</span>.
          </p>
          {bookingInfo?.htmlLink && (
            <p className="text-xs terminal-text mt-2">
              Calendar link:{' '}
              <a className="underline terminal-accent" href={bookingInfo.htmlLink} target="_blank" rel="noreferrer">
                {bookingInfo.htmlLink}
              </a>
            </p>
          )}
          <div className="mt-6 flex items-center justify-center gap-3">
            <a
              href="/"
              className="terminal-button px-4 py-2 text-sm"
              onClick={(e) => {
                e.preventDefault();
                setStep('landing');
              }}
            >
              Book another
            </a>
            <button className="terminal-button px-4 py-2 text-sm" onClick={() => window.print()}>
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
            <div className="text-sm">Event Log</div>
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

    </div>
  );
}
