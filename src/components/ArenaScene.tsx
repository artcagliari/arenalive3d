import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { OUTFITS, RACE_OUTFITS, type Outfit, type RaceOutfit } from '../outfits';
import { buildRunnerArt, loadHeadTexture, partSize, RIG, type RunnerArt } from '../characters/runner-art';
import type { AudioCue, CameraMode, Candidate, GameCompetitor, GameEffect, GameState, Phase, RunnerStyle } from '../types';

const COLORS = { lula: '#ef603d', bolsonaro: '#2cb8ef' } as const;

/** Corrida: o líder fica ancorado nesta posição e o adversário recua conforme a diferença. */
const RACE_ANCHOR = 1.1, RACE_SPREAD = 26, RACE_MAX_GAP = 5.6, RACE_LANE = .82, RACE_MIN_SEPARATION = 2;
const raceGap = (game: GameState) =>
  Math.min(RACE_MAX_GAP, Math.abs(game.lula.raceProgress - game.bolsonaro.raceProgress) * RACE_SPREAD);

function CameraDirector({ game, mode, motion }: { game: GameState; mode: CameraMode; motion: number }) {
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, delta) => {
    const battleShots = [
      [[0, 3.3, 8.4], [0, 1.35, 0]], [[-4.8, 2.5, 5.8], [0, 1.2, 0]],
      [[4.8, 2.7, 5.5], [0, 1.3, 0]], [[0, 5.8, 7], [0, 0.8, 0]], [[0, 1.7, 6.2], [0, 1.35, 0]]
    ];
    // Corrida: câmera lateral centrada no par de corredores.
    const center = RACE_ANCHOR - raceGap(game) / 2;
    const raceShots = [
      [[center - .3, 1.8, 8.8], [center, 1.26, 0]],
      [[center - 1.8, 1.65, 8.4], [center - .3, 1.22, 0]],
      [[center + 1.6, 2.05, 8.6], [center, 1.22, 0]],
      [[center, 2.9, 11.4], [center, 1.3, 0]],
      [[center - .4, 1.7, 7.6], [center, 1.32, 0]]
    ];
    const shots = game.mode === 'battle' ? battleShots : raceShots;
    const fov = game.mode === 'battle' ? 43 : 32;
    if ((camera as THREE.PerspectiveCamera).fov !== fov) {
      (camera as THREE.PerspectiveCamera).fov = fov;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
    const index = mode === 'wide' ? 0 : mode === 'close' ? 4 : game.cameraShot % shots.length;
    const shot = shots[index];
    const sway = mode === 'dynamic' ? Math.sin(state.clock.elapsedTime * 0.32) * 0.16 * motion : 0;
    target.set(shot[0][0] + sway, shot[0][1], shot[0][2]);
    camera.position.lerp(target, 1 - Math.exp(-delta * 1.8));
    target.set(shot[1][0], shot[1][1], shot[1][2]);
    camera.lookAt(target);
  });
  return null;
}

function ArenaArchitecture({ reduced }: { reduced: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame((_state, delta) => { if (ring.current) ring.current.rotation.z += delta * 0.07; });
  return <group>
    <mesh receiveShadow position={[0, -0.28, 0]}><cylinderGeometry args={[4.65, 5.05, 0.45, reduced ? 32 : 64]} /><meshStandardMaterial color="#0e1721" metalness={0.8} roughness={0.34} /></mesh>
    <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}><torusGeometry args={[4.12, 0.055, 8, reduced ? 48 : 96]} /><meshBasicMaterial color="#56d4ff" toneMapped={false} /></mesh>
    {[0,1,2,3,4,5,6,7].map(index => { const angle=index/8*Math.PI*2; return <group key={index} position={[Math.cos(angle)*5.2,1.25,Math.sin(angle)*5.2]}><mesh><cylinderGeometry args={[0.08,0.12,2.7,6]} /><meshStandardMaterial color="#1b2a38" metalness={.8} /></mesh><pointLight color={index%2?'#ef603d':'#36c4ff'} intensity={reduced?2:5} distance={5} /></group>; })}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,3.6,-3.8]}><ringGeometry args={[3.9,4.05,64]} /><meshBasicMaterial color="#2a8eb8" transparent opacity={.35} side={THREE.DoubleSide} /></mesh>
  </group>;
}

function Limb({ position, refObject, color, cuff, rotation=[0,0,0], thickness=1 }: { position:[number,number,number]; refObject:RefObject<THREE.Group|null>; color:string; cuff:string; rotation?:[number,number,number]; thickness?:number }) {
  return <group ref={refObject} position={position} rotation={rotation}><mesh position={[0,-.34,0]} scale={[thickness,1,thickness]} castShadow><capsuleGeometry args={[.115,.48,5,8]} /><meshStandardMaterial color={color} roughness={.62} /></mesh><mesh position={[0,-.64,0]} scale={[thickness,1,thickness]}><cylinderGeometry args={[.122,.122,.07,10]} /><meshStandardMaterial color={cuff} roughness={.5} /></mesh><mesh position={[0,-.73,0]} castShadow><sphereGeometry args={[.13,10,8]} /><meshStandardMaterial color="#d6a073" roughness={.76} /></mesh></group>;
}

const TIE_SHAPE=(()=>{const s=new THREE.Shape();s.moveTo(-.035,0);s.lineTo(.035,0);s.lineTo(.062,-.1);s.lineTo(.085,-1);s.lineTo(0,-1.1);s.lineTo(-.085,-1);s.lineTo(-.062,-.1);s.closePath();return s})();
const STAR_SHAPE=(()=>{const s=new THREE.Shape();for(let i=0;i<10;i++){const a=Math.PI/2+i*Math.PI/5,r=i%2?.4:1;const x=Math.cos(a)*r,y=Math.sin(a)*r;if(i)s.lineTo(x,y);else s.moveTo(x,y)}s.closePath();return s})();

