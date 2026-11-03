# Autenticação em duas etapas — Authenticator

Em **Configurações → Perfil → Segurança**, o usuário pode ativar um aplicativo TOTP (Google Authenticator, Microsoft Authenticator e similares): escaneia o QR code, confirma um código de seis dígitos e guarda os oito códigos de recuperação, apresentados somente no momento da ativação. Um código de recuperação vale uma única vez. A desativação exige um código e, para contas com senha, também a senha atual.

Após autenticação primária por senha, código de e-mail ou OAuth, contas com Authenticator ativo recebem um desafio antes de ganhar uma sessão autenticada. A mesma exigência cobre o aplicativo, Spaces e o console administrativo; o console permite informar o código no formulário de login. Tentativas são limitadas e o desafio expira em dez minutos. Códigos TOTP não podem ser reutilizados no mesmo intervalo de 30 segundos.

O segredo TOTP é cifrado com uma chave derivada de `SECRET_KEY`; os códigos de recuperação ficam armazenados apenas como HMAC. Mantenha `SECRET_KEY` estável em todos os serviços. Para rotacioná-la, defina `SECRET_KEY_FALLBACKS` como uma lista JSON com as chaves anteriores (por exemplo `["chave-anterior"]`) até que as contas possam ser reconfiguradas.

## Implantação

- Aplicar a migração `authentication.0001_authenticator_device` antes de habilitar o novo frontend. Não há variável de ambiente nova obrigatória.
- Publicar backend, frontend web, Spaces e admin da mesma versão, pois o segundo fator cobre os quatro fluxos.
- O endpoint `GET /auth/get-csrf-token/` precisa continuar acessível antes do login para permitir a confirmação do desafio. As requisições POST exigem CSRF.

## Verificação local

Testes de integração Django cobrem ativação/QR, códigos inválidos, bloqueio de login por senha/Spaces/admin, recuperação de uso único, replay de TOTP, CSRF, desativação e rotação da chave. Typescript, OxLint, Ruff e builds de UI, web, Spaces e admin foram executados nesta rodada.
