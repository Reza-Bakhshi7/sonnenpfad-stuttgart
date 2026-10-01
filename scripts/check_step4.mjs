import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const cityRoot = path.join(root, 'dist', 'city');
const manifest = JSON.parse(fs.readFileSync(path.join(cityRoot, 'manifest.json'), 'utf8'));
const appSource = fs.readFileSync(path.join(root, 'scripts', 'app.source.mjs'), 'utf8');
const appStyles = fs.readFileSync(path.join(root, 'dist', 'style.css'), 'utf8');
const appHtml = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
const workerSource = fs.readFileSync(path.join(root, 'scripts', 'worker.mjs'), 'utf8');
const expectedThemes = ['slope', 'surface', 'shadeSummer', 'shadeWinter', 'utciSummer', 'utciWinter', 'noise', 'wind'];

assert(!appSource.includes("getAttribute('aria-label')=t('layersTitle')"), 'Layer language setup must not assign to getAttribute().');
assert(appSource.includes("map.setMinZoom(is3D?15.25"), '3D zoom-out must be limited for performance.');
assert(appSource.includes('prepareRouteShade'), 'Long routes must load a complete shade corridor before routing.');
assert(appSource.includes('outsideLocation'), 'Out-of-city geolocation must use a dismissible message.');
assert(appSource.includes('function addPoiMapImage'), 'POIs must be normalized into fixed-size map markers.');
assert(appSource.includes("14.5,.62,17,.8,19,.92"), 'POI map markers must stay compact across zoom levels.');
for (const color of ['#1a9641', '#5f5f5f', '#d7191c', '#c43c39']) assert(appSource.includes(color), `Missing POI color: ${color}`);
assert(appStyles.includes('.poi-symbol:after'), 'POI list entries must use the same circular symbol treatment as the map.');
assert(appStyles.includes('border-radius:50%'), 'POI list symbols must be circular.');
assert(appSource.includes("activeTheme='slope'"), 'Slope must be the mandatory default theme.');
assert(!appHtml.includes('<option value="none">Kein Thema</option>'), 'Thematic display must not have a no-theme option.');
assert(appSource.includes("id:'slope-arrows'"), 'Slope direction arrows must be rendered.');
assert(appSource.includes("'icon-image':'slope-uphill-arrow'"), 'Slope arrows must use a bundled icon instead of a font glyph.');
assert(appSource.includes("'symbol-placement':'line-center'"), 'Each eligible atlas segment must have at most one centred arrow.');
assert(appSource.includes('length<24'), 'Very short atlas segments must not receive slope arrows.');
assert(appSource.includes("'icon-allow-overlap':false"), 'Slope arrows must respect collision detection to avoid visual clutter.');
assert(!appSource.includes("'text-field':'➤'"), 'Slope arrows must not depend on an unavailable map font glyph.');
assert(appSource.includes("14.5,3.4,17,5.8,19,7"), 'Thematic lines must use the thicker review widths.');
assert(!appSource.includes('function toggleTimePlayer'), 'Time animation must remain removed.');
assert(!appHtml.includes('time-play'), 'Time animation controls must remain removed.');
assert(appSource.includes('function updateImmediateSun'), 'Sun direction must update immediately while time changes.');
assert(appSource.includes("setTimeout(()=>requestShade(false,{silent:true}),650)"), '3D must request one shade refresh only after the camera settles.');
assert(appSource.includes("layout:{visibility:'none'},paint:{'raster-opacity':.34"), 'The shadow raster must be hidden in 2D.');
assert(!appSource.includes('setTimeout(loadVisibleCityTiles,700)'), '2D/3D switching must not schedule a duplicate tile reload.');
assert(!appSource.includes("id:'trees-fill'"), 'Tree geometry must not be rendered in 2D mode.');
assert(appSource.includes("'line-color':'#d7191c','line-width':9"), 'The selected route must be a strong, double-width red line.');
assert(appStyles.includes('.theme-option.selected'), 'Mandatory theme radio controls must be styled.');
assert(workerSource.includes('if(d.routeAware)'), 'Only route-specific shade jobs may update edge weights.');
for (const icon of ['shade-material.svg', 'walking-aid-material.svg']) {
  const iconText = fs.readFileSync(path.join(root, 'dist', 'icons', icon), 'utf8');
  assert(iconText.includes('Google Material Symbols Rounded'), `Missing upstream attribution in ${icon}`);
}
assert(fs.existsSync(path.join(cityRoot, 'stuttgart-boundary.json')), 'Exact Stuttgart municipal boundary is required.');
const poiIcons = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'poi-icons.json'), 'utf8'));
for (const icon of ['Signalized_Crossings.svg','Elevators.svg','Ramps.svg','Escalators.svg','Stairs.svg','Barriers_and_Gates.svg','Lowered_Curbs.svg','Raised_Curbs.svg','Benches.svg','Shelters.svg']) assert.match(poiIcons[icon], /^data:image\/svg\+xml;base64,/, `Missing embedded atlas POI icon: ${icon}`);
assert.equal(manifest.version, 5);
assert.deepEqual(manifest.themes, expectedThemes);
assert.equal(Object.keys(manifest.poiTypes).length, 10);
assert.deepEqual(manifest.crossingAccessibility?.classes, {
  0: { key: 'unknown', color: '#9E9E9E', count: 2092 },
  1: { key: 'none', color: '#C62828', count: 251 },
  2: { key: 'partial', color: '#F9A825', count: 1216 },
  3: { key: 'good', color: '#2E7D32', count: 702 },
});
assert.equal(manifest.visual?.count, manifest.network.edgeCount);
assert.equal(fs.statSync(path.join(cityRoot, manifest.visual.slopeDirections)).size, manifest.network.edgeCount);

let lines = 0;
let pois = 0;
const poiTypes = new Set();
for (const tile of Object.values(manifest.obstacles.tiles)) {
  const display = JSON.parse(fs.readFileSync(path.join(cityRoot, tile.displayFile), 'utf8'));
  const shade = JSON.parse(fs.readFileSync(path.join(cityRoot, tile.shadeFile), 'utf8'));
  assert.equal(display.lines.length, display.edgeIds.length);
  assert.equal(display.lines.length, display.themes.length);
  assert.equal(display.pois.length, tile.pois);
  assert.equal(shade.buildings.length, tile.buildings);
  assert.equal(shade.trees.length, tile.trees);
  for (const theme of display.themes) assert.equal(theme.length, expectedThemes.length);
  for (const poi of display.pois) {
    assert.equal(poi.p.length, 2);
    poiTypes.add(poi.k);
  }
  lines += display.lines.length;
  pois += display.pois.length;
}

assert.equal(lines, manifest.counts.lines);
assert.equal(pois, manifest.counts.pois);
assert.equal(poiTypes.size, 10);
assert.ok(pois > 13_000);
console.log(`Step 4 tile contract verified: ${lines} lines, ${pois} POIs, ${poiTypes.size} POI types`);
