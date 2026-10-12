import type { Candidate, FighterAction, GameCompetitor, GameEffect, GameMode, GameModeSetting, GameState, RaceItemId } from '../src/types.js';

const noItems = (): Record<RaceItemId, number> => ({ impulso:0, arrancada:0, turbo:0, escudo:0, tropeco:0 });

const competitor = (side: -1 | 1): GameCompetitor => ({
  x: side * 1.85,
  z: side * 0.12,
  energy: 100,
  stamina: 40,
  action: 'idle',
  actionSequence: 0,
  raceProgress: 0,
  speed: 0,
  lane: side * 0.55,
  boost: 0,
  shield: 0,
  position: side < 0 ? 1 : 2,
  items: noItems()
});

/** A corrida é o modo principal; a batalha permanece como modo secundário opcional. */
export function modeForRound(setting: GameModeSetting, roundNumber: number): GameMode {
  if (setting !== 'alternate') return setting;
  return roundNumber % 2 === 1 ? 'race' : 'battle';
}

/** Duração de referência de uma corrida limpa, sem tropeços nem impulsos. */
const RACE_DEFAULTS = { distanceM: 400, eventFrequency: 3, durationSec: 120 };

export class GameSimulation {
  private state: GameState;
  private decisionIn = { lula: 0, bolsonaro: 0 };
  private actionIn = { lula: 0, bolsonaro: 0 };
  private cameraIn = 3;
  private targetSpeed = { lula: 0.0105, bolsonaro: 0.0105 };
  private effectSequence = 0;

  private eventIn = { lula: 0, bolsonaro: 0 };
  /** Segundos em que o impulso de um presente se mantém sem perder força. */
  private boostHold = { lula: 0, bolsonaro: 0 };
  private raceEventFrequency = RACE_DEFAULTS.eventFrequency;
  private baseSpeed = 1 / RACE_DEFAULTS.durationSec;

  constructor(saved?: GameState, private random: () => number = Math.random) {
    this.state = saved ?? {
      mode: 'race', active: false, winner: null,
      lula: competitor(-1), bolsonaro: competitor(1),
      roundWins: { lula: 0, bolsonaro: 0 }, effect: null, cameraShot: 0, simulationTick: 0,
      raceDistanceM: RACE_DEFAULTS.distanceM, raceElapsedSec:0, raceDurationSec:RACE_DEFAULTS.durationSec,
      finalSprint: false, lastOvertakeBy: null
    };
    this.state.raceDistanceM ??= RACE_DEFAULTS.distanceM;
    this.state.raceElapsedSec ??= 0;
    this.state.raceDurationSec ??= RACE_DEFAULTS.durationSec;
    this.state.finalSprint ??= false;
    this.state.lastOvertakeBy ??= null;
    for (const candidate of ['lula', 'bolsonaro'] as Candidate[]) {
      const player = this.state[candidate];
      player.shield ??= 0;
      player.position ??= candidate === 'lula' ? 1 : 2;
      player.items = { ...noItems(), ...(player.items ?? {}) };
    }
    this.effectSequence = saved?.effect?.id ?? saved?.simulationTick ?? 0;
  }

  getState(): GameState { return structuredClone(this.state); }

  /** Restaura a velocidade coerente depois de reiniciar o processo no meio da corrida. */
  setRaceDuration(durationSec:number) {
    const duration=Math.min(3_600,Math.max(1,durationSec));
    this.state.raceDurationSec=duration;
    this.baseSpeed=1/duration;
  }

  reset(setting: GameModeSetting, roundNumber: number, race: { distanceM?: number; eventFrequency?: number; durationSec?: number } = {}) {
    const wins = this.state.roundWins;
    const mode = modeForRound(setting, roundNumber);
    this.raceEventFrequency = Math.min(5, Math.max(1, race.eventFrequency ?? this.raceEventFrequency));
    const duration = Math.min(3_600, Math.max(1, race.durationSec ?? RACE_DEFAULTS.durationSec));
    this.baseSpeed = 1 / duration;
    this.boostHold = { lula: 0, bolsonaro: 0 };
    this.state = {
      mode, active: false, winner: null, lula: competitor(-1), bolsonaro: competitor(1),
      roundWins: wins, effect: null, cameraShot: 0, simulationTick: this.state.simulationTick + 1,
      raceDistanceM: Math.round(race.distanceM ?? this.state.raceDistanceM ?? RACE_DEFAULTS.distanceM),
      raceElapsedSec:0, raceDurationSec:duration,
      finalSprint: false, lastOvertakeBy: null
    };
    this.decisionIn = { lula: 0.2, bolsonaro: 0.2 };
    this.actionIn = { lula: 0, bolsonaro: 0 };
    this.targetSpeed = { lula: this.baseSpeed, bolsonaro: this.baseSpeed };
    this.eventIn = { lula: 4, bolsonaro: 6.5 };
    this.cameraIn = 2.5;
  }

