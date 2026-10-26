# Evidências de validação — Plane AI

## Evidências e relatórios executivos completos

- Cenário de regressão baseado na comparação enviada: registro importado em 18/10, datas de atendimento de junho a outubro no texto, nove comentários, tarefa aberta, campo de etapa antigo e próximo contato antigo versus atualização de 22/10.
- Verificadas descrição além dos 2200 caracteres, informação após os 4000 caracteres do comentário, campos de seleção com rótulo legível, conflitos preservados e ausência de alteração automática dos campos cadastrais.
- O cabeçalho do contexto não usa mais a data técnica de importação como período da implantação. A ficha distingue datas mencionadas, perguntas/verificações, afirmações a conferir e indicadores operacionais.
- Validados `finish_reason=length` em JSON e SSE, continuação da linha interrompida em `| 22/1`, soma de uso do provedor, limite de continuações, correção de seções e bloqueio de página/PDF quando o relatório permanece incompleto. Recusa do provedor não é contornada e revogação durante a continuação impede publicação.
- A ficha registra cobertura e hashes dos trechos enviados; lacunas intermediárias não são marcadas como leitura completa. Uma página anterior produzida pela IA não é reutilizada como evidência primária para perpetuar uma conclusão errada.
- **175 testes de backend e 57 de frontend aprovados**, com PostgreSQL real. Typecheck, build web, Ruff e OxLint aprovados; nenhuma migração pendente.
- Chromium autenticado: relatório com nove seções, anexo operacional recolhido e página real criada. A fixture HTTP cortou a linha em `22/1` com `finish_reason=length`; a execução registrou três chamadas totais, uma continuação e término `stop`, com validação sem seções faltantes e cobertura integral das fontes primárias selecionadas.
- PDF real de três páginas foi baixado e analisado: nove seções, datas completas de 22/10 e 27/10, fontes e análise antes do anexo operacional. A confirmação administrativa de criação da página não faz parte do corpo exportado.
- Relatórios finais têm nove seções e indicadores de tarefa em anexo operacional. A confirmação de publicação fica fora do corpo do relatório compartilhável. Não há novas tabelas/migrações.
- Testes usam PostgreSQL real e fixtures de protocolo/geração, sem acesso ao provedor ou aos dados reais de produção do cliente. A qualidade factual do texto do modelo real continua exigindo homologação sobre as fontes reais.
- Suporte introduzido após `4db1f39`; exige a imagem com esta atualização e novo deploy antes de afetar novas gerações no servidor. Documentos já existentes não são sobrescritos.

## Relatórios de implantação por cliente e eventos SSE

- Reprodução do pedido “crie o resumo final da implantação do cliente En do Couto e Luciano do Couto, crie como relatório” em dados isolados, com uma descrição antiga e comentário mais recente sobre reunião/FDC. O transporte HTTP de teste devolve os mesmos envelopes textuais `<tool_call><function=search_workspace>…` do incidente; eles são convertidos em buscas reais e não aparecem como resposta.
- O relatório considera somente a implantação e subtarefas relacionadas. Um conjunto de três tarefas foi separado de 60 tarefas sem relação, e a página foi criada automaticamente com o link no chat, sem habilitar ferramentas gerais. O conteúdo da página usa Markdown seguro, fontes e tabelas do snapshot.
- Resolvido o HTTP 406 que ocorria quando o navegador solicitava os eventos com `Accept: text/event-stream`; negociação agora retorna 200/stream. No ensaio, um evento de erro de conexão foi simulado durante a geração e a conclusão chegou com o link da página, sem alerta permanente ou reabertura manual.
- Casos automatizados incluem o pedido exato, preservação do comentário recente/descrição antiga no contexto, fontes restritas, publicação privada, reentrega sem duplicação, homônimos com seleção posterior por identificador, ausência de registros, modelo sem ferramentas, correção de formato, resposta vazia e negação de escrita para convidado.
- **160 testes de backend e 57 de frontend aprovados**. Typecheck, build web, Ruff e OxLint aprovados; nenhuma migração pendente. O teste SSE usa o cabeçalho real do EventSource e verifica 200/stream e negação para outro usuário.
- O provedor HTTP do ensaio é uma fixture de protocolo e a geração assíncrona usa uma thread de teste. Isso verifica busca, integração, persistência e UI; não comprova qualidade factual de inferência no provedor do usuário nem equivale a criar o relatório com os dados de produção do cliente.
- Suporte introduzido após o build `e1fd90f`; exige a imagem com esta correção e novo deploy para corrigir novas execuções no servidor. Respostas antigas com estatísticas genéricas devem ser refeitas.

