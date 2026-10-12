# LIVE ARENA 3D — Lula x Bolsonaro

Jogo 3D local de entretenimento para transmissões autorizadas. O modo principal é a **corrida presidencial** em vista lateral, com a batalha mantida como modo secundário. Inclui corrida autônoma, batalha autônoma, personagens estilizados, câmera cinematográfica, overlay vertical para OBS, painel autenticado, estado persistente, histórico em SQLite, watchdog e adaptador opcional para eventos do TikTok LIVE.

> **Aviso:** os números representam interações na LIVE, não votos nem pesquisa eleitoral. O aplicativo não inicia transmissões, não cria espectadores ou interações falsas e não contorna bloqueios da plataforma.

## Requisitos no Mac

- macOS em Apple Silicon ou Intel
- Node.js 20 ou superior
- OBS Studio
- Conta com autorização do TikTok para transmissão externa, caso use o OBS

## Instalação

```bash
npm install
cp .env.example .env
openssl rand -hex 32
```

Copie o resultado do último comando para `ADMIN_TOKEN` no `.env`. Em seguida:

```bash
npm run check
npm run dev
```

No desenvolvimento:

- painel: `http://127.0.0.1:5173/admin`
- central de bordões: `http://127.0.0.1:5173/admin/bordoes`
- central de testes: `http://127.0.0.1:5173/admin/testes`
- monitor do moderador: `http://127.0.0.1:5173/monitor`
- overlay: `http://127.0.0.1:5173/overlay`

Para a operação normal, faça o build e use o serviço único:

```bash
npm run build
./scripts/start.sh
```

As páginas ficam na porta 8787. O navegador administrativo pode ser fechado; o Node continua executando. Para encerrar:

```bash
./scripts/stop.sh
```

O encerramento usa `SIGTERM`, fecha o coletor, persiste o estado, finaliza WebSocket e SQLite e só então encerra o processo. A base fica em `data/live-arena.sqlite` com modo WAL para recuperação segura.

## Ativar o modo automático

O modo automático vem **ativado por padrão**. Assim que o servidor termina de iniciar, ele abre a primeira rodada sem depender de `/admin`, `/admin/testes` ou `/overlay`. O ciclo é calculado e persistido no Node; fechar todos os navegadores não interrompe a corrida.

```text
PREPARAÇÃO → CONTAGEM REGRESSIVA (5 s) → CORRIDA → RESULTADO (10 s) → REINÍCIO AUTOMÁTICO
```

Para configurar, abra `/admin`, autentique com `ADMIN_TOKEN` e use **Operação supervisionada**. Ali é possível desativar/ativar o modo automático, pausar, continuar, reiniciar a rodada, encerrar somente a rodada ou **Encerrar ciclo**. O estado atual e a contagem para a próxima transição são compartilhados com `/admin/testes` e `/overlay`.

Ao ser ativado enquanto o sistema está ocioso, o ciclo começa imediatamente:

```text
abertura → jogo autônomo → resultado (salvo) → troca de cenário → nova rodada
```

O jogo reinicia em condições equilibradas a cada abertura, mas vitórias, rodadas e eventos anteriores permanecem no SQLite. Se o processo reiniciar, fase, cronômetro, energia, progresso e placar são restaurados. Uma parada de emergência também é restaurada e nunca é liberada automaticamente.

O botão **Pausar** congela a transição atual; **Continuar automação** mantém o tempo restante. **Encerrar rodada** mostra o resultado e preserva o histórico. **Encerrar ciclo** também desativa a repetição automática. Nada aqui inicia ou reinicia uma transmissão pública.

## Modos de jogo 3D

### Batalha

Dois personagens provisórios construídos com geometria Three.js se movimentam e lutam sem violência gráfica. O motor do servidor escolhe avanço, recuo, ataque de energia, defesa, esquiva e especial. Há detecção de alcance, redução de dano ao bloquear, recuperação de energia de ação, impactos luminosos e comemoração do vencedor.

A batalha não depende de comentários ou presentes. Se o cronômetro terminar antes de uma energia chegar a zero, vence quem conservar mais energia.

### Corrida (modo principal)

Os dois personagens correm a pé em uma pista de atletismo, em vista lateral com lente longa, com arquibancada, refletores, linha de largada e linha de chegada. A corrida acontece sozinha, sem depender de nenhuma interação do público.

O motor do servidor controla:

- avanço contínuo com oscilação de ritmo;
- compensação elástica, que mantém a disputa próxima sem decidir o vencedor antecipadamente;
- eventos automáticos de pista — super arrancada, tropeço, impulso e escudo;
- ultrapassagens detectadas em tempo real, com bordão e destaque no overlay;
- reta final: nos últimos 15% os dois entram em sprint;
- chegada imediata ao alcançar 100%; se o limite de tempo terminar antes, resultado pela distância/posição, com empate quando a diferença fica dentro da tolerância; placar e histórico permanecem no SQLite.

A duração padrão é **120 segundos**. No painel há atalhos de 2, 3, 5, 7 e 10 minutos, além de duração personalizada entre 60 e 3.600 segundos. Esse valor é o **tempo máximo**, não uma duração mínima: o primeiro corredor que alcançar 100% vence e encerra a corrida imediatamente. Se os dois cruzarem no mesmo ciclo, o motor interpola o instante da passagem; diferença indistinguível resulta em empate. Turbo e presentes podem antecipar legitimamente a chegada.

#### Itens e ações especiais

| Item | O que faz | Como é acionado |
| --- | --- | --- |
| Impulso | pequeno empurrão | comentário identificado, evento de pista ou painel |
| Super arrancada | explosão de velocidade curta | evento de pista ou painel |
| Turbo | impulso longo e forte | presente configurado ou painel |
| Escudo | anula o próximo tropeço | evento de pista ou painel |
| Tropeço | o corredor perde o ritmo | evento de pista ou painel |

Os contadores de cada item aparecem nas colunas laterais do overlay e no painel. Nada é inventado: sem evento real, a corrida continua apenas com os eventos automáticos de pista.

#### Layout do overlay (1080×1920)

De cima para baixo: selo **AO VIVO**, título e cronômetro; **placar** com retrato cartoon, barra de progresso, percentual, metros restantes, vitórias e destaque de quem lidera; **chamadas** “DIGITE 13 / DIGITE 22” em cartões; **pista** ao centro com estádio, arquibancada animada, placas de LED, marcas de distância e pórtico de chegada; **colunas de poderes** nas laterais (impulso, arrancada, turbo, escudo, tropeço), com contador e atalho; rodapé curto com a meta de curtidas e o último evento. O aviso de teste é só um selo pequeno **MODO TESTE** e uma linha discreta “paródia fictícia · não é pesquisa eleitoral”.

O botão de som do overlay só aparece ao passar o mouse, para não entrar na transmissão.

#### Os corredores

Desenhados **100% em vetor no Canvas 2D** ([src/race/characters.ts](src/race/characters.ts)), em estilo cartoon esportivo, **sem nenhuma foto**. Cada um tem esqueleto articulado (quadril, joelho, tornozelo, ombro, cotovelo) e cabeça de caricatura com expressões: sorriso, esforço, grito, tontura, alegria e tristeza.

- **Lula:** cabelo e barba cheia grisalhos, sobrancelhas grossas, nariz largo, agasalho vermelho com faixas brancas, número 13, silhueta mais larga.
- **Bolsonaro:** sem barba, cabelo curto escuro penteado de lado e grisalho nas têmporas, rosto longo com queixo marcado, olhos claros, camisa verde com mangas amarelas, short azul, meião branco, número 22, silhueta magra.

Animações: aquecimento parado, posição de largada, corrida com ciclo real de passada, reta final, turbo (com rastro e linhas de velocidade), tropeço com estrelinhas, reação de ultrapassagem, vitória pulando e derrota curvado. Há poeira na passada, sombra, escudo animado e confete no resultado.

Em **Personagens → Bonecos da corrida** fica a prévia animada de cada um. O rosto enviado no painel continua valendo só para o modo batalha.

#### Presentes da corrida (colunas laterais)

Em **Painel → 🎁 PRESENTES DA CORRIDA** cada presente tem: imagem (PNG/WebP transparente de preferência, até 4 MB, exibida sem deformar), nome, **ID real do TikTok**, coluna (Lula à esquerda, Bolsonaro à direita), efeito, **quem recebe** (o corredor da coluna ou o rival), intensidade, duração, pontos, ordem, ativo/inativo e botão de teste.

O efeito vale no motor de verdade: impulso, arrancada e turbo aceleram e, com duração, não perdem força nesse tempo; escudo protege pela duração configurada; tropeço derruba o corredor-alvo pela duração (e é anulado por escudo ativo). Cada presente recebido destaca o ícone, mostra “+1”, soma no contador da rodada, toca o som de presente (respeitando o AUDIO_SAFE_MODE) e entra no histórico.