  start() { if (!this.state.winner) this.state.active = true; }
  pause() { this.state.active = false; }
  resume() { if (!this.state.winner) this.state.active = true; }

  resetWins() { this.state.roundWins = { lula: 0, bolsonaro: 0 }; }

  tick(deltaSec: number, difficulty: number): boolean {
    if (!this.state.active || this.state.winner) return false;
    const dt = Math.min(Math.max(deltaSec, 0), 0.25);
    this.state.simulationTick += 1;
    this.cameraIn -= dt;
    if (this.cameraIn <= 0) {
      this.state.cameraShot = (this.state.cameraShot + 1 + Math.floor(this.random() * 2)) % 5;
      this.cameraIn = 3.5 + this.random() * 3;
    }
    if (this.state.mode === 'battle') this.tickBattle(dt, difficulty);
    else this.tickRace(dt, difficulty);
    return true;
  }

  interaction(candidate: Candidate | null, type: 'comment' | 'gift' | 'like', points = 1) {
    if (!this.state.active) return;
    if (type === 'like') {
      this.effect('crowd', undefined, Math.min(2, 0.5 + points / 100));
      return;
    }
    if (!candidate) return;
    const player = this.state[candidate];
    if (this.state.mode === 'race') {
      // Comentário = impulso; presente = turbo. Nada é inventado: só acontece com evento real.
      if (type === 'comment') this.raceItem(candidate, 'impulso', Math.min(2.5, 0.8 + points / 12));
      else this.raceItem(candidate, 'turbo', Math.min(2.2, 1 + points / 60));
      return;
    }
    if (type === 'comment') {
      player.stamina = Math.min(100, player.stamina + 7);
      this.setAction(candidate, 'block', 0.5);
      this.effect('shield', candidate, 0.75);
    } else {
      player.stamina = 100;
      this.setAction(candidate, 'special', 0.9);
      this.resolveAttack(candidate, true, Math.min(1.7, 1 + points / 100));
    }
  }

  /**
   * Aciona um item da corrida. `tropeco` afeta o próprio candidato informado
   * (quem deve tropeçar) e é anulado por um escudo ativo.
   */
  /**
   * `durationSec` (opcional) define quanto o efeito dura: impulso/arrancada/turbo
   * ficam sem perder força durante esse tempo; escudo dura esse tempo; tropeço
   * mantém o corredor tropeçando por esse tempo.
   */
  raceItem(candidate: Candidate, item: RaceItemId, strength = 1, durationSec?: number): boolean {
    if (this.state.mode !== 'race' || this.state.winner) return false;
    const player = this.state[candidate];
    const scale = Math.min(3, Math.max(0.2, strength));
    const duration = durationSec && durationSec > 0 ? Math.min(30, durationSec) : null;
    if (item === 'tropeco') {
      if (player.shield > 0) {
        player.shield = 0;
        player.items.escudo += 1;
        this.setAction(candidate, 'shielded', 0.7);
        this.effect('shield', candidate, 1.1);
        return false;
      }
      player.boost = 0;
      player.speed *= 0.3;
      player.items.tropeco += 1;
      this.setAction(candidate, 'stumble', duration ?? 0.9 + scale * 0.35);
      this.effect('stumble', candidate, Math.min(1.6, scale));
      return true;
    }
    if (item === 'escudo') {
      player.shield = Math.max(player.shield, duration ?? 7 * scale);
      player.items.escudo += 1;
      this.setAction(candidate, 'shielded', 0.6);
      this.effect('shield', candidate, 0.9);
      return true;
    }
    const gain = item === 'turbo' ? 100 : item === 'arrancada' ? 52 : 18;
    player.boost = Math.min(100, player.boost + gain * scale);
    if (duration) this.boostHold[candidate] = Math.max(this.boostHold[candidate], duration);
    player.items[item] += 1;
    this.setAction(candidate, item === 'impulso' ? 'run' : item === 'arrancada' ? 'sprint' : 'boost', item === 'impulso' ? 0.5 : 1.1);
    this.effect(item === 'turbo' ? 'turbo' : 'boost', candidate, Math.min(1.8, item === 'impulso' ? 0.7 * scale : 1.2 * scale));
    return true;
  }

