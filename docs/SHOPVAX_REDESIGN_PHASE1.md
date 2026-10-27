# Shopvax — Redesign oficial · Fase 1 (Módulos 00, 01 e 02)

## Fonte da verdade

O arquivo **Shopvax_ Catálogo (redesign).zip**, recebido pelo Google Drive, contém nove pranchas vetoriais:

1. `01 · Conceito.svg` — "O TALÃO DE PEDIDO, NO CELULAR"; a loja na frente; preço e mínimo à vista; todos os nichos; do catálogo ao WhatsApp.
2. `02 · Sistema.svg` — sistema tipográfico, paletas e linguagem do balcão: fita, carimbo, etiqueta, número grande, cor.
3. `03 · Fluxo de compra no celular.svg`.
4. `04 · Uma plataforma, qualquer nicho.svg`.
5. `05 · Desktop.svg`.
6. `06 · Painel de quem vende.svg`.
7. `07 · Planos (página pra lojista).svg`.
8. `08 · Movimento (pro dev).svg`.
9. `09 · Fotos de exemplo (só pra apresentação).svg`.

As nove pranchas **definem o produto**, não um conjunto de inspirações. A Fase 1 instala a fundação; os módulos 03–14 seguem responsáveis pela substituição integral dos fluxos.

A fonte contém desenhos SVG convertidos em paths, não componentes React utilizáveis. **Não transportar fotografias de apresentação para a produção.**

## Módulo 00 — Auditoria e preservação

Inventário do repositório `brnexusia/detalhamento-execucoesa`:

| Superfície | Arquivos representativos | Diretriz |
|---|---|---|
| Rotas SPA | `src/App.tsx`, `src/PublicRoute.tsx`, `src/AdminRoute.tsx` | Preservar rotas, links públicos e acesso ao painel |
| Vitrine, feed e pedido | `src/PublicStoreV2.tsx`, `src/SocialFeed.tsx`, `src/SocialStoreProfile.tsx` | Substituição visual modular; não mudar preços/carrinho neste módulo |
| Identidade e conteúdo da loja | `src/AdminApp.tsx`, `src/types.ts`, `server/app.mjs` | Reusar `stores.name`, `logo_url`, `eyebrow`, `tagline`, `accent`, `minimum_order`, `whatsapp` |
| Pedidos e vendedoras | `server/app.mjs`, módulos operacionais | Não quebrar links individuais, checkout, atribuição ou mínimo |
| Importador e mídia | `server/scanner-*.mjs`, `server/import-media-localizer.mjs` | Preservar importação, galerias e cor/tamanho |
| Planos e limites | `server/system-plans.mjs`, `server/plan-limits-hooks.mjs` | Preservar Bronze, Prata e Ouro e limites do banco |
| Catálogos e PDFs | `server/catalog-features-hooks.mjs` | Preservar catálogo geral, PDF, variações e funções administrativas |
| Estilo legado | `src/styles.css`, `src/saas.css`, `src/canvas.css`, `src/product-picker-responsive.css` | Aplicar tokens oficiais por último sem eliminar lógica |
| Homologação | `.github/workflows/*.yml`, `tests/*` | Build, suítes existentes e verificação de identidade/compra |

**Invariantes desta fase:** não alterar API de pedidos, banco de produtos, envio ao WhatsApp, variantes, atribuição de vendedor, importação, catálogo PDF, nomes/links de lojas existentes, nem preços/limites dos planos. Esta fase não é o novo fluxo completo de compra.

**Observação:** o campo `accent` já existe no banco e é editável pelo proprietário. Não é necessária uma migração de schema para paletas. Lojas existentes conservam suas cores (inclusive personalizadas); o padrão de lojas novas usa a cor oficial Laranja Shopvax.

## Módulo 01 — Sistema visual oficial

### Tokens (confirmados pelos SVGs)

- `#161514` — tinta preta.
- `#F3F0E8` — papel.
- `#E7E3DA` — fundo geral do board.
- `#D9D3C6` — divisórias.
- `#6B665C` — informações secundárias.
- `#F25C05` — **laranja oficial Shopvax**.
- `#E9B21C` — mostarda.
- `#8A96A1` — grafite.
- `#2D2A8C` — tinta do carimbo, na amostra.

Tipografia: **Archivo Narrow** para títulos, **Archivo** para texto corrente e **Fragment Mono** para códigos, preços auxiliares, referência e número de pedido.

Componentes: `SVRibbon`, `SVStamp`, `SVTag`, `SVNumber`, `SVButton` e `SVBrandSignature`, em `src/ShopvaxDesignSystem.tsx`. Tokens e estilos em `src/shopvax-brand.css`.

**Regras semânticas obrigatórias conforme prancha 02:**

- **Fita:** informação operacional curta, ocupando a loja/painel, não em cima do produto.
- **Carimbo:** apenas confirmação de ação (item na grade, pedido pronto ou número confirmado); não é decoração permanente.
- **Etiqueta:** preço, categoria e referência; legibilidade e contraste antes de efeitos.
- **Número grande:** apenas métrica real e identificada (pedido, ranking, quantidade real); não inventar total de catálogo durante paginação.
- **Cor:** acento do botão principal, barra do pedido mínimo, contador e status; não pintar todas as áreas com o acento.
- **Marca:** o nome/logo da loja é sempre protagonista; "Shopvax" assina discretamente.

Os componentes implementam estilo **estático** nesta fase. As cinco animações específicas da prancha 08 pertencem ao **módulo 13**, sem alterar a acessibilidade e `prefers-reduced-motion`.

## Módulo 02 — Identidade por loja

- A vitrine usa `store.name` como título principal, `store.logoUrl` como marca visual quando configurada, `store.eyebrow` como identificação e `store.tagline` como mensagem da loja.
- Cabeçalho apresenta **nome da loja**, não "via Shopvax" como marca principal.
- Pequena assinatura Shopvax no fim do catálogo.
- Informação de vendedor vem exclusivamente de `seller.name` quando disponível.
- Três opções rápidas **Laranja, Mostarda e Grafite** em *Painel > Minha loja*; seletor de cor personalizado continua disponível.
- Paletas não alteram banco ou planos; salvamento aproveita o `updateStore` existente e o campo `stores.accent` com validação hexadecimal.
- Cores de lojas anteriores não são sobrescritas automaticamente.

## Critérios de aceite da Fase 1

1. Compilar frontend e executar suíte de validação/regras existentes.
2. Identidade da loja responde a variações de `name`, `logoUrl`, `accent`, `eyebrow`, `tagline` em telas mobile e desktop.
3. A paleta é selecionável, salva via API existente, e uma cor personalizada não é perdida ao abrir/editar.
4. A assinatura Shopvax fica em papel secundário.
5. Produtos, quantidades, variantes, carrinho, pedido mínimo e destino do WhatsApp continuam operando.
6. Ausência de efeitos visuais obrigatórios; preferência por movimento reduzido respeitada.
7. Nada da lógica de compra dos módulos 03–08 é substituído parcialmente.

## Próximas fases (fora deste PR)

- Módulos 03–08: vitrine final das pranchas, feed, catálogo, grade múltipla, talão persistente e WhatsApp.
- Módulos 09–11: painel final, operação, onboarding e planos.
- Módulos 12–14: desktop, outros nichos, movimento e homologação visual completa.

**Implantação:** merge no GitHub não equivale a deploy da loja pública; validar build/versão de produção separadamente.
