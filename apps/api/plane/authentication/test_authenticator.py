import base64
import hmac
import hashlib
import struct
import time
import uuid

from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from django.test import Client, RequestFactory, TestCase, override_settings
from django.utils import timezone

from plane.authentication.adapter.error import AuthenticationException
from plane.authentication.models import AuthenticatorDevice
from plane.authentication.totp import matching_step, verify_device
from plane.authentication.utils.login import user_login
from plane.db.models import User
from plane.license.models import Instance, InstanceAdmin


def code_for(secret, now=None):
    now = int(time.time() if now is None else now)
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", now // 30), hashlib.sha1).digest()
    offset = digest[-1] & 15
    return f"{(struct.unpack('>I', digest[offset : offset + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


@override_settings(
    MIDDLEWARE=[
        "plane.authentication.middleware.session.SessionMiddleware",
        "django.middleware.csrf.CsrfViewMiddleware",
        "django.contrib.auth.middleware.AuthenticationMiddleware",
    ]
)
class AuthenticatorTests(TestCase):
    def test_totp_rfc_vector_and_replay(self):
        secret = base64.b32encode(b"12345678901234567890").decode().rstrip("=")
        self.assertEqual(matching_step(secret, "287082", now=59), 1)
        self.assertIsNone(matching_step(secret, "287082", now=59, after_step=1))

    def setUp(self):
        self.user = User.objects.create(email="authenticator@test.local", username="authenticator-test")
        self.user.set_password("test-password-123")
        self.user.is_password_autoset = False
        self.user.save()
        self.client = Client(enforce_csrf_checks=True, HTTP_USER_AGENT="Authenticator integration test")
        self.client.force_login(self.user)
        self.csrf = self.client.get("/auth/get-csrf-token/").json()["csrf_token"]

    def post(self, path, data):
        return self.client.post(path, data, content_type="application/json", HTTP_X_CSRFTOKEN=self.csrf)

    def enroll(self):
        response = self.post("/auth/authenticator/", {})
        self.assertEqual(response.status_code, 200, response.content[:500])
        secret = response.json()["secret"]
        self.assertIn(secret, response.json()["uri"])
        response = self.post("/auth/authenticator/confirm/", {"code": code_for(secret)})
        self.assertEqual(response.status_code, 200)
        return secret, response.json()["recovery_codes"]

    def test_enrollment_requires_valid_code_and_protects_secret(self):
        self.assertFalse(self.client.get("/auth/authenticator/").json()["enabled"])
        response = self.post("/auth/authenticator/", {})
        secret = response.json()["secret"]
        self.assertEqual(self.post("/auth/authenticator/confirm/", {"code": "000"}).status_code, 400)
        self.assertFalse(AuthenticatorDevice.objects.filter(user=self.user).exists())
        response = self.post("/auth/authenticator/confirm/", {"code": code_for(secret)})
        self.assertEqual(response.status_code, 200)
        device = AuthenticatorDevice.objects.get(user=self.user)
        self.assertNotIn(secret, device.encrypted_secret)
        self.assertEqual(len(response.json()["recovery_codes"]), 8)
        self.assertFalse(any(code in str(device.recovery_codes) for code in response.json()["recovery_codes"]))
        self.assertTrue(self.client.get("/auth/authenticator/").json()["enabled"])

    def test_pending_login_requires_totp_or_single_use_recovery_code(self):
        secret, recovery_codes = self.enroll()
        self.client.logout()
        request = RequestFactory().post("/auth/sign-in/", {"next_path": "/demo"})
        request.user = AnonymousUser()
        request.session = self.client.session
        with self.assertRaises(AuthenticationException) as exc:
            user_login(request, self.user, is_app=True)
        self.assertEqual(exc.exception.error_code, 5195)
        self.assertNotIn("_auth_user_id", request.session)
        request.session.save()
        self.client.cookies[settings.SESSION_COOKIE_NAME] = request.session.session_key
        self.assertTrue(self.client.get("/auth/authenticator/pending/").json()["pending"])
        self.csrf = self.client.get("/auth/get-csrf-token/").json()["csrf_token"]
        response = self.post("/auth/authenticator/verify/", {"code": "invalid"})
        self.assertEqual(response.status_code, 400, response.content[:500])
        self.assertNotIn("_auth_user_id", self.client.session)
        response = self.post("/auth/authenticator/verify/", {"code": recovery_codes[0]})
        self.assertEqual(response.status_code, 200)
        self.assertIn("next_path=/demo", response.json()["redirect_url"])
        self.assertEqual(self.client.session["_auth_user_id"], str(self.user.id))
        device = AuthenticatorDevice.objects.get(user=self.user)
        self.assertFalse(verify_device(device, recovery_codes[0]))
        self.assertIsNotNone(matching_step(secret, code_for(secret)))

    def test_disable_requires_password_and_code(self):
        secret, recovery_codes = self.enroll()
        self.assertEqual(
            self.post("/auth/authenticator/disable/", {"password": "wrong", "code": recovery_codes[0]}).status_code,
            400,
        )
        self.assertTrue(AuthenticatorDevice.objects.filter(user=self.user).exists())
        self.assertEqual(
            self.post("/auth/authenticator/disable/", {"password": "test-password-123", "code": "invalid"}).status_code,
            400,
        )
        self.assertEqual(
            self.post(
                "/auth/authenticator/disable/", {"password": "test-password-123", "code": code_for(secret)}
            ).status_code,
            400,
        )
        self.assertTrue(AuthenticatorDevice.objects.filter(user=self.user).exists())
        self.assertEqual(
            self.post(
                "/auth/authenticator/disable/", {"password": "test-password-123", "code": recovery_codes[0]}
            ).status_code,
            200,
        )
        self.assertFalse(AuthenticatorDevice.objects.filter(user=self.user).exists())

    def test_challenge_requires_csrf(self):
        self.enroll()
        self.client.logout()
        request = RequestFactory().post("/auth/sign-in/")
        request.user = AnonymousUser()
        request.session = self.client.session
        with self.assertRaises(AuthenticationException):
            user_login(request, self.user, is_app=True)
        request.session.save()
        self.client.cookies[settings.SESSION_COOKIE_NAME] = request.session.session_key
        response = self.client.post("/auth/authenticator/verify/", {"code": "000000"}, content_type="application/json")
        self.assertEqual(response.status_code, 403, response.content[:500])

    def test_admin_sign_in_cannot_bypass_authenticator(self):
        _, recovery_codes = self.enroll()
        instance = Instance.objects.create(
            instance_name="Authenticator test",
            instance_id=str(uuid.uuid4()),
            current_version="1.0.0",
            last_checked_at=timezone.now(),
            is_setup_done=True,
        )
        InstanceAdmin.objects.create(user=self.user, instance=instance)
        self.client.logout()
        self.csrf = self.client.get("/auth/get-csrf-token/").json()["csrf_token"]
        form = {"email": self.user.email, "password": "test-password-123"}
        response = self.client.post("/api/instances/admins/sign-in/", form, HTTP_X_CSRFTOKEN=self.csrf)
        self.assertEqual(response.status_code, 302)
        self.assertIn("ADMIN_AUTHENTICATION_FAILED", response.url)
        self.assertNotIn(settings.ADMIN_SESSION_COOKIE_NAME, self.client.cookies)
        form["authenticator_code"] = recovery_codes[0]
        response = self.client.post("/api/instances/admins/sign-in/", form, HTTP_X_CSRFTOKEN=self.csrf)
        self.assertEqual(response.status_code, 302)
        self.assertIn("general/", response.url)
        self.assertIn(settings.ADMIN_SESSION_COOKIE_NAME, self.client.cookies)

    def test_password_sign_in_redirects_to_second_factor_before_login(self):
        self.enroll()
        Instance.objects.create(
            instance_name="Authenticator test",
            instance_id=str(uuid.uuid4()),
            current_version="1.0.0",
            last_checked_at=timezone.now(),
            is_setup_done=True,
        )
        self.client.logout()
        self.csrf = self.client.get("/auth/get-csrf-token/").json()["csrf_token"]
        response = self.client.post(
            "/auth/sign-in/",
            {"email": self.user.email, "password": "test-password-123"},
            HTTP_X_CSRFTOKEN=self.csrf,
        )
        self.assertEqual(response.status_code, 302)
        self.assertIn("error_code=5195", response.url)
        self.assertNotIn("_auth_user_id", self.client.session)
        self.assertTrue(self.client.get("/auth/authenticator/pending/").json()["pending"])

    def test_space_login_accepts_totp_only_after_second_factor(self):
        secret, _ = self.enroll()
        # Simulate the next time window after using the setup code.
        AuthenticatorDevice.objects.filter(user=self.user).update(last_verified_step=-1)
        self.client.logout()
        request = RequestFactory().post("/auth/spaces/sign-in/", {"next_path": "/demo"})
        request.user = AnonymousUser()
        request.session = self.client.session
        with self.assertRaises(AuthenticationException) as exc:
            user_login(request, self.user, is_space=True)
        self.assertEqual(exc.exception.error_code, 5195)
        request.session.save()
        self.client.cookies[settings.SESSION_COOKIE_NAME] = request.session.session_key
        self.assertNotIn("_auth_user_id", self.client.session)
        self.csrf = self.client.get("/auth/get-csrf-token/").json()["csrf_token"]
        response = self.post("/auth/authenticator/verify/", {"code": code_for(secret)})
        self.assertEqual(response.status_code, 200)
        self.assertIn("/spaces/", response.json()["redirect_url"])
        self.assertEqual(self.client.session["_auth_user_id"], str(self.user.id))
        device = AuthenticatorDevice.objects.get(user=self.user)
        self.assertFalse(verify_device(device, code_for(secret)))

    def test_recovery_code_survives_secret_key_rotation(self):
        _, recovery_codes = self.enroll()
        device = AuthenticatorDevice.objects.get(user=self.user)
        with override_settings(SECRET_KEY="rotated-key", SECRET_KEY_FALLBACKS=[settings.SECRET_KEY]):
            self.assertTrue(verify_device(device, recovery_codes[0]))
