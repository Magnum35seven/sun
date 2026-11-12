(() => {
  'use strict';
  const defaultCoords = [-33.7186, 151.1167];
  const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView(defaultCoords, 18);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  const buildingLayer = L.layerGroup().addTo(map), shadowLayer = L.layerGroup().addTo(map), pinLayer = L.layerGroup().addTo(map);
  const $ = id => document.getElementById(id);
  const datePicker = $('datePicker'), timeSlider = $('timeSlider'), timeDisplay = $('timeDisplay');
  const sunStats = $('sunStats'), sunDirection = $('sunDirection'), toast = $('toast');
  datePicker.value = '2026-06-21';
  let buildingsData = [], auditMode = false, fenceMode = false, fenceStartPoint = null, currentPin = null, toastTimer;

  function showToast(message, duration = 3000) {
    toast.textContent = message; toast.style.display = 'block'; clearTimeout(toastTimer);
    if (duration > 0) toastTimer = setTimeout(() => { toast.style.display = 'none'; }, duration);
  }
  function getSelectedDateTime() {
    const [y, m, d] = datePicker.value.split('-').map(Number), mins = Number(timeSlider.value);
    return new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60);
  }
  function computeShadows(date, lat, lng) {
    const sunPos = SunCalc.getPosition(date, lat, lng);
    const sunBearing = (sunPos.azimuth * 180 / Math.PI + 180 + 360) % 360;
    const shadowBearing = (sunBearing + 180) % 360;
    if (sunPos.altitude <= 0.02) return { sunPos, sunBearing, shadows: [], isNight: true };
    const shadows = [];
    for (const b of buildingsData) {
      const lengthKm = Math.min(b.height / Math.tan(sunPos.altitude), 120) / 1000;
      try {
        const shifted = turf.transformTranslate(b.poly, lengthKm, shadowBearing);
        const points = turf.featureCollection([...turf.coordAll(b.poly), ...turf.coordAll(shifted)].map(c => turf.point(c)));
        const hull = turf.convex(points);
        if (hull) shadows.push(hull);
      } catch (_) { /* Skip malformed geometry. */ }
    }
    return { sunPos, sunBearing, shadows, isNight: false };
  }
  function updateShadows() {
    const dt = getSelectedDateTime(), center = map.getCenter(), result = computeShadows(dt, center.lat, center.lng);
    timeDisplay.textContent = dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const altitude = (result.sunPos.altitude * 180 / Math.PI).toFixed(1);
    sunStats.textContent = result.isNight ? `Sun below horizon · ${altitude}°` : `Altitude ${altitude}°`;
    sunDirection.textContent = `Direction ${Math.round(result.sunBearing)}°`;
    shadowLayer.clearLayers();
    for (const shadow of result.shadows) L.geoJSON(shadow, { interactive: false, style: { color: '#111d2c', weight: 0, fillColor: '#111d2c', fillOpacity: 0.48 } }).addTo(shadowLayer);
  }
  function renderBuildings() {
    buildingLayer.clearLayers();
    for (const b of buildingsData) {
      const layer = L.geoJSON(b.poly, { style: { color: b.isCustom ? '#37d39a' : '#e9a93f', weight: 1.5, fillColor: b.isCustom ? '#37d39a' : '#e9a93f', fillOpacity: .28 } });
      layer.on('click', e => {
        L.DomEvent.stopPropagation(e);
        const form = document.createElement('form'); form.className = 'popup-form';
        const title = document.createElement('strong'); title.textContent = b.label;
        const label = document.createElement('label'); label.textContent = 'Estimated height (metres)';
        const input = document.createElement('input'); input.type = 'number'; input.min = '.5'; input.step = '.1'; input.value = b.height;
        const button = document.createElement('button'); button.type = 'submit'; button.textContent = 'Update height';
        form.append(title, label, input, button);
        form.addEventListener('submit', ev => { ev.preventDefault(); const value = Number(input.value); if (value > 0) { b.height = value; map.closePopup(); updateShadows(); if (currentPin) runPinAudit(currentPin); } });
        L.popup().setLatLng(e.latlng).setContent(form).openOn(map);
      });
      layer.addTo(buildingLayer);
    }
  }

  async function searchAddress(event) {
    if (event) event.preventDefault();
    const q = $('addressInput').value.trim(); if (!q) return;
    showToast('Searching address…', 0);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'Accept': 'application/json' } });
      if (!response.ok) throw new Error('Search service unavailable');
      const data = await response.json();
      if (!data.length) { showToast('Address not found. Try adding a suburb or postcode.'); return; }
      map.setView([Number(data[0].lat), Number(data[0].lon)], 18); showToast(`Showing ${data[0].display_name.split(',').slice(0, 2).join(',')}`);
      await fetchBuildings();
    } catch (error) { showToast('Search failed. Check your connection and try again.'); }
  }
  async function fetchBuildings() {
    if (map.getZoom() < 16) { showToast('Zoom in to street level before loading buildings.'); return; }
    const bounds = map.getBounds();
    const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
    const query = `[out:json][timeout:25];(way["building"](${bbox}););out body;>;out skel qt;`;
    showToast('Loading nearby building footprints…', 0);
    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: query });
      if (!response.ok) throw new Error('Overpass request failed');
      const data = await response.json(), nodes = new Map();
      for (const el of data.elements) if (el.type === 'node') nodes.set(el.id, [el.lon, el.lat]);
      const custom = buildingsData.filter(b => b.isCustom); buildingsData = [...custom];
      for (const el of data.elements) {
        if (el.type !== 'way' || !el.nodes || el.nodes.length < 4) continue;
        const coords = el.nodes.map(id => nodes.get(id)).filter(Boolean);
        if (coords.length < 4) continue;
        if (coords[0][0] !== coords.at(-1)[0] || coords[0][1] !== coords.at(-1)[1]) coords.push(coords[0]);
        const tags = el.tags || {}; let height = Number.parseFloat(tags.height);
        if (!Number.isFinite(height)) height = Number.parseFloat(tags['building:levels']) * 3.2;
        if (!Number.isFinite(height)) height = 5.5;
        try { buildingsData.push({ id: el.id, poly: turf.polygon([coords]), height, label: tags.name || 'Building', isCustom: false }); } catch (_) { /* Ignore invalid footprints. */ }
      }
      renderBuildings(); updateShadows(); if (currentPin) runPinAudit(currentPin);
      showToast(`Loaded ${buildingsData.length} structures. Tap one to adjust its height.`);
    } catch (error) { showToast('Building data is busy or unavailable. Please try again shortly.'); }
  }
  function runPinAudit(latlng) {
    currentPin = latlng; pinLayer.clearLayers(); L.marker([latlng.lat, latlng.lng]).addTo(pinLayer);
    const point = turf.point([latlng.lng, latlng.lat]), [y, m, d] = datePicker.value.split('-').map(Number);
    let sunny = 0, shaded = 0, firstSun = null, lastSun = null;
    for (let mins = 330; mins <= 1200; mins += 30) {
      const date = new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60), result = computeShadows(date, latlng.lat, latlng.lng);
      if (result.isNight) continue;
      const inShade = result.shadows.some(shadow => turf.booleanPointInPolygon(point, shadow));
      if (inShade) shaded++;
      else { sunny++; if (!firstSun) firstSun = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); lastSun = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
    }
    const sunHours = sunny * .5, shadeHours = shaded * .5, badge = $('auditBadge');
    $('auditCard').classList.add('visible');
    if (sunHours >= 6) { badge.textContent = `Full sun · ${sunHours.toFixed(1)} h`; badge.className = 'badge full-sun'; $('auditTitle').textContent = 'Plenty of direct light'; }
    else if (sunHours >= 3) { badge.textContent = `Part shade · ${sunHours.toFixed(1)} h`; badge.className = 'badge part-shade'; $('auditTitle').textContent = 'A mix of sun and shade'; }
    else { badge.textContent = `Full shade · ${sunHours.toFixed(1)} h`; badge.className = 'badge full-shade'; $('auditTitle').textContent = 'Mostly shaded'; }
    const window = firstSun ? `${firstSun} – ${lastSun}` : 'No direct sun in sampled hours';
    const recommendation = sunHours >= 6 ? 'Good conditions for fruiting vegetables and sun-loving plants.' : sunHours >= 3 ? 'A good fit for leafy greens, herbs, and many patio plants.' : 'Consider shade-loving plants such as ferns and other understory varieties.';
    $('auditDetails').textContent = `Direct sun window: ${window}. About ${shadeHours.toFixed(1)} hours shaded by mapped structures. ${recommendation}`;
    $('mapHint').textContent = 'Audit estimates use mapped building shapes and height estimates; trees and terrain are not included.';
  }

  $('searchForm').addEventListener('submit', searchAddress);
  $('fetchBuildingsBtn').addEventListener('click', fetchBuildings);
  $('locateBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { showToast('Location is not available in this browser.'); return; }
    showToast('Finding your location…', 0);
    navigator.geolocation.getCurrentPosition(position => { map.setView([position.coords.latitude, position.coords.longitude], 18); showToast('Showing your location.'); }, () => showToast('Could not access location. Check browser permission.'), { enableHighAccuracy: true, timeout: 10000 });
  });
  $('auditModeBtn').addEventListener('click', () => {
    auditMode = !auditMode; fenceMode = false; fenceStartPoint = null;
    $('addFenceBtn').classList.remove('active'); $('auditModeBtn').classList.toggle('active', auditMode);
    $('auditModeBtn').innerHTML = auditMode ? '<span>⌖</span> Tap map to audit' : '<span>⌖</span> Sun audit';
    if (auditMode) showToast('Tap a spot on the map to see its sun exposure.');
  });
  $('addFenceBtn').addEventListener('click', () => {
    fenceMode = !fenceMode; auditMode = false; fenceStartPoint = null;
    $('auditModeBtn').classList.remove('active'); $('auditModeBtn').innerHTML = '<span>⌖</span> Sun audit';
    $('addFenceBtn').classList.toggle('active', fenceMode);
    if (fenceMode) showToast('Tap the two endpoints of a fence or hedge.');
  });
  map.on('click', e => {
    if (auditMode) runPinAudit(e.latlng);
    else if (fenceMode) {
      if (!fenceStartPoint) { fenceStartPoint = e.latlng; showToast('Now tap the other end.'); return; }
      try {
        const line = turf.lineString([[fenceStartPoint.lng, fenceStartPoint.lat], [e.latlng.lng, e.latlng.lat]]);
        const poly = turf.buffer(line, .00025, { units: 'kilometers' });
        if (!poly) throw new Error('Could not create fence');
        buildingsData.push({ id: `custom-${Date.now()}`, poly, height: 2.1, label: 'Custom fence / hedge', isCustom: true });
        renderBuildings(); updateShadows(); if (currentPin) runPinAudit(currentPin); showToast('Added a 2.1 m fence. Tap it to adjust height.');
      } catch (_) { showToast('Could not add that fence. Try two points farther apart.'); }
      fenceStartPoint = null; fenceMode = false; $('addFenceBtn').classList.remove('active');
    }
  });
  timeSlider.addEventListener('input', updateShadows);
  datePicker.addEventListener('change', () => { updateShadows(); if (currentPin) runPinAudit(currentPin); });
  document.querySelectorAll('.presets button').forEach(button => button.addEventListener('click', () => {
    datePicker.value = button.dataset.date; document.querySelectorAll('.presets button').forEach(b => b.classList.toggle('selected', b === button));
    updateShadows(); if (currentPin) runPinAudit(currentPin);
  }));
  $('panelToggle').addEventListener('click', () => {
    const content = $('panelContent'), collapsed = content.hidden;
    content.hidden = !collapsed; $('panelToggle').textContent = collapsed ? '⌄' : '⌃';
    $('panelToggle').setAttribute('aria-label', collapsed ? 'Collapse controls' : 'Expand controls');
  });
  map.on('moveend', updateShadows);
  updateShadows(); fetchBuildings();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
