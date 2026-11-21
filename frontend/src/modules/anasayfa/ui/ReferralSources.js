import ReferralSourcePicker from "./ReferralSourcePicker";

// "Randevu kaynakları": where appointments came from, all time, cancelled ones left out. Which sources are
// listed is shared by everyone (referral_sources.visible), chosen with "Kaynakları seç".
export default function ReferralSources({ table }) {
  const shown = table.rows.filter((row) => row.visible);

  return (
    <section className="home-panel home-referrals" aria-labelledby="home-referrals-title">
      <div className="home-panel-head home-referrals-head">
        <div>
          <h2 id="home-referrals-title">Randevu kaynakları</h2>
          <p className="home-referrals-subtitle">Tüm dönem · iptal edilenler hariç</p>
        </div>
        <div className="home-referrals-actions">
          <span className="home-referrals-total">{table.shownTotal} randevu gösteriliyor</span>
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
      <p className="home-referrals-note">Sayılar randevu kayıtlarındaki kaynaktan gelir; kaynağı boş randevular tabloda yer almaz.</p>
    </section>
  );
}

export function SourceIcon({ icon }) {
  return (
    <span className={`home-source-icon ${icon.tone}`} aria-hidden="true">
      {icon.mark}
    </span>
  );
}
