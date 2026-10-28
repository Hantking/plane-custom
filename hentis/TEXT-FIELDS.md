# Texto longo, Telefone e Site

## Uso

- **Texto longo** (`long_text`): até 10000 caracteres, com quebras de linha preservadas. Na Lista, a célula ocupa uma linha; passar o mouse ou focar o botão abre um painel de leitura. Clique, Enter, Espaço ou seta para baixo permitem editar. **Ctrl + Enter** insere uma quebra na posição do cursor; **Enter** salva e fecha, **Esc** cancela a edição ainda não salva. Sair do editor também salva. Formulários e Planilha usam uma área de texto. A edição respeita as permissões e o controle de concorrência existentes.
- **Telefone** (`phone`): números brasileiros com DDD, fixos ou celulares. Aceita dígitos, espaços, parênteses, hífen e o prefixo opcional +55. Armazena 10 ou 11 dígitos locais; ao sair do campo, exibe `(21) 3323-8159` ou `(21) 93323-8159`. Busca e filtro **contém** aceitam trechos do número, inclusive formatados.
- **Site** (`site`): endereços HTTP/HTTPS, até 2000 caracteres. Acrescenta `https://` a domínios sem protocolo. Na Lista, clicar no valor abre uma nova aba; **Editar** abre o controle de edição separado. Não permite protocolos executáveis. O tipo **Link** (`url`) existente continua disponível.
- **Número**: remove somente o preenchimento decimal do armazenamento na apresentação. Não usa conversão para `Number`, agrupamento de milhares ou casas decimais acrescentadas. Aceita ponto ou vírgula como separador decimal digitado; separadores de milhares não são aceitos. Mantém até 14 dígitos inteiros e 6 decimais, sem perda pela precisão numérica do JavaScript.

Para usar em **Pendência principal**, abra **Campos e visualizações → Gerenciar campos do projeto → Editar**, escolha **Texto longo** e salve. A conversão de Texto para Texto longo preserva o conteúdo e as quebras existentes. A atualização não escolhe campos por nome nem altera automaticamente suas definições.

Os novos tipos usam `Value.text_value`, com os mesmos contratos de histórico, persistência, permissões, ordenação, exportação e edição atômica. A migração **`hentis_fields.0007_long_text_phone_site`** amplia as escolhas do tipo, sem reescrever os valores existentes. Antes de executar os processos da nova imagem, aplique as migrações com o fluxo de implantação existente.

## Calendários e criação

Os cabeçalhos dos seletores de data e do layout Calendário usam **2ª · 3ª · 4ª · 5ª · 6ª · sá · do**, identificando segunda a domingo. As abreviações substituem a numeração anterior de 1º a 7º; a ordem das colunas continua respeitando a preferência de início da semana.

O controle **Nova tarefa · formulário completo** acompanha o fluxo de cada seção da Lista. Seu contêiner não é mais um rodapé `sticky`, evitando que fique sobre as tarefas durante a rolagem. A mesma posição é usada pela criação rápida quando disponível.

## Validação local — 28/10/2026

- **195 testes de backend** aprovados em PostgreSQL isolado, incluindo criação/persistência dos novos tipos, conversão atômica, quebras de linha, URLs inválidas, números decimais e busca/filtros da Lista.
- **65 testes de frontend** aprovados, incluindo apresentação decimal sem perda de precisão, máscara de telefone e protocolos dos links.
- TypeScript, build web e do pacote de componentes, Ruff, OxLint sem avisos e `makemigrations --check --dry-run` aprovados.
- Chromium com sessão/API/PostgreSQL isolados: hover, edição por teclado, Ctrl + Enter, cancelamento, gravação e reload com múltiplas linhas; telefone fixo; número `99999999999999.123456` preservado; Site editável e abertura em aba separada; cabeçalhos `1º` a `7º`; dois controles de criação com posição estática. O painel de Texto longo permaneceu dentro da tela em 1366 e 390 px.
- A fixture registrou somente o 404 já conhecido de `intake-state` e os erros globais de hidratação React 418/423 previamente observados no servidor estático do ensaio.
- Publicação e geração de imagens dependem da autenticação GitHub no ambiente. A validação local não representa deploy em produção.
