# Fase 2 — MVP final Shopvax

Esta fase fecha a operação em cima da fundação validada na Fase 1.

## Escopo

- Vendedoras com limite do plano e intercalação automática no link geral.
- Links individuais continuam fixos e têm prioridade sobre o rodízio.
- Sessão de atribuição fica estável por 24h para o mesmo visitante.
- Cadastro de franqueados disponível nos planos com o recurso (Plano 2: até 2).
- Conta de cliente por loja, com login e histórico dos próprios pedidos.
- Pedidos feitos por cliente autenticado são vinculados à conta.
- Estoque continua compartilhado entre catálogos, mas só pode ser ativado nos planos que incluem estoque.
- Domínio próprio e personalização avançada ficam limitados aos planos que incluem esses recursos.
- Domínio configurado nasce como `pending` e é marcado `verified` quando a aplicação recebe uma requisição real usando aquele Host.
- Gestão operacional de pedidos usa `whatsapp`, `em_atendimento`, `arquivado` e `cancelled`; cancelamento continua sendo a ação que devolve estoque.
- Valores dos pedidos representam pedidos/intenção registrados e não faturamento confirmado.

## Preservado

- Cadastro de produtos e galerias da Fase 1.
- Catálogos e preços específicos por catálogo.
- Grade/variações.
- Pedido mínimo.
- Carrinho.
- Baixa/retorno de estoque já existente.
- Geração do pedido e link estruturado do WhatsApp.
