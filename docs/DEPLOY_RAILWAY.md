# Publicação provisória HTTPS — Railway

Esta preparação mantém a arquitetura atual em **um único serviço persistente**. Não publique o frontend como site estático: o motor automático, Socket.IO, SQLite e uploads precisam permanecer no mesmo processo e no mesmo volume.

## Arquitetura que será publicada

- React/Vite compilado em `dist/` e servido pelo Express.
- Express + Socket.IO no mesmo domínio e na porta informada por `PORT`.
- Motor da corrida e poderes em `server/engine.ts` e `server/game-simulation.ts`.
- SQLite, bordões e uploads em `/app/data`, montado como volume persistente.
- Uma única réplica. SQLite e o motor em memória não podem ser escalados horizontalmente sem uma migração posterior.

Ao abrir uma página HTTPS, o cliente Socket.IO usa automaticamente `wss://` no mesmo domínio. Não existe endereço `ws://localhost` embutido no build de produção.

## Atualizar o snapshot antes de publicar

O diretório local `data/` não deve ir para Git. Para preservar banco, configurações e áudios, gere uma cópia consistente e separada:

```bash
npm run deploy:seed
npm run check
```

O resultado fica em `deployment/seed-data/`. O snapshot preserva configurações e catálogos, mas remove eventos, logs, resultados anteriores e o estado da corrida local antes de ser versionado. Os arquivos de áudio continuam incluídos: confirme que você possui direito de publicá-los, principalmente se usar um repositório público. Na primeira inicialização de um volume vazio, o container copia esse snapshot. Em reinicializações seguintes, o banco já existente no volume não é substituído.

## Configuração mínima no Railway

1. Crie um repositório Git privado com este projeto.
2. No Railway, escolha **New Project → Deploy from GitHub repo** e selecione o repositório.
3. No serviço, defina estas variáveis:

   ```dotenv
   ADMIN_TOKEN=<segredo de pelo menos 32 caracteres>
   REMOTE_ACCESS=true
   AUDIO_SAFE_MODE=true
   TIKTOK_AUTO_CONNECT=false
   ```

   Gere o segredo localmente com `openssl rand -hex 32`. Não grave o valor no repositório.

4. Anexe **um volume persistente** ao serviço com mount path `/app/data`.
5. Mantenha **uma réplica** e desative qualquer escala horizontal.
6. Configure o health check como `/api/health`.
7. Em **Networking → Public Networking**, clique em **Generate Domain**.

O `Dockerfile` detectado automaticamente compila o frontend, inicia o servidor em `0.0.0.0:$PORT` e atende frontend, API e Socket.IO no mesmo domínio.

## Endereços após gerar o domínio

Substitua `<dominio>` pelo domínio entregue pelo Railway:

- TikTok LIVE Studio: `https://<dominio>/overlay`
- Painel administrativo: `https://<dominio>/admin`
- Central de testes: `https://<dominio>/admin/testes`
- Central de bordões: `https://<dominio>/admin/bordoes`
- Saúde do serviço: `https://<dominio>/api/health`

Adicione **somente `/overlay`** ao TikTok LIVE Studio. Não coloque `/admin` ou `/admin/testes` como fonte de transmissão e nunca inclua o token na URL. O token fica no `sessionStorage` do navegador administrativo e as rotas de configuração, simulação, upload, controle e TikTok exigem o cabeçalho autenticado.

## Primeiro teste

1. Abra `/overlay` em um navegador normal e confirme que a corrida atualiza sem recarregar.
2. Abra `/admin/testes` em outra janela, autentique e dispare um único presente simulado.
3. Confirme no overlay que o evento aparece como **SIMULAÇÃO**.
4. No TikTok LIVE Studio, adicione a URL HTTPS do overlay como fonte de navegador.
5. Autorize o áudio na própria fonte quando o navegador incorporado exigir interação.
6. Deixe `TIKTOK_AUTO_CONNECT=false`; esta publicação não inicia LIVE nem conecta automaticamente à plataforma.

## Segurança e limitações desta fase

- O servidor recusa execução pública com token padrão, token de seis dígitos ou segredo menor que 32 caracteres.
- O login administrativo possui limite de tentativas por endereço IP.
- Os 20 botões de simulação chamam somente rotas autenticadas.
- O socket público recebe estado e áudio; os únicos dados que aceita do navegador são telemetria validada do overlay. Não há evento socket para alterar corrida, placar ou poderes.
- O overlay tem apenas controles locais de áudio; não contém token nem comandos administrativos.
- `AUDIO_SAFE_MODE=true` exige autorização de áudio após cada reinicialização real do serviço/fonte.
- Faça backup do volume antes de uma atualização importante. Não aumente o serviço para duas réplicas.

## Alternativa

Render também suporta HTTPS, WebSocket e disco persistente, porém o disco exige serviço pago. Para este teste, Railway reduz a configuração a um serviço, um domínio e um volume. Uma migração para PostgreSQL ou armazenamento de objetos não é necessária nesta etapa.
