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

## Produção: uma única variável

No Easypanel, a única variável necessária é:

```env
DATABASE_URL=postgresql://usuario:senha@host:5432/banco
```

Depois do deploy, o Atacado Shop faz sozinho:

- conexão com o PostgreSQL;
- criação e atualização do schema necessário;
- criação de tabelas e índices;
- sessões de login;
- pedidos e métricas;
- armazenamento persistente de fotos e vídeos no próprio PostgreSQL;
- reconexão automática se o Postgres ainda estiver iniciando quando o app subir.

Não é necessário configurar `PGSSL`, `DATA_DIR`, volume de uploads, migration manual ou comando de inicialização.

As mídias ficam na tabela `media_assets` e são servidas por `/media/:id`, inclusive com suporte a HTTP Range para vídeos.

## Deploy no Easypanel

- Source: GitHub
- Repository: `brnexusia/detalhamento-execucoesa`
- Branch: `main`
- Build: `Dockerfile`
- File: `Dockerfile`
- Build Path: `/`
- Target Port: `80`
- Environment: somente `DATABASE_URL`

Não configure Install/Build/Start commands no Easypanel: o Dockerfile cuida de tudo.

## Rodar localmente

```bash
npm install
npm run build
DATABASE_URL=postgresql://... npm start
```
