# Lista nativa: contrato e validação

## Utilização

A Lista nativa usa cabeçalhos e células alinhados, incluindo propriedades padrão e os sete tipos de campos personalizados. **Campos** controla visibilidade e ordem; a borda dos cabeçalhos ajusta larguras com mouse ou teclado. As larguras da Lista e da Planilha são independentes.

Na Lista, os editores de campos personalizados têm apresentação inline: fundo transparente, sem a borda de formulário em volta de cada valor, seleções com suas cores e foco de teclado visível. Valores vazios usam um travessão discreto. Texto/número/URL continuam salvando ao sair do campo; seleções e booleanos usam menus. Os formulários e a Planilha mantêm sua apresentação própria.

A barra da Lista oferece agrupamento, até cinco critérios de ordenação, filtros AND/OR/NOT, busca, modo de subtarefas, cálculos, presets e CSV. A página **Campos e visualizações** continua responsável pela gestão de definições e também pode editar as consultas salvas.

### Controles no cabeçalho

Os controles ficam na linha do título/caminho da página, junto ao nome do projeto, módulo ou visualização. **Exportar CSV** reúne campos visíveis/todos os campos; **Agrupar**, **Ordenar**, **Filtrar campos**, **Subtarefas**, **Campos** e **Buscar** abrem painéis compactos. Opções ativas recebem destaque. **Personalizar** reúne busca em campos ocultos e cálculos; **Presets** reúne seleção, criação, compartilhamento e gestão das consultas salvas. A explicação dos presets aparece dentro desse menu.

Os painéis se ajustam à largura da tela, fecham por Escape/clique externo e preservam os providers da Lista por portal. A criação contextual fica no mesmo cabeçalho. Ao trocar de layout, a barra da Lista é desmontada e a criação nativa reaparece. No celular os controles usam ícones com nomes acessíveis, sem manter formulários abertos acima da tabela.

### Semântica dos resultados

- No **Ordenar da barra superior**, carregar tarefas ou atualizar contagens não desabilita **Aplicar ordem**. O botão e os critérios ficam protegidos apenas durante o salvamento da consulta, com o texto **Aplicando ordem…**. Atualizações substituídas por uma nova ordenação não devem sobrescrever o estado de carregamento nem apresentar erros de uma requisição anterior.
- Escolher uma ordem em **Exibir → Ordenar por** substitui os critérios personalizados ativos da mesma Lista, inclusive ao clicar na opção nativa que já estava selecionada. A nova escolha é persistida na consulta pessoal; **Manual** remove os critérios e habilita a ordem pessoal. Filtros, agrupamento e posições manuais são preservados.
- A API filtra e ordena antes de paginar. A seleção única ordena pela sequência das opções na definição; seleção múltipla não oferece ordenação. Cada critério declara direção e posição dos nulos; o desempate final é o UUID.
- Agrupar por seleção múltipla pode repetir uma tarefa em vários grupos. Totais, cálculos, seleção global e CSV contam/exportam entidades únicas. O filtro remove ocorrências incompatíveis: filtrar por uma opção não cria automaticamente ocorrências nas demais.
- A busca abrange identificador, UUID, título, descrição e valores dos campos visíveis. A opção explícita de incluir campos ocultos amplia essa busca. Números, datas, booleanos e rótulos de opções também são pesquisáveis.
- **Recolhidas/expandidas:** consulta, totais e exportação consideram os pais. Filhos expandidos são contexto autorizado, independentemente dos filtros dos pais. **Separadas:** cada tarefa/subtarefa participa da consulta uma vez, sem expansão adicional. A expansão usa o limite nativo de três níveis.
- A ordem manual é pessoal, isolada por usuário/contexto, preset, tipo de agrupamento e grupo. Não altera `Issue.sort_order`. Movimentos entre grupos continuam sendo alterações compartilhadas das propriedades das tarefas. Reordenar uma página preserva as posições pessoais de itens ainda não carregados.
- A criação contextual infere somente igualdades escalares inequívocas em AND. OR, NOT, intervalos e filtros multiselect não geram defaults. O grupo explícito pode definir seu valor. Campos obrigatórios encaminham para o formulário completo.

### Persistência e concorrência

`Field`, `Value`, `Change`, `SavedView` e `NativeLayoutPreference` permanecem as fontes de dados. A configuração de consulta tem `schema_version: 2`; filtros planos antigos continuam aceitos. As migrações aditivas `0005` e `0006` acrescentam configurações/revisão/bloqueio e convertem consultas antigas sem remover filtros ou valores.

Presets privados/compartilhados usam `SavedView`, revisão e bloqueio. `config.columns` define a visibilidade dos campos personalizados; a ordem, larguras e posições manuais são pessoais. Projetos autorizados, módulos, ciclos, Views de projeto/workspace, Views padrão e arquivo possuem contextos próprios. Rotas de perfil, equipes/teamspaces e épicos não recebem esse contrato.

