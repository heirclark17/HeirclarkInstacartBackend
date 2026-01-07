# Weekly Meal Plan Template

## Output Format: JSONL

Each meal plan should be output as structured JSONL for easy parsing and database storage.

---

## Header Record
```jsonl
{"type": "header", "user_id": "{{user_id}}", "week_start": "{{week_start}}", "generated_at": "{{timestamp}}", "goals": {"calories": {{daily_calories}}, "protein_g": {{protein_g}}, "carbs_g": {{carbs_g}}, "fat_g": {{fat_g}}}}
```

## Daily Records (7 per week)
```jsonl
{"type": "day", "date": "{{date}}", "day_name": "{{day_name}}", "is_workout_day": {{boolean}}, "calorie_adjustment": {{number}}, "target_calories": {{adjusted_calories}}}
```

## Meal Records (4 per day: breakfast, lunch, dinner, snacks)
```jsonl
{"type": "meal", "date": "{{date}}", "meal_type": "breakfast", "name": "{{meal_name}}", "prep_time_min": {{number}}, "cook_time_min": {{number}}, "calories": {{number}}, "protein_g": {{number}}, "carbs_g": {{number}}, "fat_g": {{number}}}
```

## Ingredient Records (linked to meals)
```jsonl
{"type": "ingredient", "date": "{{date}}", "meal_type": "{{meal_type}}", "food_name": "{{food_name}}", "amount": {{number}}, "unit": "{{unit}}", "calories": {{number}}, "protein_g": {{number}}, "carbs_g": {{number}}, "fat_g": {{number}}, "fdc_id": "{{usda_fdc_id}}", "validated": true}
```

## Daily Summary Records
```jsonl
{"type": "daily_summary", "date": "{{date}}", "total_calories": {{number}}, "total_protein_g": {{number}}, "total_carbs_g": {{number}}, "total_fat_g": {{number}}, "goal_variance_percent": {{number}}}
```

## Grocery List Records
```jsonl
{"type": "grocery_item", "food_name": "{{food_name}}", "total_amount": {{number}}, "unit": "{{unit}}", "category": "{{produce|dairy|meat|grains|pantry|frozen}}", "estimated_price": {{number}}}
```

## Grocery Summary
```jsonl
{"type": "grocery_summary", "total_items": {{number}}, "estimated_total": {{number}}, "instacart_url": "{{deep_link}}"}
```

## Footer Record
```jsonl
{"type": "footer", "total_days": 7, "avg_daily_calories": {{number}}, "avg_daily_protein": {{number}}, "meal_count": {{number}}, "prep_tips": ["{{tip1}}", "{{tip2}}"]}
```

---

## Example Complete Output

