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

1. Copy `.env.example` to `.env` and provide the required configuration values (see the table below).
2. Install dependencies:

   ```bash
   cd server
   npm install
   ```

3. Run the service locally:

   ```bash
   npm run dev
   ```

   The server listens on port `3000` by default.

## Environment variables

| Variable | Description |
| --- | --- |
| `SESSION_SECRET` | Strong random value used to sign the session cookie. Rotate on every deployment. |
| `APP_ORIGIN` | Origin (scheme + host + optional port) of the website consuming the API. Only requests from this origin are allowed for CORS/CSRF. |
| `OIDC_ISSUER_URL` | Issuer URL of your OIDC provider. Discovery is used automatically. |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Client credentials for the editor application. |
| `OIDC_REDIRECT_URI` | Redirect URI registered with the OIDC provider (must point to `/auth/callback`). |
| `RP_ID` / `RP_NAME` | WebAuthn relying party identifier and display name. Defaults to the hostname from `APP_ORIGIN` and `"Minecraft Website Editor"`. |
| `WEBAUTHN_CREDENTIALS` | Optional JSON array of authenticators to seed the in-memory WebAuthn credential store for development. |
| `TOTP_SHARED_SECRETS` | Optional JSON map of `{ "<userId>": "<BASE32 SECRET>" }` used for the emergency TOTP fallback. |
| `PORT` | Listening port (default `3000`). |

When running in production, configure the environment directly through your hosting provider rather than checking `.env` files into source control.

### CORS & origin checking

`APP_ORIGIN` controls the only browser origin that is allowed to issue requests. Set it to the public HTTPS origin of the static site bundle, for example `https://www.example.com`. Requests from any other origin will be rejected with `403 origin_not_allowed`.

### Session security

`SESSION_SECRET` must be a cryptographically random string with at least 32 bytes of entropy. Rotate the value whenever you deploy or suspect compromise. Because the cookie is marked `Secure`, HTTPS is required for browsers to send it.

### Example `.env`

```
SESSION_SECRET="generate-a-new-secret"
APP_ORIGIN="https://www.example.com"
OIDC_ISSUER_URL="https://auth.example.com/.well-known/openid-configuration"
OIDC_CLIENT_ID="minecraft-editor"
OIDC_CLIENT_SECRET="super-secret"
OIDC_REDIRECT_URI="https://editor.example.com/auth/callback"
```

Other variables can be added as needed.

## Running with Docker

To build a production-ready container image:

```bash
cd server
docker build -t minecraft-editor-auth .
```

Run the container, mounting a volume so download counters persist between restarts:

```bash
docker run \
  --env-file .env \
  -e NODE_ENV=production \
  -p 3000:3000 \
  -v editor-downloads:/app/data \
  minecraft-editor-auth
```

A convenience `docker-compose.yml` is provided. Copy `.env.example` to `.env`, populate the required values, then start the stack:

```bash
cd server
docker compose up --build -d
```

The service listens on port `3000` inside the container and exposes `/healthz` for monitoring.

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

## Deploying to Render

Render can host the authentication service as a managed Node web service. The steps below assume the repository is connected to Render via GitHub.

1. **Create a new Web Service** targeting the `server` directory.
2. Choose the Node environment with the `Dockerfile` build option and point it to `server/Dockerfile`.
3. Set the _Start Command_ to `node src/server.js` (already the container default, but explicit is helpful).
4. Configure the environment variables listed above (`SESSION_SECRET`, `APP_ORIGIN`, `OIDC_*`, etc.). Render stores them securely.
5. Add a persistent disk mounted at `/app/data` if you need download metrics to survive restarts. Alternatively, wire up an external data store.
6. Expose port `3000`; Render will automatically proxy HTTPS traffic. Add your custom domain and enable automatic TLS certificates from Let’s Encrypt.
7. Define a health check using `https://<your-service>.onrender.com/healthz` so Render can monitor availability.

### TLS and networking

- Render terminates TLS at its edge. Use HTTPS when configuring `APP_ORIGIN` and when calling the service from the static site bundle.
- If you bring your own CDN or proxy in front of Render, ensure it forwards `X-Forwarded-Proto` so the Express `trust proxy` setting maintains secure cookies.
- Always keep `SESSION_SECRET` and OIDC credentials in Render’s environment variable store—not in the repository.

