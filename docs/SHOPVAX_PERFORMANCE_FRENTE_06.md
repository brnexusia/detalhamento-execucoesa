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
