# Captura completa de catálogos públicos — Atacado Shop

Este scanner lê vitrines **públicas e autorizadas**, sem automatizar login nem
descobrir preços ocultos. A importação segue o fluxo normal de revisão e não
publica produtos automaticamente.

## GoPage (.catalogo.com.br / .gopage.bio)

- Lê o JSON estruturado `[data-page]` da vitrine (Inertia).
- Usa `productsList.pagination.current_page/total_pages/total`; não interrompe
  após os 16 destaques da primeira página.
- Captura produtos, galeria de até 40 URLs, SKU, categorias, variações,
  atributos disponíveis, descrições, disponibilidade e preços por quantidade.
- Busca a página individual quando a listagem não apresenta a descrição,
  imagens ou detalhes de variações.
- Quando `page.prices_unlocked=false` ou `product.price_hidden=true`, não
  importa preços que não estão visíveis para visitantes. O campo fica
  pendente de revisão, sem inventar um valor.
- IDs repetidos ou páginas repetidas não geram duplicatas nem confirmação
  falsa de catálogo concluído.

## FácilZap (subdomínio e domínio próprio)

- Segue o redirecionamento público da loja para seu domínio próprio.
- Usa `FZCatalogoRuntime` e `carregar_produtos/{PAGE}/{CATEGORY}`,
  até o sinal `sem_mais_produtos`.
- Preserva variações por cor/tamanho, preço de variação, SKU, estoque
  público e todas as fotografias disponíveis no payload.
- Consulta páginas individuais para complementar dados disponíveis.
- Uma página repetida não é aceita como fim normal da importação.

## Vesti

- Para links públicos completos `/LOJA/catalogo/IDENTIFICADOR`, consulta
  o endpoint de catálogo público e segue `links.next`/metadados de paginação.
- Recupera produtos, imagens, códigos e os campos de preço/variação que a API
  entrega publicamente. Catálogos B2B podem ocultar preço e ficha técnica
  sem autenticação: eles permanecem vazios e requerem revisão/autorização.
- Links de marca sem identificador de catálogo podem não expor o catálogo
  completo; nesse caso o operador deve fornecer a URL pública específica.

## Sites ainda sem adaptador específico (incluindo “Diz”)

O crawler genérico usa HTML, JSON-LD, links de produtos, categorias e sitemap
quando disponíveis. A cobertura **não é certificada** para plataformas sem
contrato de paginação conhecido. Para criar o adaptador de uma plataforma
chamada Diz, é necessário ao menos um exemplo real de URL de catálogo público.
Não há API Diz validada nesta implementação.

## Evidências e limites

- Testes em `server/scanner-full-platforms.test.mjs`: retorno de todas as
  páginas, deduplicação, imagens, variantes, preços restritos, conclusão
  parcial sob limites explícitos e regressão de escala Shopify.
- Benchmark somente leitura: `scripts/benchmark-full-site-catalogs-20261107.mjs`.
  Não envia dados ao banco da loja; emite somente métricas agregadas.
- Um catálogo fica `complete=true` quando a listagem anunciada terminou ou
  a contagem pública informada foi alcançada. Isso não implica que todos
  os campos sejam públicos ou existentes na loja.
- Falhas de paginação retornam erro explícito, sem declarar primeiro lote
  como catálogo completo.
- Toda requisição segue o bloqueio de endereços privados e as restrições de
  protocolo, porta e redirecionamento do `safeRequest`.
