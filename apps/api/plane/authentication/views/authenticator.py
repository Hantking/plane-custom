# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import time

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.authentication.models import AuthenticatorDevice
from plane.authentication.rate_limit import AuthenticationThrottle, AuthenticatorActionThrottle
from plane.authentication.totp import (
    decrypt_secret,
    encrypt_secret,
    matching_step,
    new_recovery_codes,
    new_secret,
    provisioning_uri,
    recovery_hash,
    verify_device,
)
from plane.authentication.utils.host import base_host
from plane.authentication.utils.login import user_login
from plane.utils.path_validator import get_safe_redirect_url, validate_next_path


@method_decorator(never_cache, name="dispatch")
class AuthenticatorSettingsEndpoint(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"enabled": AuthenticatorDevice.objects.filter(user=request.user).exists()})

    def post(self, request):
        if AuthenticatorDevice.objects.filter(user=request.user).exists():
            return Response({"error": "Authenticator is already enabled"}, status=status.HTTP_400_BAD_REQUEST)
        secret = new_secret()
        request.session["authenticator_setup"] = {"secret": encrypt_secret(secret), "created_at": int(time.time())}
        return Response({"secret": secret, "uri": provisioning_uri(request.user.email, secret)})


@method_decorator(never_cache, name="dispatch")
class AuthenticatorConfirmEndpoint(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [AuthenticatorActionThrottle]

    @transaction.atomic
    def post(self, request):
        pending = request.session.get("authenticator_setup")
        if not pending or int(time.time()) - pending["created_at"] > 600:
            request.session.pop("authenticator_setup", None)
            return Response({"error": "Start setup again"}, status=status.HTTP_400_BAD_REQUEST)
        if AuthenticatorDevice.objects.filter(user=request.user).exists():
            return Response({"error": "Authenticator is already enabled"}, status=status.HTTP_400_BAD_REQUEST)
        step = matching_step(decrypt_secret(pending["secret"]), request.data.get("code"))
        if step is None:
            return Response({"error": "Invalid authenticator code"}, status=status.HTTP_400_BAD_REQUEST)
        recovery_codes = new_recovery_codes()
        AuthenticatorDevice.objects.create(
            user=request.user,
            encrypted_secret=pending["secret"],
            last_verified_step=step,
            recovery_codes=[recovery_hash(code) for code in recovery_codes],
        )
        request.session.pop("authenticator_setup", None)
        return Response({"recovery_codes": recovery_codes})


@method_decorator(never_cache, name="dispatch")
class AuthenticatorDisableEndpoint(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [AuthenticatorActionThrottle]

    @transaction.atomic
    def post(self, request):
        device = AuthenticatorDevice.objects.select_for_update().filter(user=request.user).first()
        if device is None:
            return Response({"error": "Authenticator is not enabled"}, status=status.HTTP_400_BAD_REQUEST)
        password = request.data.get("password", "")
        if not request.user.is_password_autoset and (
            not isinstance(password, str) or not request.user.check_password(password)
        ):
            return Response({"error": "Incorrect password"}, status=status.HTTP_400_BAD_REQUEST)
        if not verify_device(device, request.data.get("code")):
            return Response({"error": "Invalid authenticator or recovery code"}, status=status.HTTP_400_BAD_REQUEST)
        device.delete()
        return Response({"enabled": False})


def _pending(request):
    pending = request.session.get("authenticator_pending")
    if not isinstance(pending, dict) or int(time.time()) - pending.get("created_at", 0) > 600:
        request.session.pop("authenticator_pending", None)
        return None
    return pending


@method_decorator(never_cache, name="dispatch")
class AuthenticatorPendingEndpoint(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        pending = _pending(request)
        if pending is None:
            return Response({"pending": False})
        user = get_user_model().objects.filter(pk=pending["user_id"], is_active=True).first()
        return Response({"pending": user is not None, "email": user.email if user else None})


@method_decorator(csrf_protect, name="dispatch")
@method_decorator(never_cache, name="dispatch")
class AuthenticatorVerifyEndpoint(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [AuthenticationThrottle]

    @transaction.atomic
    def post(self, request):
        pending = _pending(request)
        if pending is None:
            return Response({"error": "Sign in again"}, status=status.HTTP_401_UNAUTHORIZED)
        if pending.get("attempts", 0) >= 5:
            request.session.pop("authenticator_pending", None)
            return Response({"error": "Too many attempts. Sign in again"}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        user = get_user_model().objects.filter(pk=pending["user_id"], is_active=True).first()
        device = AuthenticatorDevice.objects.select_for_update().filter(user=user).first() if user else None
        if device is None:
            request.session.pop("authenticator_pending", None)
            return Response({"error": "Sign in again"}, status=status.HTTP_401_UNAUTHORIZED)
        if not verify_device(device, request.data.get("code")):
            pending["attempts"] = pending.get("attempts", 0) + 1
            request.session["authenticator_pending"] = pending
            return Response({"error": "Invalid authenticator or recovery code"}, status=status.HTTP_400_BAD_REQUEST)

        request.session.pop("authenticator_pending", None)
        request.session.set_expiry(None)
        is_space = pending.get("is_space", False)
        user_login(request, user, is_app=not is_space, is_space=is_space, skip_mfa=True)
        next_path = validate_next_path(pending.get("next_path"))
        url = get_safe_redirect_url(
            base_url=base_host(request=request, is_space=is_space, is_app=not is_space),
            next_path=next_path,
        )
        return Response({"redirect_url": url})
