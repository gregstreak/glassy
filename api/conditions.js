export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { lat, lon, hasMarine } = req.body;

  try {
    const [metRes, marineRes, sstRes] = await Promise.all([
      fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`, {
        headers: { 'User-Agent': 'GlassySwimApp/1.0 github.com/gregstreak/glassy' }
      }),
      hasMarine ? fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,wind_wave_height&timezone=auto&forecast_days=3`) : Promise.resolve(null),
      fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=sea_surface_temperature&timezone=auto&forecast_days=3`)
    ]);

    const metData = await metRes.json();
    const marineData = marineRes ? await marineRes.json() : null;
    const sstData = await sstRes.json().catch(() => null);

    res.status(200).json({ metData, marineData, sstData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