  /** RECUPERAÇÃO: sai do tropeço, volta ao ritmo e ganha um pequeno impulso. */
  recover(candidate: Candidate, strength = 1, durationSec?: number): boolean {
    if (this.state.mode !== 'race' || this.state.winner) return false;
    const player = this.state[candidate];
    const wasStumbling = player.action === 'stumble';
    player.speed = Math.max(player.speed, this.targetSpeed[candidate]);
    player.boost = Math.min(100, Math.max(player.boost, 30 * Math.min(3, Math.max(0.2, strength))));
    if (durationSec && durationSec > 0) this.boostHold[candidate] = Math.max(this.boostHold[candidate], Math.min(30, durationSec));
    this.setAction(candidate, 'sprint', 0.6);
    this.effect('boost', candidate, 0.9);
    return wasStumbling || true;
  }

  finish(): Candidate | 'tie' {
    if (this.state.winner) return this.state.winner;
    const left = this.state.mode === 'battle' ? this.state.lula.energy : this.state.lula.raceProgress;
    const right = this.state.mode === 'battle' ? this.state.bolsonaro.energy : this.state.bolsonaro.raceProgress;
    const winner: Candidate | 'tie' = Math.abs(left - right) < 0.001 ? 'tie' : left > right ? 'lula' : 'bolsonaro';
    this.declareWinner(winner);
    return winner;
  }

  private tickBattle(dt: number, difficulty: number) {
    const keys: Candidate[] = ['lula', 'bolsonaro'];
    for (const candidate of keys) {
      const player = this.state[candidate];
      player.stamina = Math.min(100, player.stamina + dt * (5 + difficulty * 0.5));
      this.actionIn[candidate] -= dt;
      this.decisionIn[candidate] -= dt;
      if (this.actionIn[candidate] <= 0 && !['hit', 'celebrate'].includes(player.action)) player.action = 'idle';
      this.moveBattle(candidate, dt);
      if (this.decisionIn[candidate] <= 0) this.decideBattle(candidate, difficulty);
    }
    this.resolveFighterSeparation();
    if (this.state.lula.energy <= 0 || this.state.bolsonaro.energy <= 0) {
      const winner = this.state.lula.energy === this.state.bolsonaro.energy ? 'tie' : this.state.lula.energy > 0 ? 'lula' : 'bolsonaro';
      this.declareWinner(winner);
    }
  }

  private resolveFighterSeparation() {
    const minimumDistance = 0.9;
    const left = this.state.lula;
    const right = this.state.bolsonaro;
    if (right.x - left.x >= minimumDistance) return;
    const midpoint = (left.x + right.x) / 2;
    left.x = Math.max(-3.1, midpoint - minimumDistance / 2);
    right.x = Math.min(3.1, midpoint + minimumDistance / 2);
  }

  private moveBattle(candidate: Candidate, dt: number) {
    const player = this.state[candidate];
    const side = candidate === 'lula' ? -1 : 1;
    const opponent = this.state[candidate === 'lula' ? 'bolsonaro' : 'lula'];
    const distance = Math.abs(player.x - opponent.x);
    if (player.action === 'advance' || (player.action === 'attack' && distance > 1.35)) player.x += side * -1 * dt * 0.75;
    if (player.action === 'retreat' || player.action === 'dodge') player.x += side * dt * 0.9;
    player.x = Math.max(-3.1, Math.min(3.1, player.x));
    player.z += (Math.sin((this.state.simulationTick + (side > 0 ? 19 : 0)) * 0.07) * 0.35 - player.z) * dt * 1.5;
  }

  private decideBattle(candidate: Candidate, difficulty: number) {
    const player = this.state[candidate];
    const opponent = this.state[candidate === 'lula' ? 'bolsonaro' : 'lula'];
    const distance = Math.abs(player.x - opponent.x);
    const reaction = Math.min(0.68, 0.2 + difficulty * 0.07);
    if (['attack', 'special'].includes(opponent.action) && this.random() < reaction) {
      const dodge = this.random() < 0.45;
      this.setAction(candidate, dodge ? 'dodge' : 'block', dodge ? 0.6 : 0.75);
      this.effect(dodge ? 'dodge' : 'shield', candidate, 0.7);
    } else if (distance > 2.15) {
      this.setAction(candidate, 'advance', 0.7 + this.random() * 0.5);
    } else if (player.stamina >= 72 && this.random() < 0.18) {
      player.stamina -= 65;
      this.setAction(candidate, 'special', 0.9);
      this.resolveAttack(candidate, true);
    } else if (this.random() < 0.68) {
      player.stamina = Math.max(0, player.stamina - 18);
      this.setAction(candidate, 'attack', 0.58);
      this.resolveAttack(candidate, false);
    } else {
      this.setAction(candidate, this.random() < 0.55 ? 'retreat' : 'block', 0.6);
    }
    this.decisionIn[candidate] = Math.max(0.48, 1.18 - difficulty * 0.07 + this.random() * 0.58);
  }

