# Shopvax: catálogo Stripe e reajustes

## Produtos e preços
O backend mantém um produto canônico por plano e por ambiente Stripe na tabela shopvax_stripe_products. Bronze, Prata e Ouro têm produtos próprios; alterações de valor e ciclo criam novos Prices sob o produto já escolhido. O mesmo preço é reutilizado entre os assinantes.

Em bancos existentes, o backend reaproveita um produto anterior para novas versões. Produtos antigos com assinaturas vinculadas são preservados para evitar interromper pagamentos; a limpeza histórica exige conferência dos vínculos no Stripe.

## Novas contratações
Alterar o preço de um plano em Admin > Planos modifica o valor oferecido em novos checkouts. Assinaturas ativas anteriores preservam seus preços automaticamente.

## Assinaturas existentes
A seção Reajustar assinaturas existentes em Admin > Planos permite:
1. Escolher Bronze, Prata ou Ouro.
2. Selecionar assinaturas pagas e ativas ou todas as elegíveis do plano, até 50 por ação.
3. Conferir a prévia por loja e ciclo, com os valores que serão cobrados na próxima fatura.
4. Confirmar que os clientes foram avisados antecipadamente e digitar REAJUSTAR.
5. Aplicar a migração de Price na Stripe sem cobrança proporcional imediata.

O backend verifica loja, customer, status, ciclo, item de assinatura e moeda. Usa proration_behavior=none: com o mesmo intervalo de cobrança, a alteração de preço incide na próxima renovação. Falhas são informadas por loja; operações bem-sucedidas ficam registradas na auditoria administrativa.

Os clientes não recebem aviso automático. Analise as condições contratuais, especialmente ofertas vitalícias e contratos anuais, antes de reajustar. O sistema não faz reajustes automaticamente ao fim da Black Friday.
