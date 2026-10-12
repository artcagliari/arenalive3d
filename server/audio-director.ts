import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ArenaConfig, AudioAsset, AudioCue, AudioTrigger, Candidate, GameEffect } from '../src/types.js';
import type { Store } from './store.js';

const catchphraseCategories = new Set(['lula_catchphrase', 'bolsonaro_catchphrase', 'satire_meme']);

export class AudioDirector extends EventEmitter {
  private lastPlayed = new Map<string, number>();
  private recentIds: string[] = [];
  private sequence = new Map<string, number>();
  private lastCatchphraseAt = 0;
  private lastCatchphrasePriority=0;
  private impacts: number[] = [];

  constructor(private store: Store, private getConfig: () => ArenaConfig, private random: () => number = Math.random) { super(); }

  trigger(trigger: AudioTrigger, candidate: Candidate | null = null, priorityOverride?: number): AudioCue | null {
    const config = this.getConfig();
    if (config.audioSafeMode || !config.soundEnabled) return null;
    const now = Date.now();
    // playableAudioAssets ignora vagas de bordão sem arquivo e arquivos ausentes.
    let assets = this.store.playableAudioAssets().filter(asset => asset.trigger === trigger && (!asset.candidate || asset.candidate === candidate));
    assets = assets.filter(asset => this.allowedInMode(asset, config.audioMode));
    assets = assets.filter(asset => now - (this.lastPlayed.get(asset.id) ?? 0) >= asset.maxFrequencySec * 1000);
    if (catchphraseCategories.size && now - this.lastCatchphraseAt < config.minCatchphraseIntervalSec * 1000) {
      // Dentro do intervalo, um bordão só passa se puder substituir o atual
      // por prioridade igual ou maior. Os de menor prioridade são descartados.
      assets=assets.filter(asset=>!catchphraseCategories.has(asset.category)||asset.priority>=this.lastCatchphrasePriority);
    }
    const withoutRecent = assets.filter(asset => !this.recentIds.includes(asset.id));
    if (withoutRecent.length) assets = withoutRecent;
    if (!assets.length) return null;

    const sequenceMode = assets.some(asset => asset.playMode === 'sequential');
    const sequenceKey = `${trigger}:${candidate ?? 'all'}`;
    const index = sequenceMode ? (this.sequence.get(sequenceKey) ?? 0) % assets.length : Math.floor(this.random() * assets.length);
    const asset = assets[index];
    if (sequenceMode) this.sequence.set(sequenceKey, index + 1);
    this.lastPlayed.set(asset.id, now);
    this.recentIds = [asset.id, ...this.recentIds.filter(id => id !== asset.id)].slice(0, 3);
    if(catchphraseCategories.has(asset.category)){this.lastCatchphraseAt=now;this.lastCatchphrasePriority=asset.priority}

    const cue = this.toCue(asset, candidate, priorityOverride);
    this.emit('cue', cue);
    return cue;
  }

  test(assetId: string): AudioCue | null {
    const asset = this.store.audioAsset(assetId);
    if (!asset || asset.pending || asset.fileMissing) return null;
    if (this.getConfig().audioSafeMode) return null;
    const cue = this.toCue(asset, asset.candidate, 110);
    this.emit('cue', cue);
    return cue;
  }

  recordGameEffect(effect: GameEffect) {
    const mapping: Partial<Record<GameEffect['kind'], AudioTrigger>> = {
      impact:'impact', special:'special', shield:'defense', dodge:'dodge', crowd:'combo',
      boost:'boost', turbo:'special', stumble:'stumble', overtake:'overtake'
    };
    const trigger = mapping[effect.kind];
    if (trigger) this.trigger(trigger, effect.candidate ?? null);
    if (effect.kind === 'impact' || effect.kind === 'special' || effect.kind === 'turbo') {
      const now = Date.now();
      this.impacts = [...this.impacts.filter(at => now - at < 4_000), now];
      if (this.impacts.length >= 3) {
        this.impacts = [];
        this.trigger('combo', effect.candidate ?? null, 65);
      }
    }
  }

  private toCue(asset: AudioAsset, candidate: Candidate | null, priorityOverride?: number): AudioCue {
    return {
      id:randomUUID(), assetId:asset.id, name:asset.name, category:asset.category, trigger:asset.trigger,
      candidate:candidate ?? asset.candidate, sourceType:asset.sourceType,
      url:asset.sourceType === 'upload' ? `/api/audio/files/${asset.id}` : null,
      synthPreset:asset.synthPreset, volume:asset.volume, isSatire:asset.isSatire,
      animation:asset.animation, priority:priorityOverride ?? asset.priority, queuedAt:new Date().toISOString()
    };
  }

  private allowedInMode(asset: AudioAsset, mode: ArenaConfig['audioMode']): boolean {
    if (mode === 'arena') return true;
    if (mode === 'discreet') return ['hit','defense','alert','result'].includes(asset.category);
    return asset.category !== 'crowd' || asset.trigger === 'combo';
  }
}
