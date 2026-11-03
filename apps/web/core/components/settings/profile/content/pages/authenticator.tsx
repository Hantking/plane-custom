/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AuthService } from "@/services/auth.service";

const authService = new AuthService();

function message(error: unknown): string {
  const response = error as { response?: { data?: { error?: string } } };
  return response?.response?.data?.error || "Não foi possível concluir a operação. Tente novamente.";
}

export function AuthenticatorSettings({ passwordRequired }: { passwordRequired: boolean }) {
  const [enabled, setEnabled] = useState<boolean>();
  const [setup, setSetup] = useState<{ secret: string; uri: string }>();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authService
      .authenticatorStatus()
      .then((result) => setEnabled(result.enabled))
      .catch((cause) => setError(message(cause)));
  }, []);

  const csrf = async () => {
    const result = await authService.requestCSRFToken();
    if (!result.csrf_token) throw new Error("Token CSRF indisponível");
    return result.csrf_token;
  };

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      setSetup(await authService.authenticatorSetup(await csrf()));
      setCode("");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await authService.authenticatorConfirm(await csrf(), code.trim());
      setRecoveryCodes(result.recovery_codes);
      setSetup(undefined);
      setEnabled(true);
      setCode("");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const disable = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await authService.authenticatorDisable(await csrf(), code.trim(), password);
      setEnabled(false);
      setCode("");
      setPassword("");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10 border-t border-subtle pt-7">
      <h2 className="text-lg font-semibold text-primary">Autenticação em duas etapas</h2>
      <p className="mt-2 text-13 text-secondary">
        Proteja sua conta com um código do Google Authenticator, Microsoft Authenticator ou outro aplicativo compatível.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-13 text-danger-primary">
          {error}
        </p>
      )}
      {enabled === undefined && !error && <p className="mt-4 text-13 text-secondary">Carregando...</p>}
      {enabled === false && !setup && (
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="mt-5 rounded-md bg-accent-primary px-4 py-2 text-white disabled:opacity-50"
        >
          Ativar Authenticator
        </button>
      )}
      {setup && (
        <div className="mt-5 flex flex-col gap-4">
          <p className="text-13 text-secondary">Escaneie o QR code com seu aplicativo ou insira a chave manualmente.</p>
          <div className="w-fit rounded-md bg-white p-3">
            <QRCodeSVG value={setup.uri} size={180} />
          </div>
          <div className="font-mono rounded-md border border-subtle p-3 text-13 break-all text-primary">
            {setup.secret}
          </div>
          <form onSubmit={confirm} className="flex max-w-sm flex-col gap-3">
            <label htmlFor="authenticator-setup-code" className="text-13 text-secondary">
              Código do aplicativo
            </label>
            <input
              id="authenticator-setup-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className="rounded-md border border-strong bg-surface-1 p-2 text-primary"
            />
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={busy || !code.trim()}
                className="rounded-md bg-accent-primary px-4 py-2 text-white disabled:opacity-50"
              >
                Confirmar ativação
              </button>
              <button
                type="button"
                onClick={() => {
                  setSetup(undefined);
                  setCode("");
                }}
                className="text-13 text-secondary"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
      {recoveryCodes && (
        <div className="mt-5 rounded-md border border-subtle p-4">
          <h3 className="font-medium text-primary">Guarde seus códigos de recuperação</h3>
          <p className="my-2 text-13 text-secondary">
            Cada código funciona uma única vez. Eles não serão exibidos novamente.
          </p>
          <ul className="font-mono grid grid-cols-2 gap-2 text-13 text-primary">
            {recoveryCodes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setRecoveryCodes(undefined)}
            className="mt-4 rounded-md bg-accent-primary px-4 py-2 text-white"
          >
            Já guardei os códigos
          </button>
        </div>
      )}
      {enabled === true && !recoveryCodes && (
        <form onSubmit={disable} className="mt-5 flex max-w-sm flex-col gap-3">
          <p className="text-13 text-secondary">
            O Authenticator está ativado. Para desativá-lo, confirme sua identidade.
          </p>
          {passwordRequired && (
            <>
              <label htmlFor="authenticator-password" className="text-13 text-secondary">
                Senha atual
              </label>
              <input
                id="authenticator-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="rounded-md border border-strong bg-surface-1 p-2 text-primary"
              />
            </>
          )}
          <label htmlFor="authenticator-disable-code" className="text-13 text-secondary">
            Código do aplicativo ou de recuperação
          </label>
          <input
            id="authenticator-disable-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="rounded-md border border-strong bg-surface-1 p-2 text-primary"
          />
          <button
            type="submit"
            disabled={busy || !code.trim() || (passwordRequired && !password)}
            className="w-fit rounded-md border border-danger-strong px-4 py-2 text-danger-primary disabled:opacity-50"
          >
            Desativar Authenticator
          </button>
        </form>
      )}
    </section>
  );
}
