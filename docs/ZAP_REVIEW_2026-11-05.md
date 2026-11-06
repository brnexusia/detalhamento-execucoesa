# Revisão do ZAP 2.17.0 — ShopVax (05/11/2026)

Escopo: relatório HTML recebido em 05/11/2026, 21:42 (America/Bahia), do alvo `https://shopvax.com.br`. **Alertas de scanner são hipóteses; não são confirmação automática de exploração.** Não há dados pessoais nem cookies do relatório reproduzidos aqui.

## Triagem por tipo

| Alerta do ZAP | Classificação após revisão do código | Evidência, decisão |
|---|---|---|
| SQL Injection — `POST /api/public/events`, `sellerSlug` (alto/médio) | Provável falso positivo; endurecimento incluído | `server/app.mjs` usa queries `WHERE store_id=$1 AND slug=$2` e parâmetros separados; não concatena entrada ao SQL. O scanner recebeu `204 No Content`, sem conteúdo SQL. No PR, slugs fora do padrão gerado pelo sistema são ignorados e um teste local prova que não registram eventos. Não prova ausência absoluta de SQLi em outras rotas. |
| CSP: Wildcard Directive (médio/alto) | Configuração real **restringida no código, ainda sem validação visual em produção** | `server/security-hooks.mjs` substitui `https:` por uma lista explícita de origens HTTPS para imagens e vídeos, extensível por `SHOPVAX_CSP_MEDIA_ORIGINS`. Origem desconhecida será bloqueada pelo navegador: inventariar mídias reais e adicionar somente fornecedores legítimos. |
| CSP: style-src unsafe-inline (médio/alto) | Configuração permissiva real; **pendente de migração** | `server/security-hooks.mjs` remove `unsafe-inline` de `style-src` e define `style-src-elem` e `style-src-attr 'none'`. Fallback SEO teve estilo inline movido para CSS. Estilos de terceiros que insiram atributos inline podem exigir adaptação. |
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

### P2 — CSP: endurecimento aplicado ao código
1. `img-src` e `media-src`: removido o curinga por esquema `https:`; permitido `self`, `blob:` e somente origens externas explicitamente aprovadas (além de `data:` para imagens). Novos hosts são configuráveis via `SHOPVAX_CSP_MEDIA_ORIGINS` no EasyPanel. Não adicionar curinga ou hosts desconhecidos.
2. `style-src`: removido `'unsafe-inline'`, estilos externos restringidos a domínios próprios e CSS de Google. `style-src-attr 'none'` bloqueia atributos HTML arbitrários. Fallback HTML de SEO passou a utilizar a folha `src/styles.css`.
3. Fica explicitamente **pendente de validação de compatibilidade** por decisão do responsável de não repetir testes neste momento: imagens/vídeos hospedados em outras origens podem ser bloqueados; serviços de terceiros que gerem `style=` podem ter alterações visuais. O operador deverá incluir apenas origens legítimas no EasyPanel e migrar mídias para `/media` quando possível.
4. Depois do deploy, acompanhar erros de CSP do console e relatos de mídias/imagens faltantes. Não interpretar commit como prova de funcionamento em todos os navegadores.

Esses alertas foram tratados no código, mas a ausência de rechecagem dinâmica significa que o comportamento em produção não está atestado.

### Outras observações sobre a qualidade do scan
- O ZAP informou 339 endpoints e 78% de respostas consideradas lentas; isso **não** é uma medida de exploração nem resultado de teste de carga controlado. É necessário comparar com métricas de produção e verificar latências p50/p95.
- O relatório menciona 233 erros e 684 avisos no log do próprio ZAP. Sem o `zap.log`, não sabemos quantos afetaram a cobertura. Executar Ajax Spider e testes autenticados por papel em staging, sem causar carga excessiva em produção.
- Manter o firewall da Hostinger, acesso administrativo restrito, e backups externos verificados independentemente do ZAP.

## Situação

- Correções de rotas e CSP estão no PR. Não afirmar publicação sem merge e deploy confirmados.
- O responsável solicitou **não executar novo ZAP nem novos testes manuais**. As rotinas de CI existentes podem rodar automaticamente com o PR.
- Compatibilidade dos domínios de mídia e de estilos de terceiros depende do ambiente real; ajustar origens de forma explícita quando necessário.
- Monitoramento e validação de produção não foram realizados como parte desta revisão.
