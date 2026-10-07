/**
 * SillyWardrobe — wardrobe + gallery only.
 * Generation / try-on / image-provider functionality is intentionally disabled.
 */
import { initWardrobe } from './src/wardrobe.js';
import { initGallery } from './src/gallery.js';

(function init() {
    const context = SillyTavern.getContext();
    initWardrobe();
    initGallery();
    context.eventSource.on(context.event_types.APP_READY, () => {
        console.log('[SillyWardrobe] Wardrobe + gallery loaded');
    });
})();
