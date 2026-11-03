# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.db import models


class AuthenticatorDevice(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="authenticator_device")
    encrypted_secret = models.TextField()
    recovery_codes = models.JSONField(default=list)
    last_verified_step = models.BigIntegerField(default=-1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "authenticator_devices"
