import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ArenaState, AudioCue, OverlayTelemetry, PublicEvent } from '../types';

export function useArena() {
  const [state, setState] = useState<ArenaState | null>(null);
  const [connected, setConnected] = useState(false);
  const [pulseEvent, setPulseEvent] = useState<PublicEvent | null>(null);
  const [audioCue, setAudioCue] = useState<AudioCue | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io({ reconnection: true, reconnectionDelay: 700, reconnectionDelayMax: 7_000, randomizationFactor: 0.4 });
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('arena:state', (next: ArenaState) => setState(next));
    socket.on('arena:event', (event: PublicEvent) => setPulseEvent(event));
    socket.on('arena:audio', (cue: AudioCue) => setAudioCue(cue));
    fetch('/api/state').then(response => response.json()).then(setState).catch(() => undefined);
    return () => { socket.disconnect(); };
  }, []);

  const sendTelemetry = useCallback((telemetry:Omit<OverlayTelemetry,'reportedAt'>) => {
    socketRef.current?.emit('arena:telemetry', telemetry);
  }, []);

  return { state, connected, pulseEvent, audioCue, sendTelemetry };
}

export function useCountdown(endsAt: string | null | undefined, serverNow?: string) {
  const offset = serverNow ? Date.parse(serverNow) - Date.now() : 0;
  const calculate = () => endsAt ? Math.max(0, Math.ceil((Date.parse(endsAt) - (Date.now() + offset)) / 1000)) : 0;
  const [seconds, setSeconds] = useState(calculate);
  useEffect(() => {
    setSeconds(calculate());
    const timer = window.setInterval(() => setSeconds(calculate()), 250);
    return () => window.clearInterval(timer);
  }, [endsAt, offset]);
  return seconds;
}
