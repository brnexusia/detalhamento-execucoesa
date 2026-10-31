# Shopvax — Frente 06/06: performance administrativa, API e PostgreSQL

Data da revisão: 31/10/2026. Base inicial da `main`: `2a4909dbd7f976c686b510e861f8558c1f3a381a`.
Branch de trabalho: `parallel/06-admin-backend-performance`. PR: #122 (sem merge automático).

## Evidência de código (não equivale a perfil de produção)

| Superfície | Comportamento anterior | Alteração nesta branch | Validação |
| --- | --- | --- | --- |
| Abertura do painel | `/api/admin/bootstrap` materializava `SELECT * FROM products` de toda a loja | `?compact=1` responde sem linhas de produtos, com `productCount` e categorias agregadas; formato legado preservado | `server/admin-pagination.integration.mjs` |
| Produtos | `src/AdminApp.tsx` filtrava todos os produtos no browser e fatiava 18 na UI | Endpoint `GET /api/admin/products` (página 1..1.000.000, limite 1..100, busca/filtragem SQL por loja) e busca com debounce de 250ms | Integração com duas lojas e E2E do grid |
| Navegação | Voltar à lista podia recarregar todo o bootstrap | Componente de Produtos continua montado ao alternar abas internas, sem consultas de lista em troca ociosa | Validação de navegação pendente em browser real |
| Salvar/excluir/publicar | Produtos recarregados no bootstrap completo | Invalidação somente da página da lista e do resumo compacto; outras ações preservadas | Integração e smoke de edição pendentes |
| Scanner | `MutationObserver(document.body,subtree:true)` e polling de 2s, mais segundo observador/polling de 2,5s no publicador | Eventos explícitos de montagem, visibilidade e jobs, polling ativo com backoff, pausado em aba oculta ou sem jobs | Compilação/E2E de scanner pendentes |
| API/PG | Potencial custo crescente ao listar tudo | Limite efetivo no SQL, paginação parametrizada e filtro `store_id` derivado da sessão | Integração de acesso e benchmark em DB descartável |

A seleção em massa agora seleciona itens da **página visível** (com acumulação voluntária entre páginas). O texto não afirma selecionar todos os resultados do servidor. O limite operacional de 5.000 IDs por chamada permanece. A geração de PDF continua sendo operação explicitamente solicitada, nunca um processamento disparado pelo carregamento da página.

## Escopo e segurança

- Nunca usar `store_id` enviado pelo navegador para decidir tenant. O backend resolve a loja por `req.user.id`.
- `/api/admin/bootstrap` legado é preservado para clientes/integrações existentes; o modo compacto é opt-in.
- Sem alteração de limites comerciais, preços, estoque transacional, validações do checkout, vendedora, cálculo de pedido mínimo, índices ou migrações da produção.
- Sem reintrodução do polling de carrinho corrigido no PR #117.
- Parser PDF, Poppler/Tesseract, limites anti-bomba (50 MB, 200 páginas) e revisão humana não foram afrouxados.
- O botão de importar/publicar continua exigindo intervenção humana.
- Feed social, ranking e experiência pública permanecem sob a Frente 05; lógica comercial sob a Frente 02.

## Reproduzir as medições sem produção

O workflow `.github/workflows/admin-performance-lab.yml` cria um **PostgreSQL 16 descartável** no GitHub Actions, compila e inicia a aplicação, e invoca `scripts/admin-performance-benchmark.mjs`.

