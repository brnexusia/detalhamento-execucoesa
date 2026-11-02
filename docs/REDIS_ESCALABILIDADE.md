# ShopVax — Redis e plano de capacidade (KVM 2)

## Aplicado no código
- `REDIS_URL` ativa Redis como cache de CONSULTAS PÚBLICAS do catálogo (TTL de 15s por padrão), sem cachear carrinho, sessões, autenticação, pedidos ou respostas específicas de visitante.
- Limites de requisição do catálogo, login e plataforma usam contador atômico compartilhado no Redis; indisponibilidade do Redis usa o controle local existente e não bloqueia o checkout.
- A chave de paginação pública usa `SHOPVAX_PUBLIC_CURSOR_SECRET` estável; se omitida, usa uma chave forte pré-existente do backend, se disponível.
- Mídias originais permanecem no PostgreSQL; `bullmq` enfileira apenas os IDs em Redis, com retry e backoff. O worker recupera o original e gera variantes WebP, com idempotência na gravação. 
- A aplicação continua funcional sem Redis para consulta e pedidos, embora as garantias de cache e fila distribuída não se apliquem.

## Configuração EasyPanel
No app ShopVax: definir `REDIS_URL` usando a URL INTERNA da instância Redis (não publicar URL/senha).
Para proteger o Redis usado em fila, persistência AOF habilitada, backup, ACL e `maxmemory-policy noeviction`. Não expor porta 6379.
`SHOPVAX_PUBLIC_CURSOR_SECRET` deve ser segredo aleatório >=32 caracteres e idêntico em todas as réplicas. Se a variável já existe no backend como `SHOPVAX_OTP_HMAC_SECRET`, o código pode reutilizar essa chave como fallback, sem expor seu valor.
O novo `SHOPVAX_CATALOG_CACHE_TTL_SECONDS` tem padrão 15 e máximo 120. A edição do produto pode levar até esse prazo para aparecer na listagem pública; **pedido e preço definitivo devem continuar validados no PostgreSQL**.
O processo web mantém 1 worker de imagem embarcado por padrão. Para isolar CPU, configurar `SHOPVAX_MEDIA_WORKER_DISABLED=1` no aplicativo e criar serviço worker separado usando o MESMO código de imagem e comando `node server/media-worker.mjs` com `DATABASE_URL`, `REDIS_URL`; sem criar o serviço worker, as novas variantes não serão geradas. Não usar ambos sem considerar o consumo de CPU.
O scanner já oferece `SCANNER_WORKER_DISABLED=1`. Não desativar seu worker sem disponibilizar executor alternativo.

## Limitações ainda dependentes de infraestrutura
1. Balanceador, múltiplas réplicas e autoscaling não podem ser configurados apenas em GitHub: exigem serviços adicionais no EasyPanel e, para escalar vCPU, instâncias extras fora do mesmo KVM.
2. CDN de mídia e armazenamento de objetos requerem fornecedor, domínio, credenciais e estratégia de invalidação. O endpoint `/media/:assetId` mantém cabeçalhos HTTP de cache e aceita servir como origem de CDN.
3. PgBouncer requer instância/ajuste externo e avaliação dos pools separados do backend; não presumir que está ativo.
4. Testar índices com `EXPLAIN (ANALYZE, BUFFERS)` em ambiente representativo antes de criar índices adicionais. Não adicionar índices aleatoriamente.
5. `/health` mostra prontidão do Redis separadamente, mas não deve derrubar o app se o Redis estiver temporariamente indisponível.

## Benchmark
`tests/load/catalog-checkout.k6.js` é **somente leitura** (catálogo). Rodar exclusivamente num staging isolado com carga e dados representativos. O rate limit por IP dos testes deve ser configurado explicitamente no staging, nunca relaxado em produção. Medir p50/p95/p99, CPU, RAM, conexões e erros. Adicionar benchmark de pedidos com dados fictícios, contas e webhooks isolados antes de afirmar capacidade de checkout.

**Não existe número de usuários simultâneos homologado até executar benchmark reproduzível.**
