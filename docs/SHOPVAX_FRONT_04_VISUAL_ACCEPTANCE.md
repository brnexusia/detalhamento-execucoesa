# SHOPVAX · Frente 04/06 — inspeção e evidências visuais

**Base auditada:** `main` em `2a4909dbd7f976c686b510e861f8558c1f3a381a` (31/10/2026).  
**Branch isolada:** `parallel/04-visual-design`. Integração exclusiva pela Frente 01.  
**Fonte visual:** `Shopvax_ Catálogo (redesign).zip` verificado e aberto, 9 SVGs: 01–08 funcionais e 09 somente fotografias. O README de `docs/references/redesign-original-parts/` descreve a remontagem íntegra de 11 partes (12.897.131 bytes); original também no Drive. Não confundir com PNG histórico.

## Critério metodológico

Comparação documental do **SVG real** contra código da `main` e testes existentes. O SVG mostra estados e posições; código compilando ou teste verde **não** aprova fidelidade de tela. Capturas browser devem ser conferidas lado a lado por estado e viewport, inclusive movimentos. Esta frente não tem autorização para afirmar publicação em EasyPanel, WhatsApp enviado, valores faturados nem homologação física em Safari iOS.

| Prancha | Referência específica no SVG | Código e lacuna observável | Ação da frente 04 | Aceite visual |
| --- | --- | --- | --- | --- |
| 01 Conceito | Headline editorial "O talão de pedido, no celular", loja protagonista, preço/mínimo e jornada WhatsApp | `Home.tsx` tem talão e narrativa. Não há screenshot comprovando composição da prancha 01 | Preservado; sem alterar dados comerciais | Pendente confronto de captura |
| 02 Sistema | Papel, tinta, divisórias, laranja, fita, carimbo, etiqueta e grandes números; fonte Archivo Narrow / Archivo / Fragment Mono | Assets vetoriais incorporados pela #92; logomarca de loja com moldura em `shopvax-brand.css`, contrariando C03. Textos de referência discretos | Retirada **localizada** da moldura da logo de loja; legibilidade de referência nos estilos dedicados | Pendente captura e contraste real |
| 03 Mobile | Capa, coleção, variação/grade, mínimo, revisão, WhatsApp e erros | Fluxo existe na `PublicStoreV2.tsx`; algumas etiquetas exibiam 9–10 px. Funcionalidade já testada na #97/#99 | Etiquetas e referências no mínimo de 12 px; não tocar na validação do pedido | Pendente screenshots + Safari físico |
| 04 Multinicho | Moda, beleza (caixas/tons), utilidades (kits) | #96 cobre moda/cosméticos/utilidades por atributos, mas não presume unidade de venda universal nos SVGs | Sem mudança indevida de variantes ou estoque | Pendente confronto por nicho |
| 05 Desktop | Coleção quatro colunas, talão persistente à direita, produto com galeria e "Leva junto" | #93/#98/#101/#102 implementados, com testes específicos; posição real em vários tamanhos precisa conferir | Preservação do fluxo; monitoramento via regressões existentes | Pendente captura comparativa |
| 06 Painel | Mosaico de fotos e login, cor inicial, dashboard e tabelas | #94/#114/#115/#116/#113 abordam login, Black Friday, saudação e temas; miniaturas sazonais ainda tinham texto de 11 px | Legibilidade e área de seleção dos cartões, sem interferir nos dados | Pendente mobile/tablet/desktop e zoom |
| 07 Planos | Bronze, Prata, Ouro e grade responsiva | Preços/limites reais pela API (#95); texto C10 corrigido na #111 | Nenhum valor ou limite alterado | Pendente comparação visual |
| 08 Movimento | Fita contínua a 40px/s, carimbo 220ms, toque 80ms, contador 160ms, mínimo por segmentos, talão 420ms; reduced motion | #90 implementado e possui E2E específico, #114 atende fita sazonal do login | Preservado; movimento reduzido incluído nos testes visuais | Pendente comparação de vídeo/tempos |
| 09 Fotos | Painel de referência de imagens | Não é fluxo funcional | Nenhuma implementação extra | Não aplicável |

## #109 — checklist de intervenção

- **C01/C02:** ajustes responsivos de textos pequenos em vitrine, referências, categorias e cartões sazonais; teste em 320, 390, 430, 768, 1024, 1440 px.
- **C03:** remover borda e fundo de `.brand__logo` e `.store-intro__logo`, com nome da loja permanecendo destacado na composição inferior.
- **C04/C07/C10:** mecanismos já integrados em #111; não reimplementar nem alterar roteamento.
- **B05:** saudação temporal de #115 preservada; hierarquia final permanece para aceite visual.
- **C05/C06/C08/C09:** estado ou protótipos devem ser verificados em telas reais. Nenhum aceite declarado só pela existência de CSS.
- **D01/D02:** gestão existente de paletas/temas por loja, com aplicação explícita e fita específica Black Friday no login (#113/#114). A prévia não publica.
- **D03:** PDF já usava configuração salva via `resolveShopvaxTheme`, porém cabeçalho e cartões eram visualmente uniformes. Foram acrescentados tarja e assinatura editorial impressas, marcação cromática discreta nos cards e ornamentos vetoriais por temporada (Black Friday, Natal, São João). Conteúdo, preço, SKU, fotos, identidade e fonte de dados não são alterados.
- **D04:** mídia responsiva de #108 preservada; não inventar detalhe de fotografia nem alterar original.

## Evidência técnica gerada por CI

`responsive-picker-check` deve rodar os testes existentes e adicionalmente:
- `tests/shopvax-visual-front-04.e2e.mjs`: seis viewports, nome/logo da loja, sem moldura, legibilidade da referência, overflow horizontal, screenshots no diretório `artifacts/shopvax-redesign/frente04-vitrine-*.png`.
- `server/shopvax-theme-presets.test.mjs`: PDF de quatro estados (**padrão**, **paleta salva**, **sazonal salvo** e **tema restaurado**); confere PDF válido, texto e preço se `pdftotext` disponível e gera quatro prévias PNG via `pdftoppm` se disponível, além dos próprios arquivos PDF.
- Suítes já existentes: 03 mobile, 04 multinicho, 05 desktop, 06 login/dashboard, 07 planos, 08 movimento, temas, autenticação entre abas, estoque e pedidos.
- Artefato: `shopvax-redesign-visual-evidence` para PNG + PDF; retenção de 14 dias.

**Status deste documento na abertura do PR:** implementação encaminhada, CI e inspeção visual das capturas **pendentes**. Não marcar nenhuma prancha como homologada sem conferir e registrar capturas e passos funcionais. PDFKit usa fontes de sistema (`Helvetica`) no PDF; não afirmar fidelidade tipográfica total às fontes web sem embeddings licenciados/validados.

## Segurança de escopo

Somente estilos, teste visual, geração de PDF e workflow de CI foram alterados. Nenhuma mudança de autenticação, regra de vendedora/WhatsApp, pricing, pedido mínimo, cálculo monetário, SQL ou pipeline de produção. **Não fazer merge automaticamente.**
