const STOPS = [
  [-1, [127, 29, 29]],
  [-2 / 3, [185, 28, 28]],
  [-1 / 3, [220, 38, 38]],
  [-0.05, [127, 58, 62]],
  [0, [55, 62, 72]],
  [0.05, [36, 92, 64]],
  [1 / 3, [22, 140, 70]],
  [2 / 3, [21, 128, 61]],
  [1, [6, 78, 46]],
];

export function tileColor(percent, limit = 3) {
  if (percent == null || Number.isNaN(percent) || !limit) return "rgb(58, 64, 74)";
  const value = Math.max(-limit, Math.min(limit, percent)) / limit;
  let index = 1;
  while (index < STOPS.length - 1 && STOPS[index][0] < value) index += 1;
  const [startValue, start] = STOPS[index - 1];
  const [endValue, end] = STOPS[index];
  const span = endValue - startValue || 1;
  const mix = (value - startValue) / span;
  const channel = start.map((part, i) => Math.round(part + (end[i] - part) * mix));
  return `rgb(${channel[0]}, ${channel[1]}, ${channel[2]})`;
}
