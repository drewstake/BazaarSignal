import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, ArrowUpRight, Bell, Bookmark, Check, ChevronRight, CircleHelp, Coins, Download, Gavel, Layers3, LayoutDashboard, Menu, Radio, Search, ShoppingBasket, SlidersHorizontal, Sparkles, TrendingUp, X, Zap } from 'lucide-react';
import { Badge, DealCards, DealDialog, DealTable, Filters, ItemIcon, MarketChart, RiskBadge, Trend } from './components';
import { compact, kits, opportunities, profit, roi, type KitId, type Opportunity, type PageId } from './data';

const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'bazaar', label: 'Bazaar flips', icon: ShoppingBasket },
  { id: 'auctions', label: 'Auction deals', icon: Gavel },
  { id: 'watchlist', label: 'Watchlist', icon: Bookmark },
  { id: 'components', label: 'UI library', icon: Layers3 },
] as const;
const titles: Record<PageId, [string, string]> = {
  overview: ['A little signal. A lot of possibility.', 'Your next opportunity is already out there. Find it here.'],
  bazaar: ['Find your next flip.', 'Compare spreads, turnover, and estimated returns in one place.'],
  auctions: ['Good items. Better prices.', 'Explore BIN listings priced below their estimated resale value.'],
  watchlist: ['Keep the good ones close.', 'A personal shortlist of opportunities worth a second look.'],
  components: ['The details make the system.', 'Reusable foundations and components for a growing BazaarSignal.'],
};
const grossSpreads = opportunities.filter(item => item.market === 'Bazaar').map(item => (item.sell - item.buy) / item.buy * 100);
const spreadRange = `${Math.min(...grossSpreads).toFixed(1)}–${Math.max(...grossSpreads).toFixed(1)}%`;
const bestAuctionReturn = `${Math.max(...opportunities.filter(item => item.market === 'Auction').map(item => roi(item))).toFixed(1)}%`;
function initialKit(): KitId { const value = new URLSearchParams(location.search).get('kit'); return value === 'ledger' || value === 'ember' ? value : 'signal'; }
function initialPage(): PageId { const value = new URLSearchParams(location.search).get('view'); return navigation.some(n => n.id === value) ? value as PageId : 'overview'; }
function initialSaved(): string[] { try { const value: unknown = JSON.parse(localStorage.getItem('bazaarsignal-ui-kits-saved') || 'null'); return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && opportunities.some(i => i.id === v)) : ['eye', 'helmet']; } catch { return ['eye', 'helmet']; } }