Os presentes vêm do **infográfico neon** do operador (`presentes-originais/`): 10 pares de mesmo valor, um presente diferente em cada coluna, com a funcionalidade do meio aplicada aos dois. Nomes e preços conferem com as capturas do painel de presentes do TikTok. Os ícones (`public/presentes/`) são recortes do infográfico com o fundo removido — não são as imagens oficiais; troque pelo painel se quiser. **Nenhum ID do TikTok foi inventado**: até você informar o ID, o presente funciona só nos testes.

| Moedas | Lula | Bolsonaro | Efeito |
| --- | --- | --- | --- |
| 1 | Rose | Rosa branca | IMPULSO |
| 1 | Heart Me | Palmas | ACELERAÇÃO LEVE |
| 10 | Rosa | Mini dino | SUPER IMPULSO |
| 30 | Rosquinha | Capybara | TURBO |
| 99 | Chapéu e Bigode | Grou de papel | ESCUDO (8 s) |
| 149 | Ney místico | Clarinete do groove | RECUPERAÇÃO (sai do tropeço) |
| 199 | Coroa | Coqueiro | ULTRA TURBO |
| 299 | Luvas de boxe | Corgi | SUPER TURBO (8 s) |
| 399 | Dança do Cacto | Boa noite | EFEITO ALEATÓRIO |
| 500 | Pistola de dinheiro | Você é demais | PODER ESPECIAL |

No overlay, cada coluna mostra 5 presentes por vez e alterna; o presente recém-recebido sempre aparece. Se o mesmo ID for cadastrado nas duas colunas, vale o time do último comentário (13 ou 22) de quem enviou.

Na **Central de Testes → Presentes da corrida** há um botão por presente: gera um evento SIMULADO pelo mesmo caminho dos presentes reais, sem contar como presente real.

#### Margens de segurança do TikTok

O app do TikTok cobre ~9% do topo (perfil e espectadores) e ~25% de baixo (comentários, campo de texto e botões). O título, o placar, as chamadas, as colunas e a pista ficam entre 9,5% e 75% da altura; só a meta de curtidas fica abaixo disso.

#### Atalhos dos poderes

Em **Configurações → Corrida**, cada poder tem um texto de atalho (`{n}` vira 13 ou 22). Os padrões descrevem o que o jogo faz de verdade: impulso = comentário, turbo = presente, os demais são automáticos.

#### Distância, duração e comandos

- **Distância da pista:** aparece no placar e na contagem de metros restantes.
- **Duração de uma corrida limpa:** tempo de referência sem tropeços nem impulsos; define a velocidade-base.
- **Comando no overlay:** os textos `DIGITE 13 PARA LULA CORRER` e `DIGITE 22 PARA BOLSONARO CORRER` são editáveis. Mantenha-os coerentes com as palavras-chave, que aceitam uma lista separada por vírgula (`13, LULA`).

#### Testar na pista

Em **Corrida → Testar itens na pista**, com uma corrida em andamento, cada item pode ser disparado para qualquer um dos dois. Os disparos ficam registrados na auditoria de eventos.

### Batalha (modo secundário)

Mantida integralmente: dois personagens de terno lutam sem violência gráfica, com avanço, recuo, ataque de energia, defesa, esquiva e especial.

Na configuração **Alternar corrida/batalha**, rodadas ímpares usam corrida e rodadas pares usam batalha. Alterar o modo durante uma rodada afeta apenas a próxima abertura.

### Controles visuais e de áudio

- **Dificuldade 1–5:** altera frequência de decisões e reações dos personagens, igualmente para os dois lados.
- **Câmera dinâmica:** alterna automaticamente entre cinco enquadramentos; na corrida todos são laterais e acompanham o par de corredores.
- **Plano aberto/fechado:** mantém um enquadramento mais estável.
- **Intensidade visual:** ajusta movimentos secundários, câmera e efeitos sem alterar o resultado do jogo.
- **Trilha e efeitos:** volumes independentes; o botão do overlay silencia somente aquela fonte do navegador.
- **Desempenho reduzido:** reduz resolução interna, sombras, luzes e elementos de cenário para Macs com menos GPU.

Na corrida há tiro de largada, leito sonoro de estádio, impulso, tropeço, ultrapassagem e reta final. Os sons são sintetizados com Web Audio e não exigem arquivos ou serviços externos. Navegadores comuns podem exigir uma interação antes de liberar áudio; a fonte Navegador do OBS deve estar configurada para reproduzir áudio.

### AUDIO_SAFE_MODE (silêncio por padrão)

O servidor **sempre inicia em modo seguro de áudio**: uma página recém-aberta não cria `AudioContext`, nenhum som é disparado, e todo cliente recebe "som desligado" — inclusive páginas antigas que ficaram abertas. Se a mesma página já estava autorizada, suas fontes são interrompidas, mas o contexto fica preservado para não ser recriado entre rodadas. A corrida e as animações continuam normalmente, em silêncio.

