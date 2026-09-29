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

export function ratiosHtml(ratios) {
  if (!ratios) return "";
  const filed = ratios.fiscalYearEnd ? ` · year ended ${formatDate(ratios.fiscalYearEnd)}` : "";
  return `<dl class="tip-ratios">
    <div><dt>ROE</dt><dd>${formatRatioPercent(ratios.roe)}</dd></div>
    <div><dt>ROA</dt><dd>${formatRatioPercent(ratios.roa)}</dd></div>
    <div><dt>ROIC</dt><dd>${formatRatioPercent(ratios.roic)}</dd></div>
    <div><dt>D/E</dt><dd>${formatDebtToEquity(ratios.debtToEquity)}</dd></div>
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
