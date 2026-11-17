# MAMA — auditoria dos 21 álbuns públicos Google Photos

Data da análise dos resultados: 17/11/2026. Origem: execução **TEMP MAMA validate FIXED OCR on every photo**, de 16/11/2026, [GitHub Actions #43805608653](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/43805608653), com **84 artefatos por álbum/shard**. Base de comparação: [execução #43804969033](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/43804969033), arquivo `mama-all-photo-baseline/baseline.json`.

> Os números são resultados da extração automática de imagens reais, **não** conferência humana de que cada valor, nome ou SKU corresponde à etiqueta. Uma execução de CI aprovada significa que o script executou; não garante 100% de precisão comercial.

| Nº | Álbum | Fotos lidas | Preços detectados | Sem preço | Nomes extraídos |
|---:|---|---:|---:|---:|---:|
| 1 | Catálogo Verão | 289 | 277 | 12 | 164 |
| 2 | Lenços de Verão | 296 | 281 | 15 | 280 |
| 3 | Broches e Chaveiros | 168 | 167 | 1 | 163 |
| 4 | Brincos | 300 | 293 | 7 | 293 |
| 5 | Colares - Aros | 144 | 137 | 7 | 144 |
| 6 | Colares e Maxi Colares | 285 | 280 | 5 | 285 |
| 7 | Colares Verniz | 25 | 24 | 1 | 23 |
| 8 | Pulseiras e Braceletes | 300 | 296 | 4 | 299 |
| 9 | Chokers e Colares Delicados | 300 | 289 | 11 | 292 |
| 10 | Anéis | 191 | 178 | 13 | 191 |
| 11 | Cintos | 300 | 298 | 2 | 294 |
| 12 | Acessórios Cabelo Infantil | 300 | 299 | 1 | 295 |
| 13 | Catálogo Country | 61 | 61 | 0 | 45 |
| 14 | Acessórios Cabelo Adulto | 300 | 284 | 16 | 67 |
| 15 | Acessórios Masculinos | 106 | 104 | 2 | 92 |
| 16 | Bolsas e Necessaires | 300 | 300 | 0 | 230 |
| 17 | Copos e Porta-joias | 59 | 59 | 0 | 7 |
| 18 | Brasil Core | 18 | 18 | 0 | 12 |
| 19 | Catálogo Inverno | 130 | 112 | 18 | 69 |
| 20 | Catálogo Inverno Infantil | 70 | 68 | 2 | 22 |
| 21 | Festa Junina | 38 | 38 | 0 | 36 |
| **Total** | **21 álbuns** | **3.980** | **3.863 (97,06%)** | **117** | **3.303 (82,99%)** |

- Todas as 3.980 fotos enumeradas foram baixadas e decodificadas no ensaio; 0 erros de download.
- A versão anterior reconheceu 3.790 preços e deixou 190 ausentes. A versão corrigida aumentou o número de preços extraídos em **73**, chegando a 3.863.
- Embalagem/quantidade detectada em 3.942 imagens; 38 sem informação identificada.
- Há **117 fotos com preço não detectado** e **677 sem nome de etiqueta**. Algumas contêm etiquetas pequenas que não foram reconhecidas; outras podem não ter etiqueta legível. Devem ficar em revisão, não ganhar preço ou nome inventado.
- Os artefatos da execução guardam a identificação de cada foto, o valor extraído e pranchas de miniaturas dos preços faltantes para auditoria manual.

## SKU e descrição

Os 84 artefatos originais **não capturavam SKU nem descrição como campos de OCR**, portanto é incorreto afirmar que esses atributos foram validados foto a foto com a mesma cobertura dos preços.

O código passa a copiar **SKU apenas se o OCR encontrar identificador explícito** `SKU`, `REF`/`REFERÊNCIA` ou `CÓDIGO` seguido de referência inequívoca. Dois códigos conflitantes permanecem sem SKU. Não se cria SKU baseado em índice de fotografia. A integração preserva esse valor no candidato e no campo `normalized.sku`. Sua eficácia nas 3.980 fotos não foi medida nesta execução histórica.

A descrição continua **restrita ao que a etiqueta fornece**: quando detectada a quantidade, registra "Quantidade indicada na etiqueta: ... Confira antes de publicar." Outras características não são inventadas; campos ausentes são encaminhados à revisão. Na etapa de normalização, ausência de SKU e de descrição gera marcadores `missing_sku` e `missing_description`, respectivamente.

## Regras de publicação segura

- Um preço com unidade e desconto por dúzia não pode ser confundido com o preço de uma unidade.
- Se existem dois preços unitários diferentes, não escolher arbitrariamente.
- Preço `R$ 700` sem centavos explícitos **não equivale** a `R$ 7,00`.
- Item de foto sem preço ou nome comprovado **continua sendo revisão manual**, não um produto considerado pronto para publicação.
- Uma contagem de "preços reconhecidos" mede **cobertura de extração**, não acurácia verificada visualmente.

## Fontes e reprodutibilidade

Lista canônica das 21 URLs públicas: [`scripts/mama-public-album-links.mjs`](../scripts/mama-public-album-links.mjs). Os dados coletados foram segmentados em 84 artefatos `mama-fixed-<índice>-<shard>` no [run #43805608653](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/43805608653); referência anterior no [run #43804969033](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/43804969033). Nenhum dado do banco de produção foi alterado durante esse ensaio.


## Revalidação posterior — preço faltante e valores falsos (17/11/2026)

Execução integral de comparação: [GitHub Actions #44123176031](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/44123176031), 84 lotes concluídos, 21 álbuns, **3.979 fotos enumeradas**, **3.883 preços detectados**, **96 sem preço**, **zero erros de download**. O total difere em uma fotografia da auditoria anterior, pois o Google Photos retornou 299 imagens no álbum Brincos (antes 300). O resultado é detecção automática, **não conferência manual de cada preço**.

Foram inspecionadas visualmente as pranchas das 96 imagens. Há fotos sem etiqueta aparente e fotos com preço visível que o OCR perdeu. Exemplo verificado nas imagens originais: **Anéis #45 = R$ 7,00**, mas Tesseract leu `R$ 700` (sem vírgula); o recorte exato da linha com ampliação permitiu ler `R$ 7,00` em teste local. Outro exemplo: **Lenços de Verão #29 = R$ 17,00**, enquanto uma tentativa de recuperação retornou indevidamente `R$ 1,00`; esse valor está **errado** e não pode ser aceito.

Correções no código do ShopVax:
- Mais recortes de OCR para etiquetas minúsculas e preços em diferentes posições; recorte secundário focado na linha monetária detectada, sem inventar vírgulas.
- Nova leitura da imagem WebP para campos incompletos, preservando conflitos em revisão.
- Proteção contra preços recuperados incompatíveis com dígitos reconhecidos na foto original (por exemplo, `1700` contra `1,00`).
- Testes regressivos para preços ilegíveis, conflitos e preservação da pontuação; nenhuma alteração nos fluxos n8n da Mama.

A reexecução dos 96 casos com o recorte de linha está em [#44130389371](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/44130389371). Não converter todo resultado ausente em preço e não declarar 100% de precisão até confirmar visualmente valores recuperados, revisar as fotos restantes e conferir implantação em produção.
