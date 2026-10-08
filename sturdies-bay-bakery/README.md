# Sturdies Bay Bakery website

A static site (plain HTML, CSS and a little JavaScript, no build step) for
Sturdies Bay Bakery on Galiano Island, BC.

| File | What it is |
|---|---|
| `index.html` | The page: chart hero, menu, photos, visit details |
| `styles.css` | All styling |
| `config.js` | **Hours and Instagram handle. Edit this to update the site.** |
| `404.html` | Page shown for broken links (Vercel serves it automatically) |
| `og-image.png` | Image shown when the link is shared in texts and social apps |
| `favicon.svg`, `apple-touch-icon.png` | Browser tab and phone home-screen icons |
| `vercel.json` | Clean URLs and image caching on Vercel |

## Updating hours and Instagram

Open `config.js` and fill in `hours` (there's an example in the file) and
`instagram`. Once hours are set, the site:

- shows an **Open now · until 3pm** / **Closed · opens 7am** badge in the menu bar,
  using island time (America/Vancouver)
- lists the hours in the Visit section, grouping days with the same times

## Photos

The photos are free Unsplash images linked from `images.unsplash.com`. To use the
bakery's own photos, add them to an `images/` folder and change the `src="..."`
values in `index.html`. If a photo fails to load, a labelled placeholder shows
instead.

## Preview locally

```bash
python3 -m http.server 8080 --directory sturdies-bay-bakery
```

## Deploy on Vercel

1. Import this GitHub repo at <https://vercel.com/new>.
2. Set **Root Directory** to `sturdies-bay-bakery`.
3. Framework preset: **Other**. Leave the build command empty.
4. Deploy.

After the first deploy, in `index.html`, change the `og:image` and `image` values
from `/og-image.png` to the full address (e.g. `https://sturdiesbaybakery.ca/og-image.png`)
so link previews work everywhere.

## Still needed from the owners

- Real opening hours (goes in `config.js`)
- Instagram handle, if there is one (goes in `config.js`)
- Photos of the bakery
- Menu check and prices, if wanted
- Confirm phone (250) 539-0094 and address 44 Madrona Drive
