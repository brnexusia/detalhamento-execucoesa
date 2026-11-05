# ShopVax — Fechamento das pendências do pentest (05/11/2026)

## Alterações incluídas no código

- Upload de vídeos: a API não considera extensão/MIME informado pelo navegador como prova de MP4/MOV/WebM. Rejeita outros bytes e devolve o tipo detectado. É uma verificação de contêiner, não antivírus nem transcodificação.
- Pagamentos Asaas: tabela `shopvax_payment_claims` registra uma tentativa única por loja e pedido ANTES de chamar o provedor. Requisições repetidas obtêm a cobrança já armazenada. Uma resposta remota inconclusiva mantém a tentativa marcada `uncertain` para reconciliação; não repete a cobrança.
- Versão publicada: builds Git-backed pelo EasyPanel fornecem `GIT_SHA` (documentado em https://easypanel.io/docs/builders). O Dockerfile grava esse identificador dentro da imagem. `/health` usa o SHA incorporado preferencialmente ao valor informado manualmente. Builds sem `GIT_SHA` ainda precisam configurar `SHOPVAX_RELEASE_SHA` corretamente.

## Infraestrutura: mudança necessária fora do repositório

**A auditoria externa confirmou SSH OpenSSH na porta pública 22 e o painel EasyPanel na porta 3000.** Não aplicar firewall na VPS sem uma conexão administrativa alternativa testada: isso pode causar perda definitiva de acesso.

1. Confirmar a titularidade da VPS e ter acesso de recuperação pelo console do provedor, de preferência com segunda sessão SSH já aberta. Verificar qual IP administrativo fixo/VPN pode ser liberado.
2. Criar as regras **no firewall do provedor**, antes de alterá-las no host: 80 e 443 públicos; 22 apenas IP/VPN de administração; 3000 apenas IP/VPN de administração (preferivelmente somente localhost atrás de túnel); 5432, 6379 e 8080 fechadas externamente. Regras com Docker Swarm podem contornar UFW; não presumir que `ufw deny` bloqueie uma porta publicada pelo Docker.
3. Confirmar na VPS, somente leitura:
   ```bash
   sudo ss -lntp | grep -E ':(22|80|443|3000|5432|6379|8080)\\b'
   sudo ufw status verbose
   sudo docker service ls
   sudo docker ps --format 'table {{.Names}}\\t{{.Ports}}'
   ```
4. Testar nova sessão administrativa e rede externa autorizada. Só então bloquear 22 e 3000 da internet geral pelo firewall do provedor. Não desabilitar a porta 22 para o único canal disponível.
5. Revisar autenticação forte, MFA (se suportado), chaves de SSH, fail2ban/regras equivalentes, atualizações do EasyPanel e auditoria de sessões ativas.

**Não executado:** não há nesta integração um conector SSH/EasyPanel com acesso autenticado à VPS. Nenhuma regra de firewall foi alterada nesta etapa.

## Deploy e validação posterior (necessita conexão do serviço)

1. Fazer backup verificável do PostgreSQL e das mídias; testar restauração em instância isolada. Esta alteração cria a tabela `shopvax_payment_claims`; não requer apagar dados.
2. Publicar somente o SHA aprovado, a partir da fonte GitHub do EasyPanel e usando Dockerfile; verificar no log de build que `GIT_SHA` foi recebido sem divulgar segredos.
3. Fazer GET de `https://shopvax.com.br/health` e confirmar `ok=true`, `database=true` e `releaseSha` exatamente igual ao SHA compilado.
4. Rodar workflow `production-readiness` com URL e SHA publicado e conferir `Permissions-Policy` no domínio externo. O backend já define uma política de câmera/microfone/localização; a produção anterior retornou outra política, possivelmente por proxy/versão desatualizada.
5. Em staging, com o mock do Asaas ou credenciais sandbox: testar toque duplo, pedidos paralelos, cobrança anterior ao deploy, desconexão do provedor e eventos duplicados. Não criar cobranças reais de teste.
6. Verificar que a porta 3000 não responde fora da VPN/allowlist, e que a porta 22 fica acessível apenas à rede administrativa.

## Tentativas de pagamento com resultado incerto

Por segurança, o software não repete automaticamente uma cobrança quando há falha de comunicação com o provedor. O operador precisa consultar o Asaas e seus logs antes de liberar eventual nova tentativa. Consulta de acompanhamento, **somente leitura**:

```sql
SELECT store_id, order_id, state, payment_id, created_at, updated_at
FROM shopvax_payment_claims
WHERE state <> 'created'
ORDER BY updated_at DESC
LIMIT 100;
```

**Nunca** apagar claims ou redefinir o estado sem comprovar no Asaas que a cobrança anterior não foi criada. O registro protege contra duplicidade e não deve ser removido automaticamente por tempo.

## Outras observações

- TLS 1.2 e 1.3 estavam disponíveis; 1.0/1.1 não completaram o handshake no teste.
- Headers HSTS/CSP/XFO/nosniff e flags Secure/HttpOnly/SameSite=Lax estavam presentes no teste externo. A divergência de `Permissions-Policy` depende de nova medição após deploy.
- `security.txt` é recomendação de divulgação responsável, não uma vulnerabilidade comprovada. Não publicar contato fictício.
