import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type AIScope = { kind: "workspace" | "project" | "issue" | "page"; id?: string };
export type AIModel = {
  id: string;
  capabilities: Record<"streaming" | "tools" | "structured" | "system" | "embeddings" | "multimodal", boolean>;
  parameters?: Record<string, unknown>;
  output_parameter?: "max_tokens" | "max_completion_tokens" | "none";
};
export type AIConnection = { id: string; name: string; models: AIModel[]; default_model: string };
export type AICatalogModel = {
  id: string;
  name: string;
  description: string;
  context_tokens: number | null;
  capability_source: "provider" | "profile" | "unknown";
  configuration: AIModel;
};
export type AIBootstrap = {
  enabled: boolean;
  admin: boolean;
  connections: AIConnection[];
  projects: { id: string; name: string }[];
  writable_projects?: { id: string; name: string }[];
};
export type AISource = { kind: string; id: string; title: string; url: string };
export type AIReportDocument = { title: string; html: string; filename: string };
export type AIReport = {
  id: string;
  title: string;
  kind: string;
  group_by: string;
  metrics: { total: number; completed: number; overdue: number; in_progress: number; completion_percent: number };
  period: { from: string; to: string } | null;
  as_of: string;
  timezone: string;
  columns: string[];
  rows: (string | number)[][];
  row_ids: string[];
  truncated: boolean;
  definition: string;
};
export type AIRun = {
  id: string;
  conversation_id: string;
  prompt: string;
  response: string;
  status: string;
  error: string;
  sources: AISource[];
  model: string;
  usage: Record<string, number>;
  latency_ms: number;
  context: {
    scope?: AIScope;
    report?: string;
    period?: { from: string; to: string };
    metrics?: Record<string, unknown>;
    truncated?: boolean;
    timezone?: string;
    reports?: AIReport[];
    activity?: string;
  };
  actions: {
    id: string;
    operation: string;
    arguments: Record<string, unknown>;
    status: string;
    result: Partial<AISource> & { error?: string };
  }[];
};
export type AIConversation = { id: string; title: string; scope: AIScope; runs?: AIRun[] };

class PlaneAIService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }
  path(slug: string, resource = "") {
    return `/api/workspaces/${encodeURIComponent(slug)}/ai/${resource}`;
  }
  async read<T>(slug: string, resource = ""): Promise<T> {
    return (await this.get(this.path(slug, resource))).data;
  }
  async create<T>(slug: string, resource: string, data: object): Promise<T> {
    return (await this.post(this.path(slug, resource), data)).data;
  }
  async update<T>(slug: string, resource: string, data: object): Promise<T> {
    return (await this.patch(this.path(slug, resource), data)).data;
  }
  async remove(slug: string, resource: string) {
    await this.delete(this.path(slug, resource));
  }
  events(slug: string, runId: string) {
    return new EventSource(`${API_BASE_URL}${this.path(slug, `runs/${runId}/events/`)}`, { withCredentials: true });
  }
}
export const planeAI = new PlaneAIService();
export function aiError(error: unknown) {
  const response = error as { response?: { data?: unknown } };
  const detail = response.response?.data;
  return (
    errorMessages(detail).slice(0, 5).join(" ") ||
    "Não foi possível concluir a solicitação. Verifique a conexão e tente novamente."
  );
}
function errorMessages(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(errorMessages);
  if (value && typeof value === "object") return Object.values(value).flatMap(errorMessages);
  return [];
}
export const aiInputClass = "w-full rounded border border-subtle bg-surface-1 p-2 text-13 text-primary";
