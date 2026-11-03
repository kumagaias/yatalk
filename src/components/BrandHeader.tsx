import { ArrowUpRight, Leaf } from "lucide-react";
import { Link } from "react-router-dom";

export function BrandHeader({ eventName }: { eventName?: string }) {
  return (
    <header className="site-header">
      <Link className="brand" to="/" aria-label="Yatalk home">
        <span className="brand-mark" aria-hidden="true"><Leaf size={20} strokeWidth={2.4} /></span>
        <span>ya<span className="brand-accent">talk</span></span>
      </Link>
      {eventName && <div className="event-name"><span className="live-dot" aria-hidden="true" /><span>{eventName}</span><span className="open-status">Open now</span></div>}
      <Link className="organizer-link" to="/dashboard/login">Owner <ArrowUpRight size={16} aria-hidden="true" /></Link>
    </header>
  );
}
