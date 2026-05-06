function findCurrentHourIdx(times) {
  const prefix = new Date().toISOString().slice(0, 13);
  const idx = times.findIndex(t => t && t.startsWith(prefix));
  return idx >= 0 ? idx : 0;
}

function cardinalWind(degrees) {
  if (degrees == null) return '—';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(degrees / 22.5) % 16];
}

function getRainProb(entry) {
  if (!entry?.data) return null;
  const n1 = entry.data.next_1_hours?.details?.probability_of_precipitation;
  if (n1 != null) return Math.round(n1);
  const precip = entry.data.next_1_hours?.details?.precipitation_amount;
  if (precip != null) return precip > 0 ? Math.min(100, Math.round(precip * 40)) : 0;
  return null;
}

// Build 8 × 6-hour forecast blocks from the raw API arrays.
// Steps beyond the array length are silently omitted — if conditions.js
// calls Open-Meteo with forecast_days=1, you'll get ~4 blocks instead of 8.
// Fix: ensure forecast_days=3 (or higher) in api/conditions.js.
function buildForecastBlocks(timeseries, marineData, bestIdx, mIdx) {
  const blocks = [];
  for (let step = 0; step < 8; step++) {
    const tsIdx = bestIdx + step * 6;
    const entry = timeseries[tsIdx];
    if (!entry) break;
    const det = entry?.data?.instant?.details || {};
    const block = {
      isoTime: entry.time,
      windSpeed: det.wind_speed != null ? Math.round(det.wind_speed * 3.6) : null,
      windDirection: cardinalWind(det.wind_from_direction),
      rainProb: getRainProb(entry),
      waveHeight: null,
      swellHeight: null,
      swellPeriod: null,
      swellDirection: null,
    };
    if (marineData) {
      const h = marineData.hourly;
      const j = mIdx + step * 6;
      if (h?.swell_wave_height && j < h.swell_wave_height.length) {
        block.waveHeight    = h.wave_height?.[j]       ?? null;
        block.swellHeight   = h.swell_wave_height?.[j] ?? null;
        block.swellPeriod   = h.swell_wave_period?.[j] ?? null;
        block.swellDirection = cardinalWind(h.swell_wave_direction?.[j]);
      }
    }
    blocks.push(block);
  }
  return blocks;
}

export async function fetchConditions(lat, lon, hasMarine) {
  const res = await fetch('https://glassy-lake.vercel.app/api/conditions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lon, hasMarine })
  });
  const { metData, marineData, sstData } = await res.json();

  const timeseries = metData.properties?.timeseries || [];
  const now = new Date();
  let bestIdx = 0, bestDiff = Infinity;
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
    rainProb: getRainProb(current),
    uvIndex: instant.ultraviolet_index_clear_sky ?? null,
  };

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

  let waterTemp = null;
  if (sstData) {
    const sstTimes = sstData.hourly?.time || [];
    const sstIdx = findCurrentHourIdx(sstTimes);
    waterTemp = sstData.hourly?.sea_surface_temperature?.[sstIdx] ?? null;
  }

  // mIdx hoisted so buildForecastBlocks can use it
  let marine = null;
  let mIdx = 0;
  if (marineData) {
    const mTimes = marineData.hourly?.time || [];
    mIdx = findCurrentHourIdx(mTimes);
    const h = marineData.hourly;
    marine = {
      waveHeight:    h?.wave_height?.[mIdx]       ?? null,
      wavePeriod:    h?.wave_period?.[mIdx]        ?? null,
      waveDirection: cardinalWind(h?.wave_direction?.[mIdx]),
      swellHeight:   h?.swell_wave_height?.[mIdx]  ?? null,
      swellPeriod:   h?.swell_wave_period?.[mIdx]  ?? null,
      swellDirection: cardinalWind(h?.swell_wave_direction?.[mIdx]),
      windWaveHeight: h?.wind_wave_height?.[mIdx]  ?? null,
    };
    for (let i = 0; i < trajectory.length; i++) {
      const j = mIdx + 1 + i;
      if (j < (h?.wave_height?.length || 0)) trajectory[i].waveHeight = h?.wave_height?.[j] ?? null;
    }
  }

  const forecast = buildForecastBlocks(timeseries, marineData, bestIdx, mIdx);
  return { weather, marine, waterTemp, trajectory, forecast };
}
