# Shopvax — Fases 2 e 3: encerramento técnico

**Data:** 27 de outubro de 2026  
**Repositório:** `brnexusia/detalhamento-execucoesa`  
**Branch de produto:** `main`  
**Referência visual do produto:** `Shopvax_ Catálogo (redesign).zip`, pranchas 03 (Fluxo de compra), 05 (Desktop), 06 (Painel de quem vende) e 07 (Planos).

## Estado

**Implementação funcional no repositório: concluída**, com regressões automatizadas e PRs integrados ao `main`. O redesign deve permanecer modular, multiloja e orientado ao atacado: quem compra monta o talão, a vendedora recebe a mensagem preparada e o lojista gerencia a operação.

**Publicação do site e aprovação visual final:** não comprovadas por esta homologação de GitHub. Não interpretar testes automatizados como validação de deploy, entrega de mensagens no WhatsApp ou comparação pixel a pixel com as pranchas.

## Módulos 03–11 entregues

| Módulo | Resultado integrado | PRs |
|---|---|---|
| 03 — Vitrine | Capa com fotografia real do catálogo, marca própria da loja, CTA de catálogo/feed, seleção e destaques | #58 |
| 04 — Feed | Produtos em fluxo vertical, descrição expandível, favoritar por loja, compartilhar, perguntar e montar grade | #59 |
| 05 — Catálogo | Catálogo por categorias, busca por nome/referência, paginação, filtros, estado vazio e ordenação por preço de toda a coleção (não só da página visível) | #58, #71 |
| 06 — Grade atacadista | Modo multicolorido com matriz Cor × Tamanho, quantidades por célula e subtotal. Modo individual preservado para as demais variações | #57 |
| 07 — Talão | Itens separados por variação, pedido mínimo, identificação e observações opcionais, revisão do total | #57, #62 |
| 08 — WhatsApp | Tela "Pedido pronto", texto de pedido com referência/grade/atendimento e abertura explícita do WhatsApp; ação de copiar | #62, #68 |
| 09 — Dashboard | Pedidos e acessos reais, quantidade de peças, links dos vendedores, checklist e atualização da identidade comercial | #57 |
| 10 — Operação | Produtos em linhas, categorias/busca, PDF, exclusão em massa, gestão de vendedores, filtros e detalhes de talões, alteração de estado, cancelamento e estorno do estoque; comprador visível no painel | #61, #67, #70 |
| 11 — Onboarding e planos | Paleta Laranja/Mostarda/Grafite na primeira configuração; comparação Bronze/Prata/Ouro ligada à API de planos; CTAs reais | #66 |

