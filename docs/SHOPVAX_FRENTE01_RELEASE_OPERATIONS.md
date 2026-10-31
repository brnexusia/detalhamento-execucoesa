# ShopVax — Frente 01/06: gate operacional de lançamento
**Revisão:** 2026-10-31 | **Estado:** NO-GO até comprovação externa | **Issue canônica:** [#75](https://github.com/brnexusia/detalhamento-execucoesa/issues/75)

> Este procedimento complementa [SHOPVAX_RELEASE_GATE.md](SHOPVAX_RELEASE_GATE.md). Não concede autorização para deploy, alteração de planos, cobrança, restauração ou migrações em produção. Atualizar evidências em #75 sem divulgar clientes, tokens, host interno ou dump.

## 1. Baseline e evidência auditada
- Repositório `brnexusia/detalhamento-execucoesa`, branch `main`, SHA observado `2a4909dbd7f976c686b510e861f8558c1f3a381a`.
- CI de push deste SHA: seis execuções **success** em 31/10/2026: [validate](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/41204522325), [phase1](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/41204522383), [phase2](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/41204522379), [phase3](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/41204522385), [phase4](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/41204522355), [phase5](https://github.com/brnexusia/detalhamento-execucoesa/actions/runs/41204522362).
- O sétimo `responsive-picker-check` foi success no HEAD do [PR #119](https://github.com/brnexusia/detalhamento-execucoesa/pull/119), mas **não há run deste workflow no push acima**, pois ele é disparado por caminhos alterados e manualmente.
- PR aberto identificado: [#30](https://github.com/brnexusia/detalhamento-execucoesa/pull/30) (`fix/feed-snap-ios`), divergente da `main` (79 commits behind / 9 ahead). Não mesclar por antiguidade sem rebase, diff e regressão.
- Não foi comprovado acesso à configuração EasyPanel, banco real, volumes, domínio HTTPS ou imagem executada. Uma falha de consulta externa a `https://shopvax.com.br` **não prova indisponibilidade**. **Nenhum deploy, backup real, restore ou migração foi executado nesta auditoria.**

## 2. Ambientes: inventário a levantar fora do Git
Preencher em registro PRIVADO e registrar em #75 somente identificadores públicos ou redigidos:
- Projeto/serviço EasyPanel (identificador não sensível), implantação, data, commit do build **e digest da imagem**; método GitHub branch vs commit fixo. Conferir que o Dockerfile de verdade é utilizado.
- Domínio público, DNS e certificado TLS válido, redirecionamento HTTP→HTTPS, HSTS, CDN/cache, proxy e encaminhamento para a **porta 80** do container.
- Serviço PostgreSQL, **versão**, identificação lógica sem credenciais, storage/volume, uso e espaço livre, conexões, retenção/criptografia do backup e janela de manutenção.
- Fonte de verdade das variáveis no serviço (apenas presença, jamais valor): `DATABASE_URL`, `SHOPVAX_PUBLIC_URL`, `SHOPVAX_RELEASE_SHA`, `SHOPVAX_INTEGRATION_SECRET` estável, `GOOGLE_CLIENT_ID` opcional. `SHOPVAX_ADMIN_BOOTSTRAP_TOKEN` só durante bootstrap e depois removido.
- Confirmar `SHOPVAX_ASAAS_MOCK`, `SHOPVAX_PLAN_LIMITS_DISABLED`, `SHOPVAX_SECURITY_RATE_LIMIT_DISABLED` e `SHOPVAX_APPLY_APPROVED_PLAN_LIMITS` **não habilitados** no deploy regular.
- Examinar volumes, bind mounts e objetos externos. No código atual `server/app.mjs` e `server/scanner-hooks.mjs` armazenam mídias em `media_assets.data bytea` e `media_variants.data bytea`, no PostgreSQL. Temporários da importação PDF usam `os.tmpdir()`. Se a instalação real tiver outros volumes persistentes, inventariá-los e incluí-los no backup; não assumir que somente o banco é usado em produção.
- Registrar recursos reais: CPU, RAM, disco, limites de tamanho dos uploads, configurações de proxy e healthcheck.

## 3. Contrato e migração — apenas leitura antes do aceite
Referências em `server/system-plans.mjs`, `server/platform-hooks.mjs`, `server/plan-limits-hooks.mjs`, README e histórico de aprovações:
| Parâmetro | Bronze | Prata | Ouro |
| --- | ---: | ---: | ---: |
| Preço mensal (R$) | 49,90 | 94,90 | 144,90 |
| Produtos | 500 | 2.000 | sem limite |
| Vendedoras | 5 | 15 | sem limite |
| Catálogos | 1 | 3 | sem limite |
| Fotos por produto | 5 | 10 | sem limite |
| Franqueados | 0 | 2 | sem limite |
| Descontos por ciclo | -5% semestre / -15% anual | -5% / -15% | -5% / -15% |

**Divergência estática:** `phase5-launch-hooks.mjs`, função `planExtraLimits('ouro')`, retorna `photosPerProduct: 10` para exibição do uso/limite, enquanto o contrato aprovado e a tabela `platform_plans.photo_limit` do Ouro são ilimitados. Corrigir com a frente dona do painel/contratos e testar leitura de uso com Ouro antes de GO.

**Risco controlado:** as rotinas de boot executam DDL (`CREATE TABLE`, `ALTER TABLE`, triggers) e têm migração v3 opt-in. `SHOPVAX_APPLY_APPROVED_PLAN_LIMITS=1` pode atualizar limites de planos de sistema; não aplicar sem backup restaurado e levantamento dos contratos/regras customizadas. A correção específica `photo_limit=NULL` para Ouro aparece fora da condição opt-in; inspecionar efeito em assinantes existentes e aprovar a mudança.

**SQL somente leitura:** executar `scripts/shopvax-release-readonly.sql` com usuário autorizado em console restrito; não publicar resultados brutos. Conferir lojas acima do teto, planos personalizados, exceções contratuais e lojas com vendedoras indisponíveis. Nunca alterar preços ou limites automaticamente.

## 4. Backup PostgreSQL e mídias — runbook de operador (NÃO executado)
**Pré-requisitos:** autorização de janela, papel somente de backup, espaço suficiente para dump e mídias, canal de armazenamento privado/criptografado fora da VPS, retenção definida e uploads/escritas em pausa para consistência entre serviços. Utilizar máquina de operação segura com utilitários `pg_dump`, `pg_restore` e `psql` compatíveis com o PostgreSQL real.

Evitar credenciais em comando, histórico e logs. Definir `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` pelo gerenciador de segredos/ambiente privado do operador, **não por commit ou URL contendo senha no argumento da CLI**. Antes do comando confirmar servidor e banco alvo por canal seguro. Então:
```bash
set -euo pipefail
umask 077
: "${PGHOST:?}" "${PGDATABASE:?}" "${PGUSER:?}"
BACKUP_DIR="${SHOPVAX_BACKUP_DIR:?Defina caminho privado fora de volumes efemeros}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/$STAMP"
mkdir -p "$OUT"
pg_dump --format=custom --no-owner --no-acl --file="$OUT/shopvax.pgdump" "$PGDATABASE"
pg_restore --list "$OUT/shopvax.pgdump" > "$OUT/restore-objects.txt"
( cd "$OUT" && sha256sum shopvax.pgdump > SHA256SUMS )
printf 'Backup gerado em %s — conservar fora do Git\n' "$OUT"
```
Este dump inclui `media_assets` e `media_variants`, porque são tabelas no banco. **Conferir tamanho e contagem de blobs** com SQL de auditoria. Se existirem volumes persistentes adicionais, capturar snapshot consistente ou arquivo do volume identificado (`tar -C "$VOLUME_MOUNT" -czf "$OUT/volume-identificado.tgz" .` somente com writes pausados), acrescentar hash e verificar restauração. Não arquivar credenciais nem snapshots no GitHub.

**Validação indispensável de restore:** provisionar OUTRO PostgreSQL isolado, vazio, sem acesso a clientes nem endpoints de produção; confirmar visualmente host e banco alvo. Reconfigurar as variáveis `PG*` no shell **somente para o destino descartável**, usar `test "${SHOPVAX_RESTORE_TARGET:?}" = "isolated-disposable"` como segunda trava e executar:
```bash
set -euo pipefail
test "${SHOPVAX_RESTORE_TARGET:?}" = "isolated-disposable"
test -n "${RESTORE_DUMP:?}"
( cd "$(dirname "$RESTORE_DUMP")" && sha256sum -c SHA256SUMS )
psql --no-psqlrc --set=ON_ERROR_STOP=on --dbname="$PGDATABASE" \
  --command="SELECT current_database(), inet_server_addr(), inet_server_port()"
# PROIBIDO prosseguir se host/banco não forem comprovadamente isolados e vazios.
pg_restore --exit-on-error --single-transaction --no-owner --no-acl \
  --dbname="$PGDATABASE" "$RESTORE_DUMP"
```
Na réplica, conferir tabelas, contagens, blobs, imagens via endpoint interno isolado, integridade referencial, login de teste e versão do schema, sem reproduzir notificações/cobranças/WhatsApp. Restaurar também volumes extras quando existirem. Registrar início/fim, duração, hash, contagens, evidência da restauração e resultado em registro privado. **Nunca executar restore contra produção com estes comandos**. A aprovação do backup depende de restauração testada, não apenas de um `pg_dump` bem-sucedido.

## 5. Deploy seguro, smoke e rollback
1. **Pré-deploy:** atualizar branch de release com PRs aprovados, executar CI 6/6 e `responsive-picker-check` onde pertinente; resolver findings P0; obter aprovação explícita do responsável; congelar SHA; verificar contrato e migrações; snapshot + restore isolado; confirmar espaço/volumes, DNS, TLS, janela de manutenção e plano de comunicação.
2. **Build:** construir imagem a partir do SHA exato aprovado. Anotar digest da imagem, hora, artefato e configuração efetiva do EasyPanel. O `Dockerfile` usa Node 22 e `npm install`, e **não há package-lock.json** na main auditada: registrar risco de resolução variável de dependências; providenciar lockfile revisado e build reproduzível em PR apropriado, sem instalar pacotes arbitrariamente em produção.
3. **Publicação:** somente com autorização do operador; publicar inicialmente com `SHOPVAX_APPLY_APPROVED_PLAN_LIMITS` desligada, mocks e bypasses desligados, variáveis obrigatórias presentes, proxy na porta 80 e `SHOPVAX_RELEASE_SHA` preenchido com SHA do build. Não inferir autenticidade da imagem só pela string configurável do `/health`.
4. **Read-only:** GET `/health` validando `ok=true`, `database=true`, SHA igual; GET `/`, `/entrar`, `/favicon.svg`; HTTPS, certificado, headers e redirecionamentos. Executar o [workflow manual production-readiness](https://github.com/brnexusia/detalhamento-execucoesa/actions/workflows/production-readiness.yml) com URL/SHA públicos **depois** de confirmar deploy, ou `node scripts/verify-production.mjs` com `SHOPVAX_PUBLIC_URL` e `SHOPVAX_EXPECTED_SHA`.
5. **Funcional:** duas lojas artificiais A e B; teste controlado e registros sem dados pessoais. Só expor a novos usuários após todos os cenários P0 e dispositivo físico aprovados. Não realizar cobrança real.
6. **Rollback:** guardar imagem/digest antigo e manifestos/variáveis anteriores em registro privado. Se schema for retrocompatível e o rollback da imagem for seguro, restaurar imagem anterior, verificar `/health` e fluxos P0; **se schema incompatível, não executar rollback cego**. Planejar restauração de banco apenas na janela aprovada, com bloqueio de novas escritas, decisão sobre perda de alterações após o backup e procedimento separado de restore de produção autorizado. Registrar hora, causa, SHA antigo/novo e verificação pós-reversão.

## 6. Homologação operacional com duas lojas fictícias
| Cenário de teste | Evidência exigida | Situação |
| --- | --- | --- |
| Duas lojas, dois usuários e sessões entre abas | vídeo/captura redigida e respostas autorizadas; dados de A invisíveis em B | BLOQUEADO: sem staging/produção |
| Planos Bronze/Prata/Ouro, limites e contratos existentes | SQL agregado, API e interface coerentes | BLOQUEADO: banco e divergência de Ouro |
| Cadastro, login Google quando habilitado, logout entre abas | autenticação + invalidação visual + cookies corretos | BLOQUEADO: ambiente |
| Catálogo atacado/varejo, preços e mínimos server-side | fluxo completo com variações e isolamento | BLOQUEADO: ambiente |
| Importação PDF `<=50 MB, <=200 páginas`, OCR, revisão | produto importado sem publicação automática, mídia persistente após restart | BLOQUEADO: ambiente |
| Carrinho, pedido, vendedora disponível, WhatsApp | talão real no dispositivo; ausência de fallback ao telefone principal; SEM alegar envio | BLOQUEADO: dispositivo |
| Pedidos, confirmação manual, cancelamento e estoque | transições corretas sem duplicação, concorrência/retorno | BLOQUEADO: ambiente |
| Temas/paletas aplicados, geração de PDF | 4 PDFs (padrão, paleta, sazonal, restaurado) com preços/imagens corretos | BLOQUEADO: ambiente |
| Safari/iPhone e Chrome/Android físicos | 320/390/430, paisagem, navegação, foco, rede fraca, reduced motion, comparativo SVG | BLOQUEADO: dispositivos |
| LCP/INP/CLS, uso CPU/RAM, tamanhos | medições reais em dispositivo/rede e baseline #81–#86 | BLOQUEADO: observabilidade |

O sucesso do browser Chromium no CI não substitui o Safari físico, Android físico, nem screenshots comparadas lado a lado com todos os SVGs oficiais da [#91](https://github.com/brnexusia/detalhamento-execucoesa/issues/91).

## 7. Integração das frentes 02–06
Só a Frente 01 executará o merge de integração. A cada PR: conferir autoria/escopo, referências à #109/#91, arquivos alterados, base atualizada, ausência de mudança comercial não aprovada, diffs de schema/API/estado, revisões, checks, testes P0 e evidência. Rebase seguro e **um merge por vez**; depois de cada merge, reler SHA, CI e testes afetados antes do PR seguinte. Ordem de integração *proposta*, ajustável por dependência real: 02 segurança/pedidos → 03 onboarding/ofertas → 04 design/tema/PDF → 05 vitrine/feed → 06 painel/API/DB. Conflito em arquivo compartilhado ou alteração de contrato obriga negociação/PR corretivo, não resolução silenciosa.

Registro de PRs adicionais: **nenhum PR das frentes 02–06 identificado na consulta de 31/10/2026**. PR antigo #30 está fora da fila de integração até revalidação. Registrar em #75 o número/HEAD/merge SHA/checks de cada PR quando realmente existir.

## 8. GO / NO-GO e autorizações externas
| Gate | Resultado em 31/10 | Evidência mínima para GO |
| --- | --- | --- |
| Código base / seis CI | APROVADO no SHA base | 6 runs success, reexecutar após merges |
| Regressão visual automatizada | APROVADO no PR #119, não na main push | browser check no código candidato final |
| Dependências/build imutável | PENDENTE | lockfile + digest de imagem |
| Contratos e limites | BLOQUEADO | auditoria SQL, correção de limite mostrado do Ouro |
| Ambiente, SSL, migrações, volumes | BLOQUEADO | inventário EasyPanel real |
| Backup e restauração | BLOQUEADO | hashes, dump validado e restore isolado |
| Health/commit realmente publicado | BLOQUEADO | HTTPS + resultado de GET + digest/commit |
| Dois tenants / WhatsApp / PDF | BLOQUEADO | casos e capturas de teste |
| iPhone Safari + Android Chrome + SVGs | BLOQUEADO | evidências físicas e aceite visual |
| Performance e autorização final | BLOQUEADO | métricas + assinatura de responsável |

**NO-GO é o resultado correto até fechar todos os bloqueios críticos.** O prazo-alvo 01/11/2026 não é autorização automática para publicar.

**Ações externas necessárias** (sem expor credenciais em issue pública): (a) identificar operador com acesso ao EasyPanel/PostgreSQL; (b) fornecer evidência redigida de serviços, digest, domínio/TLS e espaço; (c) autorizar janela de backup e realizar restore em ambiente isolado; (d) executar auditoria agregada de planos/lojas com decisão sobre exceções; (e) habilitar ambiente de duas lojas fictícias; (f) oferecer iPhone Safari e Android Chrome físicos; (g) aprovar correções de P0 e fidelidade dos SVGs; (h) registrar autorização explícita, SHA e condição de rollback. Esses requisitos não podem ser cumpridos por GitHub Actions sozinho.
