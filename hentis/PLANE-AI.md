# Plane AI — configuração, arquitetura e operação

## Base inspecionada

Plane **Community Edition v1.4.2**, fork Hentis; Python/Django 5.2/DRF, PostgreSQL, Celery com RabbitMQ, Redis/Valkey, `django-celery-beat`; frontend React/TypeScript, React Router/Vite, MobX, SWR, editor Tiptap/Yjs. O backend customizado deriva da imagem oficial ARM64. Não há serviço adicional nesta implementação.

Pontos reutilizados: sessões `BaseSessionAuthentication`; modelos de workspace/projeto/membros/itens/páginas/ciclos/módulos; `IssueCreateSerializer` (incluindo campos obrigatórios Hentis), `IssueCommentSerializer`, `PageSerializer` e `PageDetailSerializer`; modelos de associação e histórico `IssueActivity`; hooks e referências do editor; componentes/cores do produto. A integração legada de geração em `app/views/external/base.py` permanece separada e não fornece contexto nem ferramentas para Plane AI. Busca lexical usa os campos reais já disponíveis (`name`, `description_stripped`), sem índice semântico paralelo.

## Habilitar

1. Compile backend/frontend com este código. O Dockerfile Hentis inclui `plane.ai` e o agendamento Celery atualizado.
2. Defina as variáveis de `hentis/plane-ai.env.example` no **backend/API, worker, beat-worker e migrator**. No Compose do Easypanel, adicionar só uma variável ao painel não a injeta no contêiner: o arquivo Compose também deve referenciá-la.
3. Gere `PLANE_AI_ENCRYPTION_KEY` uma vez, conforme o exemplo. Mantenha a mesma chave em todos os processos e guarde-a junto ao backup dos segredos. As API keys são criptografadas por Fernet no banco. Perder a chave exige cadastrar novamente as credenciais. Para rotação, recifre as conexões com a chave antiga antes de substituí-la; não existe rotação automática nesta versão.
4. Inclua as URLs completas dos provedores em `PLANE_AI_ALLOWED_HOSTS` (por exemplo, `https://openrouter.ai/api/v1,https://api.openai.com/v1`). Hostnames como `openrouter.ai,api.openai.com` continuam aceitos; os dois formatos podem ser misturados, separados por vírgula ou quebra de linha. A API extrai o hostname exato para autorização; caminhos e portas da lista não são restrições de acesso. Não inclua credenciais, query string ou fragmento nas URLs. A Base URL da conexão continua sendo definida na interface. HTTPS é obrigatório por padrão; endpoints privados/locais exigem também `PLANE_AI_ALLOW_PRIVATE_ENDPOINTS=1`, e endereços link-local/metadados continuam bloqueados. Depois de alterar o Environment, faça novo deploy para os processos receberem os valores.
5. Faça backup e execute o migrator normal (`python manage.py migrate`). As migrações `plane_ai.0001_initial` e `0002_run_attempts_run_automation_policy` criam somente tabelas do módulo.
6. Reinicie API, worker e beat. No workspace, abra **Configurações → Inteligência Artificial** e habilite a política. Somente administradores podem configurar conexões/política.

### Conectar e escolher modelos automaticamente

1. Escolha **OpenRouter**, **OpenAI**, **Groq** ou **Outro provedor**. OpenRouter permite disponibilizar famílias como GPT, Claude e Gemini através da mesma conexão compatível.
2. Informe a chave e clique em **Conectar e carregar modelos**. A API consulta o catálogo real do provedor **antes de salvar**; não é necessário digitar IDs de modelo para iniciar a conexão.
3. Use a busca ou os filtros de famílias e marque os modelos que sua equipe poderá usar. A primeira descoberta sugere até três modelos com ferramentas quando disponíveis. O catálogo pode ter até 1000 modelos; cada conexão habilita no máximo 30.
4. Escolha o modelo padrão, salve e use **Testar conexão**. Ao editar uma conexão, o catálogo é carregado automaticamente e os modelos/configurações existentes são preservados.
5. Parâmetros de geração, capacidades individuais, IDs manuais, embeddings, permissões e limites ficam em **Opções avançadas**.

