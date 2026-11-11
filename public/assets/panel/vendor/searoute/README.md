# Sea routing (Voyage Estimator → Itinerary → Route / Get distances)

| File | What |
|---|---|
| `searoute.js` | esbuild bundle (ESM, minified, ~17 KB): `geojson-path-finder` (Dijkstra) + the network snapping of `searoute-ts` |
| `marnet-20km.json` | Eurostat maritime network, 20 km resolution (~3.5 MB, ~0.5 MB gzipped), loaded on first use |
| `LICENSES.txt` | licences of the bundled code and the network data |

Used by `chartering/routing.js` (canal choices, ECA-weighted alternatives); the ECA areas are in
`chartering/engine/eca.js`. Rebuild (Node, outside the site):

```bash
npm i searoute-ts@2.3.1 esbuild@0.24.0
cat > entry.mjs <<'JS'
import PathFinder from 'geojson-path-finder';
export { snapToNetwork, SnapFailedError } from './node_modules/searoute-ts/dist/esm/lib/snap.js';
export const PathFinderCtor = PathFinder.default ?? PathFinder;
JS
npx esbuild entry.mjs --bundle --format=esm --minify --legal-comments=eof --outfile=searoute.js
node -e "const m=require('searoute-ts/dist/data/marnet-20km.cjs');require('fs').writeFileSync('marnet-20km.json',JSON.stringify({type:'FeatureCollection',features:m.features.map(f=>({type:'Feature',properties:f.properties||{},geometry:{type:'LineString',coordinates:f.geometry.coordinates.map(c=>[+c[0].toFixed(4),+c[1].toFixed(4)])}}))}))"
```
