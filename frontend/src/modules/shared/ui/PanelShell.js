import Sidebar from "./Sidebar";
import { ToastProvider } from "./Toast";
import "./panel-shell.css";
import "./ui.css";

// Frame every panel page shares: menu (left, or a bottom bar on phones) and the page area.
// .panel-content keeps pages from stretching across very wide monitors.
// ToastProvider lets any page show short "saved" messages.
export default function PanelShell({ children }) {
  return (
    <div className="panel-shell">
      <Sidebar />
      <main className="panel-main">
        <ToastProvider>
          <div className="panel-content">{children}</div>
        </ToastProvider>
      </main>
    </div>
  );
}
