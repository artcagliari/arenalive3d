# Relatório de testes — Etapa 6

Data: 11 de outubro de 2026
Ambiente automatizado: macOS, Node.js local, servidor Express/Socket.IO e build Vite.

## Resultado

Foram executados `npm run test`, `npm run build` e um teste de integração com o servidor real em uma porta e banco temporários. O conjunto terminou com 17 testes aprovados, zero falhas de TypeScript e build de produção concluído.

O teste de integração confirmou:

- `/overlay` servido com HTTP 200;
- `/api/health` saudável;
- telemetria do overlay recebida por Socket.IO;
- diagnóstico autenticado exibindo FPS, memória, WebSocket e mixer;
- `/api/diagnostics` recusado sem token com HTTP 401;
- encerramento seguro por `SIGINT`.

## Funcionalidades automatizadas e aprovadas

- batalha e corrida avançam sem eventos do TikTok;
- ataques reduzem energia e presentes ativam golpe especial/turbo;
- estados de ataque, defesa e esquiva são produzidos pelo motor;
- lutadores permanecem entre `-3.1` e `3.1`, dentro da arena, com separação mínima de `0.9` e sem atravessamento;
- barras recebem valores de energia/progresso atualizados pelo estado do servidor;
- alternância batalha/corrida e início, resultado, intervalo e próxima rodada automáticos;
- 15 rodadas aceleradas, incluindo uma rodada sem interação;
- comentários, rajadas rápidas de presentes e evento duplicado;
- resultados, eventos e estado persistidos em SQLite;
- gatilhos de áudio de abertura, golpe, defesa, esquiva, presente e resultado;
- seleção de bordões por modo, frequência e sequência;
- descarte de sons enquanto silenciado validado sem criar fila atrasada;
- fila limitada, prioridade e ducking da música verificados no código e no build; a confirmação acústica permanece manual;
- cache de deduplicação limitado e variação de heap abaixo do teto de 64 MB no ensaio;
- falha isolada injetada no motor, registro do erro e restauração automática do último estado persistido;
- evento duplicado após reabertura do banco recusado sem alterar o placar;
- autenticação da telemetria administrativa e histórico de erros.

## Problemas encontrados e correções

1. Não havia uma barreira física explícita entre os personagens. Foi adicionada separação mínima após cada atualização de movimento.
2. Um ID já persistido podia ser descoberto somente depois do cálculo do evento. A verificação agora ocorre antes de qualquer alteração de placar ou jogo.
3. Sons recebidos enquanto o overlay estava silenciado permaneciam na fila. Eles agora são descartados e contabilizados, evitando reprodução atrasada ao religar.
4. Faltavam métricas operacionais. Foram adicionados FPS real do overlay, memória, WebSocket, aceites/descartes, estado/fila do áudio, duração do motor e histórico de erros.
5. O build revelou o estado Web Audio `interrupted`, usado por Safari/macOS. O contrato e o painel agora reconhecem esse estado como alerta.
6. Uma exceção no ciclo 3D encerraria o processo pelo manipulador global. O ciclo agora registra a falha e restaura o último estado persistido.

## Limites e validações manuais pendentes

Não foi executada uma audição física nem uma gravação dentro do OBS nesta sessão. Portanto, permanecem pendentes no Mac de transmissão:

- confirmar visualmente os dois modelos, enquadramentos, sombras, partículas e fluidez real da GPU;
- ouvir impacto, defesa, esquiva, ducking, volume geral, silêncio instantâneo e bordões licenciados importados;
- confirmar que o medidor da Browser Source se move e que o som existe no arquivo gravado;
- medir sincronização audiovisual em uma gravação de 30 segundos;
- executar 10 ou mais rodadas em tempo real com o OBS aberto;
- testar o conector em uma LIVE privada e autorizada, inclusive perda de rede e encerramento pela plataforma.

Esses itens não são declarados como testados. O painel de diagnóstico foi criado para tornar essa validação observável.

O Vite também informou um aviso, não uma falha, para o pacote do overlay com Three.js (aproximadamente 898 kB antes de gzip). Como a aplicação é servida localmente e o recurso é carregado uma vez, isso não impediu o build; ainda assim, o tempo de abertura inicial deve ser observado no Mac alvo.

## Comandos no Mac

```bash
npm install
npm run check
npm run test:stability
./scripts/start.sh
```

Abra `http://127.0.0.1:8787/admin` e `http://127.0.0.1:8787/overlay`. Para encerrar com persistência:

```bash
./scripts/stop.sh
```

O procedimento completo de áudio está no README e segue a documentação oficial do [OBS para áudio no macOS](https://obsproject.com/kb/macos-desktop-audio-capture-guide).
