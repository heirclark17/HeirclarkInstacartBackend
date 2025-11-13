// src/data/weekPlan.ts

export interface Meal {
  name: string;
  ingredients: string[];
}

export interface DayMeals {
  breakfast: Meal;
  lunch: Meal;
  dinner: Meal;
}

export interface DayPlan {
  day: number;
  meals: DayMeals;
}

export interface WeekPlan {
  weekPlan: DayPlan[];
}

export const weekPlan: WeekPlan = {
  weekPlan: [
    {
      day: 1,
      meals: {
        breakfast: {
          name: "Protein Breakfast Bowl",
          ingredients: [
            "2 eggs",
            "2 egg whites",
            "1 chicken sausage link",
            "1/2 cup oats",
            "1/2 cup blueberries"
          ]
        },
        lunch: {
          name: "Chicken, Rice & Veg",
          ingredients: [
            "6 oz chicken breast",
            "1 cup jasmine rice",
            "1 cup broccoli",
            "1 tbsp olive oil"
          ]
        },
        dinner: {
          name: "Salmon Plate",
          ingredients: [
            "6 oz salmon",
            "200g potatoes",
            "1 cup green beans"
          ]
        }
      }
    },
    {
      day: 2,
      meals: {
        breakfast: {
          name: "Greek Yogurt Protein Parfait",
          ingredients: [
            "1 cup Greek yogurt",
            "1 scoop whey protein",
            "1/2 cup granola",
            "1/2 cup strawberries"
          ]
        },
        lunch: {
          name: "Turkey Wrap",
          ingredients: [
            "1 whole wheat tortilla",
            "4 oz sliced turkey",
            "1 slice provolone cheese",
            "1 tbsp light mayo",
            "1 cup baby carrots"
          ]
        },
        dinner: {
          name: "Lean Beef & Rice Bowl",
          ingredients: [
            "5 oz lean ground beef",
            "1 cup jasmine rice",
            "1/2 cup corn",
            "1/2 cup peppers and onions"
          ]
        }
      }
    },
    {
      day: 3,
      meals: {
        breakfast: {
          name: "Avocado Toast + Eggs",
          ingredients: [
            "2 slices whole grain bread",
            "1/2 avocado",
            "2 eggs"
          ]
        },
        lunch: {
          name: "Tuna Power Salad",
          ingredients: [
            "1 can tuna",
            "2 tbsp light mayo",
            "1 cup mixed greens",
            "1/4 cup shredded cheese",
            "1 apple"
          ]
        },
        dinner: {
          name: "Shrimp Stir Fry",
          ingredients: [
            "6 oz shrimp",
            "1 cup jasmine rice",
            "1 cup stir fry veggies",
            "1 tbsp soy sauce"
          ]
        }
      }
    },
    {
      day: 4,
      meals: {
        breakfast: {
          name: "Smoothie Bowl",
          ingredients: [
            "1 scoop whey protein",
            "1 banana",
            "1/2 cup oats",
            "1 tbsp peanut butter",
            "1/2 cup almond milk",
            "1/4 cup granola"
          ]
        },
        lunch: {
          name: "Chicken Caesar Wrap",
          ingredients: [
            "4 oz grilled chicken",
            "1 whole wheat tortilla",
            "1.5 tbsp light Caesar dressing",
            "1 cup romaine lettuce"
          ]
        },
        dinner: {
          name: "Turkey Meatballs & Pasta",
          ingredients: [
            "5 oz turkey meatballs",
            "1 cup whole wheat pasta",
            "1/2 cup marinara sauce",
            "1 cup spinach"
          ]
        }
      }
    },
    {
      day: 5,
      meals: {
        breakfast: {
          name: "Breakfast Burrito",
          ingredients: [
            "2 eggs",
            "2 egg whites",
            "1 whole wheat tortilla",
            "1/4 cup shredded cheese",
            "1/2 cup peppers and onions"
          ]
        },
        lunch: {
          name: "Chicken Quinoa Bowl",
          ingredients: [
            "5 oz chicken breast",
            "1/2 cup quinoa",
            "1 cup mixed vegetables",
            "1 tbsp olive oil"
          ]
        },
        dinner: {
          name: "Baked Tilapia Plate",
          ingredients: [
            "6 oz tilapia",
            "1 cup jasmine rice",
            "1 cup steamed vegetables",
            "lemon"
          ]
        }
      }
    },
    {
      day: 6,
      meals: {
        breakfast: {
          name: "Protein Oatmeal",
          ingredients: [
            "1/2 cup oats",
            "1 scoop whey protein",
            "1 tbsp almond butter",
            "1/2 banana"
          ]
        },
        lunch: {
          name: "Turkey Chili",
          ingredients: [
            "1.25 cups turkey chili",
            "1 slice cornbread"
          ]
        },
        dinner: {
          name: "Chicken Fajita Plate",
          ingredients: [
            "6 oz chicken breast",
            "1 whole wheat tortilla",
            "1 cup peppers and onions",
            "salsa"
          ]
        }
      }
    },
    {
      day: 7,
      meals: {
        breakfast: {
          name: "Cottage Cheese Bowl",
          ingredients: [
            "1 cup cottage cheese",
            "1/2 cup pineapple",
            "1/4 cup granola",
            "1 tbsp honey"
          ]
        },
        lunch: {
          name: "Steak & Potato Bowl",
          ingredients: [
            "5 oz sirloin steak",
            "200g potatoes",
            "1 cup asparagus",
            "1 tsp olive oil"
          ]
        },
        dinner: {
          name: "Turkey Grain Bowl",
          ingredients: [
            "5 oz ground turkey",
            "3/4 cup brown rice",
            "1 cup mixed vegetables",
            "teriyaki sauce"
          ]
        }
      }
    }
  ]
};
