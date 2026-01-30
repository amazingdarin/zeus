import type { ReactNode } from "react";

/**
 * Settings menu item definition
 */
export type SettingsMenuItem = {
  key: string;
  label: string;
  icon: ReactNode;
};

type SettingsMenuProps = {
  items: SettingsMenuItem[];
  activeKey: string;
  onSelect: (key: string) => void;
};

/**
 * Settings left sidebar menu
 */
function SettingsMenu({ items, activeKey, onSelect }: SettingsMenuProps) {
  return (
    <nav className="settings-menu">
      <div className="settings-menu-title">设置</div>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`settings-menu-item${item.key === activeKey ? " active" : ""}`}
          onClick={() => onSelect(item.key)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default SettingsMenu;
