import { Link } from "react-router-dom";

type SidebarItem = {
  label: string;
  to?: string;
};

type SidebarProps = {
  items: SidebarItem[];
  activeIndex?: number;
};

function Sidebar({ items, activeIndex = 0 }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-title">Workspace</div>
      <nav className="sidebar-nav">
        {items.map((item, index) => {
          const className = `sidebar-link${
            index === activeIndex ? " active" : ""
          }`;

          if (item.to) {
            return (
              <Link key={item.label} className={className} to={item.to}>
                {item.label}
              </Link>
            );
          }

          return (
            <button key={item.label} className={className} type="button">
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

export default Sidebar;
