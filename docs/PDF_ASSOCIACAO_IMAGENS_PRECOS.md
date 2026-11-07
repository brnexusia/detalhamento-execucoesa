# Associação de fotografias, referências e preços — Atacado Shop

O importador continua **um serviço Node no EasyPanel**. A imagem Docker contém
Poppler, Sharp e Tesseract (português + inglês). Não instala PaddlePaddle, Python
ou modelos de OCR em memória. O endpoint de upload em partes segue inalterado.

## Ordem das evidências

1. **Número exato + grupo de páginas (lookbook):** o parser existente encontra
   `01 R$ 15,00`, associa a referência `01` à seção correta e tenta extrair
   uma fotografia do quadro de detalhes com `BRINCO 01`, `BOLSA 01` etc.
   Quando o quadro não fornece uma fotografia individual, a nova etapa procura
   o número `1` sobre a fotografia na mesma página de preços e recorta
   sua vizinhança. O mesmo número em outro look é uma referência diferente,
   porque a chave inclui o número da **página de preços**.
2. **Nome + preço por posição (outras páginas):** o Poppler extrai caixas
   de texto `[xMin, yMin, xMax, yMax]`. Para páginas com 2 a 10
   candidatos, tenta localizar o nome de cada um e todos os preços em BRL.
   Apenas quando há correspondência única um-a-um e nenhum concorrente próximo
   o preço pode ser associado por proximidade na mesma coluna.
3. **Fotografias em grade:** com imagem incorporada e nomes posicionados
   sob cada coluna, sugere um recorte acima do respectivo título, delimitando
   a coluna pelos vizinhos. Não inventa correspondência em páginas sem
   evidência geométrica.
4. **Tesseract:** para páginas sem camada textual, usa a saída TSV (caixas
   de cada palavra) e o parser BRL estrito existente. Valores como
   `R$ 1300` ou `R$ 12,0` seguem para revisão, nunca viram preços
   inferidos.

## Segurança e qualidade

- Quando há dois números iguais sobre a mesma fotografia ou concorrentes
  de preço muito próximos, **não cria vínculo automático**.
- Recortes da fotografia por marcador ou proximidade são **sugestões**
  para revisão, não reconhecimento de objetos. Podem conter elementos
  próximos ao produto. São sempre marcados `pdf_review_required=true`.
- A referência do catálogo original, o preço impresso e a página origem
  permanecem rastreáveis nos dados e na descrição do candidato.
- Em PDF com bom texto nativo, não gasta CPU aplicando OCR nas páginas
  puramente fotográficas.
- Não publica produtos automaticamente. O fluxo normal de revisão e os
  bloqueios do scanner continuam valendo.
- O parser antigo e o recorte conhecido dos quadros `CORES DISPONÍVEIS`
  continuam funcionando.

## Testes

- `npm run test:scanner:pdf` — regressões existentes, mais associação
  visual e um PDF sintético com dois looks e grade multi-produto.
- `node --test server/scanner-pdf-visual-association.test.mjs`
- `node --test server/scanner-pdf-visual.integration.test.mjs`
- Após o deploy da `main`, `GET /health` mostra
  `ocr: {engine: "tesseract", ready: true}`. Não existe
  serviço privado de PaddleOCR.
- Reprocessar os catálogos originais em modo de revisão e comparar
  contagem, valores, qualidade e identidade das fotos individualmente
  antes de declarar uma taxa de acerto superior.
