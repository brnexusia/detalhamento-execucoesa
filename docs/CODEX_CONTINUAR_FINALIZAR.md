# PROMPT PRINCIPAL — CODEX | SHOPVAX | CONTINUAR ATÉ HOMOLOGAR
Atualizado em 31/10/2026. **Este texto é uma ordem de continuidade de um projeto existente, NÃO uma solicitação de começar outro sistema.**

## Identidade e acesso
Você é o engenheiro responsável por analisar, corrigir, completar, testar e homologar o ShopVax, SaaS de catálogo para vendas via WhatsApp. Não recebe o histórico das conversas do ChatGPT; **este documento e as fontes abaixo fornecem o contexto**.

- Repositório de código oficial: https://github.com/brnexusia/detalhamento-execucoesa ; branch principal `main`.
- Não criar projeto/repositório novo; trabalhar na base existente, mantendo histórico, estrutura, módulos e integrações.
- Ferramentas: GitHub (código, issues, PRs, CI, histórico), Google Drive (referências originais), ambiente Codex (terminal, testes, navegador/screenshot onde disponíveis). Consulte inventário real de ferramentas e conecte-as/autentique-se apenas quando autorizado. Um plugin instalado não significa acesso confirmado.
- **Verifique primeiro o Google Drive**: liste/abra as referências, leia arquivos e registre quais ferramentas realmente funcionam. O ZIP SVG original de redesign está em https://drive.google.com/file/d/1QzU5PkuzVpxqNGYg_7x2E_T1uHxkTudU/view?usp=drivesdk ; a versão PNG está em https://drive.google.com/file/d/1s-JEfhZQjazt0rJuCmWGWwAxA6EDPfgO/view?usp=drivesdk . O mestre de marca `Shopvax_ Logo (propostas).zip` tem a prancha `19 · Laranja.svg`. Se links ou ferramentas não abrirem, registrar bloqueio exato; **não dizer que fez comparação visual sem os arquivos**. Não incorporar ZIPs/PDFs grandes ao Git apenas para contornar a ausência de plugin.
- Documentos consultáveis em `docs/references/Shopvax_Manifesto_MVP.texto.md`, `docs/references/Atacado_Shop_Diretrizes_Produto_e_Precos.texto.md`, `docs/references/README.md`. São **transcrições textuais**, não substituem SVG/PDF originais. Preços do manifesto histórico (R$69/129/199) foram superados pelas decisões comerciais posteriores.
- Ler antes de modificar: `README.md`, `docs/SHOPVAX_RELEASE_GATE.md`, `docs/SHOPVAX_BRAND_ASSETS.md`, `docs/SHOPVAX_REDESIGN_SURFACE_AUDIT.md`, `docs/SHOPVAX_REDESIGN_PHASE1.md`, `docs/SHOPVAX_REDESIGN_PHASES_2_3.md`, `docs/SHOPVAX_REDESIGN_ACCEPTANCE_PHASES_2_3.md`, `docs/FASE2_MVP_FINAL.md`, `MIGRATION_NOTE.md`, `.github/workflows/*`, além dos diffs/PRs/issues e do código real. Documentos de status podem estar desatualizados; validar cada alegação.

## Produto e escopo
ShopVax/Atacado Shop é um produto **deliberadamente enxuto**. A proposta é: lojista cria loja e catálogo, cliente descobre produtos (vitrine/feed), escolhe variações e quantidades, monta carrinho, envia pedido estruturado para a **vendedora correta no WhatsApp**; negociação/fechamento acontecem ali. O sistema mede intenções observadas, não deve inferir faturamento de clique no WhatsApp.

Núcleo obrigatório:
1. Loja/vitrine responsiva com URL própria, perfil da loja e feed social vertical por publicação; mídia foto/vídeo, descoberta e navegação fluida.
2. Gestão de produtos: SKU/ref, preço, categoria, fotos múltiplas, vídeo, variações/grade, disponibilidade, estoque básico; cadastro, edição, filtros, importação de catálogo por PDF com revisão humana e geração/compartilhamento de catálogo.
3. Múltiplos catálogos com uma base de produtos/estoque, regras distintas de visibilidade, atacado/varejo, preços e pedido mínimo.
4. Carrinho e checkout informativo com backend determinando preço/limites; mensagem de pedido com cliente/itens/variação/quantidades/valores para WhatsApp da vendedora ativa e atribuída, preservando origem/link. **Não enviar mensagem automaticamente, não usar telefone da loja como fallback indevido.**
5. Vendedoras, links individuais, atribuição, métricas de intenção, e comissão opcional **estimativa**, não repasse financeiro.
6. Inteligência: performance dos itens, links, vendedoras, catálogos e funil acesso→produto→carrinho→checkout→clique WhatsApp. Separar cliques de pedidos recebidos, vendas confirmadas, recebimentos e faturamento.
7. Cadastro/login/sessões (incluindo Google, quando configurado), painel, primeiro acesso, planos, administração, controles de acesso, tenant isolation, auditoria e segurança.
8. Temas sazonais/personalização e identidade oficial, inclusive manutenção do logo individual do lojista.
9. Integrações existentes no código: Asaas, cálculo de frete, Meta Shopping, API/ERP/webhooks. **Não presumir que façam parte do escopo comercial homologado do MVP**; manter segregadas, seguras, testadas e nunca anunciar como prontas sem autorização. Não incluir PDV, emissor fiscal ou ERP completo por conta própria.

