import LogoutButton from "./LogoutButton";
import EmptyState from "./EmptyState";

// Shown instead of a page when the account is signed in but may no longer use the panel
// (for example an intern whose access end date has passed).
export default function AccessEnded() {
  return (
    <EmptyState
      title="Panel erişiminiz sona erdi"
      description="Hesabınızın erişim süresi dolmuş ya da kapatılmış. Devam etmek için klinik yöneticisiyle görüşün."
      action={<LogoutButton />}
    />
  );
}
