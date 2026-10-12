import * as THREE from 'three';
import type { Candidate } from '../types';
import { RACE_OUTFITS, type RaceOutfit } from '../outfits';

/**
 * Arte dos corredores em 2.5D: cada parte do corpo é desenhada em canvas com
 * traço de contorno e sombreado, e depois montada como um rig 2D de planos.
 * Mantém leitura instantânea em tela vertical e custo gráfico baixo no Mac.
 */

const SS = 3; // supersampling: deixa o traço limpo sem depender da resolução da tela
export const ART_SCALE = 0.01; // 1 unidade de desenho = 1 cm de mundo

/** Medidas do esqueleto, compartilhadas pela cena 3D e pela prévia do painel. */
export const RIG = { hip: 1.02, shoulder: 1.68, headY: 1.97, headSize: .84, total: 2.5 };

/** Tamanho em unidades de mundo de uma textura de parte do corpo. */
export function partSize(texture: THREE.Texture): [number, number] {
  const image = texture.image as HTMLCanvasElement;
  return [image.width / SS * ART_SCALE, image.height / SS * ART_SCALE];
}

function surface(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * SS); canvas.height = Math.ceil(height * SS);
  const context = canvas.getContext('2d')!;
  context.scale(SS, SS);
  context.lineJoin = 'round'; context.lineCap = 'round';
  return { canvas, context, width, height };
}

function toTexture(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

function shade(context: CanvasRenderingContext2D, height: number, top: string, bottom: string) {
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, top); gradient.addColorStop(1, bottom);
  return gradient;
}

function stroke(context: CanvasRenderingContext2D, ink: string, weight = 5) {
  context.strokeStyle = ink; context.lineWidth = weight; context.stroke();
}

/** Cápsula usada em braços, coxas e canelas. */
function capsule(width: number, height: number, top: string, bottom: string, ink: string, accent?: { color: string; from: number }) {
  const pad = 3, { canvas, context } = surface(width, height);
  const radius = (width - pad * 2) / 2;
  context.beginPath();
  context.moveTo(pad, pad + radius);
  context.arc(pad + radius, pad + radius, radius, Math.PI, 0);
  context.lineTo(width - pad, height - pad - radius);
  context.arc(pad + radius, height - pad - radius, radius, 0, Math.PI);
  context.closePath();
  context.fillStyle = shade(context, height, top, bottom); context.fill();
  context.save(); context.clip();
  // luz de borda: mantém a silhueta legível quando dois membros se cruzam
  context.strokeStyle = 'rgba(255,255,255,.4)'; context.lineWidth = 3;
  context.beginPath();
  context.moveTo(pad + radius * .5, pad + radius * 1.1);
  context.lineTo(pad + radius * .5, height - pad - radius);
  context.stroke();
  context.restore();
  stroke(context, ink);
  if (accent) {
    context.save(); context.clip();
    context.fillStyle = accent.color;
    context.fillRect(0, accent.from, width, height - accent.from);
    context.restore();
    context.beginPath(); context.moveTo(pad, accent.from); context.lineTo(width - pad, accent.from);
    stroke(context, ink, 3);
  }
  return canvas;
}