Edições customizadas enviam o valor esperado: uma edição concorrente responde **409**, preservando o valor mais recente. Após gravar, os caches existentes são revalidados e a consulta/contagens são recarregadas. A Lista restaura o foco quando possível ou informa que a tarefa mudou de posição/grupo/página.

### Limites e exportação

| Operação            | Contrato                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Árvore de filtros   | Até 100 nós e 5 níveis                                                                                                                    |
| Ordenação           | Até 5 critérios                                                                                                                           |
| Grupos customizados | 25 itens por grupo/página; “Load more” busca a página daquele grupo                                                                       |
| Expansão            | Lotes de até 100 pais; máximo de 2000 filhos por resposta                                                                                 |
| Seleção global      | Snapshot de até 2000 IDs únicos, válido por 5 minutos; exceder o limite retorna erro, sem truncar silenciosamente                         |
| Alteração em lote   | Confirmação na interface, rechecagem de permissões e resultado por tarefa; repetição do mesmo token/operação retorna o resultado anterior |
| CSV                 | Até 10000 tarefas e 10 MB; autorização, deduplicação, valores tipados e proteção contra fórmulas                                          |

O CSV é tabular e único, sem reproduzir as ocorrências dos grupos ou a hierarquia visual. As colunas-base são ID, título, estado, prioridade, início e prazo. **Campos visíveis** acrescenta os campos personalizados visíveis na ordem pessoal; **Todos os campos** acrescenta todos os campos ativos autorizados. A seleção global personalizada é distinta das operações nativas sobre itens carregados.

## Pontos de integração

| Mecanismo existente           | Integração                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serviços GET e stores nativos | `native-list-query-context.ts` associa a consulta somente aos GETs paginados da Lista montada; mantém os DTOs e envelopes nativos                           |
| Filtros e paginação da API    | `query.py`, `ComplexFilterBackend`, `order_issue_queryset` e paginadores aplicam a consulta antes da página; `hentis_server_order` impede reordenação local |
| Editores da Planilha          | `NativeCustomCell` e `SPREADSHEET_COLUMNS` são reutilizados nas células da Lista                                                                            |
| Seleção, ações e hierarquia   | Componentes nativos preservados; filhos são carregados em lotes pelo store de subtarefas existente                                                          |
| Redimensionamento             | Mesmo provider de larguras; cabeçalho/linha compartilham a grade CSS, sem padding externo na linha; wrappers da virtualização cobrem a largura total        |
| Imagem backend                | `hentis/Dockerfile.backend` inclui os três pontos de integração de filtro/ordem/paginação, além do módulo e serializer                                      |

## Ordenação por setor em módulos e ciclos — 27/10/2026

- Reproduzido o caso de **Setor da pendência**, sem agrupamento: o critério era salvo, mas crescente/decrescente não mudavam a posição das tarefas. Os stores de módulo/ciclo consultam também o endpoint geral do projeto com `module=<id>` ou `cycle=<id>`; o binding anterior reconhecia somente os endpoints aninhados e deixava de enviar a consulta avançada nessas leituras.
- O binding agora reconhece as duas formas de leitura, exigindo o identificador exato do módulo/ciclo. Leituras sem escopo, de outro alvo, com vários identificadores ou de outro layout não recebem a consulta desse contexto. A paginação mantém os filtros e critérios.
- Chromium com API/PostgreSQL isolados: módulo de teste com 18 tarefas e três setores intercalados. Antes, a direção não alterava as posições; depois, os setores ficaram ordenados conforme as opções e a direção oposta inverteu a sequência. A ordenação persistiu após reload.
- **182 testes de backend e 29 testes frontend direcionados aprovados**, com cobertura de seleção crescente/decrescente em projeto, módulo e ciclo, inclusive pelo endpoint geral filtrado. TypeScript, build, Ruff e OxLint aprovados. O ensaio não utiliza os dados de produção do usuário.

## Validação do cabeçalho — 26/10/2026

- Botão Aplicar da barra superior: reproduzido o bloqueio mantendo uma leitura HTTP pendente no Chromium. Após o ajuste, Aplicar permaneceu habilitado com tarefas/contagens pendentes, bloqueou somente durante o PATCH dos critérios e permitiu alternar decrescente/crescente antes do fim da atualização. Resultado final persistido após reload, sem alerta de requisição substituída. TypeScript, build, lint e 27 testes direcionados aprovados. Ensaio usa API/PostgreSQL isolados com atraso controlado no transporte, sem dados de produção.
- Ordenação: 46 testes frontend direcionados aprovados, incluindo regressões de substituição dos critérios, prioridade, datas e isolamento por contexto. Navegador com API/PostgreSQL isolados verificou ordem numérica crescente/decrescente, substituição pela opção nativa, persistência após reload e repetição da mesma opção nativa depois de aplicar outro critério personalizado. Typecheck, build e lint aprovados.
- Refinamento posterior: 44 testes frontend direcionados, TypeScript, build e OxLint aprovados. Navegador com sessão/API/PostgreSQL isolados confirmou os sete tipos sem fundo/borda de formulário, persistência/restauração de texto e booleano, barra junto ao título em 1440/1024 px e barra compacta com 32 px de altura em 390 px. O novo botão Plane AI abre o painel ao lado da busca global nas três larguras. Os erros globais já documentados de hidratação/intake da fixture continuam fora do escopo desse ajuste visual.
- Typecheck, build web e OxLint aprovados; **25 testes** dos helpers de Lista, exibição e larguras aprovados.
- Chromium autenticado com API/PostgreSQL isolados: os nove menus abriram e fecharam por Escape em **1440, 1024 e 390 px**, com painéis dentro da largura da tela. A barra foi localizada no slot do cabeçalho, junto às visualizações.
- Troca Lista → Kanban → Lista confirmou desmontagem/restauração da barra e retorno do botão nativo de criação no Kanban. Screenshots locais conferidos em desktop e celular, incluindo a barra compacta em uma linha no celular.
- O ensaio mantém os erros globais de hidratação 418/423 já documentados e ausência do estado de intake na fixture (404). A verificação acima é local e não representa deploy em produção.

