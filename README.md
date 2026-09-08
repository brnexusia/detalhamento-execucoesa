# Shopvax

Shopvax é um SaaS enxuto para atacado orientado a **catálogo + feed vertical + carrinho + vendedora + WhatsApp**.

O cliente descobre produtos no feed ou entra pelo link da loja/vendedora, escolhe variações e quantidade, monta o carrinho e envia o pedido estruturado para o WhatsApp. A plataforma mede intenção de compra; ela não trata o clique para o WhatsApp como faturamento confirmado.

## Experiência pública

- feed vertical no padrão Reels/TikTok: **uma publicação por tela**;
- foto ou vídeo ocupando a publicação inteira;
- perfil público da loja;
- produto → carrinho sem perder contexto;
- continuidade da vendedora atribuída;
- botão Perguntar para WhatsApp;
- prioridade de distribuição por plano e diversidade entre lojas.

## Painel do lojista

- produtos, fotos/vídeos e variações;
- estoque básico;
- catálogos e preços por catálogo;
- vendedoras e links individuais;
- pedidos enviados ao WhatsApp;
- métricas de intenção e funil;
- configurações comerciais.

## Administração da plataforma

A rota `/admin` é o painel operacional do Shopvax. Administradores podem:

- acompanhar lojas, contas, produtos e pedidos;
- suspender/reativar lojas;
- atribuir planos por loja;
- criar e editar planos;
- administrar limites de vendedoras, produtos e catálogos;
- adicionar/remover administradores;
- excluir contas com reautenticação;
- consultar auditoria das ações sensíveis.

Planos padrão:

| Plano | Mensal | Vendedoras | Produtos | Catálogos |
| --- | ---: | ---: | ---: | ---: |
| Bronze | R$ 49,90 | 5 | 500 | 1 |
| Prata | R$ 94,90 | 15 | 2.000 | 3 |
| Ouro | R$ 144,90 | Ilimitadas | Ilimitados | Ilimitados |

Semestral usa 5% de desconto e anual 15% por padrão. Os planos podem ser editados pela administração.

## Segurança de lançamento

O servidor aplica:

- cookies de sessão `HttpOnly` e `Secure` quando HTTPS está ativo;
- sessões administrativas limitadas a 7 dias para acesso ao `/admin`;
- reautenticação por senha em exclusão de conta e remoção de administrador;
- auditoria de ações administrativas sensíveis;
- proteção de origem para mutações da API;
- rate limit de login, cadastro e mutações administrativas;
- CSP, HSTS em HTTPS, anti-framing, `nosniff`, política de permissões e `no-store` em APIs privadas;
- limites de plano aplicados no backend e também por gatilhos no PostgreSQL.

### Primeiro administrador em instalação nova

Em uma instalação sem administradores, configure temporariamente um token forte (mínimo 24 caracteres):

```env
SHOPVAX_ADMIN_BOOTSTRAP_TOKEN=gere-um-token-longo-e-unico
```

1. crie/entre na conta que será administradora;
2. abra `/admin`;
3. informe o token de ativação;
4. após o primeiro administrador ser criado, remova essa variável do ambiente.

O token só funciona quando ainda não existe nenhum administrador.

## Produção

Variável obrigatória:

```env
DATABASE_URL=postgresql://usuario:senha@host:5432/banco
```

O backend cria e atualiza o schema automaticamente. `SHOPVAX_ADMIN_BOOTSTRAP_TOKEN` é necessário apenas para ativação inicial caso a base ainda não possua um administrador.

## Deploy

- Source: GitHub
- Repository: `brnexusia/detalhamento-execucoesa`
- Branch: `main`
- Build: `Dockerfile`
- Target Port: `80`

O Dockerfile executa o build e inicia o backend; não configure comandos paralelos de install/build/start na plataforma de deploy.

## Desenvolvimento

```bash
npm install
npm run build
DATABASE_URL=postgresql://... npm start
```
