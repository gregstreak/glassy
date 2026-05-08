import { useState } from 'react';
import { matchSpot, quickSpots } from './spots';
import { fetchConditions } from './api';

// ── Colours ───────────────────────────────────────────────────────────────
const NAVY = '#1B2535', AMBER = '#E09040', SURFACE = '#232E42';
const MUTED = '#4A5A72', TEXT = '#F4F6F9', SUBTEXT = '#A8B8CC', GREEN = '#4A9A7A';
const RED = '#C0392B';

// ── Tidal calculation — epoch-anchored ────────────────────────────────────
const _SEMI = 12 * 3600000 + 25 * 60000 + 14000;
const _EPOCHS = {
  'knysna-heads':   Date.UTC(2026, 4, 4, 3, 11, 0),
  'knysna-lagoon':  Date.UTC(2026, 4, 4, 3, 25, 0),
  'hermanus':       Date.UTC(2026, 4, 4, 2, 30, 0),
  'gordons-bay':    Date.UTC(2026, 4, 4, 4,  0, 0),
  'fish-hoek':      Date.UTC(2026, 4, 4, 3, 45, 0),
  'keurbooms-river': Date.UTC(2026, 4, 8, 4, 55, 0),
  'kenton-river':   Date.UTC(2026, 4, 8, 4, 49, 0),
};

function getTidalState(date, spot) {
  if (!spot?.isTidal) return null;
  const epoch = _EPOCHS[spot.id];
  if (!epoch) return null;
  const now = date.getTime();
  let hw = epoch;
  while (hw + _SEMI <= now) hw += _SEMI;
  while (hw > now) hw -= _SEMI;
  const angle = ((now - hw) / _SEMI) * 2 * Math.PI;
  const rate = -Math.sin(angle);
  const direction = rate >= 0 ? 'incoming' : 'outgoing';
  let h2t = rate >= 0
    ? ((2 * Math.PI - angle) / (2 * Math.PI)) * _SEMI / 3600000
    : ((Math.PI - angle) / (2 * Math.PI)) * _SEMI / 3600000;
  h2t = Math.max(0.1, Math.round(h2t * 10) / 10);
  const isSlack = h2t <= 0.75; // within 45 minutes of the next turn
  const LUNAR = 29.53 * 24 * 3600000;
  const phase = ((now - Date.UTC(2000, 0, 6, 18, 14, 0)) % LUNAR) / LUNAR;
  const ds = Math.min(Math.min(phase, 1 - phase), Math.abs(phase - 0.5));
  const range = ds < 0.085 ? 'spring' : ds > 0.165 ? 'neap' : 'moderate';
  const rl = { spring: 'Spring tide — stronger current', neap: 'Neap tide — gentler current', moderate: 'Moderate tidal range' }[range];
  const lag = spot.id.includes('lagoon');
  const dl = lag ? (direction === 'incoming' ? 'flowing into the lagoon' : 'flowing toward the Heads') : direction;
  const note = isSlack
    ? `Near slack water — tide turning in under ${Math.ceil(h2t * 60)} min. ${rl}.`
    : `${rl}. Tide ${dl}, turning in ~${h2t}h.`;
  return { direction, isSlack, hoursToTurn: h2t, range, note };
}

// Returns all HW/LW turns within `hours` of fromDate, for tidal spots.
function getTidalTurns(spot, fromDate, hours = 48) {
  if (!spot?.isTidal) return [];
  const epoch = _EPOCHS[spot.id];
  if (!epoch) return [];
  const start = fromDate.getTime();
  const end = start + hours * 3600000;
  // Walk back to the last HW at or before start
  let hw = epoch;
  while (hw + _SEMI <= start) hw += _SEMI;
  while (hw > start) hw -= _SEMI;
  const turns = [];
  let t = hw;
  while (t < end + _SEMI) {
    if (t > start && t < end) turns.push({ time: new Date(t), type: 'high' });
    const lw = t + _SEMI / 2;
    if (lw > start && lw < end) turns.push({ time: new Date(lw), type: 'low' });
    t += _SEMI;
  }
  return turns.sort((a, b) => a.time - b.time);
}

