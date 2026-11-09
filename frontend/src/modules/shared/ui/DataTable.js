// A plain table that becomes stacked cards on phones (the CSS reads each cell's data-label).
// columns: [{ key, label, align?, render?(row) }]. Works in server and client components alike.
export default function DataTable({ columns, rows, rowKey = "id", empty = "Kayıt yok.", caption }) {
  if (!rows?.length) return <p className="ui-table-empty">{empty}</p>;

  return (
    <div className="ui-table-wrap">
      <table className="ui-table">
        {caption && <caption className="ui-visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.align === "end" ? "ui-end" : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[rowKey]}>
              {columns.map((column) => (
                <td key={column.key} data-label={column.label} className={column.align === "end" ? "ui-end" : undefined}>
                  {column.render ? column.render(row) : (row[column.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
