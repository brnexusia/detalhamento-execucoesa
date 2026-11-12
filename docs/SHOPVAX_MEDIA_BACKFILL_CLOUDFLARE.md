# ShopVax — miniaturas WebP + Cloudflare CDN

## O que muda
- Fotos originais permanecem em `media_assets` e jamais são sobrescritas ou excluídas.
- `/media/:id?w=320` e `?w=960` recebem versões WebP quando a redução de tamanho vale a pena. Uma origem de 750px pode ter variante `960` com 750px reais (sem ampliar).
- Imagens recém-importadas pelo scanner/FácilZap entram na fila BullMQ já existente, desde que `REDIS_URL` esteja disponível; uploads manuais já usavam a fila.
- Grade da loja e painel selecionam variantes conforme o tamanho real de exibição; fotos originais deixam de ser candidatas automáticas de `2000w` em telas retina.
- **Nenhuma migração de dados é executada no deploy.** É necessária uma execução explícita do CLI.

## Pré-requisitos para operar na produção
1. Confirmar backup recuperável do banco de dados e espaço livre de disco. As variantes ocupam espaço adicional (não alteram originais).
2. Confirmar que o serviço App no EasyPanel utiliza a versão atualizada e possui `DATABASE_URL`.
3. Confirmar `REDIS_URL` e worker de mídia quando usar fila de uploads/importações (`SHOPVAX_MEDIA_WORKER_DISABLED` deve permitir um worker ativo ou haver worker separado).
4. Conferir CPU, RAM, latência e armazenamento do PostgreSQL durante cada lote.

## Execução no terminal do serviço APP do EasyPanel
O script precisa de Node.js, `sharp`, `pg` e do código atualizado. **Não rodar no console `psql`**.

```bash
# 1. Diagnóstico somente leitura (padrão)
node scripts/backfill-media-variants.mjs

# 2. Primeiro lote pequeno e seguro
node scripts/backfill-media-variants.mjs --apply --limit 200 --batch 10 --sleep-ms 250

# 3. Após validar métricas e imagens, ampliar progressivamente
node scripts/backfill-media-variants.mjs --apply --limit 2000 --batch 20 --sleep-ms 150

# 4. Acervo completo, SOMENTE após validar desempenho da VPS
node scripts/backfill-media-variants.mjs --apply --limit 25000 --batch 20 --sleep-ms 150

# Escopo opcional: somente uma loja
node scripts/backfill-media-variants.mjs --apply --store-id UUID_DA_LOJA --limit 200 --batch 10
```

O CLI é idempotente (`ON CONFLICT DO NOTHING`); inclui progresso por lote, `next_after_id` e `--after ID` para continuar em um cursor se necessário. Falhas individuais não apagam a foto e são contabilizadas. A execução padrão sem `--apply` não faz nenhuma gravação.

## Monitoramento SQL (banco `shopvax`)
```sql
SELECT width, COUNT(*) AS variantes, pg_size_pretty(SUM(byte_size)::bigint) AS armazenamento
FROM media_variants
GROUP BY width ORDER BY width;

SELECT COUNT(*) AS fotos_originais,
  pg_size_pretty(SUM(byte_size)::bigint) AS bytes_originais
FROM media_assets WHERE mime_type LIKE 'image/%';
```

## Teste de entrega e cache
1. Escolher uma imagem local com origem mais larga que 320px.
2. Abrir `/media/ID?w=320`, confirmar `Content-Type: image/webp` e dimensões não superiores a 320px. Depois testar `?w=960`.
3. No Firefox, Rede > Desativar cache > Cabeçalhos da resposta, conferir `CF-Cache-Status: HIT` na **mesma URL** após repetição.
4. Comparar bytes baixados e tempo p75/p95 em rede móvel e desktop.
5. O fallback antigo da origem em `?w=320`/ `?w=960` pode estar em cache na Cloudflare. Aguarde o TTL ou elimine pontualmente a URL específica no painel de Purge Cache. Evite Purge Everything, que prejudica o cache de toda a plataforma.

## Limitações e garantias
- A conversão WebP vale apenas para JPEG, PNG, WebP e AVIF estáticos suportados pelo Sharp. GIF animado, SVG, vídeo, arquivo corrompido e imagens <=320px continuam servidos pelo fallback original.
- A redução depende do tamanho e formato da origem; imagens já bem otimizadas podem não ganhar uma variante. Nenhuma velocidade universal é garantida.
- O armazenamento R2 é **opcional** e não é usado por este pacote; as variantes permanecem em `media_variants` do PostgreSQL e são entregues por Cloudflare CDN.
