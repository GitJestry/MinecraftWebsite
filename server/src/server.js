import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import csrf from 'csurf';
import nocache from 'nocache';
import rateLimit from 'express-rate-limit';
import { Issuer, generators } from 'openid-client';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { totp } from 'otplib';
import DownloadStore from './download-store.js';

const {
  NODE_ENV,
  SESSION_SECRET,
  APP_ORIGIN,
  OIDC_ISSUER_URL,
  OIDC_CLIENT_ID,
  OIDC_CLIENT_SECRET,
  OIDC_REDIRECT_URI,
  RP_ID,
  RP_NAME,
  TOTP_SHARED_SECRETS,
  WEBAUTHN_CREDENTIALS,
  PORT = 3000,
} = process.env;

if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be configured');
}
if (!APP_ORIGIN) {
  throw new Error('APP_ORIGIN must be configured');
}
if (!OIDC_ISSUER_URL || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET || !OIDC_REDIRECT_URI) {
  throw new Error('OIDC configuration incomplete');
}

const rpId = RP_ID || new URL(APP_ORIGIN).hostname;
const rpName = RP_NAME || 'Minecraft Website Editor';

const userStore = new Map();
const credentialStore = new Map();
const totpSecretStore = new Map();
const downloadStore = new DownloadStore(new URL('../data/download-counts.json', import.meta.url));

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const FILE_ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;

const downloadCatalog = new Map([
  [
    'jetpack-datapack',
    {
      files: new Set(['jetpack-datapack-1.21.8.zip']),
      paths: new Set(['downloads/jetpack-datapack-1.21.8.zip']),
    },
  ],
]);

if (TOTP_SHARED_SECRETS) {
  try {
    const parsed = JSON.parse(TOTP_SHARED_SECRETS);
    Object.entries(parsed).forEach(([userId, secret]) => {
      if (typeof secret === 'string' && secret.trim().length > 0) {
        totpSecretStore.set(userId, secret.trim());
      }
    });
  } catch (error) {
    throw new Error(`Failed to parse TOTP_SHARED_SECRETS: ${error.message}`);
  }
}

if (WEBAUTHN_CREDENTIALS) {
  try {
    const parsed = JSON.parse(WEBAUTHN_CREDENTIALS);
    parsed.forEach((entry) => {
      if (!entry?.userId || !entry?.credentialID || !entry?.publicKey) {
        return;
      }
      const authenticator = {
        credentialID: Buffer.from(entry.credentialID, 'base64url'),
        credentialPublicKey: Buffer.from(entry.publicKey, 'base64'),
        counter: Number(entry.counter) || 0,
        transports: Array.isArray(entry.transports) ? entry.transports : [],
        credentialDeviceType: entry.credentialDeviceType || 'singleDevice',
        credentialBackedUp: Boolean(entry.credentialBackedUp),
      };
      const existing = credentialStore.get(entry.userId) || [];
      existing.push(authenticator);
      credentialStore.set(entry.userId, existing);
    });
  } catch (error) {
    throw new Error(`Failed to parse WEBAUTHN_CREDENTIALS: ${error.message}`);
  }
}

const app = express();

await downloadStore.init();

const oidcIssuer = await Issuer.discover(OIDC_ISSUER_URL);
const oidcClient = new oidcIssuer.Client({
  client_id: OIDC_CLIENT_ID,
  client_secret: OIDC_CLIENT_SECRET,
  redirect_uris: [OIDC_REDIRECT_URI],
  response_types: ['code'],
});

app.set('trust proxy', NODE_ENV === 'production');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        connectSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: [APP_ORIGIN],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: true,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: true,
  }),
);

app.use(nocache());
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use(cookieParser());

const sessionMiddleware = session({
  name: 'editor.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000,
  },
});

app.use(sessionMiddleware);

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});

const downloadRecordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (!origin) {
    return next();
  }
  if (origin !== APP_ORIGIN) {
    return res.status(403).json({ error: 'origin_not_allowed' });
  }
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

const csrfProtection = csrf({ cookie: false });

const requirePendingMfa = (req, res, next) => {
  if (!req.session?.pendingUser) {
    return res.status(401).json({ error: 'login_required' });
  }
  next();
};