/** Tronco visto de lado: peito à direita, costas à esquerda. */
function paintTorso(outfit: RaceOutfit) {
  const width = 92, height = 84, { canvas, context } = surface(width, height);
  const w = outfit.build.width, front = 46 + 20 * w, back = 46 - 20 * w;
  context.beginPath();
  context.moveTo(46, 4);
  context.bezierCurveTo(front - 1, 9, front + 2, 30, front - 2, 54);
  context.bezierCurveTo(front - 5, 68, front - 12, 79, 50, 80);
  context.lineTo(40, 80);
  context.bezierCurveTo(back + 9, 79, back + 2, 66, back + 4, 44);
  context.bezierCurveTo(back + 6, 22, back + 16, 5, 46, 4);
  context.closePath();
  context.fillStyle = shade(context, height, outfit.jersey, outfit.jerseyDark); context.fill();
  context.save(); context.clip();
  // faixa lateral e barra inferior dão identidade sem poluir
  context.fillStyle = outfit.trim;
  context.fillRect(0, height - 14, width, 7);
  context.save();
  context.translate(front - 17, 0); context.rotate(0.07);
  context.fillRect(0, 0, 6, height);
  context.restore();
  // gola em V
  context.beginPath();
  context.moveTo(34, 1); context.lineTo(46, 23); context.lineTo(58, 1);
  context.lineWidth = 7; context.strokeStyle = outfit.trim; context.stroke();
  context.restore();
  stroke(context, outfit.ink, 4.6);
  // número de peito
  const nx = front - 17, ny = 22;
  context.beginPath(); context.roundRect(nx - 13, ny - 11, 26, 24, 4);
  context.fillStyle = outfit.trim; context.fill(); stroke(context, outfit.ink, 3.2);
  context.fillStyle = outfit.jerseyDark;
  context.font = `800 23px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(outfit.number, nx, ny + 1);
  return canvas;
}

/** Tênis de corrida apontando para a frente. */
function paintShoe(outfit: RaceOutfit) {
  const width = 40, height = 21, { canvas, context } = surface(width, height);
  context.beginPath();
  context.moveTo(5, 5);
  context.bezierCurveTo(14, 1, 26, 5, 34, 11);
  context.bezierCurveTo(37, 13, 37, 16, 33, 16);
  context.lineTo(7, 16);
  context.closePath();
  context.fillStyle = shade(context, height, outfit.shoe, outfit.shoeDark); context.fill();
  stroke(context, outfit.ink, 4);
  context.beginPath();
  context.moveTo(5, 16); context.lineTo(33, 16);
  context.bezierCurveTo(37, 16, 37, 19, 32, 19);
  context.lineTo(7, 19); context.closePath();
  context.fillStyle = outfit.trim; context.fill(); stroke(context, outfit.ink, 3);
  context.beginPath();
  context.moveTo(11, 13); context.bezierCurveTo(18, 11, 24, 9, 29, 11);
  context.strokeStyle = outfit.shoeAccent; context.lineWidth = 4; context.stroke();
  return canvas;
}

/** Cabeça em estilo adesivo: halo claro, traço escuro e o rosto por cima. */
/** Caixa do conteúdo opaco: ignora a margem transparente do PNG enviado. */
function contentBox(image: HTMLImageElement) {
  const probe = document.createElement('canvas');
  const scale = Math.min(1, 160 / Math.max(image.width, image.height));
  probe.width = Math.max(1, Math.round(image.width * scale));
  probe.height = Math.max(1, Math.round(image.height * scale));
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return { x: 0, y: 0, width: image.width, height: image.height };
  context.drawImage(image, 0, 0, probe.width, probe.height);
  let minX = probe.width, minY = probe.height, maxX = 0, maxY = 0, found = false;
  try {
    const { data } = context.getImageData(0, 0, probe.width, probe.height);
    for (let y = 0; y < probe.height; y++) for (let x = 0; x < probe.width; x++) {
      if (data[(y * probe.width + x) * 4 + 3] <= 12) continue;
      found = true;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  } catch { return { x: 0, y: 0, width: image.width, height: image.height }; }
  if (!found) return { x: 0, y: 0, width: image.width, height: image.height };
  const back = 1 / scale;
  return { x: minX * back, y: minY * back, width: (maxX - minX + 1) * back, height: (maxY - minY + 1) * back };
}

function paintHead(image: HTMLImageElement, outfit: RaceOutfit) {
  const size = 150, { canvas, context } = surface(size, size);
  const box = contentBox(image);
  const ratio = Math.min(size * 0.9 / box.width, size * 0.9 / box.height);
  const w = box.width * ratio, h = box.height * ratio, x = (size - w) / 2, y = (size - h) / 2;
  const put = (target: CanvasRenderingContext2D) => target.drawImage(image, box.x, box.y, box.width, box.height, x, y, w, h);

  const silhouette = surface(size, size);
  put(silhouette.context);
  silhouette.context.globalCompositeOperation = 'source-in';
  silhouette.context.fillStyle = '#ffffff';
  silhouette.context.fillRect(0, 0, size, size);

  const ring = (radius: number, tint: string) => {
    const layer = surface(size, size);
    layer.context.drawImage(silhouette.canvas, 0, 0, size, size);
    layer.context.globalCompositeOperation = 'source-in';
    layer.context.fillStyle = tint; layer.context.fillRect(0, 0, size, size);
    for (let step = 0; step < 20; step++) {
      const angle = step / 20 * Math.PI * 2;
      context.drawImage(layer.canvas, Math.cos(angle) * radius, Math.sin(angle) * radius, size, size);
    }
  };
  ring(5.5, '#f7fbff');
  ring(2.6, outfit.ink);
  put(context);
  return canvas;
}

function paintNeck(outfit: RaceOutfit) {
  return capsule(30, 32, outfit.skin, outfit.skinDark, outfit.ink);
}

function paintSpeedLines(outfit: RaceOutfit) {
  const width = 90, height = 60, { canvas, context } = surface(width, height);
  context.strokeStyle = outfit.jersey; context.lineCap = 'round';
  for (const [y, length, weight] of [[14, 74, 7], [32, 88, 9], [50, 62, 6]] as const) {
    context.globalAlpha = .34 + weight / 26;
    context.lineWidth = weight;
    context.beginPath(); context.moveTo(width - length, y); context.lineTo(width - 6, y); context.stroke();
  }
  return canvas;
}

function paintPuff() {
  const size = 64, { canvas, context } = surface(size, size);
  context.fillStyle = 'rgba(214,176,146,.95)';
  for (const [x, y, r] of [[28, 40, 14], [42, 34, 10], [19, 30, 8]] as const) {
    context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2); context.fill();
  }
  return canvas;
}

function paintShadow() {
  const size = 128, { canvas, context } = surface(size, size);
  const gradient = context.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(6,10,16,.62)');
  gradient.addColorStop(.55, 'rgba(6,10,16,.3)');
  gradient.addColorStop(1, 'rgba(6,10,16,0)');
  context.fillStyle = gradient; context.fillRect(0, 0, size, size);
  return canvas;
}

export interface RunnerArt {
  outfit: RaceOutfit;
  torso: THREE.Texture; neck: THREE.Texture;
  upperArmFront: THREE.Texture; upperArmBack: THREE.Texture;
  forearmFront: THREE.Texture; forearmBack: THREE.Texture;
  thighFront: THREE.Texture; thighBack: THREE.Texture;
  shinFront: THREE.Texture; shinBack: THREE.Texture;
  shoe: THREE.Texture; speedLines: THREE.Texture; shadow: THREE.Texture; puff: THREE.Texture;
  dispose(): void;
}

/** Escurece uma cor hexadecimal para a camada de trás, criando profundidade. */
function deepen(hex: string, amount = 0.38) {
  const value = parseInt(hex.slice(1), 16);
  const mix = (channel: number) => Math.round(channel * (1 - amount));
  return `#${[mix(value >> 16 & 255), mix(value >> 8 & 255), mix(value & 255)].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

export function buildRunnerArt(candidate: Candidate): RunnerArt {
  const outfit = RACE_OUTFITS[candidate];
  const back = { ...outfit, jersey: deepen(outfit.jersey), jerseyDark: deepen(outfit.jerseyDark), sleeve: deepen(outfit.sleeve), sleeveDark: deepen(outfit.sleeveDark), skin: deepen(outfit.skin), skinDark: deepen(outfit.skinDark), shorts: deepen(outfit.shorts), shortsDark: deepen(outfit.shortsDark), shoe: deepen(outfit.shoe), shoeDark: deepen(outfit.shoeDark), sock: deepen(outfit.sock) };
  const limb = outfit.build.limb;
  const pants = outfit.legStyle === 'pants';

  const arm = (kit: RaceOutfit) => capsule(25 * limb, 48, kit.sleeve, kit.sleeveDark, kit.ink, { color: kit.trim, from: 38 });
  const forearm = (kit: RaceOutfit) => capsule(23 * limb, 46, kit.skin, kit.skinDark, kit.ink);
  const thigh = (kit: RaceOutfit) => capsule(33 * limb, 56, kit.shorts, kit.shortsDark, kit.ink);
  const shin = (kit: RaceOutfit) => capsule(27 * limb, 52,
    pants ? kit.shorts : kit.skin, pants ? kit.shortsDark : kit.skinDark, kit.ink,
    { color: pants ? kit.trim : kit.sock, from: 36 });

  const textures = {
    torso: toTexture(paintTorso(outfit)),
    neck: toTexture(paintNeck(outfit)),
    upperArmFront: toTexture(arm(outfit)), upperArmBack: toTexture(arm(back)),
    forearmFront: toTexture(forearm(outfit)), forearmBack: toTexture(forearm(back)),
    thighFront: toTexture(thigh(outfit)), thighBack: toTexture(thigh(back)),
    shinFront: toTexture(shin(outfit)), shinBack: toTexture(shin(back)),
    shoe: toTexture(paintShoe(outfit)),
    speedLines: toTexture(paintSpeedLines(outfit)),
    shadow: toTexture(paintShadow()),
    puff: toTexture(paintPuff())
  };
  return {
    outfit, ...textures,
    dispose() { for (const texture of Object.values(textures)) texture.dispose(); }
  };
}

/** Monta a cabeça adesivo assim que a textura do rosto termina de carregar. */
export function loadHeadTexture(url: string, candidate: Candidate): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(toTexture(paintHead(image, RACE_OUTFITS[candidate])));
    image.onerror = () => reject(new Error(`Falha ao carregar ${url}`));
    image.src = url;
  });
}

