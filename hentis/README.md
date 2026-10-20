# Campos personalizados Hentis para Plane CE

Base oficial: `makeplane/plane`, release em `upstream.json`. Branch de customização: `hentis/custom-fields`.

## Utilização

Na página de tarefas do projeto, abra **Campos e visualizações**. Administradores podem cadastrar campos de texto, número decimal, data, sim/não, seleção única e URL. Edite/arquive definições na mesma página. Opções têm IDs estáveis; opções em uso não são removidas e campos arquivados mantêm os dados.

Os valores aparecem na criação e nos detalhes das tarefas e nas colunas da tabela nativa do projeto. Na página **Campos e visualizações**, é possível filtrar com E/OU, ordenar por campos tipados, escolher colunas, salvar Views privadas/compartilhadas e agrupar listas/Kanban por seleção ou sim/não. Cada grupo é paginado no servidor; arrastar cartões ou usar o seletor do cartão muda o valor do campo. Campos numéricos/texto/data podem ser filtrados e ordenados; não geram grupos arbitrários de Kanban.

Os filtros/Views personalizados estão nessa página dedicada, não no menu de filtros padrão de todas as telas oficiais. Isso concentra os pontos de integração e reduz conflitos upstream. Não há fórmulas, multi-seleção, campos de usuário, dashboards agregados ou suporte automático a APIs externas/importadores neste primeiro módulo.

Campos obrigatórios são validados na criação nativa da tarefa e ao limpar um campo. Tarefas existentes não são bloqueadas em alterações não relacionadas. Quick-add sem os campos obrigatórios deve utilizar o formulário completo. Os rascunhos mantêm o comportamento oficial e preenchem os campos quando convertidos em tarefas pelo formulário.

## Arquitetura

- Django app isolado `plane.custom_fields` (label `hentis_fields`) com migrações próprias.
- Tabelas `hentis_custom_*` sem colunas extras na tabela oficial de tarefas.
- Sessão/permissões do Plane, incluindo limitação de convidados às próprias tarefas.
- Valores tipados, filtros antes de paginação, histórico e alterações atômicas com criação/edição nativa.
- Campos de projetos antigos não são expostos quando uma tarefa é transferida a outro projeto; os valores permanecem preservados no banco.
- O backend customizado deriva da imagem oficial do mesmo release e adiciona o módulo e três pontos de integração. API, worker, beat e migrator devem usar esse mesmo digest.
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
python manage.py test plane.custom_fields --settings=plane.custom_fields.test_settings --noinput
```

Execute o comando acima em `apps/api` com as dependências da API. Para frontend, na raiz: `pnpm install --frozen-lockfile`, `pnpm exec turbo run build --filter='web^...'`, `pnpm --filter web check:types`, `pnpm --filter web build`.

O deployment usa a migração aditiva `hentis_fields.0001_initial`; rollback de banco requer backup compatível, não apenas trocar a imagem. A licença original AGPL-3.0 e os avisos upstream continuam válidos; código fonte desta customização está neste fork.
