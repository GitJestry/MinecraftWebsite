# Client Portfolio & Download Hub

This repository houses a static website that functions as a showcase and download hub for a Minecraft creator. The experience is designed to introduce visitors to the client, highlight notable datapacks and 3D-printing models, and provide quick access to social channels.

## Experience Overview
- **Landing page (`index.html`)** — Welcomes visitors with hero imagery, recent highlights, and prominent calls-to-action that steer people toward the download catalogue and social profiles.
- **Download library (`downloads/`)** — Groups Minecraft datapacks and printable `.stl` files with descriptive blurbs and preview imagery so fans can understand each item before downloading.
- **Project gallery (`projects.html`)** — Presents finished builds and works-in-progress, pairing images with context about the creative process to demonstrate craftsmanship and style.
- **Link hub (`links.html`)** — Acts as a consolidated "link in bio," directing visitors to YouTube, TikTok, Instagram, Discord, and other communities where the client is active.

## Visual & Content Notes
- **Branding assets (`assets/`)** provide consistent colours, typography, and iconography across every page, reinforcing the client’s identity.
- **Static HTML** keeps the site lightweight and reliable, making it simple for fans to load the pages quickly and explore downloads without friction.
- **Responsive layout** ensures the experience works on desktop browsers and mobile devices, supporting visitors who follow links from social media.

Overall, the site serves as a central hub where the client can share their creative output, invite collaboration, and grow their audience through curated downloads and an engaging presentation.

## Editor Login

The in-browser projects editor can be enabled by visiting `/editor/`. Because the site is statically hosted on GitHub Pages, authentication is handled entirely client-side. To avoid exposing a readable password, the editor now checks credentials by hashing the provided password with `SHA-256` and a salt before comparing it to the stored hash.

If you want to rotate the admin password:

1. Choose a new password.
2. Generate a salted hash locally (example command below).
3. Update `LOCAL_ADMIN_PASSWORD_HASH` in `assets/js/projects-editor.js` with the new hash.

```bash
node -e "const crypto=require('crypto');const salt='mirl-editor::v1';const password='YOUR_NEW_PASSWORD';console.log(crypto.createHash('sha256').update(salt+password,'utf8').digest('hex'));"
```

Only the salted hash is stored in the repository, so the plaintext password never ships with the site files.