/** Tronco vestido: paletó, camisa, gravata, lapelas, boton e lenço. Tudo fica à frente da superfície do tronco (sem clipping). */
function Torso({ outfit, color }: { outfit: Outfit; color: string }) {
  const { width: w, depth: d, belly } = outfit.build;
  // Superfície frontal do tronco (cápsula r=.42, trecho reto até y=1.78) + folga anti z-fighting.
  const front = (y: number) => d * Math.sqrt(Math.max(.01, .1764 - Math.max(0, y - 1.78) ** 2)) + .012;
  const tieTop = 1.88, tieScale = outfit.build.tieLength;
  return <group>
    <mesh position={[0, 1.43, 0]} scale={[w, 1, d]} castShadow><capsuleGeometry args={[.42, .7, 8, 14]} /><meshStandardMaterial color={outfit.jacket} roughness={.58} metalness={.08} /></mesh>
    {belly>0&&<mesh position={[0, 1.04, d*.2]} scale={[1.12*w, .78, .8*d]} castShadow><sphereGeometry args={[.36, 14, 10]} /><meshStandardMaterial color={outfit.jacket} roughness={.58} metalness={.08} /></mesh>}
    {/* camisa em V */}
    <mesh position={[0, 1.64, front(1.64)]}><boxGeometry args={[.3 * w, .5, .02]} /><meshStandardMaterial color={outfit.shirt} roughness={.6} /></mesh>
    {/* colarinho */}
    {[-1, 1].map(sign => <mesh key={sign} position={[sign * .075, 1.97, front(1.97)]} rotation={[-.45, 0, -sign * .55]}><boxGeometry args={[.13, .1, .02]} /><meshStandardMaterial color={outfit.shirt} roughness={.6} /></mesh>)}
    {/* lapelas do paletó */}
    {[-1, 1].map(sign => <mesh key={sign} position={[sign * .2 * w - sign * .0, 1.6, front(1.6) + .012]} rotation={[0, 0, sign * .5]}><boxGeometry args={[.115 * w, .6, .03]} /><meshStandardMaterial color={outfit.lapel} roughness={.5} /></mesh>)}
    {/* gravata */}
    <mesh position={[0, 1.9, front(1.9) + .02]} rotation={[-.35, 0, 0]}><boxGeometry args={[.1, .085, .035]} /><meshStandardMaterial color={outfit.tie} roughness={.4} /></mesh>
    <mesh position={[0, tieTop - .06, front(1.8) + .028]} scale={[1.25, tieScale, 1]}><shapeGeometry args={[TIE_SHAPE]} /><meshStandardMaterial color={outfit.tie} roughness={.4} side={THREE.DoubleSide} /></mesh>
    {outfit.tieStripe&&[.28, .5].map(at => <mesh key={at} position={[0, tieTop - .06 - tieScale * at * 1.0, front(1.8) + .032]} rotation={[0, 0, -.35]}><boxGeometry args={[.15, .028, .004]} /><meshBasicMaterial color={outfit.tieStripe!} toneMapped={false} /></mesh>)}
    {/* boton na lapela */}
    {outfit.pin==='star'
      ? <group position={[-.2 * w, 1.72, front(1.72) + .04]}><mesh><circleGeometry args={[.06, 14]} /><meshBasicMaterial color="#f4f7fa" toneMapped={false} /></mesh><mesh position={[0, 0, .004]} scale={.052}><shapeGeometry args={[STAR_SHAPE]} /><meshBasicMaterial color="#e1281f" toneMapped={false} /></mesh></group>
      : <group position={[-.2 * w, 1.72, front(1.72) + .04]}><mesh><planeGeometry args={[.13, .09]} /><meshBasicMaterial color="#1f9a4a" toneMapped={false} /></mesh><mesh position={[0, 0, .004]} rotation={[0, 0, Math.PI / 4]}><planeGeometry args={[.055, .055]} /><meshBasicMaterial color="#f4c91d" toneMapped={false} /></mesh></group>}
    {/* lenço de bolso na cor do lado */}
    <mesh position={[.24 * w, 1.52, front(1.52) + .03]} rotation={[0, 0, -.12]}><boxGeometry args={[.1, .07, .025]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.2} /></mesh>
    {/* botões */}
    {[1.22, 1.08].map(y => <mesh key={y} position={[0, y, front(y) + (belly>0?.1:.005)]}><sphereGeometry args={[.022, 6, 6]} /><meshStandardMaterial color="#0c1018" /></mesh>)}
  </group>;
}

function Leg({ refObject, x, outfit }: { refObject: RefObject<THREE.Group|null>; x: number; outfit: Outfit }) {
  const t = outfit.build.limb;
  return <group ref={refObject} position={[x, .8, 0]}><mesh position={[0, -.4, 0]} scale={[t, 1, t]} castShadow><capsuleGeometry args={[.14, .65, 5, 8]} /><meshStandardMaterial color={outfit.trousers} roughness={.7} /></mesh><mesh position={[0, -.82, .07]} castShadow><boxGeometry args={[.22 * t, .1, .36]} /><meshStandardMaterial color={outfit.shoes} roughness={.35} metalness={.2} /></mesh></group>;
}

function CharacterFace({candidate,url,action,motion,position,scale=1,yaw=0}:{candidate:Candidate;url:string;action:GameCompetitor['action'];motion:number;position:[number,number,number];scale?:number;yaw?:number}){
  const group=useRef<THREE.Group>(null),textureRef=useRef<THREE.Texture|null>(null),[texture,setTexture]=useState<THREE.Texture|null>(null);
  const fallback=`/characters/${candidate}-stylized.png`;
  useEffect(()=>{
    let cancelled=false;const loader=new THREE.TextureLoader();
    const apply=(next:THREE.Texture)=>{next.colorSpace=THREE.SRGBColorSpace;next.anisotropy=4;if(cancelled){next.dispose();return}textureRef.current?.dispose();textureRef.current=next;setTexture(next)};
    const fail=()=>{if(url!==fallback)loader.load(fallback,apply,undefined,()=>undefined)};
    loader.load(url,apply,undefined,fail);return()=>{cancelled=true};
  },[url,fallback]);
  useEffect(()=>()=>textureRef.current?.dispose(),[]);
  useFrame((state,delta)=>{if(!group.current)return;const t=state.clock.elapsedTime;const target=action==='hit'?(candidate==='lula'?.13:-.13):action==='dodge'?(candidate==='lula'?-.1:.1):0;group.current.rotation.z=THREE.MathUtils.damp(group.current.rotation.z,target*motion,9,delta);const pulse=action==='celebrate'?1+Math.abs(Math.sin(t*6))*.08*motion:action==='special'?1+Math.sin(t*12)*.035*motion:1;group.current.scale.setScalar(scale*pulse)});
  if(!texture)return null;
  return <group ref={group} position={position} rotation={[0,yaw,0]} scale={scale}><mesh renderOrder={4}><planeGeometry args={[candidate==='lula'?.9:.8,candidate==='lula'?.96:1.02]} /><meshBasicMaterial map={texture} transparent alphaTest={.1} depthWrite={false} toneMapped={false} side={THREE.DoubleSide}/></mesh></group>;
}

