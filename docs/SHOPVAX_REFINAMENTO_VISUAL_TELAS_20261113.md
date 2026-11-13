# ShopVax — refinamento individual do frontend (13/11/2026)

## Referência e escopo
- Repositório: `brnexusia/detalhamento-execucoesa`; PR de revisão: **#238**.
- Mapeamento Graphify do workspace `saas` (`AdminApp`, `CatalogManager`, `PublicStoreV2`, `SocialFeed`, `SocialDiscover`, `SocialStoreProfile`, `SocialShopping`, `ShopvaxDashboard`, `ShopvaxOrders`, `PlatformAdmin` e dependências).
- Referência visual original: pranchas oficiais do redesign em `docs/references/`, tokens de `shopvax-brand.css`, tipografia Archivo / Archivo Narrow e a marca aprovada. O novo conceito **complementa** essa referência com cantos moderados, bordas finas, cor de ação controlada e composição mais leve; não substitui a identidade visual própria de cada lojista.
- Alterações deste PR são de **apresentação CSS**; backend, contratos, navegação React, cobrança, isolamento multiempresa e regras de envio ao WhatsApp **não foram modificados**.

## Convenções visuais compartilhadas
- Raio pequeno 6 px; controle 8 px; card 12 px; modal 16 px; avatares circulares preservados.
- Fundo de papel `#F3F0E8`, superfície `#FCFBF8`, divisória `#D9D3C6`, tinta `#161514`. Laranja oficial `#F25C05` para seleção e ações ShopVax, sem interferir no `--accent` / `--social-store-accent` configurado por loja.
- Foco visível por teclado, controles essenciais com pelo menos ~40–44px, textos sem recortes e rolagens locais para tabelas/diálogos.
- Sem remover fotos, vídeos, seleção de produto, filtros, links, ações de catálogo ou marca do lojista.

## Matriz de refinamento individual
| Superfície | Arquivos de estilo modificados | Refinamento de apresentação |
|---|---|---|
| Feed social | `shopvax-social-official.css`, `shopvax-social-feed-layout.css` | Hierarquia de título/descrição, ações laterais, contraste e CTA sem perder mídia full-bleed |
| Feed da loja | `shopvax-store-layout-fixes.css` | Navegação, texto e ações responsivas |
| Busca e descoberta | `buyer-app.css` | Campo de busca, filtros, chips, seção de lojas e cards |
| Salvos | `buyer-app.css` | Abas, cartões e estados vazios |
| Carrinhos sociais | `buyer-app.css` | Linhas, quantidade, total, CTAs e quebra de layout |
| Perfil do comprador | `buyer-app.css` | Identidade, pedidos e navegação |
| Perfil público de loja | `social-profile.css` | Identidade do lojista, estatísticas, ações e grades |
| Compra social | `social-shopping.css` | Mídias, opções, quantidades, resumo e modais |
| Seleção de conta | `social-account-choice.css` | Escolhas visualmente claras e foco |
| Catálogo/vitrine pública | `shopvax-commerce.css` | Hero, categorias, pesquisa, cards, destaque de preço e CTA respeitando acento do lojista |
| Cabeçalho de loja | `shopvax-store-layout-fixes.css` | Alinhamento, menus móveis e controles |
| Página detalhada do produto | `shopvax-desktop-product-page.css`, `product-picker-responsive.css` | Galeria, miniaturas, variações, botões, quantidade e layout móvel |
| Talão lateral no catálogo | `shopvax-desktop-ticket-05.css` | Linhas de produto, progresso do mínimo e revisão |
| Pedido pronto para WhatsApp | `shopvax-order-ready.css` | Mensagem revisável e ações de copiar/enviar com hierarquia |
| Dashboard do lojista | `shopvax-dashboard.css` | Números, pedidos recentes, setup e links |
| Produtos do lojista | `shopvax-product-operations.css` | Seleção em massa, categorias, pesquisa, lista compacta, edição e confirmação |
| Catálogos do lojista | `catalog-manager.css` | Cards, links, opções, estado ativo e diálogo |
| Pedidos do lojista | `shopvax-orders.css` | Filtros, lista, status, talão, dados do comprador e detalhe |
| Equipe / vendedoras | `saas.css`, `team-panel.css` | Linhas, dados, métricas, permissões e ações |
| Minha loja e editor | `saas.css` | Campos, mídia, formulários, preview e salvar |
| Estoque e variações | `business-features.css` | Quantidades, linhas, variações e ações |
| Condições comerciais | `commercial-settings.css` | Formulários, caixas e opções |
| Temas e paletas | `shopvax-themes-panel.css` | Seleção de tema, paleta, preview e sazonalidade |
| Relatórios e inteligência | `analytics-panel.css` | Métricas, tabelas, gráficos de funil e filtro de período |
| Operação / domínio | `phase2-panel.css` | Clientes, vendedores, domínio, listagens e formulários |
| Crescimento, comissões | `phase3-panel.css` | Métricas, campanhas, formulário e comissões |
| Integrações | `phase4-panel.css` | Seções técnicas, entradas, estados e tabelas |
| Plano / uso | `phase5-panel.css`, `stripe-billing.css` | Limites, ciclo, planos, assinatura, preços e estados |
| Importação de catálogo | `scanner-module1.css` | Upload, jobs, lista de produtos, revisão manual e editor |
| Publicação/importação | `scanner-publish.css` | Status, progresso, modo e ações |
| Cadastro e login | `shopvax-auth-official.css` | Formulário, campos, botões, copy, estados e acessibilidade |
| Onboarding | `shopvax-onboarding.css` | Cartões de escolha, visualização e CTA |
| Suporte e preferências | `shopvax-growth.css` | Ajuda contextual, preferências do comprador, FAQ e formulário |
| Landing comercial | `shopvax-home.css` | Hero, chamadas, pricing e ações |
| Comparação de planos | `shopvax-plans.css` | Tabela rolável, benefícios e CTAs |
| Conta do comprador (loja) | `customer-account.css` | Dados, WhatsApp, pedidos, formulários e feedback |
| Admin plataforma | `platform-admin.css`, `platform-admin-ops.css` | Menu, cards, planos, lojas, filtros e auditoria |
| Admin compradores | `platform-buyers.css` | Métricas, listas, detalhe e tabelas |
| Parceiros | `partner-portal.css` | Links de indicação, histórico, funil e métricas |

## Validação e limites
- Este documento registra **alteração de código**, não aprovação visual pixel a pixel.
- O build e os workflows precisam ser avaliados no SHA final da branch; a `main` já tinha falhas em `validate`, `shopvax-feedback-ui`, `free-signup`, `phase5-final-mvp` e `stripe-payment-gate` na revisão anterior.
- Critérios antes do merge: inspecionar telas renderizadas nas larguras **320/390/430px** e desktop, testar rolagem, cards, detalhes, modais, foco, estados vazios, erro, loading, imagens reais, media e overlays.
- Conferir produtos com muitos nomes/variações, duas lojas com cores distintas e o mesmo catálogo, navegação e ações de compra; verificar `/buscar` em produção, pois a navegação direta retornou **HTTP 404** no teste anterior (problema de roteamento/deploy fora deste PR de CSS).
- Para publicação, seguir `docs/SHOPVAX_RELEASE_GATE.md` (backup/restore, deploy identificável, smoke funcional, rollback).
