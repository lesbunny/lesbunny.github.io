# lesbunny.github.io — Kira's lavender corner ♡

A self-contained, responsive GitHub Pages profile site for `lesbunny`. The design takes inspiration from Material You: dark plum surfaces, lavender dynamic accents, soft gradients, rounded cards, and a built-in light/dark theme switch.

## Files

- `index.html` — complete website with all CSS and JavaScript included; no build step or libraries required
- `.nojekyll` — serve this as a plain static site
- `README.md` — these notes

## Publish to `https://lesbunny.github.io/`

1. Create a **public** repository on GitHub named exactly **`lesbunny.github.io`** under the `lesbunny` account. For the easiest first push, leave “Add a README file” unchecked so the remote repository starts empty.
2. Extract this ZIP on your computer, open a terminal in the extracted folder, then run:

   ```sh
   git init -b main
   git add index.html README.md .nojekyll
   git commit -m "Create lavender Material You website"
   git remote add origin https://github.com/lesbunny/lesbunny.github.io.git
   git push -u origin main
   ```

   GitHub may ask you to authenticate with your browser or a credential manager.
3. Open the repository's **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/(root)`, and save.
4. Once the Pages deployment completes, visit `https://lesbunny.github.io/`.

## Profile image and Discord link

The profile photo loads from `https://github.com/lesbunny.png?size=320` (your GitHub avatar). If that image cannot load, a lavender ୨୧ fallback appears. The YouTube Music card links directly to `https://music.youtube.com/@WildLesbunny`.

The Discord section copies `kiraissapphic` and opens Discord. A reliable direct profile link generally needs your Discord user ID; the username alone is not enough to safely construct one, so this site doesn't invent a profile URL.

Everything runs in the browser. There are no analytics, external JavaScript libraries, or forms collecting personal data. The light/dark preference is stored locally in each visitor's browser.