Para ouvir, abra **Central de Testes → DIAGNÓSTICO DE ÁUDIO → HABILITAR ÁUDIO + TESTE CURTO**. A operação confere a biblioteca, libera o diretor e envia ao `/overlay` um efeito procedural curto em volume baixo. Se o navegador mantiver o `AudioContext` em `suspended` ou ainda não o tiver criado, aparece **HABILITAR ÁUDIO** no próprio overlay; clique nele no navegador ou use **Interagir** na fonte Navegador do OBS. Um clique no painel administrativo não autoriza o contexto de outra página.

O histórico do diagnóstico confirma as quatro etapas do teste: **carregado**, **iniciou/tocou** e **encerrou**. **SILENCIAR TUDO** volta ao modo seguro, esvazia a fila e interrompe todas as fontes imediatamente. O `AudioContext` só é fechado quando a página do overlay é realmente encerrada ou recarregada.

É possível iniciar com `AUDIO_SAFE_MODE=false` apenas em um ambiente já validado, mas a configuração recomendada para transmissão é `true`: cada reinicialização exige uma nova autorização explícita e impede o retorno do ruído contínuo.

**Página antiga aberta:** se o diagnóstico avisar “overlay com código antigo”, feche e reabra a janela. No OBS, use **Propriedades da fonte → Atualizar cache da página atual**.

### Continuidade do áudio entre corridas

O `/overlay` mantém **uma única instância do AudioManager e um único `AudioContext` por sessão da página**. A passagem por resultado, intervalo e nova largada limpa apenas a fila e as fontes temporárias da rodada anterior; preserva autorização do navegador, volumes, arquivos decodificados e o barramento de saída. `AudioContext.close()` é reservado ao encerramento/recarregamento real da página.

Na Central de Testes e no diagnóstico do painel aparecem: estado do contexto, autorização, `AUDIO_SAFE_MODE`, volume, rodadas observadas pelo mesmo mixer, último evento recebido, último som tocado, erro mais recente e o identificador da sessão do overlay. Se esse identificador mudar, o overlay foi efetivamente recarregado. As transições de resultado e abertura também são registradas no SQLite como **Continuidade de áudio na transição de rodada**.

Uma nova rodada não exige outro clique. Uma **recarga real do Browser Source**, reinicialização do navegador/OBS ou reinicialização do servidor continua podendo exigir autorização: o aplicativo informa isso e não tenta contornar a política de autoplay. Em operação use `./scripts/start.sh`; `npm run dev` reinicia serviços quando arquivos-fonte são alterados e não é indicado para uma transmissão.

### Como o áudio é gerenciado

Existe um gerenciador único por página ([src/audio/arena-audio.ts](src/audio/arena-audio.ts)), com um só `AudioContext`:

- a saída passa por um limitador antes do alto-falante, e o aplicativo abre em volume moderado;
- quatro canais independentes — **MUSIC**, **VOICE**, **SFX** e **PRIORITY** — compartilham o mesmo contexto e podem tocar simultaneamente;
- **nenhum ruído sintético**: só notas afinadas e os arquivos enviados pelo operador;
- **música de fundo só a partir de um arquivo** enviado na vaga “Música de fundo”; fica desligada por padrão e só toca durante a corrida;
- volume geral de efeitos e volume por categoria: corrida, bordões, memes, torcida, largada/resultado;
- intervalo mínimo configurável entre repetições do mesmo efeito (padrão 400 ms), com no máximo três efeitos SFX simultâneos;
- **MUTAR TUDO** no painel ou **SOM OFF** no overlay cortam a saída na hora.

### Mixagem dinâmica

Abra `/admin` e, em **Diagnóstico de áudio**, use a seção **MIXAGEM DINÂMICA**. As opções persistidas controlam ativação da sobreposição, volumes de música/voz/efeitos, duração máxima do bordão, intervalo mínimo entre bordões, máximo de SFX simultâneos e prioridades dos canais. **TESTAR SOBREPOSIÇÃO** envia ao overlay um bordão realmente cadastrado junto de um efeito curto; **SILENCIAR TUDO** interrompe todos os canais imediatamente.

Por padrão, somente um áudio principal ocupa o canal **VOICE**. Um bordão de prioridade igual ou superior substitui o atual com fade de aproximadamente 100 ms; um inferior ou já sem relevância é descartado, sem formar fila atrasada. O limite de reprodução de três segundos é aplicado somente no player e não altera o arquivo importado. O canal **SFX** aceita até três efeitos curtos ao mesmo tempo e mantém cooldown contra repetição rápida.

