import iconsUiUrl from '../assets/icons-ui.avif';
import icons0Url from '../assets/icons-0.avif';
import icons1Url from '../assets/icons-1.avif';
import icons2Url from '../assets/icons-2.avif';
import icons3Url from '../assets/icons-3.avif';

async function preloadImage(url: string) {
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
  } catch (err) {
    console.log('preload failed, ignoring', url, err);
  }
}

function preloadImages() {
  void (async () => {
    await preloadImage(iconsUiUrl);
    await preloadImage(icons0Url);
    await Promise.all([preloadImage(icons1Url), preloadImage(icons2Url), preloadImage(icons3Url)]);
  })();
}

setTimeout(preloadImages, 0);
