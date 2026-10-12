# Assets dos personagens

- `lula-stylized.png`: textura facial estilizada gerada para o LIVE ARENA 3D a partir do retrato oficial de referência listado em `public/portraits/README.md`.
- `bolsonaro-stylized.png`: textura facial estilizada gerada para o LIVE ARENA 3D a partir do retrato oficial de referência listado em `public/portraits/README.md`.

Ambos são PNG RGBA transparentes, com no máximo 512 px, usados sobre o corpo 3D. São representações sintéticas e estilizadas para uma simulação fictícia de entretenimento; não representam fotografias de acontecimentos reais nem implicam endosso.

## Substituição

A forma recomendada é usar **Admin → Personagens → Trocar asset**. O servidor aceita PNG, JPG ou WebP de até 4 MB, valida a assinatura e salva a versão ativa em `data/characters/`. PNG ou WebP com transparência produz o melhor resultado.

Para trocar o padrão empacotado, mantenha os nomes `lula-stylized.png` e `bolsonaro-stylized.png`, preserve fundo transparente e enquadramento frontal do rosto, e execute `npm run build` novamente.

Prompt-base usado: recorte de cabeça reconhecível e respeitoso, caricatura 3D semi-realista, visão quase frontal, iluminação de arena, bordas alfa limpas, sem texto, logotipo, faixa presidencial ou objetos adicionais.

## Figurino

O figurino é **procedural** (geometria 3D low-poly + cores), definido em `src/outfits.ts` e compartilhado entre a cena 3D (`ArenaScene.tsx`) e a prévia do Admin. Não altera os PNGs de rosto. Para ajustar cores ou silhueta, edite apenas `OUTFITS`.

- **Lula**: terno azul-marinho, camisa branca, gravata vermelha, boton de estrela, silhueta larga.
- **Bolsonaro**: terno cinza-grafite claro, camisa branca, gravata verde com listras amarelas, boton de bandeira, silhueta magra.

## Corredores (modo principal)

No modo corrida, estes mesmos PNGs viram a cabeça do boneco: o sistema recorta a margem transparente, aplica contorno de adesivo e encaixa o rosto no corpo desenhado em `src/characters/runner-art.ts`. Vale manter fundo transparente e o rosto preenchendo bem o quadro — a margem vazia é descartada automaticamente.

O corpo, as cores e a silhueta dos corredores ficam em `RACE_OUTFITS` (`src/outfits.ts`); o desenho das peças e o esqueleto, em `src/characters/runner-art.ts`.
