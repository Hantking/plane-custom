import type { AIReport } from "./service";

export const chatStarters = [
  {
    title: "Buscar no workspace",
    detail: "Encontre tarefas, documentos e decisões",
    prompt: "Busque informações sobre ",
  },
  {
    title: "Relatório de progresso",
    detail: "Visão geral, conclusões e riscos",
    prompt: "Faça um relatório de progresso dos projetos, com conclusões, atrasos e riscos. Cite as fontes.",
  },
  {
    title: "Resumo da semana",
    detail: "O que mudou e o que precisa de atenção",
    prompt: "Gere um relatório das mudanças desta semana, com tarefas, responsáveis e próximos passos.",
  },
  {
    title: "Carga da equipe",
    detail: "Distribuição do trabalho por responsável",
    prompt: "Faça um relatório da carga de trabalho por responsável, com totais, conclusões e atrasos.",
  },
  {
    title: "Atrasos e bloqueios",
    detail: "Entenda o que está impedindo o avanço",
    prompt: "Quais tarefas estão atrasadas? Investigue também os bloqueios e sugira próximos passos com fontes.",
  },
  {
    title: "Escrever com contexto",
    detail: "Planos, descrições e atualizações",
    prompt: "Escreva uma atualização executiva sobre o progresso deste escopo, separando fatos de sugestões.",
  },
];

export const actionNames: Record<string, string> = {
  create_issue: "Criar tarefa",
  update_issue: "Atualizar tarefa",
  add_comment: "Adicionar comentário",
  add_labels: "Atualizar etiquetas",
  set_cycle: "Associar ao ciclo",
  add_module: "Associar ao módulo",
  create_page: "Criar página",
  update_page: "Atualizar página",
  relate_issues: "Relacionar tarefas",
  create_report_page: "Relatório salvo como página",
};

export function displayAIResponse(value: string) {
  return value
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .replace(/<(?:tool_call|function=)[\s\S]*$/, "")
    .trim();
}

function safeCSV(value: string | number) {
  let text = String(value);
  if (typeof value !== "number" && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function reportCSV(report: AIReport) {
  return "\uFEFF" + [report.columns, ...report.rows].map((row) => row.map(safeCSV).join(";")).join("\r\n");
}

export function downloadAIFile(text: string, name: string, type = "text/markdown;charset=utf-8") {
  downloadAIBlob(new Blob([text], { type }), name);
}

export function downloadAIBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const element = document.createElement("a");
  element.href = url;
  element.download = name;
  element.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
