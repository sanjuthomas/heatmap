export function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatTilePercent(value) {
  if (value == null || Number.isNaN(value)) return "—";
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatDate(iso) {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatPrice(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatRatioPercent(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatDebtToEquity(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

export function formatEbitda(value) {
  if (value == null || Number.isNaN(value)) return "—";
  const absolute = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (absolute >= 1e12) return `${sign}$${(absolute / 1e12).toFixed(2)}T`;
  if (absolute >= 1e9) return `${sign}$${(absolute / 1e9).toFixed(2)}B`;
  if (absolute >= 1e6) return `${sign}$${(absolute / 1e6).toFixed(0)}M`;
  return formatPrice(value);
}

export function ratiosHtml(ratios) {
  if (!ratios) return "";
  const filed = ratios.fiscalYearEnd ? ` · year ended ${formatDate(ratios.fiscalYearEnd)}` : "";
  const ebitda = ratios.ebitda == null
    ? ""
    : `<div class="wide"><dt>EBITDA</dt><dd>${formatEbitda(ratios.ebitda)}</dd></div>`;
  return `<dl class="tip-ratios">
    <div><dt>ROE</dt><dd>${formatRatioPercent(ratios.roe)}</dd></div>
    <div><dt>ROA</dt><dd>${formatRatioPercent(ratios.roa)}</dd></div>
    <div><dt>ROIC</dt><dd>${formatRatioPercent(ratios.roic)}</dd></div>
    <div><dt>D/E</dt><dd>${formatDebtToEquity(ratios.debtToEquity)}</dd></div>
    ${ebitda}
  </dl>
  <p class="tip-extra">Annual ratios${filed}</p>`;
}

export function formatWeight(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}%`;
}

export function formatClock(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

const STATUS_LABEL = {
  REGULAR: "Market open",
  PRE_MKT: "Pre-market",
  POST_MKT: "After hours",
  CLOSED: "Market closed",
};

export function statusLabel(status) {
  return STATUS_LABEL[status] ?? "Quotes";
}
