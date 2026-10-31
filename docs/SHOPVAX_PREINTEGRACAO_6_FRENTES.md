# ShopVax — pré-integração isolada das seis frentes

Data: 31/10/2026. Esta branch é uma **candidata de homologação em CI**, **não é merge dos PRs nem versão publicada**.

Base main: `2a4909dbd7f976c686b510e861f8558c1f3a381a`.
Origens:
- PR #120: `3e87c0387233e835f312c529dc7a9c57e8764f8e`
- PR #121: `75cbc3a7715b4e7ce7dd04f210a3b8c58b3a507a`
- PR #122: `57f66b956b28684e7445b0f22157f276e79b33e1`
- PR #123: `51b0a2b85bd77d588d2989534f66aedc2c56aee9`
- PR #124: `92ecfa6604fa494ff4945e1a460349d7b239f983`
- PR #125: `4b271da96d24e58dc8a05281e89ef097fe42e6f8`

## Resolução específica de sobreposições
- Dockerfile: healthcheck da Frente 01 valida HTTP, `ok=true` e `database=true`; onboarding da Frente 03 é importado com `--import`, incluindo preservação do prefixo do próximo hook.
- Workflow validate: testes de onboarding e integração de paginação administrativa preservados.
- Workflow responsive-picker: testes/artefatos das Frentes 03 e 04 preservados.
- AdminApp: paginação e bootstrap compacto da Frente 06, com controle de primeira configuração da Frente 03. Verificação de produtos usa `productCount` quando disponível.
- ShopvaxDashboard: mantém onboarding da Frente 03 e contagem agregada de produtos da Frente 06.
- ShopvaxOnboardingGuide: atualização vinculada à contagem compacta de produtos.

## Restrições
Não promover esta candidata à main ou ao EasyPanel sem revisão dos PRs, CI de integração, confirmação de comportamento de deploy automático, autorização e cumprimento do gate de produção em `docs/SHOPVAX_RELEASE_GATE.md`. GitHub Actions verde isolado não comprova produção, backup/restore, WhatsApp físico nem aceite visual em aparelhos.
