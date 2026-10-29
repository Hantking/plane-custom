# Estados por módulo e Páginas pessoais do workspace

## Configuração de estados

Em **Configurações do projeto → Estados**, a seção **Estados por módulo** lista os módulos ativos do projeto. Administradores podem:

1. Manter **Todos os estados do projeto**, comportamento padrão para módulos novos e existentes.
2. Desmarcar essa opção, escolher pelo menos um estado e usar **Salvar estados de [módulo]**.
3. Voltar a todos os estados para remover a seleção específica.

A configuração é compartilhada pelo módulo, não uma preferência pessoal. Estados de outro projeto, estados de triagem e módulos arquivados não são aceitos. Membros podem consultar; a alteração exige administração do projeto ou a permissão administrativa equivalente já usada no projeto.

A seleção controla os grupos de estado da **Lista e do Kanban**, incluindo as raias, e as opções do seletor de estado no contexto do módulo. Outros agrupamentos, módulos e páginas de projeto continuam usando seus contextos próprios. Não é uma restrição de transição: uma tarefa pode receber outro estado por uma integração ou fora da visualização do módulo.

**Tarefas existentes não são escondidas nem movidas.** Um estado fora da seleção continua como grupo enquanto tiver tarefas visíveis no módulo; o seletor também conserva o estado atual da tarefa. A leitura de estados ocupados considera todas as páginas de tarefas autorizadas, e convidados não recebem os estados ocupados pelas tarefas de outras pessoas quando o projeto restringe sua visualização.

### Persistência e endpoints

- Migração aditiva **`hentis_fields.0009_module_state_visibility`**, dependente de `0008_optional_datetime` e `db.0123_issue_schedule_times`.
- A tabela `hentis_module_state_visibility` contém uma configuração por módulo. Nenhum estado ou tarefa existente é reescrito.
- `GET /api/workspaces/:slug/projects/:project/module-states/`: módulos, estados do projeto e capacidade de administrar.
- `GET /api/workspaces/:slug/projects/:project/module-states/:module/`: seleção (`state_ids: null` significa todos) e estados ocupados pelas tarefas autorizadas.
- `PATCH` no endpoint do módulo aceita somente `{ "state_ids": ["uuid", ...] }` ou `{ "state_ids": null }`. A atualização é atômica e valida os estados contra o projeto.

## Pessoal → Páginas

O item **Páginas** no menu lateral pessoal abre `/:workspace/pages/`. A lista reúne páginas do usuário e páginas compartilhadas/publicadas nos projetos do **workspace atual**. Cada resultado informa projeto, vínculo pessoal/compartilhado, atualização e arquivamento, com link para o editor de páginas existente.

Há busca por título, filtros **Todas / Minhas páginas / Compartilhadas comigo**, opção **Incluir arquivadas** e paginação de 30 itens. Páginas associadas a mais de um projeto aparecem uma vez, com link por um projeto autorizado. Trocar o workspace altera o escopo da lista.

O botão **Nova página** permite escolher um projeto autorizado, título e visibilidade, criando pelo endpoint nativo e abrindo o editor. Instruções e evidências, junto do novo visual do Quadro: [PAGE-CREATION-AND-KANBAN-COLORS.md](PAGE-CREATION-AND-KANBAN-COLORS.md).

O compartilhamento segue as regras nativas desta edição CE: páginas públicas de projetos acessíveis são compartilhadas; páginas privadas são visíveis somente ao proprietário. A criação anterior de uma página não permite acessar uma página privada transferida para outro proprietário. Associação ativa ao projeto e ao workspace é obrigatória, inclusive para páginas próprias; projetos arquivados/excluídos e vínculos de página removidos não são considerados. Convidados seguem `guest_view_all_features`.

A lista reúne as páginas raiz diretamente navegáveis pelo endpoint nativo de páginas de projeto. Não cria uma nova modalidade de compartilhamento ou um editor paralelo. A API retorna apenas metadados da listagem, sem o corpo do documento.

- `GET /api/workspaces/:slug/personal-pages/` aceita `search`, `scope` (`all`, `mine`, `shared`), `archived=1`, `page` e, opcionalmente, `project`.
- Resposta com `count`, `page`, `page_size`, `results`; links são construídos a partir de vínculos autorizados, sem expor projetos sem acesso.
- Respostas usam `Cache-Control: no-store`; os caches da interface incluem usuário e workspace para evitar reaproveitar metadados entre sessões.

## Validação local — 29/10/2026

- **234 testes de backend** aprovados: 10 novos casos de integração cobrem gravação/reload/reset dos estados, isolamento, payloads inválidos, estados ocupados, convidados, revogação, páginas de múltiplos projetos, privacidade, deduplicação, arquivamento, pesquisa e paginação.
- **69 testes de frontend** aprovados, incluindo ordem dos estados selecionados, conservação do estado atual/ocupado e grupos aninhados com tarefas.
- TypeScript, build web/pacote de constantes, Ruff, OxLint e `makemigrations --check --dry-run` aprovados.
- Chromium com sessão/API/PostgreSQL isolados confirmou salvamento nas configurações, persistência após reload, Lista/Kanban e seletor contextual, conservação de tarefa num estado fora da seleção e isolamento entre dois módulos.
- A lista pessoal mostrou páginas próprias/compartilhadas de dois projetos, omitiu uma página privada alheia e outra de projeto inacessível, filtrou e pesquisou, abriu a página no editor nativo e permaneceu dentro da tela em 390 px.
- Permanecem os erros globais conhecidos da fixture estática (React 418/423 e intake-state 404). O ensaio não utiliza dados de produção e não executa implantação no servidor.