Enquanto VOICE ou PRIORITY está ativo, MUSIC reduz o ganho e volta suavemente depois. **PRIORITY** é reservado para largada, chegada e vitória. A chegada aos 100% limpa bordões e efeitos antigos antes do som final; o limitador da saída principal e a margem de ganho dos canais impedem soma sem controle. Desativar a mixagem dinâmica restaura reprodução serial, sem criar outro `AudioContext`.

A seção **Diagnóstico de áudio** do painel mostra:

- o estado real do áudio no overlay e os sons tocando agora;
- reproduções, barrados e erros;
- o log das últimas reproduções;
- um botão para testar cada som;
- um alerta quando há **mais de um /overlay aberto** — navegador e OBS ao mesmo tempo soam como eco ou ruído.

## Central de testes

Endereço: `http://127.0.0.1:8787/admin/testes` (botão **CENTRAL DE TESTES** no topo do painel). Pede o mesmo `ADMIN_TOKEN`.

Para preparar uma versão provisória HTTPS em um único serviço persistente, consulte [Publicação provisória no Railway](docs/DEPLOY_RAILWAY.md). A preparação não publica nada automaticamente.

A ideia é abrir duas janelas no Mac: uma com `/overlay` e outra com a central, clicar nos botões e ver os corredores reagindo na hora.

No topo da central há a barra **TESTE RÁPIDO**, com os botões essenciais: iniciar, pausar, reiniciar e encerrar a corrida; comentário 13 e 22; impulso, turbo e tropeço de cada lado; presentes simulados; e os bordões de cada personagem. Fora de uma corrida o motor recusa comentários, presentes, curtidas e poderes — o aviso no topo explica isso e traz um botão para iniciar na hora.

Se o token for recusado: ele vem de `ADMIN_TOKEN` no arquivo `.env`. Sem `.env`, o servidor usa o token local padrão e o informa na primeira linha de `logs/server.log`.

Todos os botões passam pelo motor real: o evento vai ao servidor, as regras são aplicadas, o estado muda, a animação roda, o som dispara e o overlay atualiza. Nada é alterado apenas visualmente na própria página.

O que a central oferece:

- **Espelho da arena** com a corrida em 3D (desligável para poupar GPU) e leitura de distância, progresso, velocidade, energia, impulso, escudo e itens de cada corredor.
- **Comentários**: `13`, `22`, nome do candidato, rajada de 10 e sequência controlada de 100.
- **Presentes**: nome e ID configuráveis, quantidade ajustável, comum, especial, alto valor, sequência, combo alternado e envio simultâneo dos dois lados.
- **Poderes**: impulso, super arrancada, turbo, escudo e tropeço com intensidade regulável, mais ultrapassagem forçada e chegada simulada.
- **Curtidas**: 1, 10, 100, 1.000 e preenchimento da meta coletiva.
- **Áudios**: disparo por gatilho pelo diretor real, prévia local de cada som e teste de sobreposição.
- **Rodadas**: iniciar, pausar, continuar, encerrar, zerar placar, rodadas consecutivas e teste de 15 minutos.
- **Estresse**: 10/5 s, 50/10 s, 100/30 s e 500/2 min, sempre com taxa controlada, exibindo processados, descartados, latência, FPS, falhas de rede, recuperações do motor e tick máximo.
- **Demonstração automática**: roteiro contínuo de comentários, presentes, turbos, ultrapassagens e bordões.

Segurança: a página exige autenticação; eventos entram com origem `demo` e aparecem marcados assim na auditoria; o contador separa simulados de reais; com o conector do TikTok conectado as rajadas e os testes de carga ficam bloqueados no servidor e desabilitados na interface; e o botão **PARAR TESTES** interrompe qualquer sequência na hora.

### Primeiro teste

1. `./scripts/start.sh`
2. Abra `http://127.0.0.1:8787/overlay` em uma janela.
3. Abra `http://127.0.0.1:8787/admin/testes` em outra e autentique.
4. Confirme que o status já percorre **Contagem regressiva → Corrida**; se o ciclo foi encerrado antes, clique em **Iniciar ciclo automático**.
5. Clique em **Comentar 13**: o placar de Lula sobe, o corredor ganha impulso e o histórico registra o evento como simulado.

## Bordões, memes e biblioteca de áudio

Abra `http://127.0.0.1:8787/admin/bordoes` (ou o botão destacado **GERENCIAR BORDÕES** no painel). A sessão autenticada do painel é reaproveitada; se ela tiver expirado, a central pede novamente o mesmo `ADMIN_TOKEN`.

