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
- prioridade de distribuição por plano e diversidade entre lojas;
- no Plano 3, cálculo de frete e finalização opcional por checkout hospedado do Asaas.

## Painel do lojista

- produtos, múltiplas fotos/vídeos e variações;
- estoque básico;
- catálogos e preços por catálogo;
- vendedoras e links individuais;
- pedidos enviados ao WhatsApp;
- métricas de intenção e funil;
- crescimento: cupons, recuperação de carrinho, avaliações e indicação;
- configurações comerciais;
- no Plano 3, área de integrações para Asaas, frete, Meta Shopping e API/ERP.

## Modelo final do MVP

Os códigos internos `bronze`, `prata` e `ouro` são mantidos por compatibilidade com contas existentes, mas comercialmente correspondem a **Plano 1, Plano 2 e Plano 3**.

| Regra base | Plano 1 | Plano 2 | Plano 3 |
| --- | ---: | ---: | ---: |
| Mensal | R$ 49,90 | R$ 94,90 | R$ 144,90 |
| Vendedoras | 2 | 4 | Ilimitadas |
| Fotos por produto | 5 | 10 | 10 |
| Catálogos | 1 | 3 | Ilimitados |
| Franqueados | 0 | 2 | Ilimitados |
| Tráfego interno | Baixa prioridade | Média prioridade | Alta prioridade |
| Estoque | — | Sim | Sim |
| Domínio próprio | — | Sim | Sim |
| Avaliações | — | Sim | Sim |
| Inteligência comercial | — | Sim | Sim |
| Personalização da loja | — | Sim | Sim |
| Comissão de vendedoras | — | — | Sim |
| Asaas / pagamento online | — | — | Sim |
| Frete calculado | — | — | Sim |
| Feed Meta Shopping | — | — | Sim |
| API / ERP | — | — | Sim |

Produtos não possuem mais o teto legado de 500/2.000 unidades nos planos padrão. Semestral usa 5% de desconto e anual 15% por padrão.

**Vax Lar permanece como recurso futuro do Plano 3 e não deve ser tratado como funcionalidade pronta do MVP.**

### Fase 1 de fechamento

A fundação do MVP foi fechada nesta ordem:

1. planos, limites e feature gating;
2. produtos, grades/variações, preços e múltiplas fotos;
3. catálogo, incluindo atacado/varejo e preço por catálogo;
4. carrinho e pedido mínimo;
5. pedido estruturado para WhatsApp.

O backend continua sendo a fonte de verdade de preço, visibilidade, variações, limites e pedido mínimo. O frontend nunca deve ser a única barreira para regras de plano.

### Fase 4 — integrações

A área `/painel/integracoes` é exclusiva do Plano 3.

**Asaas**

- a chave da API é cadastrada por loja e cifrada em repouso;
- o Shopvax não coleta número de cartão, CVV ou dados bancários sensíveis;
- a cobrança é criada no backend e o cliente conclui Pix, boleto ou cartão na página hospedada do Asaas;
- o webhook é autenticado por token próprio e processado de forma idempotente;
- pagamento confirmado atualiza o status financeiro do pedido, mas **não confirma venda/comissão automaticamente**. A confirmação comercial continua sendo uma ação separada da Fase 3.

**Frete**

- regras por UF e/ou prefixo de CEP;
- valor fixo, pedido mínimo da faixa, frete grátis acima de determinado subtotal e prazo mínimo/máximo;
- cotações expiram em 30 minutos e são validadas novamente no backend antes de serem vinculadas ao pedido.

**Meta Shopping**

- feed CSV público por loja, contendo somente produtos ativos;
- preço em BRL, link do produto, imagem e marca padrão configurável.

**API / ERP**

- tokens com escopos mínimos (`products:read`, `orders:read`, `customers:read`, `payments:read`, `stock:write`);
- o segredo do token é mostrado uma única vez; no banco fica apenas o hash;
- tokens podem ser revogados imediatamente;
- webhooks de `order.created`, `payment.updated` e `stock.updated` usam assinatura HMAC SHA-256 no header `x-shopvax-signature`.

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

## Segurança de lançamento

O servidor aplica:

- cookies de sessão `HttpOnly` e `Secure` quando HTTPS está ativo;
- sessões administrativas limitadas a 7 dias para acesso ao `/admin`;
- reautenticação por senha em exclusão de conta e remoção de administrador;
- auditoria de ações administrativas sensíveis;
- proteção de origem para mutações da API;
- rate limit de login, cadastro e mutações administrativas;
- CSP, HSTS em HTTPS, anti-framing, `nosniff`, política de permissões e `no-store` em APIs privadas;
- limites de plano aplicados no backend e também por gatilhos no PostgreSQL;
- serialização temporária de escritas durante o boot para evitar deadlocks entre migrações concorrentes em instalações novas;
- credenciais de integrações cifradas com AES-256-GCM e tokens ERP armazenados somente por hash.

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

Variáveis principais:

```env
DATABASE_URL=postgresql://usuario:senha@host:5432/banco
SHOPVAX_PUBLIC_URL=https://seu-dominio-shopvax.com.br
SHOPVAX_INTEGRATION_SECRET=gere-um-segredo-longo-aleatorio-e-estavel
```

`SHOPVAX_INTEGRATION_SECRET` deve permanecer estável entre deploys: ele cifra chaves Asaas e segredos de webhook salvos no banco. Trocar essa variável sem migração das credenciais torna os segredos existentes indecifráveis.

`SHOPVAX_PUBLIC_URL` é usada para montar o callback público do Asaas e os links absolutos do feed Meta. As chaves Asaas são cadastradas dentro da própria loja em `/painel/integracoes`; não devem ser colocadas no código-fonte.

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
DATABASE_URL=postgresql://... \
SHOPVAX_PUBLIC_URL=http://127.0.0.1:3000 \
SHOPVAX_INTEGRATION_SECRET=segredo-local-longo \
npm start
```

O modo `SHOPVAX_ASAAS_MOCK=1` existe somente para testes automatizados da Fase 4 e não deve ser usado em produção.
