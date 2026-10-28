# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Minimal URL root exercising the actual public API route registry."""

from django.urls import include, path

urlpatterns = [path("api/v1/", include("plane.api.urls"))]