### Planos comerciais aprovados na implementação
Bronze R$49,90/mês (500 produtos, 5 vendedoras, 1 catálogo); Prata R$94,90/mês (2.000 produtos, 15 vendedoras, até 3 catálogos); Ouro R$144,90/mês (produtos, vendedoras e catálogos ilimitados). Mensal cheio; semestral 5% de desconto; anual 15% de desconto. Leia `README.md` para todas as demais diferenças (fotos, franqueados, feed, estoque, personalização, recursos extras) e confira código+API. Vax Lar é futuro; não declarar entregue. A **Cakto** foi indicada como cobrança de assinatura em escopo histórico; confirmar estado atual antes de integrar/substituir provedor.
Não aplicar `SHOPVAX_APPLY_APPROVED_PLAN_LIMITS=1` em produção sem auditoria de contas, backup e restauração testada, conforme o release gate.

### Design obrigatório
As pranchas originais do ZIP SVG de redesign definem a linguagem visual (nove pranchas). Paleta documentada: papel #F3F0E8, tinta #161514, divisória #D9D3C6, laranja #F25C05; fontes Archivo Narrow/Archivo/Fragment Mono. Usar logo vetorial oficial da prancha 19 para a marca central, sem substituir a identidade do lojista. Implementação não basta: comparar estados, desktop e mobile com fontes reais; reportar divergências pixel/elemento/fluxo, corrigir e validar sem sacrificar operação. Não inventar telas com aspecto genérico de IA.

## Situação conhecida antes desta ordem
No `main` de 31/10, existem aplicação React+TypeScript/Vite, servidor Node/Express, muitos hooks/módulos e testes, PRs de feed, autenticação, mídias, temas e redesign. Os workflows de CI e fases 1–5 no último commit documental foram verdes. **CI verde não equivale a operação real nem homologação visual.** O arquivo `docs/SHOPVAX_RELEASE_GATE.md` descreve evidências de produção ainda necessárias. A referência textual pode dizer que ativos binários existem no Git; confira a árvore real antes de confiar nisso.

## Execução obrigatória, sem recomeçar
1. Inspecione branch, commits, estrutura, código, dependências, Docker, migrações, testes, PRs/issues; elabore matriz requisito → implementação → teste → pendência → evidência. Classifique apenas com prova.
2. Estabeleça baseline reproduzível. Use scripts reais de `package.json`: `npm run build`, testes scanner, PDF, auth, integrações etc., mais workflows GitHub e e2e disponíveis. Não invente nomes de comandos. Verifique Node e banco necessários.
3. Priorize regressões de login/sessão entre abas, isolamento de lojas, preço no backend, limites de plano, catálogo/variações/estoque, carrinho e contato WhatsApp correto. Corrija causa-raiz com testes, não apenas CSS. Teste 320/390/430px e desktop, browsers, redes fracas e redução de movimento.
4. Complete lacunas comprovadas. Preserve todos os recursos existentes; não delete módulos por parecerem fora do MVP. Separe funcionalidades experimentais sem expor a usuários desautorizados.
5. Compare visualmente com os originais via Google Drive quando acessíveis. Gere capturas e relatório por tela/estado (home, autenticação, feed, perfil, vitrine, grade, checkout, onboarding, planos, painel, admin).
6. Segurança: isolamento multiempresa, acesso a mídias, rate limits, headers/cookies, fluxos de login/Google, upload de PDF (limites/assinatura/OCR/timeout), XSS/injeção, CSRF/origem, segredos, webhooks idempotentes e migrações seguras.
7. CI: reexecute `validate` e workflows de fases, resolva falhas, documente comandos/artefatos, crie PRs/commits pequenos, revisáveis e coerentes.
8. Homologação de deploy só com ambiente real autorizado: backup + restore testado, SHA do container publicado, HTTPS, `/health`, smoke test com duas lojas, WhatsApp em dispositivo real, mídia persistente, auditoria de métricas e performance. Nunca alterar produção, fazer cobrança real ou restauração destrutiva sem autorização explícita e plano de rollback.
9. Atualize docs, decisões, checklist e relatório final com: arquivos alterados, SHA, links PR/CI, bugs, métricas, testes realizados, pendências externas e instruções de operação. Nunca usar "100%" sem comprovação; se Drive/Stitch/produção indisponível, encerrar apenas a parte realmente validada e registrar bloqueio.

**Tarefa final:** continuar o projeto existente até finalizar tudo que é tecnicamente executável no ambiente; testes e homologação têm o mesmo peso que funcionalidades. Não responder apenas com plano; implementar e comprovar as correções.
