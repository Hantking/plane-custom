# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Module imports
from ..base import BaseAPIView
from plane.db.models.workspace import WorkspaceUserPreference
from plane.app.serializers.workspace import WorkspaceUserPreferenceSerializer
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import Workspace


# Third party imports
from rest_framework.response import Response
from rest_framework import status


class WorkspaceUserPreferenceViewSet(BaseAPIView):
    model = WorkspaceUserPreference
    use_read_replica = True

    def get_serializer_class(self):
        return WorkspaceUserPreferenceSerializer

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)

        preferences = WorkspaceUserPreference.objects.filter(user=request.user, workspace=workspace)
        keys = WorkspaceUserPreference.UserPreferenceKeys
        existing_orders = dict(preferences.values_list("key", "sort_order"))
        missing_keys = [key for key in keys.values if key not in existing_orders]
        initial_orders = {key: 65535 + i * 10000 for i, key in enumerate(missing_keys)}
        if keys.TODO in initial_orders:
            # The sidebar keeps To-do immediately after Stickies when their orders match.
            initial_orders[keys.TODO] = existing_orders.get(keys.STICKIES, initial_orders.get(keys.STICKIES, 65535))

        WorkspaceUserPreference.objects.bulk_create(
            [
                WorkspaceUserPreference(
                    key=key,
                    user=request.user,
                    workspace=workspace,
                    sort_order=order,
                    is_pinned=key in {keys.DRAFTS, keys.YOUR_WORK, keys.STICKIES, keys.TODO},
                )
                for key, order in initial_orders.items()
            ],
            batch_size=10,
            ignore_conflicts=True,
        )

        user_preferences = {}

        for preference in preferences.order_by("sort_order").values("key", "is_pinned", "sort_order"):
            user_preferences[(str(preference["key"]))] = {
                "is_pinned": preference["is_pinned"],
                "sort_order": preference["sort_order"],
            }
        return Response(
            user_preferences,
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def patch(self, request, slug):
        for data in request.data:
            key = data.pop("key", None)
            if not key:
                continue

            preference = WorkspaceUserPreference.objects.filter(
                key=key, workspace__slug=slug, user=request.user
            ).first()

            if not preference:
                continue

            if "is_pinned" in data:
                preference.is_pinned = data["is_pinned"]

            if "sort_order" in data:
                preference.sort_order = data["sort_order"]

            preference.save(update_fields=["is_pinned", "sort_order"])

        return Response({"message": "Successfully updated"}, status=status.HTTP_200_OK)
