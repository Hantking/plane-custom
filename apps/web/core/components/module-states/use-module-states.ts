import { useParams } from "next/navigation";
import useSWR from "swr";
import { useUser } from "@/hooks/store/user";
import type { IGroupByColumn } from "@plane/types";
import { moduleStatesKey, moduleStatesService } from "./service";
import { hasGroupItems } from "./helpers";

export function useModuleStates(project?: string) {
  const { workspaceSlug, projectId, moduleId } = useParams();
  const workspace = workspaceSlug?.toString();
  const targetProject = projectId?.toString();
  const module = moduleId?.toString();
  const userId = useUser().data?.id;
  const enabled = !!userId && !!workspace && !!targetProject && !!module && (!project || project === targetProject);
  const { data } = useSWR(
    enabled ? [...moduleStatesKey(workspace!, targetProject!, module), userId] : null,
    () => moduleStatesService.getModule(workspace!, targetProject!, module!),
    { revalidateOnFocus: true }
  );
  return enabled ? data : undefined;
}

export function useModuleStateGroups() {
  const config = useModuleStates();
  return (
    groups: IGroupByColumn[] | undefined,
    groupBy: string | null | undefined,
    grouped: unknown
  ): IGroupByColumn[] | undefined => {
    if (!groups || groupBy !== "state" || config?.state_ids == null) return groups;
    const included = new Set([...config.state_ids, ...config.occupied_state_ids]);
    const items = grouped && typeof grouped === "object" ? (grouped as Record<string, unknown>) : {};
    // Locally moved/created tasks are retained before server configuration refetch.
    return groups.filter(
      (group) =>
        included.has(group.id) ||
        hasGroupItems(items[group.id]) ||
        Object.values(items).some(
          (subgroup) =>
            !!subgroup && typeof subgroup === "object" && hasGroupItems((subgroup as Record<string, unknown>)[group.id])
        )
    );
  };
}
