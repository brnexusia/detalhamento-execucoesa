# ShopVax — Frente 02/06: compradores, pedidos e segurança comercial

Base inicial: `main` em `2a4909dbd7f976c686b510e861f8558c1f3a381a`. Integração exclusivamente por PR da branch `parallel/02-commerce-security`. Não executar merge por esta frente.

## Invariantes comerciais

1. O WhatsApp principal é administrativo. Somente uma vendedora ativa com telefone válido pode ser o destino de pedido/pergunta. Sem nenhuma, responder `409 NO_AVAILABLE_SELLER`, sem gerar pedido nem baixar estoque.
2. O checkout gera um **talão/preparação**, não confirma envio de mensagem, pagamento ou faturamento. A abertura do WhatsApp depende de clique explícito do comprador.
3. Preços, limites por catálogo, opções válidas, estoque e autorização são decididos pelo backend. O mesmo produto pode aparecer em vários catálogos, sem duplicar estoque.
4. Pedidos e dados de clientes devem ser segregados por loja e por identidade autenticada; visitantes podem continuar preparando pedidos sem conta obrigatória.

## Auditoria e intervenções

| Área | Estado de partida | Ajuste desta frente | Evidência |
| --- | --- | --- | --- |
| A01 — pedido e atribuição | Proteções integradas nos PRs #110 e #119. | Mantidas; novo teste para vendedora inativa, telefone legado inválido e ausência de vendedora, comparando o número administrativo. | `server/commerce-security-front02.integration.mjs` e regressões existentes. |
| A02 — conta do comprador | Cadastro/login, cookie independente e lista `customer_id + store_id` já existentes. | Cache privado `no-store` no login/cadastro/histórico e vitrine personalizada; labels e explicações precisas para `whatsapp`, `em_atendimento`, `confirmado`, `arquivado`, `cancelled`. | Teste de integração com duas lojas e três compradores; `tests/shopvax-buyer-session-status.e2e.mjs`. |
| A03 — duas abas e troca de usuário | Já havia sinal de `localStorage`/evento local e revalidação em foco. | `BroadcastChannel` com fallback de `storage`, deduplicação de sinais, `visibilitychange`, limpeza de formulário e logout que só afirma êxito após revogação no backend. | E2E com duas abas, troca de dois usuários, logout e recuperação de falha de rede; `tests/shopvax-auth-multitab.e2e.mjs`. |
| Segurança de login | Limites de tentativas protegiam lojistas, não compradores. | Rate-limit de login (12/15min) e cadastro (6/h) de comprador por rota de loja/IP, mesmas mensagens e configuração de desativação de testes existentes. | `server/buyer-auth-rate-limit.integration.mjs` no perfil seguro do CI. |
| Integridade de pedidos | Transação com `SELECT ... FOR UPDATE` e cancelamento idempotente preexistentes. | Sem reescrita; regressão de estoque concorrente, preço adulterado, associação do pedido à conta e devolução única. | `server/commerce-security-front02.integration.mjs`. |

## Testes conectados aos workflows

- `phase2-final-mvp.yml`: suite já existente da Fase 2 + `server/commerce-security-front02.integration.mjs` (PostgreSQL real no GitHub Actions).
- `responsive-picker-check.yml`: E2E existente de duas abas para lojista + novo E2E de comprador (Chromium).
- `ci.yml`: teste de limitação de tentativas do comprador na instância segura (rate limit ativado).
- Demais workflows continuam rodando no PR para detectar regressões e `npm run build`.

## Riscos, testes manuais e fronteira de homologação

- Repetir em HTTPS real com duas lojas de homologação e dois navegadores/dispositivos; conferir cookies Secure/HttpOnly/SameSite por proxy.
- Validar WhatsApp em dispositivo real, incluindo app instalado e sem vendedora; **abrir** não comprova mensagem **enviada**.
- Revisar migrações, consistência do Postgres, concorrência sob carga, backup/restore e SHA implantado no EasyPanel antes de liberar.
- Sem dados de produção, ambiente de loja real ou aceitação visual externa, não há homologação real nem autorização para afirmar venda concluída.
- A02/A03 desta frente não substituem A04/A05/A06/A07 da issue #109; aprovação e integração ficam com Frente 01.

Status de CI, resultados de revisão, SHA final e bloqueios devem ser conferidos no PR da frente, sem marcar teste como aprovado antes de execução observável.
