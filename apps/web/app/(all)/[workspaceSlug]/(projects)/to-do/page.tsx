/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ListTodo } from "lucide-react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EUserPermissionsLevel, WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs, Header } from "@plane/ui";
import { joinUrlPath } from "@plane/utils";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { PageHead } from "@/components/core/page-title";
import { PersonalTodoBoard } from "@/components/personal-todo/board";
import { useUser, useUserPermissions } from "@/hooks/store/user";

export default observer(function WorkspacePersonalTodoPage() {
  const { workspaceSlug } = useParams();
  const slug = workspaceSlug?.toString() ?? "";
  const { data: user } = useUser();
  const { allowPermissions } = useUserPermissions();
  const { t } = useTranslation();
  const title = t("sidebar.todo");
  const yourWork = WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS["your-work"];
  const assignedHref =
    user && allowPermissions(yourWork.access, EUserPermissionsLevel.WORKSPACE, slug)
      ? joinUrlPath(slug, yourWork.href, user.id, "assigned")
      : undefined;

  return (
    <>
      <PageHead title={title} />
      <AppHeader
        header={
          <Header>
            <Header.LeftItem>
              <Breadcrumbs>
                <Breadcrumbs.Item component={<BreadcrumbLink label={title} icon={<ListTodo className="size-4" />} />} />
              </Breadcrumbs>
            </Header.LeftItem>
          </Header>
        }
      />
      <ContentWrapper>
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
          {assignedHref && (
            <div className="mb-4 flex justify-end">
              <Link href={assignedHref} className="text-body-xs-medium text-link-primary hover:underline">
                {t("personal_todo.assigned")}
              </Link>
            </div>
          )}
          {slug && user?.id && (
            <PersonalTodoBoard key={joinUrlPath(slug, user.id)} workspaceSlug={slug} userId={user.id} />
          )}
        </div>
      </ContentWrapper>
    </>
  );
});
