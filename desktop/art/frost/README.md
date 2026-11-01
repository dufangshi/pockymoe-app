# Frost (小霜) — bundled desktop pet

Original character: a small white dragon girl in a hooded cape with a gold bell.

- `concept.png`: the chosen concept, generated with gpt-image-2.5 from `prompt-concept.txt`.
- `poses-1.png` / `poses-2.png`: 24 key poses on flat #00FF00, generated as edits of the concept (`prompt-poses-*.txt`). Her white hair loses its edge in a matte produced by the image model, so these are keyed by the builder instead.

Rebuild (needs Pillow, numpy, scipy):

```sh
python3 ../moe/build_atlas.py poses-1.png poses-2.png ../../assets/pets/frost --chroma --id frost --name "小霜 Frost" --description "原创的白发小龙娘，戴着铃铛，帮你看着线程。"
```

The builder also writes `spritesheet.png`; only the WebP ships.