  private resolveAttack(attacker: Candidate, special: boolean, multiplier = 1) {
    const defender: Candidate = attacker === 'lula' ? 'bolsonaro' : 'lula';
    const source = this.state[attacker];
    const target = this.state[defender];
    const distance = Math.abs(source.x - target.x);
    if (!special && distance > 2.25) return;
    if (target.action === 'dodge' && this.random() < 0.88) { this.effect('dodge', defender, 0.9); return; }
    const base = special ? 5.5 + this.random() * 3.5 : 1.7 + this.random() * 2.4;
    const blocked = target.action === 'block';
    const damage = base * multiplier * (blocked ? 0.28 : 1);
    target.energy = Math.max(0, target.energy - damage);
    if (!blocked) this.setAction(defender, 'hit', 0.34);
    this.effect(special ? 'special' : 'impact', defender, special ? 1.45 : 0.75 + damage / 8);
  }

  private tickRace(dt: number, difficulty: number) {
    this.state.raceElapsedSec = Math.min(this.state.raceDurationSec ?? RACE_DEFAULTS.durationSec, (this.state.raceElapsedSec ?? 0) + dt);
    const keys: Candidate[] = ['lula', 'bolsonaro'];
    const crossings:Partial<Record<Candidate,number>>={};
    // Ambos calculam a decisão a partir do mesmo instante. Sem o snapshot, o
    // segundo corredor do laço reagia à posição já atualizada do primeiro.
    const progressBefore={lula:this.state.lula.raceProgress,bolsonaro:this.state.bolsonaro.raceProgress};
    const leaderBefore = this.raceLeader();
    for (const candidate of keys) {
      const player = this.state[candidate];
      const opponent = this.state[candidate === 'lula' ? 'bolsonaro' : 'lula'];
      this.decisionIn[candidate] -= dt;
      this.actionIn[candidate] -= dt;
      this.eventIn[candidate] -= dt;
      if (player.shield > 0) player.shield = Math.max(0, player.shield - dt);

      if (this.decisionIn[candidate] <= 0) {
        // Oscilação de ritmo + leve efeito elástico, para a corrida nunca ficar monótona.
        const other:Candidate=candidate==='lula'?'bolsonaro':'lula';
        const gap = progressBefore[other] - progressBefore[candidate];
        const catchUp = Math.max(0, gap) * 0.6;
        const comfort = Math.max(0, -gap) * 0.2;
        this.targetSpeed[candidate] = this.baseSpeed * (0.9 + this.random() * 0.22 + catchUp - comfort + difficulty * 0.012);
        this.decisionIn[candidate] = 0.8 + this.random() * 1.4;
      }
      if (this.eventIn[candidate] <= 0) {
        this.autoRaceEvent(candidate);
        this.eventIn[candidate] = this.nextEventDelay();
      }
      if (this.actionIn[candidate] <= 0) {
        player.action = player.boost > 55 ? 'boost' : player.boost > 0 || this.state.finalSprint ? 'sprint' : 'run';
      }

      const boostSpeed = player.boost > 0 ? this.baseSpeed * (0.3 + player.boost / 110) : 0;
      // Durante o tempo de efeito de um presente, o impulso não perde força.
      if (this.boostHold[candidate] > 0) this.boostHold[candidate] = Math.max(0, this.boostHold[candidate] - dt);
      else if (player.boost > 0) player.boost = Math.max(0, player.boost - dt * 24);
      const penalty = player.action === 'stumble' ? 0.3 : 1;
      const sprint = this.state.finalSprint ? 1.16 : 1;
      const target = (this.targetSpeed[candidate] + boostSpeed) * penalty * sprint;
      player.speed += (target - player.speed) * Math.min(1, dt * 3);
      const before=player.raceProgress;
      const proposed=before+player.speed*dt;
      if(before<1&&proposed>=1)crossings[candidate]=(1-before)/Math.max(Number.EPSILON,proposed-before);
      player.raceProgress = Math.min(1,proposed);
      player.lane = candidate === 'lula' ? -0.55 : 0.55;
      player.energy = player.raceProgress * 100;
      player.stamina = player.boost;
    }

    const leaderNow = this.raceLeader();
    this.state.lula.position = this.state.lula.raceProgress >= this.state.bolsonaro.raceProgress ? 1 : 2;
    this.state.bolsonaro.position = this.state.lula.position === 1 ? 2 : 1;
    if (leaderNow && leaderBefore && leaderNow !== leaderBefore && this.state[leaderNow].raceProgress > 0.04) {
      this.state.lastOvertakeBy = leaderNow;
      this.setAction(leaderNow, 'overtake', 0.9);
      this.effect('overtake', leaderNow, 1.2);
    }
    if (!this.state.finalSprint && Math.max(this.state.lula.raceProgress, this.state.bolsonaro.raceProgress) >= 0.85) {
      this.state.finalSprint = true;
      this.effect('crowd', undefined, 1.8);
    }
    if(crossings.lula!==undefined||crossings.bolsonaro!==undefined){
      const winner:Candidate|'tie'=crossings.lula===undefined?'bolsonaro':crossings.bolsonaro===undefined?'lula'
        :Math.abs(crossings.lula-crossings.bolsonaro)<=1e-6?'tie'
        :crossings.lula<crossings.bolsonaro?'lula':'bolsonaro';
      this.declareWinner(winner);
    }
  }

