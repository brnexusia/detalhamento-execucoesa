# Atacado Shop / ShopVax — Observações históricas de UX

> Conteúdo oriundo de `Atacado shop ux.md` enviado anteriormente ao Google Drive. Observações para verificar **apenas se ainda forem aplicáveis**, sem substituir o design de redesign oficial e sem transformar sugestões comerciais (como depoimentos ou período de teste) em funcionalidades aprovadas. Número demonstrativo e nome demonstrativo suprimidos por cautela de privacidade.

Pontos de atenção

Tela inicial de login

Contraste do CTA secundário "Ver loja demo" — o roxo/lilás do sublinhado destoa da paleta preto/laranja/terracota usada no resto (tag "CATÁLOGO PARA ATACADO" e no texto). Ou ele é proposital como "cor de link", ou vale trocar para laranja/terracota pra manter consistência de marca.

Espaço em branco excessivo entre o hero e os cards de features — está com um respiro grande demais (parece ~150-180px). Para quem rola a página, pode dar impressão de que a página "acabou" antes de chegar nos cards. Reduzir esse gap ajuda a manter o fluxo de leitura.

Falta prova social / urgência acima da dobra — para o público de atacado (que costuma ser mais cético e comparar fornecedores/ferramentas), um número, depoimento curto ou "grátis por 7 dias" perto do CTA aumentaria a conversão.

______________________________________________________________

Tela início 

Hierarquia entre "Loja publicada" e o link poderia ser mais forte — hoje o texto "Loja publicada" (que é uma informação de status, boa notícia!) tem o mesmo peso visual do link em si. Um badge verde tipo "● Publicada" ao lado do título ajudaria a comunicar status num piscar de olhos, sem precisar ler.

Espaço vazio grande à direita do card "Últimos pedidos" — como não há pedidos ainda, o card fica com bastante espaço morto. Poderia ter uma ilustração simples ou CTA ("Adicione produtos para começar a vender") pra não parecer "quebrado" ou incompleto.

UMA COISA MUITO IMPORTANTE, O TAMANHO DAS FONTES ESTÃO PEQUENOS DEMAIS, TALVEZ AUMENTAR UM POUCO, SOBRE TUDO.

Pedido mínimo e endereço citados no passo 1, mas não há indicação de onde configurar frete/forma de pagamento — para o nicho de atacado, isso costuma ser crítico (pedido mínimo por CNPJ vs pessoa física, por exemplo). Se já existe em "Minha loja", ok, sóReforço que vale garantir que fique bem visível.

______________________________________________________________

Minha Loja

Campo "Chamada da capa" está em fonte monoespaçada, destoando de todos os outros campos (que usam sans-serif). Parece bug de estilo, não intencional — provavelmente herdou uma classe CSS errada de textarea.

"Logo (URL)" só aceita link, sem upload de arquivo — para lojista de moda/atacado, pedir que ele já tenha a logo hospedada em algum link é fricção alta. A maioria vai ter o arquivo no celular/computador, não uma URL pronta. Vale um upload direto (com um serviço de storage por trás) ou pelo menos instrução clara de "como conseguir uma URL" (ex: link do Google Drive, Imgur).

Não há preview da logo nem da cor aplicada na loja — o usuário está configurando a identidade visual "às cegas", sem ver o resultado. Um mini preview do cabeçalho da loja (como ficaria com aquela cor + logo) ao lado do formulário reduziria erro e ida-e-volta.

"WhatsApp padrão" sem máscara/formatação — o número aparece cru ([número de exemplo omitido]), sem indicar DDI, DDD, ou separadores. Fácil de digitar errado (esquecer o 9, trocar DDD) sem perceber. Uma máscara tipo +55 (11) 99197-2120 com validação evita pedido indo pro número errado — que seria bem grave nesse produto.

"Pedido mínimo" sem símbolo de moeda — está só "400", sem "R$" visível no campo. Pode parecer óbvio pro dono, mas um campo monetário sem indicador de moeda é uma inconsistência de formulário que passa despretensão.

Desbalanceamento entre as duas colunas — "Identidade" tem 5 campos e ocupa até o fim, enquanto "Venda" + "Endereço" juntos ficam com menos conteúdo e uma quebra (divisor horizontal) que corta o card de forma um pouco abrupta. Vale ajustar o grid (ex: 3 colunas, ou redistribuir Endereço pra ficar mais equilibrado com Identidade).

Botão "Salvar alterações" fica solto no canto inferior direito, sem barra fixa (sticky) — se o formulário crescer (mais campos de endereço completo, redes sociais, etc.), o usuário pode perder de vista o botão ou ter que rolar a página inteira pra salvar. Um footer fixo com o botão resolve isso.

Nenhum feedback de "alterações não salvas" — se o [usuário demonstrativo] editar um campo e sair da página sem salvar, ele perde a mudança sem aviso. Um indicador simples (ex: botão muda de "Salvar alterações" para destacado/pulsando quando há mudança pendente, ou um toast de confirmação ao salvar) evita perda de dados silenciosa.

______________________________________________________________

Feed

Precisa aparecer a seta de rolagem para baixo 


