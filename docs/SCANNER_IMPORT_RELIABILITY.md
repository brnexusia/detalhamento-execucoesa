# ShopVax — importação de sites, PDFs e WhatsApp com mídia local

## Alterações

- **Publicação:** antes da transação que cria produtos, as imagens remotas dos itens selecionados são baixadas, verificadas e salvas em `media_assets`. A revisão guarda URLs internas `/media/...`; somente depois a publicação grava o produto. A transação do PostgreSQL não fica aberta durante downloads externos.
- **Falhas de imagem:** se o produto possuía imagens externas, mas nenhuma cópia pôde ser salva, a publicação é bloqueada com mensagem de qual produto precisa de correção, sem cadastrar foto quebrada. Fotos secundárias inacessíveis são descartadas e registradas nos logs; imagens locais recuperadas continuam utilizáveis. URLs externas não localizadas não são persistidas no produto novo.
- **PDFs:** imagens extraídas de PDFs já são salvas no banco na fase do scanner. A publicação as reutiliza sem baixar novamente. Preços com vírgula sem `R$` e preços `R$ 49.90` são reconhecidos. OCR limitado revisita páginas suspeitas sem sobrescrever o texto original quando o OCR piora a leitura. Peças com **nome + referência explícitos** mas sem preço ficam em revisão, com preço nulo, para edição humana. Não se fabricam preços.
- **Sites:** quando a página é acessível, mas não expõe produtos de forma extraível (login, vitrine via JavaScript, dados não públicos), o scanner informa isso. Não marca uma extração vazia como concluída.
- **WhatsApp:** mantém UAZAPI `POST /business/catalog/list`, paginação, revisão humana, preços em milésimos e tratamento de fotos externas com o mesmo armazenamento local na publicação.
- **Reparo legado:** reparos de mídias antigas deixam de iniciar três vezes a cada reinício. Para executar sob demanda em um restart controlado, definir `SHOPVAX_IMPORT_MEDIA_REPAIR_ON_STARTUP=1` temporariamente; há trava consultiva PostgreSQL para impedir mais de uma execução simultânea da rotina. Isso não é necessário para importações novas.

## Limites e cuidados

- Esta correção não transforma vitrines privadas nem páginas protegidas por JavaScript em feeds públicos. São necessários um formato exportável autorizado, PDF ou integração específica da plataforma.
- PDFs sem preços, sem referências explícitas e sem OCR útil não permitem identificar itens com segurança. A importação apresenta mensagem objetiva em vez de inventar dados.
- Fotos de WhatsApp podem exigir acesso à CDN: uma URL expirada pode impedir que o item seja publicado com imagem. Corrija/substitua a foto na revisão e tente novamente.
- A preparação de mídia ocorre ao clicar em **publicar**. Grandes catálogos com muitas imagens externas podem demorar mais nessa etapa; a página não deve ser tratada como concluída até receber confirmação do backend. A estratégia futura para catálogos extremamente grandes é mover o preparo para um worker dedicado, preservando a mesma validação.
- A tabela `media_assets` continua armazenando as imagens no banco. Não há migração para S3/R2 nesta mudança. Para milhares de lojas, avaliar object storage para reduzir crescimento do PostgreSQL.
- A rotina de reparo antigo não foi apagada; foi tornada opt-in para reduzir deadlocks.

## Regressões adicionadas

- `npm run test:scanner:pdf` — layout, OCR/precificação, itens referenciados sem preço
- `npm run test:scanner:collector` — sites com e sem produtos extraíveis
- `npm run test:scanner:media` — imagens locais antes de publicar, falhas sem gravar produto quebrado
- `npm run test:scanner:whatsapp` — UAZAPI e seu schema/paginação/preços
- `node server/import-media-localizer.test.mjs` — download e deduplicação de imagens
- `node server/scanner-module5.integration.mjs` e `node server/scanner-parent-product.integration.mjs` — publicação, agrupamento, concorrência e idempotência

Os testes não substituem uma homologação com **o mesmo site, PDF e catálogo WhatsApp** que apresentaram falhas em produção. A UAZAPI exige token de instância conectado no serviço backend.
