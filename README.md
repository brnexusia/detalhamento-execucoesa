# Atacado Shop

SaaS enxuto para atacado: **Catálogo + Feed + Carrinho + Vendedora**.

O cliente entra pela loja ou pelo link individual de uma vendedora, escolhe produto, variação e quantidade, monta o carrinho e envia o pedido pronto para o WhatsApp. Não existe checkout online na V1.

## O que já está implementado

### Comprador
- loja responsiva por URL;
- feed vertical com foto ou vídeo;
- busca e categorias;
- seleção obrigatória de variações (cor, tamanho etc.);
- quantidade antes de adicionar ao carrinho;
- carrinho compartilhado entre loja e feed;
- pedido mínimo com progresso;
- registro do pedido antes de abrir o WhatsApp;
- envio para o WhatsApp da vendedora atribuída ao link.

### Lojista
- cadastro e login;
- painel enxuto;
- configuração de nome, URL, WhatsApp, pedido mínimo, chamadas, logo e cor;
- CRUD de produtos;
- upload de foto/vídeo;
- variações por produto;
- produto ativo/inativo e destaque;
- CRUD de vendedoras;
- link individual por vendedora;
- lista de pedidos;
- métricas básicas de acessos, carrinhos, pedidos e valor gerado.

## URLs

- `/` — apresentação
- `/entrar` — login
- `/criar-conta` — cadastro
- `/painel` — painel do lojista
- `/{loja}` — link geral da loja
- `/{loja}/{vendedora}` — link atribuído à vendedora

Exemplo: `/suprema-line/karina`.

## Banco

O backend usa PostgreSQL. Na inicialização ele cria automaticamente as tabelas necessárias (`users`, `stores`, `products`, `sellers`, `orders`, `events` e `sessions`).

Configure `DATABASE_URL` no Easypanel. Sem banco, o container continua saudável e a loja demo `/casa-norte/marina` permanece disponível, mas login/cadastro e persistência real ficam bloqueados.

## Uploads

Fotos e vídeos são gravados em `/data/uploads`. Para produção, adicione um volume persistente no Easypanel montado em `/data`.

## Deploy no Easypanel

- Source: GitHub
- Repository: `brnexusia/detalhamento-execucoesa`
- Branch: `main`
- Build: `Dockerfile`
- File: `Dockerfile`
- Build Path: `/`
- Target Port: `80`

Não configure Install/Build/Start commands no Easypanel: o Dockerfile cuida de tudo.

Depois adicione `DATABASE_URL` em **Environment**, monte um volume em `/data` e faça redeploy.

## Rodar localmente

```bash
npm install
npm run build
DATABASE_URL=postgresql://... PORT=8080 npm start
```
