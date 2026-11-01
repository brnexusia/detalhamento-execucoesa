# ShopVax — autenticação de compradores via WhatsApp (central UAZAPI)

## Escopo e ativação
O envio de OTP utiliza a instância **já conectada** da central, sem alterar webhook, Chatwoot, UAZAPI ou fluxos n8n.
O fluxo é exclusivo do comprador; login do lojista permanece inalterado.

A integração só fica ativa quando **todas** as variáveis de ambiente estiverem presentes:

- `SHOPVAX_BUYER_WHATSAPP_LOGIN=1`
- `UAZAPI_BASE_URL=https://... ` — URL raiz da instância, sem /send/text
- `UAZAPI_INSTANCE_TOKEN=...` — somente no backend
- `SHOPVAX_OTP_HMAC_SECRET=...` — segredo aleatório com pelo menos 32 caracteres, estável e exclusivo

**Nunca** commitar credenciais, telefone de teste real ou código de verificação.
Sem a configuração, o login existente continua operacional e o novo módulo retorna disabled.

## Contrato HTTP

- `GET /api/public/buyer-auth/config`: `{ enabled }`.
- `POST /api/public/buyer-auth/request-code`: `{ storeSlug, phone }`.
- `POST /api/public/buyer-auth/verify-code`: `{ storeSlug, phone, code }`.
- `GET /api/public/buyer-auth/me`: dados do comprador autenticado.
- `PUT /api/public/buyer-auth/profile`: perfil pessoal/comercial e aceite de privacidade.
- `POST /api/public/customers/logout`: revoga sessão global e sessão legada quando presente.

Envia texto via `POST /send/text` com header `token`, `track_source:shopvax_auth`, `track_id` (UUID da tentativa) e `async:false`.
Somente o backend gera, armazena MAC, verifica e consome códigos (6 dígitos, 5 minutos, 5 tentativas), com limitação por telefone e IP.
Não usa mensagens de resposta do comprador para validação e não processa código dentro da IA/n8n.

## Fluxo de contas existentes
A identidade global é o telefone **verificado**, não o e-mail.
Cada loja cria seu próprio vínculo com `store_customers` e vê apenas seus pedidos/históricos.
Quando um cadastro antigo possui o mesmo número verificado, ele é reutilizado com seus pedidos.
Contas legadas sem telefone coincidente **não são fundidas pelo e-mail** — exigem recuperação/associação assistida.
A alteração não migra ou elimina dados de histórico.

## OBRIGATÓRIO ANTES DE HABILITAR EM PRODUÇÃO

1. Confirmar ambiente, SHA e backup restaurável do PostgreSQL.
2. Verificar no webhook real da central se mensagens enviadas via API são excluídas (`wasSentByApi`) ou se a ponte ignora especificamente `track_source=shopvax_auth` **antes de salvar no Chatwoot**. Não alterar webhook sem snapshot e rollback.
3. Demonstrar que o envio do código não gera conversa, resposta da IA, follow-up, atribuição ou bloqueio humano.
4. Validar UAZAPI conectada, timeout, rate limiting, código incorreto, vencido, reutilizado, reenvio e desconexão.
5. Testar comprador novo e antigo, duas lojas independentes, conta com e-mail repetido, mudança de loja, histórico e pedido com vendedora.
6. Testar desktop e mobile, página de login, cadastro condicional, edição, logout, multi-aba e cookies HTTPS.
7. Liberar a flag primeiro somente em ambiente de homologação com telefone de teste autorizado. Avaliar limites de envio e risco de restrição da conexão não oficial.
8. Depois do aceite operacional, ativar progressivamente na produção e monitorar falhas. Para rollback, desativar a flag, preservando os dados criados.

A ativação **não** deve ser considerada homologada apenas por build/CI, pois não verifica entrega real, Chatwoot, webhooks ou produção.
