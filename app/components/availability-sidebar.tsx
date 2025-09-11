'use client';

import React, { useState, useMemo } from 'react';

type Slot = { start_time: string; scheduling_url: string | null };

interface AvailabilitySidebarProps {
  slots: Slot[];
  loadingSlots: boolean;
  selectedSlot: { start_time: string } | null;
  onSlotSelect: (slot: { start_time: string }) => void;
  onBook: () => void;
  booking: boolean;
  errors: string | null;
  duration: number;
}

interface DayGroup {
  date: string;
  dayName: string;
  slots: Slot[];
}

export function AvailabilitySidebar({
  slots,
  loadingSlots,
  selectedSlot,
  onSlotSelect,
  onBook,
  booking,
  errors,
  duration
}: AvailabilitySidebarProps) {
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  // Group slots by day
  const dayGroups = useMemo((): DayGroup[] => {
    const groups = new Map<string, DayGroup>();

    slots.forEach((slot) => {
      const date = new Date(slot.start_time);
      const dateKey = date.toDateString();
      const dayName = date.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'short', 
        day: 'numeric' 
      });

      if (!groups.has(dateKey)) {
        groups.set(dateKey, {
          date: dateKey,
          dayName,
          slots: []
        });
      }

      groups.get(dateKey)!.slots.push(slot);
    });

    // Sort by date
    return Array.from(groups.values()).sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }, [slots]);

  const toggleDay = (dateKey: string) => {
    setExpandedDays(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dateKey)) {
        newSet.delete(dateKey);
      } else {
        newSet.add(dateKey);
      }
      return newSet;
    });
  };

  const formatTime = (startTime: string) => {
    const date = new Date(startTime);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const isToday = (dateKey: string) => {
    const today = new Date().toDateString();
    return dateKey === today;
  };

  const isTomorrow = (dateKey: string) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return dateKey === tomorrow.toDateString();
  };

  const getDayLabel = (dayGroup: DayGroup) => {
    if (isToday(dayGroup.date)) return `Today - ${dayGroup.dayName}`;
    if (isTomorrow(dayGroup.date)) return `Tomorrow - ${dayGroup.dayName}`;
    return dayGroup.dayName;
  };

  return (
    <div className="p-4 terminal-border space-y-4 content-container">
      <div>
        <div className="text-xs uppercase tracking-wide terminal-text mb-3">
          Available Times ({dayGroups.length} days)
        </div>
        
        {loadingSlots && (
          <div className="text-sm terminal-text flex items-center gap-2">
            <div className="animate-spin w-4 h-4 border-2 terminal-border border-t-terminal-green rounded-full"></div>
            Loading times…
          </div>
        )}
        
        {!loadingSlots && !slots.length && (
          <div className="text-sm terminal-text">No open times available.</div>
        )}
        
        {!loadingSlots && dayGroups.length > 0 && (
          <div className="space-y-2">
            {dayGroups.map((dayGroup) => {
              const isExpanded = expandedDays.has(dayGroup.date);
              const hasSelectedSlot = selectedSlot && 
                dayGroup.slots.some(slot => slot.start_time === selectedSlot.start_time);
              
              return (
                <div key={dayGroup.date} className="terminal-border rounded overflow-hidden">
                  <button
                    onClick={() => toggleDay(dayGroup.date)}
                    className={`w-full px-3 py-2 text-left flex items-center justify-between hover:opacity-80 transition-colors ${
                      hasSelectedSlot ? 'terminal-green' : 'terminal-text'
                    }`}
                    style={{ background: hasSelectedSlot ? 'var(--terminal-green)' : 'transparent', color: hasSelectedSlot ? 'var(--terminal-bg)' : 'var(--terminal-text)' }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {getDayLabel(dayGroup)}
                      </span>
                      <span className="text-xs" style={{ color: hasSelectedSlot ? 'var(--terminal-bg)' : 'var(--terminal-text)', opacity: 0.7 }}>
                        ({dayGroup.slots.length} slots)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasSelectedSlot && (
                        <div className="w-2 h-2 rounded-full" style={{ background: hasSelectedSlot ? 'var(--terminal-bg)' : 'var(--terminal-green)' }}></div>
                      )}
                      <svg
                        className={`w-4 h-4 transition-transform ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                        style={{ color: hasSelectedSlot ? 'var(--terminal-bg)' : 'var(--terminal-text)' }}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                  
                  {isExpanded && (
                    <div className="terminal-border" style={{ borderTop: '1px solid var(--terminal-green)', background: 'var(--terminal-bg)' }}>
                      <div className="p-3 grid grid-cols-2 gap-2">
                        {dayGroup.slots.map((slot) => {
                          const isSelected = selectedSlot?.start_time === slot.start_time;
                          return (
                            <button
                              key={slot.start_time}
                              onClick={() => onSlotSelect({ start_time: slot.start_time })}
                              className={`terminal-button px-3 py-2 text-sm text-center transition-colors ${
                                isSelected ? 'terminal-glow' : ''
                              }`}
                              style={{
                                background: isSelected ? 'var(--terminal-green)' : 'var(--terminal-bg)',
                                color: isSelected ? 'var(--terminal-bg)' : 'var(--terminal-green)',
                                border: '1px solid var(--terminal-green)'
                              }}
                            >
                              {formatTime(slot.start_time)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button
          disabled={!selectedSlot || booking}
          onClick={onBook}
          className="w-full mt-4 terminal-button px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {booking ? 'Booking…' : selectedSlot ? 'Confirm & Book' : 'Select a time to continue'}
        </button>

        {errors && (
          <div className="mt-3 p-3 terminal-border rounded" style={{ background: 'var(--terminal-bg)', borderColor: 'var(--terminal-error)' }}>
            <div className="text-sm terminal-error">{errors}</div>
          </div>
        )}
      </div>

    </div>
  );
}
