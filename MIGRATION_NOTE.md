# Configuração simplificada do Shopvax

O Shopvax precisa de `DATABASE_URL` como configuração obrigatória de produção.

O backend cria automaticamente o schema e armazena fotos/vídeos no PostgreSQL. Configurações antigas de `PGSSL`, `DATA_DIR` e volume `/data` não são necessárias para a versão atual.

Para uma instalação nova sem administradores, use temporariamente `SHOPVAX_ADMIN_BOOTSTRAP_TOKEN` para ativar o primeiro acesso em `/admin` e remova o token depois da ativação.

Nomes técnicos legados de cookie podem continuar existindo apenas dentro da camada de compatibilidade de migração para não invalidar sessões antigas; a marca pública e os novos identificadores são Shopvax.
