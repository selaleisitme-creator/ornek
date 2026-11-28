"use client";

import { Fragment, useState } from "react";
import { formatMoney } from "@/lib/money";

function display(row, key) {
  return key === "amount" || key === "running_total" ? formatMoney(row[key]) : row[key] || "—";
}

export default function LedgerTable({ columns, rows }) {
  const [expanded, setExpanded] = useState(null);

  function toggle(id) {
    setExpanded((current) => current === id ? null : id);
  }

  return <div className="table-wrap ledger-compact">
    <table>
      <thead><tr>{columns.map(([key, label]) => <th key={key} scope="col" title={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map((row) => {
        const id = row.source + "-" + row.source_id;
        const open = expanded === id;

        return <Fragment key={id}>
          <tr onDoubleClick={() => toggle(id)}>
            {columns.map(([key]) => <td key={key} title={String(display(row, key))}>
              {key === "income_expense"
                ? <button type="button" onClick={() => toggle(id)}
                    onDoubleClick={(event) => event.stopPropagation()} aria-expanded={open}
                    aria-label={open ? "Kayıt ayrıntılarını kapat" : "Kayıt ayrıntılarını aç"}>
                    {display(row, key)}
                  </button>
                : display(row, key)}
            </td>)}
          </tr>
          {open && <tr className="ledger-detail"><td colSpan={columns.length}>
            <dl>{columns.map(([key, label]) => <div key={key}>
              <dt>{label}</dt><dd>{display(row, key)}</dd>
            </div>)}</dl>
          </td></tr>}
        </Fragment>;
      })}</tbody>
    </table>
  </div>;
}