# Nova página em Pessoal e Quadro colorido

## Pessoal → Páginas → Nova página

O botão **+ Nova página** abre um formulário com **Projeto**, **Título** e **Visibilidade**. O projeto de destino precisa ter Páginas habilitado e associação ativa do usuário como membro ou administrador. Projetos arquivados, inacessíveis, com Páginas desabilitado e associações de convidado não entram nas opções de criação.

A visibilidade inicial é **Privada — somente você**. O usuário pode escolher **Compartilhada com o projeto**, seguindo o acesso público nativo do Plane, que continua limitado às permissões do projeto. O título é obrigatório, com até 255 caracteres; espaços sozinhos não habilitam o envio.

Após criar, a página abre no **editor nativo do projeto selecionado** e a listagem pessoal é revalidada. A criação usa `ProjectPageService.create` e o endpoint já existente `POST /api/workspaces/:workspace/projects/:project/pages/`; não há um CRUD paralelo. O endpoint nativo continua responsável pela autorização, propriedade e persistência.

O modal bloqueia envio duplicado enquanto a requisição está em andamento. Falhas mantêm o formulário aberto e os dados preenchidos, com mensagem para tentar novamente. Sem projetos elegíveis, o botão fica desabilitado e a tela explica o requisito de acesso.

O `GET /api/workspaces/:workspace/personal-pages/` agora inclui `creatable_projects` com IDs, nomes e identificadores dos destinos autorizados. Essa lista é independente da busca/filtro/página de resultados e segue as mesmas fronteiras de workspace e associação ativa.

## Quadro/Kanban

O visual usa as cores de estado configuradas no projeto:

- **Cabeçalhos:** título e contagem em destaque com fundo do estado e texto com contraste automático.
- **Colunas:** borda superior colorida, contorno suave, cantos arredondados e fundo com 10% da cor misturada à superfície do tema.
- **Cartões:** faixa lateral do estado e um degradê discreto, preservando o texto e as propriedades existentes.
- **Raias:** identificação colorida nos cabeçalhos quando o subagrupamento é por estado. As células também recebem a cor do estado quando ele define a raia.

Em agrupamentos por pessoa, prioridade ou outras propriedades, as colunas não recebem uma cor de estado arbitrária; os cartões continuam sinalizando seu próprio estado. Agrupamentos por categoria de estado usam uma paleta consistente. Cores hexadecimais de três/seis dígitos são aceitas; valores não reconhecidos usam a cor da categoria correspondente.

Os tons suaves usam as superfícies semânticas dos temas **claro e escuro**. O texto dos cabeçalhos escolhe preto ou branco pelo contraste; a seleção da tarefa mantém a borda de destaque. Trocar o estado atualiza a faixa do cartão. Os dados dos estados não são alterados para aplicar o visual.

## Validação local — 29/10/2026

- **237 testes de backend** aprovados: destinos de criação com permissões/feature flag, criação pelo endpoint nativo no projeto escolhido e negação a convidados, além das regressões existentes.
- **72 testes de frontend** aprovados: cores configuradas, normalização segura, agrupamentos e contraste de cabeçalho de pelo menos 4,5:1 nos casos da paleta.
- Após integrar a atualização mobile da branch remota, **90 testes de frontend** aprovados, incluindo navegação/edição mobile e recursos de tradução. Tipos e build foram repetidos para a versão integrada. O ensaio real de criação, Quadro claro/escuro, mudança de estado, detalhes e formulário/Quadro em 390 px também passou nessa versão, sem exceções JavaScript.
- TypeScript, build web, Ruff, OxLint sem avisos e `makemigrations --check --dry-run` aprovados. Esta rodada não acrescenta migrações.
- Chromium com API/PostgreSQL isolados: página privada e compartilhada criadas pelo formulário, redirecionamento para o projeto escolhido, presença na listagem e uma única gravação ao tentar envio duplo. Projetos sem acesso/com Páginas desabilitado foram omitidos; convidado ficou sem criação; formulário coube em 390 px e o diálogo anunciou o título Nova página.
- Quadro conferido visualmente em claro/escuro com três estados de cores diferentes: cabeçalhos e fundos distintos, cartões com faixa de 3 px e degradê. Recolher/expandir colunas, mudar estado com atualização da posição/cor e abrir o detalhe da tarefa funcionaram; os cartões mantiveram sua configuração nativa de arrastar. Em 390 px, o documento permaneceu com 390 px e as colunas mantiveram 350 px com a rolagem interna do Quadro.
- A primeira rodada da fixture registrou os erros globais de hidratação React 418/423 e intake-state 404 já conhecidos. Após a integração mobile, o fluxo repetido registrou somente intake-state 404, sem exceções JavaScript. Os testes não usam dados de produção nem representam deploy no servidor.
