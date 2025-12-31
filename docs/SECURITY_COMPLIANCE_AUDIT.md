# HeirClark Backend Security & Compliance Documentation

**Document Version:** 1.0
**Last Updated:** December 31, 2024
**Prepared For:** Security Audit / SOC2 / GDPR Compliance Review

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Data Classification](#3-data-classification)
4. [Encryption Implementation](#4-encryption-implementation)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [Audit Logging](#6-audit-logging)
7. [GDPR Compliance](#7-gdpr-compliance)
8. [Data Retention Policy](#8-data-retention-policy)
9. [SOC2 Control Mapping](#9-soc2-control-mapping)
10. [API Security](#10-api-security)
11. [Environment Configuration](#11-environment-configuration)
12. [Incident Response](#12-incident-response)
13. [File Reference](#13-file-reference)

---

## 1. Executive Summary

HeirClark Backend implements a **zero-trust security architecture** designed to protect sensitive health and nutrition data while maintaining compliance with:

- **SOC2 Type II** - Trust Service Criteria (Security, Availability, Confidentiality)
- **GDPR** - EU General Data Protection Regulation
- **HIPAA-Ready** - Health data protection best practices

### Key Security Controls

| Control | Implementation | Status |
|---------|----------------|--------|
| Encryption at Rest | AES-256-GCM | ✅ Active |
| Encryption in Transit | TLS 1.2+ (Railway) | ✅ Active |
| Authentication | JWT with HMAC-SHA256 | ✅ Active |
| Audit Logging | Structured logs with correlation IDs | ✅ Active |
| Rate Limiting | Per-IP and per-user limits | ✅ Active |
| Input Validation | Parameterized queries, sanitization | ✅ Active |
| GDPR Data Rights | Export, deletion, retention | ✅ Active |

---

## 2. Architecture Overview

### 2.1 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INTERNET                                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    RAILWAY PLATFORM (PaaS)                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    TLS TERMINATION                           │    │
│  │                 (Automatic HTTPS/TLS 1.2+)                   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                    │                                 │
│                                    ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                 HEIRCLARK BACKEND (Node.js)                  │    │
│  │  ┌─────────────────────────────────────────────────────┐    │    │
│  │  │              SECURITY MIDDLEWARE CHAIN               │    │    │
│  │  │                                                      │    │    │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │    │    │
│  │  │  │   CORS   │→ │  Audit   │→ │   Rate   │→ ...     │    │    │
│  │  │  │  Filter  │  │  Logger  │  │  Limiter │          │    │    │
│  │  │  └──────────┘  └──────────┘  └──────────┘          │    │    │
│  │  │                      │                              │    │    │
│  │  │                      ▼                              │    │    │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │    │    │
│  │  │  │   JWT    │→ │  Route   │→ │ Business │          │    │    │
│  │  │  │   Auth   │  │ Handler  │  │  Logic   │          │    │    │
│  │  │  └──────────┘  └──────────┘  └──────────┘          │    │    │
│  │  └─────────────────────────────────────────────────────┘    │    │
│  │                                                              │    │
│  │  ┌─────────────────────────────────────────────────────┐    │    │
│  │  │              ENCRYPTION SERVICE                      │    │    │
│  │  │         (AES-256-GCM with HKDF key derivation)       │    │    │
│  │  └─────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                    │                                 │
│                                    ▼                                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              POSTGRESQL DATABASE (Railway)                   │    │
│  │                                                              │    │
│  │  ┌──────────────────┐  ┌──────────────────┐                 │    │
│  │  │  Health Data     │  │   Audit Logs     │                 │    │
│  │  │  (Encrypted)     │  │   (Immutable)    │                 │    │
│  │  └──────────────────┘  └──────────────────┘                 │    │
│  │  ┌──────────────────┐  ┌──────────────────┐                 │    │
│  │  │  OAuth Tokens    │  │   User Prefs     │                 │    │
│  │  │  (Encrypted)     │  │   (Encrypted)    │                 │    │
│  │  └──────────────────┘  └──────────────────┘                 │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Runtime | Node.js | 18.x LTS |
| Framework | Express.js | 4.x |
| Language | TypeScript | 5.x |
| Database | PostgreSQL | 15.x |
| Hosting | Railway | PaaS |
| Source Control | GitHub | - |

---

## 3. Data Classification

### 3.1 Data Categories

| Category | Classification | Examples | Protection Level |
|----------|---------------|----------|------------------|
| **Health Metrics** | Sensitive/PHI | Steps, calories, heart rate, workouts | AES-256-GCM Encrypted |
| **Biometric Data** | Sensitive/PHI | Weight, body measurements | AES-256-GCM Encrypted |
| **Nutrition Data** | Sensitive | Meal logs, food items, dietary habits | AES-256-GCM Encrypted |
| **OAuth Tokens** | Secret | Fitbit tokens, Apple Health tokens | AES-256-GCM Encrypted |
| **User Preferences** | PII | Goals, targets, timezone | AES-256-GCM Encrypted |
| **Audit Logs** | Internal | Request logs, access logs | Plaintext (anonymized after retention) |
| **System Data** | Internal | Device IDs, pairing tokens | Standard protection |

### 3.2 Data Flow Diagram

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Shopify    │     │    Mobile    │     │   Wearables  │
│  Storefront  │     │     App      │     │ (Fitbit/Apple│
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │  HTTPS/TLS 1.2+    │                    │
       └────────────────────┼────────────────────┘
                            │
                            ▼
                 ┌──────────────────┐
                 │   API Gateway    │
                 │  (Rate Limited)  │
                 └────────┬─────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │  Health  │   │ Nutrition│   │  GDPR    │
    │  Routes  │   │  Routes  │   │  Routes  │
    └────┬─────┘   └────┬─────┘   └────┬─────┘
         │              │              │
         └──────────────┼──────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │   Encryption     │
              │    Service       │
              │ (AES-256-GCM)    │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │   PostgreSQL     │
              │   (Encrypted     │
              │    Columns)      │
              └──────────────────┘
```

---

## 4. Encryption Implementation

### 4.1 Encryption Algorithm

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-256-GCM |
| Key Size | 256 bits (32 bytes) |
| IV Size | 96 bits (12 bytes) |
| Auth Tag Size | 128 bits (16 bytes) |
| Key Derivation | HKDF-SHA256 |

### 4.2 Key Management

```
┌─────────────────────────────────────────────────────────────┐
│                    KEY HIERARCHY                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              MASTER KEY (ENCRYPTION_KEY)              │   │
│  │         Stored in Railway Environment Variables       │   │
│  │              32 bytes, Base64 encoded                 │   │
│  └──────────────────────────┬───────────────────────────┘   │
│                             │                                │
│              HKDF Key Derivation (SHA-256)                  │
│                             │                                │
│    ┌────────────────────────┼────────────────────────┐      │
│    │                        │                        │      │
│    ▼                        ▼                        ▼      │
│  ┌──────────┐         ┌──────────┐         ┌──────────┐    │
│  │  OAuth   │         │  Health  │         │   PII    │    │
│  │  Token   │         │  Metrics │         │   Key    │    │
│  │   Key    │         │   Key    │         │          │    │
│  └──────────┘         └──────────┘         └──────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key Derivation Contexts:**

| Context | HKDF Info String | Purpose |
|---------|------------------|---------|
| `OAUTH_TOKEN` | `heirclark:oauth_token:v1` | Fitbit/Apple OAuth tokens |
| `REFRESH_TOKEN` | `heirclark:refresh_token:v1` | OAuth refresh tokens |
| `HEALTH_METRICS` | `heirclark:health_metrics:v1` | Steps, calories, heart rate |
| `PII` | `heirclark:pii:v1` | User goals, preferences |
| `NUTRITION_DATA` | `heirclark:nutrition_data:v1` | Meal items, food logs |
| `WEIGHT_DATA` | `heirclark:weight_data:v1` | Weight measurements |

### 4.3 Encrypted Storage Format

```json
{
  "iv": "<base64-encoded-12-byte-IV>",
  "data": "<base64-encoded-ciphertext>",
  "tag": "<base64-encoded-16-byte-auth-tag>",
  "v": 1
}
```

Stored as: `base64(JSON.stringify(payload))`

### 4.4 Encrypted Database Columns

| Table | Column | Data Type | Contents |
|-------|--------|-----------|----------|
| `wearable_tokens` | `access_token_enc` | TEXT | Encrypted OAuth access token |
| `wearable_tokens` | `refresh_token_enc` | TEXT | Encrypted OAuth refresh token |
| `hc_apple_tokens` | `token_enc` | TEXT | Encrypted Apple Health sync token |
| `hc_health_latest` | `metrics_enc` | TEXT | Encrypted health metrics JSON |
| `hc_user_preferences` | `pii_enc` | TEXT | Encrypted goals and targets |
| `hc_weight_logs` | `weight_enc` | TEXT | Encrypted weight value |
| `hc_meals` | `items_enc` | TEXT | Encrypted meal items JSON |

### 4.5 Encryption Service Location

**File:** `src/services/encryption.ts`

**Key Functions:**

```typescript
// Encrypt data with field-specific key
encrypt(plaintext: string | object, context: FieldContext): string

// Decrypt data with field-specific key
decrypt(encryptedBase64: string, context: FieldContext): string

// Check if value is encrypted (for migration)
isEncrypted(value: string): boolean

// Hash for audit logging (one-way)
hashForAudit(value: string | object): string

// Validate encryption configuration
validateEncryptionConfig(): { valid: boolean; error?: string }
```

---

## 5. Authentication & Authorization

### 5.1 Authentication Methods

| Method | Status | Security Level | Notes |
|--------|--------|----------------|-------|
| **JWT Bearer Token** | ✅ Active | High | Recommended method |
| `X-Shopify-Customer-Id` Header | ⚠️ Deprecated | Low | Removed after 2025-01-30 |
| `shopifyCustomerId` Parameter | ⚠️ Deprecated | Low | Removed after 2025-01-30 |

### 5.2 JWT Implementation

| Parameter | Value |
|-----------|-------|
| Algorithm | HMAC-SHA256 (HS256) |
| Token Format | `header.payload.signature` |
| Default Expiry | 7 days |
| Secret Storage | `JWT_SECRET` environment variable |

**JWT Payload Structure:**

```json
{
  "customerId": "string",
  "iat": 1704067200,
  "exp": 1704672000
}
```

### 5.3 Legacy Auth Deprecation Timeline

```
┌─────────────────────────────────────────────────────────────┐
│                 DEPRECATION TIMELINE                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  2024-12-31         2025-01-30              2025-02-01      │
│      │                  │                       │            │
│      ▼                  ▼                       ▼            │
│  ┌────────┐        ┌────────┐            ┌────────┐         │
│  │Warning │   →    │Sunset  │      →     │Removed │         │
│  │ Period │        │  Date  │            │        │         │
│  └────────┘        └────────┘            └────────┘         │
│                                                              │
│  Legacy auth works    Last day for        Legacy auth       │
│  but sends warning    legacy auth         returns 401       │
│  headers                                                     │
└─────────────────────────────────────────────────────────────┘
```

**Deprecation Headers Sent:**

```http
X-Auth-Deprecation-Warning: X-Shopify-Customer-Id header is deprecated...
Deprecation: 2025-01-30
Sunset: Thu, 30 Jan 2025 00:00:00 GMT
```

### 5.4 Authentication Middleware Location

**File:** `src/middleware/auth.ts`

---

## 6. Audit Logging

### 6.1 Audit Log Schema

```sql
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  correlation_id UUID NOT NULL,        -- Request tracing
  user_id TEXT,                        -- Who performed action
  action TEXT NOT NULL,                -- What was done
  resource_type TEXT NOT NULL,         -- What type of resource
  resource_id TEXT,                    -- Specific resource ID
  ip_address TEXT,                     -- Client IP
  user_agent TEXT,                     -- Client user agent
  request_method TEXT,                 -- HTTP method
  request_path TEXT,                   -- API endpoint
  status_code INTEGER,                 -- Response status
  old_value_hash TEXT,                 -- SHA-256 of previous value
  new_value_hash TEXT,                 -- SHA-256 of new value
  metadata JSONB,                      -- Additional context
  error_message TEXT,                  -- Error details if failed
  duration_ms INTEGER                  -- Request duration
);
```

### 6.2 Audit Actions

| Action | Description | Trigger |
|--------|-------------|---------|
| `AUTH_LOGIN` | Successful authentication | Valid JWT or legacy auth |
| `AUTH_FAILED` | Failed authentication | Invalid/expired token |
| `AUTH_LOGOUT` | User logout | Logout endpoint |
| `READ` | Data access | GET requests |
| `CREATE` | Data creation | POST requests |
| `UPDATE` | Data modification | PUT/PATCH requests |
| `DELETE` | Data deletion | DELETE requests |
| `EXTERNAL_API_CALL` | External service call | HeyGen, OpenAI, Fitbit |
| `RATE_LIMIT_EXCEEDED` | Rate limit hit | Too many requests |
| `AUTHORIZATION_DENIED` | Access denied | Unauthorized resource access |
| `GDPR_EXPORT` | Data export requested | GDPR export endpoint |
| `GDPR_DELETE` | Data deletion requested | GDPR delete endpoint |
| `CONSENT_UPDATED` | Consent changed | User consent modification |

### 6.3 Resource Types

| Resource Type | Description |
|---------------|-------------|
| `user` | User account operations |
| `health_data` | Health metrics |
| `nutrition` | Nutrition/calorie data |
| `meals` | Meal logs |
| `weight` | Weight logs |
| `hydration` | Water intake logs |
| `preferences` | User preferences |
| `oauth_token` | OAuth tokens |
| `video` | Generated videos |
| `device` | Linked devices |
| `system` | System events |

### 6.4 Correlation ID Tracing

Every request receives a unique correlation ID for end-to-end tracing:

```
Request → Correlation ID Generated → All Related Logs Tagged → Response Header
```

**Header:** `X-Correlation-Id: <uuid>`

### 6.5 Audit Service Location

**Files:**
- `src/services/auditLogger.ts` - Core audit service
- `src/middleware/auditMiddleware.ts` - Request interception

---

## 7. GDPR Compliance

### 7.1 GDPR Articles Implemented

| Article | Title | Implementation |
|---------|-------|----------------|
| **Art. 15** | Right of Access | `GET /api/v1/gdpr/export` |
| **Art. 17** | Right to Erasure | `DELETE /api/v1/gdpr/delete` |
| **Art. 20** | Right to Data Portability | `GET /api/v1/gdpr/export` (JSON) |
| **Art. 25** | Data Protection by Design | Encryption at rest |
| **Art. 30** | Records of Processing | Audit logs |
| **Art. 32** | Security of Processing | Encryption, access controls |
| **Art. 33** | Breach Notification | Audit trail for forensics |

### 7.2 GDPR API Endpoints

#### Export User Data (Article 15 & 20)

```http
GET /api/v1/gdpr/export
Authorization: Bearer <token>

Response: 200 OK
Content-Type: application/json
Content-Disposition: attachment; filename="heirclark-data-export-{userId}-{timestamp}.json"

{
  "ok": true,
  "gdprArticle": "Article 20 - Right to Data Portability",
  "data": {
    "exportedAt": "2024-12-31T12:00:00Z",
    "userId": "...",
    "dataCategories": {
      "profile": { ... },
      "healthData": { ... },
      "nutrition": { ... },
      "weight": { ... },
      "hydration": { ... },
      "videos": { ... },
      "devices": { ... },
      "wearables": { ... }
    },
    "auditTrail": {
      "recentActivity": [ ... ],
      "note": "Audit logs retained for 7 years per SOC2"
    }
  }
}
```

#### Delete User Data (Article 17)

```http
DELETE /api/v1/gdpr/delete
Authorization: Bearer <token>
X-Confirm-Delete: PERMANENTLY_DELETE_ALL_MY_DATA

Response: 200 OK
{
  "ok": true,
  "gdprArticle": "Article 17 - Right to Erasure",
  "result": {
    "deletedAt": "2024-12-31T12:00:00Z",
    "deletedCategories": [
      { "category": "meals", "count": 42 },
      { "category": "weight", "count": 15 },
      ...
    ],
    "anonymizedAuditLogs": 156,
    "notes": [
      "Audit logs anonymized but retained for compliance",
      "HeyGen videos expire automatically within 7 days"
    ]
  }
}
```

#### View Retention Policy

```http
GET /api/v1/gdpr/retention

Response: 200 OK
{
  "ok": true,
  "gdprArticle": "Article 5(1)(e) - Storage Limitation",
  "retentionPolicy": {
    "policies": [
      { "dataType": "Health metrics", "retentionPeriod": "2 years", "action": "Auto-delete" },
      { "dataType": "Meal logs", "retentionPeriod": "2 years", "action": "Auto-delete" },
      { "dataType": "Audit logs", "retentionPeriod": "7 years", "action": "Anonymize" },
      ...
    ]
  }
}
```

#### GDPR Rights Information

```http
GET /api/v1/gdpr/info

Response: 200 OK
{
  "ok": true,
  "rights": [
    {
      "name": "Right to Access (Article 15)",
      "description": "...",
      "howToExercise": "GET /api/v1/gdpr/export"
    },
    ...
  ],
  "dataController": {
    "name": "HeirClark",
    "contact": "privacy@heirclark.com"
  }
}
```

### 7.3 GDPR Service Location

**Files:**
- `src/services/gdprService.ts` - Export/delete logic
- `src/routes/gdpr.ts` - API endpoints

---

## 8. Data Retention Policy

### 8.1 Retention Periods

| Data Category | Retention Period | Automated Action | Legal Basis |
|---------------|------------------|------------------|-------------|
| Health Metrics | 2 years | Auto-delete | Legitimate interest |
| Meal Logs | 2 years | Auto-delete | Legitimate interest |
| Weight Logs | 2 years | Auto-delete | Legitimate interest |
| Hydration Logs | 2 years | Auto-delete | Legitimate interest |
| Generated Videos | 7 days | Auto-expire (HeyGen) | Service limitation |
| OAuth Tokens | Until revoked | Delete on disconnect | Consent |
| Audit Logs | 7 years | Anonymize PII | Legal requirement (SOC2) |
| Inactive Accounts | 1 year | Notify → Delete | Consent withdrawal |

### 8.2 Retention Job Schedule

| Parameter | Value |
|-----------|-------|
| Schedule | Daily at 02:00 UTC |
| Environment | Production only |
| Batch Size | 1000 records |

### 8.3 Retention Job Operations

```
Daily at 2:00 AM:
├── Delete health data older than 2 years
├── Delete meal logs older than 2 years
├── Delete weight logs older than 2 years
├── Delete water logs older than 2 years
├── Delete expired pairing tokens
├── Delete expired OAuth tokens
├── Delete expired Apple Health tokens
├── Delete expired video records
├── Anonymize audit logs older than 7 years
└── Identify inactive accounts (notify at 11 months, delete at 12 months)
```

### 8.4 Retention Service Location

**File:** `src/jobs/dataRetention.ts`

---

## 9. SOC2 Control Mapping

### 9.1 Trust Service Criteria Coverage

| Control ID | Control Name | Implementation | Evidence |
|------------|--------------|----------------|----------|
| **CC6.1** | Logical Access | JWT authentication, role-based access | `src/middleware/auth.ts` |
| **CC6.2** | Access Enforcement | Per-request validation, middleware chain | `src/middleware/auth.ts` |
| **CC6.3** | Access Removal | Token expiration, GDPR delete | `src/services/gdprService.ts` |
| **CC7.1** | Activity Logging | Full audit trail | `src/services/auditLogger.ts` |
| **CC7.2** | Change Logging | Old/new value hashes | Audit logs schema |
| **CC7.4** | Monitoring | Structured logs, correlation IDs | `src/middleware/auditMiddleware.ts` |
| **C1.1** | Confidentiality | AES-256-GCM encryption | `src/services/encryption.ts` |
| **C1.2** | Data Classification | PII/PHI identification | Data classification table |
| **P7.1** | Data Retention | Automated cleanup job | `src/jobs/dataRetention.ts` |
| **A1.1** | Availability | Railway PaaS SLA | Infrastructure |
| **PI1.1** | Processing Integrity | Input validation | Route handlers |

### 9.2 Control Evidence Locations

```
SOC2 Evidence Package:
├── Encryption
│   ├── src/services/encryption.ts (algorithm implementation)
│   ├── src/db/migrate-encryption.ts (schema changes)
│   └── Database: *_enc columns (encrypted data)
│
├── Access Control
│   ├── src/middleware/auth.ts (authentication)
│   ├── src/middleware/rateLimiter.ts (rate limiting)
│   └── Audit logs: AUTH_* actions
│
├── Audit Logging
│   ├── src/services/auditLogger.ts (logging service)
│   ├── src/middleware/auditMiddleware.ts (request tracking)
│   └── Database: audit_logs table
│
├── Data Retention
│   ├── src/jobs/dataRetention.ts (cleanup job)
│   ├── src/services/gdprService.ts (deletion)
│   └── Audit logs: GDPR_DELETE actions
│
└── Change Management
    ├── GitHub commit history
    ├── Pre-commit hooks (.git/hooks/pre-commit)
    └── Audit logs with old/new value hashes
```

---

## 10. API Security

### 10.1 Rate Limiting

| Endpoint Category | Window | Max Requests | Key |
|-------------------|--------|--------------|-----|
| General API | 1 minute | 100 | IP address |
| Authentication | 1 minute | 10 | IP address |
| AI Endpoints | 1 minute | 20 | IP address |
| Video Generation | 1 hour | 5 | User ID or IP |

### 10.2 Input Validation

| Validation Type | Implementation | Location |
|-----------------|----------------|----------|
| SQL Injection | Parameterized queries | All database operations |
| XSS Prevention | Output encoding | Response serialization |
| User ID Sanitization | Alphanumeric filter | `sanitizeUserId()` |
| Video ID Sanitization | Alphanumeric filter | `sanitizeVideoId()` |
| Script Sanitization | HTML/control char removal | HeyGen service |

### 10.3 CORS Configuration

```javascript
allowlist: [
  "https://heirclark.com",
  "https://www.heirclark.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]
```

### 10.4 Security Headers

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Correlation-Id` | UUID | Request tracing |
| `X-RateLimit-Limit` | Number | Rate limit ceiling |
| `X-RateLimit-Remaining` | Number | Remaining requests |
| `X-RateLimit-Reset` | Timestamp | Window reset time |
| `X-Auth-Deprecation-Warning` | Message | Legacy auth warning |

---

## 11. Environment Configuration

### 11.1 Required Environment Variables

| Variable | Purpose | Rotation Policy |
|----------|---------|-----------------|
| `DATABASE_URL` | PostgreSQL connection | On compromise |
| `JWT_SECRET` | Token signing | Annually |
| `ENCRYPTION_KEY` | Data encryption master key | Annually |

### 11.2 Optional Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `HEYGEN_API_KEY` | Video generation | None (feature disabled) |
| `ANTHROPIC_API_KEY` | Script generation | None (feature disabled) |
| `OPENAI_API_KEY` | Meal planning AI | None (feature disabled) |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | 60000 |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | 100 |
| `DATA_RETENTION_DAYS` | Health data retention | 730 (2 years) |
| `AUDIT_RETENTION_DAYS` | Audit log retention | 2555 (7 years) |
| `NODE_ENV` | Environment mode | development |

### 11.3 Secret Detection

Pre-commit hook prevents accidental secret commits:

**Detected Patterns:**
- `HEYGEN_API_KEY=...`
- `ANTHROPIC_API_KEY=...`
- `OPENAI_API_KEY=...`
- `DATABASE_URL=postgresql://...`
- `JWT_SECRET=...`
- `sk-[a-zA-Z0-9]{20,}` (OpenAI keys)

**Location:** `.git/hooks/pre-commit`

---

## 12. Incident Response

### 12.1 Security Event Detection

Audit logs enable detection of:

| Event | Detection Method | Alert Trigger |
|-------|------------------|---------------|
| Brute Force Attack | Multiple `AUTH_FAILED` from same IP | >10 failures/minute |
| Data Exfiltration | Large `GDPR_EXPORT` requests | Unusual export patterns |
| Privilege Escalation | `AUTHORIZATION_DENIED` patterns | Repeated denials |
| API Abuse | `RATE_LIMIT_EXCEEDED` events | Sustained rate limiting |

### 12.2 Forensic Capabilities

| Capability | Implementation |
|------------|----------------|
| Request Tracing | Correlation IDs link all related logs |
| User Activity | Filter by `user_id` in audit logs |
| Time Range Analysis | Filter by `timestamp` |
| IP Tracking | `ip_address` field in audit logs |
| Change History | `old_value_hash` / `new_value_hash` |

### 12.3 Sample Audit Query - User Activity

```sql
SELECT
  timestamp,
  action,
  resource_type,
  resource_id,
  request_path,
  status_code,
  ip_address
FROM audit_logs
WHERE user_id = 'USER_ID_HERE'
AND timestamp > NOW() - INTERVAL '30 days'
ORDER BY timestamp DESC;
```

### 12.4 Sample Audit Query - Security Events

```sql
SELECT
  timestamp,
  user_id,
  action,
  ip_address,
  error_message,
  request_path
FROM audit_logs
WHERE action IN ('AUTH_FAILED', 'RATE_LIMIT_EXCEEDED', 'AUTHORIZATION_DENIED')
AND timestamp > NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC;
```

---

## 13. File Reference

### 13.1 Security Components

| File | Purpose | SOC2 Control |
|------|---------|--------------|
| `src/services/encryption.ts` | AES-256-GCM encryption | C1.1 |
| `src/services/auditLogger.ts` | Audit logging | CC7.1, CC7.2 |
| `src/services/gdprService.ts` | GDPR data handling | P7.1 |
| `src/middleware/auth.ts` | Authentication | CC6.1, CC6.2 |
| `src/middleware/auditMiddleware.ts` | Request auditing | CC7.4 |
| `src/middleware/rateLimiter.ts` | Rate limiting | CC6.2 |
| `src/routes/gdpr.ts` | GDPR endpoints | P7.1 |
| `src/jobs/dataRetention.ts` | Data cleanup | P7.1 |
| `src/db/migrate-encryption.ts` | Encryption migration | C1.1 |
| `.git/hooks/pre-commit` | Secret detection | CC6.1 |

### 13.2 Database Tables

| Table | Contains | Encrypted Columns |
|-------|----------|-------------------|
| `wearable_tokens` | OAuth tokens | `access_token_enc`, `refresh_token_enc` |
| `hc_apple_tokens` | Apple Health tokens | `token_enc` |
| `hc_health_latest` | Current health metrics | `metrics_enc` |
| `hc_user_preferences` | User goals/settings | `pii_enc` |
| `hc_weight_logs` | Weight history | `weight_enc` |
| `hc_meals` | Meal/nutrition logs | `items_enc` |
| `audit_logs` | Security audit trail | None (immutable) |

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024-12-31 | HeirClark Engineering | Initial release |

---

**Contact Information:**

- **Data Protection Officer:** privacy@heirclark.com
- **Security Team:** security@heirclark.com
- **Technical Support:** support@heirclark.com
