# ShopVax — importação de catálogo WhatsApp via UAZAPI

## Contrato verificado

O ShopVax recebe links públicos no formato `https://wa.me/c/55DDDNUMERO` (inclusive texto compartilhado que contenha o link). O endereço do WhatsApp não expõe sozinho o catálogo como HTML, então a leitura ocorre por uma **instância UAZAPI conectada**.

Conforme o contrato UAZAPI 2.6.9, o backend faz:
`POST /business/catalog/list` com header `token: <TOKEN_DA_INSTANCIA>` e JSON `{"jid":"5511961860913@s.whatsapp.net"}`. Cada página retorna `{"response":{"products":[...],"next":"..."}}`. A próxima chamada envia o mesmo `jid` e `after` com o cursor opaco retornado em `response.next`. Não há necessidade de informar nome/ID da instância na rota, apenas sua credencial.

Fonte: https://docs.uazapi.com/openapi-bundled.json (operação getCatalog e schemas BusinessCatalogPage / BusinessProduct).

## Configuração no EasyPanel (backend shopvax)

```env
SHOPVAX_WHATSAPP_UAZAPI_URL=https://SEU_SERVIDOR_UAZAPI
SHOPVAX_WHATSAPP_UAZAPI_TOKEN=TOKEN_DA_INSTANCIA_CONECTADA
```

A URL precisa ser a origem HTTPS pública da UAZAPI, sem path nem porta extra. O token é **da instância**, não o `admintoken`. Não enviar credenciais ao navegador nem armazená-las no GitHub. Estas duas variáveis substituem definitivamente `SHOPVAX_WHATSAPP_EVOLUTION_URL`, `SHOPVAX_WHATSAPP_EVOLUTION_INSTANCE` e `SHOPVAX_WHATSAPP_EVOLUTION_API_KEY`.

## Como importar

1. Abra **Importar catálogo → WhatsApp** no ShopVax.
2. Cole o link `https://wa.me/c/5511961860913` (da loja que você pode importar).
3. Clique em **Consultar catálogo WhatsApp**.
4. O backend consulta e pagina os itens via UAZAPI, normaliza nomes, descrição, referência, preço e fotos disponibilizadas, e envia todos para **Revisão**.
5. Selecione os produtos e confira os dados antes de publicá-los no ShopVax. Nenhum produto é selecionado ou publicado automaticamente.

## Preços e fotos

O campo `price` e `sale_price.price` são strings numéricas inteiras expressas em **milésimos**. Por exemplo, `"29990"` significa R$ 29,99, e não R$ 299,90. Se não houver preço confiável, o produto fica sem preço e exige revisão manual.

As imagens vêm do array `media.images`, usando `original_image_url` e, quando necessário, `request_image_url`. Alguns endereços podem expirar ou deixar de estar acessíveis; revise as fotos antes de publicar.

## Falhas e segurança

- O scanner só consulta um endpoint fixo de UAZAPI configurado pelo servidor. O usuário informa o telefone, não um destino de API arbitrário.
- A consulta usa o transporte existente com validação de IP público, limite de tamanho, timeout e **sem seguir redirecionamentos**.
- Respostas com schema inválido, token recusado, cursor repetido ou falha de paginação abortam o trabalho, sem importar parcialmente.
- Não inventa fotos, preços ou produtos; não publica automaticamente.
- O sistema limita a consulta a 40 páginas de até 50 itens cada (2 mil itens); importações maiores precisam de estratégia própria.
- A UAZAPI precisa conseguir consultar o catálogo da loja a partir da instância autorizada. Disponibilidade real de itens e imagens depende da conta WhatsApp e da própria UAZAPI.
- O código e os testes unitários foram alterados. Teste de integração em ambiente com instância real é necessário antes de afirmar que o catálogo do número fornecido foi capturado.

## Testes

`npm run test:scanner:whatsapp` verifica validação do link, chamada `POST /business/catalog/list`, token, `jid`, paginação por `after`, preços em milésimos, imagens, campos ausentes e falhas de autenticação.
