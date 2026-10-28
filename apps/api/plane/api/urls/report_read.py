# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.api.views.report_read import (
    ReportFieldsEndpoint,
    ReportFieldValuesEndpoint,
    ReportPageEndpoint,
    ReportPagesEndpoint,
)

prefix = "workspaces/<str:slug>/projects/<uuid:project_id>/"
urlpatterns = [
    path(prefix + "pages/", ReportPagesEndpoint.as_view(), name="report-pages-read"),
    path(prefix + "pages/<uuid:page_id>/", ReportPageEndpoint.as_view(), name="report-page-read"),
    path(prefix + "custom-fields/", ReportFieldsEndpoint.as_view(), name="report-fields-read"),
    path(prefix + "custom-fields/values/", ReportFieldValuesEndpoint.as_view(), name="report-field-values-read"),
]