function StylizedFighter({ candidate, data, active, motion, faceUrl }: { candidate:Candidate; data:GameCompetitor; active:boolean; motion:number;faceUrl:string }) {
  const group=useRef<THREE.Group>(null), leftArm=useRef<THREE.Group>(null), rightArm=useRef<THREE.Group>(null), leftLeg=useRef<THREE.Group>(null), rightLeg=useRef<THREE.Group>(null);
  const color=COLORS[candidate], side=candidate==='lula'?-1:1, outfit=OUTFITS[candidate];
  useFrame((state,delta)=>{
    if(!group.current)return;
    group.current.position.x=THREE.MathUtils.damp(group.current.position.x,data.x,7,delta);
    group.current.position.z=THREE.MathUtils.damp(group.current.position.z,data.z,7,delta);
    const t=state.clock.elapsedTime, walking=['advance','retreat','dodge'].includes(data.action), stride=walking?Math.sin(t*9)*.55*motion:0;
    const attack=data.action==='attack'?Math.sin(t*8)*1.25*motion:0, special=data.action==='special'?Math.sin(t*12)*.35*motion:0, blocking=data.action==='block', celebrating=data.action==='celebrate';
    if(leftLeg.current)leftLeg.current.rotation.x=stride;if(rightLeg.current)rightLeg.current.rotation.x=-stride;
    if(leftArm.current)leftArm.current.rotation.x=celebrating?-2.6:blocking?-1.2:-stride*.55+special;
    if(rightArm.current)rightArm.current.rotation.x=celebrating?-2.6:blocking?-1.35:-stride*.55-attack-special;
    group.current.rotation.z=data.action==='hit'?THREE.MathUtils.damp(group.current.rotation.z,side*.24,12,delta):THREE.MathUtils.damp(group.current.rotation.z,0,7,delta);
    group.current.position.y=((active?Math.sin(t*(walking?9:2.4))*(walking?.07:.025):0)+(celebrating?Math.abs(Math.sin(t*5))*.32:0))*motion;
  });
  return <group ref={group} position={[data.x,0,data.z]} rotation={[0,side*-.34,0]}><group scale={.92}>
    <Leg refObject={leftLeg} x={-.21*outfit.build.width**.5} outfit={outfit} /><Leg refObject={rightLeg} x={.21*outfit.build.width**.5} outfit={outfit} />
    <Torso outfit={outfit} color={color} />
    <mesh position={[-outfit.build.shoulderX,1.72,0]} scale={outfit.build.limb}><sphereGeometry args={[.15,12,10]} /><meshStandardMaterial color={outfit.jacket} roughness={.58} /></mesh><mesh position={[outfit.build.shoulderX,1.72,0]} scale={outfit.build.limb}><sphereGeometry args={[.15,12,10]} /><meshStandardMaterial color={outfit.jacket} roughness={.58} /></mesh>
    <Limb position={[-outfit.build.shoulderX,1.72,0]} refObject={leftArm} color={outfit.jacket} cuff={outfit.shirt} thickness={outfit.build.limb} rotation={[0,0,-.12]} /><Limb position={[outfit.build.shoulderX,1.72,0]} refObject={rightArm} color={outfit.jacket} cuff={outfit.shirt} thickness={outfit.build.limb} rotation={[0,0,.12]} />
    <mesh position={[0,2.35,-.015]} scale={candidate==='lula'?[1.04,.95,.86]:[.91,1.08,.84]} castShadow><sphereGeometry args={[.36,18,14]} /><meshStandardMaterial color="#bd805d" roughness={.78} /></mesh>
    <CharacterFace candidate={candidate} url={faceUrl} action={data.action} motion={motion} position={[0,2.37,.37]}/>
    {data.action==='block'&&<mesh position={[side*.16,1.55,.58]} rotation={[Math.PI/2,0,0]}><torusGeometry args={[.58,.045,8,32]} /><meshBasicMaterial color={color} transparent opacity={.82} toneMapped={false} /></mesh>}
  </group></group>;
}

function EffectBurst({ effect, game, motion, anchor }: { effect:GameEffect|null; game:GameState; motion:number; anchor?:(candidate:Candidate)=>[number,number,number] }) {
  const group=useRef<THREE.Group>(null), material=useRef<THREE.MeshBasicMaterial>(null), born=useRef(performance.now());
  const target=effect?.candidate?game[effect.candidate]:null;
  useFrame((_state,delta)=>{if(!group.current)return;group.current.scale.addScalar(delta*3.2*motion);group.current.rotation.z+=delta*3*motion;if(material.current)material.current.opacity=Math.max(0,1-(performance.now()-born.current)/900);});
  if(!effect)return null;const color=effect.candidate?COLORS[effect.candidate]:'#ffd66b';
  return <group ref={group} key={effect.id} position={[target?.x??0,1.35,target?.z??0]}><mesh><icosahedronGeometry args={[.3,1]} /><meshBasicMaterial ref={material} color={color} transparent opacity={.9} wireframe={effect.kind!=='impact'} toneMapped={false} /></mesh><pointLight color={color} intensity={10*effect.intensity} distance={5} /></group>;
}

function AudioCueEffect({cue,game,motion}:{cue:AudioCue|null;game:GameState;motion:number}){
  const group=useRef<THREE.Group>(null),material=useRef<THREE.MeshBasicMaterial>(null),born=useRef(performance.now());
  const target=cue?.candidate?game[cue.candidate]:null,color=cue?.candidate?COLORS[cue.candidate]:'#ffd36a';
  useFrame((_state,delta)=>{if(!group.current)return;const age=(performance.now()-born.current)/1000;group.current.scale.setScalar(.5+age*2.4*motion);group.current.rotation.z+=delta*2.2*motion;if(material.current)material.current.opacity=Math.max(0,.8-age*.7)});
  if(!cue||cue.animation==='none')return null;
  return <group ref={group} position={[target?.x??0,cue.animation==='scene_wipe'?1.7:1.2,target?.z??0]}><mesh rotation={[cue.animation==='scene_wipe'?0:Math.PI/2,0,0]}><torusGeometry args={[cue.animation==='victory_lights'?1.1:.7,.055,8,48]} /><meshBasicMaterial ref={material} color={color} transparent opacity={.8} toneMapped={false}/></mesh><pointLight color={color} intensity={9} distance={6}/></group>;
}

