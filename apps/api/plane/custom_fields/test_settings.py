"""Isolated integration settings; tests still use the real Plane models/migrations."""

from plane.settings.common import *  # noqa: F403
import os

# Optional POSIX UTC alias for the relocatable PostgreSQL used in local CI sandboxes.
DATABASES["default"]["TIME_ZONE"] = os.environ.get("TEST_DATABASE_TIME_ZONE", "UTC")  # noqa: F405

ROOT_URLCONF = "plane.custom_fields.test_urls"
MIDDLEWARE = []
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
CELERY_TASK_ALWAYS_EAGER = True
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
}
