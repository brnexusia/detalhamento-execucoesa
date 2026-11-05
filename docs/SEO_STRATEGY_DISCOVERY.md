# ShopVax — SEO sem alteração do produto ou do layout

## Intenções de busca separadas

- **Busca genérica de solução:** `/para-lojas` é a página comercial para “catálogo digital”, “catálogo digital para lojas”, “catálogo de atacado”, “loja digital” e termos relacionados à preparação de pedidos pelo WhatsApp. A página `/` é de descoberta de vitrines e produtos, não a landing page do software.
- **Busca por empresa/marca:** `/{slug}` e `/perfil/{slug}` usam o nome público exato de cada loja, sua tagline se existir e links para produtos públicos. Não inventar localização, segmento, avaliações ou condições comerciais.
- **Busca por produto:** `/{slug}?produto={id}` usa nome do item e da loja e dados estruturados com preço público realmente publicado; sem reviews, estoque ou disponibilidade fictícios.

## Mudanças nesta rodada

- Metadados descritivos e específicos por intenção de busca (home, marketing, loja e produto).
- `Store`, `BreadcrumbList` e `CollectionPage` com `ItemList` apenas quando houver produtos elegíveis, usando os mesmos IDs e nomes da consulta pública do catálogo padrão.
- Nenhum arquivo em `src/`, CSS, rota de checkout, autenticação ou banco foi alterado.
- Preservadas URLs canônicas, sitemaps, regras de segurança e renderização existente.

## Próximos indicadores

1. Publicar o SHA validado e conferir `/health` e `/shopvax-ui-version.json`, além do HTML público sem login (código correto no servidor; SHA configurado isoladamente não prova implantação).
2. Inspeção ao vivo no Search Console para `/`, `/para-lojas`, uma loja com produtos, uma loja vazia e um deep link para produto.
3. Acompanhar consulta, página, CTR, cliques, posição média e impressões no Search Console antes e após o recrawl. Segmentar marca Shopvax, termos genéricos e nomes exatos de lojas.
4. Conteúdo editorial útil e links de referência legítimos são necessários para aumentar relevância em termos competitivos. **Não** gerar páginas doorway, reviews falsos, keyword stuffing ou links comprados.
5. O Google decide a indexação e a classificação. Nenhuma posição específica é garantida.

Referências:
- https://developers.google.com/search/docs/appearance/snippet
- https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
- https://developers.google.com/search/docs/specialty/ecommerce/help-google-understand-your-ecommerce-site-structure
- https://developers.google.com/search/docs/fundamentals/seo-starter-guide
