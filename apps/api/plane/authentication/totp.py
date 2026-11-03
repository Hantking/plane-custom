# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote, urlencode

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


def _cipher(key):
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(key.encode()).digest()))


def encrypt_secret(secret):
    return _cipher(settings.SECRET_KEY).encrypt(secret.encode()).decode()


def decrypt_secret(encrypted):
    for key in (settings.SECRET_KEY, *getattr(settings, "SECRET_KEY_FALLBACKS", [])):
        try:
            return _cipher(key).decrypt(encrypted.encode()).decode()
        except InvalidToken:
            continue
    raise InvalidToken("Authenticator secret cannot be decrypted")


def new_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def provisioning_uri(email, secret):
    label = quote(f"Plane:{email}", safe="")
    parameters = {"secret": secret, "issuer": "Plane", "algorithm": "SHA1", "digits": 6, "period": 30}
    return f"otpauth://totp/{label}?{urlencode(parameters)}"


def matching_step(secret, code, now=None, after_step=-1):
    if not isinstance(code, str) or len(code) != 6 or not code.isascii() or not code.isdecimal():
        return None
    now = int(time.time() if now is None else now)
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    for step in (now // 30 - 1, now // 30, now // 30 + 1):
        if step <= after_step or step < 0:
            continue
        digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
        offset = digest[-1] & 15
        value = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
        if hmac.compare_digest(f"{value:06d}", code):
            return step
    return None


def new_recovery_codes():
    return [f"{secrets.token_hex(4)}-{secrets.token_hex(4)}" for _ in range(8)]


def recovery_hash(code, key=None):
    normalized = code.replace("-", "").strip().lower()
    return hmac.new(
        (key or settings.SECRET_KEY).encode(), f"plane-recovery:{normalized}".encode(), hashlib.sha256
    ).hexdigest()


def verify_device(device, code):
    """Call under select_for_update; update OTP counter or consume a recovery code."""
    step = matching_step(decrypt_secret(device.encrypted_secret), code, after_step=device.last_verified_step)
    if step is not None:
        device.last_verified_step = step
        device.save(update_fields=["last_verified_step"])
        return True
    if not isinstance(code, str) or len(code) != 17:
        return False
    for stored in device.recovery_codes:
        for key in (settings.SECRET_KEY, *getattr(settings, "SECRET_KEY_FALLBACKS", [])):
            if hmac.compare_digest(stored, recovery_hash(code, key)):
                device.recovery_codes = [item for item in device.recovery_codes if item != stored]
                device.save(update_fields=["recovery_codes"])
                return True
    return False
