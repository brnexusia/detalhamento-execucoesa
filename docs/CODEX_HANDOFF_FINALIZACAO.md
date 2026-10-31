# CODEX — SHOPVAX: CONTINUAR O EXISTENTE ATÉ A FINALIZAÇÃO

> Instruções autossuficientes. Você não tem acesso ao histórico do ChatGPT. **Não reconstrua do zero, não substitua arquitetura nem reinicie o projeto.** Trabalhe exclusivamente sobre o repositório real `brnexusia/detalhamento-execucoesa`, branch principal `main`, respeitando o código já escrito, decisões de produto, assets e testes. Data do handoff: 31/10/2026.

## 0. Fonte de verdade e método
Leia integralmente, nesta ordem:
1. `AGENTS.md` e este documento.
2. `README.md` e `package.json`.
3. `docs/references/README.md` e os dois textos integrais de escopo: `Shopvax_Manifesto_MVP.texto.md` (histórico) e `Atacado_Shop_Diretrizes_Produto_e_Precos.texto.md` (diretrizes posteriores).
4. `docs/SHOPVAX_BRAND_ASSETS.md`, `docs/SHOPVAX_REDESIGN_PHASE1.md`, `docs/SHOPVAX_REDESIGN_PHASES_2_3.md`, `docs/SHOPVAX_REDESIGN_ACCEPTANCE_PHASES_2_3.md`, `docs/SHOPVAX_REDESIGN_SURFACE_AUDIT.md`, `docs/SHOPVAX_RELEASE_GATE.md`.
5. Todo o código em `src/`, `server/`, `tests/`, `.github/workflows/` e configurações de deploy.

Precedência: regras atuais expressamente aprovadas e implementadas > diretrizes de preço de 29/08/2026 > manifesto antigo de agosto. Para a estética, **as pranchas originais SVG de redesign** são a referência obrigatória; não inferir design a partir de um texto resumido.

## 1. Onde estão os arquivos originais e como consultá-los
- `docs/references/Shopvax_Logo_propostas.zip`: 16 pranchas SVG originais da marca; **19 · Laranja.svg** é o mestre aprovado da identidade utilizada no app.
- `docs/references/Shopvax_Logo_previews_png.zip`: oito prévias PNG.
- `docs/references/redesign-original-parts/`: **ZIP original completo** `Shopvax_ Catálogo (redesign).zip`, preservado em 11 partes consecutivas. Leia o README nessa pasta e reúna com `cat .../Shopvax_Catalogo_redesign.zip.part* > /tmp/Shopvax_Catalogo_redesign.zip`; use `unzip -t` antes de consultar. Contém nove pranchas SVG, incluindo conceito, sistema, fluxo móvel, nichos, desktop, painel, planos e movimento.
- `docs/references/Atacado_Shop_UX_historico.md`: feedback histórico, não uma substituição da identidade aprovada.
- PDF original de escopo ainda não está versionado como binário; seu texto integral, sim. Não alegar comparação visual com PDF a partir do Markdown.
- Google Drive de origem (se houver acesso autorizado): https://drive.google.com/file/d/1QzU5PkuzVpxqNGYg_7x2E_T1uHxkTudU/view?usp=drivesdk

## 2. O produto que DEVE existir
ShopVax (anteriormente Atacado Shop) é um **SaaS para catálogos de atacado/varejo e descoberta visual, com finalização do pedido via WhatsApp da vendedora**. Não é um ERP.
- Loja e catálogo responsivo, com links públicos e identidade da loja.
- Catálogo atacado/varejo múltiplo, podendo reutilizar base de produtos e estoque, mas com preços, visibilidade, pedido mínimo e condições por catálogo.
- Produtos com categorias, fotos, vídeos, referência/SKU, variantes Cor × Tamanho, preço e estoque básico controlável por produto/variação.
- Feed social vertical e feed da loja, descoberta de produtos, perfis públicos, favoritos/interação e passagem fluida ao carrinho.
- Vendedoras, links individuais, atribuição de origem e manutenção consistente de vendedora ativa entre navegação, sessão, abas, catálogo e checkout.
- Carrinho, grade/talão, dados do comprador opcionais, regras de pedido mínimo verificadas no backend, envio explícito de pedido estruturado para WhatsApp **da vendedora vinculada**.
- Pedidos e histórico operacional com confirmação comercial manual, cancelamento e devolução de estoque quando aplicável; prevenir duplicidade, disputas concorrentes e erros cross-tenant.
- Métricas reais de intenção: visitas, views, cliques, adições ao carrinho, checkouts iniciados, redirecionamentos ao WhatsApp, performance por item, loja, catálogo, link e vendedora. **Clique no WhatsApp não prova envio efetivo, pagamento, faturamento ou venda concluída.**
- Importação de catálogo PDF pelo lojista com extração local Poppler/Tesseract, limites de 50 MB/200 páginas, revisão obrigatória, sem publicação automática nem associação arriscada entre várias imagens e produtos na mesma página.
- Geração de PDF de catálogo; mídia responsiva, performance em celular modesto, mídias originais preservadas.
- Painel lojista: produtos, pedidos, catálogos, vendedoras, estoque simples, insights, configurações, branding, planos e uso.
- Administração plataforma: lojas, administradores, auditoria, segurança, suspensões, planos, limites e exceções comerciais preservadas.

