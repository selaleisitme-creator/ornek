import ReferralSourcePicker from "./ReferralSourcePicker";
import SourceIcon from "./SourceIcon";

// "Randevu kaynakları": where patients came from. Each patient counts once, by their first appointment that
// was not cancelled; the columns say whether that first visit happened. Which sources are
// listed is shared by everyone (referral_sources.visible), chosen with "Kaynakları seç".
export default function ReferralSources({ table }) {
  const shown = table.rows.filter((row) => row.visible);

  return (
    <section className="home-panel home-referrals" aria-labelledby="home-referrals-title">
      <div className="home-panel-head home-referrals-head">
        <div>
          <h2 id="home-referrals-title">Randevu kaynakları</h2>
          <p className="home-referrals-subtitle">Her hastanın ilk randevusu · tüm dönem</p>
        </div>
        <div className="home-referrals-actions">
          <span className="home-referrals-total">{table.shownTotal} hasta gösteriliyor</span>
          <ReferralSourcePicker sources={table.rows.map(({ id, name, visible, icon }) => ({ id, name, visible, icon }))} />
        </div>
      </div>

      {shown.length ? (
        <div className="home-referrals-wrap">
          <table className="home-referrals-table">
            <thead>
              <tr>
                <th scope="col">Kaynak</th>
                <th scope="col">Toplam</th>
                <th scope="col" className="arrived">Geldi</th>
                <th scope="col" className="missed">Gelmedi</th>
                <th scope="col" className="pending">Bekliyor</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    <span className="home-source-name">
                      <SourceIcon icon={row.icon} />
                      <b>{row.name}</b>
                    </span>
                  </th>
                  <td><b>{row.total}</b></td>
                  <td><span className="home-source-count arrived">{row.attended}</span></td>
                  <td><span className="home-source-count missed">{row.noShow}</span></td>
                  <td><span className="home-source-count pending">{row.waiting}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="home-referrals-empty">Gösterilecek kaynak seçilmemiş. &quot;Kaynakları seç&quot; ile listeye kaynak ekleyin.</p>
      )}
      <p className="home-referrals-note">Her hasta bir kez sayılır: iptal edilmemiş ilk randevusuyla. Kaynak o randevudan, boşsa hasta kaydından alınır; ikisi de boşsa hasta tabloda yer almaz.</p>
    </section>
  );
}
