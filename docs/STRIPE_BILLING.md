# Shopvax — integração de assinatura com Stripe

## Escopo (SaaS, não pagamentos dos compradores)
Esta integração cobra **apenas o acesso dos lojistas ao Shopvax**. Pedidos que os compradores enviam ao WhatsApp continuam fora do gateway. Os planos existentes no backend permanecem a fonte dos limites: Bronze (R$ 49,90/mês), Prata (R$ 94,90/mês), Ouro (R$ 144,90/mês), com 5% de desconto no semestral e 15% no anual. A integração cria automaticamente Produtos e Prices da Stripe ao primeiro checkout; não é preciso cadastrar nove preços manualmente.

| Plano | Mensal | Semestral (-5%) | Anual (-15%) |
| --- | ---: | ---: | ---: |
| Bronze | R$ 49,90 | R$ 284,43 | R$ 508,98 |
| Prata | R$ 94,90 | R$ 540,93 | R$ 967,98 |
| Ouro | R$ 144,90 | R$ 825,93 | R$ 1.478,98 |

Ciclos: assinatura mensal, assinatura a cada **6 meses** e assinatura **anual**. Valores são cobrados pelo período inteiro, não mensalidades fracionadas.

## Credenciais e vinculação — no EasyPanel, nunca no repositório

A implantação requer HTTPS no domínio da aplicação, PostgreSQL, migração/backup validado e estas variáveis **no serviço backend**:

```dotenv
SHOPVAX_PUBLIC_URL=https://shopvax.com.br
SHOPVAX_STRIPE_SECRET_KEY=sk_test_...     # substituir por sk_live_... ao homologar produção
SHOPVAX_STRIPE_WEBHOOK_SECRET=whsec_...    # segredo do endpoint da Stripe correspondente
```

A conexão é ativada automaticamente apenas quando as três variáveis estiverem válidas. O aplicativo **não precisa de publishable key**: Checkout e Billing Portal são hospedados pela Stripe. Não colocar `sk_` ou `whsec_` no frontend, Vite, GitHub, ticket ou mensagens públicas. Preferir variáveis secretas do EasyPanel. As variáveis não são enviadas por GET /health nem pelo frontend.

Na Stripe, configurar um webhook de produção em:

```
POST https://shopvax.com.br/api/billing/stripe/webhook
```

Eventos a selecionar:
- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copiar o **signing secret deste endpoint** para `SHOPVAX_STRIPE_WEBHOOK_SECRET`, sem compartilhar publicamente. O endpoint exige assinatura HMAC válida do payload bruto com tolerância máxima de 5 minutos. Respostas de erro são repetidas pela Stripe; `event_id` garante processamento idempotente no PostgreSQL.

## Como funciona

1. O cadastro cria a loja sem liberar recursos pagos automaticamente. Para novas lojas, depois de configurar a Stripe, `stores.billing_required` é `true`; a base já existente permanece isenta até migração comercial explícita, não sendo bloqueada em um deploy sem cobrança.
2. A visita a **/painel/assinatura** mostra plano/ciclo, checkout, estado confirmado e acesso às faturas, cartão e cancelamento.
3. `POST /api/billing/checkout` (sessão do proprietário) aceita somente `planCode` bronze/prata/ouro e `cycle` monthly/semiannual/annual. O servidor determina o valor: o navegador nunca manda um preço. O checkout hospedado aceita cartão para renovações confiáveis.
4. O retorno para o site **não ativa o plano**. A ativação é feita somente após `invoice.paid` da Stripe, assinatura de webhook verificada, vinculação da assinatura ao customer/loja e price ID cadastrado.
5. O banco registra plano ativo, data de término, evento e invoice. A verificação de acesso usa status ativo e período pago válido; `past_due`, `unpaid` ou `canceled` não são considerados acesso pago.
6. A troca de plano é feita por `POST /api/billing/change`. Pode haver cobrança proporcional imediata, e o plano só passa a valer quando a Stripe confirma o pagamento aplicável. A Stripe Billing Portal cuida de cartão, histórico de faturas e cancelamento ao fim do período.
7. Eventos repetidos ou atrasados não duplicam concessões. A loja proprietária é identificada por sessão segura; webhook não aceita store IDs de payloads não assinados para alterar outra empresa.

Rotas disponibilizadas:
```
GET  /api/billing/status
POST /api/billing/checkout
POST /api/billing/change
POST /api/billing/portal
POST /api/billing/stripe/webhook
```

## Regras de lançamento e limitações

- Testar primeiro **com `sk_test_` e webhook de teste**, utilizando uma cópia restaurável do banco sem dados pessoais reais. Para live, usar `sk_live_`, endpoint live e **banco isolado**; nunca trocar chaves mantendo customers/prices de um ambiente. O código impede reaproveitar um customer de ambiente diferente.
- Os recursos pagos das novas lojas são bloqueados até confirmação. Isso não apaga conteúdos antigos, produtos, fotos, catálogos ou pedidos. Alterações nos limites do plano continuam validadas pelas regras existentes do backend.
- A migração para cobrança de lojas legadas deve ser decidida explicitamente, com aviso comercial e backup; **não** alterar `billing_required` em massa durante um primeiro deploy.
- O painel da Stripe precisa estar com a conta verificada e pagamentos recorrentes habilitados. A Stripe pode solicitar dados cadastrais e documentos para liberar cobrança/pagamento.
- Pix Automático/recorrente não está disponível para contas Stripe brasileiras no cenário documentado; cartão é o método inicial de assinatura. Pix avulso, boleto e outros meios são módulos futuros separados; **não** marcar Pix como assinatura recorrente sem implementação própria e validação.
- Eventos Stripe, testes locais e CI **não substituem** homologação real com pagamento `sk_test_`, webhook recebido, renovação, falha, cancelamento e compra em mobile. Sem as credenciais Stripe, não se pode afirmar que a cobrança externa foi validada.
- A Stripe pode cobrar taxas de processamento e Billing; verificar tabela atual diretamente na sua conta antes de ativar em produção.

## Roteiro mínimo de homologação

1. Backup e teste de restore PostgreSQL; atualizar backend Docker; configurar secrets de TESTE.
2. Criar duas lojas novas e uma legada. Confirmar que as novas estão restritas sem pagar e a legada continua acessível; confirmar isolamento multiempresa.
3. Executar checkout Bronze mensal, Prata semestral e Ouro anual com cartões de teste Stripe. Conferir valores, assinatura, invoice paga, webhook com assinatura correta e desbloqueio do plano.
4. Tentar replay e payload adulterado. Confirmar idempotência e rejeição.
5. Testar upgrade/downgrade, faturas, atualização de cartão, falha de renovação, `past_due`, cancelamento ao final e nova assinatura após cancelamento.
6. Testar concorrência de dois checkouts na mesma loja, usuários simultâneos, relogin, Chrome Android e Safari iOS. Conferir se qualquer tentativa de selecionar Ouro sem pagar é bloqueada no backend.
7. Confirmar HTTPS, webhook live e `SHOPVAX_RELEASE_SHA` igual ao commit realmente publicado antes de ativar cobrança real.

## Operação e observabilidade

- Inspecionar `shopvax_stripe_billing` e `shopvax_stripe_events` por ID técnico em caso de disputa. Não exportar dados de cartão.
- Se não houver `invoice.paid`, não ativar manualmente por redirecionamento. Investigar eventos na Stripe, assinatura do endpoint, período de pagamento e logs do backend.
- Antes de rollback, preservar backup e reconciliação das assinaturas Stripe existentes. Não apagar tabela nem customer ids indiscriminadamente.
