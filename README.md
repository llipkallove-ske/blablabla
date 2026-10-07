# SillyWardrobe — Reference Manager

A personal SillyTavern wardrobe/reference extension.

## What it keeps

- Wardrobe button in the bottom send bar.
- Bot / User tabs.
- Personal and shared wardrobes.
- Outfit types, filters, sorting and pagination.
- Outfit activation ("wear").
- Outfit name and description.
- Multiple visual references per outfit.
- Per-reference name, description and enabled/disabled state.
- Local image storage through SillyTavern's bundled `localforage` when available.
- Chat/character image gallery.
- Lightbox for gallery images.
- JSON-compatible SillyTavern extension settings for wardrobe metadata.

## What it intentionally does not contain

- Image generation providers.
- Try-on generation.
- Image generation API keys.
- Image generation commands.

## Install

The folder containing `manifest.json` is the extension folder. Put it under:

`data/<user>/extensions/wardrobe-reference-manager/`

Then restart/reload SillyTavern.

## License

For personal use. This repository is a clean-room implementation of the wardrobe workflow and does not bundle the original generator code.
