// met.no LocationForecast 2.0 — free, no key, global
async function fetchMetNo(lat, lon) {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'GlassySwimApp/1.0 github.com/gregstreak/glassy' }
  });
  if (!res.ok) throw new Error(`met.no ${res.status}`);
  return res.json();
}

// Open-Meteo Marine — free, no key, global coastal coverage
async function fetchMarine(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: [
      'wave_height',
      'wave_period',
      'wave_direction',
      'swell_wave_height',
      'swell_wave_period',
      'swell_wave_direction',
      'wind_wave_height',
    ].join(','),
    timezone: 'auto',
    forecast_days: 2,
  });
  const url = `https://marine-api.open-meteo.com/v1/marine?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo Marine ${res.status}`);
  return res.json();
}

// Open-Meteo Marine — sea surface temperature
async function fetchSST(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: 'sea_surface_temperature',
    timezone: 'auto',
    forecast_days: 1,
  });
  const url = `https://marine-api.open-meteo.com/v1/marine?${params}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function findCurrentHourIdx(times) {
  const now = new Date();
  const prefix = now.toISOString().slice(0, 13);
  const idx = times.findIndex(t => t && t.startsWith(prefix));
  return idx >= 0 ? idx : 0;
}

function cardinalWind(degrees) {
  if (degrees == null) return '—';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(degrees / 22.5) % 16];
}

// Extract rain probability from met.no timeseries entry
// met.no provides it in next_1_hours, next_6_hours, or next_12_hours
function getRainProb(entry) {
  if (!entry?.data) return null;
  const n1 = entry.data.next_1_hours?.details?.probability_of_precipitation;
  if (n1 != null) return Math.round(n1);
  const n6 = entry.data.next_6_hours?.details?.probability_of_precipitation;
  if (n6 != null) return Math.round(n6);
  const n12 = entry.data.next_12_hours?.details?.probability_of_precipitation;
  if (n12 != null) return Math.round(n12);
  // Fall back to precipitation amount as a proxy
  const precip = entry.data.next_1_hours?.details?.precipitation_amount;
  if (precip != null) return precip > 0 ? Math.min(100, Math.round(precip * 40)) : 0;
  return null;
}

export async function fetchConditions(lat, lon, hasMarine) {
  const [metData, marineData, sstData] = await Promise.all([
    fetchMetNo(lat, lon),
    hasMarine ? fetchMarine(lat, lon) : Promise.resolve(null),
    fetchSST(lat, lon),
  ]);

  // Find closest timeseries entry to now
  const timeseries = metData.properties?.timeseries || [];
  const now = new Date();
  let bestIdx = 0;
  let bestDiff = Infinity;
  timeseries.forEach((entry, i) => {
    const diff = Math.abs(new Date(entry.time) - now);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  });

  const current = timeseries[bestIdx];
  const instant = current?.data?.instant?.details || {};

  const weather = {
    airTemp: instant.air_temperature ?? null,
    windSpeed: instant.wind_speed != null ? instant.wind_speed * 3.6 : null,
    windDirection: cardinalWind(instant.wind_from_direction),
    windDegrees: instant.wind_from_direction ?? null,
    rainProb: getRainProb(current),
    uvIndex: instant.ultraviolet_index_clear_sky ?? null,
  };

  // Trajectory: next 5 hours
  const trajectory = [];
  for (let i = bestIdx + 1; i <= Math.min(bestIdx + 5, timeseries.length - 1); i++) {
    const entry = timeseries[i];
    const det = entry?.data?.instant?.details || {};
    trajectory.push({
      time: new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      windSpeed: det.wind_speed != null ? Math.round(det.wind_speed * 3.6) : null,
      windDirection: cardinalWind(det.wind_from_direction),
      rainProb: getRainProb(entry),
    });
  }

  // Sea surface temperature
  let waterTemp = null;
  if (sstData) {
    const sstTimes = sstData.hourly?.time || [];
    const sstIdx = findCurrentHourIdx(sstTimes);
    waterTemp = sstData.hourly?.sea_surface_temperature?.[sstIdx] ?? null;
  }

  // Marine data
  let marine = null;
  if (marineData) {
    const mTimes = marineData.hourly?.time || [];
    const mIdx = findCurrentHourIdx(mTimes);
    const h = marineData.hourly;
    marine = {
      waveHeight: h?.wave_height?.[mIdx] ?? null,
      wavePeriod: h?.wave_period?.[mIdx] ?? null,
      waveDirection: cardinalWind(h?.wave_direction?.[mIdx]),
      swellHeight: h?.swell_wave_height?.[mIdx] ?? null,
      swellPeriod: h?.swell_wave_period?.[mIdx] ?? null,
      swellDirection: cardinalWind(h?.swell_wave_direction?.[mIdx]),
      windWaveHeight: h?.wind_wave_height?.[mIdx] ?? null,
    };

    for (let i = 0; i < trajectory.length; i++) {
      const j = mIdx + 1 + i;
      if (j < (h?.wave_height?.length || 0)) {
        trajectory[i].waveHeight = h?.wave_height?.[j] ?? null;
      }
    }
  }

  return { weather, marine, waterTemp, trajectory };
}
