import { useEffect, useRef } from 'react';
import type { Candidate } from '../types';
import { drawRunner, type RunnerMood } from '../race/characters';

/** Sequência de animações mostrada na prévia do painel. */
const SHOWCASE: Array<{ mood: RunnerMood; seconds: number; label: string }> = [
  { mood: 'run', seconds: 2.4, label: 'CORRENDO' },
  { mood: 'boost', seconds: 1.8, label: 'TURBO' },
  { mood: 'stumble', seconds: 1.4, label: 'TROPEÇO' },
  { mood: 'sprint', seconds: 1.8, label: 'RETA FINAL' },
  { mood: 'victory', seconds: 1.8, label: 'VITÓRIA' },
  { mood: 'defeat', seconds: 1.6, label: 'DERROTA' },
  { mood: 'ready', seconds: 1.4, label: 'LARGADA' }
];

/** Prévia animada do corredor, com o mesmo desenho usado no overlay. */
export function RunnerPreview({ candidate }: { candidate: Candidate; faceUrl?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const total = SHOWCASE.reduce((sum, step) => sum + step.seconds, 0);
    let frame = 0, phase = 0, last = performance.now(), time = 0, shownLabel = '';
    const render = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth || 180, height = canvas.clientHeight || 214;
      if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      let cursor = time % total, step = SHOWCASE[0];
      for (const item of SHOWCASE) { if (cursor < item.seconds) { step = item; break; } cursor -= item.seconds; }
      if (step.label !== shownLabel && labelRef.current) { labelRef.current.textContent = step.label; shownLabel = step.label; }
      const rate = step.mood === 'boost' ? 3.1 : step.mood === 'sprint' ? 2.6 : step.mood === 'run' ? 2.15 : 0;
      phase += dt * rate * Math.PI * 2;

      // pista curta sob o corredor
      ctx.fillStyle = '#cf5233';
      ctx.fillRect(0, height * 0.86, width, height * 0.14);
      ctx.fillStyle = '#f7f1ea';
      ctx.fillRect(0, height * 0.86, width, 2);
      ctx.fillStyle = 'rgba(40,8,0,.35)';
      ctx.beginPath();
      ctx.ellipse(width / 2, height * 0.9, height * 0.17, height * 0.03, 0, 0, Math.PI * 2);
      ctx.fill();
      drawRunner(ctx, candidate, width / 2 - height * 0.06, height * 0.9, { size: height * 0.8, mood: step.mood, phase, time });
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [candidate]);

  return <div className={`runner-preview ${candidate}`}>
    <canvas ref={canvasRef} />
    <span ref={labelRef} className="runner-preview-label" />
  </div>;
}