- Catálogo sintético acumulativo: **500, 5.000 e 20.000 produtos** da mesma loja Ouro de teste.
- Cenários: **10, 100 e 1.000 lojas simuladas no banco** (não representam mil lojistas conectados simultaneamente).
- Cada endpoint tem aquecimento e 24 requisições em lotes de 4 clientes concorrentes, registrando p50/p95/p99 e tamanho da resposta.
- Rotas medidas: bootstrap compacto, primeira página de produtos, busca filtrada com paginação.
- Coleta: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` da listagem por loja, contagem de conexões vistas e tamanho do banco de teste.
- O relatório JSON é salvo em artefato `admin-performance-baseline` do workflow, com condições do experimento.

Para execução manual, configurar apenas uma base local e descartável terminada em `_test` ou `_perf`, com `SHOPVAX_PERF_LOCAL_ONLY=1`, e iniciar o backend local na mesma máquina. O script recusa hosts remotos. **Não executar contra VPS ou produção.**

`p99` calculado sobre 24 amostras serve apenas como sinal exploratório. Não constitui SLO estatisticamente confiável. CPU/RSS da API, event loop, consultas reais por segundo, 100 pedidos na interface, redes móveis e 10/100/1.000 sessões concorrentes exigem instrumentação/homologação adicional.

## Riscos e decisões adiadas

1. **Pools:** 16 módulos inicialmente inspecionados possuem tetos individuais cuja soma é **92 conexões por processo**. Isso é capacidade máxima configurada, não contagem de conexões atuais. Com réplicas, o teto teórico multiplica. Medir `pg_stat_activity` e a configuração `max_connections` antes de consolidar pools ou alterar cotas.
2. **Mídia BYTEA:** uploads e variantes permanecem no PostgreSQL. Testar cache misses sob concorrência, largura de banda, buffers em memória e resposta HTTP antes de migrar para storage externo/CDN.
3. **Consultas de ranking:** CTEs/contadores sociais são de propriedade compartilhada com a Frente 05. Não modificar prioridades por plano/diversidade sem equivalência funcional e perfil de banco.
4. **Índices:** evitar criar índices durante boot por suposição. Após baseline, comparar planos de execução reais para `(store_id,created_at DESC,id DESC)`, `(store_id,category,created_at DESC,id DESC)` e `(store_id,kind)` nos eventos. Avaliar `CREATE INDEX CONCURRENTLY` em janela controlada se necessário.
5. **Importação PDF/OCR:** o worker já limita o próprio loop com `workerBusy`, mas pode competir por CPU/RAM com o Node e o sistema operacional. Medir latência de API durante OCR antes de decidir por processo dedicado.
6. **Pesquisa substring:** `position(...)` preserva busca por nome/SKU/categoria, mas pode custar O(n) por loja. Índices trigram só devem ser considerados após EXPLAIN e avaliação de escrita/custo de storage.

## Aceite para fechar a Frente 06

Exigir: CI verde, integrações e E2E do painel, relatório antes/depois de um mesmo ambiente, p50/p95/p99 em amostras maiores, CPU/RSS/event loop observados, 100 pedidos reais de teste na interface, concorrência de leituras/escritas, planos e autorização com lojas distintas, backup/restore e smoke em celular/rede fraca. Nenhum desses itens pode ser declarado aprovado apenas porque este documento existe.

Não fazer merge na `main` até revisão humana e evidências suficientes. GitHub Actions verde não é homologação EasyPanel.

## Encerramento de integração — regressão do talão (31/10/2026)

### Causa raiz e correção

- A aplicação chama `GET /api/admin/bootstrap?compact=1` na inicialização. O E2E `tests/shopvax-order-buyer.e2e.mjs` ainda usava o glob exato `**/api/admin/bootstrap`, que não cobre o parâmetro de query. Com o mock não interceptado no servidor local do Vite, o painel não recebia os pedidos fictícios; o Playwright aguardava indefinidamente o botão `Ver talão AS-000041`. Evidência inicial: [responsive-picker-check #41213154736](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/41213154736), etapa `Order buyer details browser regression`.
- Correção restrita à simulação: `**/api/admin/bootstrap*` e assert de `compact=1`; respostas/erros e exceções React são rastreados e apresentados caso o botão desapareça. Não se removeu nenhuma validação dos dados do comprador, CEP/cidade/telefone/observações, cópia do talão ou dados entre lojas.
- Ampliação de cobertura: 100 pedidos fictícios distintos no bootstrap, com verificação de quantidade e dois compradores diferentes, além da conferência do conteúdo copiado.
- Os demais arquivos de E2E em `tests/*.e2e.mjs` foram revisados quanto a mocks dessa rota: `shopvax-auth-multitab`, `shopvax-dashboard-greeting`, `shopvax-product-list`, `shopvax-surface-redesign` e `shopvax-themes` já aceitam os parâmetros. `shopvax-panel-06` e demais testes não usam mock do bootstrap. Acrescentou-se uma regressão em `shopvax-dashboard-greeting` que usa `products: []`, `productCount: 5`, e confirma que a loja existente não recebe o onboarding de primeira configuração.

### Contratos para integração na Frente 01

| API | Comportamento e segurança |
| --- | --- |
| `GET /api/admin/bootstrap` | Contrato **legado** preservado: `products` completo, `orders` até 100, `sellers`, `stats`, `store` e `user`; autenticação e dados apenas da loja do usuário |
| `GET /api/admin/bootstrap?compact=1` | `products: []` é **intencional em todas as lojas**; `productCount` é a contagem efetiva e `productCategories` lista pares `{category,count}`. `orders` (até 100) **não são removidos** e dados completos do comprador/talão são preservados |
| `GET /api/admin/products?page=&limit=&q=&category=` | Autenticado, obtém o ID da loja pela sessão, ignora parâmetros falsos de `store_id`, limite entre 1 e 100 (painel usa 18); busca em nome/SKU/categoria, filtro de categoria e ordenação estável `created_at DESC,id DESC`. Retorna `{products,pagination:{page,limit,total}}` |

A falha anterior PostgreSQL `08P01` ocorreu na montagem dos marcadores `$n` para `LIMIT`, `OFFSET` e filtros; a implementação atual usa placeholders parametrizados e não concatena conteúdo recebido do usuário no SQL. A integração entre duas lojas valida que a query retorna apenas produtos do proprietário autenticado. Não foram feitas alterações em migração, preços ou limites.

**Frente 03 / PR #125:** O `src/AdminApp.tsx` daquela branch adiciona um skip persistido no `sessionStorage`, mas sua condição original `!data.products.length` precisa ser substituída por `(data.productCount ?? data.products.length) === 0` ao integrar com a Frente 06. Também ajustar a dependência do `ShopvaxOnboardingGuide` de `data.products.length` para `data.productCount ?? data.products.length`, mantendo a API própria de progresso como fonte da verdade. [Coordenação no PR #125](https://github.com/brnexusia/detalhamento-execucoesa/pull/125#issuecomment-6545357182). A branch #125 não foi editada.

**Frentes 02/04/05:** Não alterar sessões ou regras comerciais (PR #121), paletas, PDF nem testes visuais (PR #123), e nem feed/virtualização (PR #124). A permissão para publicar catálogo escaneado segue revisão humana; scanner é ativado apenas com jobs e sem observador global do DOM.

### Laboratório PostgreSQL — resultados reais de execução

Fonte: [admin-performance-lab #41214592273](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/41214592273), PostgreSQL 16 temporário, Node v22.23.4, 24 amostras por endpoint em lotes de concorrência 4. Os tempos abaixo são latência HTTP do runner local em milissegundos e **não** são medições de produção.

| Produtos / lojas simuladas | Endpoint | p50 (ms) | p95 (ms) | p99 (ms) | Resposta |
| --- | --- | ---: | ---: | ---: | ---: |
| 500 / 10 | Bootstrap legado | 43,4 | 78,1 | 81,9 | 264.428 B |
| 500 / 10 | Compacto | 12,7 | 18,3 | 18,4 | 49.326 B |
| 500 / 10 | Produtos (18) | 8,3 | 9,9 | 9,9 | 9.086 B |
| 5.000 / 100 | Bootstrap legado | 266,5 | 304,0 | 313,4 | 2.592.944 B |
| 5.000 / 100 | Compacto | 12,9 | 16,4 | 16,6 | 58.879 B |
| 5.000 / 100 | Produtos (18) | 11,1 | 11,8 | 13,0 | 9.143 B |
| 20.000 / 1.000 | Bootstrap legado | 1.092,3 | 1.225,2 | 1.239,8 | 10.235.447 B |
| 20.000 / 1.000 | Compacto | 18,0 | 32,6 | 35,2 | 58.882 B |
| 20.000 / 1.000 | Produtos (18) | 28,3 | 32,5 | 35,7 | 9.198 B |

A busca com filtro em 20 mil produtos apresentou p50 34,7 ms e p95 38,3 ms; `EXPLAIN (ANALYZE, BUFFERS)` da listagem retornou execução 0,180 ms (500 produtos), 1,498 ms (5.000) e 7,334 ms (20.000). O laboratório registrou 28, 29 e 12 conexões observadas respectivamente, e volume de banco 10.009.623, 13.851.671 e 25.631.767 bytes. São fotografias pontuais de carga sintética, não valores máximos nem SLOs.

**Limitações:** Uma loja contém todos os produtos e 10/100/1.000 lojas são registros simulados, não usuários simultâneos. Não foram medidos CPU/RSS do servidor, estabilidade real de longa duração, dados móveis ou dispositivos iOS/Android. A medição de p99 com 24 amostras é exploratória.

### Estado de aprovação

Commit final de código de regressão e compatibilidade: `381c26cf9afdd451188785853fb1f7adc7c9a4be`. Para o HEAD de entrega, consultar [branch de Frente 06](https://github.com/brnexusia/detalhamento-execucoesa/tree/parallel/06-admin-backend-performance) ou o [PR #122](https://github.com/brnexusia/detalhamento-execucoesa/pull/122): a atualização da documentação produz um commit adicional, sem modificar esse código.

O aceite **exige oito workflows verdes no mesmo HEAD**: `validate`, `phase1-final-mvp`, `phase2-final-mvp`, `phase3-final-mvp`, `phase4-final-mvp`, `phase5-final-mvp`, `responsive-picker-check` e `admin-performance-lab`. Somente Frente 01 pode fazer merge. Não declarar homologação EasyPanel/produção sem release gate #75.
