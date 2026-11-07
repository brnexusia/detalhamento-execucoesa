# Importador PDF — PaddleOCR no mesmo serviço do Atacado Shop

O contêiner principal instala PaddlePaddle 3.2.0 (CPU), PaddleOCR 3.7.0
(PP-OCRv6 Small), Poppler e Tesseract. **Não crie outro serviço no EasyPanel**.
Não é preciso informar URL, token, porta pública nem segredo para o OCR.

## Funcionamento

- O scanner continua lendo texto nativo com Poppler, sem executar OCR quando
  os produtos já são recuperados da camada textual do PDF.
- Quando OCR é necessário, o próprio contêiner inicia automaticamente um
  processo Python interno na interface **127.0.0.1:8088**, sem exposição pública.
- O Python carrega os modelos uma vez e atende as páginas sequencialmente.
- Se o processo PaddleOCR estiver indisponível, a importação volta para o
  **Tesseract** de forma automática; nenhum produto é publicado sem revisão.
- O modelo é baixado para a imagem **durante o build do Docker**, para que a
  aplicação não dependa de baixar os pesos na primeira importação.

## Ativação e rollback

Ao publicar a `main` com o Dockerfile padrão do projeto, PaddleOCR estará
ligado por padrão. Para forçar o Tesseract e desabilitar o processo Python,
defina na aplicação:

```env
PDF_OCR_ENGINE=tesseract
```

Para voltar ao Paddle, remova a variável ou defina
`PDF_OCR_ENGINE=paddle` e refaça o deploy/reinicie o serviço.

Não mantenha antigas variáveis `PDF_OCR_SERVICE_URL` e
`PDF_OCR_SHARED_SECRET`; elas não são utilizadas no desenho de contêiner
único. `PDF_OCR_PORT` pode ser alterada somente para outro valor de porta
interna, mas normalmente não é necessária.

## Testes

- `node --test server/scanner-pdf-paddle.test.mjs`
- `npm run test:scanner:pdf`
- Após o build, no log de importação de uma página escaneada, confira
  `[pdf import] OCR page <n> via PaddleOCR`.
- Importar um PDF com texto nativo **não testa** o novo motor; compare também
  um PDF digitalizado ou baseado em imagem.
- Compare saída, tempo total, picos de CPU e memória com
  `PDF_OCR_ENGINE=tesseract`.

**Limites:** a alteração integra o motor de OCR ao processo de importação,
mas não instala o PP-StructureV3/PaddleDetection nem resolve automaticamente
a associação de foto, nome e preço em layouts ambíguos. A extração de imagens
com Poppler/Sharp segue o processo existente. O PaddleOCR dentro do mesmo
contêiner também concorre pela CPU/RAM da aplicação principal, conforme a
decisão de arquitetura adotada para simplificar a operação.


## Coordenadas OCR para associação nome + descrição + preço

Quando PaddleOCR processa uma página escaneada sem produtos legíveis no texto
nativo do PDF, o scanner recebe também linhas com:
- `text`: valor OCR original;
- `box: [xMin, yMin, xMax, yMax]`: retângulo na imagem rasterizada;
- `score`: confiança do OCR.

O módulo `server/scanner-pdf-spatial.mjs` encontra nomes explícitos de produto
e preços em reais, compara proximidade 2D normalizada pela altura dos textos,
respeita separação entre colunas e associa linhas com `Descrição: ...` ao
preço espacialmente mais próximo. Ele não usa simplesmente a ordem das linhas
extraídas. Cada preço pode receber **no máximo um nome** e vice-versa.

O parser `parseBrazilianPrice()` converte `R$ 12,50` para o número `12.5` e
`R$ 1.234,56` para `1234.56`. Valores com separadores incertos (`R$ 1300`,
`R$ 12,0`), totais de pedido e múltiplos preços na mesma linha são rejeitados
em vez de presumidos.

As associações espaciais são apresentadas **para revisão obrigatória**, sem
publicação automática. O scanner conserva produtos já reconhecidos pelo PDF
nativo e não substitui coleções numeradas/looks com parsers especializados.
Sem caixas de coordenadas confiáveis, mantém o processamento legado.

Testes:
- `node --test server/scanner-pdf-spatial.test.mjs`
- `node --test server/scanner-pdf-spatial.integration.test.mjs`