  /**
   * Posiciona o corredor logo atrás do adversário e dá turbo: a ultrapassagem
   * acontece pela detecção normal, com efeito, som e destaque de sempre.
   */
  forceOvertake(candidate: Candidate): boolean {
    if (this.state.mode !== 'race' || !this.state.active || this.state.winner) return false;
    const player = this.state[candidate], opponent = this.state[candidate === 'lula' ? 'bolsonaro' : 'lula'];
    if (opponent.raceProgress >= 0.995) return false;
    // A distância é proporcional à velocidade-base, então a ultrapassagem
    // acontece em pouco mais de um segundo em qualquer duração de corrida.
    player.raceProgress = Math.max(0, opponent.raceProgress - this.baseSpeed * 0.9);
    player.boost = 100;
    // Sem isso, um adversário com turbo ativo corria no mesmo ritmo e a
    // ultrapassagem forçada nunca se completava: o turbo dele cede a vez.
    opponent.boost = Math.min(opponent.boost, 35);
    player.items.turbo += 1;
    this.setAction(candidate, 'boost', 1.4);
    this.effect('turbo', candidate, 1.4);
    return true;
  }

  /** Cruza a linha imediatamente, pelo mesmo estado autoritativo usado pela pista. */
  forceFinish(candidate: Candidate): boolean {
    if (this.state.mode !== 'race' || !this.state.active || this.state.winner) return false;
    this.state[candidate].raceProgress = 1;
    this.state[candidate].energy = 100;
    this.state.finalSprint = true;
    this.declareWinner(candidate);
    return true;
  }

  private raceLeader(): Candidate | null {
    const { lula, bolsonaro } = this.state;
    if (lula.raceProgress === bolsonaro.raceProgress) return null;
    return lula.raceProgress > bolsonaro.raceProgress ? 'lula' : 'bolsonaro';
  }

  /** Eventos de pista que acontecem sozinhos, mesmo sem público. */
  private autoRaceEvent(candidate: Candidate) {
    const roll = this.random();
    if (roll < 0.42) this.raceItem(candidate, 'arrancada', 0.7 + this.random() * 0.5);
    else if (roll < 0.72) this.raceItem(candidate, 'tropeco', 0.6 + this.random() * 0.5);
    else if (roll < 0.9) this.raceItem(candidate, 'impulso', 0.8 + this.random() * 0.6);
    else this.raceItem(candidate, 'escudo', 0.8);
  }

  private nextEventDelay() {
    const base = Math.max(2.4, 9.5 - this.raceEventFrequency * 1.35);
    return base + this.random() * base * 0.8;
  }

  private setAction(candidate: Candidate, action: FighterAction, seconds: number) {
    const player = this.state[candidate];
    player.action = action;
    player.actionSequence += 1;
    this.actionIn[candidate] = seconds;
  }

  private effect(kind: GameEffect['kind'], candidate: Candidate | undefined, intensity: number) {
    this.state.effect = { id: ++this.effectSequence, kind, candidate, intensity };
  }

  private declareWinner(winner: Candidate | 'tie') {
    if (this.state.winner) return;
    this.state.winner = winner;
    this.state.active = false;
    if (winner !== 'tie') {
      this.state.roundWins[winner] += 1;
      this.setAction(winner, 'celebrate', 99);
      this.setAction(winner === 'lula' ? 'bolsonaro' : 'lula', 'idle', 99);
    }
    this.effect('crowd', winner === 'tie' ? undefined : winner, 1.5);
  }
}
