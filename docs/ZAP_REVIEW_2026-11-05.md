# Revisão do ZAP 2.17.0 — ShopVax (05/11/2026)

Escopo: relatório HTML recebido em 05/11/2026, 21:42 (America/Bahia), do alvo `https://shopvax.com.br`. **Alertas de scanner são hipóteses; não são confirmação automática de exploração.** Não há dados pessoais nem cookies do relatório reproduzidos aqui.

## Triagem por tipo

| Alerta do ZAP | Classificação após revisão do código | Evidência, decisão |
|---|---|---|
| SQL Injection — `POST /api/public/events`, `sellerSlug` (alto/médio) | Provável falso positivo; endurecimento incluído | `server/app.mjs` usa queries `WHERE store_id=$1 AND slug=$2` e parâmetros separados; não concatena entrada ao SQL. O scanner recebeu `204 No Content`, sem conteúdo SQL. No PR, slugs fora do padrão gerado pelo sistema são ignorados e um teste local prova que não registram eventos. Não prova ausência absoluta de SQLi em outras rotas. |
| CSP: Wildcard Directive (médio/alto) | Configuração permissiva real; **pendente de migração** | `server/security-hooks.mjs`: `img-src` e `media-src` permitem `https:` amplamente. Loja aceita imagens/vídeos externos; remover permissão sem inventário bloqueia vitrines de lojistas. |
| CSP: style-src unsafe-inline (médio/alto) | Configuração permissiva real; **pendente de migração** | `server/security-hooks.mjs`: `style-src 'unsafe-inline'`. Há estilos dinâmicos no React e no fallback SEO; remover sem testes quebra layout. |
| Timestamp Unix em JS (baixo/baixo) | Sem vazamento sensível comprovado | Evidência `1553062407` pertence a URL pública de imagem Unsplash no bundle. |
| Comentários suspeitos JS (informativo/baixo) | Provável falso positivo | Padrão `SELECT` foi encontrado em código minimizado de criação de elementos SVG/MathML, não em comentário que revela SQL. |
| Cache-control `/sitemap.xml` (informativo/baixo) | Comportamento esperado | `public, max-age=60, s-maxage=60` é adequado para sitemap XML público, não é sessão privada. |
| Potential XSS no `?produto=` (informativo/baixo) | Não reproduzido pelo relatório; teste de regressão incluído | `server/page-metadata-hooks.mjs` usa `encodeURIComponent` para ID em URL de produto, `escapeHtml` em atributos HTML, e `safeJson` para JSON-LD. Scanner viu parâmetro em URL de `meta`, não execução. Adicionado teste local com nome de produto malicioso e parâmetro especial. |
| Session Management Response Identified (informativo/médio) | Esperado; não é vulnerabilidade | O relatório mostra cookies HttpOnly, Secure, SameSite=Lax numa resposta 404; reconhecimento de token pela ferramenta é informativo. |
| Modern Web Application (informativo/médio) | Informativo | SPA usa módulos JavaScript; scanner recomenda Ajax Spider para maior cobertura. |

## Prioridade e execução segura

### P1 — SQLi
- **Não há SQLi confirmada nesse endpoint pelo relatório.** Defesa existente: SQL parametrizado.
- Reforço deste PR: validar os slugs anônimos com o mesmo formato gerado por `slugify` e impedir eventos falsos com entradas malformadas; manter 204 para não expor a existência de lojas.
- Testes locais no PostgreSQL de CI: dois padrões booleanos do ZAP, uma entrada com tags HTML, evento normal, presença/ausência de gravações, e escape do metadado HTML.

### P2 — CSP (trabalho a planejar e validar em staging)
1. Inventariar domínios reais de mídia dos produtos. Distinguir uploads do ShopVax (armazenados em PostgreSQL e servidos por `/media/:id`) e links externos. Registrar apenas hosts agregados, não URLs contendo tokens.
2. Migrar/normalizar uploads de mídia para a origem própria e aprovar somente hosts externos de mídia realmente necessários por negócio. Quando possível, validar/localizar a mídia antes de salvá-la, evitando proxy arbitrário e SSRF.
3. Começar com `Content-Security-Policy-Report-Only` em staging, comparando carregamento real de imagens, vídeos, fontes, login Google e formulários em desktop/iOS/Android.
4. Para estilos, reduzir necessidade de `style-src 'unsafe-inline'` migrando estilo inline para classes/CSS e avaliando nonce/hash para blocos estáticos. Não retirar diretiva antes de validar React, Google Sign-In e a renderização SEO.
5. Só então publicar a CSP restritiva e executar novamente ZAP, além de testes Playwright e observação de erros do navegador.

**Não** considerar estes dois alertas CSP resolvidos por esta PR: a simples remoção das diretivas atuais quebraria mídias e estilos.

### Outras observações sobre a qualidade do scan
- O ZAP informou 339 endpoints e 78% de respostas consideradas lentas; isso **não** é uma medida de exploração nem resultado de teste de carga controlado. É necessário comparar com métricas de produção e verificar latências p50/p95.
- O relatório menciona 233 erros e 684 avisos no log do próprio ZAP. Sem o `zap.log`, não sabemos quantos afetaram a cobertura. Executar Ajax Spider e testes autenticados por papel em staging, sem causar carga excessiva em produção.
- Manter o firewall da Hostinger, acesso administrativo restrito, e backups externos verificados independentemente do ZAP.

## Critério de encerramento

- CI de regressão passou com o código revisado;
- CSP validada em staging, sem quebras de imagem, vídeo, Google login ou CSS;
- ZAP repetido após deploy e classificação documentada dos alertas;
- Monitoramento e validação de produção, sem inferir conclusão apenas pelo resultado do CI.
