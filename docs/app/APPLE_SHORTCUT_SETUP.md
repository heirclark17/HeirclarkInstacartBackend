# Apple Health Shortcut Integration - Complete Setup Guide

## Table of Contents
1. [Overview](#overview)
2. [How It Works](#how-it-works)
3. [Creating the Shortcut](#creating-the-shortcut)
4. [Sharing the Shortcut](#sharing-the-shortcut)
5. [Frontend Integration](#frontend-integration)
6. [Backend Endpoints](#backend-endpoints)
7. [User Flow](#user-flow)
8. [Troubleshooting](#troubleshooting)
9. [Security Considerations](#security-considerations)
10. [Production Checklist](#production-checklist)

---

## Overview

The HeirClark app syncs Apple Health data (steps, active calories, heart rate, workouts) through an iOS Shortcut. This approach is necessary because:

1. **No Web API** - Apple Health doesn't have a web API; data can only be accessed on-device
2. **Privacy First** - Users control exactly when data is shared
3. **No App Store App Required** - Works with just a Shopify storefront + Shortcut

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         APPLE HEALTH SYNC FLOW                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │  Safari  │───▶│ Backend  │───▶│ Shortcut │───▶│  Apple   │              │
│  │  Web App │    │  API     │    │  (iOS)   │    │  Health  │              │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘              │
│       │               │               │               │                     │
│       │  1. Request   │               │               │                     │
│       │  pairing      │               │               │                     │
│       │  token        │               │               │                     │
│       │──────────────▶│               │               │                     │
│       │               │               │               │                     │
│       │  2. Return    │               │               │                     │
│       │  token        │               │               │                     │
│       │◀──────────────│               │               │                     │
│       │               │               │               │                     │
│       │  3. Open      │               │               │                     │
│       │  Shortcut     │               │               │                     │
│       │  with token   │               │               │                     │
│       │──────────────────────────────▶│               │                     │
│       │               │               │               │                     │
│       │               │               │  4. Read      │                     │
│       │               │               │  Health data  │                     │
│       │               │               │──────────────▶│                     │
│       │               │               │               │                     │
│       │               │               │◀──────────────│                     │
│       │               │               │               │                     │
│       │               │  5. POST      │               │                     │
│       │               │  health data  │               │                     │
│       │               │  + token      │               │                     │
│       │               │◀──────────────│               │                     │
│       │               │               │               │                     │
│       │  6. User      │               │               │                     │
│       │  returns to   │               │               │                     │
│       │  Safari       │               │               │                     │
│       │◀──────────────│               │               │                     │
│       │               │               │               │                     │
│       │  7. Poll for  │               │               │                     │
│       │  new data     │               │               │                     │
│       │──────────────▶│               │               │                     │
│       │               │               │               │                     │
│       │  8. Return    │               │               │                     │
│       │  synced data  │               │               │                     │
│       │◀──────────────│               │               │                     │
│       │               │               │               │                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## How It Works

### Pairing Flow (First Time)

1. **User taps "Connect Apple Health"** in the web app
2. **Backend generates a pairing token** (valid for 10 minutes)
3. **Web app opens the Shortcut** via `shortcuts://run-shortcut?name=...&input=TOKEN`
4. **Shortcut reads Apple Health data** and sends it to the backend with the token
5. **Backend links the device** to the user's account using the token
6. **User returns to Safari** and sees their health data synced

### Subsequent Syncs

1. **User taps "Sync now"** in the web app
2. **Web app opens the Shortcut** (no token needed - device already linked)
3. **Shortcut reads Apple Health** and sends data using stored device key
4. **User returns to Safari** and sees updated data

---

## Creating the Shortcut

### Required Actions

Create a new Shortcut in the iOS Shortcuts app with these actions:

```
┌─────────────────────────────────────────────────────────────────┐
│  SHORTCUT: "Heirclark Health Sync"                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. [If] Shortcut Input has any value                           │
│     │                                                            │
│     ├── [Text] Set variable "pairingToken" to Shortcut Input    │
│     │                                                            │
│     └── [Get Contents of URL]                                   │
│         POST https://YOUR-BACKEND/api/v1/health/pair/complete   │
│         Headers: Content-Type: application/json                  │
│         Body: { "pairingToken": [pairingToken] }                │
│         → Save result to "pairResult"                           │
│         │                                                        │
│         └── [Get Dictionary Value]                              │
│             Get "deviceKey" from pairResult                      │
│             → Save to "deviceKey"                               │
│             │                                                    │
│             └── [Save to File]                                  │
│                 Save deviceKey to "Shortcuts/heirclark_device"  │
│                                                                  │
│  2. [Otherwise]                                                  │
│     │                                                            │
│     └── [Get File]                                              │
│         Get "Shortcuts/heirclark_device"                        │
│         → Save to "deviceKey"                                   │
│                                                                  │
│  3. [End If]                                                     │
│                                                                  │
│  4. [Find Health Samples]                                        │
│     Type: Steps                                                  │
│     Start Date: Start of Today                                  │
│     End Date: Now                                                │
│     → Sum to get "todaySteps"                                   │
│                                                                  │
│  5. [Find Health Samples]                                        │
│     Type: Active Energy                                          │
│     Start Date: Start of Today                                  │
│     End Date: Now                                                │
│     → Sum to get "activeCalories"                               │
│                                                                  │
│  6. [Find Health Samples]                                        │
│     Type: Basal Energy Burned                                   │
│     Start Date: Start of Today                                  │
│     End Date: Now                                                │
│     → Sum to get "restingEnergy"                                │
│                                                                  │
│  7. [Find Health Samples]                                        │
│     Type: Heart Rate                                             │
│     Start Date: Start of Today                                  │
│     End Date: Now                                                │
│     Sort: Latest First                                          │
│     Limit: 1                                                     │
│     → Get value to "heartRate"                                  │
│                                                                  │
│  8. [Find Health Samples]                                        │
│     Type: Workout                                                │
│     Start Date: Start of Today                                  │
│     End Date: Now                                                │
│     → Count to get "workoutsToday"                              │
│                                                                  │
│  9. [Get Contents of URL]                                        │
│     POST https://YOUR-BACKEND/api/v1/health/ingest              │
│     Headers: Content-Type: application/json                      │
│     Body: {                                                      │
│       "deviceKey": [deviceKey],                                  │
│       "steps": [todaySteps],                                    │
│       "activeCalories": [activeCalories],                       │
│       "restingEnergy": [restingEnergy],                         │
│       "latestHeartRateBpm": [heartRate],                        │
│       "workoutsToday": [workoutsToday],                         │
│       "localTimeIso": [Current Date as ISO 8601]                │
│     }                                                            │
│                                                                  │
│  10. [Show Notification] (Optional)                              │
│      "Health data synced to HeirClark!"                         │
│                                                                  │
│  11. [Open URL]                                                  │
│      https://YOUR-SHOPIFY-STORE.com/pages/calorie-counter       │
│      (Returns user to the web app)                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Step-by-Step Instructions

#### Step 1: Create New Shortcut
1. Open the **Shortcuts** app on iPhone
2. Tap **+** to create a new shortcut
3. Tap the name at the top and enter: **"Heirclark Health Sync"**

#### Step 2: Handle Pairing Token Input
1. Add action: **If**
2. Condition: **Shortcut Input** → **has any value**
3. Inside the If:
   - Add action: **Text** → Enter `Shortcut Input` variable
   - Add action: **Set Variable** → Name it `pairingToken`

#### Step 3: Complete Pairing (Inside If)
1. Add action: **Get Contents of URL**
2. URL: `https://YOUR-BACKEND.railway.app/api/v1/health/pair/complete`
3. Method: **POST**
4. Headers: Add `Content-Type` = `application/json`
5. Request Body: **JSON**
   ```json
   {
     "pairingToken": "[pairingToken variable]"
   }
   ```
6. Add action: **Get Dictionary Value**
   - Key: `deviceKey`
7. Add action: **Set Variable** → Name it `deviceKey`
8. Add action: **Save File**
   - Save `deviceKey` to `Shortcuts/heirclark_device.txt`

#### Step 4: Load Existing Device Key (Otherwise)
1. In the **Otherwise** section:
2. Add action: **Get File**
   - Path: `Shortcuts/heirclark_device.txt`
3. Add action: **Set Variable** → Name it `deviceKey`

#### Step 5: Read Health Data
For each health metric, add:

**Steps:**
1. Add action: **Find Health Samples**
2. Type: **Steps**
3. Start Date: **Start of Today**
4. End Date: **Current Date**
5. Add action: **Calculate Statistics** → Sum
6. Add action: **Set Variable** → Name: `todaySteps`

**Active Calories:**
1. Add action: **Find Health Samples**
2. Type: **Active Energy**
3. Start Date: **Start of Today**
4. End Date: **Current Date**
5. Add action: **Calculate Statistics** → Sum
6. Add action: **Set Variable** → Name: `activeCalories`

**Resting Energy:**
1. Add action: **Find Health Samples**
2. Type: **Basal Energy Burned**
3. Start Date: **Start of Today**
4. End Date: **Current Date**
5. Add action: **Calculate Statistics** → Sum
6. Add action: **Set Variable** → Name: `restingEnergy`

**Heart Rate:**
1. Add action: **Find Health Samples**
2. Type: **Heart Rate**
3. Start Date: **Start of Today**
4. End Date: **Current Date**
5. Sort By: **End Date** → **Latest First**
6. Limit: **1**
7. Add action: **Get Variable** → Get the BPM value
8. Add action: **Set Variable** → Name: `heartRate`

**Workouts:**
1. Add action: **Find Health Samples**
2. Type: **Workout**
3. Start Date: **Start of Today**
4. End Date: **Current Date**
5. Add action: **Count**
6. Add action: **Set Variable** → Name: `workoutsToday`

#### Step 6: Send Data to Backend
1. Add action: **Get Contents of URL**
2. URL: `https://YOUR-BACKEND.railway.app/api/v1/health/ingest`
3. Method: **POST**
4. Headers: `Content-Type` = `application/json`
5. Request Body: **JSON**
   ```json
   {
     "deviceKey": "[deviceKey]",
     "steps": "[todaySteps]",
     "activeCalories": "[activeCalories]",
     "restingEnergy": "[restingEnergy]",
     "latestHeartRateBpm": "[heartRate]",
     "workoutsToday": "[workoutsToday]",
     "localTimeIso": "[Current Date formatted as ISO 8601]"
   }
   ```

#### Step 7: Return to App
1. Add action: **Open URL**
2. URL: `https://your-store.myshopify.com/pages/calorie-counter`

#### Step 8: Test the Shortcut
1. Run the Shortcut manually
2. Grant Apple Health permissions when prompted
3. Check that data appears in your backend logs

---

## Sharing the Shortcut

### For Development (Personal Use)
Just use the Shortcut directly on your device.

### For Production (Public Distribution)

**Option 1: iCloud Sharing Link**

1. In the Shortcuts app, **long-press** on your Shortcut
2. Tap **Share** → **Copy iCloud Link**
3. The URL looks like: `https://www.icloud.com/shortcuts/abc123def456`
4. This URL can be shared with any iOS user

**Option 2: Dedicated Apple ID**

For production, create a dedicated Apple ID for sharing:
1. Create new Apple ID: `shortcuts@yourdomain.com`
2. Sign into Shortcuts with this account
3. Create/copy the Shortcut there
4. Share from this account
5. This way the Shortcut isn't tied to your personal iCloud

**Option 3: Website Hosting**

1. Export the Shortcut as a `.shortcut` file
2. Host on your website with proper MIME type
3. Link to it with `shortcuts://import-shortcut?url=...`

---

## Frontend Integration

### Configuration

In your Shopify theme's `hc-calorie-counter.liquid`, set the install URL:

```javascript
// In the <script> section
window.__HC_SHORTCUT_INSTALL_URL__ = "https://www.icloud.com/shortcuts/YOUR_SHORTCUT_ID";
```

### JavaScript API

The wearables JavaScript provides these functions:

```javascript
// Check if setup is complete
HC_WEARABLES.isSetupComplete();  // Returns true/false

// Open the Shortcut install page
HC_WEARABLES.openShortcutInstall();

// Launch the pairing flow
await HC_WEARABLES.launchAppleHealthPairing();

// Reset setup (for troubleshooting)
HC_WEARABLES.resetSetup();

// Get the install URL
HC_WEARABLES.getShortcutInstallUrl();

// Check if URL is configured
HC_WEARABLES.isShortcutUrlConfigured();
```

### User Flow States

| State | UI Shown | User Action |
|-------|----------|-------------|
| Not on iOS | "Open on iPhone" message | Switch to iPhone |
| First time on iOS | Setup panel with "Get Shortcut" | Install Shortcut |
| Shortcut installed | Pairing flow | Run Shortcut |
| Connected | "Sync now" button | Tap to sync |
| Shortcut missing | Alert + "Get Shortcut" | Reinstall |

---

## Backend Endpoints

### POST /api/v1/health/pair/start

Creates a pairing token for device linking.

**Request:**
```json
{
    "shopifyCustomerId": "12345678901234"
}
```

**Response:**
```json
{
    "ok": true,
    "pairingToken": "hc_pair_abc123...",
    "shortCode": "A1B2C3",
    "expiresAt": "2025-01-01T12:10:00.000Z"
}
```

### POST /api/v1/health/pair/complete

Completes pairing and returns a device key.

**Request:**
```json
{
    "pairingToken": "hc_pair_abc123..."
}
```

**Response:**
```json
{
    "ok": true,
    "deviceKey": "hc_dev_xyz789...",
    "message": "Device linked successfully"
}
```

### POST /api/v1/health/ingest

Receives health data from the Shortcut.

**Request:**
```json
{
    "deviceKey": "hc_dev_xyz789...",
    "steps": 8542,
    "activeCalories": 385,
    "restingEnergy": 1650,
    "latestHeartRateBpm": 72,
    "workoutsToday": 1,
    "localTimeIso": "2025-01-01T14:30:00-05:00"
}
```

**Response:**
```json
{
    "ok": true,
    "message": "Health data received",
    "receivedAt": "2025-01-01T19:30:00.000Z"
}
```

### GET /api/v1/health/metrics

Retrieves the latest health metrics for a user.

**Request:**
```
GET /api/v1/health/metrics?shopifyCustomerId=12345678901234
```

**Response:**
```json
{
    "ok": true,
    "data": {
        "steps": 8542,
        "activeCalories": 385,
        "restingEnergy": 1650,
        "latestHeartRateBpm": 72,
        "workoutsToday": 1,
        "receivedAt": "2025-01-01T19:30:00.000Z",
        "source": "shortcut"
    }
}
```

### DELETE /api/v1/health/device

Disconnects the user's device.

**Request:**
```json
{
    "shopifyCustomerId": "12345678901234"
}
```

**Response:**
```json
{
    "ok": true,
    "message": "Device disconnected"
}
```

---

## User Flow

### First-Time Connection

```
┌─────────────────────────────────────────────────────────────────┐
│                    FIRST-TIME USER FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User lands on Calorie Counter page                          │
│     └── Sees "Connect Apple Health" button                      │
│                                                                  │
│  2. User taps "Connect Apple Health"                            │
│     └── If iOS + Shortcut not installed:                        │
│         └── Setup panel appears:                                │
│             ┌─────────────────────────────────┐                 │
│             │ 📲 Install Apple Health Shortcut │                 │
│             │                                  │                 │
│             │ To sync your Apple Health data,  │                 │
│             │ you need to install a Shortcut   │                 │
│             │ on your iPhone.                  │                 │
│             │                                  │                 │
│             │ [Get Shortcut] [I've Installed]  │                 │
│             └─────────────────────────────────┘                 │
│                                                                  │
│  3. User taps "Get Shortcut"                                    │
│     └── Opens iCloud link in new tab                            │
│     └── User adds Shortcut to their device                      │
│                                                                  │
│  4. User returns and taps "I've Installed It"                   │
│     └── Setup marked complete                                   │
│     └── Pairing flow begins:                                    │
│         - Backend creates pairing token                         │
│         - Shortcut opens with token as input                    │
│         - Shortcut reads Health data                            │
│         - Shortcut sends data + completes pairing               │
│                                                                  │
│  5. User returns to Safari                                      │
│     └── JS polls for new data                                   │
│     └── Data appears in UI                                      │
│     └── "Connected ✓" badge shown                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Subsequent Syncs

```
┌─────────────────────────────────────────────────────────────────┐
│                    RETURNING USER FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User lands on Calorie Counter page                          │
│     └── Sees "Sync now" button (not "Refresh")                  │
│     └── Last sync time shown                                    │
│                                                                  │
│  2. User taps "Sync now"                                        │
│     └── Button shows spinner: "Syncing..."                      │
│     └── Shortcut opens (no token needed)                        │
│     └── Shortcut reads latest Health data                       │
│     └── Shortcut sends to backend                               │
│                                                                  │
│  3. User returns to Safari                                      │
│     └── JS polls for new data                                   │
│     └── New data appears                                        │
│     └── Toast: "Synced!"                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Troubleshooting

### "Shortcut not found" Error

**Symptom:** User returns to Safari immediately after opening Shortcut.

**Cause:** The Shortcut isn't installed or has a different name.

**Solution:**
1. Check that the Shortcut is named exactly: `Heirclark Health Sync`
2. Have user tap "Get Shortcut" to reinstall
3. Verify the iCloud link is working

### Shortcut Runs But No Data Syncs

**Symptom:** User returns to Safari but no data appears.

**Possible Causes:**
1. **Apple Health permissions not granted**
   - Open Settings → Privacy → Health → Shortcuts
   - Enable all data types

2. **Wrong backend URL in Shortcut**
   - Edit the Shortcut
   - Verify the URL matches your Railway deployment

3. **Device key not saved**
   - Delete `Shortcuts/heirclark_device.txt` in Files app
   - Re-run pairing flow

### Pairing Token Expired

**Symptom:** "Token expired or invalid" error.

**Cause:** Pairing tokens expire after 10 minutes.

**Solution:**
1. Go back to the web app
2. Tap "Connect Apple Health" again
3. Run the Shortcut promptly

### Data Shows But Doesn't Update

**Symptom:** Same values shown even after new activity.

**Cause:** Shortcut might not be running or Apple Health hasn't synced.

**Solution:**
1. Open the Apple Health app to force a sync
2. Wait a few seconds
3. Run the Shortcut again

---

## Security Considerations

### Pairing Token Security

- Tokens are HMAC-SHA256 signed
- Tokens expire after 10 minutes
- One-time use: tokens are invalidated after pairing completes
- Include timestamp to prevent replay attacks

### Device Key Security

- Device keys are long-lived but can be revoked
- Stored locally on the user's device in Shortcuts folder
- Different from user authentication (Shopify customer ID)

### Data in Transit

- All API calls use HTTPS
- Backend validates device keys on every request
- No health data stored in local storage (only in backend DB)

### Recommendations for Production

1. **Use a dedicated Apple ID** for sharing the Shortcut
2. **Add request signing** if concerned about device key theft
3. **Implement rate limiting** on health/ingest endpoint
4. **Audit log all syncs** (already implemented in ai_request_logs)

---

## Production Checklist

### Before Launch

- [ ] Shortcut created and tested on multiple devices
- [ ] Backend endpoints deployed and accessible
- [ ] iCloud sharing link generated
- [ ] `window.__HC_SHORTCUT_INSTALL_URL__` set in Liquid
- [ ] Backend URL in Shortcut matches production
- [ ] Apple Health permissions prompt works correctly

### Testing

- [ ] Test on fresh iPhone (no Shortcut installed)
- [ ] Test pairing flow end-to-end
- [ ] Test "Sync now" after initial pairing
- [ ] Test with no Health data (should show zeros or dashes)
- [ ] Test with Shortcut deleted (should show reinstall prompt)
- [ ] Test on non-iOS device (should show appropriate message)

### Monitoring

- [ ] Check `ai_request_logs` for sync activity
- [ ] Monitor for failed syncs (no deviceKey matches)
- [ ] Track pairing token expiration rate
- [ ] Monitor backend response times

---

## Appendix: URL Schemes

### Opening Shortcuts

```
// Run a Shortcut by name
shortcuts://run-shortcut?name=Heirclark%20Health%20Sync

// Run with input (pairing token)
shortcuts://run-shortcut?name=Heirclark%20Health%20Sync&input=TOKEN_HERE

// Import a Shortcut from URL
shortcuts://import-shortcut?url=https://example.com/shortcut.shortcut
```

### iCloud Shortcut Links

```
// Share format
https://www.icloud.com/shortcuts/[UUID]

// Example
https://www.icloud.com/shortcuts/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

## Appendix: Shortcut Actions Reference

| Action | Purpose |
|--------|---------|
| If / Otherwise / End If | Conditional logic for pairing vs sync |
| Get Contents of URL | API calls to backend |
| Get Dictionary Value | Extract deviceKey from response |
| Set Variable | Store values for later use |
| Save File | Persist deviceKey locally |
| Get File | Load deviceKey for syncs |
| Find Health Samples | Read Apple Health data |
| Calculate Statistics | Sum steps, calories, etc. |
| Count | Count workout sessions |
| Current Date | Get timestamp for sync |
| Format Date | Convert to ISO 8601 |
| Show Notification | Feedback to user (optional) |
| Open URL | Return to web app |

---

*Last updated: January 2025*
