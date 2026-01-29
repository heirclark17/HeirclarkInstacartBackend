# Shopify to Apple App Migration Guide

**Project:** Heirclark Health & Nutrition Tracker
**Current State:** Shopify Liquid templates + Railway backend
**Target State:** Native iOS App + Railway backend
**Date:** January 16, 2026

---

## 🎯 Migration Strategy Overview

### Current Architecture
```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Shopify Store  │────────▶│  Railway Backend │────────▶│   PostgreSQL    │
│ (Liquid Theme)  │         │  (Node.js API)   │         │    Database     │
└─────────────────┘         └──────────────────┘         └─────────────────┘
        │                            │
        │                            ├──▶ Open Food Facts API
        │                            ├──▶ OpenWeatherMap API
        │                            └──▶ Wearable Providers (Fitbit, etc.)
        │
        └──▶ hc-calorie-counter.liquid (frontend UI)
             hc-wearable-sync.liquid
```

### Target Architecture
```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   iOS App       │────────▶│  Railway Backend │────────▶│   PostgreSQL    │
│ (Swift/SwiftUI) │         │  (Node.js API)   │         │    Database     │
└─────────────────┘         └──────────────────┘         └─────────────────┘
        │                            │
        ├──▶ HealthKit (Apple Health)│
        │                            ├──▶ Open Food Facts API
        │                            ├──▶ OpenWeatherMap API
        │                            └──▶ Wearable Providers
        │
        └──▶ Native iOS UI (SwiftUI)
             TabView, NavigationStack, Charts
```

**Key Change:** Replace Shopify frontend with native iOS app while **keeping the same Railway backend APIs**.

---

## 📋 Phase 1: Apple Developer Setup (Week 1)

### 1.1 Apple Developer Account Configuration

**You Already Have:**
- ✅ Apple Developer Program membership ($99/year)

**Complete These Steps:**

