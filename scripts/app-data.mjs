export function parseCityManifest(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return null;
  }

  const numberArray = (value, length) =>
    Array.isArray(value) && value.length === length && value.every(Number.isFinite);
  const network = manifest?.network;
  const obstacles = manifest?.obstacles;
  if (
    manifest?.scope !== 'city' ||
    !numberArray(manifest.origin, 2) ||
    !numberArray(manifest.scale, 2) ||
    !numberArray(manifest.bounds, 4) ||
    typeof network?.nodes !== 'string' ||
    !Number.isInteger(network?.nodeCount) || network.nodeCount <= 0 ||
    typeof network?.edges !== 'string' ||
    !Number.isInteger(network?.edgeCount) || network.edgeCount <= 0 ||
    typeof network?.snapIndex !== 'string' ||
    !Number.isFinite(obstacles?.grid) || obstacles.grid <= 0 ||
    !obstacles?.tiles || typeof obstacles.tiles !== 'object' || Array.isArray(obstacles.tiles)
  ) return null;

  return manifest;
}
