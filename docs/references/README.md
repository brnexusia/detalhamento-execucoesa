# Referências originais do ShopVax — roteiro de acesso para o Codex

Este repositório guarda o código, testes, documentação e **transcrições pesquisáveis** de fontes de produto; os arquivos visuais originais permanecem no Google Drive. Não confundir texto extraído com o PDF/ZIP original.

## Fontes textuais que já estão neste Git
- [Manifesto MVP — transcrição](Shopvax_Manifesto_MVP.texto.md), referente a `Shopvax_Manifesto_MVP.pdf` (histórico, preços antigos).
- [Diretrizes de produto e precificação — transcrição](Atacado_Shop_Diretrizes_Produto_e_Precos.texto.md), referentes ao PDF de 29/08/2026 (posterior ao manifesto). Limites, preços e decisões aprovadas no `README.md` e na implementação atual prevalecem sobre valores anteriores.

## Fontes visuais originais — Google Drive, não Git
- [Redesign do catálogo ShopVax — SVG](https://drive.google.com/file/d/1QzU5PkuzVpxqNGYg_7x2E_T1uHxkTudU/view?usp=drivesdk): ZIP de pranchas vetoriais originais do redesign.
- [Redesign do catálogo ShopVax — PNG](https://drive.google.com/file/d/1s-JEfhZQjazt0rJuCmWGWwAxA6EDPfgO/view?usp=drivesdk): versão de referência em PNG.
- Identidade da marca: procurar no Drive `Shopvax_ Logo (propostas).zip`; a prancha escolhida é `19 · Laranja.svg`. Detalhes em `../SHOPVAX_BRAND_ASSETS.md`.
- PDFs originais, quando disponíveis no Drive/arquivos do projeto, são necessários para gráficos, imagens e fidelidade de layout que transcrições em Markdown não preservam.

**Verificação obrigatória para o Codex:** antes de homologar visualmente, confirmar que a sessão possui ferramentas do plugin Google Drive operantes e autorização de leitura; abrir os arquivos reais e comparar com as telas da aplicação. Um plugin listado como instalado não prova acesso efetivo. Se o Drive não estiver acessível, documentar bloqueio e não afirmar homologação pixel a pixel.

Os arquivos ZIP originais **não estão incluídos nesta pasta do Git**. Apenas links/identificadores e documentação devem ficar aqui. Evitar cópias binárias desnecessárias, duplicações e exposição pública de materiais confidenciais.

## Documentação e instrução principal
- [Prompt completo do Codex para continuar e finalizar](../CODEX_CONTINUAR_FINALIZAR.md).
- `../SHOPVAX_REDESIGN_SURFACE_AUDIT.md`, `../SHOPVAX_RELEASE_GATE.md` e `../SHOPVAX_BRAND_ASSETS.md`.
- Código: `src/`, `server/`, `tests/`; CI: `.github/workflows/`.

Nunca publicar arquivos com contatos, conversas de WhatsApp, dados pessoais, certificados, segredos ou credenciais em repositório público.