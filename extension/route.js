// Orders stops for a short drive: nearest-neighbor tour, then 2-opt clean-up.
// Distances are straight-line miles unless a distance function d(a, b) is given (for example road miles).
(function (root) {
  const R = 3958.8;
  const rad = (d) => (d * Math.PI) / 180;
  function miles(a, b) {
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  const pathMiles = (pts, d = miles) => pts.slice(1).reduce((s, p, i) => s + d(pts[i], p), 0);

  function nearestFrom(first, rest, d) {
    const out = [first];
    const left = rest.slice();
    while (left.length) {
      const cur = out[out.length - 1];
      let bi = 0;
      left.forEach((p, i) => { if (d(cur, p) < d(cur, left[bi])) bi = i; });
      out.push(left.splice(bi, 1)[0]);
    }
    return out;
  }

  // Reverses stretches of the path while that makes it shorter. keepFirst pins the starting point.
  function twoOpt(path, keepFirst, d) {
    let best = path.slice(), bestLen = pathMiles(best, d), better = true;
    while (better) {
      better = false;
      for (let i = keepFirst ? 1 : 0; i < best.length - 1; i++) {
        for (let k = i + 1; k < best.length; k++) {
          const cand = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
          const len = pathMiles(cand, d);
          if (len < bestLen - 1e-9) { best = cand; bestLen = len; better = true; }
        }
      }
    }
    return best;
  }

  // stops: [{ lat, lng, ... }]; start: optional { lat, lng } where the drive begins.
  // Returns the stops in driving order (the start is not included).
  function orderStops(stops, start, d = miles) {
    if (stops.length < 2) return stops.slice();
    if (start) return twoOpt(nearestFrom(start, stops, d), true, d).slice(1);
    let best = null, bestLen = Infinity;
    stops.forEach((s, i) => {
      const p = twoOpt(nearestFrom(s, stops.filter((_, j) => j !== i), d), false, d);
      const len = pathMiles(p, d);
      if (len < bestLen) { best = p; bestLen = len; }
    });
    return best;
  }

  const api = { miles, pathMiles, orderStops };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HouseRoute = api;
})(typeof self !== 'undefined' ? self : this);