A identidade base foi estabelecida pela Fase 1 (#56). Tipografia, faixas, carimbos, etiquetas, laranja de ação, fundo papel e assinatura Shopvax devem ser reutilizados; loja e vendedora continuam protagonistas.

## Fechamento dos módulos 12–14

| Módulo | Entrega implementada | Evidência |
|---|---|---|
| 12 — Responsividade | Vitrine, feed, grade, talão e painel responsivos; suportes de telas estreitas e paisagem; scroll-snap do feed em iOS com rolagem vertical e sem ocultar opções/CTAs | PR #73; `tests/product-picker-responsive.e2e.mjs` (19 tamanhos) e `tests/shopvax-final-responsive.e2e.mjs` (5 tamanhos) |
| 13 — Movimento | Entrada editorial, fita, carimbo, contador e feedback dos botões; media query de `prefers-reduced-motion` desliga animações e encaixe forçado do feed | PR #73; `src/shopvax-final-motion.css` e E2E reduzido |
| 14 — Homologação técnica | Build, navegação de loja/grade/feed/talão, APIs e testes de cinco fases. Seis capturas de vitrine, feed e talão produzidas pelo GitHub Actions | PR #73; [evidência visual da execução](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/40576315086/artifacts/12767990446) (retenção temporária) |

**Fechamento do código:** todos os módulos 00–14 possuem implementação no `main`. A validação de navegador do PR #73 passou para 320×568, 390×844, 720×320 (paisagem), 1024×768 e 1440×900; a suíte `validate`, incluindo importador de 50 mil itens, e as fases 1–5 passaram no PR. O merge final do movimento é `f2f12f68baa07e91a748bfd58655347d6f47f513`.

**Limite da homologação:** as imagens são evidência de execução da interface, **não uma comparação automática de fidelidade visual/pixel a pixel** com o ZIP. A verificação manual contra as nove pranchas e a validação do domínio de produção continuam fora do que foi comprovado.

## Contratos de funcionamento preservados

- **Multiloja e autorização:** pedidos, vendedoras e produtos permanecem vinculados à loja; a API autenticada não publica dados privados do comprador.
- **Estoque e preço:** o backend valida preço, variações, mínimo, existência e disponibilidade no momento da criação do pedido, com transação de banco. O carrinho não é a fonte autoritativa.
- **Dados do comprador:** nome, telefone, cidade, CEP e observações são opcionais, persistidos no pedido e exibidos somente no painel administrativo; isso não equivale a consentimento de marketing.
- **WhatsApp:** "Pedido pronto" significa mensagem preparada. Só o usuário decide abrir/enviar; nenhuma página pode assumir mensagem entregue, venda paga ou estoque faturado.
- **Planos:** valores e limites vêm da API; Ouro mantém fotos ilimitadas quando `photo_limit` é nulo.
- **Responsividade:** CTAs de compra, grade, carrinho e revisão continuam visíveis/roláveis em dispositivos estreitos. Modais não devem impedir o acesso aos botões inferiores.

## Regressões e evidência automatizada

- `tests/shopvax-final-responsive.e2e.mjs` — vitrine → grade → feed → talão, cinco viewports, movimento reduzido, seis capturas.

- `tests/product-picker-responsive.e2e.mjs` — produtos e ações em 19 viewports.
- `tests/brand-phase1.e2e.mjs` — quatro paletas/marcas e carrinho.
- `tests/shopvax-grade.e2e.mjs` — grade por cor/tamanho, unidades e estoque.
- `tests/shopvax-feed.e2e.mjs` — navegação do feed, descrição e produtos salvos.
- `tests/shopvax-checkout-review.e2e.mjs` — dados opcionais e revisão do pedido.
- `tests/shopvax-product-list.e2e.mjs` — busca e categorias do painel.
- `tests/shopvax-plans.e2e.mjs` — preços, limites e escolha de plano.
- `tests/shopvax-order-buyer.e2e.mjs` — comprador e texto do talão no painel.
- `tests/shopvax-catalog-sort.e2e.mjs` — ordenação e filtros no navegador.
- `server/business-module3.integration.mjs` — ordenação de todas as páginas e proteção do cursor.
- `server/business-module2.integration.mjs` e `server/phase1-final-mvp.integration.mjs` — registro do comprador e paleta de novas lojas.
- Pipelines `validate`, `phase1-final-mvp` a `phase5-final-mvp` e `responsive-picker-check` aprovados nos PRs de implementação, observadas as versões de cada PR.

## Validação necessária fora do GitHub

Estes itens **não impedem considerar a implementação do código funcionalmente encerrada**, mas impedem declarar o **ambiente público/aceitação visual 100% homologado** sem evidência:

1. Confirmar que o backend/frontend publicados executam o SHA do `main` com os PRs #56–#71 aplicados, que a migração do banco executou e que nenhuma versão antiga está em cache.
2. Testar com loja e vendedores reais em `shopvax.com.br`: importar produtos, conferir qualidade de mídia, grade, estoque concorrente, geração de PDF, criar e cancelar talão e abrir a conversa WhatsApp.
3. Conferir visualmente mobile/desktop lado a lado com as pranchas 03/05/06/07. Testes de navegador cobrem fluxo e dimensões, mas não certificam identidade de pixels.
4. O modo de grade em **matriz** aplica-se a produtos com dois grupos `Cor` e `Tamanho`; os demais tipos mantêm escolha individual. Não apresentar suporte universal a "caixas/kits/tons" como implementado sem regra específica de negócio.

## Handoff

Os módulos 03–11 acima estão implementados em código e integrados em PRs auditáveis. Mudanças posteriores devem entrar como correções/regressões ou nova fase de produto, preservando as invariantes deste documento e a referência oficial do ZIP.
