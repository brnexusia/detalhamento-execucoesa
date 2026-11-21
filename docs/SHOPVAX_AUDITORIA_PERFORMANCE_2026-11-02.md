# ShopVax — Auditoria de performance e carregamento

Data: 02/11/2026 (America/Bahia; execução automatizada em 03/11 UTC).
Código de referência: repositório brnexusia/detalhamento-execucoesa, main, commit 1d96ceb3f7acfbc29c8ffbb69398525547a382e5.

Evidências:
- GitHub Actions: https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/41561493983
- Relatório JSON: https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/41561493983/artifacts/13197525308
- Build da main: https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/41560055470
- Laboratório anterior: docs/SHOPVAX_PERFORMANCE_FRENTE_06.md

## 1. Escopo e limites

Foram observadas 26 navegações em 13 rotas públicas e entradas de rotas protegidas no domínio real https://shopvax.com.br, por Playwright/Chromium em GitHub Actions Linux, com contextos novos. Os dois perfis simulados foram desktop 1366x768 4G (4 Mbps/150 ms) e mobile 390x844 3G lento (400 kbps/400 ms), com CPU limitada 4 vezes. Métodos de alteração de estado (POST/PUT/PATCH/DELETE) foram bloqueados para proteger produção; essa é uma análise SOMENTE DE LEITURA. Cada rota possui uma amostra por perfil e janela de observação limitada.

Tempos abaixo são LCP observado em milissegundos, não p75 real, não previsão de tempo para usuários brasileiros, não dados de CrUX, nem garantia estatística. O INP real não foi medido. CLS foi registrado com precisão reduzida e a janela pode não abranger mudanças posteriores. Transferências cross-origin podem ser subestimadas. O site estava acessível pelo runner apesar de limitações do navegador de pesquisa. O painel de lojista e a plataforma protegida NÃO foram autenticados: seus tempos correspondem ao redirecionamento/login e ao erro de acesso esperado, não às páginas internas.

## 2. Medição pública

| Rota | Desktop 4G LCP | Mobile 3G lento LCP | Observação |
| --- | ---: | ---: | --- |
| / | 2.784 ms | 2.552 ms | Feed |
| /feed | 2.664 ms | 5.568 ms | Mesmo feed, variação de amostra |
| /para-lojas | 1.216 ms | 4.308 ms | Institucional |
| /entrar | 1.460 ms | 4.688 ms | Login |
| /criar-conta | 1.200 ms | 4.636 ms | Cadastro |
| /comprador | 1.160 ms | 4.304 ms | Acesso anônimo |
| /sw-moda-feminina | 2.936 ms | 6.148 ms | **Vitrine / maior gargalo comercial** |
| /perfil/sw-moda-feminina | 1.364 ms | 2.616 ms | Perfil social público |
| /cliente/sw-moda-feminina | 1.668 ms | 4.972 ms | Conta sem autenticação |
| /parceiros | 1.304 ms | 4.500 ms | **HTTP 404 nos dois perfis** |
| /painel | 2.160 ms | 6.700 ms | Redireciona a /entrar; NÃO mede painel |
| /painel/produtos | 2.052 ms | 6.612 ms | Redireciona a /entrar; NÃO mede produtos |
| /admin | 1.348 ms | 5.344 ms | Sem credenciais; API bootstrap retorna 403 |

O LCP sintético com 3G lento está acima de 4 s em quase todas as rotas, exigindo otimização. A diferença de / e /feed apesar de compartilhar módulo confirma necessidade de repetições. 401 de endpoints /auth/me e /customers/me em navegação anônima são esperados; não interpretar 401 de visitante como indisponibilidade. Requisições Google Identity abortadas no desktop necessitam teste funcional de login se forem reproduzíveis. Chamadas de escrita bloqueadas nesta auditoria não são falhas reais da aplicação.

## 3. Tamanho dos arquivos da main

No CI real: JavaScript comum index = 444,82 kB minificado e 135,87 kB gzip; CSS index = 155,80 kB minificado e 27,75 kB gzip. JavaScript específico AdminRoute = 317,26 kB / 60,25 kB gzip; CSS AdminRoute 67,91 kB / 12,54 kB gzip; PublicRoute JS 83,90 / 18,90 kB gzip; SocialFeed JS 30,01 / 8,20 kB gzip; PlatformRoute JS 90,64 / 17,51 kB gzip. Valores por chunk, não soma de bytes baixados por navegação. src/main.tsx importa 18 folhas de estilo globais, totalizando cerca de 170.359 bytes de código-fonte CSS antes de minificação.

No feed desktop, foram observados 761 KiB transferidos, dos quais 638 KiB de mídia de imagens (84%). Na vitrine desktop, 414 KiB observados, com 247 KiB de imagens (60%). São amostras de requests e podem estar incompletas.

## 4. Diagnóstico priorizado

### P0 — LCP da vitrine pública

- Evidência: /sw-moda-feminina = 6,148 s no 3G lento e 2,936 s no 4G desktop.
- Causa plausível no código: o hero usa ProductMedia que por padrão cria ResilientImage com loading lazy; o ajuste posterior em PublicPerformanceRuntime passa a media eager/high somente depois da renderização via observador de mutações. O produto e sua mídia dependem do JSON inicial.
- Corrigir: colocar prioridade na imagem principal no próprio JSX, dimensionar sizes corretamente, manter lazy nas demais imagens, medir se um preload condicional para mídia crítica melhora o LCP. Evitar MutationObserver varrendo document.body continuamente.

### P1 — Bundle comum e painel por seção

