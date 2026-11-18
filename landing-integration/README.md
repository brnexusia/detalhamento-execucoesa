# Integração da LP original ShopVax

Fonte: repositório privado `brnexusia/screenshot-to-spark-0332`, commit `23f150e5af75559920bbec3d1ed43ac4ec213989`.

Os arquivos em `vendor/screenshot-to-spark-0332` foram copiados literalmente de seu Git original (sem alterar JSX, textos, cores, fontes ou Tailwind). O teste `npm run test:landing` verifica SHA de blob Git original.

A LP é compilada **como um app Vite independente**, pelo `landing-integration/vite.config.mjs`, preservando o `src/routes/index.tsx`, `src/components/Intro.tsx` e `src/styles.css` originais. A entrada `entry.tsx` executa diretamente o componente armazenado em `Route.options.component`; não existe reconstrução visual. O build gera `dist/para-lojas/index.html` e seus bundles, separados do ShopVax.

Adaptação inevitável de integração: o alias `@/lib/links` aponta para `landing-integration/links.ts`, para permitir cadastro e assinatura reais sem recarregar a LP em um loop. A rota `/para-lojas` é atendida pelo Express antes do fallback SPA.

**Assets do Lovable:** o repositório de origem não contém os quatro PNGs de marca, apenas referências `.asset.json` para seu storage. O Express busca exclusivamente esses quatro assets no domínio publicado de origem (com timeout e limite de tamanho). Se o storage não responder, os PNGs são substituídos pelos SVGs oficiais presentes no ShopVax, sem afetar os três JPGs originais que estão versionados.

Para nova versão, sincronizar novamente os arquivos da origem com commit explícito, validar os SHAs e testar `npm run build` e `npm run test:landing`. Não modificar os arquivos `vendor` para adaptar a LP.
