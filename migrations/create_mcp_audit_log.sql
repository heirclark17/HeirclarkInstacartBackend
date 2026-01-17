-- Migration: Create MCP Audit Log Table
-- Description: Audit trail for all MCP operations
-- Date: 2026-01-16

CREATE TABLE IF NOT EXISTS hc_mcp_audit_log (
  id SERIAL PRIMARY KEY,
  customer_id VARCHAR(255) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  operation VARCHAR(100) NOT NULL,
  tool_name VARCHAR(100),
  input_params JSONB,
  output_data JSONB,
  success BOOLEAN DEFAULT TRUE,
  record_count INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_mcp_audit_customer_provider
  ON hc_mcp_audit_log (customer_id, provider);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_created_at
  ON hc_mcp_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_provider_success
  ON hc_mcp_audit_log (provider, success);

-- Add comment
COMMENT ON TABLE hc_mcp_audit_log IS 'Audit log for MCP server operations and data syncs';
