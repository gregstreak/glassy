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

// Tidal calculation anchored to a known verified HW epoch for each spot.
// We use a real observed HW time and step forward/backward by the mean
// semidiurnal period to find the HW nearest to the query time.
//
// Known HW epoch (verified against SA tide tables / Tides app):
// Knysna: HW at 2026-05-04 05:11 SAST = 2026-05-04T03:11:00Z
//
// Mean semidiurnal period for Knysna: 12h 25m 14s (745.23 min)
// This is the mean M2 tidal period.

const SEMIDIURNAL_MS = 12 * 3600000 + 25 * 60000 + 14000; // 12h 25m 14s

// Epoch HW times in UTC milliseconds (verified observed high waters)
const HW_EPOCHS = {
  'knysna-heads':  Date.UTC(2026, 4, 4, 3, 11, 0),  // 2026-05-04 05:11 SAST = 03:11 UTC
  'knysna-lagoon': Date.UTC(2026, 4, 4, 3, 25, 0),  // ~15 min lag into lagoon
  'hermanus':      Date.UTC(2026, 4, 4, 2, 30, 0),  // approximate
  'gordons-bay':   Date.UTC(2026, 4, 4, 4, 0, 0),   // approximate
  'fish-hoek':     Date.UTC(2026, 4, 4, 3, 45, 0),  // approximate
};

function findNearestHW(epochMs, nowMs) {
  // Step from epoch to find the HW closest to, but before, now
  let hw = epochMs;
  // Step forward to catch up to now
  while (hw + SEMIDIURNAL_MS <= nowMs) hw += SEMIDIURNAL_MS;
  // Step back to ensure hw is the last HW before now
  while (hw > nowMs) hw -= SEMIDIURNAL_MS;
  return hw;
}

export function getTidalState(date = new Date(), spot = null) {
  if (!spot?.isTidal) return null;

  const epoch = HW_EPOCHS[spot.id];
  if (!epoch) return null;

  const nowMs = date.getTime();
  const lastHW = findNearestHW(epoch, nowMs);
  const timeSinceHW = nowMs - lastHW;
  const fractionOfCycle = timeSinceHW / SEMIDIURNAL_MS;
  const tidalAngle = fractionOfCycle * 2 * Math.PI;

  // cos: 1 = HW, -1 = LW
  const tidalHeight = Math.cos(tidalAngle);
  // -sin: positive = rising (incoming), negative = falling (outgoing)
  const tidalRate = -Math.sin(tidalAngle);

  let hoursToTurn;
  if (tidalRate >= 0) {
    // Rising — time to next HW
    const remaining = (2 * Math.PI - tidalAngle) / (2 * Math.PI) * SEMIDIURNAL_MS;
    hoursToTurn = remaining / 3600000;
  } else {
    // Falling — time to next LW
    const remaining = (Math.PI - tidalAngle) / (2 * Math.PI) * SEMIDIURNAL_MS;
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
