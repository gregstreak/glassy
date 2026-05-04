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

// Find the most recent moon upper transit (highest altitude) by scanning
// backwards up to one full lunar day (24h 50m)
function findLastTransit(date, lat, lon) {
  const LUNAR_DAY_MS = 24 * 60 * 60 * 1000 + 50 * 60 * 1000;
  const STEP_MS = 10 * 60 * 1000; // 10-minute steps
  const now = date.getTime();

  let maxAlt = -Infinity;
  let transitTime = now;

  // Search from now back one full lunar day, plus forward 6h to catch imminent transit
  for (let offset = -LUNAR_DAY_MS; offset <= 6 * 3600 * 1000; offset += STEP_MS) {
    const t = now + offset;
    const pos = SunCalc.getMoonPosition(new Date(t), lat, lon);
    if (pos.altitude > maxAlt) {
      maxAlt = pos.altitude;
      transitTime = t;
    }
  }

  // Refine with 1-minute steps around the found peak
  const roughPeak = transitTime;
  maxAlt = -Infinity;
  for (let offset = -15 * 60 * 1000; offset <= 15 * 60 * 1000; offset += 60 * 1000) {
    const t = roughPeak + offset;
    const pos = SunCalc.getMoonPosition(new Date(t), lat, lon);
    if (pos.altitude > maxAlt) {
      maxAlt = pos.altitude;
      transitTime = t;
    }
  }

  return transitTime;
}

export function getTidalState(date = new Date(), spot = null) {
  if (!spot?.isTidal) return null;

  const SEMIDIURNAL_PERIOD_MS = 12 * 60 * 60 * 1000 + 25 * 60 * 1000;

  // High water lunitidal intervals for known spots
  // These represent how many ms after upper moon transit that HW occurs
  const HW_OFFSET_MS = {
    'knysna-heads':   5 * 3600000 + 10 * 60000,
    'knysna-lagoon':  5 * 3600000 + 25 * 60000,
    'default':        6 * 3600000,
  };

  const offset = HW_OFFSET_MS[spot.id] || HW_OFFSET_MS['default'];
  const transitTime = findLastTransit(date, spot.lat, spot.lon);

  // Most recent high water time — find the HW just before now
  let hwTime = transitTime + offset;
  const now = date.getTime();

  // Step HW forward by semidiurnal periods until hwTime is the most recent past HW
  while (hwTime > now) hwTime -= SEMIDIURNAL_PERIOD_MS;
  while (hwTime + SEMIDIURNAL_PERIOD_MS < now) hwTime += SEMIDIURNAL_PERIOD_MS;

  // Time since last high water
  const timeSinceHW = now - hwTime;
  const fractionOfCycle = timeSinceHW / SEMIDIURNAL_PERIOD_MS;
  const tidalAngle = fractionOfCycle * 2 * Math.PI;

  // cos = 1 at HW, -1 at LW
  const tidalHeight = Math.cos(tidalAngle);
  // rate: positive = rising, negative = falling
  const tidalRate = -Math.sin(tidalAngle);

  // Time to next turn
  let hoursToTurn;
  if (tidalRate >= 0) {
    // Rising — time to next HW (angle = 2π)
    const remaining = (2 * Math.PI - tidalAngle) / (2 * Math.PI) * SEMIDIURNAL_PERIOD_MS;
    hoursToTurn = remaining / 3600000;
  } else {
    // Falling — time to next LW (angle = π)
    const remaining = (Math.PI - tidalAngle) / (2 * Math.PI) * SEMIDIURNAL_PERIOD_MS;
    hoursToTurn = remaining / 3600000;
  }

  const isSlack = Math.abs(tidalRate) < 0.2;
  const direction = tidalRate >= 0 ? 'incoming' : 'outgoing';
  const heightLabel = tidalHeight > 0.65 ? 'high' : tidalHeight < -0.65 ? 'low' : tidalHeight > 0 ? 'mid-high' : 'mid-low';
  const range = getTidalRange(date);

  return {
    direction,
    heightLabel,
    isSlack,
    hoursToTurn: Math.max(0, Math.round(hoursToTurn * 10) / 10),
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
    return `Near slack water — tide turning in under ${mins} minutes. ${rangeLabel}.`;
  }

  const h = Math.round(hoursToTurn * 10) / 10;
  const dirLabel = spot.id.includes('lagoon')
    ? direction === 'incoming' ? 'flowing into the lagoon' : 'flowing toward the Heads'
    : direction === 'incoming' ? 'incoming' : 'outgoing';

  return `${rangeLabel}. Tide ${dirLabel}, turning in approximately ${h}h.`;
}
