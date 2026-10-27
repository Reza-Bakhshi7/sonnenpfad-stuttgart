# 3D display — 0.14.1 preview

The map uses native MapLibre raster-dem terrain in 3D, with the existing local
Terrain-RGB zoom pyramid 12–14. The zoom URL includes {z}; close views no longer
remain on the fixed coarse level 12. In 3D the minimum camera zoom is 12 so the
renderer stays within the available pyramid. Returning to 2D removes terrain.
Terrain exaggeration is 1. A restrained hillshade and 55-degree entry pitch
make relief easier to read without changing its heights. The terrain applies
to vector basemaps and official LGL imagery alike and stays active in replay.

These assets reconstruct a smooth surface from Atlas network endpoint heights,
as described by dem/metadata.json. They are not a newly supplied complete DGM1.
Atlas route heights and slope costs are unchanged. The shadow calculation still
uses its documented simplified ground assumptions rather than terrain occlusion.

Native vector buildings are draped by MapLibre. Three.js trees sample the same
local zoom-14 heightfield at exaggeration 1. Updated ground heights replace cached
instances, while failed requests do not fabricate a zero-height ground value.
The shared WebGL renderer resets state before and after each tree draw.

Mode transitions retain centre/zoom where permitted and do not wait for optional
tree requests. Terrain loading uses the SDK cache and static local assets; tree
sampling is bounded to four concurrent tile requests. The 3D frame and actual
mobile touch gestures still require a WebGL-capable device review.
