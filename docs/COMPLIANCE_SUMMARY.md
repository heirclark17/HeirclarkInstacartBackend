# HeirClark Compliance Summary

**Quick Reference for SOC2 & GDPR Audits**

---

## At a Glance

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Encryption at Rest | ✅ | AES-256-GCM, `src/services/encryption.ts` |
| Encryption in Transit | ✅ | TLS 1.2+ via Railway |
| Audit Logging | ✅ | `audit_logs` table, 7-year retention |
| Access Control | ✅ | JWT auth, rate limiting |
| GDPR Data Export | ✅ | `GET /api/v1/gdpr/export` |
| GDPR Right to Delete | ✅ | `DELETE /api/v1/gdpr/delete` |
| Data Retention | ✅ | 2-year auto-delete, daily job |

---

## Key Files for Auditors

```
src/services/encryption.ts      → Encryption implementation
src/services/auditLogger.ts     → Audit logging
src/services/gdprService.ts     → GDPR export/delete
src/middleware/auth.ts          → Authentication
src/middleware/auditMiddleware.ts → Request tracking
src/jobs/dataRetention.ts       → Data cleanup job
```

---

## SOC2 Controls

| Control | Evidence Location |
|---------|-------------------|
| CC6.1 Logical Access | `src/middleware/auth.ts` |
| CC6.2 Access Enforcement | `src/middleware/rateLimiter.ts` |
| CC7.1 Activity Logging | `src/services/auditLogger.ts` |
| CC7.2 Change Logging | `audit_logs.old_value_hash`, `new_value_hash` |
| C1.1 Confidentiality | `src/services/encryption.ts` |
| P7.1 Data Retention | `src/jobs/dataRetention.ts` |

---

## GDPR Articles

| Article | Endpoint |
|---------|----------|
| Art. 15 Right of Access | `GET /api/v1/gdpr/export` |
| Art. 17 Right to Erasure | `DELETE /api/v1/gdpr/delete` |
| Art. 20 Data Portability | `GET /api/v1/gdpr/export` |

---

## Encryption Details

- **Algorithm:** AES-256-GCM
- **Key Size:** 256-bit
- **Key Derivation:** HKDF-SHA256
- **Key Storage:** Railway environment variable

---

## Audit Log Sample Query

```sql
-- User activity last 30 days
SELECT timestamp, action, resource_type, ip_address
FROM audit_logs
WHERE user_id = 'USER_ID'
AND timestamp > NOW() - INTERVAL '30 days'
ORDER BY timestamp DESC;
```

---

## Data Retention Schedule

| Data | Retention | Action |
|------|-----------|--------|
| Health data | 2 years | Auto-delete |
| Audit logs | 7 years | Anonymize |
| OAuth tokens | Until revoked | Delete on disconnect |

---

## Contact

- **Privacy:** privacy@heirclark.com
- **Security:** security@heirclark.com

**Full Documentation:** `docs/SECURITY_COMPLIANCE_AUDIT.md`
