# Shopvax — checklist final de lançamento

Este documento começa **depois** do fechamento das Fases 1–5. O código do MVP foi integrado ao `main` e os gates automatizados das Fases 1, 2, 3, 4, 5 e `validate` passaram no commit de fechamento.

## 1. Infraestrutura de produção

- Fazer deploy da branch `main` usando o `Dockerfile`.
- Expor a porta `80` do container.
- Confirmar `GET /health` com HTTP 200.
- Usar PostgreSQL persistente e configurar `DATABASE_URL`.
- Configurar domínio público com HTTPS válido.
- Definir `SHOPVAX_PUBLIC_URL` com a URL HTTPS real da aplicação.
- Definir um `SHOPVAX_INTEGRATION_SECRET` forte, estável e com pelo menos 32 caracteres.
- Não usar `SHOPVAX_ASAAS_MOCK=1` em produção.
- Não usar `SHOPVAX_PLAN_LIMITS_DISABLED=1` em produção.
- Não usar `SHOPVAX_SECURITY_RATE_LIMIT_DISABLED=1` em produção.

> O `netlify.toml` existente publica apenas o frontend estático (`dist`). Ele não inicializa o backend/API do Shopvax. O lançamento completo deve usar o runtime do `Dockerfile`.

## 2. Primeiro administrador

Somente se a base ainda não tiver administrador:

1. Definir temporariamente `SHOPVAX_ADMIN_BOOTSTRAP_TOKEN` com 24+ caracteres.
2. Criar/entrar na conta que será administradora.
3. Abrir `/admin` e ativar o primeiro administrador.
4. Remover `SHOPVAX_ADMIN_BOOTSTRAP_TOKEN` do ambiente depois da ativação.
5. Confirmar acesso a `/admin/lancamento`.

## 3. Diagnóstico de lançamento

No `/admin/lancamento`, confirmar que o diagnóstico não aponta pendências críticas de:

- URL pública HTTPS;
- segredo de integrações;
- bootstrap administrativo;
- rate limits;
- limites de planos;
- billing/estado das lojas.

## 4. Billing do Shopvax

- Confirmar os preços dos Planos 1, 2 e 3 no painel administrativo.
- Validar mensal, semestral e anual.
- Confirmar desconto padrão de 5% no semestral e 15% no anual.
- Confirmar que créditos de indicação são consumidos em renovações confirmadas.
- Confirmar que loja em atraso entra em tolerância e, ao expirar, fica suspensa.
- Confirmar que regularização reativa a loja.
- Se necessário, ajustar `SHOPVAX_BILLING_GRACE_DAYS`; padrão: 7 dias.

O ledger da Fase 5 registra renovações confirmadas pela operação. Ele não é um segundo checkout automático para cobrar a assinatura do SaaS.

## 5. Smoke test do lojista

Em uma loja de teste real, validar:

- login do proprietário;
- `/painel/assinatura`;
- criação e edição de produtos;
- múltiplas fotos e variações;
- catálogos e pedido mínimo;
- vendedoras e links individuais;
- carrinho;
- pedido para WhatsApp;
- login/cadastro do cliente;
- histórico de pedidos;
- comportamento dos limites conforme o plano;
- interface em celular.

## 6. Plano 3 — integrações reais

### Asaas

- Cadastrar uma chave real da loja em `/painel/integracoes`.
- Provisionar o webhook.
- Confirmar que a URL usa o domínio HTTPS de produção.
- Fazer uma cobrança de teste controlada e confirmar o webhook no Shopvax.
- Confirmar que pagamento financeiro **não** confirma venda/comissão automaticamente.

### Frete

- Criar regra por UF/CEP.
- Testar cotação e vínculo ao pedido.
- Validar frete grátis/valor/prazo quando configurados.

### Meta Shopping

- Abrir o CSV público da loja.
- Conferir produto, preço BRL, imagem, link e marca.
- Só depois cadastrar o feed na conta Meta da operação.

### API / ERP

Se a loja utilizar ERP:

- criar token com apenas os escopos necessários;
- salvar o segredo no ERP no momento da criação;
- testar leitura/escrita permitida;
- testar assinatura HMAC dos webhooks;
- testar revogação do token.

## 7. Segurança operacional

- Confirmar HTTPS antes de liberar clientes.
- Revogar sessões antigas de teste quando necessário.
- Confirmar que ações administrativas sensíveis pedem reautenticação.
- Confirmar que uma assinatura suspensa bloqueia mutações administrativas da loja.
- Não compartilhar tokens/chaves em código, issues ou arquivos versionados.
- Garantir rotina de backup do PostgreSQL na infraestrutura escolhida.

## 8. Critério de GO LIVE

O Shopvax pode ser tratado como homologado para lançamento quando:

1. o deploy Docker real estiver saudável;
2. domínio e TLS estiverem ativos;
3. `/admin/lancamento` estiver sem alerta crítico;
4. um smoke test completo de loja real tiver passado;
5. Asaas real tiver sido testado, caso pagamento online seja liberado no Plano 3;
6. o PostgreSQL tiver persistência e backup configurados.

Até esses itens externos serem verificados no ambiente real, o estado correto é: **MVP concluído em código e CI, aguardando homologação de produção**.
