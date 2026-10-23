# Campos personalizados Hentis para Plane CE

## Plane AI

O módulo de IA integrado oferece chat expansível, catálogo de modelos do provedor, seletor unificado de modelos, busca contextual, relatórios com tabelas/CSV, ferramentas, escrita, memória e automações. Configuração e operação em [PLANE-AI.md](PLANE-AI.md); evidências em [PLANE-AI-VALIDATION.md](PLANE-AI-VALIDATION.md). Configuração sem segredos: [plane-ai.env.example](plane-ai.env.example).

Base oficial: `makeplane/plane`, release em `upstream.json`. Branch de customização: `hentis/custom-fields`.

## Utilização

A evolução da **Lista nativa por colunas**, com consultas, presets, subtarefas, operações em lote e CSV, está detalhada em [NATIVE-LIST.md](NATIVE-LIST.md), incluindo contratos, limites e matriz de validação.

Na página de tarefas do projeto, abra **Campos e visualizações**. Administradores podem cadastrar campos de texto, número decimal, data, sim/não, seleção única, seleção múltipla e URL. Na gestão é possível editar o tipo, arquivar/reativar ou excluir definitivamente um campo. Opções têm IDs estáveis; opções em uso não são removidas isoladamente e campos arquivados mantêm os dados.

Os valores aparecem na criação e nos detalhes das tarefas e nas colunas da tabela nativa do projeto. Na página **Campos e visualizações**, é possível filtrar com E/OU, ordenar por campos tipados, escolher colunas, salvar Views privadas/compartilhadas e agrupar listas/Kanban por seleção ou sim/não. Cada grupo é paginado no servidor; arrastar cartões ou usar o seletor do cartão muda o valor do campo. Campos numéricos/texto/data podem ser filtrados e ordenados; não geram grupos arbitrários de Kanban.

### Exibição nos layouts nativos

Os campos estão incorporados aos layouts **Planilha, Lista, Kanban, Calendário e Cronograma/Gantt**, nas telas de itens do projeto, módulos, ciclos e Views. Abra **Exibir/Display → Propriedades → Campos personalizados e ordem** para marcar/desmarcar campos e arrastar ou usar as setas para escolher a sequência.

Também são suportadas as Views padrão do workspace: Todos os itens, Atribuídos, Criados e Inscrições, cada uma com preferências independentes.

Na Planilha e na Lista, campos personalizados podem ficar entre as propriedades padrão, com cabeçalhos alinhados e larguras independentes por layout. No Kanban, a ordem é usada nas propriedades dos cartões. Calendário e Gantt mostram os campos de forma compacta nos cartões/linhas e barras, preservando as datas usadas pelo layout. Título/identificador permanecem fixos na posição nativa.

Visibilidade dos campos personalizados e ordem são preferências pessoais salvas no servidor, separadas por usuário, projeto/módulo/ciclo/View e layout. A visibilidade das propriedades padrão continua usando o mecanismo original do Plane. As Views de workspace carregam apenas projetos autorizados; colunas de diferentes projetos são qualificadas pelo identificador do projeto.

Os valores são consultados em lotes, evitando uma chamada por cartão/campo. Convidados continuam limitados às próprias tarefas quando o projeto assim determina. Editar um valor nos detalhes atualiza os layouts nativos; excluir um campo também limpa suas referências nas preferências. A migração `0003_nativelayoutpreference` adiciona somente a tabela dessas preferências.

### Datas relativas

Campos de data e intervalos selecionados mostram **hoje** em `#B69277`, **amanhã**, **ontem**, o dia da semana de 2 a 5 dias no futuro e **há X dias** de 2 a 5 dias no passado. Fora dessa janela, exibem a data normal; datas com mais de 5 dias no passado usam fonte vermelha. Os tooltips mantêm a data completa. A comparação usa dias de calendário no fuso do usuário, preserva valores `YYYY-MM-DD` e se atualiza na virada do dia; os valores salvos continuam sendo datas normais.

### Largura das colunas da Planilha

Arraste a borda direita do cabeçalho de qualquer coluna para ajustar sua largura, incluindo **Tarefa**, **Criado em**, **Atualizado em** e campos personalizados. A prévia acompanha o movimento e a largura é salva ao soltar. Um clique duplo na borda restaura o tamanho padrão daquela coluna.

A borda também pode receber foco pelo teclado: **←/→** ajustam 10 px, **Shift + ←/→** ajustam 50 px e **Home** restaura o padrão. **Escape** cancela um arraste em andamento. Os limites são 80–1200 px por coluna, com mínimo de 160 px para Tarefa.

As larguras são preferências pessoais, separadas pelo mesmo usuário/contexto da Planilha, e persistem no servidor após recarregar ou entrar novamente. Ajustar uma coluna preserva as larguras das demais, a ordem e a visibilidade. A migração aditiva `0004_nativelayoutpreference_column_widths` adiciona apenas um campo JSON à tabela de preferências.

Filtros/Views personalizados estão disponíveis na página dedicada e na barra da Lista nativa. Fórmulas, campos de usuário, dashboards agregados e integração automática com APIs externas/importadores continuam fora deste módulo.