export default function KitGallery() {
  const [kit, setKit] = useState<KitId>(initialKit);
  const [page, setPage] = useState<PageId>(initialPage);
  const [saved, setSaved] = useState<string[]>(initialSaved);
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [query, setQuery] = useState('');
  const [risk, setRisk] = useState('all');
  const [sort, setSort] = useState('profit');
  const [toast, setToast] = useState('');
  const [menu, setMenu] = useState(false);
  const [market, setMarket] = useState('All markets');
  useEffect(() => { const url = new URL(location.href); url.searchParams.set('kit', kit); url.searchParams.set('view', page); history.replaceState(null, '', url); document.title = `${kits[kit].name} UI kit — BazaarSignal`; }, [kit, page]);
  useEffect(() => { try { localStorage.setItem('bazaarsignal-ui-kits-saved', JSON.stringify(saved)); } catch { /* Demo remains usable when storage is unavailable. */ } }, [saved]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(''), 5500); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => { const shortcut = (e: KeyboardEvent) => { if (e.key === '/' && !selected && !(e.target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable))) { const input = document.querySelector<HTMLInputElement>('input[type="search"]'); if (input) { e.preventDefault(); input.focus(); } } }; window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut); }, [selected]);
  function go(next: PageId) { setPage(next); setQuery(''); setRisk('all'); setMarket('All markets'); setMenu(false); }
  function toggle(id: string) { setSaved(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); }
  const visible = useMemo(() => opportunities.filter(item => {
    const matchesPage = page === 'bazaar' ? item.market === 'Bazaar' : page === 'auctions' ? item.market === 'Auction' : page === 'watchlist' ? saved.includes(item.id) : true;
    return matchesPage && (market === 'All markets' || item.market === market) && (risk === 'all' || risk === item.risk) && `${item.name} ${item.category}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => sort === 'price' ? a.buy - b.buy : sort === 'roi' ? roi(b) - roi(a) : profit(b) - profit(a)), [page, saved, market, risk, query, sort]);
  const dealProps = { items: visible, saved, toggle, inspect: setSelected };
  const featured = opportunities.find(item => item.id === (kit === 'ember' ? 'sword' : 'helmet'))!;
  let title = titles[page][0];
  if (page === 'overview' && kit === 'ledger') title = 'A clearer view of the market.';
  if (page === 'overview' && kit === 'ember') title = 'Less searching. More finding.';
  return <div className="kit-gallery">
    <header className="collection-bar"><div className="collection-label"><span className="collection-monogram"><Layers3 size={19} /></span><span><strong>BazaarSignal</strong><small>DESIGN COLLECTION / 01—03</small></span></div><div className="kit-picker" aria-label="Choose UI kit">{(Object.keys(kits) as KitId[]).map((id, index) => <button key={id} className={kit === id ? 'selected' : ''} aria-pressed={kit === id} onClick={() => { setKit(id); setMenu(false); }}><span className={`kit-dot ${id}`} /><span><strong>{kits[id].name}</strong><small>{kits[id].subtitle}</small></span><span className="kit-number">0{index + 1}</span></button>)}</div><span className="collection-note">INTERACTIVE CONCEPTS<small>Sample data throughout</small></span></header>
    <div className={`kit theme-${kit}`}>
      <div className="app-shell">
        <aside className={`sidebar ${menu ? 'open' : ''}`}>
          <a href="/ui-kits.html" className="brand" onClick={e => { e.preventDefault(); go('overview'); }}><span className="brand-mark"><Activity size={21} strokeWidth={2.2} /></span><span>Bazaar<span className="brand-light">Signal</span><small>THE SKYBLOCK MARKET, IN FOCUS</small></span></a>
          <div className="workspace-label"><span>YOUR WORKSPACE</span><span>01</span></div>
          <nav aria-label="Kit navigation">{navigation.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => go(id)} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined}><Icon size={18} /><span>{label}</span>{id === 'watchlist' && <span className="nav-count">{saved.length}</span>}{id === 'auctions' && <span className="new-tag">NEW</span>}{id === 'components' && <ChevronRight className="nav-arrow" size={14} />}</button>)}</nav>
          <div className="sidebar-bottom"><div className="sidebar-card"><Radio size={19} /><strong>More signal. Less noise.</strong><p>One place for your market moves.</p><button className="text-button" onClick={() => go('components')}>Explore this kit <ArrowRight size={14} /></button></div><button className="profile" onClick={() => setToast('This is a local design preview. Your saved demo items stay in this browser.')}><span className="avatar">D</span><span><strong>Your workspace</strong><small>Design preview</small></span><SlidersHorizontal size={16} /></button></div>
        </aside>
        <div className="app-body">
          <header className="app-topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={19} /> : <Menu size={19} />}</button><span>Workspace</span><ChevronRight size={13} /><strong>{navigation.find(n => n.id === page)?.label}</strong></div><div className="topbar-right"><span className="preview-status"><i className="status-dot" /> Sample market</span><span className="topbar-divider" /><button className="icon-button" aria-label="About this preview" onClick={() => setToast('All listings, trends, scores, and prices are illustrative. Try the filters, deal calculator, watchlist, and UI library.')}><CircleHelp size={18} /></button><button className="top-avatar" aria-label="Open watchlist" onClick={() => go('watchlist')}>D</button></div></header>
          <main className="main-content" id="main-content">
            <div className="page-heading"><div><span className="eyebrow">{page === 'components' ? `${kits[kit].name.toUpperCase()} / DESIGN SYSTEM` : kit === 'ember' ? 'YOUR NEXT MOVE STARTS HERE' : 'THE MARKET, AT A GLANCE'}</span><h1>{title}</h1><p>{titles[page][1]}</p></div><button className="secondary heading-action" onClick={() => page === 'components' ? exportTokens(kit, setToast) : go(page === 'watchlist' ? 'bazaar' : 'watchlist')}>{page === 'components' ? <Download size={16} /> : page === 'watchlist' ? <Search size={16} /> : <Bookmark size={16} />}{page === 'components' ? 'Export tokens' : page === 'watchlist' ? 'Find opportunities' : 'Your watchlist'}{page !== 'components' && <ArrowUpRight size={14} />}</button></div>
            {page === 'components' ? <Foundations kit={kit} notify={setToast} inspect={setSelected} /> : <>
              {page === 'overview' && <><div className="stats-grid"><Metric label="Opportunities" value={String(opportunities.length).padStart(2, '0')} hint="Across two markets" icon={<Zap size={17} />} /><Metric label="Bazaar spreads" value={spreadRange} hint="Before example fees" icon={<ShoppingBasket size={17} />} /><Metric label="Best auction return" value={bestAuctionReturn} hint="Estimated · high risk" icon={<TrendingUp size={17} />} /><Metric label="Your watchlist" value={String(saved.length).padStart(2, '0')} hint="Ideas worth following" icon={<Bookmark size={17} />} /></div>
                <div className="overview-feature"><MarketChart /><section className="spotlight"><div className="spotlight-top"><span className="eyebrow"><Sparkles size={14} /> ON YOUR RADAR</span><Badge>AUCTION</Badge></div><div className="spotlight-item"><ItemIcon item={featured} large /><div><small>{featured.rarity} / {featured.category}</small><h2>{featured.name}</h2></div></div><p>{featured.note}.</p><div className="spotlight-return"><div><small>Estimated net profit</small><strong>+{compact(profit(featured))}<span> coins</span></strong></div><Trend /></div><div className="spotlight-meta"><RiskBadge risk={featured.risk} /><span>{roi(featured).toFixed(1)}% return</span></div><button className="primary" onClick={() => setSelected(featured)}>Take a closer look <ArrowUpRight size={17} /></button></section></div>
              </>}
              {page === 'auctions' && <div className="context-strip"><Gavel size={22} /><div><strong>A deal is more than a low price.</strong><span>Compare rarity, upgrades, and recent sales before deciding.</span></div><Badge>BIN LISTINGS</Badge></div>}
              <section className={`opportunities-panel ${page === 'overview' ? 'overview-deals' : ''}`}><div className="section-heading"><div><h2>{page === 'overview' ? 'Worth a closer look' : page === 'bazaar' ? 'Bazaar opportunities' : page === 'auctions' ? 'Auction opportunities' : 'Saved opportunities'} <span className="count">{visible.length}</span></h2><p>{page === 'bazaar' ? 'Buy orders → sell offers. Estimates per item.' : page === 'auctions' ? 'Listed price → estimated resale. Estimates per item.' : 'Small signals. Potentially worthwhile moves.'}</p></div>{page === 'overview' && <button className="text-button" onClick={() => go('bazaar')}>Explore bazaar <ArrowRight size={15} /></button>}</div>
                {(page === 'overview' || page === 'watchlist') && <div className="market-tabs" aria-label="Market filter">{['All markets', 'Bazaar', 'Auction'].map(m => <button key={m} aria-pressed={market === m} onClick={() => setMarket(m)}>{m === 'Auction' ? 'Auctions' : m}</button>)}</div>}
                <Filters query={query} setQuery={setQuery} risk={risk} setRisk={setRisk} sort={sort} setSort={setSort} />
                {visible.length ? ((kit === 'ember' || page === 'auctions') ? <DealCards {...dealProps} /> : <DealTable {...dealProps} />) : <div className="empty-state"><Search size={28} /><h3>{page === 'watchlist' && !saved.length ? 'Your next find belongs here.' : 'No opportunities match.'}</h3><p>{page === 'watchlist' && !saved.length ? 'Save an item from Bazaar flips or Auction deals to start your shortlist.' : 'Try a different item name or loosen your risk filter.'}</p><button className="secondary" onClick={() => { if (page === 'watchlist' && !saved.length) go('bazaar'); else { setQuery(''); setRisk('all'); setMarket('All markets'); } }}>{page === 'watchlist' && !saved.length ? 'Explore bazaar' : 'Reset filters'}<ArrowRight size={15} /></button></div>}
                <div className="table-footer"><span>{visible.length} sample {visible.length === 1 ? 'opportunity' : 'opportunities'}</span><span>Estimates include a 1.25% example sale fee</span></div>
              </section>
            </>}
            <footer className="app-footer"><span><Activity size={13} /> BazaarSignal <span>/</span> {kits[kit].name} edition</span><span>Design preview · Illustrative data · No live trades or emails</span></footer>
          </main>
        </div>
      </div>
      <DealDialog item={selected} close={() => setSelected(null)} saved={saved} toggle={toggle} notify={setToast} />
      {toast && <div className="toast" role="status"><Check size={17} /><span>{toast}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setToast('')}><X size={16} /></button></div>}
    </div>
  </div>;
}
function Metric({ label, value, hint, icon }: { label: string; value: string; hint: string; icon: React.ReactNode }) {
  return <div className="metric"><div><span>{label}</span>{icon}</div><strong>{value}</strong><small>{hint}</small></div>;
}
function exportTokens(kit: KitId, notify: (text: string) => void) {
  const data = kits[kit];
  const css = `/* BazaarSignal / ${data.name} UI kit. Illustrative design tokens. */\n:root {\n  --bg: ${data.colors[0]};\n  --surface: ${data.colors[1]};\n  --line: ${data.colors[2]};\n  --accent: ${data.colors[3]};\n  --text: ${data.colors[4]};\n  --font-body: '${kit === 'ember' ? 'Space Grotesk' : 'DM Sans'}', system-ui, sans-serif;\n  --font-heading: ${kit === 'ledger' ? "Georgia, serif" : 'var(--font-body)'};\n  --radius: ${data.radius};\n  --space-1: 4px;\n  --space-2: 8px;\n  --space-3: 12px;\n  --space-4: 16px;\n  --space-6: 24px;\n  --space-8: 32px;\n}\n`;
  const href = URL.createObjectURL(new Blob([css], { type: 'text/css' }));
  const link = document.createElement('a'); link.href = href; link.download = `bazaarsignal-${kit}-tokens.css`; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000); notify(`${data.name} design tokens exported.`);
}
function Foundations({ kit, notify, inspect }: { kit: KitId; notify: (text: string) => void; inspect: (item: Opportunity) => void }) {
  const [tab, setTab] = useState('Buy orders');
  const [enabled, setEnabled] = useState(true);
  const [name, setName] = useState('Summoning Eye');
  const [amount, setAmount] = useState('1000000');
  return <div className="foundations">
    <section className="foundation-intro"><div><span className="eyebrow">0{Object.keys(kits).indexOf(kit) + 1} / {kits[kit].subtitle.toUpperCase()}</span><h2>{kits[kit].name}</h2><p>{kits[kit].description}</p></div><div className="foundation-spec"><span>TYPEFACE<strong>{kits[kit].font}</strong></span><span>CORNER RADIUS<strong>{kits[kit].radius}</strong></span><span>SPACING<strong>4 / 8 / 12 / 16 / 24 / 32</strong></span></div></section>
    <section className="panel swatch-panel"><div className="panel-heading"><h2>01 / Color foundations</h2><span className="muted">Semantic, reusable tokens</span></div><div className="swatches">{kits[kit].colors.map((color, index) => <div className="swatch" key={color}><div style={{ background: color }} /><strong>{['Canvas', 'Surface', 'Border', 'Accent', 'Text'][index]}</strong><code>{color}</code></div>)}</div></section>
    <div className="foundation-grid"><section className="panel type-panel"><h2>02 / Typography</h2><span className="eyebrow">DISPLAY / {kit === 'ledger' ? 'GEORGIA' : kits[kit].font.toUpperCase()}</span><h3 className="display-sample">Find your edge.</h3><div className="type-row"><strong>Market opportunities</strong><small>Section / 20</small></div><div className="type-row"><span>A clearer picture of every trade.</span><small>Body / 14</small></div><div className="type-row numeric"><strong>1,248,500.00</strong><small>Tabular figures</small></div><p className="helper">Use tabular figures for prices. Keep secondary labels quiet and key returns prominent.</p></section>
      <section className="panel buttons-panel"><h2>03 / Actions & navigation</h2><div className="component-row"><button className="primary" onClick={() => inspect(opportunities[0])}>Inspect deal <ArrowUpRight size={15} /></button><button className="secondary" onClick={() => notify('Secondary action preview. Use this style for supporting actions.')}><Bookmark size={15} />Watch item</button><button className="secondary" disabled>Unavailable</button></div><div className="component-row"><button className="text-button" onClick={() => notify('Text action preview. Use this style for low emphasis actions.')}>View all items <ArrowRight size={15} /></button><button className="icon-button" aria-label="Preview notification action" onClick={() => notify('Notification control preview. No email will be sent.')}><Bell size={18} /></button></div><div className="segmented component-tabs" aria-label="Sample order side">{['Buy orders', 'Sell offers'].map(value => <button key={value} aria-pressed={value === tab} onClick={() => setTab(value)}>{value}</button>)}</div><div className="sample-book"><span>{tab === 'Buy orders' ? 'Top buy order' : 'Lowest sell offer'}</span><strong>{tab === 'Buy orders' ? '202,900' : '211,500'} <small>coins</small></strong></div></section>
      <section className="panel"><h2>04 / Inputs & controls</h2><form className="demo-form" onSubmit={e => { e.preventDefault(); notify(`Demo ${enabled ? 'alert' : 'draft'} for ${name}: ${Number(amount).toLocaleString()} coins. No email will be sent.`); }}><label>Item name<div className="input-with-icon"><Search size={16} /><input required value={name} onChange={e => setName(e.target.value)} /></div></label><div className="input-pair"><label>Target price<input type="number" min="1" required value={amount} onChange={e => setAmount(e.target.value)} /></label><label>Market<select defaultValue="Bazaar"><option>Bazaar</option><option>Auction</option></select></label></div><label className="switch-row"><span>Price notification<small>Preview state only</small></span><input type="checkbox" role="switch" checked={enabled} onChange={e => setEnabled(e.target.checked)} /></label><button className="primary" type="submit">{enabled ? 'Preview alert' : 'Preview draft'}<ArrowRight size={15} /></button></form></section>
      <section className="panel"><h2>05 / Status & feedback</h2><div className="component-row"><RiskBadge risk="Low" /><RiskBadge risk="Medium" /><RiskBadge risk="High" /></div><div className="component-row"><Badge tone="low"><Check size={12} />Saved</Badge><Badge><Radio size={12} />Watching</Badge><Badge tone="high">Expired</Badge></div><div className="feedback success"><Check size={18} /><span><strong>Added to your watchlist</strong><small>You can find this item in your saved opportunities.</small></span></div><div className="feedback warning"><CircleHelp size={18} /><span><strong>Not enough comparable sales</strong><small>Review manually before relying on this estimate.</small></span></div><div className="feedback"><Activity size={18} /><span><strong>Refreshing market data</strong><small>Loading state for the future live experience.</small></span><span className="loading-dots" aria-hidden="true">•••</span></div></section>
    </div>
    <section className="panel"><div className="panel-heading"><h2>06 / Opportunity card</h2><span className="muted">Composable item, value, and action</span></div><DealCards items={[opportunities[0], opportunities[5], opportunities[6]]} saved={[]} toggle={() => notify('Watchlist button preview. Save real demo items from a market screen.')} inspect={inspect} /></section>
  </div>;
}
