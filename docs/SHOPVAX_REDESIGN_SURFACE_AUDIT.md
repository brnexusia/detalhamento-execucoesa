# Shopvax — Auditoria transversal do redesign oficial

**Base do produto:** `docs/SHOPVAX_REDESIGN_PHASE1.md`, `docs/SHOPVAX_REDESIGN_PHASES_2_3.md`, `docs/SHOPVAX_REDESIGN_ACCEPTANCE_PHASES_2_3.md`. Pranchas originais: `Shopvax_ Catálogo (redesign).zip` (nove SVGs). O ZIP original agora está preservado integralmente em partes binárias reconstruíveis em `docs/references/redesign-original-parts/`. **A auditoria anterior foi executada antes da inclusão dessas fontes e não certifica equivalência pixel a pixel**; refazer comparação com os SVGs antes do aceite.

## Regra visual obrigatória

- Papel `#F3F0E8`, tinta `#161514`, divisória `#D9D3C6`, acento oficial `#F25C05`.
- Cabeçalhos `Archivo Narrow`, corpo `Archivo` e códigos/etiquetas `Fragment Mono`.
- Cor por loja é respeitada em elementos de ação; logo e nome da loja são protagonistas na vitrine e no perfil.
- Fitas operacionais, etiquetas de preço/referência e talão/grade; carimbo só para confirmação; nenhuma métrica ou preço fictício.
- Em telas móveis: conteúdo/CTA acessíveis; produtos preservam proporção original, sem recorte obrigatório.
- Não alterar regras comerciais, APIs, pagamentos, estoque, preços, comissão ou pedido para consertar CSS.

## Inventário de superfícies verificado

| Superfície | Evidência de implementação | Ação desta auditoria |
|---|---|---|
| Página institucional | `src/Home.tsx`, `src/shopvax-home.css`, PR #77 | Mantida, verificações já existentes |
| Login e cadastro do lojista | `src/Auth.tsx`, `src/saas.css`, `src/canvas.css` | Novo layout editorial, tokens oficiais e responsividade em `src/shopvax-auth-official.css`; login Google e formulário preservados |
| Feed social global | `src/SocialFeed.tsx`, `src/social-feed.css` | Remove verde neon, aplica sistema oficial com acento por loja e preserva ação de carrinho/WhatsApp |
| Perfil social da loja | `src/SocialStoreProfile.tsx`, `src/social-profile.css` | Cartão, cabeçalho, publicação e modal com sistema oficial; mantém marca da loja |
| Vitrine e catálogo | `src/PublicStoreV2.tsx`, `src/shopvax-commerce.css` | Preservados conforme PRs #56, #58, #71 e cobertura funcional |
| Feed do catálogo da própria loja | `src/shopvax-feed-redesign.css` | Preservado com cores oficiais, diferente do feed social global |
| Seleção e grade | `src/ShopvaxGrade.tsx`, `src/product-picker-responsive.css` | Preservados, inclusive layouts mobile da PR #55 |
| Talão e WhatsApp | `src/ShopvaxCheckoutReview.tsx`, `src/ShopvaxOrderReady.tsx` | Preservados; confirmação manual do envio |
| Dashboard e operação | `src/ShopvaxDashboard.tsx`, `src/shopvax-dashboard.css`, `src/AdminApp.tsx` | Preservados, reforço de tipografia/cor compartilhada |
| Onboarding | `src/ShopvaxFirstRun.tsx`, `src/shopvax-onboarding.css` | Removidos preço fictício da prévia e passo 1 de 2 indevidamente presumido |
| Planos | `src/ShopvaxPlans.tsx`, `src/shopvax-plans.css` | Preservados; preço e limites reais da API |
| Operação avançada e administração | `src/Phase2Panel.tsx`, `src/Phase3Panel.tsx`, `src/Phase4Panel.tsx`, `src/Phase5Panel.tsx`, `src/PlatformAdmin.tsx` | Alinhamento transversal de fontes, títulos e controles em `src/shopvax-cross-surface.css`, sem alteração comercial |
| Conta do comprador | `src/CustomerAccountRoute.tsx`, `src/customer-account.css` | Corrigido acento padrão legado, tipografia e cores do design |
| Movimentos, acessibilidade e responsividade | `src/shopvax-final-motion.css`, `src/canvas.css` | Preservados; CSS novo respeita `prefers-reduced-motion` e foco visível |

## Aceite de regressão

- `tests/shopvax-surface-redesign.e2e.mjs`: login, cadastro, feed social, perfil, modal de produto, talão social e onboarding em 390×844 e 1440×900, com CSS computado, marca por loja, ações e capturas.
- `tests/shopvax-home-brand.e2e.mjs`: identidade da home (existente).
- `tests/shopvax-final-responsive.e2e.mjs`, `tests/brand-phase1.e2e.mjs`, `tests/shopvax-feed.e2e.mjs` e demais testes funcionais (existentes).
- `.github/workflows/responsive-picker-check.yml`: agora dispara também quando login, feed social, perfil e CSS de identidade forem alterados.

## Limites do trabalho

Esta auditoria **não declara o redesign pixel a pixel concluído**: é necessário comparar lado a lado todas as nove pranchas originais. Também não comprova publicação no EasyPanel ou no domínio. Antes de homologar a produção, confirmar SHA do deploy, testar a loja e sua marca reais, fluxo de cadastro, feed e pedido em dispositivos móveis/desktop.
