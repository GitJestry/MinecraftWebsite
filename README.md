# MinecraftWebsite

Static site for the Minecraft In Real Life project. The content in the repository can be deployed directly to any static web host (e.g. GitHub Pages) without running a custom server.

## GitHub Pages setup

1. Push the repository to GitHub.
2. Enable GitHub Pages for the repository and choose the branch that contains the website (typically `main`).
3. Set the Pages source to the repository root. All assets are served relative to the page, so subdirectory deployments such as `https://<user>.github.io/<repo>/` work out of the box.

The projects grid and download counters read data from static JSON files in `assets/data/`, so no background services are required online.

## Updating projects & downloads

Project information lives in [`assets/data/projects.json`](assets/data/projects.json). Download counters can be pre-populated in [`assets/data/download-counts.json`](assets/data/download-counts.json). Edit these files and commit the changes to publish new content.

The rich editor UI on `projects.html` remains available for local maintenance workflows, but it is automatically disabled when the site runs in static-hosting mode (such as GitHub Pages).

## Optional editor backend

The `server/` directory still contains the Node.js backend that powered the live editor during development. You only need it when you want to use the interactive editor locally:

```bash
cd server
npm install
npm run dev
```

Set `document.documentElement.dataset.editorApi` or `window.MIRL_EDITOR_API` to point the front-end to the backend when working locally. For GitHub Pages (or any other static host) this step is not necessary—the site works with the bundled JSON data.
