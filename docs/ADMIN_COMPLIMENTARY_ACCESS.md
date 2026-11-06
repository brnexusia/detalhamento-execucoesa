# ShopVax — acesso gratuito por autorização administrativa

## Fluxo para uma conta que ainda não pagou
1. A pessoa se cadastra normalmente em /criar-conta e pode interromper o checkout, sem pagar.
2. Em Admin > Contas, o administrador busca a loja pelo nome ou e-mail.
3. Clica em **Liberar sem pagar**, escolhe Bronze, Prata ou Ouro, duração (7/30/90/365 dias ou sem prazo), informa motivo e confirma a senha ou o login Google.
4. Depois da confirmação, o lojista atualiza a página e acessa /painel. Em /painel/assinatura aparece a cortesia e o prazo, sem botão de cobrança para a liberação.
5. Em Admin > Contas, **Revogar cortesia** desfaz a autorização mediante confirmação administrativa. Quando uma cortesia com prazo expira, o bloqueio de pagamento volta automaticamente.

## Segurança
- A implementação preserva billing_required e nunca marca uma fatura como paga, não gera invoice.paid nem simula uma assinatura Stripe.
- A exceção é vinculada a **uma loja**; outros usuários continuam sujeitos ao pagamento obrigatório.
- O acesso é checado no servidor nos mesmos caminhos que bloqueiam quem não pagou. A autorização não ignora uma suspensão administrativa da loja.
- Apenas administradores autenticados, com reautenticação por senha ou Google e confirmação textual, podem conceder ou revogar a exceção.
- Concessões e revogações são registradas na auditoria, incluindo responsável, plano, motivo e prazo.
- Lojas com assinatura paga ativa não recebem cortesia redundante.
- Se o acesso expirar e não houver assinatura paga válida, as rotas operacionais voltam a negar acesso.

## Atenção às cobranças anteriores
Uma cortesia **não cancela** uma tentativa ou assinatura que já exista na Stripe. Antes de liberar gratuitamente uma conta que já tentou pagar, confira na Stripe se existem cobranças em aberto ou tentativas de renovação e cancele-as quando apropriado. O sistema não altera cobranças antigas automaticamente.

## Implantação
A implantação do backend adiciona colunas em stores para a concessão excepcional e o frontend expõe a ação em Admin > Contas. Nenhuma loja recebe acesso gratuito sem ação explícita.
