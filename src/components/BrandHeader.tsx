import { ArrowLeft, ArrowUpRight, Leaf, Menu, Store } from "lucide-react";
import { Link } from "react-router-dom";

export function BrandHeader({ eventName, counterPath, counterMode = false, shopperMode = false, menuOpen = false, onMenuOpen }: {
  eventName?: string; counterPath?: string; counterMode?: boolean; shopperMode?: boolean; menuOpen?: boolean; onMenuOpen?: () => void;
}) {
  if (shopperMode) return <header className="site-header shopper-header"><span>{eventName}</span>{onMenuOpen && <button className="shopper-menu-button" type="button" aria-label="Open menu" aria-expanded={menuOpen} onClick={onMenuOpen}><Menu size={23} aria-hidden="true" /></button>}</header>;
  return (
    <header className="site-header">
      <Link className="brand" to="/" aria-label="Yatalk home">
        <span className="brand-mark" aria-hidden="true"><Leaf size={20} strokeWidth={2.4} /></span>
        <span>ya<span className="brand-accent">talk</span></span>
      </Link>
      {eventName && <div className="event-name"><span className="live-dot" aria-hidden="true" /><span>{eventName}</span><span className="open-status">Open now</span></div>}
      <nav className="header-actions" aria-label="Shop navigation">
        {counterPath && <Link className="counter-link" to={counterPath} aria-label={counterMode ? "Open customer view" : "Open counter screen"}>
          {counterMode ? <ArrowLeft size={16} aria-hidden="true" /> : <Store size={16} aria-hidden="true" />}
          <span>{counterMode ? "Customer" : "Counter"}</span>
        </Link>}
        <Link className="organizer-link" to="/dashboard/login"><span>Owner</span><ArrowUpRight size={16} aria-hidden="true" /></Link>
      </nav>
    </header>
  );
}