#### Create App ID
1. Go to [developer.apple.com](https://developer.apple.com)
2. Navigate to **Certificates, Identifiers & Profiles**
3. Click **Identifiers** → **+** (Add)
4. Select **App IDs** → Continue
5. Configure:
   - **Description:** Heirclark Health Tracker
   - **Bundle ID:** `com.heirclark.healthtracker` (reverse domain notation)
   - **Capabilities:** Check these boxes:
     - ☑️ HealthKit
     - ☑️ Push Notifications
     - ☑️ Sign in with Apple
     - ☑️ App Groups (for widget support)
     - ☑️ Associated Domains (for universal links)

#### Create Development Certificate
1. On your Mac, open **Keychain Access**
2. Menu: **Keychain Access** → **Certificate Assistant** → **Request Certificate from Certificate Authority**
3. Enter your email, name, save to disk
4. Go to Apple Developer → **Certificates** → **+**
5. Select **iOS App Development**
6. Upload the `.certSigningRequest` file
7. Download certificate, double-click to install in Keychain

#### Create Provisioning Profile
1. Apple Developer → **Profiles** → **+**
2. Select **iOS App Development**
3. Choose your App ID (`com.heirclark.healthtracker`)
4. Select your certificate
5. Select test devices (your iPhone)
6. Download and double-click to install

---

## 📋 Phase 2: Technology Stack Decision (Week 1)

### Option A: Native iOS (Swift + SwiftUI) ⭐ **RECOMMENDED**

**Pros:**
- ✅ Best Apple Health (HealthKit) integration
- ✅ Best performance and native feel
- ✅ Access to all iOS features (widgets, Siri, etc.)
- ✅ SwiftUI is modern and declarative
- ✅ Apple's official language

**Cons:**
- ❌ iOS only (no Android version)
- ❌ Requires learning Swift if not familiar
- ❌ Longer development time initially

**Best For:** Premium iOS experience, deep Apple Health integration

**Estimated Timeline:** 8-12 weeks for MVP

---

### Option B: React Native

**Pros:**
- ✅ Cross-platform (iOS + Android from one codebase)
- ✅ JavaScript/TypeScript (your backend is already TypeScript)
- ✅ Large community and libraries
- ✅ Faster development

**Cons:**
- ❌ HealthKit integration requires native modules
- ❌ Less native feel than SwiftUI
- ❌ Larger app size
- ❌ Performance slightly worse than native

**Best For:** If you want Android version too

**Estimated Timeline:** 6-10 weeks for MVP

---

### Option C: Flutter

**Pros:**
- ✅ Cross-platform with excellent performance
- ✅ Beautiful UI framework
- ✅ Growing ecosystem

**Cons:**
- ❌ Requires learning Dart
- ❌ HealthKit integration requires plugins
- ❌ Smaller community than React Native

**Best For:** If you want beautiful UI and cross-platform

**Estimated Timeline:** 6-10 weeks for MVP

---

### **RECOMMENDATION: Swift + SwiftUI (Option A)**

**Reasons:**
1. Your app is **health-focused** → HealthKit is critical
2. You want **Apple Watch** support eventually → Native is best
3. You're starting fresh → Learn the right way from the start
4. **Superior integration** with Apple ecosystem
5. Your backend is already built → Frontend is the only new work

---

## 📋 Phase 3: iOS App Development Setup (Week 1-2)

### 3.1 Install Development Tools

**Required Software:**
```bash
# Xcode (from Mac App Store)
# Free, 12+ GB download
# Includes Swift, iOS Simulator, Interface Builder

# CocoaPods (dependency manager)
sudo gem install cocoapods

# Swift Package Manager (built into Xcode)
# No installation needed

# Optional: SwiftLint (code quality)
brew install swiftlint
```

### 3.2 Create Xcode Project

**Steps:**
1. Open **Xcode**
2. Create New Project → **iOS** → **App**
3. Configure:
   - **Product Name:** Heirclark Health Tracker
   - **Team:** Select your Apple Developer account
   - **Organization Identifier:** `com.heirclark`
   - **Bundle Identifier:** `com.heirclark.healthtracker`
   - **Interface:** SwiftUI
   - **Language:** Swift
   - **Storage:** Core Data (optional, you have PostgreSQL backend)
   - **Include Tests:** Yes

4. Enable HealthKit:
   - Select project → **Signing & Capabilities**
   - Click **+ Capability**
   - Add **HealthKit**
   - Check "Clinical Health Records" if needed

### 3.3 Project Structure

```
HeirclarkHealthTracker/
├── HeirclarkHealthTracker/
│   ├── App/
│   │   ├── HeirclarkHealthTrackerApp.swift    # App entry point
│   │   └── ContentView.swift                   # Main view
│   ├── Models/
│   │   ├── User.swift                          # User model
│   │   ├── Meal.swift                          # Meal model
│   │   ├── FoodItem.swift                      # Food item model
│   │   ├── HealthData.swift                    # Health metrics
│   │   └── WeatherData.swift                   # Weather model
│   ├── Views/
│   │   ├── Dashboard/
│   │   │   ├── DashboardView.swift
│   │   │   ├── CalorieRingView.swift
│   │   │   └── MacroBreakdownView.swift
│   │   ├── FoodSearch/
│   │   │   ├── FoodSearchView.swift
│   │   │   ├── FoodDetailView.swift
│   │   │   └── BarcodeScanner.swift
│   │   ├── Meals/
│   │   │   ├── MealsView.swift
│   │   │   ├── AddMealView.swift
│   │   │   └── MealDetailView.swift
│   │   ├── Wearables/
│   │   │   ├── WearablesView.swift
│   │   │   ├── ProviderCardView.swift
│   │   │   └── SyncStatusView.swift
│   │   └── Profile/
│   │       ├── ProfileView.swift
│   │       ├── GoalsView.swift
│   │       └── SettingsView.swift
│   ├── Services/
│   │   ├── APIService.swift                    # Backend API client
│   │   ├── HealthKitService.swift              # Apple Health integration
│   │   ├── AuthService.swift                   # Authentication
│   │   └── NotificationService.swift           # Push notifications
│   ├── ViewModels/
│   │   ├── DashboardViewModel.swift
│   │   ├── FoodSearchViewModel.swift
│   │   ├── MealsViewModel.swift
│   │   └── WearablesViewModel.swift
│   ├── Utilities/
│   │   ├── Constants.swift                     # API URLs, keys
│   │   ├── Extensions.swift                    # Swift extensions
│   │   └── Formatters.swift                    # Date/number formatters
│   └── Resources/
│       ├── Assets.xcassets/                    # Images, colors
│       ├── Info.plist                          # App configuration
│       └── HealthKit.plist                     # HealthKit permissions
├── HeirclarkHealthTrackerTests/
└── HeirclarkHealthTrackerUITests/
```

---

## 📋 Phase 4: Backend API Integration (Week 2-3)

### 4.1 API Service Implementation

**File: `Services/APIService.swift`**

```swift
import Foundation

class APIService {
    static let shared = APIService()

    private let baseURL = "https://heirclarkinstacartbackend-production.up.railway.app"
    private var customerId: String?

    // MARK: - Authentication

    func setCustomerId(_ id: String) {
        self.customerId = id
        UserDefaults.standard.set(id, forKey: "shopify_customer_id")
    }

    private func getHeaders() -> [String: String] {
        var headers = ["Content-Type": "application/json"]
        if let customerId = customerId {
            headers["x-shopify-customer-id"] = customerId
        }
        return headers
    }

    // MARK: - Food Search API

    func searchFood(query: String, page: Int = 1, pageSize: Int = 20) async throws -> FoodSearchResponse {
        let url = URL(string: "\(baseURL)/api/v1/food/search")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.allHTTPHeaderFields = getHeaders()

        let body = ["query": query, "page": page, "pageSize": pageSize] as [String : Any]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(FoodSearchResponse.self, from: data)
    }

    func getFoodDetails(id: String) async throws -> FoodDetailResponse {
        let url = URL(string: "\(baseURL)/api/v1/food/\(id)")!
        var request = URLRequest(url: url)
        request.allHTTPHeaderFields = getHeaders()

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(FoodDetailResponse.self, from: data)
    }

    func scanBarcode(barcode: String) async throws -> FoodDetailResponse {
        let url = URL(string: "\(baseURL)/api/v1/food/barcode")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.allHTTPHeaderFields = getHeaders()

        let body = ["barcode": barcode]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(FoodDetailResponse.self, from: data)
    }

    // MARK: - Meals API

    func getTodaysMeals() async throws -> [Meal] {
        let url = URL(string: "\(baseURL)/api/v1/meals/today")!
        var request = URLRequest(url: url)
        request.allHTTPHeaderFields = getHeaders()

        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(MealsResponse.self, from: data)
        return response.meals
    }

    func addMeal(meal: Meal) async throws -> Meal {
        let url = URL(string: "\(baseURL)/api/v1/meals")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.allHTTPHeaderFields = getHeaders()
        request.httpBody = try JSONEncoder().encode(meal)

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(Meal.self, from: data)
    }

    // MARK: - Weather API

    func getCurrentWeather(lat: Double, lon: Double) async throws -> WeatherResponse {
        let url = URL(string: "\(baseURL)/api/v1/weather/current?lat=\(lat)&lon=\(lon)&units=imperial")!
        var request = URLRequest(url: url)
        request.allHTTPHeaderFields = getHeaders()

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(WeatherResponse.self, from: data)
    }

    // MARK: - Wearables API

    func getWearableProviders() async throws -> [WearableProvider] {
        let url = URL(string: "\(baseURL)/api/v1/wearables/providers")!
        var request = URLRequest(url: url)
        request.allHTTPHeaderFields = getHeaders()

        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(WearableProvidersResponse.self, from: data)
        return response.providers
    }

    func syncWearable(provider: String) async throws -> SyncResponse {
        let url = URL(string: "\(baseURL)/api/v1/wearables/sync/\(provider)")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.allHTTPHeaderFields = getHeaders()

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(SyncResponse.self, from: data)
    }

    // MARK: - User Preferences

    func getUserPreferences() async throws -> UserPreferences {
        let url = URL(string: "\(baseURL)/api/v1/preferences")!
        var request = URLRequest(url: url)
        request.allHTTPHeaderFields = getHeaders()

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(UserPreferences.self, from: data)
    }

    func updateUserPreferences(_ prefs: UserPreferences) async throws {
        let url = URL(string: "\(baseURL)/api/v1/preferences")!
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.allHTTPHeaderFields = getHeaders()
        request.httpBody = try JSONEncoder().encode(prefs)

        let (_, _) = try await URLSession.shared.data(for: request)
    }
}

// MARK: - Response Models

struct FoodSearchResponse: Codable {
    let success: Bool
    let query: String
    let totalResults: String
    let foods: [FoodItem]
}

struct FoodDetailResponse: Codable {
    let success: Bool
    let food: FoodItem
}

struct MealsResponse: Codable {
    let meals: [Meal]
}

struct WeatherResponse: Codable {
    let success: Bool
    let location: Location
    let weather: Weather
}

struct WearableProvidersResponse: Codable {
    let providers: [WearableProvider]
}

struct SyncResponse: Codable {
    let success: Bool
    let provider: String
    let recordsProcessed: Int
}
```

---

### 4.2 Data Models

**File: `Models/FoodItem.swift`**

```swift
import Foundation

struct FoodItem: Codable, Identifiable {
    let id: String
    let name: String
    let brand: String?
    let nutrients: Nutrients
    let ingredients: String?
    let allergens: String?
    let imageUrl: String?
    let nutriScore: String?
    let novaGroup: Int?
}

struct Nutrients: Codable {
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
    let fiber: Double?
    let sugar: Double?
    let sodium: Double?
}
```

**File: `Models/Meal.swift`**

```swift
import Foundation

struct Meal: Codable, Identifiable {
    let id: UUID
    let datetime: Date
    let label: String?
    let items: [MealItem]
    let totalCalories: Int
    let totalProtein: Int
    let totalCarbs: Int
    let totalFat: Int
}

struct MealItem: Codable, Identifiable {
    let id: UUID
    let foodId: String
    let name: String
    let servingSize: Double
    let servingUnit: String
    let calories: Int
    let protein: Int
    let carbs: Int
    let fat: Int
}
```

---

### 4.3 HealthKit Integration

**File: `Services/HealthKitService.swift`**

```swift
import HealthKit

class HealthKitService: ObservableObject {
    static let shared = HealthKitService()
    private let healthStore = HKHealthStore()

    @Published var isAuthorized = false
    @Published var todaySteps: Int = 0
    @Published var todayCaloriesBurned: Int = 0
    @Published var activeEnergy: Int = 0

    // MARK: - Authorization

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitError.notAvailable
        }

        let typesToRead: Set<HKObjectType> = [
            HKObjectType.quantityType(forIdentifier: .stepCount)!,
            HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!,
            HKObjectType.quantityType(forIdentifier: .basalEnergyBurned)!,
            HKObjectType.quantityType(forIdentifier: .heartRate)!,
            HKObjectType.quantityType(forIdentifier: .bodyMass)!,
            HKObjectType.workoutType()
        ]

        let typesToWrite: Set<HKSampleType> = [
            HKObjectType.quantityType(forIdentifier: .dietaryEnergyConsumed)!,
            HKObjectType.quantityType(forIdentifier: .dietaryProtein)!,
            HKObjectType.quantityType(forIdentifier: .dietaryCarbohydrates)!,
            HKObjectType.quantityType(forIdentifier: .dietaryFatTotal)!,
            HKObjectType.quantityType(forIdentifier: .dietaryWater)!
        ]

        try await healthStore.requestAuthorization(toShare: typesToWrite, read: typesToRead)
        await MainActor.run {
            self.isAuthorized = true
        }
    }

    // MARK: - Read Data

    func getTodaySteps() async throws -> Int {
        let stepsType = HKQuantityType.quantityType(forIdentifier: .stepCount)!
        let startOfDay = Calendar.current.startOfDay(for: Date())
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: Date())

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(quantityType: stepsType, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, result, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                let steps = result?.sumQuantity()?.doubleValue(for: HKUnit.count()) ?? 0
                continuation.resume(returning: Int(steps))
            }
            healthStore.execute(query)
        }
    }

    func getActiveCalories() async throws -> Int {
        let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
        let startOfDay = Calendar.current.startOfDay(for: Date())
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: Date())

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(quantityType: energyType, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, result, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                let calories = result?.sumQuantity()?.doubleValue(for: HKUnit.kilocalorie()) ?? 0
                continuation.resume(returning: Int(calories))
            }
            healthStore.execute(query)
        }
    }

    // MARK: - Write Data (Log Food to Apple Health)

    func logMealToHealth(meal: Meal) async throws {
        let caloriesType = HKQuantityType.quantityType(forIdentifier: .dietaryEnergyConsumed)!
        let proteinType = HKQuantityType.quantityType(forIdentifier: .dietaryProtein)!
        let carbsType = HKQuantityType.quantityType(forIdentifier: .dietaryCarbohydrates)!
        let fatType = HKQuantityType.quantityType(forIdentifier: .dietaryFatTotal)!

        let caloriesQuantity = HKQuantity(unit: HKUnit.kilocalorie(), doubleValue: Double(meal.totalCalories))
        let proteinQuantity = HKQuantity(unit: HKUnit.gram(), doubleValue: Double(meal.totalProtein))
        let carbsQuantity = HKQuantity(unit: HKUnit.gram(), doubleValue: Double(meal.totalCarbs))
        let fatQuantity = HKQuantity(unit: HKUnit.gram(), doubleValue: Double(meal.totalFat))

        let caloriesSample = HKQuantitySample(type: caloriesType, quantity: caloriesQuantity, start: meal.datetime, end: meal.datetime)
        let proteinSample = HKQuantitySample(type: proteinType, quantity: proteinQuantity, start: meal.datetime, end: meal.datetime)
        let carbsSample = HKQuantitySample(type: carbsType, quantity: carbsQuantity, start: meal.datetime, end: meal.datetime)
        let fatSample = HKQuantitySample(type: fatType, quantity: fatQuantity, start: meal.datetime, end: meal.datetime)

        try await healthStore.save([caloriesSample, proteinSample, carbsSample, fatSample])
    }

    // MARK: - Background Sync

    func enableBackgroundDelivery() {
        let types: [HKObjectType] = [
            HKObjectType.quantityType(forIdentifier: .stepCount)!,
            HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!
        ]

        for type in types {
            healthStore.enableBackgroundDelivery(for: type, frequency: .hourly) { success, error in
                if success {
                    print("✅ Background delivery enabled for \(type)")
                }
            }
        }
    }
}

enum HealthKitError: Error {
    case notAvailable
    case authorizationDenied
}
```

---

## 📋 Phase 5: Core UI Implementation (Week 3-6)

### 5.1 Main App Structure

**File: `App/HeirclarkHealthTrackerApp.swift`**

```swift
import SwiftUI

@main
struct HeirclarkHealthTrackerApp: App {
    @StateObject private var authService = AuthService.shared
    @StateObject private var healthKitService = HealthKitService.shared

    var body: some Scene {
        WindowGroup {
            if authService.isAuthenticated {
                MainTabView()
                    .onAppear {
                        Task {
                            try? await healthKitService.requestAuthorization()
                        }
                    }
            } else {
                LoginView()
            }
        }
    }
}
```

**File: `Views/MainTabView.swift`**

```swift
import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            DashboardView()
                .tabItem {
                    Label("Dashboard", systemImage: "chart.pie.fill")
                }

            FoodSearchView()
                .tabItem {
                    Label("Food", systemImage: "magnifyingglass")
                }

            MealsView()
                .tabItem {
                    Label("Meals", systemImage: "fork.knife")
                }

            WearablesView()
                .tabItem {
                    Label("Sync", systemImage: "applewatch")
                }

            ProfileView()
                .tabItem {
                    Label("Profile", systemImage: "person.fill")
                }
        }
    }
}
```

---

### 5.2 Dashboard View (Home Screen)

**File: `Views/Dashboard/DashboardView.swift`**

```swift
import SwiftUI
import Charts

struct DashboardView: View {
    @StateObject private var viewModel = DashboardViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // Calorie Ring
                    CalorieRingView(
                        consumed: viewModel.caloriesConsumed,
                        burned: viewModel.caloriesBurned,
                        target: viewModel.caloriesTarget
                    )

                    // Macro Breakdown
                    MacroBreakdownView(
                        protein: viewModel.proteinConsumed,
                        carbs: viewModel.carbsConsumed,
                        fat: viewModel.fatConsumed,
                        proteinTarget: viewModel.proteinTarget,
                        carbsTarget: viewModel.carbsTarget,
                        fatTarget: viewModel.fatTarget
                    )

                    // Weather Widget
                    if let weather = viewModel.weather {
                        WeatherCardView(weather: weather)
                    }

                    // Activity Summary
                    ActivitySummaryView(
                        steps: viewModel.steps,
                        activeCalories: viewModel.activeCalories,
                        workouts: viewModel.workoutsToday
                    )

                    // Recent Meals
                    RecentMealsSection(meals: viewModel.recentMeals)
                }
                .padding()
            }
            .navigationTitle("Dashboard")
            .refreshable {
                await viewModel.refresh()
            }
        }
        .onAppear {
            Task {
                await viewModel.loadData()
            }
        }
    }
}
```

---

### 5.3 Food Search View

**File: `Views/FoodSearch/FoodSearchView.swift`**

```swift
import SwiftUI

struct FoodSearchView: View {
    @StateObject private var viewModel = FoodSearchViewModel()
    @State private var searchText = ""
    @State private var showBarcodeScanner = false

    var body: some View {
        NavigationStack {
            VStack {
                // Search Bar
                HStack {
                    TextField("Search foods...", text: $searchText)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit {
                            Task {
                                await viewModel.search(query: searchText)
                            }
                        }

                    Button {
                        showBarcodeScanner = true
                    } label: {
                        Image(systemName: "barcode.viewfinder")
                            .font(.title2)
                    }
                }
                .padding()

                // Results List
                if viewModel.isLoading {
                    ProgressView()
                } else {
                    List(viewModel.searchResults) { food in
                        NavigationLink {
                            FoodDetailView(foodId: food.id)
                        } label: {
                            FoodRow(food: food)
                        }
                    }
                }
            }
            .navigationTitle("Food Search")
            .sheet(isPresented: $showBarcodeScanner) {
                BarcodeScannerView { barcode in
                    Task {
                        await viewModel.scanBarcode(barcode)
                    }
                    showBarcodeScanner = false
                }
            }
        }
    }
}

struct FoodRow: View {
    let food: FoodItem

    var body: some View {
        HStack {
            // Food Image
            AsyncImage(url: URL(string: food.imageUrl ?? "")) { image in
                image.resizable()
            } placeholder: {
                Color.gray
            }
            .frame(width: 60, height: 60)
            .cornerRadius(8)

            VStack(alignment: .leading, spacing: 4) {
                Text(food.name)
                    .font(.headline)
                    .lineLimit(2)

                if let brand = food.brand {
                    Text(brand)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }

                HStack {
                    Label("\(Int(food.nutrients.calories)) cal", systemImage: "flame.fill")
                        .font(.caption)
                        .foregroundColor(.orange)

                    if let nutriScore = food.nutriScore {
                        NutriScoreBadge(score: nutriScore)
                    }
                }
            }
        }
    }
}
```

---

## 📋 Phase 6: Authentication (Week 4)

### 6.1 Options for User Authentication

**Option A: Sign in with Apple (Recommended)**
- ✅ Required for apps that use social login
- ✅ Privacy-focused
- ✅ Quick setup
- ✅ Built into iOS

**Option B: Custom Backend Auth**
- Your Railway backend issues JWT tokens
- User registers with email/password
- Store customer_id in Keychain

**Option C: Shopify Customer Accounts**
- Keep existing Shopify customer integration
- Use Shopify Multipass tokens
- Seamless migration for existing users

**RECOMMENDATION: Sign in with Apple + Backend Sync**

**File: `Services/AuthService.swift`**

```swift
import AuthenticationServices

class AuthService: ObservableObject {
    static let shared = AuthService()

    @Published var isAuthenticated = false
    @Published var currentUser: User?

    func signInWithApple() async throws {
        let provider = ASAuthorizationAppleIDProvider()
        let request = provider.createRequest()
        request.requestedScopes = [.fullName, .email]

        // Handle sign-in flow
        // Send Apple ID token to your backend
        // Backend validates and creates/links to customer_id
        // Store customer_id locally

        // Pseudo code:
        // let appleToken = /* get from Apple */
        // let response = try await APIService.shared.authenticateWithApple(token: appleToken)
        // APIService.shared.setCustomerId(response.customerId)
        // self.isAuthenticated = true
    }

    func signOut() {
        UserDefaults.standard.removeObject(forKey: "shopify_customer_id")
        self.isAuthenticated = false
        self.currentUser = nil
    }
}
```

---

## 📋 Phase 7: Backend Updates (Week 5)

### 7.1 Add iOS App Authentication Endpoint

**Add to your Railway backend:**

**File: `src/routes/auth.ts` (NEW)**

```typescript
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';

const router = Router();

// Sign in with Apple
router.post('/auth/apple', async (req, res) => {
  try {
    const { appleToken, appleUserId } = req.body;

    // Verify Apple token (use apple-signin-auth library)
    // const appleUser = await verifyAppleToken(appleToken);

    // Check if user exists
    let result = await pool.query(
      'SELECT * FROM ios_users WHERE apple_user_id = $1',
      [appleUserId]
    );

    let customerId: string;

    if (result.rows.length === 0) {
      // Create new user
      const insertResult = await pool.query(
        `INSERT INTO ios_users (apple_user_id, created_at)
         VALUES ($1, NOW())
         RETURNING customer_id`,
        [appleUserId]
      );
      customerId = insertResult.rows[0].customer_id;
    } else {
      customerId = result.rows[0].customer_id;
    }

    // Generate JWT
    const token = jwt.sign(
      { customerId, platform: 'ios' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      customerId
    });

  } catch (error) {
    console.error('Apple sign-in error:', error);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
});

export default router;
```

**Add to `src/index.ts`:**

```typescript
import authRouter from './routes/auth';
app.use('/api/v1', authRouter);
```

---

### 7.2 Create iOS Users Table

**File: `src/db/migrations/ios-users.ts` (NEW)**

```typescript
import { pool } from '../pool';

async function migrateIosUsers() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ios_users (
      id SERIAL PRIMARY KEY,
      customer_id TEXT UNIQUE DEFAULT gen_random_uuid()::text,
      apple_user_id TEXT UNIQUE,
      email TEXT,
      name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_login TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log('✅ ios_users table ready');
}

export { migrateIosUsers };
```

---

## 📋 Phase 8: App Store Submission (Week 6-8)

### 8.1 Pre-Submission Checklist

**Required Assets:**

1. **App Icon** (Required sizes):
   - 1024×1024px (App Store)
   - 180×180px (iPhone Pro)
   - 120×120px (iPhone)
   - 167×167px (iPad Pro)
   - Generate using https://appicon.co/

2. **Screenshots** (Required):
   - 6.7" iPhone 15 Pro Max: 1290×2796px (minimum 3 screenshots)
   - 6.5" iPhone 14 Plus: 1284×2778px
   - 12.9" iPad Pro: 2048×2732px (if supporting iPad)
   - Use Simulator to capture

3. **Privacy Policy URL**
   - Must be publicly accessible
   - Host at: `https://heirclarkinstacartbackend-production.up.railway.app/privacy-policy`
   - Required for HealthKit apps

4. **Support URL**
   - Contact page or support email
   - Example: `https://heirclark.com/support`

**Info.plist Requirements:**

```xml
<key>NSHealthShareUsageDescription</key>
<string>We read your activity data (steps, calories burned) to calculate your daily calorie balance and provide personalized nutrition recommendations.</string>

<key>NSHealthUpdateUsageDescription</key>
<string>We save your meal nutrition data to Apple Health so you can track your dietary intake across all your health apps.</string>

<key>NSCameraUsageDescription</key>
<string>We use your camera to scan food barcodes for quick nutrition lookup.</string>

<key>NSLocationWhenInUseUsageDescription</key>
<string>We use your location to provide weather-based hydration reminders and find nearby healthy food options.</string>
```

---

### 8.2 App Store Connect Setup

**Steps:**

1. **Go to App Store Connect** (appstoreconnect.apple.com)
2. Click **My Apps** → **+** → **New App**
3. Configure:
   - **Platform:** iOS
   - **Name:** Heirclark Health Tracker
   - **Primary Language:** English (U.S.)
   - **Bundle ID:** `com.heirclark.healthtracker`
   - **SKU:** `heirclark-health-001`
   - **User Access:** Full Access

4. **App Information:**
   - **Category:** Health & Fitness
   - **Secondary Category:** Food & Drink
   - **Content Rights:** No
   - **Age Rating:** 4+ (no restricted content)

5. **Pricing and Availability:**
   - **Price:** Free (or set price)
   - **Availability:** All countries
   - **Pre-orders:** No

6. **App Privacy:**
   - Click **Set Up App Privacy**
   - Answer questions about data collection:
     - ✅ Health & Fitness data (HealthKit)
     - ✅ Location (for weather)
     - ✅ User ID (for backend authentication)
     - ✅ Email (for Sign in with Apple)

---

### 8.3 TestFlight Beta Testing

**Before submitting to App Store, test with TestFlight:**

1. **Archive Build in Xcode:**
   - Select **Any iOS Device** (not simulator)
   - Menu: **Product** → **Archive**
   - Wait for build to complete (~5 min)

2. **Upload to App Store Connect:**
   - In Organizer window, click **Distribute App**
   - Select **App Store Connect**
   - Click **Upload**
   - Wait for processing (~15-30 minutes)

3. **Add Beta Testers:**
   - Go to App Store Connect → **TestFlight**
   - Click **External Testing** → **+**
   - Add emails of testers
   - Submit for beta review (takes 24-48 hours)

4. **Collect Feedback:**
   - Testers receive email with TestFlight link
   - They install and test
   - You see crash reports and feedback

---

### 8.4 Final App Store Submission

**Required Content:**

1. **App Description** (4000 char max):
```
Heirclark Health Tracker is your all-in-one nutrition and fitness companion. Track your meals, monitor your activity, and achieve your health goals with personalized insights.

FEATURES:
• Food Database: Search 3M+ foods with detailed nutrition facts
• Barcode Scanner: Instantly log meals by scanning product barcodes
• Apple Health Sync: Seamlessly integrate with Apple Health and Fitness
• Activity Tracking: Monitor steps, calories burned, and workouts
• Macro Tracking: Track protein, carbs, and fat with visual progress rings
• Weather Integration: Get hydration reminders based on local weather
• Wearable Sync: Connect Fitbit, Garmin, and other fitness devices
• Daily Dashboard: See your complete health picture at a glance

WHY CHOOSE HEIRCLARK?
✓ No ads or premium upsells
✓ Privacy-focused (your data stays yours)
✓ Beautiful, intuitive interface
✓ Real-time sync across all your devices
✓ Backed by science-based nutrition guidelines

Perfect for anyone looking to lose weight, build muscle, or maintain a healthy lifestyle.

Download now and start your health journey today!
```

2. **Keywords** (100 char max):
```
nutrition,calories,food tracker,diet,fitness,health,macro,carbs,protein,weight loss
```

3. **Support URL:**
```
https://heirclark.com/support
```

4. **Marketing URL (optional):**
```
https://heirclark.com
```

5. **Promotional Text** (170 char):
```
Track your nutrition effortlessly with our 3M+ food database, barcode scanner, and Apple Health integration. Start your health journey today!
```

---

### 8.5 Submission Process

1. **Upload Build:**
   - Archive in Xcode (Product → Archive)
   - Distribute to App Store Connect
   - Wait for processing

2. **Fill Out App Store Connect:**
   - Add screenshots
   - Write description
   - Set pricing
   - Complete privacy questionnaire
   - Add app preview video (optional but recommended)

3. **Submit for Review:**
   - Click **Add for Review**
   - Select build version
   - Click **Submit**
   - Average review time: 1-3 days

4. **Address Review Feedback:**
   - Apple may ask questions about HealthKit usage
   - Be ready to explain privacy practices
   - Demonstrate app works as described

5. **Go Live:**
   - Once approved, click **Release This Version**
   - App appears in App Store within 24 hours

---

## 📋 Phase 9: Migration Plan (Week 7-8)

### 9.1 Dual-Platform Strategy (Recommended)

**Keep both running during transition:**

```
┌─────────────────────────────────────────────────────────┐
│               TRANSITION PERIOD (3-6 months)            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Shopify Web App              iOS Native App           │
│  ─────────────────            ────────────────          │
│  • Keep existing users        • New downloads          │
│  • No new features            • Active development     │
│  • Maintenance only           • Full feature set       │
│  • Sunset message             • Apple Health sync      │
│                                                         │
│  Backend: Same Railway API serves both                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Benefits:**
- Existing users aren't forced to switch immediately
- You can test iOS app with real users
- Gradual migration reduces risk
- Backend unchanged (both apps use same API)

---

### 9.2 User Migration Path

**For Existing Shopify Users:**

1. **Add banner to Shopify theme:**
   ```html
   <div style="background: #007AFF; color: white; padding: 15px; text-align: center;">
     📱 Download our new iOS app for a better experience!
     <a href="https://apps.apple.com/app/heirclark/IDXXXXX"
        style="color: white; font-weight: bold;">
       Get it on the App Store
     </a>
   </div>
   ```

2. **Email announcement:**
   - Send to all Shopify customers
   - Explain benefits of native app
   - Provide App Store link
   - Assure data will transfer

3. **Data migration API:**
   ```typescript
   // Backend endpoint: /api/v1/migrate-user
   router.post('/migrate-user', async (req, res) => {
     const { shopifyCustomerId, appleUserId } = req.body;

     // Link existing Shopify customer to new iOS user
     await pool.query(
       'UPDATE ios_users SET shopify_customer_id = $1 WHERE apple_user_id = $2',
       [shopifyCustomerId, appleUserId]
     );

     // All existing data (meals, preferences, etc.) now accessible to iOS app
     res.json({ success: true });
   });
   ```

4. **In-app migration flow:**
   - iOS app asks "Do you have existing data?"
   - User enters Shopify email
   - Backend sends verification code
   - User confirms, data linked

---

### 9.3 Sunset Timeline

**Month 1-2:** iOS app in TestFlight beta
**Month 3:** iOS app launches on App Store
**Month 4-6:** Both platforms active, encourage iOS adoption
**Month 7:** Announce Shopify app sunset date (3 months notice)
**Month 10:** Shopify app becomes read-only
**Month 11:** Shopify app shutdown, redirect to App Store

---

## 📋 Phase 10: Advanced Features (Week 9+)

### 10.1 Apple Watch App

**File: `HeirclarkHealthTracker Watch App/ContentView.swift`**

```swift
import SwiftUI

struct WatchContentView: View {
    @StateObject private var viewModel = WatchViewModel()

    var body: some View {
        TabView {
            // Today's Summary
            VStack {
                Text("\(viewModel.caloriesConsumed)")
                    .font(.largeTitle)
                Text("Calories")
                    .font(.caption)

                Text("\(viewModel.caloriesBurned) burned")
                    .font(.footnote)
                    .foregroundColor(.green)
            }

            // Quick Log
            VStack {
                Text("Log Meal")
                    .font(.headline)

                Button("Breakfast") {
                    // Quick log preset meal
                }

                Button("Snack") {
                    // Quick log preset meal
                }
            }

            // Activity
            VStack {
                Text("\(viewModel.steps)")
                    .font(.largeTitle)
                Text("Steps")
                    .font(.caption)
            }
        }
    }
}
```

---

### 10.2 Widgets (Home Screen + Lock Screen)

**File: `HeirclarkWidget/HeirclarkWidget.swift`**

```swift
import WidgetKit
import SwiftUI

struct CalorieBudgetWidget: Widget {
    let kind: String = "CalorieBudgetWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            CalorieBudgetView(entry: entry)
        }
        .configurationDisplayName("Calorie Budget")
        .description("See your daily calorie progress at a glance")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular])
    }
}