- Evidência: JS index 135,87 kB gzip, CSS index 27,75 kB gzip; AdminRoute JS adicional 60,25 kB gzip.
- src/App.tsx já separa grandes rotas via React.lazy, ponto positivo; mas src/AdminRoute.tsx importa antecipadamente AdminApp, scanner, publicador, relatórios, módulos comerciais e integrações mesmo quando uma seção não é aberta.
- Corrigir: dividir AdminRoute por subrota, renderizar imports dinâmicos para módulos não usados, manter as guardas de autorização/assinatura; deslocar estilos não usados para CSS da própria rota; medir antes/depois.

### P1 — APIs duplicadas e módulos opcionais em vitrine

- src/App.tsx monta PublicRoute, Phase3PublicRuntime e Phase4PublicRuntime juntos. Os dois últimos consultam avaliações/configuração de pagamento/frete, mesmo fora da interação do comprador. ShopvaxAcquisition também faz chamada customers/me e há outra chamada de sessão da loja, duplicando respostas 401.
- Corrigir: compartilhamento de contexto de sessão, deduplicar GETs, deferir recursos experimentais e ações que só importam no checkout, sem romper consentimento, disponibilidade, atribuição da vendedora, preços ou isolamento de loja.

### P1 — /parceiros com 404

- O domínio público retornou HTTP 404 para /parceiros no desktop e no mobile, mesmo havendo componente ShopvaxPartnerPortal no frontend.
- Investigar roteamento Express/proxy e condição de publicação, reproduzir com headers e validar conteúdo funcional antes de marcar resolvido.

### P1 — Imagens, dimensões e infraestrutura de mídia

- src/responsive-media.ts aplica os descritores 320w, 960w e original 2000w ao recurso original sem verificar dimensão real; server/media-variants.mjs gera variantes WebP em 320/960 px, quando viável.
- src/Shopvax-panel-login-06.css usa mosaico HD de 371.502 bytes como imagem de fundo, carregado no desktop.
- Servidor /media usa PostgreSQL BYTEA; antes de mover mídia a CDN/object storage, medir cache miss, latência e concorrência. Preservar original e qualidade visual da loja.

### P2 — Fontes externas e CSS universal

- src/styles.css importa várias variantes de Archivo, Archivo Narrow e Fragment Mono do Google Fonts. Aguardar fontes pode atrasar tipografia no 3G e provocar alterações de layout; estabelecer política de preload só do peso essencial e swap/subset quando comprovado.
- Não remover identidade editorial nem substituir logotipos por fontes genéricas.

### P2 — Abertura autenticada em cascata

- AdminRoute só renderiza conteúdo após GET /api/billing/status; AdminApp em seguida solicita bootstrap compacto.
- O bootstrap compacto e a listagem paginada de produtos são bons: laboratório local de 20 mil produtos registrou p95 32,6 ms (compacto) e 32,5 ms (18 produtos), contra p95 1.225,2 ms do bootstrap antigo. Esses dados não refletem a VPS.
- Avaliar agregação segura de contexto, execução paralela de requisições independentes e route splitting; provar integridade de assinatura e sessões.

### P2 — Cache, PostgreSQL, escalabilidade

- Express usa compressão e cache imutável para assets com hash, mais cache de catálogo Redis opcional (TTL padrão de 15s) com fallback PostgreSQL; resposta pública completa é private/no-store por contexto do visitante. O nginx.conf não é o servidor iniciado pelo Dockerfile de produção, que usa Node/Express.
- Módulos criam pools independentes; revisão anterior calculou teto configurado somado de até 92 conexões por processo, NÃO consumo real. Medir pg_stat_activity, CPU/RSS, event loop e latências por consulta antes de alterar pool ou índices. Examinar criação de índices no startup em ambiente de alto tráfego.

### P3 — Medição longitudinal e prevenção de regressões

- Adicionar RUM de LCP/INP/CLS com consentimento e sem identificadores pessoais, separados por desktop/mobile, conexão e rota, com p75 e alertas de regressão.
- Repetir cada rota múltiplas vezes, com cache frio e quente; testar iPhone Safari/Android real, redes fracas e catálogo extenso com mídia real.
- Testar fluxo autenticado: dashboard, produtos, editor, scanners, vendedoras, pedidos, relatórios, temas, integrações, assinatura, administração — apenas no ambiente de homologação e contas fictícias; jamais acessar indevidamente dados reais para benchmark.
- Amarrar evidências ao SHA de deploy, testar backup/restore quando houver mudanças no backend e manter rollout/rollback controlado.

## 5. Qualidade já existente

React.lazy por rotas maiores; virtualização do feed e preload conservador de vídeos; imagens responsivas/variantes WebP; compressão; assets hash com cache; paginação na API, buscas com debounce e abortos; Redis opcional sem bloquear operação; laboratórios anteriores com 500/5.000/20.000 produtos.

## 6. Sequência recomendada

1. Resolver /parceiros 404 e LCP da vitrine; medir cada antes/depois.
2. Adiar módulos não essenciais e deduplicar requisições na loja; conservar regras comerciais.
3. Dividir bundle do painel por funcionalidade e CSS por rota; validar navegação e guardas.
4. Ajustar variants/sizes das mídias e peso do mosaico/fontes, com comparação visual.
5. Testar API/PG/mídia com dados sintéticos volumosos, concorrência e cache; sem suposições sobre carga real.
6. Habilitar RUM e testes autenticados de homologação; só então declarar cobertura de todas as páginas.

Não houve mudança de comportamento do sistema, deploy ou alteração do banco durante a auditoria. A implementação de melhorias depende de commits e validações próprios.