O que vem instalado:

- **15 efeitos procedurais originais**, que já tocam: abertura, largada, impacto, especial, defesa, esquiva, presente, impulso, tropeço, ultrapassagem, reta final, torcida, transição, vitória e encerramento. Não contêm falas, imitações nem vozes de Lula ou Bolsonaro.
- **13 vagas de bordão vazias**, cinco para cada lado (largada, impulso, ultrapassagem, meme/tropeço e vitória) e três para memes neutros. Elas aparecem como **“Áudio não cadastrado”**, ficam desativadas e nunca chegam ao overlay enquanto não receberem um arquivo.

Cada linha mostra nome, arquivo, duração detectada, **Tocar**, volume, evento, personagem, animação, intervalo mínimo, ativar/desativar, salvar e excluir. Vagas antigas sem arquivo continuam visíveis como **Áudio não cadastrado**, porém nunca são escolhidas para reprodução.

Para importar um bordão sem mexer em pastas ou código:

1. Clique em **+ ADICIONAR BORDÃO**.
2. Escolha **Lula**, **Bolsonaro** ou **Geral** e selecione um MP3, WAV ou OGG de até 8 MB.
3. Informe nome, evento disparador, volume e licença/origem; marque **sátira/paródia** somente quando for o caso.
4. Clique em **Salvar e testar no overlay**. O cadastro é persistido mesmo se o overlay estiver fechado; nesse caso a tela avisa que o teste audível ficou pendente.
5. Depois, use **Tocar** para repetir o teste ou altere evento/lado/volume e pressione **Salvar**.

Os arquivos ficam em `data/audio/` com nomes aleatórios e só são servidos quando associados a um registro do SQLite. O servidor confere extensão, MIME, assinatura do arquivo e limite de tamanho. Uploads desativados permanecem no catálogo, mas não entram na seleção automática.

Não importe clonagens das vozes de Lula ou Bolsonaro, montagens apresentadas como declarações reais, acusações sem contexto ou conteúdo sem licença. O rótulo **SÁTIRA / PARÓDIA** aparece no overlay para os itens marcados.

### Modos de áudio

- **Discreto:** apenas alertas e efeitos curtos de golpe, defesa e resultado; a trilha é silenciada.
- **Memes:** efeitos e bordões satíricos ocasionais, respeitando o intervalo global.
- **Arena:** biblioteca completa, torcida, música e efeitos cinematográficos.

O servidor escolhe os itens de acordo com o gatilho, personagem, modo, frequência máxima, estratégia e histórico recente. O overlay pré-carrega os arquivos; mistura efeitos curtos por canal, mantém apenas um bordão principal e reduz automaticamente a trilha durante voz ou prioridade. Falhas de download ou decodificação são registradas no banco.

O botão **SOM ON/OFF** no overlay silencia imediatamente aquela fonte do navegador, inclusive o leito sonoro da corrida. Os efeitos procedurais continuam disponíveis como itens nativos e podem ser desativados individualmente.

### Ligar um bordão a um momento da corrida

O evento disparador define quando o áudio entra, e o personagem define de que lado:

| Momento | Evento | Personagem |
| --- | --- | --- |
| Lula recebe impulso | Impulso / arrancada | Lula |
| Bolsonaro recebe impulso | Impulso / arrancada | Bolsonaro |
| Ultrapassagem | Ultrapassagem | neutro ou o lado que passou |
| Tropeço | Tropeço | o lado que tropeçou |
| Turbo | Turbo / golpe especial | neutro ou um lado |
| Presente especial | Presente recebido | neutro ou o lado beneficiado |
| Largada | Largada da corrida | neutro ou um lado |
| Fim da corrida | Vitória (ou Encerramento) | o vencedor |

O intervalo mínimo de cada item e o campo **Intervalo entre bordões** nas configurações evitam poluição sonora: um bordão não repete antes do tempo configurado; quando um novo bordão de prioridade igual ou superior precisa entrar, ele substitui suavemente o anterior em vez de esperar numa fila.

## Eventos, TikTok e segurança da contagem

O modo demonstração funciona sem rede. Todos os eventos simulados são gravados com a origem `demo` e exibidos como **SIMULAÇÃO** no overlay. Eles nunca são enviados ao TikTok.

Para uma LIVE autorizada, informe `@usuario` no painel e pressione **Conectar**, ou defina:

```dotenv
TIKTOK_USERNAME=usuario
TIKTOK_AUTO_CONNECT=true
```

