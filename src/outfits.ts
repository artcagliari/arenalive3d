import type { Candidate } from './types';

/** Figurino procedural dos lutadores. Usado pela cena 3D e pela prévia do painel admin. */
export interface Outfit {
  id: string;
  label: string;
  description: string;
  jacket: string;
  lapel: string;
  trousers: string;
  shirt: string;
  tie: string;
  tieStripe: string | null;
  pocketSquare: string;
  pin: 'star' | 'flag';
  shoes: string;
  /** Silhueta: largura/profundidade do tronco, espessura dos braços, barriga e ombro (x do braço). */
  build: { width: number; depth: number; limb: number; belly: number; shoulderX: number; tieLength: number };
}

export const OUTFITS: Record<Candidate, Outfit> = {
  lula: {
    id: 'lula-terno-azul-marinho',
    label: 'Terno azul-marinho',
    description: 'Paletó azul-marinho, camisa branca, gravata vermelha e boton de estrela · silhueta larga e robusta',
    jacket: '#27447f', lapel: '#1c3260', trousers: '#1f3a6e', shirt: '#f4f7fa',
    tie: '#d8342a', tieStripe: null, pocketSquare: '#ef603d', pin: 'star', shoes: '#0b0d12',
    build: { width: 1.14, depth: 1.1, limb: 1.1, belly: 1, shoulderX: .56, tieLength: .46 }
  },
  bolsonaro: {
    id: 'bolsonaro-terno-grafite',
    label: 'Terno grafite claro',
    description: 'Paletó cinza-grafite, camisa branca, gravata verde com listras amarelas e boton de bandeira · silhueta magra e alongada',
    jacket: '#6c7787', lapel: '#566170', trousers: '#4d5766', shirt: '#f4f7fa',
    tie: '#1f9a4a', tieStripe: '#f4c91d', pocketSquare: '#2cb8ef', pin: 'flag', shoes: '#0b0d12',
    build: { width: .86, depth: .9, limb: .88, belly: 0, shoulderX: .44, tieLength: .58 }
  }
};

/** Figurino esportivo usado no modo corrida (modo principal), em estilo cartoon 2.5D. */
export interface RaceOutfit {
  id: string;
  label: string;
  description: string;
  number: string;
  jersey: string;
  jerseyDark: string;
  trim: string;
  sleeve: string;
  sleeveDark: string;
  shorts: string;
  shortsDark: string;
  /** Calça comprida de agasalho ou bermuda com meião: muda a silhueta das pernas. */
  legStyle: 'pants' | 'shorts';
  sock: string;
  shoe: string;
  shoeDark: string;
  shoeAccent: string;
  skin: string;
  skinDark: string;
  /** Cor do traço de contorno, que dá o acabamento de desenho. */
  ink: string;
  /** Silhueta: largura do tronco, espessura dos membros, passada e altura. */
  build: { width: number; limb: number; stride: number; height: number };
}

export const RACE_OUTFITS: Record<Candidate, RaceOutfit> = {
  lula: {
    id: 'lula-agasalho-vermelho-13',
    label: 'Agasalho vermelho 13',
    description: 'Agasalho vermelho com faixas brancas, calça de corrida e tênis brancos · silhueta larga e passada curta',
    number: '13',
    jersey: '#e03a2c', jerseyDark: '#a81f16', trim: '#f6f9fc',
    sleeve: '#c92b20', sleeveDark: '#8e1911',
    shorts: '#c22c22', shortsDark: '#8a1c15', legStyle: 'pants', sock: '#f6f9fc',
    shoe: '#f6f9fc', shoeDark: '#cdd7e0', shoeAccent: '#e03a2c',
    skin: '#d49870', skinDark: '#a9704c',
    ink: '#1a1410',
    build: { width: 1.14, limb: 1.14, stride: 0.92, height: 0.99 }
  },
  bolsonaro: {
    id: 'bolsonaro-camisa-verde-amarela-22',
    label: 'Camisa verde-amarela 22',
    description: 'Camisa verde com mangas amarelas, bermuda preta e meião · silhueta magra e passada longa',
    number: '22',
    jersey: '#1f9d4d', jerseyDark: '#116b33', trim: '#f7cf21',
    sleeve: '#f1c518', sleeveDark: '#c29a0c',
    shorts: '#2c3447', shortsDark: '#171d28', legStyle: 'shorts', sock: '#f7cf21',
    shoe: '#23293a', shoeDark: '#12161f', shoeAccent: '#f7cf21',
    skin: '#e0b088', skinDark: '#b4805a',
    ink: '#101418',
    build: { width: 0.88, limb: 0.9, stride: 1.1, height: 1.04 }
  }
};
