# Shopvax redesign — Fases 2 e 3: execução modular

**Fonte oficial:** `Shopvax_ Catálogo (redesign).zip`, em especial as pranchas `03 · Fluxo de compra no celular`, `05 · Desktop` e `06 · Painel de quem vende`. A implementação deve reproduzir **o produto desenhado**, não apenas incorporar referências de estilo.

## Entrega inicial (PR #57)

O escopo deste PR foi deliberadamente separado de mudanças arriscadas de checkout e migrações. Ele contém:

- Base estilística da coleção, cartões e talão no padrão oficial preto/papel/laranja, sem mexer nos endpoints e nos dados das lojas.
- Grade atacadista funcional de produtos que tenham **Cor** e **Tamanho** como dois grupos de variação. Seleção de várias cores, quantidades por tamanho, subtotal, limites de estoque e adição de linhas individuais ao carrinho existente.
- Preserva escolha individual para produtos e nichos que usam outros grupos de variação.
- Dashboard comercial redesenhado a partir de dados reais: pedidos, acessos, carrinhos, peças, valores de pedidos, links individuais de vendedoras e checklist da loja.
- Estilos do painel em linguagem visual oficial; detalhes comerciais do lojista seguem configuráveis.
- Regressão E2E do grade, além de testes responsivos e integração existente.
- Correção da dependência `qs` para 6.16.1, após alerta de vulnerabilidade em 6.16.0.

### Estado dos módulos (não confundir implantação de componentes com conclusão total da fase)

| Módulo | Entregue nesta etapa | Ainda exigido para finalizar |
|---|---|---|
| 03 Vitrine | Estilo da loja e cartões | Capa editorial, blocos Acabou de chegar e Mais pedidos, ações e layout comparados pixel a pixel ao SVG |
| 04 Feed | Estilo da ação de compra | Publicações/ações e controles idênticos ao fluxo oficial |
| 05 Catálogo | Identidade de coleção, categoria, preços e cartões | Filtros e estados conforme prancha 03, contagem correta e catalogação completa |
| 06 Grade | Matriz multi-cor/tamanho e integração de carrinho | Regras por nicho (caixa/kit/tom), validação de estoque agregado e grade padrão |
| 07 Talão | Identidade visual, subtotal e itens reais | Talão numerado fiel, dados do comprador e estados de mínimo |
| 08 WhatsApp | Checkout existente preservado | Confirmação pré-envio, identificação opcional e separação entre pedido criado / mensagem enviada / venda confirmada |
| 09 Dashboard | Dashboard oficial funcional ligado a dados reais | Comparação fina de layouts, cartões e estados da prancha 06 |
| 10 Operação | Estilo de lista de pedidos e produtos preservados | Tela de produtos em linhas, detalhes/ações de pedidos e experiência final de equipe |
| 11 Planos/onboarding | Paletas oficiais da Fase 1 preservadas | Onboarding visual e página de planos da prancha 07 |

## Contratos de negócio que não podem se perder

1. Um pedido pode conter várias linhas do mesmo produto, cada uma com a combinação `selections` de tamanho e cor válida.
2. Para produto com estoque: a API `/api/business/orders` é a fonte final de disponibilidade, com transação e trava; cliente nunca determina preço/estoque.
3. `localStorage` persiste o carrinho por loja, sem misturar outras lojas; sellerSlug continua atribuindo vendedora.
4. Criar pedido com URL do WhatsApp não é prova de entrega efetiva da mensagem ou pagamento.
5. O painel só exibe métricas realmente calculadas; valores de pedidos não são faturamento confirmado.
6. Fontes e cores oficiais definidas na Fase 1 continuam sendo a base dos componentes; a cor escolhida pela loja é apenas o acento.
7. Em todos os dispositivos, não esconder produto, variações, quantidade ou ação de compra para resolver responsividade.

## Critérios para concluir integralmente as Fases 2 e 3

- Implementar todos os fluxos das pranchas 03, 05, 06 e 07, inclusive telas/estados vazios, validações, detalhes de produtos e operações de vendedora.
- Provar grade por cor/tamanho/quantidade, checkout, vínculos de atendimento, mínimos, mensagens, estados de pedidos, fotos, importação e recursos por plano.
- E2E de mobile/desktop, portrait/landscape, baixo estoque, múltiplas cores, limite mínimo, erro de WhatsApp, pedidos reais e permissões por loja.
- Homologar com capturas visuais reais contra os SVGs oficiais antes de considerar Fase 2 ou 3 100% concluída.
- Implantação e verificação do ambiente público são uma etapa separada do merge no GitHub.
