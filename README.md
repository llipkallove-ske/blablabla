# SillyTavern Wardrobe Reference Manager

A lightweight open-source SillyTavern extension for storing character outfits and attaching visual references to them.

## What it does

- Create multiple outfits for a character, persona, or shared wardrobe.
- Add a detailed outfit description, category, and tags.
- Attach multiple reference images to every outfit.
- Upload reference images to SillyTavern's image storage or provide an image URL.
- Select one outfit as the current outfit.
- Inject the outfit description into the prompt.
- For Chat Completions, inject attached references as real `image_url` content blocks so compatible vision models can inspect the images.
- Import/export wardrobes as JSON.
- Keep a gallery of generated images from the current chat or current character image folder.
- View and download gallery images.

## What it deliberately does NOT do

This extension does not generate images and contains no image-generation providers, API keys, generation prompts, retry logic, image generation commands, or generation settings.

The gallery is retained only as a browser for images that already exist in the SillyTavern chat/character image storage.

## Installation

1. In SillyTavern open **Extensions → Install Extension**.
2. Enter the Git repository URL.
3. Enable **Wardrobe Reference Manager**.

For local development, put this directory in `public/scripts/extensions/third-party/wardrobe-reference-manager/`.

## Important multimodal note

Reference images are injected at the `CHAT_COMPLETION_PROMPT_READY` stage and are converted to `data:image/...` URLs before being attached as `image_url` blocks. This is intended for Chat Completions / multimodal-capable APIs. A text-only model cannot visually inspect an image even if the extension stores it.

## Data

Wardrobe metadata is stored in SillyTavern extension settings. Uploaded images are stored through SillyTavern's image upload endpoint. Exported JSON contains the stored image paths/URLs, not the binary image data.

## License

MIT. See `LICENSE`.