const finishAuthentication = (req, res, user, method) => {
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      return res.status(500).json({ error: 'session_regeneration_failed' });
    }
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      roles: user.roles,
      authenticatedAt: new Date().toISOString(),
      mfaMethod: method,
    };
    req.session.save((saveErr) => {
      if (saveErr) {
        return res.status(500).json({ error: 'session_persist_failed' });
      }
      return res.status(200).json({ status: 'ok' });
    });
  });
};

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/auth/login', loginLimiter, (req, res) => {
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const state = generators.state();
  const nonce = generators.nonce();

  req.session.oidc = { codeVerifier, state, nonce };

  const authorizationUrl = oidcClient.authorizationUrl({
    scope: 'openid profile email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    response_mode: 'query',
    prompt: 'login',
  });

  req.session.save((err) => {
    if (err) {
      return res.status(500).json({ error: 'session_persist_failed' });
    }
    return res.redirect(authorizationUrl);
  });
});

app.get('/auth/callback', loginLimiter, async (req, res, next) => {
  try {
    const sessionOidc = req.session.oidc;
    if (!sessionOidc) {
      return res.status(400).json({ error: 'missing_oidc_session' });
    }
    if (req.query.state !== sessionOidc.state) {
      return res.status(400).json({ error: 'invalid_state' });
    }

    const params = oidcClient.callbackParams(req);
    const tokenSet = await oidcClient.callback(
      OIDC_REDIRECT_URI,
      params,
      {
        code_verifier: sessionOidc.codeVerifier,
        state: sessionOidc.state,
        nonce: sessionOidc.nonce,
      },
    );

    const claims = tokenSet.claims();

    if (!claims.sub) {
      return res.status(400).json({ error: 'missing_subject' });
    }

    const roles = Array.isArray(claims.roles)
      ? claims.roles
      : typeof claims.role === 'string'
      ? [claims.role]
      : [];

    if (!roles.includes('editor')) {
      return res.status(403).json({ error: 'insufficient_scope' });
    }

    const user = {
      id: claims.sub,
      name: claims.name || 'Unknown',
      email: claims.email || null,
      roles,
    };

    userStore.set(user.id, user);
    req.session.pendingUser = user;
    req.session.oidc = undefined;
    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ error: 'session_persist_failed' });
      }
      return res.redirect(`${APP_ORIGIN}/editor/mfa`);
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/auth/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

app.post(
  '/auth/webauthn/challenge',
  loginLimiter,
  requirePendingMfa,
  csrfProtection,
  async (req, res, next) => {
    try {
      const pendingUser = req.session.pendingUser;
      const userCredentials = credentialStore.get(pendingUser.id) || [];

      if (!userCredentials.length) {
        return res.status(404).json({ error: 'no_credentials_registered' });
      }

      const options = await generateAuthenticationOptions({
        allowCredentials: userCredentials.map((credential) => ({
          id: credential.credentialID,
          type: 'public-key',
          transports: credential.transports,
        })),
        userVerification: 'required',
        rpID: rpId,
      });

      req.session.challenge = options.challenge;
      req.session.save((err) => {
        if (err) {
          return res.status(500).json({ error: 'session_persist_failed' });
        }
        return res.json(options);
      });
    } catch (error) {
      return next(error);
    }
  },
);

app.post(
  '/auth/webauthn/verify',
  loginLimiter,
  requirePendingMfa,
  csrfProtection,
  async (req, res, next) => {
    try {
      const pendingUser = req.session.pendingUser;
      const userCredentials = credentialStore.get(pendingUser.id) || [];
      if (!userCredentials.length) {
        return res.status(404).json({ error: 'no_credentials_registered' });
      }

      const expectedChallenge = req.session.challenge;
      if (!expectedChallenge) {
        return res.status(400).json({ error: 'missing_challenge' });
      }

      const credentialId = Buffer.from(req.body.id, 'base64url');
      const authenticator = userCredentials.find(
        (credential) => Buffer.compare(credential.credentialID, credentialId) === 0,
      );

      if (!authenticator) {
        return res.status(404).json({ error: 'credential_not_found' });
      }

      const verification = await verifyAuthenticationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin: APP_ORIGIN,
        expectedRPID: rpId,
        authenticator,
      });

      if (!verification.verified) {
        return res.status(401).json({ error: 'verification_failed' });
      }

      credentialStore.set(
        pendingUser.id,
        userCredentials.map((credential) =>
          Buffer.compare(credential.credentialID, credentialId) === 0
            ? {
                ...credential,
                counter: verification.authenticationInfo.newCounter,
              }
            : credential,
        ),
      );

      req.session.challenge = undefined;
      finishAuthentication(req, res, pendingUser, 'webauthn');
    } catch (error) {
      return next(error);
    }
  },
);