// ── Helpers ───────────────────────────────────────────────────────────────
const f1 = v => v != null ? Number(v).toFixed(1) : '—';
const f0 = v => v != null ? String(Math.round(v)) : '—';
const stripMd = t => (t || '')
  .replace(/^#+\s+.*$/gm, '')
  .replace(/\*\*(.+?)\*\*/g, '$1')
  .replace(/\*(.+?)\*/g, '$1')
  .replace(/^[-*]\s+/gm, '')
  .trim();

function blockLabel(isoTime) {
  const d = new Date(isoTime);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const h = d.getHours();
  const t = h === 0 ? 'midnight' : h === 12 ? 'noon' : h < 12 ? `${h}am` : `${h - 12}pm`;
  return `${day} ${t}`;
}

// Colour-code conditions by spot exposure.
// Returns 'green' | 'amber' | 'red'.
function conditionColor(windSpeed, swellHeight, exposure) {
  const [wLo, wHi] = exposure === 'open ocean' ? [20, 35]
    : exposure === 'sheltered' ? [35, 55]
    : [25, 45]; // semi-exposed
  const [sLo, sHi] = exposure === 'open ocean' ? [1.0, 2.0]
    : exposure === 'sheltered' ? [3.0, 5.0]
    : [1.5, 2.5];
  const wc = windSpeed == null ? 'green' : windSpeed > wHi ? 'red' : windSpeed > wLo ? 'amber' : 'green';
  const sc = swellHeight == null ? 'green' : swellHeight > sHi ? 'red' : swellHeight > sLo ? 'amber' : 'green';
  if (wc === 'red' || sc === 'red') return 'red';
  if (wc === 'amber' || sc === 'amber') return 'amber';
  return 'green';
}

// ── Sub-components ────────────────────────────────────────────────────────
const Arc = ({ width = 200 }) => (
  <svg width={width} height="16" viewBox={`0 0 ${width} 16`} style={{ display: 'block', margin: '10px auto 0' }}>
    <path d={`M 6 14 Q ${width / 2} 2 ${width - 6} 14`} stroke={AMBER} strokeWidth="2.5" fill="none" strokeLinecap="round" />
  </svg>
);

const Dots = () => (
  <>
    <style>{`@keyframes gb{0%,100%{opacity:.15}50%{opacity:1}}`}</style>
    {[0, 1, 2].map(n => (
      <span key={n} style={{ display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: AMBER, margin: '0 2px', animation: `gb 1.2s ease-in-out ${n * 0.2}s infinite` }} />
    ))}
  </>
);

const Cell = ({ label, value, unit, highlight }) => (
  <div style={{ background: SURFACE, borderRadius: 7, padding: '9px 11px', border: highlight ? `1px solid ${AMBER}55` : '1px solid transparent' }}>
    <div style={{ fontSize: 9, letterSpacing: '0.14em', color: MUTED, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
    <div style={{ fontSize: 17, fontFamily: 'monospace', color: highlight ? AMBER : TEXT, lineHeight: 1 }}>
      {value ?? '—'}{unit && <span style={{ fontSize: 10, color: MUTED, marginLeft: 1 }}>{unit}</span>}
    </div>
  </div>
);

const SwimLoadingCell = () => (
  <a href="https://www.swimloading.com/" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
    <div style={{ background: SURFACE, borderRadius: 7, padding: '9px 11px', border: `1px solid #0284c722`, cursor: 'pointer' }}>
      <div style={{ fontSize: 9, letterSpacing: '0.14em', color: MUTED, textTransform: 'uppercase', marginBottom: 3 }}>Water Temp</div>
      <div style={{ fontSize: 12, color: '#0284c7', lineHeight: 1.3 }}>
        Check SwimLoading <span style={{ fontSize: 10 }}>↗</span>
      </div>
    </div>
  </a>
);

const WindWarning = ({ windSpeed, windDirection }) => {
  if (!windSpeed || windSpeed < 40) return null;
  const level = windSpeed >= 60 ? 'severe' : 'strong';
  const color = windSpeed >= 60 ? RED : AMBER;
  const bg = windSpeed >= 60 ? '#2A1515' : '#2A1E10';
  return (
    <div style={{ background: bg, border: `1px solid ${color}55`, borderRadius: 7, padding: '8px 11px', marginBottom: '0.75rem', borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 9, letterSpacing: '0.14em', color, textTransform: 'uppercase', marginBottom: 3 }}>
        {level === 'severe' ? '⚠ Severe Wind Warning' : '⚠ Strong Wind'}
      </div>
      <div style={{ fontSize: 13, color: SUBTEXT, lineHeight: 1.5 }}>
        {windSpeed >= 60
          ? `${Math.round(windSpeed)} km/h from ${windDirection} — conditions may be extreme. Forecast data alone is insufficient. Get eyes on the water.`
          : `${Math.round(windSpeed)} km/h from ${windDirection} — conditions will be rougher than calm-day estimates suggest.`}
      </div>
    </div>
  );
};

const RainWarning = ({ rainProb }) => {
  if (rainProb == null || rainProb < 80) return null;
  const severe = rainProb >= 95;
  const color = severe ? RED : AMBER;
  const bg = severe ? '#2A1515' : '#2A1E10';
  return (
    <div style={{ background: bg, border: `1px solid ${color}55`, borderRadius: 7, padding: '8px 11px', marginBottom: '0.75rem', borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 9, letterSpacing: '0.14em', color, textTransform: 'uppercase', marginBottom: 3 }}>
        {severe ? '⚠ Extreme Rain' : '⚠ Heavy Rain Likely'}
      </div>
      <div style={{ fontSize: 13, color: SUBTEXT, lineHeight: 1.5 }}>
        {severe
          ? `${rainProb}% rain probability — flooding and poor water quality likely. Conditions on the ground may differ significantly from forecast data.`
          : `${rainProb}% rain probability — consider river levels, water turbidity and visibility before entering.`}
      </div>
    </div>
  );
};

const TidalBadge = ({ tidal, spot }) => {
  if (!tidal && spot?.tidalType !== 'intermittent') return null;
  const col = tidal ? (tidal.range === 'spring' ? AMBER : tidal.range === 'neap' ? GREEN : SUBTEXT) : MUTED;
  const isIntermittent = spot?.tidalType === 'intermittent';
  return (
    <div style={{ background: SURFACE, borderRadius: 7, padding: '8px 11px', marginBottom: '0.75rem', borderLeft: `3px solid ${col}` }}>
      {tidal && (
        <>
          <div style={{ fontSize: 9, letterSpacing: '0.14em', color: MUTED, textTransform: 'uppercase', marginBottom: 3 }}>Tidal State · {tidal.range}</div>
          <div style={{ fontSize: 13, color: SUBTEXT, lineHeight: 1.5 }}>{tidal.note}</div>
        </>
      )}
      {isIntermittent && (
        <div style={{ fontSize: 11, color: MUTED, marginTop: tidal ? 5 : 0, fontStyle: 'italic', lineHeight: 1.5 }}>
          This lagoon or river mouth opens and closes seasonally. If currently closed to the sea, disregard tidal current — conditions will be wind-driven only.
        </div>
      )}
    </div>
  );
};

// ── Forecast components ───────────────────────────────────────────────────
const ForecastBlock = ({ block, exposure }) => {
  const color = conditionColor(block.windSpeed, block.swellHeight, exposure);
  const borderColor = color === 'red' ? RED : color === 'amber' ? AMBER : GREEN;
  return (
    <div style={{
      background: SURFACE, borderRadius: 6, padding: '8px 9px',
      minWidth: 66, textAlign: 'center', flexShrink: 0,
      borderTop: `3px solid ${borderColor}`,
    }}>
      <div style={{ fontSize: 9, color: SUBTEXT, marginBottom: 4, whiteSpace: 'nowrap' }}>{blockLabel(block.isoTime)}</div>
      <div style={{ fontSize: 12, fontFamily: 'monospace', color: TEXT, lineHeight: 1 }}>
        {block.windSpeed != null ? block.windSpeed : '—'}<span style={{ fontSize: 9, color: MUTED }}>k</span>
      </div>
      <div style={{ fontSize: 9, color: MUTED, marginBottom: 2 }}>{block.windDirection}</div>
      {block.swellHeight != null && (
        <div style={{ fontSize: 12, fontFamily: 'monospace', color: SUBTEXT }}>
          {f1(block.swellHeight)}<span style={{ fontSize: 9, color: MUTED }}>m</span>
        </div>
      )}
      {block.rainProb != null && block.rainProb > 20 && (
        <div style={{ fontSize: 10, color: AMBER, marginTop: 2 }}>
          {block.rainProb}<span style={{ fontSize: 8 }}>%</span>
        </div>
      )}
    </div>
  );
};

const ForecastTimeline = ({ forecast, spot }) => {
  if (!forecast?.length) return null;
  const exposure = spot?.exposure || 'semi-exposed';
  return (
    <div>
      <div style={{ fontSize: 9, color: MUTED, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>48h window</div>
      <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 4 }}>
        {forecast.map((b, i) => (
          <ForecastBlock key={i} block={b} exposure={exposure} />
        ))}
      </div>
    </div>
  );
};

const TidalTurnsRow = ({ tidalTurns }) => {
  if (!tidalTurns?.length) return null;
  return (
    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {tidalTurns.map((turn, i) => (
        <div key={i} style={{
          fontSize: 10,
          color: turn.type === 'high' ? AMBER : SUBTEXT,
          background: SURFACE, borderRadius: 4, padding: '3px 8px',
        }}>
          {turn.type === 'high' ? '⇑' : '⇓'}{' '}
          {turn.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
          {turn.time.toLocaleDateString('en-GB', { weekday: 'short' })}
        </div>
      ))}
    </div>
  );
};

// ── API calls ─────────────────────────────────────────────────────────────
async function getRead(locationName, weather, marine, waterTemp, tidal, spot) {
  const windLabel = weather.windSpeed == null ? 'calm' :
    weather.windSpeed < 10 ? `light (${f0(weather.windSpeed)} km/h from ${weather.windDirection})` :
    weather.windSpeed < 20 ? `moderate (${f0(weather.windSpeed)} km/h from ${weather.windDirection})` :
    weather.windSpeed < 35 ? `fresh (${f0(weather.windSpeed)} km/h from ${weather.windDirection})` :
    weather.windSpeed < 40 ? `strong (${f0(weather.windSpeed)} km/h from ${weather.windDirection})` :
    weather.windSpeed < 60 ? `very strong (${f0(weather.windSpeed)} km/h from ${weather.windDirection}) — likely no-go for most swimmers` :
    `extreme (${f0(weather.windSpeed)} km/h from ${weather.windDirection}) — conditions are not suitable`;

  let swellLabel = 'no ocean swell';
  if (marine) {
    const sp = marine.swellPeriod;
    const sh = marine.swellHeight;
    const periodLabel = sp == null ? '' :
      sp < 7 ? `${f0(sp)}-second period (short — wind chop, not groundswell)` :
      sp < 10 ? `${f0(sp)}-second period (moderate swell)` :
      `${f0(sp)}-second period (long — proper groundswell)`;
    const heightLabel = sh == null ? 'unknown size' :
      sh < 0.5 ? 'negligible' :
      sh < 1.0 ? 'small' :
      sh < 1.5 ? 'moderate' :
      sh < 2.5 ? 'sizeable' : 'large';
    swellLabel = `${heightLabel} ${f1(sh)}m swell from ${marine.swellDirection}, ${periodLabel}`;
  }

  const tidalLabel = tidal ?
    `${tidal.range} tide, ${tidal.direction}${tidal.isSlack ? ', near slack water' : `, turning in ~${tidal.hoursToTurn}h`}` : '';

  const tempLabel = waterTemp != null ? `${f1(waterTemp)}C water` : '';
  const airLabel = weather.airTemp != null ? `${f1(weather.airTemp)}C air` : '';
  const now = new Date();
  const timeLabel = now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) +
    ' on ' + now.toLocaleDateString('en-GB', {weekday: 'long'});

  const prompt = `You are the conditions reader for Glassy, an open water swim app.
Location: ${locationName}
Time: ${timeLabel}
${spot?.profile ? `Spot profile: ${spot.profile}` : ''}

Pre-translated conditions (do not change these descriptions):
- Swell: ${swellLabel}
- Wind: ${windLabel}
${tidalLabel ? `- Tidal: ${tidalLabel}` : ''}
${tempLabel ? `- ${tempLabel}, ${airLabel}` : ''}
${weather.rainProb != null && weather.rainProb > 20 ? `- Rain: ${weather.rainProb}% probability` : ''}

Write 2 short paragraphs for an experienced open water swimmer.
Paragraph 1: what the conditions feel like right now. Use the pre-translated descriptions above — do not invent or change any figures or period labels.
Paragraph 2: give a direct verdict. If conditions are clearly unsuitable, say so plainly — do not find a silver lining that isn't there. If there is a genuine window, identify it. If it is closing, say so.
Then one short caveat sentence. Human tone, not legal.
No markdown. No headers. No bullets. Never say safe or unsafe. Under 120 words total.`;

  const res = await fetch('https://glassy-lake.vercel.app/api/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.text;
}

async function getForecastRead(locationName, forecast, tidalTurns, spot) {
  if (!forecast?.length) return null;

  const lines = forecast.map(b => {
    const wind = b.windSpeed != null ? `${b.windSpeed}km/h ${b.windDirection}` : 'wind unknown';
    const swell = b.swellHeight != null ? `, ${f1(b.swellHeight)}m swell` : '';
    const rain = b.rainProb != null && b.rainProb > 15 ? `, ${b.rainProb}% rain` : '';
    return `${blockLabel(b.isoTime)}: ${wind}${swell}${rain}`;
  }).join('\n');

  const turnText = tidalTurns.length > 0
    ? '\nTidal turns: ' + tidalTurns.map(t =>
        `${t.type === 'high' ? 'HW' : 'LW'} ${t.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${t.time.toLocaleDateString('en-GB', { weekday: 'short' })}`
      ).join(', ')
    : '';

  const prompt = `You are the conditions reader for Glassy, an open water swim app.
Location: ${locationName}
${spot?.profile ? `Spot profile: ${spot.profile}` : ''}

48-hour forecast (pre-computed — use these figures exactly, do not invent others):
${lines}${turnText}

Write one short paragraph for an experienced open water swimmer answering: when is the best window in the next 48 hours? Name the window (e.g. "Thursday morning", "tomorrow before noon"). If conditions are poor throughout, say so plainly.
No markdown. No headers. Never say safe or unsafe. Under 70 words.`;

  const res = await fetch('https://glassy-lake.vercel.app/api/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.text;
}

// ── Main component ────────────────────────────────────────────────────────
export default function App() {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState('idle');
  const [phaseLabel, setPhaseLabel] = useState('');
  const [result, setResult] = useState(null);
  const [errMsg, setErrMsg] = useState('');
  const [lastSpot, setLastSpot] = useState(null);
  const [activeTab, setActiveTab] = useState('now');

  async function search(spotOverride) {
    const q = (spotOverride?.name || query).trim();
    if (!q || phase === 'loading') return;
    const spot = spotOverride || matchSpot(q);
    const target = spot || { name: q, lat: null, lon: null, hasMarine: true };
    setPhase('loading'); setPhaseLabel('Locating spot');
    setResult(null); setErrMsg(''); setActiveTab('now');
    try {
      let lat = spot?.lat, lon = spot?.lon;
      if (lat == null) {
        setPhaseLabel('Locating spot');
        const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
        const d = await r.json();
        const loc = d.results?.[0];
        if (!loc) throw new Error('Location not found');
        lat = loc.latitude; lon = loc.longitude;
        target.name = [loc.name, loc.admin1, loc.country].filter(Boolean).join(', ');
      }
      setPhaseLabel('Fetching conditions');
      const { weather, marine, waterTemp, trajectory, forecast } = await fetchConditions(lat, lon, target.hasMarine !== false);
      setPhaseLabel('Calculating tidal state');
      const tidal = spot ? getTidalState(new Date(), spot) : null;
      const tidalTurns = spot ? getTidalTurns(spot, new Date()) : [];
      setPhaseLabel('Writing the read');
      const readText = await getRead(target.name, weather, marine, waterTemp, tidal, spot);
      setPhaseLabel('Scanning the window');
      const forecastRead = await getForecastRead(target.name, forecast, tidalTurns, spot);
      setLastSpot(spot || target);
      setResult({ spot, locationName: target.name, weather, marine, waterTemp, tidal, tidalTurns, trajectory, forecast, readText, forecastRead });
      setPhase('done');
    } catch (err) {
      setErrMsg(err.message || 'Could not load conditions');
      setPhase('error');
    }
  }

  const refresh = () => lastSpot && phase !== 'loading' && search(lastSpot);
  const reset = () => { setPhase('idle'); setResult(null); setQuery(''); setErrMsg(''); setLastSpot(null); setActiveTab('now'); };

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const r = result;
  const w = r?.weather;
  const m = r?.marine;
  const readClean = stripMd(r?.readText);
  const paras = readClean.split(/\n\n+/).filter(p => p.trim());
  const bodyParas = paras.length > 1 ? paras.slice(0, -1) : paras;
  const caveat = paras.length > 1 ? paras[paras.length - 1] : '';

  return (
    <div style={{ background: NAVY, color: TEXT, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <style>{`* { box-sizing: border-box; margin: 0; padding: 0; } body { background: ${NAVY}; } input::placeholder { color: ${MUTED}; } ::-webkit-scrollbar { display: none; }`}</style>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 0 2rem' }}>

        {/* Header */}
        <div style={{ padding: '2rem 1.5rem 1rem', textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 300, letterSpacing: '0.18em', textTransform: 'uppercase' }}>Glassy</div>
          <div style={{ fontSize: 10, letterSpacing: '0.22em', color: AMBER, textTransform: 'uppercase', marginTop: 5 }}>Know before you go</div>
          <Arc width={220} />
        </div>

        {/* Search */}
        <div style={{ padding: '0.75rem 1.25rem 0' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="Search any location…"
              disabled={phase === 'loading'}
              autoComplete="off"
              style={{ flex: 1, background: SURFACE, border: '1px solid #2A3A54', borderRadius: 8, color: TEXT, fontSize: 14, padding: '11px 14px', outline: 'none', fontFamily: 'inherit', opacity: phase === 'loading' ? 0.6 : 1 }}
            />
            <button
              onClick={() => search()}
              disabled={phase === 'loading' || !query.trim()}
              style={{ background: (phase === 'loading' || !query.trim()) ? '#2A3A54' : AMBER, border: 'none', borderRadius: 8, color: (phase === 'loading' || !query.trim()) ? MUTED : NAVY, fontSize: 13, fontWeight: 600, padding: '11px 18px', cursor: (phase === 'loading' || !query.trim()) ? 'default' : 'pointer', flexShrink: 0 }}
            >Go</button>
          </div>
          {phase === 'idle' && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {quickSpots().map(s => (
                <button key={s.id} onClick={() => { setQuery(s.name); search(s); }}
                  style={{ background: SURFACE, border: '1px solid #2A3A54', borderRadius: 20, color: SUBTEXT, fontSize: 11, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {s.name}
                </button>
              ))}
              <a href="https://www.swimloading.com/" target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#0284c711', border: '1px solid #0284c733', borderRadius: 20, color: '#0284c7', fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}>
                Water temps · SwimLoading ↗
              </a>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '0.75rem 1.25rem 1.25rem' }}>

          {phase === 'idle' && (
            <div style={{ textAlign: 'center', padding: '2.5rem 0', color: '#3A4A60', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              Select a spot or search anywhere
            </div>
          )}

          {phase === 'loading' && (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: MUTED, fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              {phaseLabel} <Dots />
            </div>
          )}

          {phase === 'error' && (
            <div>
              <div style={{ color: MUTED, fontSize: 13, padding: '1rem 0', textAlign: 'center', lineHeight: 1.6 }}>{errMsg}</div>
              <div style={{ textAlign: 'right' }}>
                <button onClick={reset} style={{ background: 'transparent', border: '1px solid #2A3A54', borderRadius: 6, color: MUTED, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '5px 10px', cursor: 'pointer' }}>Try again</button>
              </div>
            </div>
          )}

          {phase === 'done' && r && w && (
            <div>
              {/* Location + refresh */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{r.locationName}</div>
                <button onClick={refresh} style={{ background: 'transparent', border: 'none', color: MUTED, cursor: 'pointer', padding: '2px 4px', fontSize: 16 }}>↻</button>
              </div>
              <div style={{ fontSize: 11, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>{dateStr}</div>

              {/* Exposure badge */}
              {r.spot && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: SURFACE, borderRadius: 6, padding: '4px 10px', marginBottom: '0.5rem' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.spot.exposure === 'open ocean' ? AMBER : r.spot.exposure === 'sheltered' ? GREEN : SUBTEXT, display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: SUBTEXT, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{r.spot.exposure}</span>
                </div>
              )}

              {/* Tab switcher */}
              <div style={{ display: 'flex', borderBottom: '1px solid #2A3A54', margin: '0.5rem 0 0.75rem' }}>
                {[['now', 'Now'], ['forecast', '48h']].map(([tab, label]) => (
                  <button key={tab} onClick={() => setActiveTab(tab)} style={{
                    background: 'transparent', border: 'none',
                    color: activeTab === tab ? AMBER : MUTED,
                    fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
                    padding: '6px 14px 8px', cursor: 'pointer', fontFamily: 'inherit',
                    borderBottom: activeTab === tab ? `2px solid ${AMBER}` : '2px solid transparent',
                    marginBottom: -1,
                  }}>{label}</button>
                ))}
              </div>

              {/* ── Now tab ── */}
              {activeTab === 'now' && (
                <>
                  <TidalBadge tidal={r.tidal} spot={r.spot} />
                  <WindWarning windSpeed={w.windSpeed} windDirection={w.windDirection} />
                  <RainWarning rainProb={w.rainProb} />

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: '1rem' }}>
                    {m ? <>
                      <Cell label="Swell" value={m.swellHeight != null ? f1(m.swellHeight) : null} unit="m" />
                      <Cell label="Wave Ht" value={m.waveHeight != null ? f1(m.waveHeight) : null} unit="m" />
                      <Cell label={`Wind ${w.windDirection}`} value={w.windSpeed != null ? f0(w.windSpeed) : null} unit="km/h" />
                      {r.waterTemp != null
                        ? <Cell label="Water Temp" value={f1(r.waterTemp)} unit="°C" highlight />
                        : <SwimLoadingCell />}
                      <Cell label="Air Temp" value={w.airTemp != null ? f1(w.airTemp) : null} unit="°C" />
                    </> : <>
                      <Cell label={`Wind ${w.windDirection}`} value={w.windSpeed != null ? f0(w.windSpeed) : null} unit="km/h" />
                      <Cell label="Air Temp" value={w.airTemp != null ? f1(w.airTemp) : null} unit="°C" />
                      <SwimLoadingCell />
                      <Cell label="Rain" value={w.rainProb != null ? String(w.rainProb) : null} unit="%" />
                    </>}
                  </div>

                  <div style={{ margin: '0.9rem 0', display: 'flex', justifyContent: 'center' }}>
                    <Arc width={200} />
                  </div>

                  {bodyParas.length > 0 && (
                    <div style={{ fontSize: 14, lineHeight: 1.75, color: SUBTEXT }}>
                      {bodyParas.map((p, i) => (
                        <p key={i} style={{ marginBottom: i < bodyParas.length - 1 ? '0.85rem' : 0 }}>{p}</p>
                      ))}
                    </div>
                  )}

                  {caveat && (
                    <div style={{ fontSize: 12, fontStyle: 'italic', color: MUTED, marginTop: '0.85rem', lineHeight: 1.6 }}>{caveat}</div>
                  )}

                  {r.trajectory?.length > 0 && (
                    <div style={{ marginTop: '1.25rem' }}>
                      <div style={{ fontSize: 9, color: MUTED, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>Trajectory</div>
                      <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2 }}>
                        {r.trajectory.map((t, i) => (
                          <div key={i} style={{ background: SURFACE, borderRadius: 6, padding: '7px 9px', minWidth: 56, textAlign: 'center', flexShrink: 0 }}>
                            <div style={{ fontSize: 9, color: MUTED }}>{t.time}</div>
                            {m && t.waveHeight != null && (
                              <div style={{ fontSize: 12, fontFamily: 'monospace', color: TEXT, marginTop: 2 }}>{f1(t.waveHeight)}<span style={{ fontSize: 9, color: MUTED }}>m</span></div>
                            )}
                            <div style={{ fontSize: 12, fontFamily: 'monospace', color: MUTED, marginTop: 2 }}>{f0(t.windSpeed)}<span style={{ fontSize: 9, color: MUTED }}>k</span></div>
                            {t.rainProb != null && (
                              <div style={{ fontSize: 10, color: t.rainProb > 50 ? AMBER : MUTED, marginTop: 2 }}>{t.rainProb}<span style={{ fontSize: 8 }}>%</span></div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── 48h Forecast tab ── */}
              {activeTab === 'forecast' && (
                <>
                  <ForecastTimeline forecast={r.forecast} spot={r.spot} />
                  {r.tidalTurns?.length > 0 && <TidalTurnsRow tidalTurns={r.tidalTurns} />}

                  <div style={{ margin: '1rem 0 0.5rem', display: 'flex', justifyContent: 'center' }}>
                    <Arc width={200} />
                  </div>

                  {r.forecastRead ? (
                    <div style={{ fontSize: 14, lineHeight: 1.75, color: SUBTEXT }}>
                      <p style={{ marginBottom: 0 }}>{stripMd(r.forecastRead)}</p>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: MUTED, fontStyle: 'italic' }}>No forecast read available.</div>
                  )}
                </>
              )}

              {/* Bottom controls */}
              <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={refresh} style={{ background: 'transparent', border: `1px solid ${AMBER}55`, borderRadius: 6, color: AMBER, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '5px 12px', cursor: 'pointer' }}>↻ Refresh</button>
                <button onClick={reset} style={{ background: 'transparent', border: '1px solid #2A3A54', borderRadius: 6, color: MUTED, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '5px 10px', cursor: 'pointer' }}>New location</button>
              </div>

              {/* Data limitation notice */}
              <div style={{ marginTop: '1rem', padding: '10px 12px', background: '#1A2333', borderRadius: 7, borderLeft: '2px solid #2A3A54' }}>
                <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
                  Glassy reads atmospheric and marine data only — wind, swell, tide, and temperature. It cannot see river flood state, water turbidity, debris, or any condition requiring eyes on the water. Water temperature is satellite-derived and may differ significantly from actual conditions, particularly in estuaries and lagoons. Always assess local conditions before entering.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '1rem 0 0.5rem', color: MUTED, fontSize: 11, letterSpacing: '0.1em' }}>
          · by Signal &amp; Seed ·
        </div>

      </div>
    </div>
  );
}
