// Fixed-camera projections of the revision-three Waibaidu mesh. The moving
// material belongs to the riverward joint N4-B (lower chord, first span).
export const experimentScene = Object.freeze({
  width: 1040,
  height: 550,
  joint: 'N4-B',
  target: [420, 344],
  loweredTarget: [420, 379],
  referenceURL: new URL('./waibaidu-joint-reference.webp', import.meta.url).href,
  loweredURL: new URL('./waibaidu-joint-lowered.webp', import.meta.url).href
});

function loadFrame(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth === experimentScene.width && image.naturalHeight === experimentScene.height) {
        resolve(image);
      } else {
        reject(new Error('Unexpected bridge frame dimensions'));
      }
    };
    image.onerror = () => reject(new Error('Could not load the bridge frame'));
    image.src = url;
  });
}

export async function loadExperimentScene() {
  const [reference, lowered] = await Promise.all([
    loadFrame(experimentScene.referenceURL),
    loadFrame(experimentScene.loweredURL)
  ]);
  return {
    draw(context, shifted = false) {
      context.drawImage(shifted ? lowered : reference, 0, 0, experimentScene.width, experimentScene.height);
    }
  };
}
