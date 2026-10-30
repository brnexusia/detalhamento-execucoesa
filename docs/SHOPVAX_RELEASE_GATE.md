# Shopvax — gate final de produção (leitura e homologação)

**Objetivo:** comprovar que o código aprovado é o mesmo que está em produção no EasyPanel e que o fluxo real funciona. GitHub Actions verde sozinho não comprova deploy nem aceite visual.

## 1. Antes de publicar qualquer nova migração
- Confirmar ambiente, serviços, DNS e volumes do EasyPanel e inspecionar configuração real **sem compartilhar credenciais**.
- Fazer backup e **testar restauração** do PostgreSQL e das mídias/volumes. Registrar identificador, duração e integridade do backup.
- Registrar quantas lojas/planos personalizados ativos existem, os respectivos limites e exceções comerciais; alterações de planos de sistema podem impedir **novas inclusões** em lojas acima dos tetos, mas jamais devem apagar registros existentes.
- Confirmar recursos CPU/RAM/disco e verificar variáveis sensíveis de produção. Nunca usar `SHOPVAX_ASAAS_MOCK=1` nem bypass de limites/rate limit.
- Para a versão a publicar, fixar o commit aprovado e configurar `SHOPVAX_RELEASE_SHA` com o SHA completo no serviço backend (não na interface do comprador). Definir `SHOPVAX_PUBLIC_URL` com o domínio real.

## 2. Após deploy
- Verificar `GET /health`: `ok: true`, `database: true`, `releaseSha` igual ao SHA preparado. Um SHA configurado manualmente ainda precisa refletir a imagem realmente construída.
- Executar o workflow manual **production-readiness** no GitHub, informando a URL HTTPS e o SHA do deploy; ele faz somente GET para `/health`, `/`, `/entrar` e `/favicon.svg`.
- Alternativamente, em um ambiente com Node 22:
  ```sh
  SHOPVAX_PUBLIC_URL=https://seu-dominio.com.br SHOPVAX_EXPECTED_SHA=<sha-completo> node scripts/verify-production.mjs
  ```
  O verificador **não faz login, upload, pedidos ou migrações**. Esses testes exigem uma homologação separada com dados de teste e controles de segurança.

## 3. Smoke test funcional com duas lojas de homologação
1. Cadastro, login e escolha de plano; confirmar isolamento de produtos, carrinhos, sessões, vendedoras e links das duas empresas.
2. Criar produtos com fotos/vídeos e Cor × Tamanho, validar estoque e variações; abrir links da loja/vendedora no celular e desktop.
3. Importar PDF próprio, revisar os itens antes de publicar, gerar catálogo e verificar mídias após reiniciar serviço.
4. Exercitar catálogo, busca, ordenação, filtros, feed, salvar itens e carrinho; testar pedido mínimo em situação abaixo/acima e dados opcionais do comprador.
5. Preparar um pedido e conferir o texto no aplicativo WhatsApp **após clicar explicitamente**. Não interpretar abertura do aplicativo como mensagem entregue, pagamento, faturamento ou venda.
6. Verificar na área de pedidos vendedora vinculada, cópia do talão, confirmação **manual** e cancelamento/retorno de estoque sem duplicações.
7. Testar 320/390/430px, desktop, Android Chrome, iPhone Safari real, paisagem, movimento reduzido, rede fraca, perda e retorno de conexão.

## 4. Critérios finais
- Capturar e comparar telas de todos os estados das oito pranchas SVG oficiais; registrar diferenças e corrigi-las antes do aceite.
- Medir dados móveis, LCP/INP/CLS, RAM, CPU e queries conforme as issues de performance #81–#86, inclusive 3G/4G e aparelhos modestos.
- Validar restauração de backup, headers de segurança, HTTPS, cookies, segregação multiempresa e volume realista de dados.
- Registrar URL, SHA publicado, relatório de testes, prints e assinatura do responsável pela homologação.
- **Não fechar as issues #75 e #91 nem declarar 100% em produção sem essas evidências.**

## Nota de escopo comercial
O MVP aprovado prioriza catálogo, múltiplos catálogos atacado/varejo, WhatsApp, equipe e inteligência de intenção de compra. Integrações experimentais de gateway/frete/API não são escopo comercial homologado; eventuais testes destas rotas devem permanecer segregados e não simular transações reais.