## Matriz de evidências locais — 22/10/2026

Fonte de partida: `c17bf3e0e2f84861ff5772bf2addb40848d13b94`, Plane CE v1.4.2. Esta validação usa PostgreSQL real e dados descartáveis; não comprova implantação em produção.

| Capacidade                                              | Evidência                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DTO nativo, filtros tipados, árvore, busca e multissort | `plane.custom_fields.test_list`, incluindo paginação e grupos nativos/customizados                                                                                                                                                           |
| Sete tipos, opções/cores e conflito de edição           | Testes de edição de todos os tipos e atualização concorrente 409; regressões anteriores de campos                                                                                                                                            |
| Permissões e convidados                                 | Testes de consulta/export/bulk e de filhos/contagens que não expõem outros criadores                                                                                                                                                         |
| Preferências e presets                                  | Testes de isolamento por usuário/layout/contexto, migração, revisão/bloqueio e limpeza após exclusão                                                                                                                                         |
| Operações em lote                                       | Snapshot, repetição idempotente e resultado parcial quando uma tarefa é arquivada após a seleção                                                                                                                                             |
| Ausência de query da Lista                              | Teste real dos endpoints sem `hentis_query`, preservando paginação/ordem/envelope nativos                                                                                                                                                    |
| Helpers frontend                                        | `hentis/tests/native-list.test.ts`: migração de configuração, defaults, ordem parcial, isolamento dos bindings e páginas por grupo                                                                                                           |
| Suíte backend                                           | **116 testes aprovados**: `plane.custom_fields` + `plane.ai`                                                                                                                                                                                 |
| Suíte frontend                                          | **44 testes aprovados**, incluindo 10 novos testes da Lista                                                                                                                                                                                  |
| Verificações estáticas                                  | Typecheck web, build de produção, Ruff e `makemigrations --check --dry-run` aprovados; OxLint sem erros, com avisos herdados nos componentes nativos                                                                                         |
| Navegador real                                          | Chromium headless, build de produção, sessão real, 60 tarefas e 7 campos no banco isolado; edição persistida, busca antes da paginação, sort numérico, recolhimento com `aria-expanded`, resize por teclado e largura persistida após reload |
| Alinhamento e rolagem                                   | Todas as fronteiras de cabeçalho/célula com **0 px** de diferença; mesma medida com zoom CSS de 125%; campos à direita permanecem montados após rolagem horizontal                                                                           |
| Paginação por grupo                                     | Dois grupos de 30 tarefas: 25 iniciais por grupo; “Load more” em cada grupo resulta em **60 IDs únicos carregados**, sem itens restantes ou alertas                                                                                          |

O ensaio detectou erros de hidratação React **418/423** na inicialização global. Eles também foram reproduzidos na Home do workspace, sem a Lista montada. O servidor de desenvolvimento e o `serve` deste ambiente também apresentaram falhas nas dependências existentes; a validação funcional utilizou o bundle de produção servido estaticamente. Esses resultados não equivalem a uma inicialização global livre de erros nem a uma homologação em produção.

### Reproduzir as verificações

No diretório `apps/api`, com as dependências e PostgreSQL isolado:

```bash
python manage.py test plane.custom_fields plane.ai --settings=plane.ai.test_settings --noinput
python manage.py makemigrations --check --dry-run --settings=plane.ai.test_settings
```

Na raiz, após instalar dependências e compilar os pacotes internos:

```bash
pnpm --filter @plane/i18n exec tsx --test ../../hentis/tests/native-list.test.ts
pnpm --filter web check:types
pnpm --filter web build
```

Os testes automatizados e o smoke devem usar bancos distintos: o fixture do navegador persiste preferências, enquanto testes de isolamento verificam um banco inicialmente vazio. Sessões, credenciais e dados do smoke ficam fora do Git.

A suíte completa de 44 testes frontend está enumerada no job `web-test` de `.github/workflows/hentis-build.yml`. O tema escuro também foi conferido no navegador: larguras persistidas, sem alertas de interação e com 0 px de diferença entre cabeçalhos e células.
