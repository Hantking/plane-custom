# Plane AI — configuração, arquitetura e operação

## Base inspecionada

Plane **Community Edition v1.4.2**, fork Hentis; Python/Django 5.2/DRF, PostgreSQL, Celery com RabbitMQ, Redis/Valkey, `django-celery-beat`; frontend React/TypeScript, React Router/Vite, MobX, SWR, editor Tiptap/Yjs. O backend customizado deriva da imagem oficial ARM64. Não há serviço adicional nesta implementação.

Pontos reutilizados: sessões `BaseSessionAuthentication`; modelos de workspace/projeto/membros/itens/páginas/ciclos/módulos; `IssueCreateSerializer` (incluindo campos obrigatórios Hentis), `IssueCommentSerializer`, `PageSerializer` e `PageDetailSerializer`; modelos de associação e histórico `IssueActivity`; hooks e referências do editor; componentes/cores do produto. A integração legada de geração em `app/views/external/base.py` permanece separada e não fornece contexto nem ferramentas para Plane AI. Busca lexical usa os campos reais já disponíveis (`name`, `description_stripped`), sem índice semântico paralelo.

## Habilitar

1. Compile backend/frontend com este código. O Dockerfile Hentis inclui `plane.ai` e o agendamento Celery atualizado.
2. Defina as variáveis de `hentis/plane-ai.env.example` no **backend/API, worker, beat-worker e migrator**. No Compose do Easypanel, adicionar só uma variável ao painel não a injeta no contêiner: o arquivo Compose também deve referenciá-la.
3. Gere `PLANE_AI_ENCRYPTION_KEY` uma vez, conforme o exemplo. Mantenha a mesma chave em todos os processos e guarde-a junto ao backup dos segredos. As API keys são criptografadas por Fernet no banco. Perder a chave exige cadastrar novamente as credenciais. Para rotação, recifre as conexões com a chave antiga antes de substituí-la; não existe rotação automática nesta versão.
4. Inclua os hosts exatos dos provedores em `PLANE_AI_ALLOWED_HOSTS`. Não há domínio/modelo de provedor predefinido. HTTPS é obrigatório por padrão. Endpoints privados/locais exigem também `PLANE_AI_ALLOW_PRIVATE_ENDPOINTS=1`; endereços link-local/metadados continuam bloqueados.
5. Faça backup e execute o migrator normal (`python manage.py migrate`). As migrações `plane_ai.0001_initial` e `0002_run_attempts_run_automation_policy` criam somente tabelas do módulo.
6. Reinicie API, worker e beat. No workspace, abra **Configurações → Inteligência Artificial** e habilite a política. Somente administradores podem configurar conexões/política.

### Cadastrar conexões e modelos

