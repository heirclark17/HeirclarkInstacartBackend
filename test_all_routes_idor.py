#!/usr/bin/env python3
"""
Comprehensive IDOR Penetration Test
Tests all 29 routes with strictAuth applied to verify IDOR vulnerability is fixed
"""

import requests
import json
from datetime import datetime

# Railway backend URL
BASE_URL = "https://heirclarkinstacartbackend-production.up.railway.app/api/v1"

# Forged customer ID (attacker trying to access victim's data)
FORGED_CUSTOMER_ID = "ATTACKER_FORGED_VICTIM_12345"

# All 29 routes that should now have strictAuth protection
ROUTES_TO_TEST = [
    # P0 Priority (4 routes)
    {"name": "User Goals", "method": "GET", "path": "/user/goals", "priority": "P0"},
    {"name": "User Preferences", "method": "GET", "path": "/user/preferences", "priority": "P0"},
    {"name": "Weight Progress", "method": "GET", "path": "/weight/progress", "priority": "P0"},
    {"name": "Progress Photos", "method": "GET", "path": "/progress-photos", "priority": "P0"},

    # P1 Priority (4 routes)
    {"name": "Programs", "method": "GET", "path": "/programs", "priority": "P1"},
    {"name": "Body Scan Reports", "method": "GET", "path": "/body-scan-reports", "priority": "P1"},
    {"name": "Meal Plans", "method": "GET", "path": "/meal-plans", "priority": "P1"},
    {"name": "Habits", "method": "GET", "path": "/habits", "priority": "P1"},

    # P2 Priority (8 routes)
    {"name": "Favorites", "method": "GET", "path": "/favorites", "priority": "P2"},
    {"name": "Hydration", "method": "GET", "path": "/hydration/today", "priority": "P2"},
    {"name": "Nutrition Daily", "method": "GET", "path": "/nutrition/daily", "priority": "P2"},
    {"name": "Pantry Items", "method": "GET", "path": "/pantry", "priority": "P2"},
    {"name": "Wearables", "method": "GET", "path": "/wearables", "priority": "P2"},
    {"name": "Health Data", "method": "GET", "path": "/health-data/summary", "priority": "P2"},
    {"name": "Health Devices", "method": "GET", "path": "/health-devices", "priority": "P2"},
    {"name": "Coach Messages", "method": "GET", "path": "/coach/messages", "priority": "P2"},

    # P3 Priority (13 routes)
    {"name": "Restaurant Meals", "method": "GET", "path": "/restaurant", "priority": "P3"},
    {"name": "Budget Meals", "method": "GET", "path": "/budget-meals", "priority": "P3"},
    {"name": "Meal Library", "method": "GET", "path": "/meal-library", "priority": "P3"},
    {"name": "Weekly Prep", "method": "GET", "path": "/weekly-prep", "priority": "P3"},
    {"name": "Social Posts", "method": "GET", "path": "/social/posts", "priority": "P3"},
    {"name": "RAG Health", "method": "GET", "path": "/rag/health", "priority": "P3"},
    {"name": "Apple Health Sync", "method": "GET", "path": "/apple-health/sync-status", "priority": "P3"},
    {"name": "Health Bridge Status", "method": "GET", "path": "/health-bridge/status", "priority": "P3"},
    {"name": "Plateau Analysis", "method": "GET", "path": "/plateau/analyze", "priority": "P3"},
    {"name": "Sleep Nutrition", "method": "GET", "path": "/sleep-nutrition/today", "priority": "P3"},
    {"name": "Workout Fuel", "method": "GET", "path": "/workout-fuel/today", "priority": "P3"},
    {"name": "Import Status", "method": "GET", "path": "/import/status", "priority": "P3"},
    {"name": "Health Check", "method": "GET", "path": "/health/status", "priority": "P3"},
]

