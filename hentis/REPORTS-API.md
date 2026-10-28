# API de leitura para relatórios

O backend customizado oferece páginas e campos personalizados pela API v1, usando a chave pessoal do Plane no cabeçalho `X-API-Key`. A chave mantém as permissões do seu proprietário.

| Método | Caminho após `/api/v1`                                                         | Resultado                                                         |
| ------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| GET    | `/workspaces/{slug}/projects/{project_id}/pages/`                              | Listagem paginada das páginas permitidas, com título e link `url` |
| GET    | `/workspaces/{slug}/projects/{project_id}/pages/{page_id}/`                    | Metadados, link `url` e conteúdo `description_html`               |
| GET    | `/workspaces/{slug}/projects/{project_id}/custom-fields/`                      | Definições dos campos do projeto                                  |
| GET    | `/workspaces/{slug}/projects/{project_id}/custom-fields/values/?ids=uuid,uuid` | Valores por ID de tarefa, até 100 IDs                             |

Exemplo, definindo `PLANE_API_TOKEN` no ambiente, sem colocar a chave no endereço:

```powershell
$headers = @{ 'X-API-Key' = $env:PLANE_API_TOKEN }
$root = 'https://seu-plane/api/v1/workspaces/seu-workspace/projects/ID-DO-PROJETO'
$pages = Invoke-RestMethod -Uri ($root + '/pages/?per_page=100') -Headers $headers
$pages.results | Select-Object id, name, url
```

A listagem usa o envelope padrão do Plane: `results`, `next_cursor` e `next_page_results`. Enquanto `next_page_results` for verdadeiro, envie `cursor=next_cursor` na próxima consulta. `per_page` aceita de 1 a 100. O conteúdo HTML é retornado somente na consulta de uma página específica.

As rotas exigem associação ativa ao workspace e ao projeto, preservam páginas privadas e as restrições de convidados. O projeto não pode estar arquivado. A leitura segue o comportamento desta edição CE para páginas raiz; páginas excluídas e vínculos removidos não são retornados. Nenhuma rota permite escrita ou registra visita à página.

O Dockerfile customizado inclui os módulos no backend. O pipeline de validação executa os testes do complemento com os modelos e o PostgreSQL reais. Não há migração de banco. As rotas só ficam disponíveis na instância depois de construir e implantar uma imagem com esta alteração, pelo processo de atualização existente no repositório de deployment `Hantking/plane`.