```jsonl
{"type": "header", "user_id": "cust_12345", "week_start": "2024-01-15", "generated_at": "2024-01-14T10:30:00Z", "goals": {"calories": 2200, "protein_g": 165, "carbs_g": 220, "fat_g": 73}}
{"type": "day", "date": "2024-01-15", "day_name": "Monday", "is_workout_day": true, "calorie_adjustment": 300, "target_calories": 2500}
{"type": "meal", "date": "2024-01-15", "meal_type": "breakfast", "name": "Protein Oatmeal Bowl", "prep_time_min": 5, "cook_time_min": 10, "calories": 450, "protein_g": 35, "carbs_g": 55, "fat_g": 12}
{"type": "ingredient", "date": "2024-01-15", "meal_type": "breakfast", "food_name": "Oats, regular and quick, dry", "amount": 80, "unit": "g", "calories": 307, "protein_g": 10.7, "carbs_g": 54.8, "fat_g": 5.3, "fdc_id": "173904", "validated": true}
{"type": "ingredient", "date": "2024-01-15", "meal_type": "breakfast", "food_name": "Whey protein powder, vanilla", "amount": 30, "unit": "g", "calories": 120, "protein_g": 24, "carbs_g": 3, "fat_g": 1, "fdc_id": "173178", "validated": true}
{"type": "ingredient", "date": "2024-01-15", "meal_type": "breakfast", "food_name": "Blueberries, raw", "amount": 50, "unit": "g", "calories": 29, "protein_g": 0.4, "carbs_g": 7.2, "fat_g": 0.2, "fdc_id": "171711", "validated": true}
{"type": "meal", "date": "2024-01-15", "meal_type": "lunch", "name": "Grilled Chicken Salad", "prep_time_min": 15, "cook_time_min": 20, "calories": 550, "protein_g": 45, "carbs_g": 25, "fat_g": 30}
{"type": "ingredient", "date": "2024-01-15", "meal_type": "lunch", "food_name": "Chicken breast, grilled", "amount": 150, "unit": "g", "calories": 248, "protein_g": 46.5, "carbs_g": 0, "fat_g": 5.4, "fdc_id": "171534", "validated": true}
{"type": "ingredient", "date": "2024-01-15", "meal_type": "lunch", "food_name": "Mixed greens, raw", "amount": 100, "unit": "g", "calories": 20, "protein_g": 2, "carbs_g": 3, "fat_g": 0.3, "fdc_id": "168462", "validated": true}
{"type": "ingredient", "date": "2024-01-15", "meal_type": "lunch", "food_name": "Olive oil", "amount": 15, "unit": "ml", "calories": 120, "protein_g": 0, "carbs_g": 0, "fat_g": 14, "fdc_id": "171413", "validated": true}
{"type": "ingredient", "date": "2024-01-15", "meal_type": "lunch", "food_name": "Avocado, raw", "amount": 50, "unit": "g", "calories": 80, "protein_g": 1, "carbs_g": 4, "fat_g": 7.5, "fdc_id": "171705", "validated": true}
{"type": "meal", "date": "2024-01-15", "meal_type": "dinner", "name": "Salmon with Quinoa and Vegetables", "prep_time_min": 10, "cook_time_min": 25, "calories": 650, "protein_g": 50, "carbs_g": 45, "fat_g": 28}
{"type": "meal", "date": "2024-01-15", "meal_type": "snacks", "name": "Greek Yogurt with Almonds", "prep_time_min": 2, "cook_time_min": 0, "calories": 250, "protein_g": 20, "carbs_g": 15, "fat_g": 12}
{"type": "daily_summary", "date": "2024-01-15", "total_calories": 1900, "total_protein_g": 150, "total_carbs_g": 140, "total_fat_g": 82, "goal_variance_percent": -3.2}
{"type": "grocery_item", "food_name": "Chicken breast, boneless skinless", "total_amount": 1050, "unit": "g", "category": "meat", "estimated_price": 12.99}
{"type": "grocery_item", "food_name": "Atlantic salmon fillet", "total_amount": 600, "unit": "g", "category": "meat", "estimated_price": 15.99}
{"type": "grocery_item", "food_name": "Oats, old fashioned", "total_amount": 560, "unit": "g", "category": "grains", "estimated_price": 4.99}
{"type": "grocery_item", "food_name": "Mixed greens", "total_amount": 300, "unit": "g", "category": "produce", "estimated_price": 5.99}
{"type": "grocery_item", "food_name": "Greek yogurt, plain", "total_amount": 1000, "unit": "g", "category": "dairy", "estimated_price": 6.99}
{"type": "grocery_summary", "total_items": 24, "estimated_total": 89.50, "instacart_url": "https://instacart.com/store/heb/storefront?utm_source=heirclark&cart=base64encodedcart"}
{"type": "footer", "total_days": 7, "avg_daily_calories": 2180, "avg_daily_protein": 162, "meal_count": 28, "prep_tips": ["Prep chicken breasts Sunday for the week", "Cook quinoa in bulk - lasts 5 days refrigerated", "Pre-portion snacks into containers"]}
```

---

## Database Insert Format

For PostgreSQL insertion, transform JSONL to:

```sql
-- meal_plans table
INSERT INTO meal_plans (user_id, week_start, goals, generated_at)
VALUES ('cust_12345', '2024-01-15', '{"calories": 2200, "protein_g": 165}', NOW());

-- meal_plan_days table
INSERT INTO meal_plan_days (plan_id, date, is_workout_day, target_calories)
VALUES (1, '2024-01-15', true, 2500);

-- meal_plan_meals table
INSERT INTO meal_plan_meals (day_id, meal_type, name, nutrition, prep_time_min)
VALUES (1, 'breakfast', 'Protein Oatmeal Bowl', '{"calories": 450, "protein_g": 35}', 5);

-- meal_plan_ingredients table
INSERT INTO meal_plan_ingredients (meal_id, food_name, amount, unit, nutrition, fdc_id)
VALUES (1, 'Oats, regular and quick, dry', 80, 'g', '{"calories": 307}', '173904');
```
