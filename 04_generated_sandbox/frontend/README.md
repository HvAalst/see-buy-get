# GLOS Frontend Sandbox

This folder contains the first frontend scaffold for the Global Logistics OS.

## Purpose
- Provide a lightweight plugin-friendly application shell.
- Use design tokens from the existing prototype in `UDIW-010_Multi-Role_Registration_Prototype.html`.
- Demonstrate a simple plugin registration pattern with an example plugin.

## Files
- `src/index.html` — app shell and layout.
- `src/styles.css` — shared design tokens and component styling.
- `src/app.js` — core rendering, plugin registry, and role dashboard.
- `src/plugins/examplePlugin.js` — sample plugin module.

## Run locally
Install a simple static server globally or use the provided npm script:

```bash
cd 04_generated_sandbox/frontend
npm run start
```

Then open `http://localhost:4173`.

## Next steps
- Add real plugin lifecycle hooks (`initialize`, `render`, `configure`).
- Expand the role registry and workflow cards.
- Align further with Yukel.com/Shoplane brand assets.
