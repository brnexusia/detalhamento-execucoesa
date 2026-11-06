# ShopVax — importador de catálogos WhatsApp Business

## Escopo
O scanner aceita links `https://wa.me/c/55DDDNUMERO` e também a mensagem compartilhada que contenha esse link. Exemplo: `https://wa.me/c/5511961860913`. O link é um deep link do WhatsApp, **não** um feed público que possa ser raspado como HTML. Sem uma instância Evolution API autenticada, é impossível consultar seus produtos de forma confiável apenas pelo endereço.

A integração usa `POST /business/getCatalog/{instance}` da Evolution API para consultar o catálogo de um número comercial e passar os itens retornados à revisão do ShopVax. Uma conexão ativa e a disponibilidade do catálogo para a instância são pré-requisitos; alguns perfis ou versões da Evolution não retornam todos os produtos.

## Configuração no serviço backend do EasyPanel
Adicionar estas variáveis de ambiente **somente no backend**:

```env
SHOPVAX_WHATSAPP_EVOLUTION_URL=https://SEU_HOST_EVOLUTION
SHOPVAX_WHATSAPP_EVOLUTION_INSTANCE=NOME_DA_INSTANCIA_CONECTADA
SHOPVAX_WHATSAPP_EVOLUTION_API_KEY=CHAVE_DA_API_DA_INSTANCIA
```

A origem deve ser HTTPS pública, sem caminho nem porta personalizada. A instância precisa estar conectada e ser compatível com a leitura de catálogos. **Não colocar chaves no frontend, na URL compartilhada ou no GitHub.** Se não estiver configurado, a API rejeita a tentativa imediatamente com mensagem objetiva e não inicia um job vazio.

## Uso
1. Entre como lojista com acesso ativo no ShopVax, abra **Importar catálogo** e escolha **WhatsApp**.
2. Cole o link completo do catálogo de seu próprio negócio (ou um que tenha autorização para copiar).
3. Clique em **Consultar catálogo WhatsApp**. O backend consulta a Evolution API e salva os candidatos no pipeline existente.
4. Acesse **Revisar**. Nenhum item de origem WhatsApp começa selecionado automaticamente. Confirme títulos, valores e imagens, selecione os itens corretos e só depois publique.
5. Produtos sem preço confirmado ficam com preço ausente para correção manual. Valores numéricos `priceAmount1000` são divididos por 1000 (ex.: `29990` vira R$ 29,99). Valores ambíguos não são convertidos por adivinhação.

## Limitações e proteção
- Não é garantido extrair todos os produtos: há versões da Evolution API com limitações de paginação, acesso por número e imagens. Se faltar alguma imagem ou item, revise manualmente ou use uma exportação autorizada.
- A API externa não é acionada no navegador. O endpoint do backend é fixado pela configuração administrativa; a URL do usuário é validada e só serve para identificar o número do catálogo.
- A requisição externa não segue redirecionamentos, limita a resposta e usa transporte com resolução de endereços públicos, reduzindo riscos de SSRF/vazamento de token.
- Não são gerados produtos fictícios, não há login indevido no WhatsApp de terceiros nem publicação automática.
- A integração não pede a senha pessoal ou QR Code do lojista no formulário de importação.
- Para importação que dependa de credenciais da própria empresa, é necessário providenciar uma instância autorizada específica ou uma integração oficial com o Commerce Manager.

## Testes
`npm run test:scanner:whatsapp` valida links, conversão de valores, chamadas simuladas à Evolution, formato dos candidatos e erros de acesso/configuração.
