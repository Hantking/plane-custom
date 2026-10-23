import { useState } from "react";
import { Popover } from "@headlessui/react";
import { Check, ChevronDown, Search, Sparkles } from "lucide-react";
import type { AIConnection } from "./service";
import { availableModels, resolveModel } from "./model-helpers";

export function AIModelPicker({
  connections,
  value,
  onChange,
  disabled = false,
}: {
  connections: AIConnection[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const current = resolveModel(connections, value);
  const models = availableModels(connections).filter((item) =>
    `${item.model.id} ${item.family} ${item.connection.name}`.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <Popover className="relative">
      <Popover.Button
        disabled={disabled}
        aria-label="Escolher modelo de IA"
        className="flex max-w-72 items-center gap-2 rounded-lg border border-subtle px-3 py-2 text-13 hover:bg-layer-1"
      >
        <Sparkles size={14} className="shrink-0 text-accent-primary" />
        <span className="truncate">{value === "auto" ? "Automático" : (current?.model.id ?? "Escolher modelo")}</span>
        <ChevronDown size={13} className="shrink-0" />
      </Popover.Button>
      <Popover.Panel
        className="shadow-xl absolute bottom-full left-0 z-50 mb-2 w-80 max-w-[85vw] rounded-xl border border-subtle bg-surface-1 p-2"
        aria-label="Modelos disponíveis no chat"
      >
        {({ close }) => (
          <>
            <div className="flex items-center gap-2 border-b border-subtle p-2">
              <Search size={15} />
              <input
                aria-label="Buscar modelo de IA"
                className="min-w-0 flex-1 bg-transparent outline-none"
                placeholder="Buscar modelo ou provedor…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="my-1 flex w-full items-center justify-between rounded-lg p-2 text-left hover:bg-layer-1"
              onClick={() => {
                onChange("auto");
                close();
              }}
            >
              <span>
                <strong className="block text-13">Automático</strong>
                <span className="text-11 text-secondary">Usa o modelo padrão da conexão principal</span>
              </span>
              {value === "auto" && <Check size={15} />}
            </button>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {models.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className="flex w-full items-center justify-between gap-2 rounded-lg p-2 text-left hover:bg-layer-1"
                  onClick={() => {
                    onChange(item.key);
                    close();
                  }}
                >
                  <span className="min-w-0">
                    <span className="block text-11 text-accent-primary">
                      {item.family} · {item.connection.name}
                    </span>
                    <span className="block truncate text-13 font-medium">{item.model.id}</span>
                    <span className="text-11 text-secondary">
                      {item.model.capabilities.tools ? "Contexto, busca e ferramentas" : "Contexto e conversa"}
                    </span>
                  </span>
                  {value === item.key && <Check size={15} className="shrink-0" />}
                </button>
              ))}
              {!models.length && (
                <p className="p-3 text-13 text-secondary">
                  Nenhum modelo encontrado. Habilite modelos nas configurações de IA.
                </p>
              )}
            </div>
          </>
        )}
      </Popover.Panel>
    </Popover>
  );
}