struct CalorieBudgetView: View {
    var entry: Provider.Entry

    var body: some View {
        VStack {
            Text("\(entry.caloriesConsumed)")
                .font(.title)
                .bold()

            Text("/ \(entry.caloriesTarget)")
                .font(.caption)

            ProgressView(value: Double(entry.caloriesConsumed), total: Double(entry.caloriesTarget))
        }
        .padding()
    }
}
```

---

### 10.3 Siri Shortcuts

**File: `Services/SiriShortcutsService.swift`**

```swift
import Intents

class SiriShortcutsService {
    static func donateLogMeal(meal: Meal) {
        let intent = LogMealIntent()
        intent.mealName = meal.label
        intent.calories = NSNumber(value: meal.totalCalories)

        let interaction = INInteraction(intent: intent, response: nil)
        interaction.donate { error in
            if let error = error {
                print("Failed to donate: \(error)")
            }
        }
    }
}
```

User can then say: **"Hey Siri, log my breakfast"**

---

### 10.4 Push Notifications

**Notification Types:**
- 🔔 **Meal reminders** ("Time to log your lunch!")
- 💧 **Hydration reminders** ("You haven't logged water in 3 hours")
- 🏃 **Activity goals** ("You're 1,500 steps from your goal!")
- 📊 **Weekly summary** ("You hit your protein goal 5/7 days this week!")
- ⚠️ **Low calorie warning** ("You've only eaten 800 calories today")

**Implementation:**

```swift
import UserNotifications

