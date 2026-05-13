# Cuisine card images

Drop a file here named `<lowercase-cuisine>.jpg` (or `.webp`) and the
discovery-home cuisine card for that cuisine automatically swaps from
the gradient-plus-emoji fallback to your photo on the next page load.
No code change per image — `CuisineCard` in
`src/components/discovery-home.tsx` checks `/cuisines/{slug}.jpg` on
mount and falls back gracefully when the file 404s.

## Convention

| Cuisine value | Expected filename       |
| ------------- | ----------------------- |
| `PAKISTANI`   | `pakistani.jpg`         |
| `INDIAN`      | `indian.jpg`            |
| `MEDITERRANEAN` | `mediterranean.jpg`   |
| `LEBANESE`    | `lebanese.jpg`          |
| `TURKISH`     | `turkish.jpg`           |
| `YEMENI`      | `yemeni.jpg`            |
| `AFGHAN`      | `afghan.jpg`            |
| `AMERICAN`    | `american.jpg`          |

The component lowercases the enum value, so any future addition to
`TOP_CUISINES` works the same way.

## Image specs

- **Aspect ratio**: strict 4:5 (taller than wide). The card crops
  with `object-cover`; anything off-ratio will lose heads or feet.
- **Dimensions**: 800 × 1000 px is a comfortable 2x source that
  covers retina on the largest desktop render (~183 × 229 css px).
  3x phone displays will use up to ~600 × 750 css px; 800 × 1000
  still covers that.
- **Format**: WebP preferred, JPG works. Avoid PNG (huge file size
  for photographic content).
- **File size target**: under 100 KB per image. They're decorative
  card thumbnails, not gallery photos. Squoosh.app or ImageMagick
  can squeeze a 1 MB JPG down to ~80 KB at ~80% quality without
  visible loss.

## How the fallback works

`CuisineCard` renders an `<img>` with the expected path and an
`onError` handler. If the image loads, it covers the card with a
dark gradient overlay on top so the white label stays legible. If
the image 404s, `onError` flips state, the `<img>` un-mounts, and
the parent button's gradient background plus the flag emoji become
visible — exactly the pre-image design.

So: gradient + emoji is always the safety net. New image rolling
out for one cuisine doesn't affect the others. Removing an image
(delete the file) reverts that one card without touching code.
