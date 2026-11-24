"use client";

import { useState } from "react";
import PatientDeviceDialog from "./PatientDeviceDialog";

// "✎ Düzenle ve değiştir" in the card's "Cihaz ve takip bilgileri" section. The dialog is mounted only while open,
// so every opening starts from the card's current values.
export default function DeviceEditButton({ patient, devices, statusText }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ui-button ui-button-ghost" onClick={() => setOpen(true)}>
        ✎ Düzenle ve değiştir
      </button>
      {open && <PatientDeviceDialog patient={patient} devices={devices} statusText={statusText} onClose={() => setOpen(false)} />}
    </>
  );
}
