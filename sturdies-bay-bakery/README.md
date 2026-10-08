# Sturdies Bay Bakery website

A simple static site (plain HTML + CSS, no build step) for Sturdies Bay Bakery on Galiano Island, BC.

- `index.html`: the page (menu, contact, hours)
- `styles.css`: ocean-inspired styling

## Preview locally

Open `index.html` in a browser, or run:

```bash
python3 -m http.server 8080 --directory sturdies-bay-bakery
```

## Deploy on Vercel

1. Import this GitHub repo at <https://vercel.com/new>.
2. Set **Root Directory** to `sturdies-bay-bakery`.
3. Framework preset: **Other**. Leave the build command empty.
4. Deploy.

## Photos

The photos are free Unsplash images (free for commercial use), linked directly from
`images.unsplash.com`. Each photo has an ocean or sand gradient behind it, so the
layout still looks right if one doesn't load. To use the bakery's own photos, add
them to an `images/` folder and change the `src="..."` values in `index.html`.

## Things to confirm with the owners

- Real opening hours (search for `TODO` in `index.html`)
- Menu items and whether to add prices
- Phone number (250) 539-0094 and address 44 Madrona Drive
