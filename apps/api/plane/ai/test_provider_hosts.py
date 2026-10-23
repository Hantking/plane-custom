import os
from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError
from .security import allowed_provider_hosts, provider_address


class ProviderHostConfigurationTests(SimpleTestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {"PLANE_AI_ALLOWED_HOSTS": "", "PLANE_AI_ALLOW_PRIVATE_ENDPOINTS": "0"})
        environment.start()
        self.addCleanup(environment.stop)
        dns = patch("plane.ai.security.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("8.8.8.8", 443))])
        self.dns = dns.start()
        self.addCleanup(dns.stop)

    def test_full_api_url_authorizes_its_hostname(self):
        os.environ["PLANE_AI_ALLOWED_HOSTS"] = "https://provider.invalid/api/v1"
        parsed, address, port = provider_address("https://provider.invalid/api/v1")
        self.assertEqual(parsed.hostname, "provider.invalid")
        self.assertEqual(address, "8.8.8.8")
        self.assertEqual(port, 443)

    def test_mixed_urls_hosts_case_whitespace_newlines_and_duplicates(self):
        os.environ["PLANE_AI_ALLOWED_HOSTS"] = (
            " https://PROVIDER.invalid:9443/api/v1/ , other.invalid\nhttps://third.invalid/v1,provider.invalid,, "
        )
        self.assertEqual(allowed_provider_hosts(), {"provider.invalid", "other.invalid", "third.invalid"})
        self.assertEqual(provider_address("https://provider.invalid:9443/another-prefix")[2], 9443)
        self.assertEqual(provider_address("https://other.invalid/v1")[0].hostname, "other.invalid")

    def test_legacy_hostnames_remain_supported(self):
        os.environ["PLANE_AI_ALLOWED_HOSTS"] = "provider.invalid"
        self.assertEqual(provider_address("https://provider.invalid/v1")[0].hostname, "provider.invalid")

    def test_full_url_does_not_authorize_suffix_or_subdomain_lookalikes(self):
        os.environ["PLANE_AI_ALLOWED_HOSTS"] = "https://provider.invalid/v1"
        for url in [
            "https://provider.invalid.evil/v1",
            "https://evil.provider.invalid/v1",
            "https://another.invalid/v1",
        ]:
            with self.subTest(url=url), self.assertRaises(ValidationError):
                provider_address(url)

    def test_empty_configuration_is_still_denied(self):
        with self.assertRaises(ValidationError):
            provider_address("https://provider.invalid/v1")

    def test_malformed_config_urls_fail_without_echoing_credentials(self):
        for value in [
            "https://[",
            "https://provider.invalid:invalid/v1",
            "ftp://provider.invalid/v1",
            "https://user:secret@provider.invalid/v1",
            "https://provider.invalid/v1?api_key=secret",
            "https://provider.invalid/v1#fragment",
        ]:
            os.environ["PLANE_AI_ALLOWED_HOSTS"] = value
            with self.subTest(value=value), self.assertRaises(ValidationError) as error:
                allowed_provider_hosts()
            self.assertNotIn("secret", str(error.exception))

    def test_private_ips_and_http_still_require_explicit_permission(self):
        os.environ["PLANE_AI_ALLOWED_HOSTS"] = "http://provider.invalid:11434/v1"
        with self.assertRaises(ValidationError):
            provider_address("http://provider.invalid:11434/v1")
        self.dns.return_value = [(2, 1, 6, "", ("127.0.0.1", 11434))]
        with self.assertRaises(ValidationError):
            provider_address("https://provider.invalid/v1")
        os.environ["PLANE_AI_ALLOW_PRIVATE_ENDPOINTS"] = "1"
        self.assertEqual(provider_address("http://provider.invalid:11434/v1")[2], 11434)

    def test_request_url_validation_still_blocks_credentials_query_and_invalid_url(self):
        os.environ["PLANE_AI_ALLOWED_HOSTS"] = "https://provider.invalid/v1"
        for url in ["https://user:secret@provider.invalid/v1", "https://provider.invalid/v1?key=secret", "https://["]:
            with self.subTest(url=url), self.assertRaises(ValidationError):
                provider_address(url)
