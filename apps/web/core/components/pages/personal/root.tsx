import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { observer } from "mobx-react";
import { useUser } from "@/hooks/store/user";
import { Header } from "@plane/ui";
import { PageIcon } from "@plane/propel/icons";
import { AppHeader } from "@/components/core/app-header";
import { PageHead } from "@/components/core/page-title";
import { RelativeDate } from "@/components/dates/relative-date";
import { fieldError, fieldInputClass } from "@/components/custom-fields/service";
import { personalPagesService } from "./service";
import { PersonalCreatePageModal } from "./create-page-modal";
import { useAppRouter } from "@/hooks/use-app-router";

export const PersonalPagesRoot = observer(function PersonalPagesRoot() {
  const { workspaceSlug } = useParams();
  const workspace = workspaceSlug?.toString() ?? "";
  const userId = useUser().data?.id;
  const router = useAppRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const { data, error, isLoading, mutate } = useSWR(
    workspace && userId ? ["personal-pages", userId, workspace, search, scope, archived, page] : null,
    () => personalPagesService.list(workspace, { search, scope, archived: archived ? "1" : "0", page })
  );
  return (
    <>
      <PageHead title="Páginas" />
      {createOpen && data?.creatable_projects && (
        <PersonalCreatePageModal
          key={`${workspace}:${userId}`}
          workspace={workspace}
          projects={data.creatable_projects}
          onClose={() => setCreateOpen(false)}
          onCreated={(id, project) => {
            setCreateOpen(false);
            void mutate().catch(() => undefined);
            router.push(`/${workspace}/projects/${project}/pages/${id}/`);
          }}
        />
      )}
      <AppHeader
        header={
          <Header>
            <Header.LeftItem>
              <PageIcon className="size-4" />
              <span>Páginas</span>
            </Header.LeftItem>
            <Header.RightItem>
              <button
                type="button"
                disabled={!!error || !data?.creatable_projects?.length}
                onClick={() => setCreateOpen(true)}
                className="rounded bg-accent-primary px-3 py-1.5 text-13 font-medium text-on-color disabled:opacity-50"
              >
                + Nova página
              </button>
            </Header.RightItem>
          </Header>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <h1 className="text-20 font-semibold">Páginas</h1>
        <p className="mt-1 text-13 text-secondary">
          Suas páginas e as compartilhadas com você em todos os projetos deste workspace.
        </p>
        {data && !error && !data.creatable_projects?.length && (
          <p className="mt-2 text-13 text-secondary">
            Para criar páginas, você precisa ser membro ou administrador de um projeto com Páginas habilitado.
          </p>
        )}
        <div className="my-4 flex flex-wrap items-center gap-3">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchDraft.trim());
              setPage(1);
            }}
          >
            <input
              aria-label="Buscar páginas"
              maxLength={200}
              className={fieldInputClass}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Buscar pelo título"
            />
            <button type="submit" className="rounded border border-subtle px-3 py-1 text-13">
              Buscar
            </button>
          </form>
          <label className="flex items-center gap-2 text-13">
            Mostrar
            <select
              aria-label="Mostrar páginas"
              className={fieldInputClass}
              value={scope}
              onChange={(event) => {
                setScope(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">Todas</option>
              <option value="mine">Minhas páginas</option>
              <option value="shared">Compartilhadas comigo</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-13">
            <input
              type="checkbox"
              checked={archived}
              onChange={(event) => {
                setArchived(event.target.checked);
                setPage(1);
              }}
            />
            Incluir arquivadas
          </label>
        </div>
        {error ? (
          <div role="alert" className="text-13 text-danger-primary">
            <p>{fieldError(error)}</p>
            <button type="button" onClick={() => void mutate()} className="mt-2 underline">
              Tentar novamente
            </button>
          </div>
        ) : isLoading || !data ? (
          <p role="status">Carregando páginas…</p>
        ) : (
          <>
            <p className="mb-3 text-13 text-secondary">{data.count} página(s)</p>
            {!data.results.length ? (
              <p className="rounded border border-subtle p-6 text-13 text-secondary">
                Nenhuma página encontrada. Páginas privadas de outras pessoas e projetos sem acesso não aparecem aqui.
              </p>
            ) : (
              <ul className="divide-y divide-subtle rounded border border-subtle">
                {data.results.map((item) => (
                  <li key={item.id}>
                    <Link href={item.url} className="flex items-start gap-3 p-4 hover:bg-layer-transparent-hover">
                      <PageIcon className="mt-1 size-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-14 font-medium break-words">{item.name || "Sem título"}</div>
                        <p className="mt-1 text-12 text-secondary">
                          {item.project_identifier} · {item.project_name}
                        </p>
                        <p className="mt-1 text-11 text-tertiary">
                          {item.mine ? "Minha página" : "Compartilhada comigo"}
                          {item.archived ? " · Arquivada" : ""} · Atualizada <RelativeDate value={item.updated_at} />
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex items-center gap-3 text-13">
              <button
                type="button"
                className="rounded border border-subtle px-3 py-1 disabled:opacity-50"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </button>
              <span>
                Página {page} de {Math.max(1, Math.ceil(data.count / data.page_size))}
              </span>
              <button
                type="button"
                className="rounded border border-subtle px-3 py-1 disabled:opacity-50"
                disabled={page * data.page_size >= data.count}
                onClick={() => setPage(page + 1)}
              >
                Próxima
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
});
