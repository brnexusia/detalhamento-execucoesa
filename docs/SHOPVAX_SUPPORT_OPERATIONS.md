# Shopvax · central de suporte e triagem por IA — requisito A05

A central é distinta do telefone administrativo das lojas e de todos os números das vendedoras. A implementação integra o ponto de acesso em `ShopvaxSupport.tsx`; **nenhuma instância, número de suporte, canal externo ou atendimento humano está ativo automaticamente**.

## Configuração privada
- `SHOPVAX_SUPPORT_WHATSAPP_NUMBER`: número internacional validado (11–15 dígitos), **exclusivo da central Shopvax**. Quando presente, um link `wa.me` pode ser mostrado ao comprador e lojista. O clique abre o aplicativo por iniciativa do usuário; não prova envio nem resposta.
- `SHOPVAX_SUPPORT_AI_ENABLED=1` + `SHOPVAX_SUPPORT_AI_API_KEY`: habilita o endpoint de assistência textual somente para perguntas genéricas. Chave exclusivamente no backend, nunca no bundle. Modelo opcional `SHOPVAX_SUPPORT_AI_MODEL` (padrão `gpt-4.1-mini`).
- `SHOPVAX_SUPPORT_TICKETS_ENABLED=1`: ativa registro de tickets, somente após existir **equipe humana**, ferramenta de leitura da fila, retenção, privacidade e canal de retorno autorizado. O endpoint não envia mensagens por conta própria.

## Privacidade / autonomia
A API `POST /api/public/support/assist` exige confirmação explícita, aceita somente 8–600 caracteres, bloqueia e-mails/números longos, restringe taxa por IP (5 em 10 min, somente em memória), limita saída, tempo de chamada e registra **zero transcrições** no Shopvax. Nenhum histórico do comprador ou lojista, nomes, sessão ou pedidos é enviado ao modelo. Perguntas podem exigir encaminhamento humano. O modelo não pode alterar dados, valores, envios, cobranças ou permissões. Não usar sugestões como prova de venda.

**Limite residual:** filtros de identificadores não garantem detectar toda informação pessoal escrita pelo usuário; avaliar proteção adicional de dados, contratos, consentimento e monitoramento antes de habilitar IA com dados de clientes. IP-based rate limiting em memória não substitui proteção compartilhada entre réplicas. Sem configuração/credenciais, o endpoint retorna 503 e a interface mantém FAQ.

## Aceite externo pendente
Selecionar número oficial da Shopvax, aprovar política de privacidade e fornecedor, configurar modelo/limites/custos e equipe, verificar ligação com Chatwoot ou outro canal humano, testar abertura/entrega real no WhatsApp e homologar no EasyPanel/HTTPS. Não confundir este adaptador com um bot já funcionando dentro do WhatsApp.
