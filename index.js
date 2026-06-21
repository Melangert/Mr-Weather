require("dotenv").config();
const { App } = require("@slack/bolt");
const axios = require("axios");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true
});

const OW_KEY = process.env.OPENWEATHER_API_KEY;
const OW_BASE = "https://api.openweathermap.org/data/2.5";

//  title-case a string
const titleCase = s => s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());

// kelvin to fahrenheit
const toF = k => Math.round((k - 273.15) * 9/5 + 32);

//  unix timestamp to weekday
const toDay = ts => new Date(ts * 1000).toLocaleDateString("en-US", { weekday: "long" });

//---mwb-help
app.command("/mwb-help", async ({ ack, respond }) => {
  await ack();
  await respond({
    text:
`*Weather Bot Commands:*
\`/mwb-weather [city]\` — Current conditions in a city
\`/mwb-forecast [city]\` — 5-day, 3-hour forecast
\`/mwb-week [city]\` — Daily highs/lows for the next 5 days
\`/mwb-compare [city1] | [city2]\` — Side-by-side current weather
\`/mwb-ping\` — pings bot to check latency`
  });
});

//----mwb-ping----------
app.command("/mwb-ping", async ({ command, ack, respond }) => {
  const start = Date.now();
  await ack();
  await respond({ text: `Pong!\nLatency: ${Date.now() - start}ms` });
});

//----mwb-weather [city]----------
app.command("/mwb-weather", async ({ command, ack, respond }) => {
  await ack();
  const city = command.text.trim();
  if (!city) return respond({ text: "Usage: `/mwb-weather [city]`" });

  try {
    const { data } = await axios.get(`${OW_BASE}/weather`, {
      params: { q: city, appid: OW_KEY }
    });

    const temp = toF(data.main.temp);
    const feels = toF(data.main.feels_like);
    const high = toF(data.main.temp_max);
    const low = toF(data.main.temp_min);
    const desc = titleCase(data.weather[0].description);
    const humidity = data.main.humidity;
    const wind = Math.round(data.wind.speed * 2.237); // m/s to mph

    await respond({
      text:
`*Current Weather — ${data.name}, ${data.sys.country}*
${desc}
🌡️ ${temp}°F (feels like ${feels}°F)
⬆️ High: ${high}°F  ⬇️ Low: ${low}°F
💧 Humidity: ${humidity}%  💨 Wind: ${wind} mph`
    });
  } catch (err) {
    await respond({ text: `Couldn't find weather for "${city}". Check the city name.` });
  }
});

//----mwb-forecast [city]----------
app.command("/mwb-forecast", async ({ command, ack, respond }) => {
  await ack();
  const city = command.text.trim();
  if (!city) return respond({ text: "Usage: `/mwb-forecast [city]`" });

  try {
    const { data } = await axios.get(`${OW_BASE}/forecast`, {
      params: { q: city, appid: OW_KEY }
    });

    // Show next 5 entries (every 3 hours)
    const lines = data.list.slice(0, 5).map(entry => {
      const time = new Date(entry.dt * 1000).toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", hour12: true
      });
      const temp = toF(entry.main.temp);
      const desc = titleCase(entry.weather[0].description);
      return `• *${time}* — ${temp}°F, ${desc}`;
    });

    await respond({
      text: `*Forecast — ${data.city.name}, ${data.city.country}*\n${lines.join("\n")}`
    });
  } catch (err) {
    await respond({ text: `Couldn't find forecast for "${city}".` });
  }
});

//----mwb-week [city]----------
app.command("/mwb-week", async ({ command, ack, respond }) => {
  await ack();
  const city = command.text.trim();
  if (!city) return respond({ text: "Usage: `/mwb-week [city]`" });

  try {
    const { data } = await axios.get(`${OW_BASE}/forecast`, {
      params: { q: city, appid: OW_KEY }
    });

    // Group 3-hour slots by day
    const days = {};
    for (const entry of data.list) {
      const day = toDay(entry.dt);
      if (!days[day]) days[day] = { temps: [], descs: [] };
      days[day].temps.push(entry.main.temp);
      days[day].descs.push(entry.weather[0].description);
    }

    const lines = Object.entries(days).slice(0, 5).map(([day, { temps, descs }]) => {
      const high = toF(Math.max(...temps));
      const low = toF(Math.min(...temps));
      // Most common description for the day
      const desc = titleCase(
        descs.sort((a, b) =>
          descs.filter(v => v === b).length - descs.filter(v => v === a).length
        )[0]
      );
      return `• *${day}* — ⬆️ ${high}°F  ⬇️ ${low}°F  ${desc}`;
    });

    await respond({
      text: `*Week Ahead — ${data.city.name}, ${data.city.country}*\n${lines.join("\n")}`
    });
  } catch (err) {
    await respond({ text: `Couldn't find forecast for "${city}".` });
  }
});

//----mwb-compare [city1] | [city2]----------
app.command("/mwb-compare", async ({ command, ack, respond }) => {
  await ack();
  const parts = command.text.split("|").map(s => s.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return respond({ text: "Usage: `/mwb-compare [city1] | [city2]`" });
  }

  try {
    const [r1, r2] = await Promise.all(
      parts.map(city => axios.get(`${OW_BASE}/weather`, { params: { q: city, appid: OW_KEY } }))
    );

    const fmt = d =>
      `*${d.name}, ${d.sys.country}*\n` +
      `${titleCase(d.weather[0].description)}\n` +
      `🌡️ ${toF(d.main.temp)}°F (feels like ${toF(d.main.feels_like)}°F)\n` +
      `💧 ${d.main.humidity}%  💨 ${Math.round(d.wind.speed * 2.237)} mph`;

    await respond({
      text: `*Weather Comparison*\n\n${fmt(r1.data)}\n\n────────────\n\n${fmt(r2.data)}`
    });
  } catch (err) {
    await respond({ text: "Couldn't fetch one or both cities. Check the names and try again." });
  }
});

(async () => {
  await app.start();
  console.log("bot is running!");
})()
