# ShopVax — Frente 03/06: onboarding, aquisição e suporte

Branch: parallel/03-onboarding-growth. Origem: issue #109 (A04–A07 e B01–B04).

## O que foi codificado

- B01: guia progressivo no painel e paleta inicial existente. Identidade, vendedora ativa e produto publicado são conferidos no banco. Pedido mínimo, prévia e explicação de WhatsApp exigem uma confirmação consciente, persistida por loja. Pular não conclui etapa e a dashboard permite retomar.
- B02/B03: ajuda contextual para lojista e comprador, com perguntas por contexto. A opção de captura usa seleção voluntária e compartilhamento nativo quando disponível; navegadores não detectam screenshot. Nenhum vídeo foi inserido sem material aprovado.
- B04: verificação de configuração real do Google, estado de carregamento, falha e responsividade; o login no backend é preservado. Falta validar OAuth com credencial/origem reais.
- A04: opt-in separado WhatsApp/e-mail, escolha das lojas disponíveis no momento (todas ou específicas), revogação e auditoria por canal, sem disparo de mensagens.
- A06: convite não invasivo para criar conta de comprador, apenas visitante sem sessão na loja atual ou marca booleana local de conta conhecida, fechamento e frequência de sete dias por localStorage; nenhum fingerprint, IP ou IMEI é usado como identificador de marketing.
- A05: ajuda central, assuntos classificados e registro técnico de suporte humano; nenhum telefone, IA ou canal externo é anunciado como ativo. Formulário de ticket desligado por padrão.
- A07: convite de comprador não anuncia planos nem inventa preços. Contextos comerciais e assinatura pertencem ao lojista; esta frente não modifica cobrança.

## APIs isoladas

Hook: server/onboarding-growth-hooks.mjs (inicializado por package.json e Dockerfile).

GET /api/admin/growth/onboarding — estado e confirmações por lojista.
POST /api/admin/growth/onboarding/confirm — confirmação explícita limitada a minimum_reviewed, preview_opened e whatsapp_understood.
GET /api/public/growth/stores — nomes/IDs/slugs de lojas ativas.
GET/PUT/DELETE /api/public/store/:storeSlug/growth/consent — preferência autenticada de comprador, com auditoria e revogação.
GET /api/public/support/config — configuração real; IA e envio de mensagens sempre falsos nesta versão.
POST /api/public/support/tickets — por padrão HTTP 503, ativa somente quando a operação assumir atendimento.

Tabelas: shopvax_growth_consents, shopvax_growth_consent_audit, shopvax_growth_onboarding, shopvax_support_tickets.
Todas as permissões comerciais começam falsas. A opção todas congela a lista no momento do aceite; futuras lojas exigem nova escolha. Identificação do comprador é a sessão por loja da Frente 02. Nunca inferir consentimento de criação de pedido.

## Ativações externas e segurança

SHOPVAX_SUPPORT_TICKETS_ENABLED=0 por padrão. Só alterar para 1 depois que a equipe humana, acesso seguro à fila, prazo de resposta, retenção/exclusão e canal de retorno estiverem aprovados. O ticket registra relato, assunto, contato fornecido voluntariamente e flag de escalonamento humano; não envia WhatsApp/e-mail nem executa IA. Anexos de screenshot não são enviados ao backend. Rate limit temporário do formulário usa IP apenas em memória por 10 minutos para anti-abuso, nunca para identificar visitantes/ofertas.

Para operar a fila de tickets deve-se adicionar um painel de atendimento com permissões centrais, ou conceder acesso operacional de banco apenas a pessoas autorizadas. Esta frente não expõe os relatos em endpoints públicos.

## Testes

- node --test server/onboarding-growth-policy.test.mjs
- node --check server/onboarding-growth-hooks.mjs
- npm run build
- Com PostgreSQL e ShopVax localhost:3000: node server/onboarding-growth.integration.mjs
- Com Vite localhost:5173 e Playwright Chromium instalado: node tests/shopvax-growth.e2e.mjs

CI validate: política, sintaxe, build, integração PostgreSQL. CI responsive-picker-check: visual mobile (390x844) e desktop (1366x768), com screenshots em artifacts/shopvax-growth/.

GitHub Actions verde não comprova comportamento no iPhone/Android real, produção EasyPanel, domínio OAuth, integração oficial ou atendimento humano efetivo. As verificações de produção e identidade continuam nas issues #75 e #91.

## Integrações com outras frentes

Frente 02: preservar rotas existentes de comprador, sessões e contas; unir identidade entre lojas somente em migração controlada, nunca ampliando consentimento implicitamente. A aquisição confirma a sessão da loja visitada e guarda somente booleano local de conta de comprador conhecida; em novos dispositivos sem login a identificação global ainda depende da Frente 02.

Frente 01: integrar sem sobrescrever branches paralelas, revisar avisos comerciais no painel do lojista e executar homologação em dispositivos reais e WhatsApp de vendedoras. Não publicar a frente sem aceite dos gates.

Operação externa: vídeo explicativo depende de conteúdo autorizado; Google Login depende de GOOGLE_CLIENT_ID e origens autorizadas; suporte humano e qualquer envio de ofertas dependem de canal/configuração/consentimento/aprovação reais.
