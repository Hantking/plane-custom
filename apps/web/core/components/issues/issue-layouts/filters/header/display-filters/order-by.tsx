/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { observer } from "mobx-react";
import { ISSUE_ORDER_BY_OPTIONS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TIssueOrderByOptions } from "@plane/types";

// components
import { FilterHeader, FilterOption } from "@/components/issues/issue-layouts/filters";
import { nativeRequest } from "@/components/custom-fields/native-display-helpers";
import type { NativeOrderChange } from "@/components/custom-fields/native-list-model";

type Props = {
  selectedOrderBy: TIssueOrderByOptions | undefined;
  handleUpdate: (val: TIssueOrderByOptions) => void;
  orderByOptions: TIssueOrderByOptions[];
};

export const FilterOrderBy = observer(function FilterOrderBy(props: Props) {
  const { selectedOrderBy, handleUpdate, orderByOptions } = props;
  // hooks
  const { t } = useTranslation();
  const params = useParams();
  const pathname = usePathname();

  const [previewEnabled, setPreviewEnabled] = useState(true);

  const activeOrderBy = selectedOrderBy ?? "-created_at";

  return (
    <>
      <FilterHeader
        title={t("common.order_by.label")}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div>
          {ISSUE_ORDER_BY_OPTIONS.filter((option) => orderByOptions.includes(option.key)).map((orderBy) => (
            <FilterOption
              key={orderBy?.key}
              isChecked={activeOrderBy === orderBy.key}
              onClick={() => {
                handleUpdate(orderBy.key);
                const detail: NativeOrderChange = {
                  workspace: params.workspaceSlug?.toString() ?? "",
                  context: nativeRequest(params, "list", pathname ?? ""),
                  orderBy: orderBy.key,
                };
                window.dispatchEvent(new CustomEvent("hentis-native-list-order", { detail }));
              }}
              title={t(orderBy.titleTranslationKey)}
              multiple={false}
            />
          ))}
        </div>
      )}
    </>
  );
});
