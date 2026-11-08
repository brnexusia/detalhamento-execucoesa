# ShopVax: progresso de importação e evolução de escala — 07/11/2026

## Fontes e escopo

- [Reel de arquitetura/escala](https://www.instagram.com/reel/Ddl7mfCxwYg/): etapas de teste de pressão, escala vertical, índices, cache, réplicas de leitura, sharding, processamento assíncrono, particionamento e armazenamento especializado. A mensagem final do vídeo é **medir → melhorar → repetir**.
- [Reel das 31 práticas de performance](https://www.instagram.com/reel/Dfby7sPgMPU/): já analisado em `docs/SHOPVAX_PERFORMANCE_REEL_31_20261107.md`, PR #200. Aqui **não duplicamos serviços** existentes.

## Mudanças entregues no código

### Visibilidade do scanner
- Lista de importações exibe **etapa atual, percentual, contagem de produtos identificados** e barra de progresso com `role=progressbar`.
- Atualização a cada ~1,8 s enquanto a janela está visível; **sem polling ininterrupto em segundo plano**.
- Escaneamento usa checkpoints publicados pelo coletor; normalização reserva a faixa 95–99%, com 100% somente quando revisão está pronta. Não apresenta tempo restante inventado.

### Publicação assíncrona
- Botão publica via `POST /api/admin/imports/:jobId/publish-async` e recebe HTTP 202, **não mantém navegador aguardando milhares de fotos**.
- Tarefa durável e idempotente no PostgreSQL, tabela `import_publish_tasks`. Worker inicia no servidor, reclama tarefas com `SKIP LOCKED`, coração de execução e recuperação de tarefa após expiração do lease. Não usa a memória da janela do usuário.
- `GET /api/admin/imports/:jobId/publish-progress` devolve progresso somente ao lojista autenticado, com isolamento por `store_id`.
- Fases: **salvando fotografias** → **identificando produtos/variações** → **preparando registros no banco** → **confirmando publicação**.
- Percentual ponderado para cada fase, mas avanço **somente mediante trabalho real comprovado**, com `N de M` exibido na fase atual. Pesos: fotos 75%, agrupamento 10%, banco 14%, confirmação 1%. Pesos são referências de trabalho, **não uma estimativa de tempo/ETA**.
- Fotos externas são persistidas antes da transação de publicação. Os produtos só contam como concluídos após `COMMIT`; bloqueios de foto/limites de plano continuam operacionais.
- Abrir, fechar e retornar ao painel não encerra a tarefa e permite retomar consulta.
- Erros explícitos ficam registrados, com opção de retentar sem duplicar itens publicados. O publicador continua respeitando lock do catálogo, job e controle de identidade do Alexandre Bijoux.

## Vídeo de escala: quando cada técnica faz sentido

| Etapa do Reel | Situação ShopVax | Decisão |
|---|---|---|
| 01 Teste de pressão | Testes de carga existentes, RUM real via `web-vitals` | Medir fila e p95 sob importação de 1.308/4.049 produtos |
| 02 Escala vertical e pool | `pg.Pool` já usado nos módulos | Medir saturação antes de aumentar CPU/RAM/conexões |
| 03 Índices | Índices por loja, job e `import_publish_tasks(state,updated_at)` | Priorizar consultas lentas com `EXPLAIN ANALYZE` |
| 04 Redis/cache | Redis já existente, cache com TTL | Não cachear publicação, sessão ou dados de estoque sem invalidação |
| 05 Réplicas de leitura | Não implantadas aqui | Só após monitorar volume real de leitura, defasagem de réplica e custo |
| 06 Gargalo de escrita | Importação de fotos e INSERTs no PostgreSQL | Publicador já grava lotes; mídia fica fora da transação |
| 07 Sharding | Não necessário para este volume confirmado | Alto custo operacional: só considerar com evidência de limites de partição/cluster |
| 08 Trade-offs | Risco de perda de consistência e complexidade | Priorizar transações e observabilidade |
| 09 Trabalho assíncrono | **Implementado para publicação** | Fila no PostgreSQL, sem precisar de Redis obrigatório para esse fluxo |
| 10 Particionamento | Views diárias no banco já estruturadas | Avaliar quando tabelas atingirem volume/latência que o justifiquem |
| 11 Armazenamento especializado | PostgreSQL para transações; Redis/fila e mídia separados conceitualmente | Não migrar mídias de armazenamento sem medir I/O e plano de backup |
| 12–14 Evolução/custo/princípio | Roadmap incremental | Medir → otimizar gargalo → validar efeito → repetir |

## Vídeo das 31 práticas de performance

Ver `docs/SHOPVAX_PERFORMANCE_REEL_31_20261107.md`. Melhorias existentes: mídia WebP, lazy loading, code splitting, `GET` singleflight, filas de mídia BullMQ, Redis cache, gzip, testes mobile reduzidos, métricas de LCP/CLS/INP/FCP/TTFB. Itens ainda pendentes **não** devem ser descritos como feitos (SSG/SSR, réplicas, sharding, CDN própria, tracing, revisão de fontes e índices via `EXPLAIN ANALYZE`).

## Homologação necessária

1. Testar escaneamento com 1.308 itens Alexandre e catálogo FácilZap de múltiplas páginas; valores devem avançar durante scanner e processamento sem reset falso.
2. Testar HTTP 202 e `publish-progress` autenticado, inclusive em outra aba após atualizar a página. 
3. Simular falha de download: tarefa deve falhar, produto não deve ser publicado parcialmente, repetir deve retomar o que foi preparado com segurança.
4. Testar múltiplas chamadas simultâneas para o mesmo job: somente uma tarefa efetiva.
5. Testar reinício de worker e retentativa; confirmar ausência de produtos duplicados e de falsos 100%.
6. Publicar 1.308 itens com **backup do banco**, respeitando plano, verificando contagem de produtos distintos, fotos armazenadas em `/media` e tempos de importação.
7. Confirmar `releaseSha` ativo após deploy no EasyPanel. **Código mesclado não significa produção atualizada.**

## Limites

- O percentual ponderado sinaliza volume concluído por fase; não é cronômetro nem estimativa de entrega.
- Não presumir que melhorias de performance do Reel foram todas implementadas.
- Não afirmar que os 1.308 itens foram publicados no banco de produção apenas por terem sido escaneados e testados.

## Fechamento técnico complementar

- A ação principal do painel exibe `Importando catálogo · N%` quando há tarefa ativa, mesmo após fechar o modal.
- Requisições de progresso atrasadas não fazem o marcador retroceder na **mesma tentativa**. Quando a fila retoma uma tarefa após perda de worker, o número de tentativas identifica o reinício real e libera atualização da porcentagem.
- Falhas de internet não apagam a lista de importações em andamento; a janela volta a consultar quando visível.
- As rotinas `validate-import-progress-and-async-queue`, `validate-async-import-publishing` e `validate-daily-unique-views` voltaram a ser executadas para mudanças na `main`.
- Smoke com **4.100 produtos** (`SCANNER_SCALE_TOTAL=4100`): verificação de 4.100 candidatos, normalizações, publicações, contagem final e reexecução idempotente em banco isolado. O fixture utiliza **produtos sem fotos externas**; por isso valida volume e consistência do banco, não o tempo de download de milhares de fotografias. Este teste é evidência de **correção funcional sob carga**, não um indicador de throughput real de produção.
- Evitar afirmar que o ShopVax está 100% implantado até que `/health.releaseSha` corresponda à `main` e `/health.ocr.ready` seja confirmado no container do EasyPanel. A implantação não foi executada por esta alteração.
- O teste de preços `system-plans.test.mjs` continua com contrato divergente (R$ 49,90 esperado e R$ 29,99 encontrado para Bronze). **Não mudar valores comerciais automaticamente** sem aprovação; essa pendência é independente do progresso de importações.

### Verificações seguras após deploy

1. Anotar commit da `main`; confirmar que o serviço ShopVax no EasyPanel usa o **Dockerfile do repositório**, branch `main` e revisão correspondente.
2. Fazer backup restaurável do banco e mídias, verificar espaço e usuário de banco antes de permitir publicação de catálogos reais.
3. Verificar `GET /health` com `ok=true`, `database=true`, `releaseSha` igual ao commit publicado e `ocr.ready=true` para importação de PDF escaneado.
4. Autenticar como lojista de homologação, abrir Produtos → Importações, iniciar um catálogo de teste e observar 0–100% nas etapas de scanner, fotos, agrupamento e publicação.
5. Fechar a janela no meio da publicação e reabrir; deve continuar do estado no servidor. Interromper a rede temporariamente e reconectar; não deve perder a lista nem duplicar registros.
6. Confirmar que imagens estão localizadas em `/media/`, que o banco contém a quantidade esperada de produtos **distintos** e que o contador chega a 100% somente após commit.
7. Testar o Alexandre já cadastrado por **recuperação do job original**, não por publicação duplicada; validar a contagem após recuperar.
8. Registrar LCP/INP/CLS reais p75 antes de justificar novos gastos com réplicas, sharding, CDN ou arquitetura SSR.