## URLs completas no Environment — 23/10/2026

- `PLANE_AI_ALLOWED_HOSTS` aceita URLs completas de API, hostnames antigos ou ambos, separados por vírgulas/quebras de linha. A autorização usa o hostname exato extraído da URL.
- **146 testes de backend aprovados**: nove novos casos verificam URLs completas, compatibilidade, formatação, URLs inválidas, comparação exata de hosts, controles de HTTP/IP privado e uma consulta real ao catálogo HTTP com a Base URL inteira na variável.
- Ruff e formatação aprovados. As verificações de rede/IP e o pinning DNS permanecem no mesmo fluxo de requisição.
- Suporte introduzido após o build `a72b9b5`; requer a imagem que contém este ajuste e novo deploy para funcionar no servidor.

## PDF e páginas de relatório — 23/10/2026

- **137 testes de backend aprovados**, incluindo nove novos casos de exportação/publicação: snapshot imutável, HTML/tabelas/fontes, projeto autorizado, propriedade da conversa, revogação, convidado, visibilidade, repetição idempotente e bloqueio de conteúdo executável.
- Typecheck e build web aprovados; a interface reutiliza o gerador `PDFDocument`/`@react-pdf/renderer` já empregado na exportação nativa de páginas, carregado sob demanda.
- Chromium autenticado baixou um PDF real de **28247 bytes e duas páginas**. O arquivo foi aberto com um parser PDF; a extração confirmou **Tarefas: 60**, **Atrasadas: 3**, nome do projeto, análise e fontes.
- A ação de criação de página foi exercitada no chat: título personalizado, projeto selecionado e visibilidade privada. O link abriu a página no editor nativo, com a análise e as tabelas de 60 tarefas/3 atrasadas presentes no conteúdo editável.
- O ambiente isolado não executa o serviço colaborativo `live`; o editor exibiu conteúdo e campos editáveis, mas o ensaio não comprova autosave/sincronização colaborativa em produção. Os erros globais de hidratação já registrados continuam sendo uma limitação do ambiente.
- O backend usa os serializers/modelos nativos `Page`/`ProjectPage` e registra `create_report_page` em `Action`; nenhum CRUD paralelo ou migração nova. A credencial do provedor não participa dos documentos.
- Documento PDF/página é obtido do snapshot autorizado no servidor, sem nova inferência. Publicar novamente com a mesma chave retorna a página existente; mudar os parâmetros com a mesma chave retorna 409.

## Reformulação do chat e catálogo — 23/10/2026

