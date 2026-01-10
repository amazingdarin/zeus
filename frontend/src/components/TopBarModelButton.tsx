type TopBarModelButtonProps = {
  onOpen: () => void;
};

function TopBarModelButton({ onOpen }: TopBarModelButtonProps) {
  return (
    <button
      className="topbar-icon-button"
      type="button"
      onClick={onOpen}
      aria-label="Model Settings"
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M4 7h10M4 17h10M18 7h2M18 17h2M14 5v4M14 15v4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

export default TopBarModelButton;
