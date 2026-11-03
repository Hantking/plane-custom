# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.contrib.auth import login
from django.contrib.auth import logout
from django.conf import settings
import time

from plane.authentication.adapter.error import AUTHENTICATION_ERROR_CODES, AuthenticationException
from plane.authentication.models import AuthenticatorDevice
from plane.utils.path_validator import validate_next_path

# Module imports
from plane.utils.host import base_host
from plane.utils.ip_address import get_client_ip


def user_login(request, user, is_app=False, is_admin=False, is_space=False, skip_mfa=False):
    if (
        not skip_mfa
        and not is_admin
        and not (request.user.is_authenticated and request.user.pk == user.pk)
        and AuthenticatorDevice.objects.filter(user=user).exists()
    ):
        next_path = validate_next_path(request.POST.get("next_path") or request.session.get("next_path"))
        logout(request)
        request.session["authenticator_pending"] = {
            "user_id": str(user.pk),
            "created_at": int(time.time()),
            "is_space": is_space,
            "next_path": next_path,
        }
        request.session.set_expiry(600)
        raise AuthenticationException(
            error_code=AUTHENTICATION_ERROR_CODES["AUTHENTICATOR_REQUIRED"],
            error_message="AUTHENTICATOR_REQUIRED",
        )
    login(request=request, user=user)

    # If is admin cookie set the custom age
    if is_admin:
        request.session.set_expiry(settings.ADMIN_SESSION_COOKIE_AGE)

    device_info = {
        "user_agent": request.META.get("HTTP_USER_AGENT", ""),
        "ip_address": get_client_ip(request=request),
        "domain": base_host(request=request, is_app=is_app, is_admin=is_admin, is_space=is_space),
    }
    request.session["device_info"] = device_info
    request.session.save()
    return
