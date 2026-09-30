import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Bell, Bookmark, Check, ChevronDown, CircleHelp, Cookie, Eye, Flame, Gem, HardHat, Package, Search, SlidersHorizontal, Sparkles, Sword, WandSparkles, X } from 'lucide-react';
import { compact, DEFAULT_FEE, number, profit, roi, type Opportunity, type Risk } from './data';

const itemIcons = { gem: Gem, eye: Eye, flame: Flame, cookie: Cookie, sword: Sword, helmet: HardHat, wand: WandSparkles, box: Package };
export function ItemIcon({ item, large = false }: { item: Opportunity; large?: boolean }) {
  const Icon = itemIcons[item.icon];
  return <span className={`item-art ${item.tone} ${large ? 'large' : ''}`}><Icon size={large ? 40 : 22} strokeWidth={1.5} aria-hidden="true" /></span>;
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function RiskBadge({ risk }: { risk: Risk }) { return <Badge tone={risk.toLowerCase()}>{risk} risk</Badge>; }
export function SaveButton({ item, saved, toggle }: { item: Opportunity; saved: string[]; toggle: (id: string) => void }) {
  return <button className={`icon-button save-button ${saved.includes(item.id) ? 'is-saved' : ''}`} aria-label={`${saved.includes(item.id) ? 'Unsave' : 'Save'} ${item.name}`} aria-pressed={saved.includes(item.id)} onClick={() => toggle(item.id)}><Bookmark size={17} fill={saved.includes(item.id) ? 'currentColor' : 'none'} /></button>;
}
export function Trend({ seed = 0 }: { seed?: number }) {
  const paths = ['0,27 9,23 18,25 27,14 36,19 45,13 54,16 63,5 72,10 81,3', '0,28 9,24 18,17 27,22 36,11 45,17 54,9 63,12 72,5 81,3', '0,26 9,28 18,19 27,21 36,13 45,16 54,10 63,14 72,8 81,2'];
  return <svg className="sparkline" viewBox="0 0 82 32" role="img" aria-label="Illustrative upward price trend"><polyline points={paths[seed % paths.length]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>;
}
export function MarketChart() {
  const [period, setPeriod] = useState('24H');
  const series: Record<string, number[]> = {
    '24H': [44, 41, 44, 39, 43, 37, 34, 38, 31, 33, 25, 29, 21, 27, 20, 16, 21, 16, 18, 10, 12, 5, 9, 4],
    '7D': [46, 41, 44, 32, 35, 30, 39, 35, 36, 28, 33, 25, 29, 31, 26, 28, 17, 22, 16, 17, 12, 16, 7, 4],
    '30D': [49, 45, 47, 40, 38, 35, 28, 31, 34, 37, 31, 33, 22, 25, 20, 22, 14, 21, 16, 8, 13, 6, 8, 4],
  };
  const points = series[period].map((v, i) => `${(i / 23) * 600},${20 + v * 2.6}`).join(' ');
  const labels = period === '24H' ? ['00:00', '06:00', '12:00', '18:00', '24:00'] : period === '7D' ? ['Mon', 'Tue', 'Thu', 'Sat', 'Sun'] : ['Day 1', 'Day 8', 'Day 15', 'Day 22', 'Day 30'];
  return <section className="panel chart-panel">
    <div className="panel-heading"><div><span className="eyebrow">MARKET PULSE</span><h2>Bazaar activity</h2></div><div className="segmented" aria-label="Chart period">{Object.keys(series).map(p => <button key={p} aria-pressed={p === period} onClick={() => setPeriod(p)}>{p}</button>)}</div></div>
    <div className="chart-summary"><strong>{period === '24H' ? '18.42B' : period === '7D' ? '126.8B' : '548.2B'} <small>coins traded</small></strong><Badge tone="low"><ArrowUpRight size={12} />{period === '24H' ? '12.8' : period === '7D' ? '8.6' : '16.4'}%</Badge></div>
    <div className="chart-wrap"><div className="chart-y"><span>20B</span><span>15B</span><span>10B</span></div><svg viewBox="0 0 600 180" preserveAspectRatio="none" className="market-chart" role="img" aria-label={`${period} illustrative trading activity, trending upward. Sample data.`}>
      <defs><linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
      {[30, 90, 150].map(y => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="var(--line)" strokeDasharray="3 6" />)}
      <polygon points={`0,180 ${points} 600,180`} fill="url(#activity-fill)" /><polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="2.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg></div><div className="chart-x">{labels.map(l => <span key={l}>{l}</span>)}</div>
    <div className="chart-caption"><span><i className="status-dot" /> Illustrative volume</span><span>Compared with previous period</span></div>
  </section>;
}
type DealProps = { items: Opportunity[]; saved: string[]; toggle: (id: string) => void; inspect: (item: Opportunity) => void };
export function DealTable({ items, saved, toggle, inspect }: DealProps) {
  return <div className="table-scroll"><table className="deal-table"><caption className="sr-only">Sample market opportunities. Estimated profit per item after a 1.25% example fee.</caption><thead><tr><th>Item</th><th>Buy price</th><th>Est. net profit <ArrowDown size={12} /></th><th>ROI</th><th>Risk</th><th>Trend</th><th><span className="sr-only">Watchlist</span></th></tr></thead><tbody>{items.map((item, index) => <tr key={item.id}>
    <td><button className="item-link" onClick={() => inspect(item)}><ItemIcon item={item} /><span><strong>{item.name}</strong><small>{item.market} <span>·</span> {item.category}</small></span></button></td><td className="numeric">{compact(item.buy)}<small>coins / item</small></td><td className="numeric positive">+{compact(profit(item))}<small>{number(item.volume)} {item.market === 'Auction' ? 'sales' : 'units'} / day</small></td><td className="numeric">{roi(item).toFixed(1)}%</td><td><RiskBadge risk={item.risk} /></td><td><Trend seed={index} /></td><td><SaveButton item={item} saved={saved} toggle={toggle} /></td>
  </tr>)}</tbody></table></div>;
}
export function DealCards({ items, saved, toggle, inspect }: DealProps) {
  return <div className="deal-grid">{items.map(item => <article className="deal-card" key={item.id}>
    <div className="card-top"><Badge>{item.market === 'Auction' ? 'BIN AUCTION' : 'BAZAAR FLIP'}</Badge><SaveButton item={item} saved={saved} toggle={toggle} /></div>
    <div className="card-item"><ItemIcon item={item} large /><span><small className={item.tone}>{item.rarity}</small><h3>{item.name}</h3><span className="muted">{item.category}</span></span></div>
    <div className="card-prices"><div><small>{item.market === 'Auction' ? 'Listed price' : 'Buy order'}</small><strong>{compact(item.buy)}</strong></div><ArrowRight size={17} /><div><small>Est. resale</small><strong>{compact(item.sell)}</strong></div></div>
    <div className="card-profit"><span>Est. net profit<strong>+{compact(profit(item))} <small>coins</small></strong></span><Badge tone="low">{roi(item).toFixed(1)}% ROI</Badge></div>
    <div className="card-bottom"><RiskBadge risk={item.risk} /><button className="text-button" onClick={() => inspect(item)}>Inspect deal <ArrowUpRight size={16} /></button></div>
  </article>)}</div>;
}
export function Filters({ query, setQuery, risk, setRisk, sort, setSort }: { query: string; setQuery: (value: string) => void; risk: string; setRisk: (value: string) => void; sort: string; setSort: (value: string) => void }) {
  return <div className="filters"><label className="search-field"><Search size={17} /><input type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search opportunities" placeholder="Find an item or category…" /><kbd>/</kbd></label><div className="filter-select"><SlidersHorizontal size={15} /><select aria-label="Filter by risk" value={risk} onChange={e => setRisk(e.target.value)}><option value="all">All risk levels</option><option value="Low">Low risk</option><option value="Medium">Medium risk</option><option value="High">High risk</option></select><ChevronDown size={13} /></div><div className="filter-select"><select aria-label="Sort opportunities" value={sort} onChange={e => setSort(e.target.value)}><option value="profit">Highest profit</option><option value="roi">Highest ROI</option><option value="price">Lowest buy price</option></select><ChevronDown size={13} /></div></div>;
}
export function DealDialog({ item, close, saved, toggle, notify }: { item: Opportunity | null; close: () => void; saved: string[]; toggle: (id: string) => void; notify: (text: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [quantity, setQuantity] = useState('1');
  const [fee, setFee] = useState(String(DEFAULT_FEE));
  const [alert, setAlert] = useState(false);
  const [target, setTarget] = useState('');
  useEffect(() => { if (item) { setQuantity('1'); setFee(String(DEFAULT_FEE)); setAlert(false); setTarget(String(Math.round(item.buy * .95))); dialog.current?.showModal(); } else dialog.current?.close(); }, [item]);
  const valid = Number(quantity) >= 1 && Number.isInteger(Number(quantity)) && Number(quantity) <= 100000 && fee !== '' && Number(fee) >= 0 && Number(fee) <= 100;
  return <dialog ref={dialog} className="deal-dialog" onCancel={close} onClick={e => { const bounds = e.currentTarget.getBoundingClientRect(); if (e.target === e.currentTarget && (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom)) close(); }} aria-labelledby="deal-title">
    {item && <><div className="dialog-top"><Badge>DEAL INSPECTOR · SAMPLE</Badge><button className="icon-button" autoFocus aria-label="Close deal" onClick={close}><X size={20} /></button></div><div className="dialog-item"><ItemIcon item={item} large /><div><span className="eyebrow">{item.market} / {item.rarity}</span><h2 id="deal-title">{item.name}</h2><RiskBadge risk={item.risk} /></div></div>
      <p className="deal-note">{item.note}. All prices and confidence scores in this kit are illustrative.</p>
      <div className="detail-prices"><div><small>Buy price / item</small><strong>{number(item.buy)}</strong></div><div><small>Est. resale / item</small><strong>{number(item.sell)}</strong></div></div>
      <div className="calculator"><div className="panel-heading"><h3>Plan your flip</h3><Badge>COINS</Badge></div><div className="input-pair"><label>Quantity<input aria-label="Flip quantity" type="number" min="1" max="100000" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} /></label><label>Example sale fee (%)<input aria-label="Example sale fee" type="number" min="0" max="100" step=".01" value={fee} onChange={e => setFee(e.target.value)} /></label></div>
        {valid ? <><div className="calc-row"><span>Capital needed</span><strong>{number(item.buy * Number(quantity))}</strong></div><div className="calc-row"><span>Estimated sale fee</span><strong>−{number(item.sell * Number(quantity) * Number(fee) / 100)}</strong></div><div className="calc-total"><span>Estimated net profit</span><strong className={profit(item, Number(fee)) >= 0 ? 'positive' : 'negative'}>{profit(item, Number(fee)) >= 0 ? '+' : ''}{number(profit(item, Number(fee), Number(quantity)))}</strong></div></> : <p className="negative" role="alert">Use a whole quantity from 1–100,000 and a fee from 0–100%.</p>}
        <small className="helper">Resale × quantity − fee − purchase cost. Example fee only; fill time, slippage, and additional costs are excluded.</small>
      </div>
      <div className="confidence"><span><Sparkles size={15} /> Sample confidence</span><strong>{item.confidence}/100</strong><progress value={item.confidence} max="100" aria-label="Illustrative confidence score" /></div>
      <div className="dialog-actions"><button className="primary" onClick={() => toggle(item.id)}>{saved.includes(item.id) ? <Check size={16} /> : <Bookmark size={16} />}{saved.includes(item.id) ? 'Saved to watchlist' : 'Save to watchlist'}</button><button className="secondary" onClick={() => setAlert(!alert)}><Bell size={16} />Preview alert</button></div>
      {alert && <form className="alert-preview" onSubmit={e => { e.preventDefault(); notify(`Demo alert set for ${item.name} at ${number(Number(target))} coins. No email will be sent.`); setAlert(false); close(); }}><label>Notify when buy price falls below<input type="number" min="1" max="99999999999" step="1" required value={target} onChange={e => setTarget(e.target.value)} /></label><button className="primary" type="submit">Set demo alert <ArrowRight size={15} /></button><small>Preview only · no notifications are sent.</small></form>}
      <p className="dialog-foot"><CircleHelp size={13} /> Illustrative opportunity. Review item attributes and liquidity.</p></>}
  </dialog>;
}
