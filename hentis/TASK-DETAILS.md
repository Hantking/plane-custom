# Horários e acesso rápido na tarefa

## Início e prazo com horário

Abra a data de início ou prazo na tarefa, prévia, Lista ou Planilha. Escolha a data, informe o **Horário (opcional)** e use **Salvar horário** (ou Enter). **Remover horário** mantém a data; remover a data também limpa seu horário.

- As datas nativas continuam sendo datas, sem conversão destrutiva para timestamp.
- A migração aditiva `db.0123_issue_schedule_times` adiciona `start_time`, `target_time` e `schedule_timezone` em `Issue`. Tarefas anteriores continuam sem horário.
- Horários representam a hora local no fuso da tarefa. O primeiro horário usa o fuso do autor; o editor mostra esse fuso e outros membros o preservam.
- O servidor exige data para definir hora, valida o intervalo completo em alterações parciais e rejeita fusos inválidos e horários inexistentes na transição de horário de verão.
- A permissão de editar a tarefa é a mesma das propriedades nativas. Convidados sem edição não podem alterar a agenda.

Exemplo de payload na API nativa de atualização:

```json
{
  "start_date": "2026-11-10",
  "start_time": "09:30",
  "target_date": "2026-11-11",
  "target_time": "17:45",
  "schedule_timezone": "America/Sao_Paulo"
}
```

As APIs de leitura de tarefa/Lista incluem os campos novos. O adaptador de contexto da IA também recebe as horas e o fuso. Calendários e filtros nativos por dia mantêm o contrato de datas existente.

## Barra de acesso rápido à direita

Na página da tarefa, os ícones **Propriedades**, **Comentários**, **Anexos** e **Plane AI** dão acesso ao painel correspondente. Comentários e anexos reutilizam os componentes, APIs e permissões do Plane; o botão da IA abre a conversa com o escopo explícito da tarefa selecionada.

Na prévia estreita/modal, os atalhos levam às seções correspondentes sem desmontar o editor da descrição. Na prévia ampla, o conteúdo usa o painel direito. Abrir a IA e fechá-la mantém a tarefa aberta.

## Mensagem manual na IA

O assistente abre com o compositor vazio. O editor não escolhe automaticamente ações como “melhorar este texto”; o conteúdo selecionado fica anexado separadamente como referência, com opção de remover, e a pessoa escreve o pedido. As sugestões fixas de mensagens iniciais foram retiradas da interface.

## Implantação e validação

O backend Hentis inclui o modelo, serializers, validação e a migração `db.0123`. Faça backup, preserve o Environment existente e conclua o migrator antes de iniciar API/worker/beat com a imagem nova. Não há novas variáveis obrigatórias; a imagem inclui a base IANA `tzdata` para ambientes sem arquivos de fuso do sistema.

A suíte inclui criação/edição, compatibilidade com data sem hora, limpeza, intervalo, fuso, transição de horário de verão e negação para convidado. O ensaio Chromium isolado usa sessão/API/PostgreSQL reais: Lista de módulo composta só por subtarefas, abertura sem ordenação e com crescente/decrescente após reload, gravação de 09:30/17:45 sem mudar os dias, comentário/anexo da tarefa, IA com escopo explícito, compositor vazio e referência do editor. O anexo do ensaio é metadado de fixture; não declara homologação de upload/download no armazenamento de produção.
