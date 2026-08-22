# Backend

O backend de produção está em `app.mjs`.

A única configuração obrigatória é `DATABASE_URL`. O processo cria o schema automaticamente, tenta reconectar ao PostgreSQL quando necessário e armazena uploads na tabela `media_assets`.
