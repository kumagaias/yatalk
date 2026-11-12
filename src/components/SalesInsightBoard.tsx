import { AlertTriangle, Lightbulb, PackageCheck, TrendingUp } from "lucide-react";
import type { CurrencyCode } from "../../shared/currency.js";
import { dashboardRecommendations, salesForecast, stockProjection, type InsightItem, type SalesTrendPoint } from "../lib/dashboardInsights";

type Props = {
  currency: CurrencyCode;
  salesTrend: SalesTrendPoint[];
  items: InsightItem[];
};

function money(value: number, currency: CurrencyCode): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`));
}

function linePath(values: number[]): string {
  const highest = Math.max(...values, 1);
  const width = 260;
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = 82 - (value / highest) * 66;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function LineChart({ values, labels, color }: { values: number[]; labels: string[]; color: string }) {
  return <div className="insight-line-chart" role="img" aria-label={`${labels.map((label, index) => `${label}: ${Math.round(values[index] ?? 0)}`).join(", ")}`}>
    <svg viewBox="0 0 260 108" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="82" x2="260" y2="82" className="insight-grid-line" />
      <path d={linePath(values)} style={{ stroke: color }} />
      {values.map((value, index) => {
        const highest = Math.max(...values, 1);
        const x = values.length === 1 ? 130 : (index / (values.length - 1)) * 260;
        const y = 82 - (value / highest) * 66;
        return <circle key={labels[index]} cx={x} cy={y} r="3.2" style={{ fill: color }} />;
      })}
    </svg>
    <div className="insight-axis-labels"><span>{labels[0]}</span><span>{labels.at(-1)}</span></div>
  </div>;
}

export function SalesInsightBoard({ currency, salesTrend, items }: Props) {
  const forecast = salesForecast(salesTrend);
  const stock = stockProjection(items);
  const recommendations = dashboardRecommendations(items);

  return <section className="sales-insight-board" aria-labelledby="decision-board-heading">
    <div className="sales-insight-heading">
      <div><p className="eyebrow">DECISION BOARD</p><h3 id="decision-board-heading"><Lightbulb size={20} aria-hidden="true" />What to do next</h3></div>
      <p>Built from captured sales and current stock. Forecasts are estimates, not guarantees.</p>
    </div>
    <div className="sales-insight-grid">
      <article className="insight-panel insight-sales-panel">
        <span className="insight-icon"><TrendingUp size={19} aria-hidden="true" /></span>
        <p>Tomorrow’s sales estimate</p>
        <strong>{forecast === null ? "—" : money(forecast, currency)}</strong>
        <small>{forecast === null ? "Available after recorded sales" : "Based on the average net sales of the last 7 days"}</small>
      </article>
      <article className="insight-panel insight-chart-panel">
        <div><p>Daily net sales</p><small>Last 7 days</small></div>
        <LineChart values={salesTrend.map(({ netSales }) => netSales)} labels={salesTrend.map(({ date }) => dateLabel(date))} color="#2d7665" />
      </article>
      <article className="insight-panel insight-chart-panel">
        <div><p>{stock ? `${stock.itemName} stock outlook` : "Stock outlook"}</p><small>{stock?.daysOfCover === null || !stock ? "Available after sales are recorded" : `Projected from current stock and 7-day demand`}</small></div>
        {stock ? <LineChart values={stock.projectedAvailable} labels={stock.projectedAvailable.map((_, index) => index === 0 ? "Today" : `Day ${index}`)} color="#c96c32" /> : <div className="insight-empty-chart">No demand signal yet</div>}
      </article>
    </div>
    <div className="insight-recommendations">
      <div><p className="eyebrow">PREP RECOMMENDATIONS</p><h4>Keep service moving</h4></div>
      <div className="recommendation-list">
        {recommendations.map((recommendation) => <article key={recommendation.title} className={`recommendation recommendation-${recommendation.tone}`}>
          {recommendation.tone === "urgent" ? <AlertTriangle size={17} aria-hidden="true" /> : <PackageCheck size={17} aria-hidden="true" />}
          <span><strong>{recommendation.title}</strong><small>{recommendation.detail}</small></span>
        </article>)}
      </div>
    </div>
  </section>;
}
