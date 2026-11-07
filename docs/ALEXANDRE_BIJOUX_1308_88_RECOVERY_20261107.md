# Alexandre Bijoux — 1.308 capturados, 88 publicados (07/11/2026)

## Causa reproduzida com API pública

O adaptador de Alexandre Bijoux encontra **1.308** produtos com **1.308 IDs externos únicos**.
O normalizador preserva a distinção durante o scan, mas o publicador agrupava por:
`product:<origin>:<nome>:<preço>` quando faltava SKU e URL individual.
O domínio retorna `source_url = https://bijouxalexandre.com.br/` para todas as peças, com nomes genéricos repetidos.

Diagnóstico GitHub Actions `validate-alexandre-import-identity`:
- Produtos coletados: **1.308**
- Grupos com algoritmo anterior: **88**
- Diferença: **1.220**
- Grupos com mais de uma peça: **68**
- BRINCO R$24: **248** peças; BRINCO R$40: **192**; ANEL R$100: **111**.

Esse é um *erro de agrupamento na publicação*, não um limite do scanner nem falta de imagens na origem.

## Correção

- `importPublishGroupHash` agora usa ID externo em jobs `alexandre-bijoux`.
- ID vem da coluna `import_candidates.raw_data.external_id` associada via `source_candidate_id`; não depende de revisão editável nem de nomes.
- Publicação é bloqueada se faltar ID ou se número de grupos não corresponder ao de selecionados.
- A prévia reflete a quantidade real a ser publicada.
- Testes preservam agrupamento legítimo de variantes e PDF para outras plataformas.

## Recuperação de importação já concluída

- Não reescaneie para tentar completar a loja anterior: isso pode criar duplicações.
- Abra Importações recentes; com a importação original concluída e ainda presente, aparece `Recuperar peças agrupadas`.
- A prévia confere registros, IDs de origem, imagens já localizadas, vínculo a produtos existentes e quantidade de peças faltantes.
- Após confirmação, o backend preserva **todos os IDs existentes** e **adiciona apenas as peças ainda não representadas**, em transação única; reexecução idempotente.
- Não apaga/reescreve o conteúdo dos 88 produtos atuais. **Galerias dos 88 podem conter fotos de peças que foram fundidas e precisam revisão manual**.
- Importações descartadas não podem ser recuperadas sem restabelecer o histórico; rescan só após conciliação da loja.
- Se o plano tiver limite inferior ao total pretendido, a transação é revertida com erro explícito; não remove limites contratuais.

## Validação em produção (pendente)

Antes de executar a recuperação em produção:
1. Confirmar deploy da versão com fix e criar backup do PostgreSQL.
2. Confirmar no banco o job correto, plataforma, `selected_count`, `published_count`, e que ele não foi descartado.
3. Conferir prévia (esperado 1.308 selecionados, 88 preservados, 1.220 a recuperar **se a situação no banco for igual à reproduzida**).
4. Confirmar capacidade do plano e armazenamento interno `/media/*`.
5. Recuperar e verificar `COUNT(DISTINCT published_product_id)=selected_count` nas linhas selecionadas.
6. Verificar que produtos anteriores não foram apagados, duplicados ou modificados e revisar as galerias.
7. Conferir total de produtos da loja e visualizar fotos na versão publicada.

Diagnóstico read-only para equipe de suporte (não imprime dados pessoais):

```sql
SELECT j.id,j.platform,j.status,j.result_count,j.normalized_count,j.selected_count,
       j.published_count,j.skipped_existing_count,
       COUNT(n.id) FILTER(WHERE n.selected) AS selected_rows,
       COUNT(DISTINCT n.published_product_id) FILTER(WHERE n.selected) AS distinct_published_products
FROM import_jobs j
LEFT JOIN import_normalized_products n ON n.job_id=j.id
WHERE j.platform='alexandre-bijoux' AND j.store_id=$1
GROUP BY j.id;
```
