# Shopvax — Aceite funcional das Fases 2 e 3

Referência visual oficial: `Shopvax_ Catálogo (redesign).zip`, pranchas **03 · Fluxo de compra no celular**, **05 · Desktop**, **06 · Painel de quem vende** e **07 · Planos**. Base técnica: módulos 00–02 da Fase 1.

## Entregas implementadas

| Módulo | Implementação no código | Validação |
|---|---|---|
| 03 · Vitrine | Capa editorial com produto do próprio lojista, marca/cores, CTA para coleção e feed, produtos destacados, mínimo e link de vendedora | E2E de responsividade e identidade de múltiplas lojas |
| 04 · Feed | Navegação vertical, descrição expandível, salvar por loja, compartilhar, perguntar diretamente no WhatsApp e abrir grade | `tests/shopvax-feed.e2e.mjs` |
| 05 · Catálogo | Busca nome/referência, categorias, grades nos cartões, mídia com proporção preservada, paginação e estados de carregamento | `tests/product-picker-responsive.e2e.mjs` e suíte de catálogo |
| 06 · Grade | Múltiplas cores e tamanhos na mesma peça, quantidades por variação, subtotal, estado de estoque e linhas separadas no carrinho; escolha individual continua para produtos fora da grade Cor/Tamanho | `tests/shopvax-grade.e2e.mjs`, integração de estoque/rollback |
| 07 · Talão | Carrinho numerável em linhas, revisão com grade, quantidades, mínimo, preço, comprador opcional e observações | `tests/shopvax-checkout-review.e2e.mjs`, integração do pedido |
| 08 · WhatsApp | Ação explícita de **Preparar** e depois **Abrir WhatsApp e mandar**, com alternativa **Copiar pedido**. Pedido é gravado pela API, com comprador/observações, antes da abertura da conversa | Integração do pedido e fluxo de navegador |
| 09 · Dashboard | Identidade oficial, acessos, carrinhos, pedidos, peças, valores registrados, últimos talões, links e checklist | Regressão visual multiloja e das fases 1–5 |
| 10 · Operação | Lista responsiva de produtos, filtros, busca, editar/ocultar/excluir em massa, PDF; talões com filtros, detalhes, status, cópia, confirmação manual, cancelamento e devolução de estoque; vendedoras com link próprio | `tests/shopvax-product-list.e2e.mjs`, integração da fase 2/3 |
| 11 · Onboarding/planos | Escolha inicial de Laranja, Mostarda ou Grafite persistida no banco; personalização em Minha Loja; tabela oficial Bronze/Prata/Ouro com dados reais da API e escolha do plano | `tests/shopvax-plans.e2e.mjs`, `server/phase1-final-mvp.integration.mjs` |

## Regras mantidas durante a reconstrução

- O Shopvax **não é ERP**: não processa frete, pagamento, faturamento ou atendimento no lugar da vendedora.
- Pedido criado é **intenção registrada**, não comprovante de conversa efetivamente enviada, venda fechada ou pagamento recebido.
- A confirmação de venda é **manual e explícita** no painel; cancelar deve devolver estoque uma única vez.
- Estoque, produtos ativos, preços, variações e mínimos são validados no servidor; a interface é apenas conveniência.
- Link de cada vendedora direciona o atendimento; carrinho e favoritos ficam separados por loja.
- O desenho deve adaptar-se a qualquer viewport mantendo ações comerciais disponíveis, sem recortar fotos do catálogo para preencher à força.
- Planos são apresentados conforme limites de verdade do banco (inclusive fotos ilimitadas no Ouro), sem valor inventado.
- Dados opcionais do comprador são registrados no pedido; não representam consentimento de marketing.

## Evidências de CI

- Cada PR só pode ser integrado após `validate`, `phase1`–`phase5` e `responsive-picker-check` aprovados.
- Resoluções testadas incluem mobile estreito, mobile padrão e desktop, além de 19 tamanhos do teste original de responsividade.
- Não substituir um teste funcional por mera busca de palavras ao mudar a interface; atualizar a regressão para o comportamento real.

## Limites do aceite / Fase 4

O aceite das **Fases 2 e 3** se refere à implementação dos módulos e aos testes automatizados; **não certifica equivalência pixel a pixel com os SVGs**. A Fase 4 mantém comparação visual detalhada, animações, revisão final de acessibilidade/performance e homologação em produção. Merge e GitHub Actions **não comprovam implantação no domínio público**. Após publicação, testar em dispositivos reais e executar o checklist final do projeto.
