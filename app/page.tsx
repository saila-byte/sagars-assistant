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


type Slot = { start_time: string; scheduling_url: string | null };

type ToolCallMsg = {
  type?: string;
  event_type?: string;
  message_type?: string;
  tool_call_id?: string;
  tool?: { name?: string; arguments?: string | Record<string, unknown> };
  name?: string;
  arguments?: unknown;
};

type ToolResult =
  | { ok: true; start_time?: string; htmlLink?: string; hangoutLink?: string }
  | { ok: false; error: string };

function sendToolResultToTavus(conversationUrl: string | null, tool_call_id: string | undefined, result: ToolResult): void {
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

function safeStringify(v: unknown): string {
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
  const [avReady, setAvReady] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  // Tool-call / debug state
  const [toolError, setToolError] = useState<string | null>(null);
  const [bookingInfo, setBookingInfo] = useState<{ htmlLink?: string; hangoutLink?: string } | null>(null);
  const inFlightToolCalls = useRef<Set<string>>(new Set());

  // Debug panel state
  const [debugOpen, setDebugOpen] = useState(false);
  const [logs, setLogs] = useState<{ ts: number; origin: string; kind: 'message' | 'info' | 'error'; note?: string; data?: unknown }[]>([]);
  const [filterToolCalls, setFilterToolCalls] = useState(true);

  const pushLog = useCallback((entry: { ts: number; origin: string; kind: 'message' | 'info' | 'error'; note?: string; data?: unknown }) => {
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
  const handleTavusToolCall = useCallback(async (toolCall: Record<string, unknown>, conversationId: string) => {
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
        // @ts-expect-error - srcObject is a valid property for video elements
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      const audioCtx = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
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

  // -------- Slot selection handler --------
  function handleSlotSelect(slot: { start_time: string }) {
    setSelectedSlot(slot);
  }

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
    } catch (e: unknown) {
      const msg = (e as Error)?.message || 'Could not book this time.';
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
        let args: Record<string, unknown>;
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
        if ((msg as { tool_call_id?: string })?.tool_call_id) inFlightToolCalls.current.delete((msg as { tool_call_id: string }).tool_call_id);
      }
    },
    [conversationUrl, duration, email, timezone]
  );

  // OLD postMessage implementation - replaced with Tavus hooks above
  // Keeping this commented out for reference
  /*
  useEffect(() => {
    function handleAppMessage(event: MessageEvent) {
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
    async function handleToolCallFromAppMessage(toolCall: Record<string, unknown>, conversationId: string) {
      
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
    <div className="min-h-screen" style={{ color: 'var(--terminal-text)' }}>

      {step === 'landing' && (
        <div className="max-w-7xl mx-auto px-2 py-10 flex flex-col items-center">
          <div className="mb-6 w-full">
            <div className="flex items-start gap-3 mb-4 -ml-1 sm:-ml-2 md:-ml-4 lg:-ml-6 xl:-ml-8">
              <img src="/tavus-logo.svg" alt="Tavus" className="h-5 sm:h-6 md:h-7 lg:h-8 w-auto" />
            </div>
            <div className="text-center">
              <h2 className="text-4xl mb-2" style={{ color: 'black' }}>Meet AI Hudson</h2>
              <p className="text-sm terminal-text">
                I&apos;m Hassaan&apos;s assistant. Let&apos;s chat and get you a meeting booked in with him.
              </p>
            </div>
          </div>

          <div className="w-full max-w-4xl">
            {/* Video Container with Overlay Form */}
            <div 
              className="aspect-video overflow-hidden relative"
              style={{
                '--plyr-color-main': 'white',
                '--plyr-tab-focus-color': 'transparent',
                '--plyr-video-control-color-hover': 'black',
                '--plyr-control-icon-size': '1.5em',
                '--plyr-range-thumb-height': '0px',
                '--plyr-range-track-height': '0.6em',
                '--themes--background': 'var(--primatives--pc-plastic-1)',
                '--_typography---primary-font-family': '"Suisse Intl",Arial,sans-serif',
                '--themes--text': 'var(--primatives--terminal-black)',
                '--_typography---secondary-font-family': 'Perfectlynineties,Georgia,sans-serif',
                '--primatives--pc-plastic-3': '#b9ae9c',
                '--primatives--static-white': 'white',
                '--primatives--pc-plastic-2': '#e3dcd1',
                '--primatives--bubbletech-4': '#ff6183',
                '--primatives--pc-plastic-1': '#f3eee7',
                '--primatives--terminal-black': '#140206',
                '--themes--border': 'var(--primatives--terminal-black)',
                '--themes--foreground': 'var(--primatives--static-white)',
                fontFamily: 'var(--_typography---primary-font-family)',
                color: 'var(--themes--text)',
                fontSize: '1rem',
                lineHeight: '1.5',
                WebkitFontSmoothing: 'antialiased',
                textRendering: 'optimizeLegibility',
                boxSizing: 'border-box',
                border: '1px solid var(--themes--border)',
                backgroundColor: 'var(--primatives--pc-plastic-2)',
                flexFlow: 'column',
                width: '100%',
                paddingBottom: '.18vw',
                display: 'flex',
                position: 'relative',
                boxShadow: '3.94px 5.91px #000',
                paddingLeft: '3px',
                paddingRight: '3px'
              } as React.CSSProperties}
            >
              <video
                className="w-full h-full object-cover"
                autoPlay
                loop
                muted
                playsInline
              >
                <source src="https://cdn.replica.tavus.io/20426/12dfe205.mp4" type="video/mp4" />
                Your browser does not support the video tag.
              </video>
              
              {/* Form overlay on video */}
              <div className="absolute inset-0 flex items-end justify-center pb-16">
                <div className="p-4 rounded-lg w-64 max-w-full mx-4" style={{ fontFamily: 'var(--default-font-family)' }}>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs mb-2 text-white font-semibold drop-shadow-lg" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 'var(--text-xs)', lineHeight: 'var(--text-xs--line-height)', opacity: 0.8 }}>Email</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@company.com"
                        className="w-full px-2 py-1 text-white placeholder-white placeholder-opacity-70 focus:ring-2 focus:ring-white focus:ring-opacity-50 focus:border-transparent"
                        style={{ 
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 'var(--text-xs)', 
                          lineHeight: 'var(--text-xs--line-height)',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          opacity: 0.8,
                          transition: 'var(--default-transition-duration) var(--default-transition-timing-function)'
                        }}
                      />
                        {remembered && !email && (
                          <div className="button-wrapper mt-1">
                            <button onClick={() => setEmail(remembered)} className="button" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 'var(--text-xs)', lineHeight: 'var(--text-xs--line-height)', opacity: 0.8 }}>
                              <div className="btn_text">Use last email: {remembered}</div>
                              <div className="btn_texture"></div>
                            </button>
                          </div>
                        )}
                    </div>

                    <div>
                      <label className="block text-xs mb-2 text-white font-semibold drop-shadow-lg" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 'var(--text-xs)', lineHeight: 'var(--text-xs--line-height)', opacity: 0.8 }}>Timezone</label>
                      <select
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        className="w-full px-2 py-1 text-white focus:ring-2 focus:ring-white focus:ring-opacity-50 focus:border-transparent"
                        style={{ 
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 'var(--text-xs)', 
                          lineHeight: 'var(--text-xs--line-height)',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          opacity: 0.8,
                          transition: 'var(--default-transition-duration) var(--default-transition-timing-function)'
                        }}
                      >
                        {TIMEZONE_OPTIONS.map((tz) => (
                          <option key={tz.value} value={tz.value} className="text-black">
                            {tz.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {errors && <div className="text-sm text-red-200 drop-shadow-lg">{errors}</div>}

                      <div className="button-wrapper w-full">
                        <button
                          onClick={handleStart}
                          className="button w-full"
                          style={{ 
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 'var(--text-xs)', 
                            lineHeight: 'var(--text-xs--line-height)',
                            opacity: 0.8
                          }}
                        >
                          <div className="btn_text">Continue</div>
                          <div className="btn_texture"></div>
                        </button>
                      </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {step === 'haircheck' && (
        <div className="min-h-screen terminal-scanlines" style={{ background: 'rgba(255, 255, 255, 0.1)', color: 'var(--terminal-text)' }}>
          <div className="max-w-7xl mx-auto px-2 py-10 flex flex-col items-center">
          <div className="mb-6 w-full">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-3 -ml-1 sm:-ml-2 md:-ml-4 lg:-ml-6 xl:-ml-8">
                <img src="/tavus-logo.svg" alt="Tavus" className="h-5 sm:h-6 md:h-7 lg:h-8 w-auto" />
              </div>
              <div></div>
            </div>
            <div className="text-center mt-4">
              <h2 className="text-4xl mb-2" style={{ color: 'black' }}>Meet AI Hudson</h2>
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
          </div>

          <div className="w-full max-w-4xl">
            <div 
              className="aspect-video overflow-hidden relative"
              style={{
                '--plyr-color-main': 'white',
                '--plyr-tab-focus-color': 'transparent',
                '--plyr-video-control-color-hover': 'black',
                '--plyr-control-icon-size': '1.5em',
                '--plyr-range-thumb-height': '0px',
                '--plyr-range-track-height': '0.6em',
                '--themes--background': 'var(--primatives--pc-plastic-1)',
                '--_typography---primary-font-family': '"Suisse Intl",Arial,sans-serif',
                '--themes--text': 'var(--primatives--terminal-black)',
                '--_typography---secondary-font-family': 'Perfectlynineties,Georgia,sans-serif',
                '--primatives--pc-plastic-3': '#b9ae9c',
                '--primatives--static-white': 'white',
                '--primatives--pc-plastic-2': '#e3dcd1',
                '--primatives--bubbletech-4': '#ff6183',
                '--primatives--pc-plastic-1': '#f3eee7',
                '--primatives--terminal-black': '#140206',
                '--themes--border': 'var(--primatives--terminal-black)',
                '--themes--foreground': 'var(--primatives--static-white)',
                fontFamily: 'var(--_typography---primary-font-family)',
                color: 'var(--themes--text)',
                fontSize: '1rem',
                lineHeight: '1.5',
                WebkitFontSmoothing: 'antialiased',
                textRendering: 'optimizeLegibility',
                boxSizing: 'border-box',
                border: '1px solid var(--themes--border)',
                backgroundColor: 'var(--primatives--pc-plastic-2)',
                flexFlow: 'column',
                width: '100%',
                paddingBottom: '.18vw',
                display: 'flex',
                position: 'relative',
                boxShadow: '3.94px 5.91px #000',
                paddingLeft: '3px',
                paddingRight: '3px'
              } as React.CSSProperties}
            >
              <video ref={videoRef} className="w-full h-full object-cover" muted style={{ transform: 'scaleX(-1)' }} />
              
              {!mediaStream ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin w-8 h-8 border-4 terminal-border border-t-terminal-green rounded-full mx-auto mb-4"></div>
                    <p className="text-sm terminal-text">Requesting camera & microphone access...</p>
                    {errors && (
                      <div className="mt-4">
                        <div className="button-wrapper">
                          <button onClick={requestAV} className="button">
                            <div className="btn_text">Try Again</div>
                            <div className="btn_texture"></div>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-end justify-center pb-16">
                  <div className="button-wrapper">
                    <button 
                      onClick={goToCall} 
                      disabled={conversationPreparing}
                      className="button disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <div className="btn_text">
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
                      </div>
                      <div className="btn_texture"></div>
                    </button>
                  </div>
                </div>
              )}
            </div>
            {errors && <div className="mt-3 text-sm terminal-error text-center">{errors}</div>}
          </div>
          </div>
        </div>
      )}

      {step === 'call' && (
        <div className="min-h-screen terminal-scanlines" style={{ background: 'rgba(255, 255, 255, 0.1)', color: 'var(--terminal-text)' }}>
          <div className="max-w-7xl mx-auto px-2 py-10 flex flex-col items-center">
          <div className="mb-6 w-full">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-3 -ml-1 sm:-ml-2 md:-ml-4 lg:-ml-6 xl:-ml-8">
                <img src="/tavus-logo.svg" alt="Tavus" className="h-5 sm:h-6 md:h-7 lg:h-8 w-auto" />
              </div>
              <div></div>
            </div>
            <div className="text-center mt-4">
              <h2 className="text-4xl mb-2" style={{ color: 'black' }}>Scheduling Call</h2>
              <p className="text-sm terminal-text">Book your meeting with AI Hudson</p>
            </div>
          </div>

          <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-3">
              {conversationUrl ? (
                <div 
                  className="aspect-video overflow-hidden relative"
                  style={{
                    '--plyr-color-main': 'white',
                    '--plyr-tab-focus-color': 'transparent',
                    '--plyr-video-control-color-hover': 'black',
                    '--plyr-control-icon-size': '1.5em',
                    '--plyr-range-thumb-height': '0px',
                    '--plyr-range-track-height': '0.6em',
                    '--themes--background': 'var(--primatives--pc-plastic-1)',
                    '--_typography---primary-font-family': '"Suisse Intl",Arial,sans-serif',
                    '--themes--text': 'var(--primatives--terminal-black)',
                    '--_typography---secondary-font-family': 'Perfectlynineties,Georgia,sans-serif',
                    '--primatives--pc-plastic-3': '#b9ae9c',
                    '--primatives--static-white': 'white',
                    '--primatives--pc-plastic-2': '#e3dcd1',
                    '--primatives--bubbletech-4': '#ff6183',
                    '--primatives--pc-plastic-1': '#f3eee7',
                    '--primatives--terminal-black': '#140206',
                    '--themes--border': 'var(--primatives--terminal-black)',
                    '--themes--foreground': 'var(--primatives--static-white)',
                    fontFamily: 'var(--_typography---primary-font-family)',
                    color: 'var(--themes--text)',
                    fontSize: '1rem',
                    lineHeight: '1.5',
                    WebkitFontSmoothing: 'antialiased',
                    textRendering: 'optimizeLegibility',
                    boxSizing: 'border-box',
                    border: '1px solid var(--themes--border)',
                    backgroundColor: '#f3eee7',
                    flexFlow: 'column',
                    width: '100%',
                    paddingBottom: '.18vw',
                    display: 'flex',
                    position: 'relative',
                    boxShadow: '3.94px 5.91px #000',
                    paddingLeft: '3px',
                    paddingRight: '3px'
                  } as React.CSSProperties}
                >
                  <Conversation conversationUrl={conversationUrl} onLeave={() => setStep('landing')} />
                </div>
              ) : (
                <div 
                  className="aspect-video overflow-hidden relative bg-black/5 flex items-center justify-center"
                  style={{
                    '--plyr-color-main': 'white',
                    '--plyr-tab-focus-color': 'transparent',
                    '--plyr-video-control-color-hover': 'black',
                    '--plyr-control-icon-size': '1.5em',
                    '--plyr-range-thumb-height': '0px',
                    '--plyr-range-track-height': '0.6em',
                    '--themes--background': 'var(--primatives--pc-plastic-1)',
                    '--_typography---primary-font-family': '"Suisse Intl",Arial,sans-serif',
                    '--themes--text': 'var(--primatives--terminal-black)',
                    '--_typography---secondary-font-family': 'Perfectlynineties,Georgia,sans-serif',
                    '--primatives--pc-plastic-3': '#b9ae9c',
                    '--primatives--static-white': 'white',
                    '--primatives--pc-plastic-2': '#e3dcd1',
                    '--primatives--bubbletech-4': '#ff6183',
                    '--primatives--pc-plastic-1': '#f3eee7',
                    '--primatives--terminal-black': '#140206',
                    '--themes--border': 'var(--primatives--terminal-black)',
                    '--themes--foreground': 'var(--primatives--static-white)',
                    fontFamily: 'var(--_typography---primary-font-family)',
                    color: 'var(--themes--text)',
                    fontSize: '1rem',
                    lineHeight: '1.5',
                    WebkitFontSmoothing: 'antialiased',
                    textRendering: 'optimizeLegibility',
                    boxSizing: 'border-box',
                    border: '1px solid var(--themes--border)',
                    backgroundColor: '#f3eee7',
                    flexFlow: 'column',
                    width: '100%',
                    paddingBottom: '.18vw',
                    display: 'flex',
                    position: 'relative',
                    boxShadow: '3.94px 5.91px #000',
                    paddingLeft: '3px',
                    paddingRight: '3px'
                  } as React.CSSProperties}
                >
                  <div className="text-center">
                    <div className="text-6xl mb-3">🎥</div>
                    <div>Loading assistant…</div>
                    <div className="text-sm text-zinc-600">Please wait a moment.</div>
                  </div>
                </div>
              )}
              {toolError && <div className="mt-3 text-sm text-red-600 text-center">{toolError}</div>}
            </div>
            
            <div className="lg:col-span-1">
              <div 
                className="h-full overflow-hidden relative mt-3"
                style={{
                  '--plyr-color-main': 'white',
                  '--plyr-tab-focus-color': 'transparent',
                  '--plyr-video-control-color-hover': 'black',
                  '--plyr-control-icon-size': '1.5em',
                  '--plyr-range-thumb-height': '0px',
                  '--plyr-range-track-height': '0.6em',
                  '--themes--background': 'var(--primatives--pc-plastic-1)',
                  '--_typography---primary-font-family': '"Suisse Intl",Arial,sans-serif',
                  '--themes--text': 'var(--primatives--terminal-black)',
                  '--_typography---secondary-font-family': 'Perfectlynineties,Georgia,sans-serif',
                  '--primatives--pc-plastic-3': '#b9ae9c',
                  '--primatives--static-white': 'white',
                  '--primatives--pc-plastic-2': '#e3dcd1',
                  '--primatives--bubbletech-4': '#ff6183',
                  '--primatives--pc-plastic-1': '#f3eee7',
                  '--primatives--terminal-black': '#140206',
                  '--themes--border': 'var(--primatives--terminal-black)',
                  '--themes--foreground': 'var(--primatives--static-white)',
                  fontFamily: 'var(--_typography---primary-font-family)',
                  color: 'var(--themes--text)',
                  fontSize: '1rem',
                  lineHeight: '1.5',
                  WebkitFontSmoothing: 'antialiased',
                  textRendering: 'optimizeLegibility',
                  boxSizing: 'border-box',
                  border: 'none',
                  backgroundColor: '#f3eee7',
                  flexFlow: 'column',
                  width: '100%',
                  display: 'flex',
                  position: 'relative',
                  paddingLeft: '3px',
                  paddingRight: '3px'
                } as React.CSSProperties}
              >
                <AvailabilitySidebar 
                  slots={slots} 
                  loadingSlots={loadingSlots}
                  selectedSlot={selectedSlot}
                  onSlotSelect={handleSlotSelect}
                  onBook={() => confirmAndBook({ 
                    email, 
                    start_time: selectedSlot?.start_time, 
                    duration: 30, 
                    timezone 
                  })}
                  booking={booking}
                  errors={toolError}
                  duration={30}
                />
              </div>
            </div>
          </div>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="min-h-screen terminal-scanlines" style={{ background: 'rgba(255, 255, 255, 0.1)', color: 'var(--terminal-text)' }}>
          <div className="max-w-7xl mx-auto px-2 py-10 flex flex-col items-center">
          <div className="mb-6 w-full">
            <div className="flex items-start gap-3 mb-4 -ml-1 sm:-ml-2 md:-ml-4 lg:-ml-6 xl:-ml-8">
              <img src="/tavus-logo.svg" alt="Tavus" className="h-5 sm:h-6 md:h-7 lg:h-8 w-auto" />
            </div>
            <div className="text-center">
              <div className="text-7xl mb-4">✅</div>
              <h2 className="text-4xl mb-2" style={{ color: 'black' }}>You&apos;re all set!</h2>
              <p className="terminal-text">
                We&apos;ve scheduled your {duration}-minute meeting with Hassaan. A confirmation
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
                <div className="button-wrapper">
                  <button
                    className="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setStep('landing');
                    }}
                  >
                    <div className="btn_text">Book another</div>
                    <div className="btn_texture"></div>
                  </button>
                </div>
                <div className="button-wrapper">
                  <button className="button" onClick={() => window.print()}>
                    <div className="btn_text">Print</div>
                    <div className="btn_texture"></div>
                  </button>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>
      )}


    </div>
  );
}
