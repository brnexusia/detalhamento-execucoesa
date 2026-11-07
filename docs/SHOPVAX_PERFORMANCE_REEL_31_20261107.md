# ShopVax — checklist de performance do Reel (31 orientações)

Data: 2026-11-07. Origem: https://www.instagram.com/reel/Dfby7sPgMPU/

## Regras
- Não marcar um item como aplicado apenas porque existe uma biblioteca; exige fluxo integrado e teste.
- Não criar tecnologias duplicadas se o código já tem solução equivalente.
- Mudanças de infra exigem medição e acesso ao deploy; nenhuma mudança em VPS é implícita.
- Não criar falsos resultados de benchmarking: métricas p75 só existem após tráfego real.
- Não confundir view diária com evento de clique, curtida, venda ou conversão.

| # | Orientação do vídeo | Estado após esta entrega | Evidência / pendência concreta |
|---|---|---|---|
| 01 | Skeleton sem saltos | Parcial preexistente | `src/ShopvaxLoading.tsx` possui skeleton compacto; conferir telas restantes e CLS com RUM |
| 02 | WebP/AVIF | WebP já existente | `server/media-variants.mjs` gera WebP 320/960 mantendo original; AVIF depende de medição |
| 03 | Evitar requisições duplicadas | Reforçado | `src/api.ts` compartilha GETs idênticos em voo; Redis também possui singleflight |
| 04 | Debounce da busca | Parcial preexistente | Revisão de scanner debounced em `src/ScannerModule1.tsx`; inventariar outras buscas |
| 05 | Paginação | Existente | `server/performance-hooks.mjs` limita catálogo inicial; feed pagina 12 itens por cursor |
| 06 | CDN para estáticos | Parcial | Mídia externa e preconnect; servidor /media local e CDN próprio exigem avaliação de implantação |
| 07 | Filas para tarefas lentas | Existente | `server/redis-media-jobs.mjs` usa BullMQ com worker e retries |
| 08 | Corrigir N+1 | Pendente de profiling | Consultas correlacionadas do feed exigem EXPLAIN ANALYZE sob carga antes da reescrita |
| 09 | Brotli/Gzip | Gzip existente | `server/performance-hooks.mjs` ativa compressão; Brotli avaliar no proxy |
| 10 | Cache Redis | Existente opcional | `server/redis-runtime.mjs` cache de consulta com TTL padrão 15s |
| 11 | Remover dependências inúteis | Pendente de auditoria | Verificar dependências e impacto no bundle sem remover pacotes usados |
| 12 | Timeout externo | Parcial preexistente | Scanner tem timeout; feed usa AbortController; inventariar provedores restantes |
| 13 | Streaming de IA | Não aplicável ao fluxo testado | Só implementar onde houver resposta generativa real, sem simular streaming |
| 14 | UI otimista | Parcial | Verificar likes e ações reversíveis; jamais antecipar pagamento/estoque |
| 15 | Lazy-loading de imagens | Parcial preexistente | Feed usa IntersectionObserver; confirmar imagens fora da tela nas demais rotas |
| 16 | Requisições independentes em paralelo | Parcial | Coletor usa concorrência controlada; revisar cascatas no painel pela aba Network |
| 17 | Índices mais comuns | Existente e reforçado | Índices de produto e índices únicos diários de views |
| 18 | OpenTelemetry para gargalos | Instrumentação parcial | HTTP histogram já existia em `metrics-hooks`; tracing distribuído exige arquitetura/collector |
| 19 | Aproximar servidor do banco | Depende de infra | Confirmar região, RTT e rede privada antes de mover serviços |
| 20 | SSR/SSG | Pendente de projeto | Avaliar páginas públicas elegíveis; evitar renderização server-side de dados privados |
| 21 | Scripts terceiros após conteúdo | Pendente de inventário | Inspecionar todas as tags externas e dependências críticas |
| 22 | Code splitting por página | Existente | `src/App.tsx` usa React.lazy/Suspense em rotas |
| 23 | Virtualização de listas | Parcial | Feed renderiza vizinhos limitados; tabelas longas requerem profiling específico |
| 24 | Somente colunas necessárias | Parcial | Há consultas com projeção explícita; revisar pontos com SELECT * sob EXPLAIN |
| 25 | Pool de conexões | Existente | `pg.Pool` utilizado nos módulos backend |
| 26 | Evitar rerenders | Parcial | `SocialPostCard` usa React.memo; profiling de outras páginas pendente |
| 27 | Cache de estáticos no browser | Existente | `performance-hooks`: assets versionados immutable por 1 ano |
| 28 | Balanceador/instâncias | Depende de infra | Teste de saturação e capacidade real antes de aumentar réplicas |
| 29 | Fontes locais e poucos pesos | Pendente de revisão | Verificar fontes efetivamente usadas; não adicionar arquivos de fonte sem licença |
| 30 | Monitorar velocidade real, p75 | Implementado em código | `src/real-user-performance.ts` + `server/metrics-hooks.mjs`: LCP, FCP, INP, CLS, TTFB, agregados protegidos |
| 31 | Testar celular/rede lenta | Testes existentes, rede lenta pendente | e2e responsivo; falta ensaio explícito com CPU 4x / Slow 3G após deploy |

## Entrega de métricas únicas diárias

- **Produto na loja:** uma view por visitante anônimo, produto, loja e data local (America/Sao_Paulo).
- **Acesso à loja:** um evento de acesso por visitante, loja e dia, independentemente de voltar várias vezes.
- **Post no feed social:** uma view por visitante, post/produto e dia, com chave única no PostgreSQL.
- **Outros eventos** (cliques, carrinho, WhatsApp): não são deduplicados arbitrariamente, pois medem ações diferentes.
- **Anônimo**: identifica o navegador por cookie de primeiro domínio; não garante identidade humana entre dispositivos, cookies limpos ou navegação privada.
- **Histórico do social:** migração preserva as visualizações já existentes, respeitando a data original.
- **Histórico do catálogo:** os relatórios deduplicam por dia ao consultar, sem alterar eventos passados no banco.

## Checkpoints de homologação

1. Os testes de PostgreSQL rejeitam views repetidas no mesmo dia e aceitam no dia seguinte.
2. O indicador de views do feed e os relatórios passam a ler a mesma tabela diária.
3. `npm run build` completa e a aplicação inicia com a migração preservando históricos.
4. HTTP `/internal/metrics` retorna `shopvax_rum_p75` somente com token administrativo, nunca publicamente.
5. Testar com cookies estáveis e de outro navegador; validar virada do dia às 00:00 horário de Brasília.
6. Medir LCP/INP/CLS p75 antes de escolher novas otimizações; validar comportamento Slow 3G/CPU limitada.
7. Publicar somente após deploy e confirmar a revisão em produção. Sem afirmação de melhoria de tempo antes da medição.

