# SunRay Scout

SunRay Scout is an installable progressive web app for exploring estimated sun exposure around a property or garden.

## Run locally

The app must be served over `localhost` or HTTPS for the service worker and installation prompt to work. From this folder, run a static server, for example:

```sh
python -m http.server 8000
```

Then open <http://localhost:8000> in a modern browser. To install it, use the browser's **Install app** or **Add to Home Screen** option.

## Use

1. On launch, the app silently refreshes your GPS position if location permission was already granted, then loads nearby OpenStreetMap building footprints. If permission has not been granted, it uses the last saved location or falls back to Wahroonga, NSW; it does not trigger a permission prompt on launch. Use the location button to request access. Browsers require your permission before sharing GPS coordinates. Location access requires a secure context such as HTTPS or localhost.
2. Choose a date and time to view estimated sun direction and building shadows.
3. Building footprints and mapped boundaries refresh automatically when you pan or zoom. Tap a building to adjust its estimated height; use **Load buildings** to refresh the current map area manually.
4. Choose **Sun audit** and tap a spot for a daily sun estimate.
5. Drag the Sun Position panel by its header to reposition it; the app remembers the position on this device.
6. Choose **Fence / tree** and tap two endpoints to add an editable 2.1 m obstacle.
7. Choose **Print sun sheet** for a four-season comparison at one time, or four times on the selected solstice.

## Data and offline behavior

Leaflet, Turf.js, and SunCalc are loaded from unpkg. Map tiles come from OpenStreetMap; address lookup uses Nominatim; building footprints and fallback boundary lines use Overpass. In NSW, property parcels are loaded from the [NSW Land Parcel Property Theme](https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Land_Parcel_Property_Theme/FeatureServer). Parcel coverage outside NSW depends on boundary data mapped in OpenStreetMap. These services require an internet connection. The service worker caches the app shell and libraries, plus map tiles as they are visited. Search and building data are not available offline.

Shadow and sun exposure results are estimates based on mapped building footprints and assumed heights. They do not account for trees, terrain, or all local conditions.
