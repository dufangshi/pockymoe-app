# Moe — bundled desktop pet

Original character for Remote Codex Desktop: a cobalt axolotl whose amber gills echo the app's two brand colors.

- `concept.png`: the chosen concept, generated with gpt-image-2.5 from `prompt-concept.txt`.
- `poses-1.png` / `poses-2.png`: 24 key poses with real alpha, generated as edits of the concept so the character stays consistent (`prompt-poses-*.txt`).
- `build_atlas.py`: slices the poses, fixes one global scale and a common foot baseline, derives the in-between frames (breathing, blink, walk bob, jump squash/stretch, gill glow pulse while working) and writes the Codex-compatible pack to `../../assets/pets/moe/`.

Rebuild (needs Pillow, numpy, scipy):

```sh
python3 build_atlas.py poses-1.png poses-2.png ../../assets/pets/moe
```

The atlas follows the hatch-pet contract: 1536×1872, 8×9 cells of 192×208, rows idle, running-right, running-left, waving, jumping, failed, waiting, running, review. `sleeping.webp` is a Remote Codex extension (4 frames, declared under `remoteCodex.sleeping` in `pet.json`) that Codex ignores.
