"""Wire-level protocol contract tests, with a local HTTP fixture (not a real inference provider)."""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from uuid import uuid4
from cryptography.fernet import Fernet
from django.test import SimpleTestCase
from .models import Connection
from .providers import ChatCompletions, Cancelled, Embeddings, ProviderError
from .security import encrypt


class ProtocolTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.received = []

        class Handler(BaseHTTPRequestHandler):
            def handle(self):
                try:
                    super().handle()
                except (BrokenPipeError, ConnectionResetError):
                    # Expected when the cancellation test closes the client's live socket.
                    pass

            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({"data": cls.catalog_data}).encode())

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                cls.received.append(payload)
                self.send_response(cls.http_status)
                self.end_headers()
                if cls.http_status != 200:
                    self.wfile.write(b'{"error":"secret-provider-body-must-not-be-exposed"}')
                elif self.path.endswith("/embeddings"):
                    self.wfile.write(b'{"data":[{"embedding":[0.1,0.2,0.3]}]}')
                elif cls.message_override:
                    if payload.get("stream"):
                        text = cls.message_override["content"]
                        for fragment in [text[:4], text[4:25], text[25:]]:
                            self.wfile.write(
                                b"data: "
                                + json.dumps({"choices": [{"delta": {"content": fragment}}]}).encode()
                                + b"\n\n"
                            )
                        self.wfile.write(
                            b"data: "
                            + json.dumps({"choices": [{"delta": {}, "finish_reason": cls.finish_reason}]}).encode()
                            + b"\n\n"
                        )
                        self.wfile.write(b"data: [DONE]\n\n")
                    else:
                        self.wfile.write(
                            json.dumps(
                                {"choices": [{"message": cls.message_override, "finish_reason": cls.finish_reason}]}
                            ).encode()
                        )
                elif payload.get("stream"):
                    chunks = [
                        {"choices": [{"delta": {"content": "Resposta "}}]},
                        {"choices": [{"delta": {"content": "incremental"}}]},
                        {"choices": [], "usage": {"total_tokens": 7, "unknown_secret": "redacted"}},
                    ]
                    for chunk in chunks:
                        self.wfile.write(b"data: " + json.dumps(chunk).encode() + b"\n\n")
                    if not cls.truncated:
                        self.wfile.write(b"data: [DONE]\n\n")
                else:
                    self.wfile.write(
                        b'{"choices":[{"message":{"role":"assistant","content":"Resposta completa"}}],'
                        b'"usage":{"total_tokens":5}}'
                    )

        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        super().tearDownClass()

    def setUp(self):
        type(self).finish_reason = "stop"
        type(self).message_override = None
        type(self).catalog_data = [{"id": "manual-one"}, {"id": "manual-two"}]
        type(self).http_status = 200
        type(self).truncated = False
        self.environment = patch.dict(
            os.environ,
            {
                "PLANE_AI_ALLOW_PRIVATE_ENDPOINTS": "1",
                "PLANE_AI_ALLOWED_HOSTS": "127.0.0.1",
                "PLANE_AI_ENCRYPTION_KEY": Fernet.generate_key().decode(),
            },
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.connection = Connection(
            workspace_id=uuid4(),
            base_url=f"http://127.0.0.1:{self.server.server_port}/v1",
            encrypted_key=encrypt("test-key"),
            default_model="manual-one",
            timeout_seconds=5,
            models=[
                {
                    "id": "manual-one",
                    "capabilities": {"streaming": True, "tools": False, "system": False, "embeddings": True},
                }
            ],
        )

    def test_textual_tool_envelopes_are_executed_as_calls_and_not_streamed_as_answer(self):
        from .tools import schema

        text = (
            "<tool_call><function=search_workspace><parameter=query>Luciano do Couto</parameter></function></tool_call>"
        )
        type(self).message_override = {"role": "assistant", "content": text}
        self.connection.models[0]["capabilities"]["tools"] = True
        for streaming in [True, False]:
            self.connection.models[0]["capabilities"]["streaming"] = streaming
            deltas = []
            message, _ = ChatCompletions(self.connection).complete(
                "manual-one", [{"role": "user", "content": "Relatório"}], tools=schema(), on_delta=deltas.append
            )
            self.assertEqual(message["content"], "")
            self.assertEqual(message["tool_calls"][0]["function"]["name"], "search_workspace")
            self.assertNotIn("<tool", "".join(deltas))

    def test_catalog_reads_metadata_and_filters_non_chat_models_over_http(self):
        type(self).catalog_data = [
            {
                "id": "anthropic/claude-sonnet",
                "name": "Claude Sonnet",
                "context_length": 200000,
                "supported_parameters": ["tools", "response_format"],
                "description": "Available model",
            },
            {"id": "anthropic/claude-sonnet"},
            {"id": "text-embedding-3-small"},
            {"id": "gpt-image-1"},
            {"id": "arbitrary", "supported_parameters": []},
            None,
        ]
        models = ChatCompletions(self.connection).catalog()
        self.assertEqual([model["id"] for model in models], ["anthropic/claude-sonnet", "arbitrary"])
        self.assertEqual(models[0]["name"], "Claude Sonnet")
        self.assertEqual(models[0]["capability_source"], "provider")
        self.assertEqual(models[0]["context_tokens"], 200000)
        self.assertTrue(models[0]["configuration"]["capabilities"]["tools"])
        self.assertFalse(models[1]["configuration"]["capabilities"]["tools"])
        self.assertNotIn("test-key", json.dumps(models))

    def test_full_base_url_in_environment_allows_real_catalog_request(self):
        with patch.dict(os.environ, {"PLANE_AI_ALLOWED_HOSTS": self.connection.base_url}):
            self.assertEqual(ChatCompletions(self.connection).models(), ["manual-one", "manual-two"])

    def test_finish_reason_length_is_preserved_in_both_transports(self):
        type(self).message_override = {"role": "assistant", "content": "| 22/1"}
        type(self).finish_reason = "length"
        for streaming in [True, False]:
            self.connection.models[0]["capabilities"]["streaming"] = streaming
            message, _ = ChatCompletions(self.connection).complete(
                "manual-one", [{"role": "user", "content": "Relatório"}]
            )
            self.assertEqual(message["_finish_reason"], "length")
            self.assertEqual(message["content"], "| 22/1")

    def test_internal_completion_metadata_is_not_sent_as_message_fields(self):
        payload = ChatCompletions(self.connection).payload(
            "manual-one", [{"role": "assistant", "content": "Partial", "_finish_reason": "length"}]
        )
        self.assertNotIn("_finish_reason", payload["messages"][0])

    def test_catalog_unknown_models_are_conservative_and_reasoning_profile_uses_native_parameter(self):
        from .catalog import describe_model

        self.connection.base_url = "https://api.openai.com/v1"
        model = describe_model({"id": "gpt-5-mini"}, self.connection)
        self.assertEqual(model["configuration"]["output_parameter"], "max_completion_tokens")
        unknown = describe_model({"id": "private-model"}, self.connection)
        self.assertEqual(unknown["capability_source"], "unknown")
        self.assertFalse(unknown["configuration"]["capabilities"]["tools"])
        self.connection.base_url = "https://openrouter.ai/api/v1"
        self.assertEqual(
            describe_model({"id": "openai/gpt-5-mini"}, self.connection)["configuration"]["output_parameter"],
            "max_tokens",
        )

    def test_stream_over_real_http_and_independent_embeddings(self):
        updates = []
        message, usage = ChatCompletions(self.connection).complete(
            "manual-one", [{"role": "user", "content": "Olá"}], on_delta=updates.append
        )
        self.assertEqual(updates, ["Resposta ", "Resposta incremental"])
        self.assertEqual(message["content"], "Resposta incremental")
        self.assertEqual(usage, {"total_tokens": 7})
        self.assertEqual(Embeddings(self.connection).embed("manual-one", "context"), [0.1, 0.2, 0.3])
        self.assertEqual(ChatCompletions(self.connection).models(), ["manual-one", "manual-two"])

    def test_complete_response_omits_unsupported_streaming_and_tools(self):
        self.connection.models[0]["capabilities"]["streaming"] = False
        message, usage = ChatCompletions(self.connection).complete(
            "manual-one", [{"role": "system", "content": "Rules"}], tools=[{"type": "function"}]
        )
        payload = self.received[-1]
        self.assertNotIn("tools", payload)
        self.assertNotIn("stream", payload)
        self.assertEqual(payload["messages"][0]["role"], "user")
        self.assertEqual(message["content"], "Resposta completa")

    def test_http_errors_do_not_expose_provider_body_and_do_not_retry(self):
        type(self).http_status = 401
        before = len(self.received)
        with self.assertRaises(ProviderError) as failure:
            ChatCompletions(self.connection).complete("manual-one", [{"role": "user", "content": "Hi"}])
        self.assertNotIn("secret-provider-body", str(failure.exception))
        self.assertEqual(len(self.received), before + 1)

    def test_cancel_and_truncated_stream_are_not_success(self):
        with self.assertRaises(Cancelled):
            ChatCompletions(self.connection).complete(
                "manual-one", [{"role": "user", "content": "Hi"}], cancelled=lambda: True
            )
        type(self).truncated = True
        with self.assertRaises(ProviderError):
            ChatCompletions(self.connection).complete("manual-one", [{"role": "user", "content": "Hi"}])
