import SunCalc from 'suncalc';

export function getMoonPhase(date = new Date()) {
  const { phase } = SunCalc.getMoonIllumination(date);
  return phase;
}

export function getTidalRange(date = new Date()) {
  const phase = getMoonPhase(date);
  const distFromNew = Math.min(phase, 1 - phase);
  const distFromFull = Math.abs(phase - 0.5);
  const distFromSpring = Math.min(distFromNew, distFromFull);
  if (distFromSpring < 0.085) return 'spring';
  if (distFromSpring > 0.165) return 'neap';
  return 'moderate';
}

// Find the most recent moon upper transit by scanning one full lunar day back
// plus 6h forward, then refining to 1-minute precision
function findLastTransit(date, lat, lon) {
  const LUNAR_DAY_MS = 24 * 60 * 60 * 1000 + 50 * 60 * 1000;
  const STEP_MS = 10 * 60 * 1000;
  const now = date.getTime();

  // Coarse scan: full lunar day back + 6h forward
  let maxAlt = -Infinity;
  let peakTime = now;
  for (let offset = -LUNAR_DAY_MS; offset <= 6 * 3600000; offset += STEP_MS) {
    const pos = SunCalc.getMoonPosition(new Date(now + offset), lat, lon);
    if (pos.altitude > maxAlt) {
      maxAlt = pos.altitude;
      peakTime = now + offset;
    }
  }

  // Fine scan: ±15 min around peak, 1-minute steps
  maxAlt = -Infinity;
  let transitTime = peakTime;
  for (let offset = -15 * 60000; offset <= 15 * 60000; offset += 60000) {
    const pos = SunCalc.getMoonPosition(new Date(peakTime + offset), lat, lon);
    if (pos.altitude > maxAlt) {
      maxAlt = pos.altitude;
      transitTime = peakTime + offset;
    }
  }

  return transitTime;
}

export function getTidalState(date = new Date(), spot = null) {
  if (!spot?.isTidal) return null;

  const SEMIDIURNAL_PERIOD_MS = 12 * 60 * 60 * 1000 + 25 * 60 * 1000; // 12h 25m

  // Mean High Water Lunitidal Interval (MHWI) for each spot
  // = time from moon's upper transit to next high water
  // Calibrated from SA Navy tide tables and observed data:
  // Knysna: HW at 05:11 & 17:36 on 4 May 2026, moon transit ~03:10 SAST → MHWI ≈ 2h 00m
  const HW_OFFSET_MS = {
    'knysna-heads':  2 * 3600000,                    // 2h 00m
    'knysna-lagoon': 2 * 3600000 + 15 * 60000,       // 2h 15m (tidal lag into estuary)
    'hermanus':      1 * 3600000 + 30 * 60000,        // 1h 30m
    'gordons-bay':   2 * 3600000 + 45 * 60000,        // 2h 45m
    'fish-hoek':     2 * 3600000 + 30 * 60000,        // 2h 30m
    'default':       3 * 3600000,                     // 3h fallback
  };

  const hwOffset = HW_OFFSET_MS[spot.id] || HW_OFFSET_MS['default'];
  const transitTime = findLastTransit(date, spot.lat, spot.lon);
  const now = date.getTime();

  // First candidate HW = transit + offset
  let hwTime = transitTime + hwOffset;

  // Step to find the most recent HW before now
  while (hwTime > now) hwTime -= SEMIDIURNAL_PERIOD_MS;
  while (hwTime + SEMIDIURNAL_PERIOD_MS <= now) hwTime += SEMIDIURNAL_PERIOD_MS;
  // hwTime is now the last HW before 'now'

  const timeSinceHW = now - hwTime;
  const fractionOfCycle = timeSinceHW / SEMIDIURNAL_PERIOD_MS;
  const tidalAngle = fractionOfCycle * 2 * Math.PI;

  // cos(tidalAngle): 1 = HW, -1 = LW
  const tidalHeight = Math.cos(tidalAngle);
  // -sin: positive = rising (incoming), negative = falling (outgoing)
  const tidalRate = -Math.sin(tidalAngle);

  // Time remaining to next turn
  let hoursToTurn;
  if (tidalRate >= 0) {
    // Rising — time to next HW
    const remaining = (2 * Math.PI - tidalAngle) / (2 * Math.PI) * SEMIDIURNAL_PERIOD_MS;
    hoursToTurn = remaining / 3600000;
  } else {
    // Falling — time to next LW
    const remaining = (Math.PI - tidalAngle) / (2 * Math.PI) * SEMIDIURNAL_PERIOD_MS;
    hoursToTurn = remaining / 3600000;
  }

  const isSlack = Math.abs(tidalRate) < 0.2;
  const direction = tidalRate >= 0 ? 'incoming' : 'outgoing';
  const range = getTidalRange(date);

  return {
    direction,
    isSlack,
    hoursToTurn: Math.max(0.1, Math.round(hoursToTurn * 10) / 10),
    range,
    moonPhase: getMoonPhase(date),
    note: buildTidalNote(spot, direction, isSlack, range, hoursToTurn),
  };
}

function buildTidalNote(spot, direction, isSlack, range, hoursToTurn) {
  if (!spot) return null;

  const rangeLabel = {
    spring: 'Spring tide — stronger than usual current',
    neap: 'Neap tide — gentler current',
    moderate: 'Moderate tidal range',
  }[range];

  if (isSlack) {
    const mins = Math.ceil(hoursToTurn * 60);
    return `Near slack water — tide turning in under ${mins} min. ${rangeLabel}.`;
  }

  const h = Math.round(hoursToTurn * 10) / 10;

  const dirLabel = spot.id.includes('lagoon')
    ? direction === 'incoming' ? 'flowing into the lagoon' : 'flowing toward the Heads'
    : direction === 'incoming' ? 'incoming' : 'outgoing';

  return `${rangeLabel}. Tide ${dirLabel}, turning in ~${h}h.`;
}
