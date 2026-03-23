insert into app.providers (id, display_name, auth_kind, supports_personal, supports_workspace, metadata)
values
  ('airtable', 'Airtable', 'oauth2', true, true, jsonb_build_object('category', 'productivity')),
  ('zoom', 'Zoom', 'oauth2', true, true, jsonb_build_object('category', 'productivity')),
  ('quickbooks', 'QuickBooks Online', 'oauth2', true, true, jsonb_build_object('category', 'finance')),
  ('xero', 'Xero', 'oauth2', true, true, jsonb_build_object('category', 'finance'))
on conflict (id) do update
set
  display_name = excluded.display_name,
  auth_kind = excluded.auth_kind,
  supports_personal = excluded.supports_personal,
  supports_workspace = excluded.supports_workspace,
  metadata = excluded.metadata,
  updated_at = now();

insert into app.provider_scopes (provider_id, scope, description)
values
  ('airtable', 'data.records:read', 'Read Airtable records'),
  ('airtable', 'data.records:write', 'Create and update Airtable records'),
  ('airtable', 'schema.bases:read', 'Read Airtable bases and table schema'),
  ('airtable', 'schema.bases:write', 'Create and update Airtable table schema'),
  ('zoom', 'user:read', 'Read Zoom user profile metadata'),
  ('zoom', 'meeting:read', 'Read Zoom meetings'),
  ('zoom', 'recording:read', 'Read Zoom recordings and transcripts'),
  ('quickbooks', 'com.intuit.quickbooks.accounting', 'Read QuickBooks accounting data'),
  ('quickbooks', 'com.intuit.quickbooks.payments', 'Read QuickBooks payment and finance records'),
  ('xero', 'offline_access', 'Request Xero refresh tokens'),
  ('xero', 'accounting.transactions', 'Read Xero transactions and invoices'),
  ('xero', 'accounting.contacts', 'Read Xero contacts and customer records')
on conflict (provider_id, scope) do update
set description = excluded.description;
