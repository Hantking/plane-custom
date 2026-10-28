# Campo personalizado Data e hora

## Seleção e apresentação

**Data e hora** (`datetime`) é um novo tipo, separado de **Data** (`date`). Crie-o ou altere uma definição pelo gerenciamento de campos do projeto.

O seletor abre o mesmo calendário do tipo Data, acrescentando **Horário (opcional)**:

1. Selecione o dia. O calendário permanece aberto para permitir escolher a hora na mesma edição.
2. Para salvar somente a data, feche o calendário clicando fora ou no botão do campo.
3. Para acrescentar hora, preencha o relógio e clique em **Salvar horário** ou pressione Enter no relógio. Isso salva a data e o horário juntos.
4. **Remover horário** preserva o dia; limpar o campo remove data e hora.

O horário só é habilitado depois de selecionar uma data. Uma data sem horário não recebe `00:00`; meia-noite é preservada quando escolhida explicitamente. A Lista, Planilha, detalhes, cartões e filtros usam o mesmo tipo. O tipo Data existente continua exibindo somente o calendário.

Os cabeçalhos dos calendários usam **2ª, 3ª, 4ª, 5ª, 6ª, sá e do**. A ordem respeita o início da semana configurado pelo usuário.

## Persistência e consultas

- Valor da API: `YYYY-MM-DD` sem hora ou `YYYY-MM-DDTHH:MM` com hora, por exemplo `2026-11-10T09:30`. `null` limpa o campo.
- A hora é um relógio local associado ao dia escolhido, sem deslocar o dia por conversão UTC. Não representa um instante global com offset/fuso.
- A migração aditiva **`hentis_fields.0008_optional_datetime`** amplia as escolhas do tipo. O valor usa a coluna de texto existente, com formato ISO validado e ordenável. Não altera definições ou valores antigos automaticamente.
- Histórico, permissões, edição concorrente, exportação CSV e API de leitura usam o contrato existente. Busca inclui a data e o horário; filtros oferecem igualdade, diferença, antes/depois, limites inclusivos e vazio/preenchido.
- Comparações consideram o valor completo. Uma data sem hora é distinta de meia-noite explícita e ordena antes dos horários daquele dia.
- **Data → Data e hora** preserva o dia sem inventar horário. **Data e hora → Data** só é permitida se nenhum valor tiver horário; caso contrário, a conversão é cancelada atomicamente para evitar perda. Remova os horários antes de converter.

## Validação local — 28/10/2026

- **224 testes de backend** e **67 de frontend** aprovados, com persistência, histórico, validação, data sem horário, meia-noite explícita, remoção da hora, conversão sem perda, ordenação, filtros, busca e CSV.
- TypeScript, build web/pacote de componentes, Ruff, OxLint sem avisos e `makemigrations --check --dry-run` aprovados.
- Chromium com sessão/API/PostgreSQL isolados: dia e hora selecionados antes de uma única gravação, `09:30` após reload, remoção mantendo o dia, data sem horário salva ao fechar, tipo Data sem relógio, meia-noite explícita, limpeza completa e seletor dentro da tela de 390 px. Cabeçalhos abreviados conferidos.
- O ensaio mantém os erros globais conhecidos da fixture estática (React 418/423 e intake-state 404); não é uma implantação de produção.