class NotificationService {
    static let shared = NotificationService()

    func scheduleHydrationReminder() {
        let content = UNMutableNotificationContent()
        content.title = "Stay Hydrated"
        content.body = "Don't forget to log your water intake!"
        content.sound = .default

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 3 * 60 * 60, repeats: true)
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: trigger)

        UNUserNotificationCenter.current().add(request)
    }
}
```

---

## 📋 Timeline & Milestones

### Week-by-Week Breakdown

| Week | Phase | Deliverables | Status |
|------|-------|--------------|--------|
| **1** | Setup | Apple Developer account, Xcode project, HealthKit enabled | 🟡 Ready to start |
| **2** | Backend Integration | APIService.swift, models, networking | 🟡 |
| **3-4** | Core UI | Dashboard, Food Search, Meals views | 🟡 |
| **5** | Authentication | Sign in with Apple, backend auth endpoint | 🟡 |
| **6** | Polish | Testing, bug fixes, screenshots | 🟡 |
| **7** | TestFlight | Beta release to 10-20 testers | 🟡 |
| **8** | App Store | Submission, review, launch | 🟡 |
| **9+** | Advanced | Apple Watch, widgets, Siri shortcuts | 🟡 |

**Estimated Total Time:** 8-12 weeks for App Store launch

---

## 📋 Cost Breakdown

### One-Time Costs
- **Apple Developer Program:** $99/year (already paid ✅)
- **Design assets (optional):** $0-500 (Figma templates, icons)
- **App Store screenshots tool:** Free (use Xcode Simulator)

### Ongoing Costs
- **Railway backend:** $0-20/month (current setup, no change)
- **OpenWeatherMap API:** Free (1,000 calls/day)
- **Database (PostgreSQL):** Included in Railway
- **Push notifications:** Free (Apple Push Notification Service)

**Total Additional Cost:** ~$99/year (just Apple Developer renewal)

---

## 📋 Resources & Learning

### Official Documentation
- [Apple Developer Docs](https://developer.apple.com/documentation/)
- [SwiftUI Tutorials](https://developer.apple.com/tutorials/swiftui)
- [HealthKit Documentation](https://developer.apple.com/documentation/healthkit)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

### SwiftUI Learning (Recommended)
- **Hacking with Swift** (free): https://www.hackingwithswift.com/100/swiftui
- **Stanford CS193p** (free course): YouTube "Developing Apps for iOS"
- **Apple's SwiftUI Essentials** (free): developer.apple.com/tutorials

### Backend Integration
- **URLSession Guide:** Apple's networking documentation
- **Async/Await in Swift:** Modern concurrency patterns

### Community
- **r/iOSProgramming** (Reddit)
- **Swift Forums:** forums.swift.org
- **Stack Overflow:** Tag "swiftui" for questions

---

## 🎯 Next Steps (Action Items for You)

### Immediate (This Week)
1. ✅ Confirm Apple Developer account is active
2. ⬜ Install Xcode from Mac App Store (if not already)
3. ⬜ Create new Xcode project following Phase 3 instructions
4. ⬜ Enable HealthKit capability
5. ⬜ Test "Hello World" app on your iPhone

### Short-Term (Next 2 Weeks)
6. ⬜ Implement APIService.swift (connect to your Railway backend)
7. ⬜ Test food search API from iOS app
8. ⬜ Build basic dashboard UI with calorie display
9. ⬜ Request HealthKit authorization

### Medium-Term (Weeks 3-6)
10. ⬜ Complete all 5 main views (Dashboard, Food, Meals, Sync, Profile)
11. ⬜ Implement Sign in with Apple
12. ⬜ Add backend authentication endpoint
13. ⬜ Test complete user flow (signup → search food → log meal)

### Launch Preparation (Weeks 7-8)
14. ⬜ Create app screenshots (3-5 per device size)
15. ⬜ Write App Store description and keywords
16. ⬜ TestFlight beta with 10 testers
17. ⬜ Submit to App Store

---

## ❓ FAQ

### Q: Can I keep my Shopify store?
**A:** Yes! Your Shopify store can remain active. Many apps use Shopify for product sales while having a separate iOS app for functionality. You could even sell nutrition products via Shopify and have the iOS app for tracking.

### Q: Will existing user data transfer?
**A:** Yes, via the migration API (see Phase 9). Users will link their Shopify account to the iOS app using their email, and all historical data (meals, preferences) will be accessible.

### Q: Do I need to rebuild the backend?
**A:** No! Your existing Railway backend with all the APIs (food search, weather, wearables, etc.) works perfectly. You just add one new authentication endpoint for iOS users.

### Q: Can I use React Native instead of Swift?
**A:** Yes, but for HealthKit integration and Apple Watch support, native Swift is strongly recommended. React Native requires native modules for HealthKit which adds complexity.

### Q: How long until I can submit to App Store?
**A:** Realistic timeline: 6-8 weeks for an MVP with core features. 10-12 weeks for a polished version with all features.

### Q: What about Android?
**A:** Once the iOS app is live, you can build an Android version using either React Native (cross-platform) or native Kotlin. Android uses Google Health Connect instead of HealthKit.

### Q: Do I need a Mac?
**A:** Yes, Xcode (required for iOS development) only runs on macOS. Minimum: macOS 13.0+ (Ventura). M1/M2 Mac recommended for performance.

---

## 📞 Support & Next Steps

**Ready to start?** Here's what I can help you with:

1. **Generate starter code** for any component (APIService, Views, Models)
2. **Review your Xcode project** structure
3. **Debug HealthKit** authorization issues
4. **Write backend** authentication endpoints
5. **Prepare App Store** submission materials

**Just ask!** For example:
- "Generate the complete FoodSearchView.swift code"
- "Help me set up Sign in with Apple"
- "Write the App Store description"
- "Create the privacy policy for my website"

---

**Last Updated:** January 16, 2026
**Status:** Ready to Begin iOS Development
**Backend:** ✅ Production-ready on Railway
**Next Milestone:** Create Xcode project and implement APIService
