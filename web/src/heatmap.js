import { hierarchy, treemap } from "d3-hierarchy";
import { tileColor } from "./color.js";
import { formatTilePercent } from "./format.js";

function fitText(text, width, fontSize) {
  const maxChars = Math.floor((width - 8) / (fontSize * 0.56));
  if (maxChars < 2) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

export function renderHeatmap(svg, stocks, { scale = 3, sizeOf = (stock) => stock.weight, colorOf = (stock) => stock.changePercent, formatOf = formatTilePercent } = {}) {
  const width = Math.floor(svg.clientWidth);
  const height = Math.floor(svg.clientHeight);
  svg.replaceChildren();
  if (width < 40 || height < 40 || stocks.length === 0) return;

  const grouped = new Map();
  for (const stock of stocks) {
    if (!sizeOf(stock)) continue;
    if (!grouped.has(stock.sector)) grouped.set(stock.sector, []);
    grouped.get(stock.sector).push(stock);
  }

  const root = hierarchy({
    name: "S&P 500",
    children: [...grouped.entries()].map(([name, children]) => ({ name, children })),
  })
    .sum((node) => (node.symbol ? sizeOf(node) : 0))
    .sort((a, b) => (b.value || 0) - (a.value || 0));

  treemap()
    .size([width, height])
    .paddingInner((node) => (node.depth === 0 ? 3 : 1))
    .paddingTop((node) => (node.depth === 1 ? 18 : 0))
    .round(true)(root);

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const ns = "http://www.w3.org/2000/svg";
  for (const sector of root.children ?? []) {
    const group = document.createElementNS(ns, "g");
    const widthPx = sector.x1 - sector.x0;
    const heightPx = sector.y1 - sector.y0;
    const band = document.createElementNS(ns, "rect");
    band.setAttribute("x", sector.x0);
    band.setAttribute("y", sector.y0);
    band.setAttribute("width", Math.max(widthPx, 0));
    band.setAttribute("height", Math.max(heightPx, 0));
    band.setAttribute("fill", "#12161c");
    group.append(band);

    const leaves = sector.leaves();
    const labelRoom = Math.min(...leaves.map((leaf) => leaf.y0)) - sector.y0;
    if (labelRoom >= 13 && widthPx > 48) {
      const label = document.createElementNS(ns, "text");
      label.setAttribute("class", "sector-label");
      label.setAttribute("x", sector.x0 + 6);
      label.setAttribute("y", sector.y0 + 12);
      label.textContent = fitText(sector.data.name.toUpperCase(), widthPx, 11);
      group.append(label);
    }

    for (const leaf of leaves) {
      const stock = leaf.data;
      const x = leaf.x0;
      const y = leaf.y0;
      const tileWidth = leaf.x1 - leaf.x0;
      const tileHeight = leaf.y1 - leaf.y0;
      if (tileWidth < 1 || tileHeight < 1) continue;

      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("class", "tile");
      rect.setAttribute("x", x);
      rect.setAttribute("y", y);
      rect.setAttribute("width", tileWidth);
      rect.setAttribute("height", tileHeight);
      const painted = colorOf(stock);
      rect.setAttribute("fill", tileColor(painted, scale));
      rect.dataset.symbol = stock.symbol;
      group.append(rect);

      if (tileWidth < 32 || tileHeight < 18) continue;
      const symbolSize = Math.max(
        10,
        Math.min(22, Math.floor(Math.min(tileWidth / (stock.symbol.length * 0.62), tileHeight * 0.42))),
      );
      if (symbolSize * stock.symbol.length * 0.58 > tileWidth - 4) continue;

      const showPercent = tileHeight >= symbolSize + 18 && tileWidth >= 44 && painted != null;
      const block = showPercent ? symbolSize + 13 : symbolSize;
      const textTop = y + (tileHeight - block) / 2;

      const ticker = document.createElementNS(ns, "text");
      ticker.setAttribute("class", "tile-symbol");
      ticker.setAttribute("x", x + tileWidth / 2);
      ticker.setAttribute("y", textTop + symbolSize * 0.82);
      ticker.setAttribute("font-size", String(symbolSize));
      ticker.textContent = stock.symbol;
      group.append(ticker);

      if (showPercent) {
        const percent = document.createElementNS(ns, "text");
        percent.setAttribute("class", "tile-change");
        percent.setAttribute("x", x + tileWidth / 2);
        percent.setAttribute("y", textTop + symbolSize + 12);
        percent.setAttribute("font-size", String(Math.max(10, symbolSize - 4)));
        percent.textContent = formatOf(painted);
        group.append(percent);
      }
    }

    svg.append(group);
  }
}
