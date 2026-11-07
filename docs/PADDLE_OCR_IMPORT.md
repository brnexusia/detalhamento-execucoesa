# PaddleOCR no importador PDF — instalação experimental

O Atacado Shop continua extraindo a camada de texto nativa do PDF com Poppler.
Para páginas digitalizadas cuja leitura de texto precisa de OCR, o scanner pode
chamar o **PaddleOCR PP-OCRv6 Small (CPU)** em um serviço interno. Se o serviço
estiver indisponível, o Tesseract original continua funcionando.

## 1. Publicar um serviço privado no EasyPanel

Usar o MESMO repositório, mas com o caminho de Dockerfile `Dockerfile.paddle-ocr`
para criar um **serviço de OCR distinto**, sem domínio público. Porta interna:
`8088`. O contêiner instala PaddlePaddle CPU 3.2.0 e PaddleOCR 3.7.0;
na primeira inicialização poderá baixar os modelos oficiais e consumir mais
memória. Evite colocá-lo no serviço web atual.

Configurar a variável do serviço PaddleOCR:

```env
PDF_OCR_SHARED_SECRET=<segredo-aleatorio-de-pelo-menos-16-caracteres>
PDF_OCR_PORT=8088
```

O segredo deve ser longo e gerado aleatoriamente. Não versionar segredos.
O serviço usa uma requisição por vez para limitar concorrência. Limitar CPU
no EasyPanel (por exemplo 0,5–1 vCPU inicialmente, ajustando por métricas) e
monitorar RAM, tempo de fila, latência do site e erros.

## 2. Configurar o serviço web/API

Adicionar variáveis ao SERVIÇO WEB (não no navegador):

```env
PDF_OCR_ENGINE=paddle
PDF_OCR_SERVICE_URL=http://NOME_INTERNO_DO_SERVICO:8088
PDF_OCR_SHARED_SECRET=<mesmo-segredo-do-servico-paddle>
```

Substituir `NOME_INTERNO_DO_SERVICO` pelo host DNS privado real da rede do
EasyPanel. Usar rede privada; não expor a porta 8088 ao público. O serviço
aceita apenas requisições com o segredo. Reiniciar o serviço web após ajustar
as variáveis.

Para desativar/reverter imediatamente: `PDF_OCR_ENGINE=tesseract` ou remover
`PDF_OCR_ENGINE`. A versão antiga do OCR permanece instalada no contêiner web.
Se o serviço PaddleOCR falhar ou devolver texto vazio, o scanner utiliza
Tesseract como fallback (registrado nos logs).

## 3. Testar

- `node --test server/scanner-pdf-paddle.test.mjs`
- `npm run test:scanner:pdf`
- Fazer upload de um catálogo **digitalizado ou imagem-only**; arquivos com
  camada de texto confiável passam direto pelo Poppler, sem acionar OCR.
- Verificar nos logs web: `[pdf import] OCR page ... via PaddleOCR`.
- Comparar identificação de nome e preço, duração, CPU, RAM e contagem total
  com o modo `PDF_OCR_ENGINE=tesseract`, sem alterar produtos publicados.

**Limitação importante:** este teste integra o motor de OCR ao fallback de
páginas escaneadas. Ele NÃO substitui o parser de catálogos numerados,
NÃO implementa PaddleDetection / PP-StructureV3 nem associa automaticamente
fotografias a nomes e preços em layouts ambíguos. Isso exige um segundo módulo
de layout/associação validado por páginas e coordenadas. Também preserva o
comportamento atual de pular páginas exclusivamente fotográficas em
catálogos mistos para evitar falsos produtos.

## Segurança e isolamento

- O endpoint aceita até 8 MiB de PNG e opera em instância de OCR independente.
- Não exponha o serviço PaddleOCR via proxy público e nunca informe seu token
  no frontend.
- O worker espera modelos inicializados antes de servir; o primeiro boot pode
  ser demorado se os downloads oficiais estiverem lentos.
- A importação continua sujeita aos limites de páginas, tempo e extração já
  existentes no projeto; habilitar OCR mais robusto NÃO garante precisão
  comercial de 100% em catálogos sem informações suficientes.
