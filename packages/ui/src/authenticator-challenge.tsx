/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useState } from "react";

export function AuthenticatorChallenge({ apiBaseUrl, signInUrl }: { apiBaseUrl: string; signInUrl: string }) {
  const [email, setEmail] = useState<string>();
  const [pending, setPending] = useState<boolean>();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/auth/authenticator/pending/`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Cannot load pending session");
        const result = await response.json();
        if (!controller.signal.aborted) {
          setPending(result.pending === true);
          setEmail(result.email);
        }
      } catch {
        if (!controller.signal.aborted) setError("Não foi possível verificar a sessão. Tente novamente.");
      }
    };
    void load();
    return () => controller.abort();
  }, [apiBaseUrl]);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const csrfResponse = await fetch(`${apiBaseUrl}/auth/get-csrf-token/`, { credentials: "include" });
      if (!csrfResponse.ok) throw new Error("Não foi possível iniciar a verificação.");
      const { csrf_token } = await csrfResponse.json();
      const response = await fetch(`${apiBaseUrl}/auth/authenticator/verify/`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFTOKEN": csrf_token },
        body: JSON.stringify({ code: code.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Código inválido. Tente novamente.");
      window.location.assign(result.redirect_url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível verificar o código.");
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto mt-10 flex w-full max-w-sm flex-col gap-5 rounded-lg border border-subtle bg-surface-1 p-6">
      <h1 className="text-xl font-semibold text-primary">Verificação em duas etapas</h1>
      {pending === false ? (
        <p className="text-13 text-secondary">Sua sessão expirou. Entre novamente para continuar.</p>
      ) : (
        <>
          <p className="text-13 text-secondary">
            Digite o código de seis dígitos do aplicativo Authenticator{email ? ` para ${email}` : ""} ou um código de
            recuperação.
          </p>
          <form onSubmit={verify} className="flex flex-col gap-4">
            <label htmlFor="authenticator-code" className="text-13 font-medium text-secondary">
              Código de verificação
            </label>
            <input
              id="authenticator-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="000000 ou código de recuperação"
              className="w-full rounded-md border border-strong bg-surface-1 p-3 text-primary"
            />
            {error && (
              <p role="alert" className="text-13 text-danger-primary">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting || !pending || !code.trim()}
              className="rounded-md bg-accent-primary px-4 py-2 text-white disabled:opacity-50"
            >
              {submitting ? "Verificando..." : "Verificar e entrar"}
            </button>
          </form>
        </>
      )}
      <a href={signInUrl} className="text-13 text-accent-primary">
        Voltar ao login
      </a>
    </div>
  );
}
