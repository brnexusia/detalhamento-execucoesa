# Configuração simplificada

A partir desta versão, o Atacado Shop precisa apenas de `DATABASE_URL` em produção.

O backend cria automaticamente o schema e armazena fotos/vídeos no PostgreSQL. Configurações antigas de `PGSSL`, `DATA_DIR` e volume `/data` não são mais necessárias para a V1.
