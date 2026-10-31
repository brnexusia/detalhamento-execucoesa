# Atacado Shop — Diretrizes de produto e preços (transcrição do PDF)

> Transcrição pesquisável do conteúdo textual do arquivo original enviado pelo usuário. Não é o PDF original: elementos gráficos, diagramas, vetores e imagens embutidas não estão preservados neste Markdown. Fonte: Atacado_Shop_Diretrizes_Produto_e_Precos(1).pdf.
> Em caso de divergência, a referência original e decisões posteriores explicitamente aprovadas prevalecem. Não utilizar preços/limites históricos para sobrescrever parâmetros atuais.



---

## Página 1 de 6


Atacado Shop - Diretrizes de Produto e Precificacao | 29/08/2026 Pagina 1
ATACADO SHOP
Diretrizes de Produto, Planos e Posicionamento
Documento de referencia do projeto
Decisoes consolidadas para produto, precificacao, escopo e roadmap.
Data da consolidacao 29 de agosto de 2026
Repositorio oficial brnexusia/detalhamento-execucoesa
Branch principal main
Posicionamento Catalogo de atacado orientado a vendas pelo WhatsApp
Principio central
O Atacado Shop nao pretende ser um ERP. Ele deve organizar a vitrine, transformar interesse em um pedido
pronto para o WhatsApp e mostrar ao lojista o que esta gerando intencao de compra.


---

## Página 2 de 6


Atacado Shop - Diretrizes de Produto e Precificacao | 29/08/2026 Pagina 2
1. Posicionamento e precificacao
O produto compete diretamente com plataformas de catalogo digital para vendas via WhatsApp, com foco
especial em atacadistas, distribuidores, fabricas e operacoes com equipe de vendas.
Plano Atacado Shop Vendedoras Produtos Catalogos Clientes / Pedidos
Bronze R$ 49,90/mes 5 500 1 Ilimitados
Prata R$ 94,90/mes 15 2.000 Ate 3 Ilimitados
Ouro R$ 144,90/mes Ilimitadas Ilimitados Ilimitados Ilimitados
Ciclos de cobranca
Mensal: preco cheio. Semestral: 5% de desconto. Anual: 15% de desconto.
Plano Mensal Semestral -5% Anual -15% Equiv. mensal no anual
Bronze R$ 49,90 R$ 284,43 R$ 508,98 R$ 42,42
Prata R$ 94,90 R$ 540,93 R$ 967,98 R$ 80,67
Ouro R$ 144,90 R$ 825,93 R$ 1.478,98 R$ 123,25
Benchmark competitivo
O FacilZap anunciou para 01/09/2026 os precos de R$ 69 (Bronze), R$ 129 (Prata) e R$ 199 (Ouro). A
estrutura acima mantem o Atacado Shop aproximadamente 26%-28% abaixo dessa referencia, preservando
uma margem competitiva sem posicionar o produto como opcao de baixo valor.
Fonte consultada: facilzap.com.br/noticias - anuncio publicado em 18/08/2026.


---

## Página 3 de 6


Atacado Shop - Diretrizes de Produto e Precificacao | 29/08/2026 Pagina 3
2. As 5 features centrais do produto
A comunicacao comercial e o desenvolvimento devem permanecer concentrados nestes cinco pilares.
Recursos que nao reforcem diretamente essa proposta devem ser tratados como secundarios ou roadmap.
1. Catalogo
inteligente
Produtos, categorias, variacoes, fotos, precos e estoque basico. O estoque
deve poder ser ativado ou desativado por produto/variacao e ter
movimentacao simples de entrada, baixa e retorno.
2. Atacado + varejo Multiplos catalogos usando a mesma base de produtos e o mesmo estoque,
mas com precos, pedido minimo, visibilidade e condicoes diferentes por
catalogo.
3. Venda pelo
WhatsApp
O cliente navega, monta o carrinho e finaliza enviando o pedido estruturado
para o WhatsApp. O Atacado Shop nao processa a venda financeira; ele
organiza e encaminha a intencao de compra.
4. Equipe de
vendas
Links individuais por vendedora, atribuicao de origem, performance por
link/vendedora e comissao opcional. A comissao e apenas calculada; nao
existe pagamento ou folha dentro da plataforma.
5. Inteligencia
comercial
Metricas reais do comportamento no catalogo: visualizacoes, cliques,
carrinho, inicio de checkout e ida para o WhatsApp. O objetivo e mostrar
quais produtos, catalogos e vendedoras geram mais intencao.
O que nao faz parte do escopo agora
PDV, integracoes externas, API, webhooks, pagamento online processado pela plataforma, rastreamento
logistico, emissao fiscal e ERP completo ficam fora do escopo atual.


---

## Página 4 de 6