Comentários são comparados com palavras inteiras e acionam defesa/efeito visual no personagem correspondente. Presentes usam os IDs configurados, combos só são contados quando terminam e ativam um especial na batalha ou turbo na corrida. Curtidas alimentam a meta coletiva e um efeito neutro de público, sem beneficiar um lado. IDs externos são persistidos e também passam por uma janela de deduplicação.

Interações reais e de demonstração ficam separadas pela coluna de origem. Nenhum nome de espectador, comentário, presente ou curtida é criado para aparentar atividade real; somente o motor fictício dos personagens funciona autonomamente.

O adaptador usa `tiktok-live-connector`, que é uma integração **não oficial e não pronta para garantias de produção**. Mudanças do TikTok podem interrompê-lo. Quando há perda de conexão, a contagem real é suspensa e a interface mostra um alerta; o adaptador tenta reconectar com espera progressiva. Quando recebe o evento de encerramento da LIVE, não tenta reconectar. O aplicativo não chama nenhuma função para iniciar LIVE ou enviar comentários.

Use somente os métodos de transmissão externa oferecidos e autorizados pelo próprio TikTok para a conta. Se a conta não tiver acesso, não tente contornar a restrição.

## Configurar no OBS

1. Inicie o serviço com `./scripts/start.sh`.
2. No OBS, adicione uma fonte **Navegador**.
3. URL: `http://127.0.0.1:8787/overlay`.
4. Largura: `1080`; altura: `1920`; FPS: `30` ou `60`.
5. Ative a opção de controlar áudio via OBS se quiser ajustar os efeitos separadamente.

O overlay reconecta ao servidor com backoff automático. O estado do jogo é calculado no Node e transmitido por WebSocket, portanto fechar o painel administrativo não interrompe a partida. Para Macs com menos GPU, use 30 FPS no OBS e habilite **Modo de desempenho reduzido**.

### Captura de áudio no macOS

Não presuma que ouvir o som no navegador significa que ele está sendo enviado à gravação ou à LIVE. Faça este teste antes de transmitir:

1. Mantenha `/overlay` como uma fonte **Navegador** do OBS e confirme que **SOM ON** aparece no canto do overlay.
2. Na Central de Testes, clique em **HABILITAR ÁUDIO + TESTE CURTO**. Se aparecer o botão amarelo no vídeo, abra **Interagir** na fonte Navegador e clique em **HABILITAR ÁUDIO**. O medidor da fonte deve se mover no Mixer de Áudio do OBS.
3. Em **Propriedades avançadas de áudio**, use **Monitorar e enviar saída** somente se também quiser ouvir localmente; para a transmissão sem retorno local, mantenha a saída ativa e o monitoramento desligado.
4. Grave 30 segundos e reproduza o arquivo gravado. O medidor e o fone de ouvido, isoladamente, não comprovam que a faixa foi gravada.
5. Evite capturar a mesma fonte pelo Browser Source e pelo áudio do sistema ao mesmo tempo, pois isso produz eco ou duplicação.

