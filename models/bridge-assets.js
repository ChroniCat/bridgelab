// Active geometry is version-addressed. Saved field bindings can request
// historical revisions independently without changing the bridge shown to a new visitor.
export async function loadBridgeGeometry(id, revision) {
  let filename;
  if (id === 'waibaidu') {
    revision ??= 3;
    filename = {1:'waibaidu-v1.json', 2:'waibaidu-v2.json', 3:'waibaidu-r3.json'}[revision];
  } else if (id === 'training-span') {
    filename = 'training-span.json';
  }
  if (!filename) throw new Error('Unknown bridge revision');
  const response = await fetch(new URL(filename, import.meta.url));
  if (!response.ok) throw new Error('Bridge geometry unavailable');
  return validateBridgeGeometry(await response.json(), id, revision);
}

export function validateBridgeGeometry(model, id, revision = 3) {
  if (model?.id !== id ||
      (id === 'waibaidu' && (model.revision !== revision ||
       (revision >= 2 && model.kind !== 'visual-reconstruction')))) {
    throw new Error('Bridge geometry revision mismatch');
  }
  return model;
}
