import { Link } from "react-router-dom";

const navItems = [
  { label: "Knowledge Base", to: "/" },
  { label: "Uploads" },
  { label: "Classification" },
  { label: "Modules" },
  { label: "Audit Log" },
];

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-title">Workspace</div>
      <nav className="sidebar-nav">
        {navItems.map((item, index) => {
          if (item.to) {
            return (
              <Link
                key={item.label}
                className={`sidebar-link${index === 0 ? " active" : ""}`}
                to={item.to}
              >
                {item.label}
              </Link>
            );
          }

          return (
            <button
              key={item.label}
              className={`sidebar-link${index === 0 ? " active" : ""}`}
              type="button"
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

export default Sidebar;
