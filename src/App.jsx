import { useState } from 'react';
import { SPOTS, matchSpot, quickSpots } from './spots';
import { fetchConditions } from './api';

const NAVY = '#1B2535';
const AMBER = '#E09040';
const SURFACE = '#232E42';
const MUTED = '#4A5A72';
const TEXT = '#F4F6F9';
const SUBTEXT = '#A8B8CC';
const GREEN = '#4A9A7A';

const _SEMI_MS = 12 * 3600000 + 25 * 60000 + 14000;
const _HW_EPOCHS = {
  'knysna-heads':  Date.UTC(2026, 4, 4, 3, 11, 0),
  'knysna-lagoon': Date.UTC(2026, 4, 4, 3, 25, 0),
  'hermanus':      Date.UTC(2026, 4, 4, 2, 30, 0),
  'gordons-bay':   Date.UTC(2026, 4, 4, 4,  0, 0),
  'fish-hoek':     Date.UTC(2026, 4, 4, 3, 45, 0),
};

function getTidalState(date, spot) {
  if (!spot || !spot.isTidal) return null;
  const epoch = _HW_EPOCHS[spot.id];
  if (!epoch) return null;
  const nowMs = date.getTime();
  let hw = epoch;
  while (hw + _SEMI_MS <= nowMs) hw += _SEMI_MS;
  while (hw > nowMs) hw -= _SEMI_MS;
  const angle = ((nowMs - hw) / _SEMI_MS) * 2 * Math.PI;
  const rate = -Math.sin(angle);
  const isSlack = Math.abs(rate) < 0.2;
  const direction = rate >= 0 ? 'incoming' : 'outgoing';
  let hoursToTurn = rate >= 0
    ? ((2 * Math.PI - angle) / (2 * Math.PI)) * _SEMI_MS / 3600000
    : ((Math.PI - angle) / (2 * Math.PI)) * _SEMI_MS / 3600000;
  hoursToTurn = Math.max(0.1, Math.round(hoursToTurn * 10) / 10);
  const LUNAR_CYCLE = 29.53 * 24 * 3600000;
  const phase = ((nowMs - Date.UTC(2000, 0, 6, 18, 14, 0)) % LUNAR_CYCLE) / LUNAR_CYCLE;
  const distSpring = Math.min(Math.min(phase, 1 - phase), Math.abs(phase - 0.5));
  const range = distSpring < 0.085 ? 'spring' : distSpring > 0.165 ? 'neap' : 'moderate';
  const rangeLabel = { spring: 'Spring tide — stronger current', neap: 'Neap tide — gentler current', moderate: 'Moderate tidal range' }[range];
  const isLagoon = spot.id.includes('lagoon');
  const dirLabel = isLagoon ? (direction === 'incoming' ? 'flowing into the lagoon' : 'flowing toward the Heads') : direction;
  const note = isSlack
    ? `Near slack water — tide turning in under ${Math.ceil(hoursToTurn * 60)} min. ${rangeLabel}.`
    : `${rangeLabel}. Tide ${dirLabel}, turning in ~${hoursToTurn}h.`;
  return { direction, isSlack, hoursToTurn, range, note };
}

