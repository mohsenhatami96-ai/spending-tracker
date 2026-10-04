# Spending Tracker (installable web app)

Static files only; publish this folder as-is (for example GitHub Pages: Settings → Pages → deploy from a branch, folder with these files).
All paths are relative, so it works at `https://<user>.github.io/<repo-name>/`.

On iPhone: open the URL in Safari → Share → **Add to Home Screen**. After the first load it works fully offline.
Your data is stored only on the device (localStorage of the installed app); nothing is uploaded. iOS can clear website data
for apps that aren't used for a while, and removing the Home Screen icon removes its data: export a JSON backup from Settings regularly.

Rebuild after changing `spending-tracker.html`: `node build-pwa.js` (the cache version changes and installed apps show an "Update" prompt).