function BattleScene({game,reduced,motion,faces}:{game:GameState;reduced:boolean;motion:number;faces:Record<Candidate,string>}) {return <><color attach="background" args={['#050811']} /><fog attach="fog" args={['#050811',8,18]} /><ambientLight intensity={.8} /><directionalLight position={[2,7,5]} intensity={3.2} castShadow={!reduced} /><spotLight position={[-5,7,2]} color="#ef603d" intensity={16} angle={.52} penumbra={.8} /><spotLight position={[5,7,2]} color="#2cb8ef" intensity={16} angle={.52} penumbra={.8} /><ArenaArchitecture reduced={reduced} /><StylizedFighter candidate="lula" data={game.lula} active={game.active} motion={motion} faceUrl={faces.lula}/><StylizedFighter candidate="bolsonaro" data={game.bolsonaro} active={game.active} motion={motion} faceUrl={faces.bolsonaro}/><EffectBurst key={game.effect?.id ?? 0} effect={game.effect} game={game} motion={motion} /></>}

/** Textura de número de peito, desenhada em canvas (barata e nítida). */
function useNumberTexture(text:string,background:string,foreground:string){
  return useMemo(()=>{
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
    const context=canvas.getContext('2d');
    if(context){
      context.fillStyle=background;context.fillRect(0,0,128,128);
      context.fillStyle=foreground;context.font='bold 92px Arial Narrow, Arial, sans-serif';
      context.textAlign='center';context.textBaseline='middle';context.fillText(text,64,70);
    }
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
  },[text,background,foreground]);
}

/** Pista de atletismo em faixas, com marcas que rolam para dar sensação de velocidade. */
function useTrackTexture(){
  return useMemo(()=>{
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
    const context=canvas.getContext('2d');
    if(context){
      context.fillStyle='#9c4a32';context.fillRect(0,0,256,256);
      context.fillStyle='#ae553b';context.fillRect(0,0,256,10);
      context.strokeStyle='#f3f6f8';context.lineWidth=4;
      for(const y of [8,88,168,248]){context.beginPath();context.moveTo(0,y);context.lineTo(256,y);context.stroke()}
      context.fillStyle='#ffffff26';for(let x=0;x<256;x+=64)context.fillRect(x,12,3,232);
    }
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(14,1);
    return texture;
  },[]);
}

/** Arquibancada estilizada: pontos coloridos de público em um painel longo. */
function useCrowdTexture(){
  return useMemo(()=>{
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;
    const context=canvas.getContext('2d');
    if(context){
      context.fillStyle='#141d2b';context.fillRect(0,0,256,128);
      const palette=['#2f4a66','#3c5f80','#7c3f3a','#44617d','#8a5a3c','#26384d','#5d6f86'];
      for(let row=0;row<12;row++)for(let column=0;column<42;column++){
        context.fillStyle=palette[(row*7+column*3)%palette.length];
        context.beginPath();context.arc(column*6.2+(row%2?3:0)+3,row*10+6,2.4,0,Math.PI*2);context.fill();
      }
      context.fillStyle='#0a111c';for(let row=0;row<12;row++)context.fillRect(0,row*10+9,256,1.6);
    }
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=THREE.RepeatWrapping;texture.repeat.set(9,1);
    return texture;
  },[]);
}

function ClassicLeg({refObject,kneeRef,x,outfit}:{refObject:RefObject<THREE.Group|null>;kneeRef:RefObject<THREE.Group|null>;x:number;outfit:RaceOutfit}){
  const t=outfit.build.limb;
  return <group ref={refObject} position={[x,.82,0]}>
    <mesh position={[0,-.21,0]} scale={[t,1,t]} castShadow><capsuleGeometry args={[.125,.3,5,8]} /><meshStandardMaterial color={outfit.shorts} roughness={.72} /></mesh>
    <group ref={kneeRef} position={[0,-.44,0]}>
      <mesh position={[0,-.2,0]} scale={[t,1,t]} castShadow><capsuleGeometry args={[.1,.3,5,8]} /><meshStandardMaterial color={outfit.skin} roughness={.78} /></mesh>
      <mesh position={[0,-.37,0]} scale={[t,1,t]}><cylinderGeometry args={[.105,.105,.14,10]} /><meshStandardMaterial color={outfit.trim} roughness={.6} /></mesh>
      <mesh position={[0,-.47,.05]} castShadow><boxGeometry args={[.165*t,.095,.3]} /><meshStandardMaterial color={outfit.shoe} roughness={.45} /></mesh>
    </group>
  </group>;
}

function ClassicArm({refObject,elbowRef,x,outfit}:{refObject:RefObject<THREE.Group|null>;elbowRef:RefObject<THREE.Group|null>;x:number;outfit:RaceOutfit}){
  const t=outfit.build.limb;
  return <group ref={refObject} position={[x,1.68,0]}>
    <mesh position={[0,-.17,0]} scale={[t,1,t]} castShadow><capsuleGeometry args={[.095,.24,5,8]} /><meshStandardMaterial color={outfit.sleeve} roughness={.64} /></mesh>
    <group ref={elbowRef} position={[0,-.34,0]}>
      <mesh position={[0,-.15,.04]} rotation={[-.5,0,0]} scale={[t,1,t]} castShadow><capsuleGeometry args={[.082,.24,5,8]} /><meshStandardMaterial color={outfit.skin} roughness={.78} /></mesh>
      <mesh position={[0,-.27,.14]}><sphereGeometry args={[.1,10,8]} /><meshStandardMaterial color={outfit.skin} roughness={.78} /></mesh>
    </group>
  </group>;
}

