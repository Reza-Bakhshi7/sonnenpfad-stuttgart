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
  const assetList = value => typeof value === 'string' || (Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string'));
  if (
    manifest?.scope !== 'city' ||
    !numberArray(manifest.origin, 2) ||
    !numberArray(manifest.scale, 2) ||
    !numberArray(manifest.bounds, 4) ||
    !assetList(network?.nodes) ||
    !Number.isInteger(network?.nodeCount) || network.nodeCount <= 0 ||
    !assetList(network?.edges) ||
    !Number.isInteger(network?.edgeCount) || network.edgeCount <= 0 ||
    !assetList(network?.snapIndex) ||
    !Number.isFinite(obstacles?.grid) || obstacles.grid <= 0 ||
    !obstacles?.tiles || typeof obstacles.tiles !== 'object' || Array.isArray(obstacles.tiles)
  ) return null;

  return manifest;
}
