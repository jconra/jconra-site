# 4HEX — Gem Defense

Open `/projects/4hex/` on the site. The root `index.html` and `assets/` are the ready-to-serve game; no server-side build is required.

## Update the game

Editable files and rule tests are in `source/`.

```sh
cd source
npm ci
npm test
npm run dev
# Rebuild the served files in the parent folder:
npm run build
```

Commit the source changes together with the rebuilt index.html and assets.

The game supports mouse, touch, and keyboard. Use the question-mark button for instructions and the field guide for special recipes.