app.post(
  '/auth/totp/verify',
  loginLimiter,
  requirePendingMfa,
  csrfProtection,
  (req, res) => {
    const { token } = req.body;
    if (typeof token !== 'string' || token.trim().length === 0) {
      return res.status(400).json({ error: 'invalid_token' });
    }

    const pendingUser = req.session.pendingUser;
    const secret = totpSecretStore.get(pendingUser.id);
    if (!secret) {
      return res.status(404).json({ error: 'totp_not_available' });
    }

    if (!totp.check(token, secret)) {
      return res.status(401).json({ error: 'verification_failed' });
    }

    req.session.challenge = undefined;
    finishAuthentication(req, res, pendingUser, 'totp');
  },
);

app.post('/auth/logout', csrfProtection, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'session_destroy_failed' });
    }
    res.clearCookie('editor.sid', {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: 'strict',
    });
    return res.status(204).end();
  });
});

app.get('/analytics/downloads', async (req, res) => {
  try {
    const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
    if (!idsParam) {
      return res.json({ counts: {} });
    }
    const ids = idsParam
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => PROJECT_ID_PATTERN.test(value));
    if (!ids.length) {
      return res.json({ counts: {} });
    }
    const counts = await downloadStore.getCounts(ids);
    return res.json({ counts });
  } catch (error) {
    console.error('Failed to load download statistics', error);
    return res.status(500).json({ error: 'download_stats_unavailable' });
  }
});

app.post('/analytics/downloads', downloadRecordLimiter, async (req, res) => {
  try {
    const { projectId: projectIdRaw, fileId: fileIdRaw, path: pathRaw } = req.body || {};
    if (typeof projectIdRaw !== 'string') {
      return res.status(400).json({ error: 'invalid_project' });
    }
    const projectId = projectIdRaw.trim().toLowerCase();
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      return res.status(400).json({ error: 'invalid_project' });
    }
    const catalogEntry = downloadCatalog.get(projectId);
    if (!catalogEntry) {
      return res.status(404).json({ error: 'project_not_found' });
    }

    let fileId;
    if (typeof fileIdRaw === 'string' && fileIdRaw.trim().length > 0) {
      const trimmed = fileIdRaw.trim();
      if (!FILE_ID_PATTERN.test(trimmed)) {
        return res.status(400).json({ error: 'invalid_file' });
      }
      if (catalogEntry.files && !catalogEntry.files.has(trimmed)) {
        return res.status(400).json({ error: 'file_not_registered' });
      }
      fileId = trimmed;
    }

    let downloadPath;
    if (typeof pathRaw === 'string' && pathRaw.trim().length > 0) {
      const trimmedPath = pathRaw.trim();
      if (trimmedPath.length > 256) {
        return res.status(400).json({ error: 'invalid_path' });
      }
      if (catalogEntry.paths && !catalogEntry.paths.has(trimmedPath)) {
        return res.status(400).json({ error: 'path_not_registered' });
      }
      downloadPath = trimmedPath;
    }

    const result = await downloadStore.record(projectId, {
      fileId,
      path: downloadPath,
    });

    return res.status(202).json({ count: result.count });
  } catch (error) {
    console.error('Failed to record download event', error);
    return res.status(500).json({ error: 'download_record_failed' });
  }
});

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'csrf_invalid' });
  }
  console.error(err);
  return res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`Editor auth server listening on port ${PORT}`);
});
