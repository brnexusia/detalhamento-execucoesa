-- ShopVax Frente 01 — auditoria agregada SOMENTE LEITURA.
-- Executar com psql em sessão restrita, com usuario read-only, NO ambiente correto.
-- NUNCA publicar linhas com dados pessoais ou credenciais na issue #75.
-- Verificar compatibilidade do schema real antes. Executar preferencialmente fora do pico.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

-- Planos de sistema e personalizados: somente configurações comerciais.
SELECT code, is_system, active, monthly_price, semester_discount, annual_discount,
       seller_limit, product_limit, catalog_limit, photo_limit, franchisee_limit,
       mvp_schema_version
FROM platform_plans
ORDER BY is_system DESC, code;

-- Quantidade agregada de planos personalizados (contratos devem ser revisados em privado).
SELECT count(*) FILTER (WHERE NOT is_system) AS planos_personalizados,
       count(*) FILTER (WHERE is_system AND mvp_schema_version < 3) AS planos_sistema_schema_antigo
FROM platform_plans;

-- Uso agregado, sem nome, slug, id de loja ou telefone de vendedor.
SELECT s.plan_tier, COUNT(*) AS lojas,
       COUNT(*) FILTER (WHERE plan.product_limit IS NOT NULL AND usecounts.products > plan.product_limit)
           AS lojas_acima_produtos,
       COUNT(*) FILTER (WHERE plan.seller_limit IS NOT NULL AND usecounts.sellers > plan.seller_limit)
           AS lojas_acima_vendedoras,
       COUNT(*) FILTER (WHERE plan.catalog_limit IS NOT NULL AND usecounts.catalogs > plan.catalog_limit)
           AS lojas_acima_catalogos,
       COUNT(*) FILTER (WHERE usecounts.active_sellers = 0) AS lojas_sem_vendedora_ativa
FROM stores AS s
LEFT JOIN platform_plans AS plan ON plan.code = s.plan_tier AND plan.active = true
LEFT JOIN LATERAL (
  SELECT
    (SELECT count(*) FROM products AS p WHERE p.store_id = s.id) AS products,
    (SELECT count(*) FROM sellers AS se WHERE se.store_id = s.id) AS sellers,
    (SELECT count(*) FROM sellers AS se WHERE se.store_id = s.id AND se.is_active = true) AS active_sellers,
    (SELECT count(*) FROM catalogs AS c WHERE c.store_id = s.id) AS catalogs
) AS usecounts ON true
GROUP BY s.plan_tier
ORDER BY s.plan_tier;

-- Armazenamento de mídias no banco; contagem/bytes declarados, sem acessar conteúdo binário.
SELECT 'media_assets' AS tabela, count(*) AS registros,
       coalesce(sum(byte_size),0) AS bytes_declarados
FROM media_assets
UNION ALL
SELECT 'media_variants', count(*), coalesce(sum(byte_size),0)
FROM media_variants;

-- Tamanho real do PostgreSQL no disco: confirmar espaço suficiente para backup/restore.
SELECT pg_size_pretty(pg_total_relation_size('public.media_assets')) AS tabela_originais,
       pg_size_pretty(pg_total_relation_size('public.media_variants')) AS tabela_variantes,
       pg_size_pretty(pg_database_size(current_database())) AS banco_inteiro;

COMMIT;
