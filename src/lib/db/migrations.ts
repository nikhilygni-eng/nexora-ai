export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  business_email TEXT,
  default_currency TEXT NOT NULL DEFAULT 'USD',
  default_tax_name TEXT NOT NULL DEFAULT 'Tax',
  default_tax_milli INTEGER NOT NULL DEFAULT 0,
  default_terms_days INTEGER NOT NULL DEFAULT 14,
  created_at TEXT NOT NULL
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  company TEXT,
  email TEXT NOT NULL,
  country TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  UNIQUE (org_id, email)
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  client_id TEXT REFERENCES clients(id),
  source TEXT NOT NULL CHECK (source IN ('demo','paypal_sandbox','mock_paypal')),
  status TEXT NOT NULL,
  paypal_invoice_id TEXT UNIQUE,
  paypal_status TEXT,
  invoice_number TEXT,
  client_name TEXT NOT NULL,
  client_email TEXT NOT NULL,
  currency TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  total_minor INTEGER NOT NULL,
  paid_minor INTEGER NOT NULL DEFAULT 0,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  note TEXT,
  items_json TEXT NOT NULL,
  recipient_view_url TEXT,
  proposal_id TEXT,
  sent_at TEXT,
  paid_at TEXT,
  last_reminded_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_invoices_org ON invoices(org_id, status);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  conversation_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('create_and_send_invoice','send_reminder')),
  status TEXT NOT NULL CHECK (status IN ('pending_approval','executing','executed','failed','cancelled')),
  payload_json TEXT NOT NULL,
  invoice_id TEXT REFERENCES invoices(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  result_json TEXT,
  error TEXT,
  created_by TEXT NOT NULL DEFAULT 'ai',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  executed_at TEXT
);
CREATE INDEX idx_proposals_org ON proposals(org_id, status);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user','ai','system','paypal')),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  paypal_endpoint TEXT,
  http_status INTEGER,
  debug_id TEXT,
  paypal_invoice_id TEXT,
  details_json TEXT
);
CREATE INDEX idx_audit_org ON audit_log(org_id, at);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_id TEXT,
  verified INTEGER NOT NULL,
  received_at TEXT NOT NULL
);
`,
  },
];
