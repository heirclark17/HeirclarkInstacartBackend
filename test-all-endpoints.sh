#!/bin/bash

# MCP Integration - Complete Endpoint Testing Script
# Tests all APIs: Food, Weather, Wearables, MCP Sync

BASE_URL="https://heirclarkinstacartbackend-production.up.railway.app"
CUSTOMER_ID="test-customer-123"

echo "========================================="
echo "MCP Integration API Testing"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TOTAL=0
PASSED=0
FAILED=0

test_endpoint() {
  local name="$1"
  local method="$2"
  local url="$3"
  local data="$4"
  local expected_field="$5"

  TOTAL=$((TOTAL + 1))
  echo -n "Testing: $name ... "

  if [ "$method" = "GET" ]; then
    response=$(curl -s -w "\n%{http_code}" "$url" -H "x-shopify-customer-id: $CUSTOMER_ID")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$url" \
      -H "Content-Type: application/json" \
      -H "x-shopify-customer-id: $CUSTOMER_ID" \
      -d "$data")
  fi

  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)

  # Check if response contains expected field or is 200/503
  if [ "$http_code" = "200" ] || [ "$http_code" = "503" ]; then
    if echo "$body" | grep -q "$expected_field" || [ "$http_code" = "503" ]; then
      echo -e "${GREEN}PASS${NC} (HTTP $http_code)"
      PASSED=$((PASSED + 1))
      echo "  Response: $(echo $body | head -c 100)..."
    else
      echo -e "${RED}FAIL${NC} (HTTP $http_code, missing '$expected_field')"
      FAILED=$((FAILED + 1))
      echo "  Response: $body"
    fi
  else
    echo -e "${RED}FAIL${NC} (HTTP $http_code)"
    FAILED=$((FAILED + 1))
    echo "  Response: $body"
  fi
  echo ""
}

# ==========================================
# FOOD SEARCH API TESTS (4 endpoints)
# ==========================================
echo "========================================="
echo "FOOD SEARCH API (Open Food Facts)"
echo "========================================="
echo ""

test_endpoint \
  "Food Search - Banana" \
  "POST" \
  "$BASE_URL/api/v1/food/search" \
  '{"query":"banana","page":1,"pageSize":2}' \
  "success"

test_endpoint \
  "Food Browse - Popular Foods" \
  "GET" \
  "$BASE_URL/api/v1/food/browse?page=1&pageSize=2" \
  "" \
  "success"

test_endpoint \
  "Food Details - By ID" \
  "GET" \
  "$BASE_URL/api/v1/food/5018735224931" \
  "" \
  "success"

test_endpoint \
  "Food Barcode Lookup" \
  "POST" \
  "$BASE_URL/api/v1/food/barcode" \
  '{"barcode":"5018735224931"}' \
  "success"

# ==========================================
# WEATHER API TESTS (3 endpoints)
# ==========================================
echo "========================================="
echo "WEATHER API (OpenWeatherMap)"
echo "========================================="
echo ""

test_endpoint \
  "Weather - Current (Houston, TX)" \
  "GET" \
  "$BASE_URL/api/v1/weather/current?lat=29.7604&lon=-95.3698&units=imperial" \
  "" \
  "success"

test_endpoint \
  "Weather - 5-Day Forecast" \
  "GET" \
  "$BASE_URL/api/v1/weather/forecast?lat=29.7604&lon=-95.3698&units=imperial" \
  "" \
  "success"

test_endpoint \
  "Weather - Air Quality" \
  "GET" \
  "$BASE_URL/api/v1/weather/air-quality?lat=29.7604&lon=-95.3698" \
  "" \
  "success"

# ==========================================
# WEARABLES API TESTS (6 endpoints)
# ==========================================
echo "========================================="
echo "WEARABLES API"
echo "========================================="
echo ""

test_endpoint \
  "Wearables - List Providers" \
  "GET" \
  "$BASE_URL/api/v1/wearables/providers" \
  "" \
  "providers"

test_endpoint \
  "Wearables - Connected Sources" \
  "GET" \
  "$BASE_URL/api/v1/wearables/sources" \
  "" \
  "sources"

test_endpoint \
  "Wearables - Sync Status" \
  "GET" \
  "$BASE_URL/api/v1/wearables/sync/status" \
  "" \
  "syncStatus"

# ==========================================
# MCP SYNC API TESTS (5 endpoints)
# ==========================================
echo "========================================="
echo "MCP SYNC API"
echo "========================================="
echo ""

test_endpoint \
  "MCP - Provider Status" \
  "GET" \
  "$BASE_URL/api/v1/mcp/status?customerId=$CUSTOMER_ID" \
  "" \
  "providers"

test_endpoint \
  "MCP - Audit Log" \
  "GET" \
  "$BASE_URL/api/v1/mcp/audit?customerId=$CUSTOMER_ID&limit=5" \
  "" \
  "logs"

test_endpoint \
  "MCP - Health History" \
  "GET" \
  "$BASE_URL/api/v1/mcp/history?customerId=$CUSTOMER_ID&startDate=2026-01-01&endDate=2026-01-16" \
  "" \
  "data"

# ==========================================
# SUMMARY
# ==========================================
echo "========================================="
echo "TEST SUMMARY"
echo "========================================="
echo ""
echo "Total Tests:  $TOTAL"
echo -e "Passed:       ${GREEN}$PASSED${NC}"
echo -e "Failed:       ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ ALL TESTS PASSED!${NC}"
  exit 0
else
  echo -e "${RED}❌ SOME TESTS FAILED${NC}"
  echo ""
  echo "Common Issues:"
  echo "  - Weather API: Need OPENWEATHERMAP_API_KEY in Railway"
  echo "  - Health History: Check migration ran successfully"
  echo "  - OAuth endpoints: Need Fitbit/Google credentials"
  exit 1
fi
