import { useState } from 'react';
import { matchSpot, quickSpots } from './spots';
import { fetchConditions } from './api';

// ── Colours ───────────────────────────────────────────────────────────────
const NAVY = '#1B2535', AMBER = '#E09040', SURFACE = '#232E42';
const MUTED = '#4A5A72', TEXT = '#F4F6F9', SUBTEXT = '#A8B8CC', GREEN = '#4A9A7A';

// ── Tidal calculation — epoch-anchored ────────────────────────────────────
const _SEMI = 12 * 3600000 + 25 * 60000 + 14000;
const _EPOCHS = {
  'knysna-heads':  Date.UTC(2026, 4, 4, 3, 11, 0),
  'knysna-lagoon': Date.UTC(2026, 4, 4, 3, 25, 0),
  'hermanus':      Date.UTC(2026, 4, 4, 2, 30, 0),
  'gordons-bay':   Date.UTC(2026, 4, 4, 4,  0, 0),
  'fish-hoek':     Date.UTC(2026, 4, 4, 3, 45, 0),
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
  const isSlack = Math.abs(rate) < 0.2;
  const direction = rate >= 0 ? 'incoming' : 'outgoing';
  let h2t = rate >= 0
    ? ((2 * Math.PI - angle) / (2 * Math.PI)) * _SEMI / 3600000
    : ((Math.PI - angle) / (2 * Math.PI)) * _SEMI / 3600000;
  h2t = Math.max(0.1, Math.round(h2t * 10) / 10);
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

// ── Helpers ───────────────────────────────────────────────────────────────
const f1 = v => v != null ? Number(v).toFixed(1) : '—';
const f0 = v => v != null ? String(Math.round(v)) : '—';
const stripMd = t => (t || '')
  .replace(/^#+\s+.*$/gm, '')
  .replace(/\*\*(.+?)\*\*/g, '$1')
  .replace(/\*(.+?)\*/g, '$1')
  .replace(/^[-*]\s+/gm, '')
  .trim();

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

const TidalBadge = ({ tidal }) => {
  if (!tidal) return null;
  const col = tidal.range === 'spring' ? AMBER : tidal.range === 'neap' ? GREEN : SUBTEXT;
  return (
    <div style={{ background: SURFACE, borderRadius: 7, padding: '8px 11px', marginBottom: '0.75rem', borderLeft: `3px solid ${col}` }}>
      <div style={{ fontSize: 9, letterSpacing: '0.14em', color: MUTED, textTransform: 'uppercase', marginBottom: 3 }}>Tidal State · {tidal.range}</div>
      <div style={{ fontSize: 13, color: SUBTEXT, lineHeight: 1.5 }}>{tidal.note}</div>
    </div>
  );
};

// ── API call ──────────────────────────────────────────────────────────────
async function getRead(locationName, weather, marine, waterTemp, tidal, spot) {
  const tc = tidal ? `Tidal state: ${tidal.direction}, ${tidal.range} tide, ${tidal.isSlack ? 'near slack water' : `turning in ~${tidal.hoursToTurn}h`}.` : '';
  const prompt = `You are the conditions reader for Glassy, an open water swim app.
Location: ${locationName}
${spot?.profile ? `Spot profile: ${spot.profile}` : ''}
${tc}
Current conditions:
- Air temp: ${f1(weather.airTemp)}C, Water temp: ${waterTemp != null ? f1(waterTemp) + 'C' : 'unavailable'}
- Wind: ${f0(weather.windSpeed)} km/h from ${weather.windDirection}
- Rain probability: ${weather.rainProb != null ? weather.rainProb + '%' : 'unavailable'}
${marine ? `- Wave height: ${f1(marine.waveHeight)}m from ${marine.waveDirection}\n- Swell: ${f1(marine.swellHeight)}m at ${f0(marine.swellPeriod)}s (${marine.swellPeriod != null && marine.swellPeriod < 8 ? "short-period wind chop" : "longer-period groundswell"}) from ${marine.swellDirection}` : '- No ocean swell (sheltered location)'}
Write a plain-language conditions read for an experienced open water swimmer. The numbers above are verified sensor data — translate them accurately. Do not substitute or improve on the figures provided. If the period is 5 seconds, say it is short-period chop, not a longer period.
Paragraph 1: current conditions in swimmer language. Use ONLY the exact numbers provided above — do not change or improve them. A 5-second period means short choppy swell, say so. A 1-metre swell is small, say so. Factor in tidal and spot context.
Paragraph 2: trajectory — is this the window or is it closing?
Blank line then a single caveat sentence. Human tone.
Rules: no markdown, no asterisks, no headers, no bullets. Never say safe or unsafe. Under 130 words. IMPORTANT: use the actual time of day provided — do not say morning if it is afternoon or evening.`;

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

  async function search(spotOverride) {
    const q = (spotOverride?.name || query).trim();
    if (!q || phase === 'loading') return;
    const spot = spotOverride || matchSpot(q);
    const target = spot || { name: q, lat: null, lon: null, hasMarine: true };
    setPhase('loading'); setPhaseLabel('Locating spot');
    setResult(null); setErrMsg('');
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

  const refresh = () => lastSpot && phase !== 'loading' && search(lastSpot);
  const reset = () => { setPhase('idle'); setResult(null); setQuery(''); setErrMsg(''); setLastSpot(null); };

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
              style={{ flex: 1, background: SURFACE, border: '1px solid #2A3A54', borderRadius: 8, color: TEXT, fontSize: 16, padding: '11px 14px', outline: 'none', fontFamily: 'inherit', opacity: phase === 'loading' ? 0.6 : 1 }}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{r.locationName}</div>
                <button onClick={refresh} style={{ background: 'transparent', border: 'none', color: MUTED, cursor: 'pointer', padding: '2px 4px', fontSize: 16 }}>↻</button>
              </div>
              <div style={{ fontSize: 11, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>{dateStr}</div>

              {r.spot && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: SURFACE, borderRadius: 6, padding: '4px 10px', marginBottom: '0.75rem' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.spot.exposure === 'open ocean' ? AMBER : r.spot.exposure === 'sheltered' ? GREEN : SUBTEXT, display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: SUBTEXT, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{r.spot.exposure}</span>
                </div>
              )}

              <TidalBadge tidal={r.tidal} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: '1rem' }}>
                {m ? <>
                  <Cell label="Swell" value={m.swellHeight != null ? f1(m.swellHeight) : null} unit="m" />
                  <Cell label="Period" value={m.swellPeriod != null ? Math.round(m.swellPeriod) : null} unit="s" />
                  <Cell label="Wave Ht" value={m.waveHeight != null ? f1(m.waveHeight) : null} unit="m" />
                  <Cell label={`Wind ${w.windDirection}`} value={w.windSpeed != null ? f0(w.windSpeed) : null} unit="km/h" />
                  <Cell label="Water Temp" value={r.waterTemp != null ? f1(r.waterTemp) : null} unit="°C" highlight={r.waterTemp != null} />
                  <Cell label="Air Temp" value={w.airTemp != null ? f1(w.airTemp) : null} unit="°C" />
                </> : <>
                  <Cell label={`Wind ${w.windDirection}`} value={w.windSpeed != null ? f0(w.windSpeed) : null} unit="km/h" />
                  <Cell label="Air Temp" value={w.airTemp != null ? f1(w.airTemp) : null} unit="°C" />
                  <Cell label="Water Temp" value={r.waterTemp != null ? f1(r.waterTemp) : null} unit="°C" highlight={r.waterTemp != null} />
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

              <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={refresh} style={{ background: 'transparent', border: `1px solid ${AMBER}55`, borderRadius: 6, color: AMBER, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '5px 12px', cursor: 'pointer' }}>↻ Refresh</button>
                <button onClick={reset} style={{ background: 'transparent', border: '1px solid #2A3A54', borderRadius: 6, color: MUTED, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '5px 10px', cursor: 'pointer' }}>New location</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