/** Corredor do estilo clássico (volumes 3D simples), mantido como alternativa no painel. */
function ClassicRunner({candidate,data,motion,faceUrl,offsetX,finalSprint}:{candidate:Candidate;data:GameCompetitor;motion:number;faceUrl:string;offsetX:number;finalSprint:boolean}){
  const group=useRef<THREE.Group>(null),body=useRef<THREE.Group>(null);
  const leftLeg=useRef<THREE.Group>(null),rightLeg=useRef<THREE.Group>(null),leftKnee=useRef<THREE.Group>(null),rightKnee=useRef<THREE.Group>(null);
  const leftArm=useRef<THREE.Group>(null),rightArm=useRef<THREE.Group>(null),leftElbow=useRef<THREE.Group>(null),rightElbow=useRef<THREE.Group>(null);
  const outfit=RACE_OUTFITS[candidate],lane=candidate==='lula'?-RACE_LANE:RACE_LANE,facing=.62;
  const bib=useNumberTexture(outfit.number,outfit.trim,outfit.jersey);
  useEffect(()=>()=>bib.dispose(),[bib]);
  useFrame((state,delta)=>{
    if(!group.current||!body.current)return;
    const t=state.clock.elapsedTime;
    group.current.position.x=THREE.MathUtils.damp(group.current.position.x,offsetX,6,delta);
    const stumbling=data.action==='stumble',celebrating=data.action==='celebrate';
    const effort=stumbling?.35:data.action==='boost'?1.55:data.action==='sprint'||finalSprint?1.28:1;
    const cadence=(9.4+data.speed*210)*effort*(.55+motion*.45);
    const swing=Math.sin(t*cadence)*1.05*outfit.build.stride*motion;
    if(leftLeg.current)leftLeg.current.rotation.x=celebrating?-.2:swing;
    if(rightLeg.current)rightLeg.current.rotation.x=celebrating?.2:-swing;
    if(leftKnee.current)leftKnee.current.rotation.x=-Math.max(0,-swing)*1.5-.12;
    if(rightKnee.current)rightKnee.current.rotation.x=-Math.max(0,swing)*1.5-.12;
    if(leftArm.current)leftArm.current.rotation.x=celebrating?-2.5:stumbling?-1.9:-swing*.75;
    if(rightArm.current)rightArm.current.rotation.x=celebrating?-2.5:stumbling?-2.1:swing*.75;
    if(leftElbow.current)leftElbow.current.rotation.x=celebrating?-.5:-1.35;
    if(rightElbow.current)rightElbow.current.rotation.x=celebrating?-.5:-1.35;
    // Tronco: inclinação de corrida, queda no tropeço e salto na comemoração.
    const lean=stumbling?.5:celebrating?-.1:(.17+effort*.07)*motion;
    body.current.rotation.z=THREE.MathUtils.damp(body.current.rotation.z,-lean,8,delta);
    body.current.rotation.y=facing;
    const bob=celebrating?Math.abs(Math.sin(t*5))*.3:Math.abs(Math.sin(t*cadence))*.055*effort;
    group.current.position.y=(stumbling?-.12:0)+bob*motion;
    group.current.position.z=THREE.MathUtils.damp(group.current.position.z,lane,5,delta);
  });
  return <group ref={group} position={[offsetX,0,lane]}>
    <group ref={body} scale={[.94,.94*outfit.build.height,.94]}>
      <ClassicLeg refObject={leftLeg} kneeRef={leftKnee} x={-.17} outfit={outfit} /><ClassicLeg refObject={rightLeg} kneeRef={rightKnee} x={.17} outfit={outfit} />
      <mesh position={[0,1.4,0]} scale={[outfit.build.width,1,.92]} castShadow><capsuleGeometry args={[.36,.6,8,14]} /><meshStandardMaterial color={outfit.jersey} roughness={.66} /></mesh>
      <mesh position={[0,1.09,0]} scale={[outfit.build.width,1,.93]}><cylinderGeometry args={[.365,.365,.12,16]} /><meshStandardMaterial color={outfit.trim} roughness={.6} /></mesh>
      <mesh position={[0,1.52,.35*outfit.build.width]}><planeGeometry args={[.33,.33]} /><meshBasicMaterial map={bib} toneMapped={false} /></mesh>
      <mesh position={[0,1.72,0]} scale={[outfit.build.width,1,.9]}><sphereGeometry args={[.2,12,10]} /><meshStandardMaterial color={outfit.jersey} roughness={.66} /></mesh>
      <ClassicArm refObject={leftArm} elbowRef={leftElbow} x={-.44*outfit.build.width} outfit={outfit} /><ClassicArm refObject={rightArm} elbowRef={rightElbow} x={.44*outfit.build.width} outfit={outfit} />
      <mesh position={[0,1.98,0]} scale={[1,.55,1]}><cylinderGeometry args={[.19,.21,.3,12]} /><meshStandardMaterial color={outfit.skin} roughness={.78} /></mesh>
      <mesh position={[0,2.3,-.015]} scale={candidate==='lula'?[1.04,.95,.86]:[.91,1.08,.84]} castShadow><sphereGeometry args={[.34,16,12]} /><meshStandardMaterial color={outfit.skin} roughness={.78} /></mesh>
      <CharacterFace candidate={candidate} url={faceUrl} action={data.action} motion={motion} position={[-Math.sin(facing)*.3,2.33,Math.cos(facing)*.3]} scale={.78} yaw={-facing} />
      {data.boost>25&&<group position={[-.75,1.3,0]}>{[0,1,2].map(index=><mesh key={index} position={[-index*.4,index%2?.25:-.2,0]} rotation={[0,0,.1]}><boxGeometry args={[.5+index*.18,.045,.02]} /><meshBasicMaterial color={COLORS[candidate]} transparent opacity={.75-index*.18} toneMapped={false} /></mesh>)}</group>}
      {data.shield>0&&<mesh position={[0,1.35,0]}><sphereGeometry args={[.78,16,12]} /><meshBasicMaterial color={COLORS[candidate]} transparent opacity={.17} toneMapped={false} /></mesh>}
    </group>
  </group>;
}


/* ---------------------------------------------------------------------------
 * Corredor cartoon 2.5D: camadas desenhadas em canvas, montadas num rig 2D e
 * sempre voltadas para a câmera. Dá traço limpo, silhueta forte e animação
 * fluida com custo gráfico muito baixo.
 * ------------------------------------------------------------------------ */

const HIP_Y=RIG.hip,SHOULDER_Y=RIG.shoulder,HEAD_Y=RIG.headY,HEAD_SIZE=RIG.headSize;
const layerSize=partSize;

/** Plano de uma parte do corpo, ancorado no topo (articulação) ou na base. */
function Layer({texture,z=0,anchor='top',size}:{texture:THREE.Texture;z?:number;anchor?:'top'|'bottom'|'center';size?:[number,number]}){
  const [width,height]=size??layerSize(texture);
  const y=anchor==='top'?-height/2:anchor==='bottom'?height/2:0;
  return <mesh position={[0,y,z]}><planeGeometry args={[width,height]} /><meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} /></mesh>;
}