Se você abrir o overlay em Safari/Chrome fora do Browser Source, o áudio passa a ser áudio daquele aplicativo. No macOS 13 ou posterior, OBS 30+ oferece a fonte **macOS Audio Capture** para capturar todo o desktop ou um aplicativo específico. Em versões anteriores do macOS, é necessário rotear o áudio com uma solução compatível. Consulte o [guia oficial de captura de áudio no macOS](https://obsproject.com/kb/macos-desktop-audio-capture-guide) e a [documentação oficial da Browser Source](https://obsproject.com/kb/browser-source).

### Teste de sincronização no OBS

1. Abra o overlay no OBS e use **Monitorar e enviar saída** nas propriedades avançadas de áudio.
2. No painel, teste abertura, impacto e vitória.
3. Confirme que o título do som e a animação aparecem no mesmo instante do áudio.
4. Simule um presente e confira o especial/turbo sincronizado.
5. Teste três efeitos rápidos e confirme que a fila respeita o limite configurado.
6. Confirme a redução automática da trilha durante um bordão e o retorno gradual depois dele.
7. Faça uma gravação local de 30 segundos e verifique a sincronia antes de iniciar uma LIVE.

## Monitoramento e emergência

O painel mostra conexão do servidor, situação do conector, último evento, uptime e watchdog. Se um conector marcado como conectado ficar sem eventos além do limite configurado, aparece **Sem eventos**. Silêncio pode ser normal em salas pequenas; o alerta serve para inspeção humana.

### Modo de diagnóstico

A seção **Diagnóstico da arena** em `/admin` e `/monitor` mostra:

- FPS medido no próprio `/overlay` e recomendação de desempenho;
- memória RSS/heap do servidor e, quando o Chromium disponibiliza a métrica, heap estimado do overlay;
- conexão do painel, clientes WebSocket e overlays reportando telemetria;
- eventos recebidos, aceitos, descartados e motivos de descarte;
- estado Web Audio (`running`, `suspended`, `interrupted` ou `closed`), sons ativos, fila, reproduções, descartes e falhas;
- duração do último/pior ciclo do motor 3D e recuperações automáticas;
- histórico persistido de alertas e erros importantes.

O FPS e o estado do áudio aparecem somente enquanto `/overlay` estiver realmente aberto no OBS ou em um navegador. A ausência dessa telemetria é exibida como **SEM OVERLAY**, não como um valor inventado.

O botão vermelho de emergência:

- suspende a contagem e o ciclo;
- desconecta o coletor real;
- grava o motivo no banco;
- exige liberação manual e permanece ocioso depois da liberação.

Ele não encerra a LIVE no TikTok ou no OBS. Use também os controles oficiais dessas ferramentas quando necessário.

## Acesso remoto seguro para moderador

Por padrão, o servidor escuta apenas `127.0.0.1` e não é acessível pela rede. A opção recomendada é instalar uma VPN privada como Tailscale nos dois dispositivos e ligar o servidor **somente ao IP privado da VPN**:

```dotenv
REMOTE_ACCESS=true
HOST=100.x.y.z
ADMIN_TOKEN=um-segredo-longo-e-unico
```

Reinicie o serviço e acesse `http://100.x.y.z:8787/monitor` pelo dispositivo autorizado na mesma rede privada. Mantenha o firewall do macOS ativo. Não use encaminhamento de porta no roteador, DMZ, túnel público nem `0.0.0.0` em uma rede não confiável. O monitor exige o mesmo token e permite acompanhar o estado e acionar a parada de emergência.

## Impedir repouso durante a transmissão

`./scripts/start.sh` inicia `caffeinate -dimsu -w <PID>` em paralelo. Isso mantém o Mac acordado apenas enquanto o servidor está vivo. O script de encerramento também finaliza o `caffeinate`.

Como proteção adicional, em **Ajustes do Sistema → Tela Bloqueada/Energia**, desative o repouso automático quando conectado à energia durante a sessão autorizada. Mantenha o Mac na tomada e teste o comportamento antes da LIVE.

## Teste de estabilidade antes de transmitir

1. Execute `npm run check`.
2. Execute `npm run test:stability` para repetir isoladamente o ensaio acelerado de rodadas, rajadas, silêncio, memória e recuperação.
3. Inicie com `./scripts/start.sh` e confirme `/api/health`.
4. Abra o overlay no OBS, mas ainda não transmita.
5. Inicie uma rodada sem enviar eventos e confirme movimentação, ataques, defesas e resultado autônomo.
6. Deixe o modo automático completar pelo menos 10 rodadas, confirmando a troca entre batalha e corrida.
7. Envie comentários, presentes, curtidas e uma rajada; confirme que apenas efeitos opcionais são adicionados.
8. Feche o painel e confirme que o overlay continua atualizando.
9. Desligue e ligue o Wi‑Fi; confira o alerta, a suspensão da contagem real e a continuidade do jogo fictício.
10. Reinicie o serviço durante uma rodada e confirme a recuperação do estado.
11. Acione e libere a parada de emergência.
12. Revise **Diagnóstico da arena**, `logs/server.log`, o histórico e o uso de CPU/GPU no Monitor de Atividade.

Faça o teste do conector em uma LIVE privada/autorizada. Uma verificação demo não valida acesso ou estabilidade da integração real.

## Scripts e comandos

| Comando | Função |
| --- | --- |
| `npm run dev` | servidor e Vite com recarga automática |
| `npm run test` | testes de combate, corrida, alternância, interações, deduplicação e persistência |
| `npm run test:stability` | ensaio acelerado de 15 rodadas, rajadas, silêncio, memória e recuperação |
| `npm run build` | valida TypeScript e gera `dist/` |
| `npm run check` | testes + build |
| `./scripts/start.sh` | inicia o serviço em segundo plano e mantém o Mac acordado |
| `./scripts/stop.sh` | encerramento seguro |

## Retratos e licenças

- Lula: Ricardo Stuckert/PR, Palácio do Planalto, CC BY 2.0.
- Bolsonaro: Agência Brasil / Alan Santos / PR, CC BY 3.0 Brasil.

Arquivos e links de origem estão em `public/portraits/README.md`. O uso não implica endosso.