- Informe nome, Base URL **incluindo o prefixo da API**, credencial opcional e finalidade `Conversa`.
- Adicione identificadores manuais de modelos; selecione o padrão e os papéis autorizados. É possível cadastrar várias conexões e vários modelos em cada conexão.
- Marque por modelo somente as capacidades realmente suportadas: streaming, tools, system, structured, embeddings, multimodal. Configure `max_tokens`, `max_completion_tokens` ou não enviar parâmetro de saída, conforme o protocolo do modelo.
- Parâmetros opcionais aceitos: `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `seed`, `stop`, `reasoning_effort`. São enviados somente quando configurados naquele modelo. Não são enviados cabeçalhos/campos arbitrários.
- **Listar modelos** usa `GET /models` quando disponível. A listagem não descobre capacidades: cada modelo precisa de configuração e **Testar**. O teste envia uma pequena chamada real, com streaming/tools/system conforme declarados; informa se observou uma tool call. Aceitar um schema não comprova que o modelo o executará corretamente.
- **Embeddings** são uma conexão de finalidade separada. O botão Testar faz uma chamada real `POST /embeddings` e verifica o vetor. Eles não são necessários nem usados para indexação nesta versão; a recuperação funciona integralmente por busca lexical autorizada.
- O protocolo implementado é **Chat Completions**. `providers.ADAPTERS` é o ponto de extensão para outros protocolos; Responses não é anunciado como implementado.

API key é um campo de entrada write-only: administradores digitam a credencial no formulário, mas ela nunca é retornada nos GETs, conversas, testes, métricas ou logs. A tela mostra apenas `has_api_key`.

## Usar

- **Plane AI** na navegação abre um painel lateral com conexão/modelo, escopo, histórico, fontes, período, métricas e resultados reais das ferramentas.
- O escopo inicial acompanha a rota da tarefa, projeto ou página; também é possível selecionar workspace/projeto. Uma conversa preserva seu escopo; selecione **Nova conversa** para mudar.
- Perguntas sobre atrasos, bloqueios, mudanças na semana, ciclo atual e prioridades utilizam filtros/contagens/datas do backend. A semana começa na segunda-feira, no fuso do usuário. Itens concluídos/cancelados não contam como atraso. Bloqueios são dependências `blocked_by` ainda abertas e acessíveis.
- Respostas listam fontes reais e o período. Resultados são limitados e a interface sinaliza truncamento. Zero resultados nos relatórios gera uma resposta factual do backend, sem pedir ao modelo que invente dados.
- O painel aceita escrita livre: descrições, critérios de aceite, planos, checklists, resumos de discussões, relatórios, traduções e notas de versão. Nos editores, **Plane AI · escrever / seleção** envia o texto selecionado ou o documento, abre uma prévia e oferece **Inserir**, **Substituir** ou **Descartar**. A aplicação é recusada se o documento/seleção mudar desde a solicitação. O editor existente persiste a alteração pelo fluxo normal.
- Texto gerado nunca é inserido como HTML arbitrário: é escapado. A descrição da tarefa mantém HTML/JSON coerentes e invalida o cache binário anterior.
- Cancelamento é cooperativo: o backend fecha a chamada ao observar cancelamento e interrompe novas ferramentas. Uma conexão não-streaming pode aguardar seu timeout antes de reconhecer cancelamento. Ações já confirmadas não são desfeitas.

### Ações reais

Marque **Permitir executar as alterações que eu solicitar nesta mensagem**. Modelos sem tools continuam disponíveis para perguntas/escrita, mas não podem executar mudanças. Ferramentas aceitas:

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

Limites: 2 gerações simultâneas por usuário/workspace; cotas diárias UTC por usuário/workspace; 5 ciclos de geração e 6 chamadas de ferramentas por execução; até 20 tarefas/8 páginas/20 comentários/30 atividades antes de reduzir a janela. Sem tokenizer específico, o orçamento usa um limite conservador de bytes UTF-8. Modelos que não aceitam parâmetro de limite de saída têm somente limites locais de tamanho/tempo; consumo cobrado depende do provedor. Resposta de rede limitada a 2 MB, lista de modelos a 1 MB, timeout por conexão 5–180 s, limite externo do worker. Parâmetros/capacidades incorretos geram erro explícito.

Idempotência: chave UUID única por mensagem/conversa, lock de execução e lock por ação. Reentrega Celery não reexecuta uma geração reclamada. Retry manual é limitado a duas novas tentativas; se houve escrita confirmada, retorna os resultados existentes e não pede um novo plano ao modelo. Execução interrompida não é repetida automaticamente. Não altere as mesmas tarefas simultaneamente durante uma confirmação se for necessário preservar uma versão específica: não há optimistic locking contra edições humanas nesta versão.

`GET /api/workspaces/{slug}/ai/metrics/` é restrito a administradores: contagens por modelo/status, latência e tokens quando informados, sem textos das conversas. Auditoria de ações fica em `Action` e no histórico real da tarefa. Retenção de conversas é configurável (1–365 dias); limpeza pelo beat apaga também ações e resultados vinculados. Conexões usadas devem ser desativadas antes de apagar históricos dependentes.

## APIs do módulo

Prefixo `/api/workspaces/{slug}/ai/`: bootstrap, `settings/`, `connections/` (+ `/{id}/test/`, `/{id}/models/`), `conversations/`, `runs/` (+ `/{id}/events/`, `cancel/`, `retry/`, `approve/`, `reject/`), `memories/`, `automations/`, `metrics/`. Operações administrativas/privadas são verificadas no servidor; IDs adivinhados não concedem acesso.

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
