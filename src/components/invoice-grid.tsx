"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams, type ValueFormatterParams } from "ag-grid-community";
import type { InvoiceDTO } from "@/lib/views";
import { fmtDate, fmtMoney } from "@/lib/client";
import { Input, SourceBadge, StatusBadge } from "./ui";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  foregroundColor: "#0f2a44",
  backgroundColor: "#ffffff",
  headerBackgroundColor: "#f4f6f9",
  headerTextColor: "#344b66",
  borderColor: "#d8dfe8",
  rowHoverColor: "#f4f6f9",
  selectedRowBackgroundColor: "#e3e8fb",
  accentColor: "#2442c9",
  wrapperBorderRadius: 14,
  headerFontWeight: 600,
  rowHeight: 48,
  headerHeight: 44,
  spacing: 7,
});

type Row = InvoiceDTO & { days_late: number };

export function InvoiceGrid({ invoices }: { invoices: InvoiceDTO[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const rows: Row[] = useMemo(
    () =>
      invoices.map((r) => ({
        ...r,
        days_late: r.status === "overdue" ? Math.round((Date.parse(today) - Date.parse(r.due_date)) / 86400000) : 0,
      })),
    [invoices, today],
  );
  const money = (p: ValueFormatterParams<Row, number>) => (p.data && p.value != null ? fmtMoney(p.value, p.data.currency) : "");
  const cols = useMemo<ColDef<Row>[]>(
    () => [
      { field: "invoice_number", headerName: "Invoice", minWidth: 120, valueGetter: (p) => p.data?.invoice_number ?? p.data?.paypal_invoice_id ?? "—" },
      { field: "client_name", headerName: "Client", flex: 1.4, minWidth: 160 },
      {
        field: "source",
        headerName: "Source",
        minWidth: 150,
        cellRenderer: (p: ICellRendererParams<Row>) => (p.data ? <SourceBadge source={p.data.source} paypalId={p.data.paypal_invoice_id} /> : null),
        filter: "agTextColumnFilter",
      },
      { field: "status", headerName: "Status", minWidth: 140, cellRenderer: (p: ICellRendererParams<Row>) => (p.value ? <StatusBadge status={p.value} /> : null) },
      { field: "issue_date", headerName: "Issued", minWidth: 120, valueFormatter: (p) => fmtDate(p.value), sort: "desc" },
      { field: "due_date", headerName: "Due", minWidth: 120, valueFormatter: (p) => fmtDate(p.value) },
      { field: "total_minor", headerName: "Total", minWidth: 120, type: "rightAligned", valueFormatter: money, cellClass: "num", filter: "agNumberColumnFilter" },
      { field: "outstanding_minor", headerName: "Outstanding", minWidth: 130, type: "rightAligned", valueFormatter: money, cellClass: "num", filter: "agNumberColumnFilter" },
      { field: "days_late", headerName: "Late", minWidth: 80, type: "rightAligned", cellClass: "num", valueFormatter: (p) => (p.value ? String(p.value) : "—") },
      { field: "currency", headerName: "Cur.", minWidth: 72, maxWidth: 84 },
    ],
    [],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor="grid-q" className="sr-only">
          Search invoices
        </label>
        <Input id="grid-q" placeholder="Search client, number, status…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <p className="text-xs text-ink-3">Sort, filter and resize columns. Click a row to open it.</p>
      </div>
      <div style={{ height: Math.min(560, 46 + Math.max(rows.length, 4) * 48 + 2) }}>
        <AgGridReact<Row>
          theme={theme}
          rowData={rows}
          columnDefs={cols}
          defaultColDef={{ sortable: true, filter: true, resizable: true, flex: 1 }}
          quickFilterText={q}
          autoSizeStrategy={{ type: "fitGridWidth", defaultMinWidth: 90 }}
          getRowId={(p) => p.data.id}
          onRowClicked={(e) => e.data && router.push(`/app/invoices/${e.data.id}`)}
          rowStyle={{ cursor: "pointer" }}
          animateRows
          overlayNoRowsTemplate="<span style='color:#5b6f86'>No invoices to show</span>"
        />
      </div>
    </div>
  );
}