Atacado Shop - Diretrizes de Produto e Precificacao | 29/08/2026 Pagina 4
3. Inteligencia comercial: os 5 relatorios
Como a conclusao da negociacao ocorre no WhatsApp, o Atacado Shop nao deve apresentar faturamento,
ticket medio ou venda concluida como se fossem metricas confirmadas. Os relatorios devem medir o que a
plataforma realmente observa.
Relatorio O que mede Exemplos de metricas
Performance dos itens Quais produtos despertam mais interesse.Views, cliques, adicoes ao carrinho, idas ao WhatsApp, taxa de interesse.
Performance dos links Quais links geram mais navegacao e intencao. Acessos, carrinhos, checkouts iniciados, cliques para WhatsApp.
Performance das vendedorasResultado comercial atribuivel a cada link individual. Acessos, carrinhos, pedidos enviados ao WhatsApp e conversao por vendedora.
Performance dos catalogos Comparacao entre atacado, varejo ou outros catalogos. Views, engajamento, carrinhos e cliques para WhatsApp por catalogo.
Funil ate o WhatsApp Onde o visitante avanca ou abandona. Acesso > produto > carrinho > checkout > clique no WhatsApp.
Regra de interpretacao
Clique em "Finalizar no WhatsApp" deve ser tratado como intencao / lead / pedido enviado ao WhatsApp,
nunca como faturamento confirmado. Essa diferenca precisa existir na interface, nos relatorios e na
comunicacao comercial.
Comissao de vendedoras
A comissao entra como recurso opcional nos planos superiores. Pode ser configurada por percentual ou valor
fixo. O sistema apenas calcula uma estimativa com base nos pedidos/intencoes atribuiveis; nao executa
repasse financeiro.


---

## Página 5 de 6


Atacado Shop - Diretrizes de Produto e Precificacao | 29/08/2026 Pagina 5
4. Estoque, entrega e roadmap
Estoque basico - entra no radar de implementacao
O estoque inicial deve ser deliberadamente simples: quantidade por produto ou variacao, opcao de
ativar/desativar controle, baixa ao registrar o pedido e retorno quando aplicavel. Multiplos catalogos
compartilham o mesmo estoque fisico. Nao entram agora multiplos depositos, custo medio, entrada fiscal,
fornecedores ou logistica de armazem.
Frete automatico - nao entra agora
A cotacao automatica de frete e tecnicamente viavel, mas cria dependencias de peso, altura, largura,
comprimento, embalagem, consolidacao de volumes, origem, destino e regras por transportadora. Isso
aumenta a friccao no cadastro e o escopo operacional. Portanto, permanece no roadmap, nao no MVP atual.
No momento, as formas de entrega sao apenas informativas/configuraveis pela loja: retirada, motoboy,
transportadora, Correios, entrega propria ou combinacao com a vendedora. Da mesma forma, formas de
pagamento sao informativas: Pix, dinheiro, cartao, boleto, transferencia etc. O Atacado Shop nao processa
pagamento.
Permissoes de equipe - abordagem minima
Se necessario para seguranca operacional, manter apenas papeis simples: Administrador (controle total),
Gerente (operacao e relatorios) e Vendedora (seus links, clientes/pedidos atribuiveis e desempenho). Nao
criar, por enquanto, um sistema complexo de permissoes por dezenas de checkboxes.
Roadmap priorizado
Prioridade Item Decisao
Agora Catalogo + WhatsApp + equipe + metricas Core do produto
Proximo Estoque basico Implementar
Proximo Multiplos catalogos / atacado + varejo Implementar
Depois Cotacao automatica de frete Roadmap
Fora agora PDV, APIs, webhooks, integracoes, fiscal, gatewayNao implementar


---

## Página 6 de 6


Atacado Shop - Diretrizes de Produto e Precificacao | 29/08/2026 Pagina 6
5. Regra de produto e fonte de verdade
Este documento deve ser usado como referencia para decisoes futuras do Atacado Shop ate que uma nova
versao substitua explicitamente estas diretrizes.
"Voce cria seu catalogo. Sua equipe compartilha. O cliente escolhe. O
pedido chega no WhatsApp. Voce descobre o que realmente gera
intencao de compra."
Repositorio do projeto
Repositorio GitHub brnexusia/detalhamento-execucoesa
URL https://github.com/brnexusia/detalhamento-execucoesa
Branch principal main
Status da referencia Repositorio confirmado no GitHub em 29/08/2026
Benchmark externo registrado
FacilZap: novos valores anunciados para 01/09/2026 - Bronze R$69, Prata R$129, Ouro R$199. O benchmark
e apenas referencia de posicionamento; o Atacado Shop nao precisa reproduzir todas as funcionalidades do
concorrente.
Fontes oficiais consultadas em 29/08/2026: facilzap.com.br/noticias, facilzap.com.br/planos e facilzap.com.br/info_planos.
Diretriz final: manter o produto enxuto. Antes de adicionar qualquer nova feature, perguntar se ela melhora
diretamente o catalogo, a chegada ao WhatsApp, a operacao da equipe de vendas ou a mensuracao de
intencao. Se nao melhorar um desses pontos, nao e prioridade.