function CartoonLeg({thighRef,kneeRef,footRef,texture,shin,shoe,offset}:{thighRef:RefObject<THREE.Group|null>;kneeRef:RefObject<THREE.Group|null>;footRef:RefObject<THREE.Group|null>;texture:THREE.Texture;shin:THREE.Texture;shoe:THREE.Texture;offset:number}){
  const thighHeight=layerSize(texture)[1],shinHeight=layerSize(shin)[1];
  return <group ref={thighRef} position={[offset*.7,HIP_Y,offset]}>
    <Layer texture={texture} />
    <group ref={kneeRef} position={[0,-thighHeight+.08,0]}>
      <Layer texture={shin} />
      <group ref={footRef} position={[0,-shinHeight+.09,.004]}><group position={[.07,-.03,0]}><Layer texture={shoe} anchor="center" /></group></group>
    </group>
  </group>;
}

function CartoonArm({armRef,elbowRef,upper,fore,offset}:{armRef:RefObject<THREE.Group|null>;elbowRef:RefObject<THREE.Group|null>;upper:THREE.Texture;fore:THREE.Texture;offset:number}){
  const upperHeight=layerSize(upper)[1];
  return <group ref={armRef} position={[offset*1.7,SHOULDER_Y,offset]}>
    <Layer texture={upper} />
    <group ref={elbowRef} position={[0,-upperHeight+.08,0]}><Layer texture={fore} /></group>
  </group>;
}

function CartoonRunner({candidate,data,motion,faceUrl,offsetX,finalSprint,defeated}:{candidate:Candidate;data:GameCompetitor;motion:number;faceUrl:string;offsetX:number;finalSprint:boolean;defeated:boolean}){
  const art=useMemo<RunnerArt>(()=>buildRunnerArt(candidate),[candidate]);
  useEffect(()=>()=>art.dispose(),[art]);
  const [head,setHead]=useState<THREE.Texture|null>(null);
  useEffect(()=>{
    let cancelled=false,current:THREE.Texture|null=null;
    const apply=(texture:THREE.Texture)=>{if(cancelled){texture.dispose();return}current?.dispose();current=texture;setHead(texture)};
    const fallback=`/characters/${candidate}-stylized.png`;
    loadHeadTexture(faceUrl,candidate).then(apply)
      .catch(()=>{if(faceUrl!==fallback)return loadHeadTexture(fallback,candidate).then(apply)})
      .catch(()=>undefined);
    return()=>{cancelled=true;current?.dispose()};
  },[faceUrl,candidate]);

  const root=useRef<THREE.Group>(null),billboard=useRef<THREE.Group>(null),body=useRef<THREE.Group>(null);
  const torso=useRef<THREE.Group>(null),headRef=useRef<THREE.Group>(null),shadow=useRef<THREE.Mesh>(null),lines=useRef<THREE.Group>(null);
  const thighFront=useRef<THREE.Group>(null),kneeFront=useRef<THREE.Group>(null),footFront=useRef<THREE.Group>(null);
  const thighBack=useRef<THREE.Group>(null),kneeBack=useRef<THREE.Group>(null),footBack=useRef<THREE.Group>(null);
  const armFront=useRef<THREE.Group>(null),elbowFront=useRef<THREE.Group>(null),armBack=useRef<THREE.Group>(null),elbowBack=useRef<THREE.Group>(null);
  const phase=useRef(Math.random()*6.28),puffs=useRef<Array<THREE.Mesh|null>>([null,null,null]);
  const outfit=art.outfit,lane=candidate==='lula'?-RACE_LANE:RACE_LANE;

  useFrame((state,delta)=>{
    if(!root.current||!body.current)return;
    const step=Math.min(delta,.05),time=state.clock.elapsedTime;
    root.current.position.x=THREE.MathUtils.damp(root.current.position.x,offsetX,6,step);
    if(billboard.current)billboard.current.quaternion.copy(state.camera.quaternion);

    const stumbling=data.action==='stumble',celebrating=data.action==='celebrate';
    const boosting=data.action==='boost'||data.action==='overtake',sprinting=data.action==='sprint'||finalSprint;
    const resting=celebrating||defeated||data.action==='idle'||data.speed<.0015;
    const cadence=stumbling?3.4:boosting?15.5:sprinting?13.2:10.6;
    if(!resting)phase.current+=step*cadence*(.55+motion*.45);
    const p=phase.current,swing=outfit.build.stride;

    // Alvos de cada articulação conforme a ação; o amortecimento cuida da transição.
    let legFront=Math.sin(p)*.58*swing,legBack=Math.sin(p+Math.PI)*.58*swing;
    let bendFront=-1.35*Math.max(0,Math.cos(p+1.1)),bendBack=-1.35*Math.max(0,Math.cos(p+1.1+Math.PI));
    let shoulderFront=-Math.sin(p)*.72-.1,shoulderBack=Math.sin(p)*.72-.1;
    let elbow=-.82+Math.sin(p)*.42,elbowOther=-.82-Math.sin(p)*.42;
    let lean=-.14-(sprinting?.1:0)-(boosting?.16:0),bob=.05*(1-Math.cos(p*2))/2,lift=0,nod=0;

    if(stumbling){
      legFront=.95;legBack=-.6;bendFront=-.25;bendBack=-1.45;
      shoulderFront=-2.35;shoulderBack=-1.5;elbow=-.35;elbowOther=-.6;
      lean=-.66;bob=0;lift=-.15;nod=-.22;
    }else if(celebrating){
      const hop=Math.abs(Math.sin(time*5.2));
      legFront=.26;legBack=-.22;bendFront=-.4;bendBack=-.45;
      shoulderFront=2.72;shoulderBack=2.62;elbow=-.18;elbowOther=-.24;
      lean=.05;bob=0;lift=hop*.26*motion;nod=.06;
    }else if(defeated){
      legFront=.12;legBack=-.12;bendFront=-.18;bendBack=-.14;
      shoulderFront=.1;shoulderBack=-.08;elbow=-.3;elbowOther=-.26;
      lean=-.06;bob=0;lift=-.05+Math.sin(time*1.3)*.012;nod=.34;
    }else if(resting){
      const breath=Math.sin(time*1.7);
      legFront=.14;legBack=-.14;bendFront=-.16;bendBack=-.12;
      shoulderFront=.12;shoulderBack=-.1;elbow=-.3;elbowOther=-.28;
      lean=-.04;bob=0;lift=breath*.014*motion;nod=breath*.03;
    }

    const set=(group:RefObject<THREE.Group|null>,angle:number,speed=20)=>{if(group.current)group.current.rotation.z=THREE.MathUtils.damp(group.current.rotation.z,angle,speed,step)};
    set(thighFront,legFront);set(thighBack,legBack);set(kneeFront,bendFront);set(kneeBack,bendBack);
    // o pé tende a ficar paralelo ao chão, como numa passada de verdade
    set(footFront,THREE.MathUtils.clamp(-(legFront+bendFront)*.8,-.85,.5),16);
    set(footBack,THREE.MathUtils.clamp(-(legBack+bendBack)*.8,-.85,.5),16);
    set(armFront,shoulderFront,celebrating?9:20);set(armBack,shoulderBack,celebrating?9:20);
    set(elbowFront,elbow);set(elbowBack,elbowOther);
    body.current.rotation.z=THREE.MathUtils.damp(body.current.rotation.z,lean+(resting?0:Math.sin(p*2)*.022),10,step);
    body.current.position.y=THREE.MathUtils.damp(body.current.position.y,(bob*motion)+lift,14,step);
    if(headRef.current){
      headRef.current.rotation.z=THREE.MathUtils.damp(headRef.current.rotation.z,-lean*.55+nod+(resting?0:Math.sin(p)*.04),12,step);
      headRef.current.position.y=THREE.MathUtils.damp(headRef.current.position.y,HEAD_Y+bob*.35*motion,14,step);
    }
    root.current.position.z=THREE.MathUtils.damp(root.current.position.z,lane,5,step);
    if(shadow.current){
      const material=shadow.current.material as THREE.MeshBasicMaterial;
      material.opacity=THREE.MathUtils.damp(material.opacity,celebrating?.42:.72,8,step);
      shadow.current.scale.setScalar(THREE.MathUtils.damp(shadow.current.scale.x,celebrating?.82:1,8,step));
    }
    // poeira: cada sopro nasce no pé que acabou de tocar o chão e se dissolve para trás
    puffs.current.forEach((puff,index)=>{
      if(!puff)return;
      const life=((p/Math.PI)+index*.66)%2/2;
      const visible=!resting&&!stumbling&&motion>.15;
      puff.visible=visible&&life<.9;
      if(!puff.visible)return;
      puff.position.set(-.14-life*.62,.06+life*.09,0);
      puff.scale.setScalar(.3+life*.6);
      (puff.material as THREE.MeshBasicMaterial).opacity=Math.max(0,.62-life*.72)*motion;
    });
    if(lines.current){
      lines.current.visible=boosting||sprinting;
      lines.current.position.x=-.62-Math.abs(Math.sin(p*2))*.08;
    }
  });

  const torsoSize=layerSize(art.torso),neckSize=layerSize(art.neck);
  return <group ref={root} position={[offsetX,0,lane]}>
    <mesh ref={shadow} rotation={[-Math.PI/2,0,0]} position={[.05,.012,0]}>
      <planeGeometry args={[1.5,.62]} />
      <meshBasicMaterial map={art.shadow} transparent opacity={.72} depthWrite={false} toneMapped={false} />
    </mesh>
    <group ref={billboard}>
      <group ref={body} position={[0,0,0]} scale={[1,outfit.build.height,1]}>
        <group ref={lines} position={[-.62,1.25,-.06]} visible={false}><Layer texture={art.speedLines} anchor="center" /></group>
        {[0,1,2].map(index=><mesh key={index} ref={element=>{puffs.current[index]=element}} position={[-.2,.08,-.08]} visible={false}>
          <planeGeometry args={[.42,.42]} /><meshBasicMaterial map={art.puff} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>)}
        <CartoonArm armRef={armBack} elbowRef={elbowBack} upper={art.upperArmBack} fore={art.forearmBack} offset={-.07} />
        <CartoonLeg thighRef={thighBack} kneeRef={kneeBack} footRef={footBack} texture={art.thighBack} shin={art.shinBack} shoe={art.shoe} offset={-.06} />
        <group ref={torso} position={[0,HIP_Y-.07,0]}><Layer texture={art.torso} anchor="bottom" size={torsoSize} /></group>
        <group position={[0,SHOULDER_Y+.13,-.015]}><Layer texture={art.neck} size={neckSize} /></group>
        <CartoonLeg thighRef={thighFront} kneeRef={kneeFront} footRef={footFront} texture={art.thighFront} shin={art.shinFront} shoe={art.shoe} offset={.06} />
        <group ref={headRef} position={[0,HEAD_Y,.07]}>
          {head&&<Layer texture={head} anchor="center" size={[HEAD_SIZE,HEAD_SIZE]} />}
        </group>
        <CartoonArm armRef={armFront} elbowRef={elbowFront} upper={art.upperArmFront} fore={art.forearmFront} offset={.1} />
        {data.shield>0&&<mesh position={[0,1.3,.12]}><circleGeometry args={[.82,28]} /><meshBasicMaterial color={COLORS[candidate]} transparent opacity={.16} depthWrite={false} toneMapped={false} /></mesh>}
      </group>
    </group>
  </group>;
}