function f1(v) { return v != null ? Number(v).toFixed(1) : '—'; }
function f0(v) { return v != null ? String(Math.round(v)) : '—'; }
function clean(t) { return (t || '').replace(/^#+\s+.*$/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/^[-*]\s+/gm, '').trim(); }

const Arc = ({ width = 200 }) => (
  React.createElement('svg', { width, height: 16, viewBox: `0 0 ${width} 16`, style: { display: 'block', margin: '10px auto 0' } },
    React.createElement('path', { d: `M 6 14 Q ${width/2} 2 ${width-6} 14`, stroke: AMBER, strokeWidth: 2.5, fill: 'none', strokeLinecap: 'round' })
  )
);

function Cell({ label, value, unit, highlight }) {
  return (
    React.createElement('div', { style: { background: SURFACE, borderRadius: 7, padding: '9px 11px', border: highlight ? `1px solid ${AMBER}55` : '1px solid transparent' } },
      React.createElement('div', { style: { fontSize: 9, letterSpacing: '0.14em', color: MUTED, textTransform: 'uppercase', marginBottom: 3 } }, label),
      React.createElement('div', { style: { fontSize: 17, fontFamily: 'monospace', color: highlight ? AMBER : TEXT, lineHeight: 1 } },
        value != null ? value : '—',
        unit && React.createElement('span', { style: { fontSize: 10, color: MUTED, marginLeft: 1 } }, unit)
      )
    )
  );
}

function Dots() {
  return React.createElement(React.Fragment, null,
    React.createElement('style', null, '@keyframes gb{0%,100%{opacity:.15}50%{opacity:1}}'),
    ...[0,1,2].map(n => React.createElement('span', { key: n, style: { display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: AMBER, margin: '0 2px', animation: `gb 1.2s ease-in-out ${n*0.2}s infinite` } }))
  );
}

function TidalBadge({ tidal }) {
  if (!tidal) return null;
  const color = tidal.range === 'spring' ? AMBER : tidal.range === 'neap' ? GREEN : SUBTEXT;
  return React.createElement('div', { style: { background: SURFACE, borderRadius: 7, padding: '8px 11px', marginBottom: '0.75rem', borderLeft: `3px solid ${color}` } },
    React.createElement('div', { style: { fontSize: 9, letterSpacing: '0.14em', color: MUTED, textTransform: 'uppercase', marginBottom: 3 } }, `Tidal State · ${tidal.range}`),
    React.createElement('div', { style: { fontSize: 13, color: SUBTEXT, lineHeight: 1.5 } }, tidal.note)
  );
}

async function getRead(locationName, weather, marine, waterTemp, tidal, spot) {
  const tidalContext = tidal ? `Tidal state: ${tidal.direction}, ${tidal.range} tide, ${tidal.isSlack ? 'near slack water' : `turning in ~${tidal.hoursToTurn}h`}.` : '';
  const prompt = `You are the conditions reader for Glassy, an open water swim app.
Location: ${locationName}
${spot && spot.profile ? `Spot profile: ${spot.profile}` : ''}
${tidalContext}
Current conditions:
- Air temp: ${f1(weather.airTemp)}C
- Water temp: ${waterTemp != null ? f1(waterTemp) + 'C' : 'unavailable'}
- Wind: ${f0(weather.windSpeed)} km/h from ${weather.windDirection}
- Rain probability: ${weather.rainProb != null ? weather.rainProb + '%' : 'unavailable'}
${marine ? `- Wave height: ${f1(marine.waveHeight)}m, period ${f0(marine.wavePeriod)}s from ${marine.waveDirection}
- Swell: ${f1(marine.swellHeight)}m at ${f0(marine.swellPeriod)}s from ${marine.swellDirection}` : '- No ocean swell (sheltered location)'}
Write a plain-language conditions read for an experienced open water swimmer.
Paragraph 1: current conditions in swimmer language. Note chop vs groundswell. Factor in tidal and spot context.
Paragraph 2: trajectory — is this the window or is it closing?
One blank line then a single caveat sentence. Human tone.
Rules: no markdown, no asterisks, no headers, no bullets. Never say safe or unsafe. Under 130 words.`;

  const res = await fetch('https://glassy-lake.vercel.app/api/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.text;
}

export default function App() {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState('idle');
  const [phaseLabel, setPhaseLabel] = useState('');
  const [result, setResult] = useState(null);
  const [errMsg, setErrMsg] = useState('');
  const [lastSpot, setLastSpot] = useState(null);

  async function search(spotOverride) {
    const q = (spotOverride ? spotOverride.name : query).trim();
    if (!q || phase === 'loading') return;
    const spot = spotOverride || matchSpot(q);
    const target = spot || { name: q, lat: null, lon: null, hasMarine: true };
    setPhase('loading'); setPhaseLabel('Locating spot');
    setResult(null); setErrMsg('');
    try {
      let lat = spot ? spot.lat : null;
      let lon = spot ? spot.lon : null;
      if (lat == null) {
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
        const geoData = await geoRes.json();
        const loc = geoData.results && geoData.results[0];
        if (!loc) throw new Error('Location not found');
        lat = loc.latitude; lon = loc.longitude;
        target.name = [loc.name, loc.admin1, loc.country].filter(Boolean).join(', ');
      }
      setPhaseLabel('Fetching conditions');
      const { weather, marine, waterTemp, trajectory } = await fetchConditions(lat, lon, target.hasMarine !== false);
      setPhaseLabel('Calculating tidal state');
      const tidal = spot ? getTidalState(new Date(), spot) : null;
      setPhaseLabel('Writing the read');
      const readText = await getRead(target.name, weather, marine, waterTemp, tidal, spot);
      setLastSpot(spot || target);
      setResult({ spot, locationName: target.name, weather, marine, waterTemp, tidal, trajectory, readText });
      setPhase('done');
    } catch (err) {
      setErrMsg(err.message || 'Could not load conditions');
      setPhase('error');
    }
  }

  async function refresh() {
    if (!lastSpot || phase === 'loading') return;
    await search(lastSpot);
  }

  function reset() {
    setPhase('idle'); setResult(null); setQuery(''); setErrMsg(''); setLastSpot(null);
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const r = result;
  const w = r && r.weather;
  const m = r && r.marine;
  const readText = clean(r && r.readText || '');
  const paras = readText.split(/\n\n+/).filter(p => p.trim());
  const bodyParas = paras.length > 1 ? paras.slice(0, -1) : paras;
  const caveat = paras.length > 1 ? paras[paras.length - 1] : '';

  return React.createElement('div', { style: { background: NAVY, color: TEXT, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' } },
    React.createElement('style', null, `@keyframes gb{0%,100%{opacity:.15}50%{opacity:1}} *{box-sizing:border-box;margin:0;padding:0} body{background:${NAVY}} input::placeholder{color:${MUTED}} ::-webkit-scrollbar{display:none}`),
    React.createElement('div', { style: { maxWidth: 480, margin: '0 auto', padding: '0 0 2rem' } },
      React.createElement('div', { style: { padding: '2rem 1.5rem 1rem', textAlign: 'center' } },
        React.createElement('div', { style: { fontSize: 28, fontWeight: 300, letterSpacing: '0.18em', textTransform: 'uppercase' } }, 'Glassy'),
        React.createElement('div', { style: { fontSize: 10, letterSpacing: '0.22em', color: AMBER, textTransform: 'uppercase', marginTop: 5 } }, 'Know before you go'),
        React.createElement(Arc, { width: 220 })
      ),
      React.createElement('div', { style: { padding: '0.75rem 1.25rem 0' } },
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('input', {
            value: query,
            onChange: e => setQuery(e.target.value),
            onKeyDown: e => e.key === 'Enter' && search(),
            placeholder: 'Search any location…',
            disabled: phase === 'loading',
            autoComplete: 'off',
            style: { flex: 1, background: SURFACE, border: '1px solid #2A3A54', borderRadius: 8, color: TEXT, fontSize: 14, padding: '11px 14px', outline: 'none', fontFamily: 'inherit', opacity: phase === 'loading' ? 0.6 : 1 }
          }),
          React.createElement('button', {
            onClick: () => search(),
            disabled: phase === 'loading' || !query.trim(),
            style: { background: (phase === 'loading' || !query.trim()) ? '#2A3A54' : AMBER, border: 'none', borderRadius: 8, color: (phase === 'loading' || !query.trim()) ? MUTED : NAVY, fontSize: 13, fontWeight: 600, padding: '11px 18px', cursor: (phase === 'loading' || !query.trim()) ? 'default' : 'pointer', flexShrink: 0 }
          }, 'Go')
        ),
        phase === 'idle' && React.createElement('div', { style: { marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 5 } },
          quickSpots().map(s => React.createElement('button', {
            key: s.id,
            onClick: () => { setQuery(s.name); search(s); },
            style: { background: SURFACE, border: '1px solid #2A3A54', borderRadius: 20, color: SUBTEXT, fontSize: 11, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }
          }, s.name))
        )
      ),
      React.createElement('div', { style: { padding: '0.75rem 1.25rem 1.25rem' } },
        phase === 'idle' && React.createElement('div', { style: { textAlign: 'center', padding: '2.5rem 0', color: '#3A4A60', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase' } }, 'Select a spot or search anywhere'),
        phase === 'loading' && React.createElement('div', { style: { textAlign: 'center', padding: '2rem 0', color: MUTED, fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase' } },
          phaseLabel, React.createElement(Dots)
        ),
        phase === 'error' && React.createElement('div', null,
          React.createElement('div', { style: { color: MUTED, fontSize: 13, padding: '1rem 0', textAlign: 'center', lineHeight: 1.6 } }, errMsg),
          React.createElement('div', { style: { textAlign: 'right' } },
            React.createElement('button', { onClick: reset, style: { background: 'transparent', border: '1px solid #2A3A54', borderRadius: 6, color: MUTED, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '5px 10px', cursor: 'pointer' } }, 'Try again')
          )
        ),
        phase === 'done' && r && w && React.createElement('div', null,
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 } },
            React.createElement('div', { style: { fontSize: 15, fontWeight: 500 } }, r.locationName),
            React.createElement('button', { onClick: refresh, style: { background: 'transparent', border: 'none', color: MUTED, cursor: 'pointer', padding: '2px 4px', fontSize: 16 } }, '↻')
          ),
          React.createElement('div', { style: { fontSize: 11, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.75rem' } }, dateStr),
          r.spot && React.createElement('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, background: SURFACE, borderRadius: 6, padding: '4px 10px', marginBottom: '0.75rem' } },
            React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: r.spot.exposure === 'open ocean' ? AMBER : r.spot.exposure === 'sheltered' ? GREEN : SUBTEXT, display: 'inline-block', flexShrink: 0 } }),
            React.createElement('span', { style: { fontSize: 10, color: SUBTEXT, letterSpacing: '0.08em', textTransform: 'uppercase' } }, r.spot.exposure)
          ),
          React.createElement(TidalBadge, { tidal: r.tidal }),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: '1rem' } },
            m ? React.createElement(React.Fragment, null,
              React.createElement(Cell, { label: 'Swell', value: m.swellHeight != null ? f1(m.swellHeight) : null, unit: 'm' }),
              React.createElement(Cell, { label: 'Period', value: m.swellPeriod != null ? Math.round(m.swellPeriod) : null, unit: 's' }),
              React.createElement(Cell, { label: 'Wave Ht', value: m.waveHeight != null ? f1(m.waveHeight) : null, unit: 'm' }),
              React.createElement(Cell, { label: `Wind ${w.windDirection}`, value: w.windSpeed != null ? f0(w.windSpeed) : null, unit: 'km/h' }),
              React.createElement(Cell, { label: 'Water Temp', value: r.waterTemp != null ? f1(r.waterTemp) : null, unit: '°C', highlight: r.waterTemp != null }),
              React.createElement(Cell, { label: 'Air Temp', value: w.airTemp != null ? f1(w.airTemp) : null, unit: '°C' })
            ) : React.createElement(React.Fragment, null,
              React.createElement(Cell, { label: `Wind ${w.windDirection}`, value: w.windSpeed != null ? f0(w.windSpeed) : null, unit: 'km/h' }),
              React.createElement(Cell, { label: 'Air Temp', value: w.airTemp != null ? f1(w.airTemp) : null, unit: '°C' }),
              React.createElement(Cell, { label: 'Water Temp', value: r.waterTemp != null ? f1(r.waterTemp) : null, unit: '°C', highlight: r.waterTemp != null }),
              React.createElement(Cell, { label: 'Rain', value: w.rainProb != null ? String(w.rainProb) : null, unit: '%' })
            )
          ),
          React.createElement('div', { style: { margin: '0.9rem 0', display: 'flex', justifyContent: 'center' } }, React.createElement(Arc, { width: 200 })),
          bodyParas.length > 0 && React.createElement('div', { style: { fontSize: 14, lineHeight: 1.75, color: SUBTEXT } },
            bodyParas.map((p, i) => React.createElement('p', { key: i, style: { marginBottom: i < bodyParas.length - 1 ? '0.85rem' : 0 } }, p))
          ),
          caveat && React.createElement('div', { style: { fontSize: 12, fontStyle: 'italic', color: MUTED, marginTop: '0.85rem', lineHeight: 1.6 } }, caveat),
          r.trajectory && r.trajectory.length > 0 && React.createElement('div', { style: { marginTop: '1.25rem' } },
            React.createElement('div', { style: { fontSize: 9, color: MUTED, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 } }, 'Trajectory'),
            React.createElement('div', { style: { display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2 } },
              r.trajectory.map((t, i) => React.createElement('div', { key: i, style: { background: SURFACE, borderRadius: 6, padding: '7px 9px', minWidth: 56, textAlign: 'center', flexShrink: 0 } },
                React.createElement('div', { style: { fontSize: 9, color: MUTED } }, t.time),
                m && t.waveHeight != null && React.createElement('div', { style: { fontSize: 12, fontFamily: 'monospace', color: TEXT, marginTop: 2 } }, f1(t.waveHeight), React.createElement('span', { style: { fontSize: 9, color: MUTED } }, 'm')),
                React.createElement('div', { style: { fontSize: 12, fontFamily: 'monospace', color: MUTED, marginTop: 2 } }, t.windSpeed != null ? f0(t.windSpeed) : '—', React.createElement('span', { style: { fontSize: 9, color: MUTED } }, 'k')),
                t.rainProb != null && React.createElement('div', { style: { fontSize: 10, color: t.rainProb > 50 ? AMBER : MUTED, marginTop: 2 } }, t.rainProb, React.createElement('span', { style: { fontSize: 8 } }, '%'))
              ))
            )
          ),
          React.createElement('div', { style: { marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            React.createElement('button', { onClick: refresh, disabled: phase === 'loading', style: { background: 'transparent', border: `1px solid ${AMBER}55`, borderRadius: 6, color: AMBER, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '5px 12px', cursor: 'pointer' } }, '↻ Refresh'),
            React.createElement('button', { onClick: reset, style: { background: 'transparent', border: '1px solid #2A3A54', borderRadius: 6, color: MUTED, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '5px 10px', cursor: 'pointer' } }, 'New location')
          )
        )
      )
    )
  );
}
