# ShopVax — auditoria do scanner por tecnologias diferentes (06/11/2026)

## Contagem correta

Uma URL diferente não é um motor diferente. O corpus de **155 domínios públicos** encontrado na análise se divide em apenas **8 plataformas declaradas**: Nuvemshop (25), Shopify (25), Tray (25), VTEX (25), Loja Integrada (25), WooCommerce (25), FácilZap (4), GoPage (1). A plataforma de origem é uma classificação prévia e **não equivale a uma assinatura HTML/JS confirmada**.

O novo `scanner-architecture-fingerprint.mjs` identifica motor, frontend e feed quando há evidência de HTML. O relatório usa `engine` como unidade de diversidade; `architectureKey` fornece a comparação mais fina sem multiplicar motores por domínio. O script `scanner-architecture-audit.mjs` executa o coletor real em sites públicos por motor, sem publicar produtos:

```bash
node server/scanner-architecture-audit.mjs sites.json relatorio.json
# Para testar todos os domínios em vez de um por motor:
node server/scanner-architecture-audit.mjs sites.json relatorio-todos.json --all
```

`sites.json` deve ser um array de objetos `{ "url": "...", "platform": "..." }`. O script limita a 200 entradas, não transmite credenciais, não faz checkout, não usa contas privadas, limita páginas/produtos por domínio e registra: engine detectado, frontend, feed, quantidade de candidatos, preços, fotos, status HTTP, erros. **Um site com HTML público acessível não conta como importação aprovada.**

## Motores e caminhos distintos

- Nuvemshop e Loja Integrada: sitemap de produtos e enriquecimento de variações;
- Shopify: `products.json` e fallback genérico;
- WooCommerce: REST `wp-json` e fallback;
- Tray: API pública e fallback;
- FácilZap: runtime/paginação própria e fallback;
- Vesti e Braavo: coletores especializados;
- GoPage: reconhecida por domínio/assinatura própria e passada pelo coletor genérico; **ainda requer teste real com produtos completos**;
- VTEX: API pública `/api/catalog_system/pub/products/search`, até 20 produtos por página, preços em unidades da moeda por `items[].sellers[].commertialOffer.Price`, imagens/variações e fallback para HTML se a API estiver indisponível;
- Magento, BigCommerce, Wix, Squarespace, PrestaShop, OpenCart, ZapFácil: assinatura identificada para testes de diversidade; **não têm importador dedicado garantido**. A compatibilidade depende de JSON-LD, HTML público ou integração futura.

Referências públicas: VTEX Search API https://developers.vtex.com/docs/api-reference/search-api; GoPage https://gopage.bio/.

## Google Photos

O scanner já tinha importação de álbuns públicos por link `photos.app.goo.gl` / `photos.google.com/share`, validação de URLs de imagem Google, download de bytes, conversão WebP e persistência `/media/...` no banco da loja; os candidatos ficam SEM PREÇO para revisão humana.

Melhoria: caso o HTML público exponha apenas a capa mas links `/share/.../photo/...` de fotos individuais, consultar detalhes públicos **do mesmo álbum** com até quatro requisições simultâneas. Não reutiliza links de outro álbum, não passa por login, não trata miniatura como catálogo completo. Se alguma foto pública necessária falhar ou o fallback individual exceder 1.000 links, o trabalho falha com mensagem objetiva em vez de declarar catálogo incompleto aprovado.

Os testes de 10.000 itens **são simulados com encoder falso**, não uma leitura real de 10.000 fotos. A API Google Photos não autoriza listar livremente álbuns privados/compartilhados de terceiros. Álbuns que exigem autenticação precisam de fluxo autorizado pelo proprietário ou exportação.

## PDFs de empresas no Drive

- Inventariados: 97 arquivos PDF, incluindo 22 documentos não classificados como catálogos comerciais.
- 62 nomes normalizados distintos: **não** é deduplicação por hash, apenas sinal de possíveis cópias.
- 9 arquivos PDF reais passaram por `pdfinfo` e `pdftotext` localmente. Isso comprova texto/volumes, **não** valida produtos correspondentes, preços e fotos.
- Novidade: catálogos com linhas explícitas `Shampoo ... 300ml`, `Máscara ... 450g`, etc., sem preço disponível, produzem itens em revisão, com preço ausente, e não são descartados por completo.
- Bloqueio atual: `MAX_PDF_BYTES=100 MiB`; alguns PDFs do Drive têm mais de 100 MiB (incluindo arquivos acima de 180 MiB) e devem ser reduzidos ou processados em ambiente/fluxo próprio. Não aumentar o limite sem avaliar memória do serviço, persistência e timeout.
- PDFs que só contêm imagens requerem OCR e conferência visual item a item. Não inventar preço nem vincular imagem errada.

## Testes e estado

**Verificado nesta execução:** análise estática de sintaxe dos arquivos alterados, execução isolada de classificadores e parser de itens sem preço com entradas simuladas. Testes automatizados adicionados a `ci.yml`:
```bash
npm run test:scanner:pdf
npm run test:scanner:albums
npm run test:scanner:architectures
npm run test:scanner:vtex
npm run test:scanner:collector
npm run test:scanner:whatsapp
npm run test:scanner:media
```

**Não comprovado nesta sessão:** CI completo da plataforma, execução real do scanner no backend ShopVax, extração produto a produto dos 97 PDFs, importação real de álbuns Google Photos e 100–200 motores distintos. Não publicar produtos de clientes durante homologação; usar loja de testes e revisar as diferenças por item.

O inventário detalhado de URLs e PDFs está no relatório local criado para o usuário; não publicar informações privadas dos PDFs ou conteúdo dos clientes neste repositório público.
