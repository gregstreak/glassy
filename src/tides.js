import SunCalc from 'suncalc';

// Moon phase: 0 = new moon, 0.25 = first quarter, 0.5 = full moon, 0.75 = last quarter
export function getMoonPhase(date = new Date()) {
  const { phase } = SunCalc.getMoonIllumination(date);
  return phase;
}

// Classify spring vs neap based on moon phase
// Springs: within ~2.5 days of new or full moon
// At a 29.5 day cycle, 2.5 days ≈ 0.085 in phase units
export function getTidalRange(date = new Date()) {
  const phase = getMoonPhase(date);
  const distFromNew = Math.min(phase, 1 - phase);         // distance from new moon (0 or 1)
  const distFromFull = Math.abs(phase - 0.5);             // distance from full moon (0.5)
  const distFromSpring = Math.min(distFromNew, distFromFull);

  if (distFromSpring < 0.085) return 'spring';            // within ~2.5 days of spring
  if (distFromSpring > 0.165) return 'neap';              // near quarter moon
  return 'moderate';
}

// Estimate tidal state for semidiurnal locations
// We use a simple harmonic model:
// - Semidiurnal period: 12h 25min = 745 min
// - We need a reference high tide time for the location
// - For Knysna: mean high water interval ≈ 5h after the moon's meridian transit
//   This gives approximate HW times for the location
//
// Returns: { state, direction, hoursToTurn, isSlack }
export function getTidalState(date = new Date(), spot = null) {
  if (!spot?.isTidal) return null;

  const SEMIDIURNAL_PERIOD_MS = 12 * 60 * 60 * 1000 + 25 * 60 * 1000; // 12h 25m

  // Get moon position to estimate high tide timing
  const moonTimes = SunCalc.getMoonTimes(date, spot.lat, spot.lon);
  const moonPos = SunCalc.getMoonPosition(date, spot.lat, spot.lon);

  // Approximate: high tide occurs roughly when moon is overhead (transit)
  // and again ~12h 25m later. We use a simplified harmonic:
  // tide height ∝ cos(2π * t / T) where t = time since last HW
  //
  // For Knysna specifically, the port has an approximate HW lunitidal interval
  // of ~5h 10m (310 min) after the upper transit of the moon.
  // We use this as a location-specific offset.
  const HW_OFFSET_MS = {
    'knysna-heads': 5 * 60 * 60 * 1000 + 10 * 60 * 1000,   // 5h 10m
    'knysna-lagoon': 5 * 60 * 60 * 1000 + 25 * 60 * 1000,  // 5h 25m (slight lag into estuary)
    'default': 6 * 60 * 60 * 1000,                           // 6h default
  };

  const offset = HW_OFFSET_MS[spot.id] || HW_OFFSET_MS['default'];

  // Find approximate time of last moon upper transit
  // Moon transits approximately every 24h 50m
  const LUNAR_DAY_MS = 24 * 60 * 60 * 1000 + 50 * 60 * 1000;
  const now = date.getTime();

  // Use moon altitude to approximate transit timing
  // When altitude is near maximum, moon is near transit
  // We sample ±6h to find the peak
  let maxAlt = -Infinity;
  let transitTime = now;
  for (let offset_t = -6 * 3600000; offset_t <= 6 * 3600000; offset_t += 600000) {
    const pos = SunCalc.getMoonPosition(new Date(now + offset_t), spot.lat, spot.lon);
    if (pos.altitude > maxAlt) {
      maxAlt = pos.altitude;
      transitTime = now + offset_t;
    }
  }

  // Estimated high tide time = transit + HW offset
  const hwTime = transitTime + offset;

  // Time since last high tide (mod semidiurnal period)
  let timeSinceHW = (now - hwTime) % SEMIDIURNAL_PERIOD_MS;
  if (timeSinceHW < 0) timeSinceHW += SEMIDIURNAL_PERIOD_MS;

  const fractionOfCycle = timeSinceHW / SEMIDIURNAL_PERIOD_MS;
  const tidalAngle = fractionOfCycle * 2 * Math.PI;

  // cos(tidalAngle): 1 = high water, -1 = low water
  const tidalHeight = Math.cos(tidalAngle); // normalised -1 to 1
  // Rate of change: positive = rising, negative = falling
  const tidalRate = -Math.sin(tidalAngle);

  // Hours until next turn
  let hoursToTurn;
  if (tidalRate > 0) {
    // Rising — time to next HW
    const angleToHW = (2 * Math.PI - tidalAngle) % (2 * Math.PI);
    hoursToTurn = (angleToHW / (2 * Math.PI)) * (SEMIDIURNAL_PERIOD_MS / 3600000);
  } else {
    // Falling — time to next LW
    const angleToLW = (Math.PI - tidalAngle + 2 * Math.PI) % (2 * Math.PI);
    hoursToTurn = (angleToLW / (2 * Math.PI)) * (SEMIDIURNAL_PERIOD_MS / 3600000);
  }

  // Slack water: within ~30 min of a turn (|sin| < 0.25)
  const isSlack = Math.abs(tidalRate) < 0.25;
  const direction = tidalRate > 0 ? 'incoming' : 'outgoing';
  const heightLabel = tidalHeight > 0.7 ? 'high' : tidalHeight < -0.7 ? 'low' : tidalHeight > 0 ? 'mid-high' : 'mid-low';

  return {
    direction,
    heightLabel,
    isSlack,
    hoursToTurn: Math.round(hoursToTurn * 10) / 10,
    range: getTidalRange(date),
    moonPhase: getMoonPhase(date),
    note: buildTidalNote(spot, direction, isSlack, getTidalRange(date), hoursToTurn),
  };
}

function buildTidalNote(spot, direction, isSlack, range, hoursToTurn) {
  if (!spot) return null;
  const h = Math.round(hoursToTurn * 10) / 10;
  const rangeLabel = range === 'spring' ? 'spring tide — stronger than usual current' : range === 'neap' ? 'neap tide — gentler current' : 'moderate tidal range';

  if (isSlack) {
    return `Near slack water — tide turning in under ${Math.ceil(hoursToTurn * 60)} minutes. ${rangeLabel}.`;
  }

  const dirLabel = direction === 'incoming'
    ? spot.id.includes('lagoon') ? 'flowing into the lagoon' : 'incoming'
    : spot.id.includes('lagoon') ? 'flowing toward the Heads' : 'outgoing';

  return `${rangeLabel.charAt(0).toUpperCase() + rangeLabel.slice(1)}. Tide ${dirLabel}, turning in approximately ${h}h.`;
}
