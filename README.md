# Atacado Shop

MVP enxuto de catálogo para atacado com dois modos de compra: loja tradicional e feed vertical. O comprador monta o carrinho e envia o pedido para a vendedora responsável pelo link da loja no WhatsApp.

## Princípio do produto

**Catálogo + Feed + Carrinho + Vendedora.**

Sem checkout, gateway de pagamento ou cadastro obrigatório do comprador na V1.

## URL comercial

`/{empresa}/{vendedora}`

Exemplo: `/suprema-line/karina`

A vendedora fica atribuída à sessão e recebe o pedido no WhatsApp.

## Rodar localmente

```bash
npm install
npm run dev
```

## Escopo da primeira versão

- vitrine responsiva;
- categorias e busca;
- feed vertical com scroll snap;
- carrinho compartilhado entre loja e feed;
- pedido mínimo com progresso;
- link rastreável por vendedora;
- envio do resumo do carrinho para WhatsApp;
- sem checkout online.

A interface foi pensada para parecer varejo/atacado real, com linguagem visual editorial e poucos componentes, evitando aparência de dashboard genérico ou template de IA.
