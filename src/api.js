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

function buildForecastBlocks(timeseries, marineData, precipData, bestIdx, mIdx) {
  const pIdx = precipData?.hourly?.time ? findCurrentHourIdx(precipData.hourly.time) : 0;
  const blocks = [];
  for (let step = 0; step < 8; step++) {
    const tsIdx = bestIdx + step * 6;
    const entry = timeseries[tsIdx];
    if (!entry) break;
    const det = entry?.data?.instant?.details || {};

    // Take higher of met.no and Open-Meteo rain probability
    const metRain = getRainProb(entry);
    let omRain = null;
    if (precipData?.hourly?.precipitation_probability) {
      const j = pIdx + step * 6;
      if (j < precipData.hourly.precipitation_probability.length) {
        omRain = precipData.hourly.precipitation_probability[j] ?? null;
      }
    }
    const rainProb = metRain != null && omRain != null ? Math.max(metRain, omRain)
      : metRain != null ? metRain : omRain;

    const block = {
      isoTime: entry.time,
      windSpeed: det.wind_speed != null ? Math.round(det.wind_speed * 3.6) : null,
      windDirection: cardinalWind(det.wind_from_direction),
      rainProb,
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

// ── Recent rain history ───────────────────────────────────────────────────
// Sums MODELLED hourly rainfall (mm) from Open-Meteo for the past 24h / 72h /
// 7 days / 14 days. These are model estimates, not gauge readings, and a
// gridded model can under-read local extremes. Thresholds are STARTING POINTS
// taken from the May 2026 Knysna flood and have not been validated: tune them
// against days you know (e.g. 13 May 2026 vs a swimmable wet day).
export const RAIN_THRESHOLDS = {
  note:  { mm24: 15, mm72: 30 },
  amber: { mm24: 35, mm72: 70,  mm7d: 100, mm14d: 120 },
  red:   { mm24: 80, mm72: 150, mm7d: 200, mm14d: 250 },
};

function sumPast(arr, idx, hours) {
  let s = 0;
  for (let i = 1; i <= hours; i++) {
    const j = idx - i;
    if (j < 0) break;
    const v = arr[j];
    if (v != null) s += v;
  }
  return s;
}

export function rainLevel(r) {
  if (!r) return 'none';
  const t = RAIN_THRESHOLDS;
  if (r.mm24 >= t.red.mm24 || r.mm72 >= t.red.mm72 || r.mm7d >= t.red.mm7d || r.mm14d >= t.red.mm14d) return 'red';
  if (r.mm24 >= t.amber.mm24 || r.mm72 >= t.amber.mm72 || r.mm7d >= t.amber.mm7d || r.mm14d >= t.amber.mm14d) return 'amber';
  if (r.mm24 >= t.note.mm24 || r.mm72 >= t.note.mm72) return 'note';
  return 'none';
}

export function computeRainHistory(precipData, currentPIdx) {
  const mm = precipData?.hourly?.precipitation;
  if (!Array.isArray(mm)) return null; // no data: show nothing rather than guess
  const round1 = n => Math.round(n * 10) / 10;
  const r = {
    mm24:  round1(sumPast(mm, currentPIdx, 24)),
    mm72:  round1(sumPast(mm, currentPIdx, 72)),
    mm7d:  round1(sumPast(mm, currentPIdx, 24 * 7)),
    mm14d: round1(sumPast(mm, currentPIdx, 24 * 14)),
  };
  r.level = rainLevel(r);
  return r;
}

export async function fetchConditions(lat, lon, hasMarine) {
  const res = await fetch('https://glassy-lake.vercel.app/api/conditions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lon, hasMarine })
  });
  const { metData, marineData, sstData, precipData } = await res.json();

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
  if (hasMarine && sstData) {
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

  // Blend rain: take higher of met.no and Open-Meteo precipitation probability
  if (precipData?.hourly?.precipitation_probability) {
    const pTimes = precipData.hourly.time || [];
    const pIdx = findCurrentHourIdx(pTimes);
    const omRain = precipData.hourly.precipitation_probability[pIdx] ?? null;
    if (omRain != null) {
      weather.rainProb = weather.rainProb != null ? Math.max(weather.rainProb, omRain) : omRain;
    }
  }

  // Recent rainfall history (mm) over 24h / 72h / 7d / 14d
  const pIdxForHistory = precipData?.hourly?.time ? findCurrentHourIdx(precipData.hourly.time) : 0;
  const sustainedRain = computeRainHistory(precipData, pIdxForHistory);

  const forecast = buildForecastBlocks(timeseries, marineData, precipData, bestIdx, mIdx);
  return { weather, marine, waterTemp, trajectory, forecast, sustainedRain };
}