/**
 * Desenha o corredor inteiro em um canvas 2D, repetindo a mesma hierarquia do
 * rig usado no overlay. Serve à prévia do painel administrativo.
 */
export function drawRunnerPreview(context: CanvasRenderingContext2D, art: RunnerArt, head: HTMLCanvasElement | null, width: number, height: number) {
  const outfit = art.outfit;
  const unit = height / (RIG.total * 1.2), ground = height * 0.93, cx = width / 2;
  context.clearRect(0, 0, width, height);

  const shadow = art.shadow.image as HTMLCanvasElement;
  context.globalAlpha = .7;
  context.drawImage(shadow, cx - .78 * unit, ground - .3 * unit, 1.56 * unit, .6 * unit);
  context.globalAlpha = 1;

  // Espaço de desenho com y para cima e em unidades de mundo, como na cena 3D.
  context.save();
  context.translate(cx, ground);
  context.scale(unit, -unit);
  context.scale(1, outfit.build.height);

  const put = (texture: THREE.Texture, anchor: 'top' | 'bottom' | 'center' = 'top') => {
    const image = texture.image as HTMLCanvasElement;
    const [w, h] = partSize(texture);
    context.save(); context.scale(1, -1);
    context.drawImage(image, -w / 2, anchor === 'top' ? 0 : anchor === 'bottom' ? -h : -h / 2, w, h);
    context.restore();
    return h;
  };
  const arm = (upper: THREE.Texture, fore: THREE.Texture, x: number, shoulder: number, elbow: number) => {
    context.save();
    context.translate(x, RIG.shoulder); context.rotate(shoulder);
    const height = put(upper);
    context.translate(0, -height + .08); context.rotate(elbow);
    put(fore);
    context.restore();
  };
  const leg = (thigh: THREE.Texture, shin: THREE.Texture, x: number, hip: number, knee: number) => {
    context.save();
    context.translate(x, RIG.hip); context.rotate(hip);
    const thighHeight = put(thigh);
    context.translate(0, -thighHeight + .08); context.rotate(knee);
    const shinHeight = put(shin);
    context.translate(.07, -shinHeight + .06); context.rotate(-(hip + knee) * .8);
    put(art.shoe, 'center');
    context.restore();
  };

  // Pose de corrida: perna de trás recolhida, perna da frente à frente.
  arm(art.upperArmBack, art.forearmBack, -.12, .52, -.78);
  leg(art.thighBack, art.shinBack, -.04, -.34, -.95);
  context.save();
  context.translate(0, RIG.hip - .07); context.rotate(-.1);
  put(art.torso, 'bottom');
  context.restore();
  context.save(); context.translate(0, RIG.shoulder + .13); put(art.neck); context.restore();
  leg(art.thighFront, art.shinFront, .04, .42, -.16);
  arm(art.upperArmFront, art.forearmFront, .17, -.52, -.82);

  if (head) {
    context.save();
    context.translate(0, RIG.headY); context.rotate(.06); context.scale(1, -1);
    context.drawImage(head, -RIG.headSize / 2, -RIG.headSize / 2, RIG.headSize, RIG.headSize);
    context.restore();
  }
  context.restore();
}