## 3. Comercial — não reverter decisões
Planos: **Bronze R$49,90; Prata R$94,90; Ouro R$144,90/mês**. Semestral -5%, anual -15%, conforme configuração atual. Bronze: 500 produtos, 5 vendedoras, 1 catálogo, 5 fotos/produto. Prata: 2.000 produtos, 15 vendedoras, 3 catálogos, 10 fotos/produto. Ouro: produtos/vendedoras/catálogos/fotos ilimitados, respeitadas as demais regras atuais da API. Revisar `README.md` para capacidades exatas por plano, incluindo franquias, prioridade do feed e gating. Bronze sem funcionalidades pagas avançadas; Prata e Ouro conforme API.
**Não** aplicar preços antigos R$69/129/199 do manifesto ou presumir que planos expostos em documentação histórica refletem o banco real. Limites são validados no backend; migrar lojas existentes apenas após backup, auditoria e flag controlada `SHOPVAX_APPLY_APPROVED_PLAN_LIMITS`, sem excluir produtos e vendedoras preexistentes. Assinatura original previa **Cakto**; conferir implementação e contratos atuais antes de decidir ou ativar cobrança.
Código pode conter Asaas, frete calculado, Meta Shopping e API/ERP; **existência técnica não equivale a comercialização/homologação**. Não converter MVP em ERP/PDV, emissão fiscal, frete automático, gateway financeiro ou logística avançada sem decisão específica; isolar recursos experimentais.

## 4. Identidade visual obrigatória
Referência de redesign: papel `#F3F0E8`, tinta `#161514`, divisórias `#D9D3C6`, laranja oficial `#F25C05`; `Archivo Narrow` (títulos), `Archivo` (corpo), `Fragment Mono` (etiquetas/códigos). Logo V/A e wordmark **com paths da prancha aprovada**, sem fonte genérica. Experiência com cartões editoriais, etiquetas, fitas, talões e grade comercial; hierarquia clara, legibilidade real e precisão visual. Preservar marca e cor própria de cada lojista; jamais substituir sua identidade por ShopVax nas vitrines. Comparar pranchas SVG reais em 320/390/430px e desktop, com estados, erros, formulários, modais, movimento reduzido, sem inventar métricas, depoimentos ou preços. Layout adaptativo, sem overflow horizontal, foco visível e contraste acessível.

## 5. Stack, ferramentas e limites de atuação
Stack existente: Vite + React 19 + TypeScript; backend Express/Node ESM e PostgreSQL via `pg`; arquivos `server/*-hooks.mjs`; `Dockerfile`, `nginx.conf`, CI GitHub Actions e deploy proposto em EasyPanel. **Não reescrever o sistema para Next.js/Go/Python**. Ferramentas autorizadas quando efetivamente conectadas: GitHub para branches, commits, PRs e CI; Codex para código/testes; Google Drive para referências; ArlesHub/Graphify para exploração de fluxos/dependências, se disponível. Nenhuma dessas ferramentas prova acesso ao servidor de produção. Não inventar tokens, domínio, DNS, segredos, permissões nem resultados.
Segurança: não salvar `.env` real, credenciais, chaves de webhook, dados de clientes, conversas de WhatsApp ou capturas com informações pessoais no GitHub (repositório público). Isolamento tenant, sessões, cookies, autorização por recurso, CSRF/origin checks, rates, validação de upload/OCR e backups sempre no escopo da auditoria.

## 6. Situação verificada no handoff e lacunas
Em 31/10/2026 o código da `main` possuía fluxos de catálogo/checkout, identidade aprovada aplicada e suítes `phase1-final-mvp` a `phase5-final-mvp` e `validate` verdes após inclusão de documentos. Isso **não** equivale à homologação de produção. `docs/SHOPVAX_RELEASE_GATE.md` indica bloqueios de comparação visual com as pranchas completas, deploy/identidade do SHA, testes reais em iOS/Android e rede fraca, backups/restores, verificação de migrações e desempenho. Branches anteriores tiveram failures; não assumir que um PR com check falho foi corrigido sem inspeção. Antes de editar: confirmar SHA atual, branches/PRs e workflow runs recentes.
Prioridades: (1) reconstruir referências e inventariar gaps; (2) regressão funcional e testes de segurança; (3) comparação visual de todas as 9 pranchas por superfície; (4) desempenho em dispositivos reais; (5) preparar e comprovar gate de produção sem fazer deploy destrutivo; (6) fechar documentação e issues conforme evidência.

## 7. Plano operacional obrigatório para o Codex
1. Faça `git status`, `git log`, inventário de scripts, PRs e CI; **preserve código e histórico**.
2. Leia todas as fontes; recupere e abra SVGs; crie matriz `requisito → implementação → teste → evidência → pendência` para cada módulo/tela.
3. Reproduza falhas reais e priorize correção de P0/P1, depois P2; não faça refactors estéticos irrelevantes.
4. Execute `npm ci` (ou gerenciador definido no lockfile), `npm run build`, testes `server` e E2E/GitHub Actions; adicione cobertura para correções.
5. Teste isolamento de duas lojas, plano, sessão, vendedora/WhatsApp, preço e pedido mínimo server-side, concorrência/estoque, PDF malicioso/OCR e dados de pagamento separados do pedido.
6. Faça capturas reais comparativas para estados mobile/desktop; não declare equivalência sem abrir os SVGs.
7. Trabalhe em commits e PRs pequenos e rastreáveis; faça merge apenas com verificações adequadas; não sobrescreva mudanças de outras branches sem análise.
8. Planeje deploy seguro: backup testado, restore de teste, migração controlada, SHA da imagem, healthcheck, smoke test, rollback. **Não executar alterações destrutivas ou publicação externa sem controles e autoridade apropriados.**
9. Ao final, entregue relatório com status por módulo, SHA(s), testes executados, evidências, links de PR/CI, pendências genuínas e limites de ambiente. Sem alegar 100% por testes locais ou por CI verde.

**Ordem final:** continuar e finalizar ao máximo o projeto EXISTENTE com evidências, sem trocar escopo, sem esconder bloqueios de Stitch/produção e sem depender deste chat.