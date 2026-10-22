import { useState } from "react";
import type { TIssue } from "@plane/types";
import { CreateUpdateIssueModal } from "@/components/issues/issue-modal/modal";
import { useNativeList } from "./native-list-context";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";

export function NativeListCreateButton({ defaults }: { defaults: Partial<TIssue> }) {
  const [open, setOpen] = useState(false);
  const list = useNativeList();
  const storeType = useIssueStoreType();
  return (
    <>
      <button
        type="button"
        className="w-full border-b border-subtle px-3 py-2 text-left text-13 text-accent-primary"
        onClick={() => setOpen(true)}
      >
        + Nova tarefa · formulário completo
      </button>
      {open && (
        <CreateUpdateIssueModal
          storeType={storeType}
          isOpen
          data={defaults}
          onClose={() => {
            setOpen(false);
            void list?.reload();
          }}
        />
      )}
    </>
  );
}