def test_route_with_forged_id(route):
    """Test a route with forged customer ID - should return 401 Unauthorized"""
    url = f"{BASE_URL}{route['path']}"
    headers = {
        "X-Shopify-Customer-Id": FORGED_CUSTOMER_ID,
        "Content-Type": "application/json"
    }

    try:
        if route["method"] == "GET":
            response = requests.get(url, headers=headers, params={"shopifyCustomerId": FORGED_CUSTOMER_ID}, timeout=10)
        else:
            response = requests.post(url, headers=headers, json={"shopifyCustomerId": FORGED_CUSTOMER_ID}, timeout=10)

        # Check if route properly rejects forged ID
        is_secure = response.status_code == 401

        return {
            "route": route["name"],
            "path": route["path"],
            "priority": route["priority"],
            "status_code": response.status_code,
            "is_secure": is_secure,
            "response": response.json() if response.status_code == 401 else None,
            "error": None
        }

    except requests.exceptions.Timeout:
        return {
            "route": route["name"],
            "path": route["path"],
            "priority": route["priority"],
            "status_code": None,
            "is_secure": False,
            "response": None,
            "error": "Request timeout"
        }
    except Exception as e:
        return {
            "route": route["name"],
            "path": route["path"],
            "priority": route["priority"],
            "status_code": None,
            "is_secure": False,
            "response": None,
            "error": str(e)
        }

def main():
    print("=" * 80)
    print("COMPREHENSIVE IDOR PENETRATION TEST - ALL 29 ROUTES")
    print("=" * 80)
    print(f"Testing: {BASE_URL}")
    print(f"Forged Customer ID: {FORGED_CUSTOMER_ID}")
    print(f"Expected: ALL routes should return 401 Unauthorized")
    print("=" * 80)
    print()

    results = []

    # Test each route
    for i, route in enumerate(ROUTES_TO_TEST, 1):
        print(f"[{i}/{len(ROUTES_TO_TEST)}] Testing {route['priority']} - {route['name']}...", end=" ")
        result = test_route_with_forged_id(route)
        results.append(result)

        if result["is_secure"]:
            print(f"[PASS] 401")
        elif result["error"]:
            print(f"[ERROR] {result['error']}")
        else:
            print(f"[FAIL] {result['status_code']} - IDOR VULNERABILITY!")

    print()
    print("=" * 80)
    print("TEST RESULTS SUMMARY")
    print("=" * 80)

    # Calculate statistics
    total_routes = len(results)
    secure_routes = sum(1 for r in results if r["is_secure"])
    vulnerable_routes = sum(1 for r in results if not r["is_secure"] and r["status_code"] and r["status_code"] != 401)
    error_routes = sum(1 for r in results if r["error"])

    # Security score calculation
    security_score = (secure_routes / total_routes) * 100

    print(f"\nTotal Routes Tested: {total_routes}")
    print(f"[SECURE] 401 Unauthorized: {secure_routes}")
    print(f"[VULNERABLE] 200 OK: {vulnerable_routes}")
    print(f"[ERRORS] Timeouts: {error_routes}")
    print(f"\n[SECURITY SCORE]: {security_score:.1f}/100")

    if security_score >= 95:
        print("[EXCELLENT] IDOR vulnerability is FIXED!")
    elif security_score >= 80:
        print("[GOOD] Most routes secured, some need attention")
    else:
        print("[CRITICAL] IDOR vulnerability still present!")

    # Breakdown by priority
    print("\n--- Results by Priority ---")
    for priority in ["P0", "P1", "P2", "P3"]:
        priority_results = [r for r in results if r["priority"] == priority]
        if priority_results:
            secure = sum(1 for r in priority_results if r["is_secure"])
            total = len(priority_results)
            print(f"{priority}: {secure}/{total} secure ({(secure/total)*100:.0f}%)")

    # List any vulnerable routes
    vulnerable = [r for r in results if not r["is_secure"] and r["status_code"] and r["status_code"] != 401]
    if vulnerable:
        print("\n[VULNERABLE ROUTES] - STILL NEED FIXING:")
        for r in vulnerable:
            print(f"  - {r['route']} ({r['path']}) - Status: {r['status_code']}")

    # List any errors
    errors = [r for r in results if r["error"]]
    if errors:
        print("\n[ROUTES WITH ERRORS]:")
        for r in errors:
            print(f"  - {r['route']} ({r['path']}) - Error: {r['error']}")

    # Save detailed results to JSON
    report_file = f"idor_test_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(report_file, "w") as f:
        json.dump({
            "timestamp": datetime.now().isoformat(),
            "base_url": BASE_URL,
            "total_routes": total_routes,
            "secure_routes": secure_routes,
            "vulnerable_routes": vulnerable_routes,
            "error_routes": error_routes,
            "security_score": security_score,
            "results": results
        }, f, indent=2)

    print(f"\n[REPORT] Detailed report saved to: {report_file}")
    print("=" * 80)

    return security_score >= 95

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