Referência de experiência: [ClickUp Brain](https://clickup.com/lp/brain), com foco no chat, seleção de modelos e relatórios com contexto. Alterações locais sobre a base `2ef087c994185210ad9c9defcf8079fd6dc38c0d`.

| Verificação              | Resultado                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend completo         | **128 testes aprovados** em PostgreSQL real; inclui catálogo, preservação de credencial, permissões, relatórios completos, períodos e ferramentas de leitura       |
| Frontend completo        | **56 testes aprovados**; inclui seleção/remoção de modelos, padrão automático, catálogo, CSV e renderização Markdown real                                          |
| TypeScript, build e lint | Typecheck e build web aprovados; OxLint dos componentes/testes novos com zero avisos/erros; Ruff aprovado                                                          |
| Banco                    | `makemigrations --check --dry-run`: nenhuma nova migração necessária                                                                                               |
| Catálogo no navegador    | Chromium + sessão real + API Django: descoberta de três modelos antes de salvar, habilitação de Gemini e troca do padrão, gravação e teste da conexão              |
| Chat no navegador        | Claude e GPT em mensagens da mesma conversa, modelo preservado ao recarregar, fontes e Markdown/tabelas renderizados, fechar/reabrir preservando as duas mensagens |
| Relatório real           | Banco isolado com 60 tarefas e 3 atrasadas; cartão mostrou esses totais e tabela por projeto, calculados pelo backend antes da amostragem                          |
| Layout responsivo        | Conferência em 1440 px e 390 px, sem overflow horizontal do diálogo; histórico em sobreposição no mobile                                                           |

O catálogo e o transporte de geração do ensaio usam um **servidor HTTP de contrato local**, não um modelo comercial. As tarefas, sessões, permissões, relatórios e persistência usam a aplicação e o PostgreSQL reais. Isso comprova integração e apresentação; homologação de inferência e capacidades exige a conexão do usuário com seu provedor.

O ensaio também reproduziu os erros globais de hidratação React 418/423 já registrados na validação da Lista. A reformulação não foi implantada no servidor de produção.

### Mudanças de experiência

- Conectar provedor → carregar catálogo → pesquisar/filtrar famílias → habilitar modelos → escolher padrão → salvar/testar. IDs manuais e parâmetros JSON ficam em opções avançadas.
- Um único seletor no chat reúne todos os modelos autorizados. Automático utiliza o padrão da primeira conexão habilitada; seleções explícitas removidas não fazem fallback silencioso.
- Chat amplo/expansível com sugestões, histórico, respostas Markdown, fontes, copiar/salvar resposta e resultados de ações com nomes legíveis.
- `report_workspace` agrega todos os itens autorizados por projeto/responsável/estado/prioridade, com período, contagens únicas e CSV. O relatório de mês anterior continua funcionando mesmo se a amostra da semana atual estiver vazia.
- Renderer Markdown atualizado para a versão compatível com a cadeia `mdast-util-to-hast` fixada no projeto. Teste real verifica tabelas e bloqueio de HTML executável/URLs JavaScript.

## Entrega inicial — 21/10/2026

Data: **21/10/2026**. Base: Plane CE `v1.4.2`, customização Hentis. Ambiente isolado ARM64, PostgreSQL 17; produção/CI do projeto usam PostgreSQL 15. Dados e credenciais de produção não foram utilizados.

## Resultados locais

| Verificação                                                                         | Resultado                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Django, `plane.ai` + `plane.custom_fields`                                          | **91 testes aprovados**: 43 do módulo AI e 48 regressões dos campos personalizados    |
| Testes TypeScript Hentis                                                            | **34 aprovados**: incluindo 4 de escrita/prévia segura e 7 de datas relativas         |
| Deployment                                                                          | **10 aprovados**, incluindo propagação dos parâmetros AI aos quatro processos backend |
| TypeScript da aplicação e geração de rotas                                          | Aprovados                                                                             |
| Build dos pacotes dependentes e aplicação web, cliente/servidor                     | Aprovados                                                                             |
| Ruff no módulo AI; OxLint nos novos componentes e arquivos compartilhados alterados | Aprovados                                                                             |
| Migrações pendentes de geração                                                      | Nenhuma                                                                               |
| Contrato Compose                                                                    | 13 serviços, digests/volumes/migração/grafo e Compose CLI aprovados                   |
| Registro Celery                                                                     | `plane.ai.generate`, `plane.ai.schedule` e agendamento beat confirmados               |

Comando backend (em `apps/api`, com banco isolado):

```bash
python manage.py test plane.ai plane.custom_fields --settings=plane.ai.test_settings --noinput
python manage.py makemigrations --check --dry-run --settings=plane.ai.test_settings
```

No ambiente relocável deste workspace foi necessário `TEST_DATABASE_TIME_ZONE=GMT0`; isso não altera a configuração do banco de produção.

Comandos frontend (raiz do fork):

```bash
pnpm exec turbo run build --filter='web^...'
pnpm --filter web check:types
pnpm --filter web build
pnpm --filter @plane/i18n exec tsx --test ../../hentis/tests/option-colors.test.ts ../../hentis/tests/selection-values.test.ts ../../hentis/tests/native-display.test.ts ../../hentis/tests/table-widths.test.ts ../../hentis/tests/plane-ai-writing.test.ts ../../hentis/tests/relative-dates.test.ts
```

## Critérios exercitados

| Critério                                    | Evidência                                                                                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Administração de conexão por URL/key/modelo | API cria configuração, cifra a key, retorna somente `has_api_key`; membro comum recebe 403                                                                              |
| Alternância de modelos                      | Orquestrador recebe dois IDs autorizados diferentes, com parâmetros/capacidades distintos, sem mudar código                                                             |
| Atrasos corretos e links                    | Consulta SQL exclui tarefa concluída, conta tarefa realmente atrasada e retorna sua URL/UUID reais, com fuso do usuário                                                 |
| Criação/edição real                         | Ferramentas criam `Issue`, atualizam título/prioridade/descrição; repetição da ação não cria outra tarefa                                                               |
| Outras operações                            | Comentário, etiqueta, ciclo, módulo, relação, página e subtarefa verificados nos modelos oficiais                                                                       |
| Campos Hentis                               | Campo obrigatório bloqueia criação incompleta; preenchimento válido e tarefa são gravados atomicamente                                                                  |
| Isolamento                                  | Projeto sem associação, outro workspace, convidado, conversa de outro usuário e página privada negados                                                                  |
| Revogação/exclusão                          | Histórico é bloqueado após revogar associação, excluir comentário ou transformar memória compartilhada em pessoal                                                       |
| Mudanças na semana                          | Atividades reais de módulos entram no relatório mesmo sem alteração do timestamp pai                                                                                    |
| Ambiguidade                                 | Pessoas e títulos repetidos exigem UUID/identificador explícito; o registro não é alterado por tentativa ambígua                                                        |
| Confirmação/retry                           | Lote aguarda confirmação, segunda confirmação não repete alterações; retry após escrita confirmada não chama novamente o modelo                                         |
| Falha parcial                               | Criação de tarefa é preservada e substituição insegura de página colaborativa é recusada com motivo concreto                                                            |
| Cancelamento                                | Execução em cancelamento não pode ser repetida concorrentemente; cancelamento de stream não é sucesso                                                                   |
| Capacidades                                 | Mensagens de sistema, tools, streaming e parâmetro de saída são omitidos quando não declarados                                                                          |
| Protocolo real HTTP                         | Fixture HTTP local verifica JSON, SSE incremental, EOF incompleto, erro 401 sem corpo sensível, listagem e vetor de embeddings                                          |
| Dados ausentes                              | Zero resultados em relatório gera resposta factual do backend, sem inferência ou tarefas inventadas                                                                     |
| SSRF                                        | Hosts fora da lista, IPs privados sem autorização e metadados são bloqueados; conexão usa IP validado                                                                   |
| Memória/automação                           | Preferência pessoal não aparece a outro usuário; scheduler cria histórico privado, respeita frequência/limite; política automática bloqueia campos/operações excedentes |
| Fila nativa                                 | Histórico/notificação da criação é enfileirado uma única vez após commit                                                                                                |
| Escrita segura                              | HTML gerado é escapado; alteração remota ou mudança da seleção invalida a prévia                                                                                        |

A UI foi integrada às rotas, navegação, store de tarefas e referências dos editores; passou por typecheck e build. Isso **não equivale a uma sessão autenticada de navegador em produção**.

## O que ainda depende de homologação operacional

- Nenhuma credencial de inferência real foi fornecida. O servidor HTTP dos testes é uma fixture de protocolo; não comprova qualidade de um modelo comercial/local.
- Configurar uma conexão real, testar dois modelos e validar geração/tool calling com o provedor escolhido.
- A publicação executa o CI ARM64 e gera um manifesto aprovado para consumo no deployment. Confirme o resultado do workflow e o commit/digests do lock antes de implantar.
- Aplicar as duas migrações `plane_ai`, configurar as quatro variáveis de ambiente, reiniciar API/worker/beat e habilitar a política do workspace.
- Verificar no navegador login, painel/seleção, edição colaborativa, fluxo completo de cancelamento e interface após operações reais.
- Entrega real pelo RabbitMQ, notificações conforme preferências e testes de carga/recuperação não foram declarados como executados.

Limitações funcionais e instruções completas estão em [PLANE-AI.md](PLANE-AI.md). Configuração sem segredos reais: [plane-ai.env.example](plane-ai.env.example).