O catálogo utiliza metadados do provedor quando disponíveis e perfis editáveis para famílias conhecidas. Perfis são sugestões de compatibilidade, não comprovação de todas as capacidades. Modelos desconhecidos recebem capacidades conservadoras. A credencial já salva não volta ao navegador; trocar o endereço exige informá-la novamente.

### Configuração avançada de conexões e modelos

- Informe nome, Base URL **incluindo o prefixo da API**, credencial opcional e finalidade `Conversa`.
- Se o provedor não oferecer catálogo, adicione identificadores manuais em **Opções avançadas**; selecione o padrão e os papéis autorizados. É possível cadastrar várias conexões e vários modelos em cada conexão.
- Marque por modelo somente as capacidades realmente suportadas: streaming, tools, system, structured, embeddings, multimodal. Configure `max_tokens`, `max_completion_tokens` ou não enviar parâmetro de saída, conforme o protocolo do modelo.
- Parâmetros opcionais aceitos: `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `seed`, `stop`, `reasoning_effort`. São enviados somente quando configurados naquele modelo. Não são enviados cabeçalhos/campos arbitrários.
- O catálogo usa `GET /models`. Metadados como `supported_parameters` e janela de contexto são aproveitados quando presentes; para famílias conhecidas, a interface inicia com um perfil de compatibilidade. **Testar conexão** envia uma pequena chamada real com as capacidades configuradas; informa se observou uma tool call. Aceitar um schema não comprova que o modelo o executará corretamente.
- **Embeddings** são uma conexão de finalidade separada. O botão Testar faz uma chamada real `POST /embeddings` e verifica o vetor. Eles não são necessários nem usados para indexação nesta versão; a recuperação funciona integralmente por busca lexical autorizada.
- O protocolo implementado é **Chat Completions**. `providers.ADAPTERS` é o ponto de extensão para outros protocolos; Responses não é anunciado como implementado.

API key é um campo de entrada write-only: administradores digitam a credencial no formulário, mas ela nunca é retornada nos GETs, conversas, testes, métricas ou logs. A tela mostra apenas `has_api_key`.

## Usar

- **Plane AI** abre um chat amplo, expansível, com sugestões de busca/relatórios, histórico lateral e respostas Markdown com listas, links e tabelas. Enter envia; Shift+Enter quebra linha. Fechar e reabrir preserva a conversa atual.
- O seletor no compositor reúne modelos de todas as conexões autorizadas, com busca por modelo, família e provedor. A escolha é lembrada por usuário/workspace no navegador. **Automático** usa o modelo padrão da primeira conexão habilitada, em ordem de cadastro; não significa roteamento por benchmark. Uma escolha explícita removida/desautorizada não é substituída silenciosamente.
- Trocar de modelo entre mensagens preserva a conversa e o contexto autorizado. Cada resposta identifica o modelo usado; fontes e resultados das ferramentas aparecem na conversa. **Copiar** e **Salvar resposta** exportam o texto.
- O escopo inicial acompanha a rota da tarefa, projeto ou página; também é possível selecionar workspace/projeto. Uma conversa preserva seu escopo; selecione **Nova conversa** para mudar.
- Perguntas sobre atrasos, bloqueios, mudanças na semana, ciclo atual e prioridades utilizam filtros/contagens/datas do backend. A semana começa na segunda-feira, no fuso do usuário. Itens concluídos/cancelados não contam como atraso. Bloqueios são dependências `blocked_by` ainda abertas e acessíveis.
- Respostas listam fontes reais e o período. Resultados são limitados e a interface sinaliza truncamento. Zero resultados nos relatórios gera uma resposta factual do backend, sem pedir ao modelo que invente dados.
- Relatórios de progresso, atrasos, bloqueios, mudanças, conclusões, tarefas criadas, próximos prazos e carga por responsável usam contagens SQL sobre todos os itens autorizados. A ferramenta `report_workspace` permite escolher período e agrupamento por projeto, responsável, estado ou prioridade. Visão geral é um retrato atual; mudanças/conclusões/criações e prazos possuem períodos explícitos.
- Cartões de relatório mostram totais e tabelas calculadas pelo backend, com exportação CSV. A tabela exibe até 100 grupos; o total não é calculado pela amostra. Em carga por responsável, tarefas com vários responsáveis aparecem em cada pessoa, com aviso para não somar as linhas como total único.
- **Exportar PDF** fica disponível nos cartões de relatório e ao final da resposta concluída. O arquivo A4 usa o gerador de PDF nativo do Plane e inclui análise formatada, tabelas, período/fuso, modelo e fontes com links. A ação no cartão seleciona aquele relatório; a ação da resposta inclui todos os relatórios daquela mensagem.
- **Criar página no Plane** permite escolher título, projeto e visibilidade. O padrão é uma página privada; é possível compartilhar com o projeto. A página é criada pelo serializer nativo, com conteúdo editável e link direto. A ação é explícita na interface e funciona também para modelos sem tool calling.
- PDF e página usam o **snapshot salvo na conversa**, sem chamar novamente o modelo nem recalcular os números. O backend revalida autoria, acesso às fontes e conclusão da resposta em cada exportação; criar página também exige permissão de escrita no projeto escolhido. Repetir a mesma solicitação de publicação não duplica a página.
- Busca lexical também reconhece nomes/identificadores de projetos, responsáveis e etiquetas, além de títulos, descrições e comentários. Expressões usuais de busca são descartadas antes de selecionar os termos relevantes.
- Pedidos de relatório sobre **cliente/implantação identificados** resolvem primeiro os registros autorizados e suas subtarefas. A análise, as contagens e as buscas posteriores ficam restritas a esse conjunto, em vez de gerar uma visão geral do workspace. O contexto inclui datas dos registros, responsáveis e até 100 comentários recentes; os comentários mais novos devem ser confrontados com descrições antigas. Quando há homônimos, ausência de evidência ou conjunto grande demais, a IA pede identificação/refinamento.
- Pedidos explícitos como **“crie o resumo final da implantação do cliente …, crie como relatório”** podem criar uma **página privada automaticamente**, com link real na resposta e registro em `Action`, sem depender do checkbox das ferramentas gerais. O destino deve ser inequívoco e o usuário deve poder editar o projeto; caso contrário, o chat solicita o destino ou informa a falta de permissão. Pedidos de apenas analisar/escrever no chat, rascunhos e solicitações de criar tarefas não acionam essa publicação. A criação reutiliza o snapshot e o serializer nativo e não duplica a página por reentrega da execução.
- Provedores compatíveis que retornam envelopes textuais de ferramentas no conteúdo do assistente são normalizados em chamadas tipadas das ferramentas disponibilizadas. Sintaxe de ferramenta não é transmitida como resposta. Envelopes inválidos recebem no máximo uma tentativa de correção de formato no mesmo modelo; ferramentas desconhecidas ou não autorizadas continuam recusadas.
- O endpoint de eventos aceita `Accept: text/event-stream`. Interrupções transitórias acionam reconexão/consulta de estado, sem exigir reabrir manualmente a conversa. Respostas concluídas recuperadas limpam o aviso de conexão; revogação de acesso continua removendo o conteúdo da tela.

### Relatório final executivo: evidências antes da redação

Pedidos de **resumo/relatório final de um cliente** usam uma ficha de evidências antes da geração:

- Campos personalizados chegam com nome, tipo e valor legível, inclusive rótulos de seleção, sem depender de habilitar ferramentas de alteração.
- Descrição, comentários e páginas primárias são lidos integralmente dentro dos limites de leitura. Para relatório final, até 1000 registros/comentários relacionados podem ser considerados, com até 100000 caracteres por fonte e limite total de leitura de 2 milhões de caracteres. Se houver corte material ou a janela for insuficiente, a execução informa o problema e não publica um relatório final parcial.
- Datas de criação/importação ficam separadas das datas mencionadas no atendimento. Datas sem ano não recebem um ano inventado. O período técnico do registro não é apresentado como período da implantação.
- A ficha conserva candidatos conflitantes e trechos associados à fonte. Um comentário posterior que faz uma pergunta não prova conclusão; campos antigos e afirmações datadas são reconciliados na análise, sem atualizar automaticamente os registros.
- Responsável nativo da tarefa e etiquetas não são tratados automaticamente como CS responsável ou função departamental.
- Páginas de relatórios geradas anteriormente pela IA são identificadas no registro `Action` e excluídas como evidência primária de uma nova consolidação final, evitando realimentar erros de relatórios anteriores. Documentos primários continuam disponíveis.

O relatório final usa nove seções: resumo executivo; dados do cliente; serviços/condições comerciais; estrutura de atendimento; linha do tempo; entregas concluídas; situação por responsável/departamento; pendências/próximos passos; conclusão/divergências cadastrais. Dados ausentes são declarados como não informados. Estado, atraso e contagem de tarefas ficam em **anexo operacional**, recolhido no chat, sem representar um percentual de conclusão do onboarding.

O adaptador registra `finish_reason` em respostas completas e streaming. Se o provedor encerrar por limite de saída, há até três continuações no mesmo modelo, respeitando o limite configurado por chamada, a janela, cancelamento e acesso às fontes. Falta de seções ou tabela interrompida permite uma correção de estrutura. A execução possui um limite global de oito chamadas e não publica se continuar incompleta ou o provedor recusar a geração. As ferramentas gerais de alteração não são expostas durante a elaboração de um relatório final; a página é publicada pelo backend somente após validação.

`Run.context_summary` guarda o manifesto de evidências: fontes, intervalos fornecidos, hashes, cobertura, orçamento estimado, motivos de término e continuações. O cálculo de entrada usa uma **estimativa de tokens sobre os conteúdos das mensagens**, com margem; não conta os escapes extras do JSON de transporte e não é um tokenizer exato do provedor. Os limites existentes da conexão são preservados. A lista pública de fontes e os documentos usam a cobertura registrada e não apresentam uma página anterior excluída como fonte lida. A confirmação/link da página fica em metadados da conversa, separada do corpo executivo exportado.

- O painel aceita escrita livre: descrições, critérios de aceite, planos, checklists, resumos de discussões, relatórios, traduções e notas de versão. Nos editores, **Plane AI · escrever / seleção** envia o texto selecionado ou o documento, abre uma prévia e oferece **Inserir**, **Substituir** ou **Descartar**. A aplicação é recusada se o documento/seleção mudar desde a solicitação. O editor existente persiste a alteração pelo fluxo normal.
- Texto gerado nunca é inserido como HTML arbitrário: é escapado. A descrição da tarefa mantém HTML/JSON coerentes e invalida o cache binário anterior.
- Cancelamento é cooperativo: o backend fecha a chamada ao observar cancelamento e interrompe novas ferramentas. Uma conexão não-streaming pode aguardar seu timeout antes de reconhecer cancelamento. Ações já confirmadas não são desfeitas.

### Ações reais

Para ferramentas gerais de alteração, marque **Permitir executar as alterações que eu solicitar nesta mensagem**. Modelos sem tools continuam disponíveis para perguntas/escrita e para a publicação explícita de relatório pelo backend; não executam as demais ferramentas de alteração. Ferramentas aceitas:

- Criar tarefa/subtarefa; editar título, descrição, prioridade, estado, responsáveis, início e prazo.
- Ler/preencher campos personalizados Hentis existentes, inclusive respeitando obrigatoriedade e tipos na criação.
- Adicionar comentário e etiquetas existentes.
- Associar a ciclo existente (não concluído) ou módulo existente.
- Criar página e atualizar título/conteúdo de páginas não bloqueadas.
- Criar relações/dependências usando tipos reais do Plane.

As ferramentas exigem UUIDs reais, validam membros/estados/etiquetas/projeto/pais e escopo. Referências ambíguas devem ser esclarecidas pelo assistente; não há resolução silenciosa por nome. O backend não executa código, SQL livre, exclusões nem operações desconhecidas.

Nomes de pessoas/tarefas duplicados são bloqueados pelo backend até que a mensagem informe o identificador real (ou o usuário selecione o item/projeto como escopo). Criação/edição de tarefa e comentários utilizam a fila nativa `issue_activity` para histórico/notificações após commit; o registro `Action` é síncrono e idempotente. A entrega de notificações depende dos workers/preferências existentes e não é anunciada como sucesso antecipadamente.

Cada conversa aceita até 100 mensagens; o histórico é limitado e escopado. A recuperação padrão consulta itens e páginas ativos; rascunhos, itens arquivados e triagem não entram na busca de tarefas.

Uma escrita simples explicitamente habilitada pode executar imediatamente. Várias escritas no mesmo lote, escritas subsequentes no mesmo turno e atualização de página exigem prévia/confirmar. A confirmação revalida acesso/regras. Resultados por ação mostram sucesso real e falhas parciais; não há afirmação de entrega de notificação. Atualizações de itens são consultadas novamente pelo store MobX; links levam aos registros reais.

Páginas colaborativas com binário Yjs existente não recebem substituição HTML direta pelo backend: use a prévia no editor, que preserva a colaboração. Essa operação é recusada com explicação em vez de afirmar sucesso.

## Memória e automações

- Memórias pessoais são do usuário; memórias de projeto e compartilhadas são explicitamente administradas. Todas podem ser visualizadas, editadas e apagadas. Conversas nunca são promovidas a conhecimento compartilhado automaticamente.
- Instruções do workspace ficam na política administrativa; preferências pessoais podem ser registradas como memória pessoal.
- Automações têm criador responsável (identidade de execução), escopo, conexão/modelo, instrução reutilizável, intervalo, limite de execuções, próxima execução, último resultado e opção de desativar. Cada execução cria uma conversa privada do responsável; o histórico completo aparece nas conversas.
- Templates cobrem progresso, atrasos/bloqueios, atualização da equipe e sugestão de classificação/prioridade/responsável; instruções podem ser editadas.
- Política padrão: **somente leitura**. Um administrador pode autorizar **limited_writes** para um projeto explícito: no máximo uma escrita por execução, apenas comentário ou alteração de prioridade/estado/responsáveis. Outros campos, criação, exclusão e lote são recusados. A política é copiada para a execução e revalidada no executor.
- O beat verifica a cada 5 minutos; intervalo mínimo 1 hora. Sem beat/worker não há execução. Revogação de acesso/configuração inválida desativa a automação. Relatórios permanecem privados no painel; não são postados em canais externos.

## Segurança e operação

`security.Access` restringe cada consulta a workspace ativo e projetos com associação ativa. Convidados sem acesso integral só consultam tarefas que criaram; páginas privadas só entram para seu proprietário. As mesmas validações são refeitas antes de cada chamada e operação. Histórico/SSE é inacessível se qualquer fonte usada perder autorização. Contagens também rastreiam todos os projetos contribuintes, inclusive além do limite de trechos. Isso é conservador: revogar uma fonte pode ocultar toda a conversa. Apagar a conversa continua possível.

Credenciais ficam criptografadas; chamadas ocorrem no backend. URLs usam allowlist administrativa exata, validação de todos os IPs resolvidos e conexão fixada ao IP validado, com SNI/verificação TLS do hostname original. Redirecionamentos não são seguidos. Não há fallback silencioso de conexão/modelo.

Documentos e comentários são delimitados como dados não confiáveis nas instruções. Isso reduz prompt injection, mas não prova obediência de um modelo externo; a barreira efetiva é autorização, schemas finitos, escopo, consentimento por turno, política das automações e confirmação de alto impacto.

Limites: 2 gerações simultâneas por usuário/workspace; cotas diárias UTC por usuário/workspace; 5 ciclos de ferramentas, 6 chamadas de ferramentas e até 8 chamadas ao provedor por execução, incluindo continuações/correção; busca comum limitada inicialmente a 20 tarefas/8 páginas/20 comentários/30 atividades. Relatórios finais seguem os limites de leitura integral descritos acima. A janela utiliza estimativa conservadora de tokens, não um tokenizer específico. Modelos que não aceitam parâmetro de limite de saída têm somente limites locais de tamanho/tempo; consumo cobrado depende do provedor. Resposta de rede limitada a 2 MB, lista de modelos a 1 MB, timeout por conexão 5–180 s, limite externo do worker. Parâmetros/capacidades incorretos geram erro explícito.

Idempotência: chave UUID única por mensagem/conversa, lock de execução e lock por ação. Reentrega Celery não reexecuta uma geração reclamada. Retry manual é limitado a duas novas tentativas; se houve escrita confirmada, retorna os resultados existentes e não pede um novo plano ao modelo. Execução interrompida não é repetida automaticamente. Não altere as mesmas tarefas simultaneamente durante uma confirmação se for necessário preservar uma versão específica: não há optimistic locking contra edições humanas nesta versão.

`GET /api/workspaces/{slug}/ai/metrics/` é restrito a administradores: contagens por modelo/status, latência e tokens quando informados, sem textos das conversas. Auditoria de ações fica em `Action` e no histórico real da tarefa. Retenção de conversas é configurável (1–365 dias); limpeza pelo beat apaga também ações e resultados vinculados. Conexões usadas devem ser desativadas antes de apagar históricos dependentes.

## APIs do módulo

Prefixo `/api/workspaces/{slug}/ai/`: bootstrap, `settings/`, `catalog/` (POST administrativo, sem persistência da credencial temporária), `connections/` (+ `/{id}/test/`, `/{id}/models/`), `conversations/`, `runs/` (+ `/{id}/events/`, `cancel/`, `retry/`, `approve/`, `reject/`, `report-document/` GET e `report-page/` POST), `memories/`, `automations/`, `metrics/`. Operações administrativas/privadas são verificadas no servidor; IDs adivinhados não concedem acesso. O bootstrap informa `writable_projects` para a escolha de destino da página.

O renderizador de documentos usa `mistune==3.1.3`, fixado nos requirements da API e instalado pelo Dockerfile backend Hentis. Markdown é escapado/sanitizado com o validador nativo de HTML; imagens remotas não são incorporadas aos documentos de relatório. Nenhuma nova tabela/migração foi adicionada para exportação ou publicação: o registro usa `Action` e as páginas nativas.

## Testes e evidências

Resultados e matriz dos critérios verificados: [PLANE-AI-VALIDATION.md](PLANE-AI-VALIDATION.md).

Em `apps/api`, com PostgreSQL isolado e variáveis normais da API:

```bash
python manage.py test plane.ai plane.custom_fields --settings=plane.ai.test_settings --noinput
python manage.py makemigrations --check --dry-run --settings=plane.ai.test_settings
```

Na raiz:

```bash
pnpm exec turbo run build --filter='web^...'
pnpm --filter web check:types
pnpm --filter web build
pnpm exec oxlint --deny-warnings apps/web/core/components/plane-ai
```

Os testes do módulo exercitam banco real e operações reais do Plane. Testes de protocolo usam um servidor HTTP local de contrato, incluindo SSE incremental, modelo sem tools/system/stream, erros sem vazamento, cancelamento e embeddings. Não são evidência de inferência por um provedor comercial/local real. Para homologar um provedor: cadastre dois modelos, teste ambos, consulte atrasos de um projeto de teste, crie/edite uma tarefa com ferramentas e abra os links; repita com usuário sem acesso. Nenhuma credencial de inferência foi fornecida para executar essa homologação neste workspace.

## Limitações objetivas

- Transporte inicial usa autenticação Bearer opcional e Base URL sem query string/credenciais embutidas; cabeçalhos de autenticação proprietários exigem adaptação.
- Sem Responses, anexos multimodais, índice vetorial, OCR ou pesquisa em conteúdo binário de anexos.
- Busca é lexical limitada; pode não recuperar paráfrases. O modelo pode pedir `search_workspace` para refinar. Relevância não é uma busca semântica.
- Não há exclusão de entidades, criação de usuários/projetos/ciclos/módulos/etiquetas, postagem externa, nem execução arbitrária.
- Alterações automáticas limitadas à política documentada; operações em lote/páginas exigem usuário presente.
- Texto dos documentos/comentários e respostas de um modelo externo não são uma fronteira de segurança.
- Sem garantia de qualidade factual do texto livre: métricas/ferramentas/fontes são autoritativas; o usuário deve revisar sugestões.
- Sem validação visual autenticada em produção ou teste de carga/recuperação declarado. Produção exige configurar provedor, migrações, worker/beat e testar o produto no navegador.
