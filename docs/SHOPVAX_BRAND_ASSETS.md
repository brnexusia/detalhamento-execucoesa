# Shopvax — identidade da marca aplicada

## Origem e decisão

- Google Drive: `Shopvax_ Logo (propostas) (2).zip` (arquivo `1pIlY8Tdc4LnhTva8qvg6BrRyjAtUZ34M`).
- São oito **propostas de apresentação**, em PNG, com o mesmo símbolo geométrico V/A formando um X e a palavra SHOPVAX com X personalizado.
- Paleta escolhida para o código: **19 · Laranja.png**, pois identifica explicitamente o laranja `#F25C05`, coincidente com a paleta da prancha 02 do ZIP `Shopvax_ Catálogo (redesign).zip` e com o tema existente. Não alterar automaticamente a cor de cada loja.
- O ZIP **não contém SVGs individuais nem arquivos de fonte**; por isso os SVGs abaixo foram **vetorizados por contorno da arte fornecida**, e não inventados com tipografia genérica. Se o designer fornecer os vetores nativos originais, substituí-los preservando a mesma interface.

## Arquivos

- `public/brand/shopvax-symbol.svg` — símbolo V/A preto, uso no papel claro/laranja.
- `public/brand/shopvax-symbol-dark.svg` — V laranja e A papel sobre fundo escuro.
- `public/brand/shopvax-wordmark.svg` — nome completo com desenho próprio.
- `public/brand/shopvax-wordmark-light.svg` — versão clara sobre fundos escuros.
- `public/brand/shopvax-lockup.svg` — marca horizontal com símbolo e nome.
- `public/favicon.svg` — fundo preto, símbolo V laranja + A claro, desenhado conforme a proposta.
- `src/shopvax-brand-assets.css` — proporções, posicionamento e responsividade.

## Locais de aplicação

Home institucional, login/cadastro, painel da loja e tela inicial, onboarding, administração, operação de lançamento, feed social, perfil social, rodapé com assinatura Shopvax, fallback de carregamento, favicon.

**Não substituir** logo/nome próprios dos lojistas na vitrine ou feed: a identidade das lojas deve permanecer prioritária em contexto comercial.

## Testes

`tests/shopvax-official-brand.e2e.mjs` verifica vetores presentes, paths sem scripts, favicon publicado, imagens visíveis e carregadas em celular/desktop, e ausência de rótulos provisórios `SV` em locais de marca.

Validação de produção e comparação visual com o arquivo-fonte permanecem como passos distintos; merge no GitHub não prova deploy no EasyPanel.
