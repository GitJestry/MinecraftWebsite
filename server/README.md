# Editor Authentication Service

This Node.js service provides the hardened login flow for the Minecraft website editor mode. The initial scope covers secure authentication only; editor APIs are expected to be protected by the established session in later tasks.

## Features

- OIDC login with PKCE (authorization code flow)
- Mandatory editor role validation from the OIDC ID token
- WebAuthn (FIDO2) second factor using `@simplewebauthn/server`
- TOTP fallback (per-user) for emergency access
- Secure server-side sessions with `HttpOnly`, `Secure`, and `SameSite=Strict` cookie flags (15 minute TTL)
- CSRF protection for state-changing POST endpoints
- Strict security headers (CSP, HSTS, COOP/COEP) via Helmet
- Origin-locked CORS responses with credential support
- Rate limiting on authentication endpoints
- In-memory stores for development; replace with durable storage for production

## Setup

1. Copy `.env.example` to `.env` and provide the required configuration values.
2. Install dependencies:

   ```bash
   cd server
   npm install
   ```

3. Run the service:

   ```bash
   npm run dev
   ```

   The server listens on port `3000` by default.

## Environment variables

| Variable | Description |
| --- | --- |
| `OIDC_ISSUER_URL` | Issuer URL of your OIDC provider. Discovery is used automatically. |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Client credentials for the editor application. |
| `OIDC_REDIRECT_URI` | Redirect URI registered with the OIDC provider (must point to `/auth/callback`). |
| `SESSION_SECRET` | Strong random value used to sign the session cookie. |
| `APP_ORIGIN` | Origin (scheme + host + port) of the website consuming the API. Only this origin is allowed for CORS/CSRF. |
| `RP_ID` / `RP_NAME` | WebAuthn relying party identifier and display name. Defaults to the hostname from `APP_ORIGIN` and `"Minecraft Website Editor"`. |
| `WEBAUTHN_CREDENTIALS` | Optional JSON array of authenticators to seed the in-memory WebAuthn credential store for development. |
| `TOTP_SHARED_SECRETS` | Optional JSON map of `{ "<userId>": "<BASE32 SECRET>" }` used for the emergency TOTP fallback. |
| `PORT` | Listening port (default `3000`). |

### Example WebAuthn credential seed

```json
[
  {
    "userId": "user-sub",
    "credentialID": "credential-id-base64url",
    "publicKey": "public-key-base64",
    "counter": 0,
    "transports": ["usb"],
    "credentialDeviceType": "singleDevice",
    "credentialBackedUp": false
  }
]
```

### Example TOTP secret map

```json
{
  "user-sub": "JBSWY3DPEHPK3PXP"
}
```

## API overview

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/auth/login` | Starts the OIDC login (redirect to provider). |
| `GET` | `/auth/callback` | Handles the OIDC callback, stores pending session, and redirects to the MFA page on the primary origin. |
| `GET` | `/auth/csrf-token` | Returns a CSRF token for subsequent POST requests. |
| `POST` | `/auth/webauthn/challenge` | Issues a WebAuthn assertion challenge for the pending user. |
| `POST` | `/auth/webauthn/verify` | Verifies the WebAuthn response and finalizes the session. |
| `POST` | `/auth/totp/verify` | Emergency TOTP fallback. |
| `POST` | `/auth/logout` | Destroys the session. |

All `POST` endpoints require the `X-CSRF-Token` header with a valid token from `/auth/csrf-token`.

## Production notes

- Replace the in-memory stores with persistent storage (database or key vault) before going live.
- Rotate `SESSION_SECRET` when deploying.
- Configure `trust proxy` according to your deployment (already enabled for production to honor load balancers).
- Use HTTPS end-to-end to ensure the `Secure` flag is respected.
- Monitor rate limit metrics and integrate with your WAF for anomaly detection.

