import { addDays, runsOn } from "./calendar.js";

function legsFor(lineData, originId, destId) {
  const ids = lineData.stations.map((s) => s.id);
  const oIdx = ids.indexOf(originId);
  const dIdx = ids.indexOf(destId);
  if (oIdx === -1 || dIdx === -1 || oIdx === dIdx) return [];
  const dir = oIdx < dIdx ? "to_tunis" : "from_tunis";
  const between = Math.abs(dIdx - oIdx) - 1;
  const legs = [];
  for (const trip of lineData.trips) {
    if (trip.dir !== dir) continue;
    const o = trip.stops.findIndex(([s]) => s === oIdx);
    const d = trip.stops.findIndex(([s]) => s === dIdx);
    if (o === -1 || d === -1 || o >= d) continue;
    const served = trip.stops.slice(o, d + 1);
    legs.push({
      trip,
      depart: trip.stops[o][1],
      arrive: trip.stops[d][1],
      served,
      express: served.length - 2 < between,
    });
  }
  return legs.sort((a, b) => a.depart - b.depart || a.trip.train - b.trip.train);
}

// `lines` is either one line's data, or a function (date) => line data for the timetable active that day.
export function nextTrains(lines, cal, originId, destId, nowTunis, count = 3) {
  if (originId === destId) return [];
  const lineFor = typeof lines === "function" ? lines : () => lines;

  const day = (date, tomorrow) => {
    const lineData = lineFor(date);
    if (!lineData) return [];
    return legsFor(lineData, originId, destId)
      .filter((l) => runsOn(l.trip.service, date, cal) && (tomorrow || l.depart >= nowTunis.minutes))
      .map((l) => ({
        train: l.trip.train,
        depart: l.depart,
        arrive: l.arrive,
        durationMin: l.arrive - l.depart,
        minutesUntil: l.depart - nowTunis.minutes + (tomorrow ? 1440 : 0),
        tomorrow,
        express: l.express,
        served: l.served,
        period: lineData.period,
      }));
  };

  const today = day(nowTunis.date, false);
  if (today.length >= count) return today.slice(0, count);
  return [...today, ...day(addDays(nowTunis.date, 1), true).slice(0, count - today.length)];
}