/** Marcação de largada ou chegada atravessando a pista. */
function RaceGate({x,label,color}:{x:number;label:'LARGADA'|'CHEGADA';color:string}){
  return <group position={[x,0,0]}>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.012,0]}><planeGeometry args={[.42,8.4]} /><meshBasicMaterial color="#f2f6f9" toneMapped={false} /></mesh>
    {label==='CHEGADA'&&Array.from({length:14},(_,index)=><mesh key={index} rotation={[-Math.PI/2,0,0]} position={[0,.02,-4+index*.6+(index%2?.3:0)]}><planeGeometry args={[.4,.3]} /><meshBasicMaterial color={index%2?'#11161f':'#f2f6f9'} toneMapped={false} /></mesh>)}
    {[-4.3,4.3].map(z=><mesh key={z} position={[0,1.95,z]}><cylinderGeometry args={[.16,.2,3.9,8]} /><meshStandardMaterial color="#223042" metalness={.5} /></mesh>)}
    <mesh position={[0,3.78,0]}><boxGeometry args={[.22,.95,9]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.4} /></mesh>
    <mesh position={[0,4.4,0]}><boxGeometry args={[.26,.18,9.2]} /><meshStandardMaterial color="#f2f6f9" /></mesh>
  </group>;
}

function RaceTrack({game,reduced,motion,leaderProgress}:{game:GameState;reduced:boolean;motion:number;leaderProgress:number}){
  const track=useTrackTexture(),crowd=useCrowdTexture(),spread=RACE_SPREAD;
  useEffect(()=>()=>{track.dispose();crowd.dispose()},[track,crowd]);
  useFrame((_state,delta)=>{
    const speed=(game.lula.speed+game.bolsonaro.speed)/2;
    track.offset.x+=delta*speed*44*motion;
    crowd.offset.x+=delta*speed*11*motion;
  });
  const finishX=RACE_ANCHOR+(1-leaderProgress)*spread,startX=RACE_ANCHOR-leaderProgress*spread;
  return <group>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,0,0]} receiveShadow><planeGeometry args={[90,8.6]} /><meshStandardMaterial map={track} roughness={.92} /></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.02,-9.4]} receiveShadow><planeGeometry args={[90,10]} /><meshStandardMaterial color="#1d4a30" roughness={.95} /></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.02,5.9]}><planeGeometry args={[90,2.6]} /><meshStandardMaterial color="#17351f" roughness={.95} /></mesh>
    <mesh position={[0,.65,-5.1]}><boxGeometry args={[90,1.3,.3]} /><meshStandardMaterial color="#121a26" roughness={.8} /></mesh>
    <mesh position={[0,2.6,-6.1]} rotation={[-.26,0,0]}><planeGeometry args={[90,4.6]} /><meshStandardMaterial map={crowd} roughness={.95} /></mesh>
    <mesh position={[0,4.8,-7]}><boxGeometry args={[90,.8,.4]} /><meshStandardMaterial color="#0d1420" /></mesh>
    {Array.from({length:reduced?4:7},(_,index)=>{const x=-30+index*10;return <group key={index} position={[x,0,-7.2]}>
      <mesh position={[0,4.6,0]}><cylinderGeometry args={[.11,.15,9.2,6]} /><meshStandardMaterial color="#1a2432" metalness={.7} /></mesh>
      <mesh position={[0,9.1,.5]}><boxGeometry args={[2.1,.42,.5]} /><meshBasicMaterial color="#dceeff" toneMapped={false} /></mesh>
      <pointLight position={[0,8.4,2]} color="#cfe7ff" intensity={reduced?5:11} distance={17} />
    </group>;})}
    {startX>-26&&startX<26&&<RaceGate x={startX} label="LARGADA" color="#36b9ef" />}
    {finishX>-26&&finishX<26&&<RaceGate x={finishX} label="CHEGADA" color="#f2c05e" />}
  </group>;
}

