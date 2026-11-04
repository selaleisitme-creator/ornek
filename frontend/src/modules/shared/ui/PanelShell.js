import Sidebar from "./Sidebar";
import "./panel-shell.css";

// Frame every panel page shares: menu (left, or a bottom bar on phones) and the page area.
// .panel-content keeps pages from stretching across very wide monitors.
export default function PanelShell({ children }) {
  return (
    <div className="panel-shell">
      <Sidebar />
      <main className="panel-main">
        <div className="panel-content">{children}</div>
      </main>
    </div>
  );
}