Campos obrigatórios são validados na criação nativa da tarefa e ao limpar um campo. Tarefas existentes não são bloqueadas em alterações não relacionadas. Quick-add sem os campos obrigatórios deve utilizar o formulário completo. Os rascunhos mantêm o comportamento oficial e preenchem os campos quando convertidos em tarefas pelo formulário.

## Arquitetura

### Seleção única e múltipla com cores

Em **Gerenciar campos do projeto**, cada opção de seleção tem um seletor **Cor de fundo** e uma prévia da caixa colorida. A mesma caixa é usada nos formulários, detalhes, tabelas, filtros, cartões e cabeçalhos de grupos. O texto recebe contraste automático; o administrador configura apenas o fundo.

A cor é metadado opcional `color: "#RRGGBB"` na opção. Opções antigas sem cor recebem fundo neutro na interface, mantendo IDs, valores preenchidos e filtros. Não há alteração de esquema ou migração de dados para essa melhoria.

A seleção múltipla permite marcar/desmarcar várias opções no menu, com uma caixa colorida por rótulo. Os filtros permitem **contém alguma**, **contém todas**, **não contém nenhuma**, vazio e preenchido. Em quadros agrupados, uma tarefa aparece em cada rótulo selecionado, mas a contagem total de tarefas continua única. Arrastar de um rótulo para outro troca somente aquele rótulo e mantém os demais; mover para **Sem valor** limpa a seleção (exceto se obrigatório).

### Editar tipos, arquivar e excluir

O tipo pode ser alterado em **Editar → Tipo**. Todos os valores existentes são validados antes da gravação, e a conversão é atômica. Seleção única → múltipla preserva IDs e cores; múltipla → única exige no máximo uma opção por tarefa. Seleção → texto conserva os nomes das opções. Texto → número/data/URL exige valores compatíveis; texto → seleção exige correspondência com uma opção. Se existir valor incompatível, a definição e os dados permanecem intactos e a API informa as tarefas a corrigir.

As Views salvas são ajustadas ao novo tipo; condições que não podem ser representadas são removidas. Arquivar oculta o campo e preserva os valores para reativação. **Excluir** pede confirmação e remove a definição, seus valores e seu histórico, limpando referências das Views sem excluir tarefas nem outros campos.

A migração aditiva `0002_value_option_values_alter_field_kind_and_more` adiciona a lista JSON das escolhas e um índice GIN. As colunas dos tipos anteriores e seus valores são preservados.

- Django app isolado `plane.custom_fields` (label `hentis_fields`) com migrações próprias.
- Tabelas `hentis_custom_*` sem colunas extras na tabela oficial de tarefas.
- Sessão/permissões do Plane, incluindo limitação de convidados às próprias tarefas.
- Valores tipados, filtros antes de paginação, histórico e alterações atômicas com criação/edição nativa.
- Campos de projetos antigos não são expostos quando uma tarefa é transferida a outro projeto; os valores permanecem preservados no banco.
- O backend customizado deriva da imagem oficial do mesmo release e inclui os módulos e pontos de integração enumerados em `hentis/Dockerfile.backend`. API, worker, beat e migrator devem usar esse mesmo digest.
- Frontend compilado a partir desta branch com o Dockerfile oficial.

## Atualizações

`Hentis Sync Plane upstream` consulta releases estáveis e faz merge preservando esta branch. Conflitos, major e avisos de incompatibilidade param o processo e geram Issue. Após sync bem-sucedido, `Hentis Validate and Build` testa e publica imagens GHCR **ARM64**, como o servidor instalado, e um release com `custom-release.json`.

As imagens GHCR devem estar públicas para o host puxá-las sem credenciais. Após a primeira publicação, o dono deve abrir cada package no GitHub → Package settings → Change visibility → Public, ou provisionar autenticação de leitura no host. A publicação de código/imagens não aplica migrações no servidor de produção.

O repositório de deployment continua separado em `Hantking/plane`. Ele deve consumir exclusivamente releases customizados testados, manter todos os quatro serviços backend no mesmo digest, fazer backup e só então chamar o deploy do Easypanel. Não use o atualizador direto de imagens oficiais depois de habilitar a customização.

## Testes

```bash
# PostgreSQL local/CI, sem dados de produção
export SECRET_KEY=test-key
export REDIS_URL=redis://127.0.0.1:6379
export DATABASE_URL=postgresql://postgres:password@localhost:5432/plane
python manage.py test plane.custom_fields plane.ai --settings=plane.ai.test_settings --noinput
```

Execute o comando acima em `apps/api` com as dependências da API. Para frontend, na raiz: `pnpm install --frozen-lockfile`, `pnpm exec turbo run build --filter='web^...'`, `pnpm --filter web check:types`, `pnpm --filter web build`.

O deployment aplica as migrações aditivas de `hentis_fields`; rollback de banco requer backup compatível, não apenas trocar a imagem. A licença original AGPL-3.0 e os avisos upstream continuam válidos; código fonte desta customização está neste fork.