/**
 * Posição horizontal de cada corredor na tela. Em disputas muito apertadas os dois
 * se esconderiam um atrás do outro na vista lateral, então mantemos uma separação
 * mínima preservando quem está à frente.
 */
function raceOffsets(game:GameState):Record<Candidate,number>{
  const leaderProgress=Math.max(game.lula.raceProgress,game.bolsonaro.raceProgress);
  const place=(candidate:Candidate)=>RACE_ANCHOR-Math.min(RACE_MAX_GAP,(leaderProgress-game[candidate].raceProgress)*RACE_SPREAD);
  let lula=place('lula'),bolsonaro=place('bolsonaro');
  const distance=bolsonaro-lula;
  if(Math.abs(distance)<RACE_MIN_SEPARATION){
    const middle=(lula+bolsonaro)/2,half=RACE_MIN_SEPARATION/2,ahead=distance>=0?1:-1;
    lula=middle-ahead*half;bolsonaro=middle+ahead*half;
  }
  return {lula,bolsonaro};
}

function RaceScene({game,reduced,motion,faces,runnerStyle}:{game:GameState;reduced:boolean;motion:number;faces:Record<Candidate,string>;runnerStyle:RunnerStyle}) {
  const leaderProgress=Math.max(game.lula.raceProgress,game.bolsonaro.raceProgress);
  const places=raceOffsets(game),offset=(candidate:Candidate)=>places[candidate];
  return <>
    <color attach="background" args={['#0a1526']} /><fog attach="fog" args={['#0a1526',26,62]} />
    <ambientLight intensity={1.15} /><hemisphereLight args={['#9fd2ff','#2a1a12',.8]} />
    <directionalLight position={[6,12,8]} intensity={2.6} castShadow={!reduced} />
    <RaceTrack game={game} reduced={reduced} motion={motion} leaderProgress={leaderProgress} />
    {(['lula','bolsonaro'] as Candidate[]).map(candidate=>runnerStyle==='classic'
      ? <ClassicRunner key={candidate} candidate={candidate} data={game[candidate]} motion={motion} faceUrl={faces[candidate]} offsetX={offset(candidate)} finalSprint={game.finalSprint} />
      : <CartoonRunner key={candidate} candidate={candidate} data={game[candidate]} motion={motion} faceUrl={faces[candidate]} offsetX={offset(candidate)} finalSprint={game.finalSprint} defeated={Boolean(game.winner)&&game.winner!==candidate} />)}
    <EffectBurst key={game.effect?.id ?? 0} effect={game.effect} game={game} motion={motion} anchor={candidate=>[offset(candidate),1.5,candidate==='lula'?-RACE_LANE:RACE_LANE]} />
  </>;
}

export function ArenaScene({game,reduced,cameraMode,animationIntensity,phase,audioCue,characterAssets,assetVersion,runnerStyle='cartoon'}:{game:GameState;reduced:boolean;cameraMode:CameraMode;animationIntensity:number;phase:Phase;audioCue:AudioCue|null;characterAssets:Record<Candidate,string>;assetVersion:number;runnerStyle?:RunnerStyle}) {const motion=animationIntensity/100,version=(url:string)=>`${url}${url.includes('?')?'&':'?'}v=${assetVersion}`,faces={lula:version(characterAssets.lula),bolsonaro:version(characterAssets.bolsonaro)};return <div className={`arena-canvas game-${game.mode}`} aria-label={`Simulação 3D fictícia em modo ${game.mode==='battle'?'batalha':'corrida'}`}><Canvas dpr={reduced?1:[1,1.5]} shadows={!reduced} camera={{position:[0,3.3,8.4],fov:43}} gl={{alpha:false,antialias:!reduced,powerPreference:'high-performance'}}><CameraDirector game={game} mode={cameraMode} motion={motion} />{game.mode==='battle'?<BattleScene game={game} reduced={reduced} motion={motion} faces={faces}/>:<RaceScene game={game} reduced={reduced} motion={motion} faces={faces} runnerStyle={runnerStyle}/>}<AudioCueEffect key={audioCue?.id??'none'} cue={audioCue} game={game} motion={motion}/></Canvas>{phase==='live'&&<div className="simulation-live"><span /> SIMULAÇÃO AUTOMÁTICA</div>}</div>}
